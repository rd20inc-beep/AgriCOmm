const documentService = require('../documents/documents.service');
const inventoryService = require('../inventory/inventory.service');
const automationService = require('../admin/automation.service');
const accountingService = require('../accounting/accounting.service');

const STATUS_TRANSITIONS = {
  'Draft': ['Awaiting Advance', 'Advance Received'],
  'Awaiting Advance': ['Advance Received'],
  'Advance Received': ['Procurement Pending', 'In Milling'],
  'Procurement Pending': ['In Milling'],
  'In Milling': ['Docs In Preparation'],
  'Docs In Preparation': ['Awaiting Balance'],
  'Awaiting Balance': ['Ready to Ship'],
  'Ready to Ship': ['Shipped'],
  'Shipped': ['Arrived'],
  'Arrived': ['Closed'],
  'Closed': [],
  'Cancelled': [],
};

const STATUS_STEP = {
  'Draft': 1,
  'Awaiting Advance': 2,
  'Advance Received': 3,
  'Procurement Pending': 4,
  'In Milling': 5,
  'Docs In Preparation': 6,
  'Awaiting Balance': 7,
  'Ready to Ship': 8,
  'Shipped': 9,
  'Arrived': 10,
  'Closed': 11,
};

const MONEY_EPSILON = 0.01;

function settledAmount(value) {
  return Math.round((parseFloat(value || 0) + Number.EPSILON) * 100) / 100;
}

function getAllowedTransitions(status) {
  return STATUS_TRANSITIONS[status] || [];
}

function getStepForStatus(status, fallback = 1) {
  return STATUS_STEP[status] || fallback;
}

function canTransition(fromStatus, toStatus) {
  return getAllowedTransitions(fromStatus).includes(toStatus);
}

function getAllowedActions(order) {
  const advanceReceived = settledAmount(order.advance_received || 0);
  const advanceExpected = settledAmount(order.advance_expected || 0);
  const balanceReceived = settledAmount(order.balance_received || 0);
  const balanceExpected = settledAmount(order.balance_expected || 0);
  const isTerminal = ['Closed', 'Cancelled'].includes(order.status);

  return {
    canConfirmAdvance: ['Draft', 'Awaiting Advance'].includes(order.status) && advanceReceived < advanceExpected,
    canStartDocs: order.status === 'In Milling',
    canRequestBalance: order.status === 'Awaiting Balance' && balanceReceived < balanceExpected,
    canCreateMilling: advanceReceived >= advanceExpected && !order.milling_order_id && !isTerminal,
    canUpdateShipment: ['Ready to Ship', 'Shipped'].includes(order.status),
    canPutOnHold: !isTerminal,
    canCloseOrder: order.status === 'Arrived' || (order.status === 'Shipped' && balanceReceived >= balanceExpected),
  };
}

function buildTransitionError(fromStatus, toStatus) {
  const err = new Error(
    `Cannot transition from '${fromStatus}' to '${toStatus}'. Allowed: ${getAllowedTransitions(fromStatus).join(', ') || 'none'}.`
  );
  err.statusCode = 400;
  return err;
}

async function ensureTransitionAllowed(trx, order, toStatus) {
  if (!canTransition(order.status, toStatus)) {
    throw buildTransitionError(order.status, toStatus);
  }

  if (toStatus === 'Shipped') {
    const docsComplete = await documentService.isDocumentationComplete('export_order', order.id);
    if (!docsComplete) {
      const err = new Error('Cannot ship: required export documents are not all approved. Check document checklist.');
      err.statusCode = 400;
      throw err;
    }
  }
}

async function runTransitionSideEffects(trx, order, toStatus, userId) {
  if (toStatus !== 'Shipped') return;

  const exportLot = await trx('inventory_lots')
    .where({ entity: 'export', type: 'finished', reserved_against: order.order_no })
    .first();

  if (exportLot) {
    await inventoryService.dispatchForShipment(trx, {
      orderId: order.id,
      lotId: exportLot.id,
      qtyMT: order.qty_mt,
      userId,
    });
  }

  // Phase 5: Lock COGS at dispatch
  try {
    await inventoryService.lockOrderCOGS(trx, order.id, 280);
  } catch (e) {
    console.warn('COGS lock failed (non-blocking):', e.message);
  }

  // Recognize revenue + matching COGS at shipment (control transfer).
  // Posting rules export_revenue (DR 1110 Export AR / CR 4010 Sales) and
  // export_shipment (DR 5020 COGS / CR 1230 Finished Rice) exist but were
  // never fired — so AR only ever saw receipt credits and customer ledgers
  // ran negative. Guarded by revenue_posted so a re-driven Shipped
  // transition can't double-post. Wrapped in a SAVEPOINT (nested trx) so a
  // posting failure or a closed-period rejection rolls back ONLY the
  // journals, never the shipment itself (matches the non-blocking accounting
  // pattern used by advance/balance receipts).
  if (!order.revenue_posted) {
    try {
      await trx.transaction(async (sp) => {
        // Re-read for the COGS just locked above and the booked-rate value.
        const o = await sp('export_orders').where({ id: order.id }).first();
        if (!o || o.revenue_posted) return;

        // Revenue is the contract value in PKR at the booked (locked) rate.
        // Any difference vs the actual receipt-date rates is a legitimate FX
        // gain/loss that surfaces as a residual on the customer ledger.
        const contractVal = parseFloat(o.contract_value) || 0;
        const bookedRate = parseFloat(o.booked_fx_rate) || 0;
        const revenuePkr = parseFloat(o.contract_value_pkr_locked)
          || (bookedRate ? contractVal * bookedRate : 0)
          || contractVal;
        const foreign = (o.currency || 'PKR') !== 'PKR';

        if (revenuePkr > 0) {
          await accountingService.autoPost(sp, {
            triggerEvent: 'export_revenue', entity: 'export',
            amount: revenuePkr, currency: 'PKR',
            refType: 'Export Order', refNo: o.order_no,
            description: foreign
              ? `Revenue ${o.order_no} (${o.currency} ${contractVal.toLocaleString()} @ ${bookedRate || '—'})`
              : `Revenue ${o.order_no}`,
            userId,
            partyType: o.customer_id ? 'customer' : null,
            partyId: o.customer_id || null,
          });
        }

        const cogsPkr = parseFloat(o.inventory_cogs_total_pkr) || 0;
        if (cogsPkr > 0) {
          await accountingService.autoPost(sp, {
            triggerEvent: 'export_shipment', entity: 'export',
            amount: cogsPkr, currency: 'PKR',
            refType: 'Export Order', refNo: o.order_no,
            description: `COGS ${o.order_no}`,
            userId,
            partyType: o.customer_id ? 'customer' : null,
            partyId: o.customer_id || null,
          });
        }

        await sp('export_orders').where({ id: o.id }).update({ revenue_posted: true });
      });
    } catch (e) {
      console.warn(`Revenue recognition failed for order ${order.order_no} (non-blocking):`, e.message);
    }
  }

  await automationService.onShipmentDeparted(trx, {
    orderId: order.id,
    userId,
  });
}

