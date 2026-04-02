const documentService = require('./documentService');
const inventoryService = require('./inventoryService');
const automationService = require('./automationService');

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

  const docsComplete = await documentService.isDocumentationComplete('export_order', order.id);
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