async function transitionOrder(trx, {
  order,
  toStatus,
  userId,
  reason = null,
  skipValidation = false,
}) {
  if (!skipValidation) {
    await ensureTransitionAllowed(trx, order, toStatus);
  }

  await trx('export_orders').where({ id: order.id }).update({
    status: toStatus,
    current_step: getStepForStatus(toStatus, order.current_step),
    updated_at: trx.fn.now(),
  });

  await trx('export_order_status_history').insert({
    order_id: order.id,
    from_status: order.status,
    to_status: toStatus,
    changed_by: userId,
    reason,
  });

  await runTransitionSideEffects(trx, order, toStatus, userId);

  return {
    ...order,
    status: toStatus,
    current_step: getStepForStatus(toStatus, order.current_step),
  };
}

async function maybePromoteAfterDocuments(trx, { order, userId, reason }) {
  if (order.status !== 'Docs In Preparation') {
    return { changed: false, order };
  }

  // Check export_order_documents — all 7 must be Approved or Final
  const REQUIRED_DOCS = ['phyto', 'blDraft', 'blFinal', 'invoice', 'packingList', 'coo', 'fumigation',
    'Phytosanitary Certificate', 'BL Draft', 'BL Final', 'Commercial Invoice', 'Packing List', 'Certificate of Origin', 'Fumigation Certificate'];
  const orderDocs = await trx('export_order_documents').where({ order_id: order.id });
  const approvedStatuses = new Set(['Approved', 'Final', 'Draft Uploaded']);
  const approvedCount = orderDocs.filter(d => approvedStatuses.has(d.status)).length;
  // Need at least 7 docs confirmed (the 7 required export docs)
  const docsComplete = approvedCount >= 7;
  if (!docsComplete) {
    return { changed: false, order };
  }

  const updatedOrder = await transitionOrder(trx, {
    order,
    toStatus: 'Awaiting Balance',
    userId,
    reason: reason || 'All required documents approved',
  });

  return { changed: true, order: updatedOrder };
}

async function maybePromoteAfterAdvance(trx, { order, newAdvanceReceived, userId, reason }) {
  const advanceFull = Math.abs(settledAmount(order.advance_expected) - settledAmount(newAdvanceReceived)) <= MONEY_EPSILON
    || settledAmount(newAdvanceReceived) > settledAmount(order.advance_expected);

  if (!advanceFull || !['Awaiting Advance', 'Draft'].includes(order.status)) {
    return { changed: false, order, advanceFull };
  }

  const updatedOrder = await transitionOrder(trx, {
    order,
    toStatus: 'Advance Received',
    userId,
    reason: reason || `Advance payment of ${newAdvanceReceived} confirmed`,
    skipValidation: order.status === 'Draft',
  });

  return { changed: true, order: updatedOrder, advanceFull };
}

async function maybePromoteAfterBalance(trx, { order, newBalanceReceived, userId, reason }) {
  const balanceFull = Math.abs(settledAmount(order.balance_expected) - settledAmount(newBalanceReceived)) <= MONEY_EPSILON
    || settledAmount(newBalanceReceived) > settledAmount(order.balance_expected);

  if (!balanceFull || order.status !== 'Awaiting Balance') {
    return { changed: false, order, balanceFull };
  }

  const updatedOrder = await transitionOrder(trx, {
    order,
    toStatus: 'Ready to Ship',
    userId,
    reason: reason || `Balance payment of ${newBalanceReceived} confirmed`,
  });

  return { changed: true, order: updatedOrder, balanceFull };
}

module.exports = {
  STATUS_TRANSITIONS,
  STATUS_STEP,
  MONEY_EPSILON,
  settledAmount,
  getAllowedTransitions,
  getAllowedActions,
  getStepForStatus,
  canTransition,
  transitionOrder,
  maybePromoteAfterDocuments,
  maybePromoteAfterAdvance,
  maybePromoteAfterBalance,
};
