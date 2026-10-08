const documentService = require('../documents/documents.service');
const inventoryService = require('../inventory/inventory.service');
const automationService = require('../admin/automation.service');
const accountingService = require('../accounting/accounting.service');
const { billableFreight } = require('./billableFreight');
const { BALANCE_COLLECTION_STATUSES, BALANCE_OUTSTANDING_SQL } = require('./balanceCollection');

const STATUS_TRANSITIONS = {
  'Draft': ['Awaiting Advance', 'Advance Received'],
  // #2 decouple: an order awaiting its advance may proceed with OPERATIONAL work
  // (procurement / milling) while the advance sits pending Finance confirmation.
  // The financial track lives on `financial_status`; only final dispatch (Shipped)
  // is gated on it (see ensureTransitionAllowed).
  'Awaiting Advance': ['Advance Received', 'Procurement Pending', 'In Milling'],
  'Advance Received': ['Procurement Pending', 'In Milling'],
  'Procurement Pending': ['In Milling'],
  'In Milling': ['Docs In Preparation'],
  // Ship on the advance (owner decision 2026-10-07): once the advance is
  // confirmed and the PRE-shipment documents are approved the order is Ready to
  // Ship. The balance is collected after sailing (CAD / LC style) and is tracked
  // on the money (balance_received vs balance_expected, see deriveBalanceStatus)
  // rather than as a stage; Close is where it must be settled.
  'Docs In Preparation': ['Ready to Ship'],
  // Legacy: orders parked here under the old balance-before-shipment rule still
  // move forward, held to the same Ready to Ship gates as any other order.
  'Awaiting Balance': ['Ready to Ship'],
  'Ready to Ship': ['Shipped'],
  'Shipped': ['Arrived'],
  // Close requires the balance fully received and the post-shipment documents
  // (BL Final) approved; see closeProblems.
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

// Statuses where shipment details (vessel, booking, containers, BL, GD, FI...)
// can be entered. A vessel is booked while the rice is still milling, so the
// editor opens from In Milling; only the ATD/ATA dates, which DRIVE the
// Shipped/Arrived transitions, wait for Ready to Ship (updateShipment refuses
// them earlier with a clear message).
const SHIPMENT_EDITABLE_STATUSES = [
  'In Milling', 'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship', 'Shipped',
];
const SHIPMENT_DEPARTURE_STATUSES = ['Ready to Ship', 'Shipped'];

function getAllowedActions(order) {
  const advanceReceived = settledAmount(order.advance_received || 0);
  const advanceExpected = settledAmount(order.advance_expected || 0);
  const balanceReceived = settledAmount(order.balance_received || 0);
  const balanceExpected = settledAmount(order.balance_expected || 0);
  const isTerminal = ['Closed', 'Cancelled'].includes(order.status);
  const departed = ['Shipped', 'Arrived'].includes(order.status);
  const balanceOutstanding = balanceReceived + MONEY_EPSILON < balanceExpected;

  return {
    // Money-based, not stage-based. An order may go on to milling while its
    // advance is still pending (#2 decouple) and Shipped is gated on that
    // advance, so tying this to Draft/Awaiting Advance left an In Milling order
    // with an advance it had no way to record and a shipment it could never
    // make. recordExportReceipt accepts any non-terminal status. Once the goods
    // have left, whatever is still owed is collected as the balance.
    canConfirmAdvance: !isTerminal && !departed && advanceReceived < advanceExpected,
    canStartDocs: order.status === 'In Milling',
    // Likewise: a balance can arrive before the documents are done, and a freight
    // debit note raised after shipment re-opens a balance that has to be
    // recordable on a Shipped/Arrived order.
    canRequestBalance: !isTerminal && balanceReceived < balanceExpected,
    // #2 decouple: milling no longer waits for the advance to be fully received.
    // Once the order is out of Draft (i.e. confirmed) and not terminal / already
    // milling, operational milling can start. The advance is tracked separately on
    // financial_status and only blocks final dispatch.
    canCreateMilling: !isTerminal && !order.milling_order_id && order.status !== 'Draft',
    canUpdateShipment: SHIPMENT_EDITABLE_STATUSES.includes(order.status),
    // ATD/ATA move the order to Shipped/Arrived; only offered where that move exists.
    canRecordDeparture: SHIPMENT_DEPARTURE_STATUSES.includes(order.status),
    // Must agree with STATUS_TRANSITIONS: offering Close on a Shipped order only
    // ever produced a "Cannot transition" error.
    // ... and Close also needs the balance in (the documents half of the Close
    // gate is checked server-side by closeProblems).
    canCloseOrder: canTransition(order.status, 'Closed') && !balanceOutstanding,
    // The goods have sailed on the advance and the buyer still owes the balance.
    balanceDue: departed && balanceOutstanding,
    balanceStatus: deriveBalanceStatus(order),
    // A draft is submitted into the workflow; full validation runs at that point.
    canSubmitDraft: order.status === 'Draft',
    // Cancel is an out-of-band action (not part of the linear STATUS_TRANSITIONS
    // map). Allowed any time before dispatch; once Shipped/Arrived the goods have
    // moved and it must be handled via returns / Danger Zone.
    canCancel: !['Shipped', 'Arrived', 'Closed', 'Cancelled'].includes(order.status),
  };
}

// Everything a Draft may leave blank but a live order may not. Checked whenever
// an order leaves Draft (ensureTransitionAllowed), so every way out of Draft,
// Submit or a direct status change, is held to the rules a live order is
// created under.
function draftSubmitProblems(order, items = []) {
  const problems = [];
  if (!order.customer_id) problems.push('a customer');
  if (!order.product_id) problems.push('a product');
  if (!order.incoterm) problems.push('an Incoterm');
  if (!order.bank_account_id) problems.push('a company bank account');
  const lines = Array.isArray(items) ? items : [];
  if (lines.length > 0) {
    lines.forEach((it, idx) => {
      const n = it.line_no || idx + 1;
      if (!it.product_id && !it.product_name) problems.push(`a product on line ${n}`);
      if (!(parseFloat(it.qty_mt) > 0)) problems.push(`a quantity on line ${n}`);
      if (!(parseFloat(it.price_per_mt) > 0)) problems.push(`a price on line ${n}`);
    });
  } else {
    if (!(parseFloat(order.qty_mt) > 0)) problems.push('a quantity');
    if (!(parseFloat(order.price_per_mt) > 0)) problems.push('a price per MT');
  }
  return problems;
}

// Where a submitted draft lands: with no advance due there is nothing to await.
function submitTargetFor(order) {
  return settledAmount(order.advance_expected) > 0 ? 'Awaiting Advance' : 'Advance Received';
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

  if (order.status === 'Draft') {
    const items = await trx('export_order_items').where({ order_id: order.id });
    const problems = draftSubmitProblems(order, items);
    if (problems.length) {
      const err = new Error(`This draft can't be submitted yet. It still needs ${problems.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }
  }

  if (toStatus === 'Ready to Ship' || toStatus === 'Shipped') {
    // Ship on the advance: the advance confirmed, the pre-shipment documents
    // approved and no packed-weight variance awaiting sign-off. The balance is
    // NOT a condition: it is collected after sailing and gates Close instead.
    const problems = await readyToShipProblems(trx, order, toStatus);
    if (problems.length) {
      const err = new Error(problems[0]);
      err.statusCode = 400;
      throw err;
    }
  }

  if (toStatus === 'Closed') {
    const problems = await closeProblems(trx, order);
    if (problems.length) {
      const err = new Error(problems[0]);
      err.statusCode = 400;
      throw err;
    }
  }
}

// #2 final-dispatch financial gate: operational prep runs free while the
// advance is pending, but the export can't ship until Finance confirms the
// advance (or the order needs no advance). Falls back to the received-vs-
// expected amount for any row that predates the financial_status backfill.
function advanceConfirmed(order) {
  if (settledAmount(order.advance_expected) <= 0) return true;
  if (order.financial_status) return ['Confirmed', 'Not Required'].includes(order.financial_status);
  return settledAmount(order.advance_received) >= settledAmount(order.advance_expected);
}

// Required checklist rows still missing or unapproved. phase 'pre' leaves out
// the documents only issued once the vessel has sailed.
async function missingChecklistDocs(conn, orderId, phase = 'all') {
  const missing = await documentService.checkMissingDocsWithConn(conn, 'export_order', orderId);
  return (missing || []).filter((m) => phase === 'all' || !POST_SHIPMENT_DOC_TYPES.has(m.doc_type));
}

// Everything standing between this order and Ready to Ship / Shipped, as
// messages (the first is the one thrown). Empty when it may go.
async function readyToShipProblems(conn, order, toStatus = 'Shipped') {
  const verb = toStatus === 'Shipped' ? 'Cannot ship' : 'Cannot mark Ready to Ship';
  const problems = [];
  if (!advanceConfirmed(order)) {
    problems.push(
      `${verb}: the advance payment is not yet confirmed by Finance (financial status: ${order.financial_status || 'pending'}).`
    );
  }
  const missing = await missingChecklistDocs(conn, order.id, 'pre');
  if (missing.length) {
    problems.push(
      `${verb}: required pre-shipment export documents are not all approved (${missing.map((m) => docLabel(m.doc_type)).join(', ')}). Check document checklist.`
    );
  }
  // Packed-weight variance gate: if the packed net rice is over/under tolerance
  // and hasn't been signed off, the order can't move to completion until
  // Owner/Admin approves. Only blocks when a variance record exists AND is pending.
  const pw = await conn('export_packing_weights').where({ order_id: order.id }).first();
  if (pw && pw.approval_status === 'pending') {
    problems.push(
      `Packed weight is ${pw.variance_status === 'under' ? 'under' : 'over'} tolerance ` +
      `(${parseFloat(pw.variance_pct).toFixed(2)}%). Owner/Admin approval is required before export completion.`
    );
  }
  return problems;
}

// Close: the balance fully received and every required document, including the
// post-shipment ones (BL Final), approved.
async function closeProblems(conn, order) {
  const problems = [];
  const expected = settledAmount(order.balance_expected);
  const received = settledAmount(order.balance_received);
  if (received + MONEY_EPSILON < expected) {
    problems.push(
      `Cannot close: the balance is still outstanding (${received.toFixed(2)} of ${expected.toFixed(2)} received). Record the balance when the buyer pays.`
    );
  }
  const missing = await missingChecklistDocs(conn, order.id, 'all');
  if (missing.length) {
    problems.push(
      `Cannot close: required documents are not all approved (${missing.map((m) => docLabel(m.doc_type)).join(', ')}).`
    );
  }
  return problems;
}

async function runTransitionSideEffects(trx, order, toStatus, userId) {
  if (toStatus !== 'Shipped') return;

  // Deduct inventory for EVERY lot reserved against this order. The authoritative
  // order→lot link is inventory_reservations (populated by allocate-stock).
  // The old lookup matched inventory_lots.reserved_against = order.order_no, but
  // reserveStock stores 'order-<id>', so it never matched and dispatch silently
  // skipped the deduction. Driving off the reservation rows also handles
  // multi-lot orders and is idempotent — once consumed, a re-driven Shipped
  // transition finds no Active reservations and won't double-deduct.
  const reservations = await trx('inventory_reservations')
    .where({ order_id: order.id, status: 'Active' });

  for (const r of reservations) {
    const qty = parseFloat(r.reserved_qty) || 0;
    if (qty <= 0) continue;
    // Release the hold first (frees reserved_qty), then physically dispatch the
    // same quantity so available_qty (= qty − reserved_qty) stays consistent.
    await inventoryService.releaseReservation(trx, { reservationId: r.id, userId });
    await inventoryService.dispatchForShipment(trx, {
      orderId: order.id,
      lotId: r.lot_id,
      qtyKg: qty,
      userId,
    });
    // releaseReservation marks it 'Released'; record that it actually shipped.
    await trx('inventory_reservations').where('id', r.id).update({ status: 'Consumed', updated_at: trx.fn.now() });
    // Clear the stale reserved_against tag once the lot is fully unreserved.
    const lot = await trx('inventory_lots').where('id', r.lot_id).first();
    if (lot && parseFloat(lot.reserved_qty) <= 0.0001) {
      await trx('inventory_lots').where('id', r.lot_id).update({ reserved_against: null });
    }
  }

  // Phase 5: Lock COGS at dispatch — value the contract in PKR at the order's
  // BOOKED rate (the same rate revenue recognition uses below), not a flat 280,
  // so gross profit isn't computed on a different FX rate than revenue.
  // The reservations above are Consumed by now; calculateOrderCOGS counts
  // Consumed + Active, so this is Σ dispatched kg × lot cost/kg, locked once.
  try {
    await inventoryService.lockOrderCOGS(trx, order.id, parseFloat(order.booked_fx_rate) || null);
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
            origCurrency: foreign ? o.currency : null,
            origFxRate: foreign ? bookedRate : null,
          });
        }

        // Freight charged BESIDE an FOB price is revenue too, and AR was just
        // debited only for the goods — so without this the buyer's ledger is
        // short by the freight they are being asked to pay. It is credited to
        // 4070 Freight & Insurance Recovered, never to 4010 Export Sales: it is
        // not rice, and netting it into sales would hide whether what is charged
        // to buyers covers what is paid to carriers (6010). A CFR/CIF order
        // priced 'in_price' has its freight inside contract_value already, so
        // billableFreight returns 0 and nothing posts here.
        const freightForeign = billableFreight(o);
        if (freightForeign > 0) {
          const freightPkr = parseFloat((freightForeign * (bookedRate || 1)).toFixed(2));
          const [exportAR, freightRev] = await Promise.all([
            sp('chart_of_accounts').where({ code: '1110' }).first(),
            sp('chart_of_accounts').where({ code: '4070' }).first(),
          ]);
          if (exportAR && freightRev && freightPkr > 0) {
            const jrnl = await accountingService.createJournal(sp, {
              date: new Date().toISOString().slice(0, 10),
              entity: 'export',
              refType: 'Export Order', refNo: o.order_no,
              description: foreign
                ? `Freight recovered ${o.order_no} (${o.currency} ${freightForeign.toLocaleString()} @ ${bookedRate || '—'})`
                : `Freight recovered ${o.order_no}`,
              currency: 'PKR', fxRate: 1, isAuto: true, userId,
              partyType: o.customer_id ? 'customer' : null,
              partyId: o.customer_id || null,
              origCurrency: foreign ? o.currency : null,
              origFxRate: foreign ? bookedRate : null,
              lines: [
                { account_id: exportAR.id,   account: exportAR.name,   debit: freightPkr, credit: 0,          narration: `DR 1110 ${exportAR.name} — freight charged ${o.order_no}` },
                { account_id: freightRev.id, account: freightRev.name, debit: 0,          credit: freightPkr, narration: `CR 4070 ${freightRev.name} — ${o.order_no}` },
              ],
            });
            if (jrnl?.id) await accountingService.postJournal(sp, jrnl.id);
          } else {
            console.warn(`Freight recovery skipped for ${o.order_no}: chart_of_accounts missing 1110/4070`);
          }
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

        // Apply the customer advance against AR. The advance was banked as a
        // LIABILITY (advance_receipt: DR Bank / CR 1310 Customer Advances
        // Received); revenue above just debited the FULL contract to AR (1110).
        // Without this reclassification AR stays overstated by the advance and
        // 1310 lingers on the books forever. Reclassify the banked advance (PKR)
        // 1310 → 1110. Any gap between the receipt-date rate (what's banked) and
        // the booked rate (what AR was recognized at) stays as a residual on the
        // customer ledger — the legitimate FX gain/loss the revenue note above
        // describes. Inside the same revenue_posted SAVEPOINT, so it posts once.
        const advanceAppliedPkr = parseFloat(o.advance_received_pkr)
          || (parseFloat(o.advance_received) || 0) * ((o.currency || 'PKR') === 'PKR' ? 1 : (bookedRate || 0));
        if (advanceAppliedPkr > 0.01) {
          const [advLiab, exportAR] = await Promise.all([
            sp('chart_of_accounts').where({ code: '1310' }).first(),
            sp('chart_of_accounts').where({ code: '1110' }).first(),
          ]);
          if (advLiab && exportAR) {
            const applied = parseFloat(advanceAppliedPkr.toFixed(2));
            const jrnl = await accountingService.createJournal(sp, {
              date: new Date().toISOString().slice(0, 10),
              entity: 'export',
              refType: 'Export Order', refNo: o.order_no,
              description: `Advance applied to AR ${o.order_no}`,
              currency: 'PKR', fxRate: 1, isAuto: true, userId,
              partyType: o.customer_id ? 'customer' : null,
              partyId: o.customer_id || null,
              lines: [
                { account_id: advLiab.id,  account: advLiab.name,  debit: applied, credit: 0,       narration: `DR ${advLiab.code} ${advLiab.name} — advance applied ${o.order_no}` },
                { account_id: exportAR.id, account: exportAR.name, debit: 0,       credit: applied, narration: `CR ${exportAR.code} ${exportAR.name} — advance applied ${o.order_no}` },
              ],
            });
            if (jrnl?.id) await accountingService.postJournal(sp, jrnl.id);
          } else {
            console.warn(`Advance application skipped for ${o.order_no}: chart_of_accounts missing 1310/1110`);
          }
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

// The seven checklist documents an export order needs, each with every doc_type
// spelling that has been stored for it (checklist rows use the snake_case one).
const DOC_TYPE_ALIASES = {
  'phyto': ['phyto', 'Phytosanitary Certificate'],
  'blDraft': ['blDraft', 'bl_draft', 'BL Draft'],
  'blFinal': ['blFinal', 'bl_final', 'BL Final'],
  'invoice': ['invoice', 'commercial_invoice', 'Commercial Invoice'],
  'packingList': ['packingList', 'packing_list', 'Packing List'],
  'coo': ['coo', 'Certificate of Origin'],
  'fumigation': ['fumigation', 'Fumigation Certificate'],
};
const REQUIRED_DOCS = Object.keys(DOC_TYPE_ALIASES);
// Issued by the carrier only once the vessel has sailed, so it can't hold up
// the shipment it evidences. Still required, for Close.
const POST_SHIPMENT_DOCS = ['blFinal'];
const PRE_SHIPMENT_DOCS = REQUIRED_DOCS.filter((k) => !POST_SHIPMENT_DOCS.includes(k));
const POST_SHIPMENT_DOC_TYPES = new Set(POST_SHIPMENT_DOCS.flatMap((k) => DOC_TYPE_ALIASES[k]));
const DOC_APPROVED_STATUSES = new Set(['Approved', 'Final']);

const DOC_LABELS = {
  phyto: 'Phytosanitary Certificate', blDraft: 'BL Draft', blFinal: 'BL Final',
  invoice: 'Commercial Invoice', packingList: 'Packing List', coo: 'Certificate of Origin',
  fumigation: 'Fumigation Certificate',
};
function docLabel(docType) {
  const key = REQUIRED_DOCS.find((k) => DOC_TYPE_ALIASES[k].includes(docType));
  return key ? DOC_LABELS[key] : docType;
}

// True only when EACH listed document has an Approved/Final row. Counting any
// seven rows let a draft upload, or seven optional documents, promote the order.
function docsApproved(orderDocs, keys) {
  const docs = Array.isArray(orderDocs) ? orderDocs : [];
  return keys.every((key) => docs.some(
    (d) => DOC_TYPE_ALIASES[key].includes(d.doc_type) && DOC_APPROVED_STATUSES.has(d.status)
  ));
}
const requiredDocsApproved = (orderDocs) => docsApproved(orderDocs, REQUIRED_DOCS);
const preShipmentDocsApproved = (orderDocs) => docsApproved(orderDocs, PRE_SHIPMENT_DOCS);

// Docs In Preparation (or a legacy Awaiting Balance order) moves to Ready to
// Ship once the PRE-shipment documents are approved and the rest of the Ready
// to Ship gate (advance confirmed, no pending weight variance) passes. Never
// throws for an unmet gate: the order simply stays where it is.
async function maybePromoteAfterDocuments(trx, { order, userId, reason }) {
  if (!['Docs In Preparation', 'Awaiting Balance'].includes(order.status)) {
    return { changed: false, order };
  }

  const orderDocs = await trx('export_order_documents').where({ order_id: order.id });
  if (!preShipmentDocsApproved(orderDocs)) {
    return { changed: false, order };
  }

  // The caller's snapshot may predate an advance confirmation made in the same
  // transaction; the gate must see the row as it is now.
  const fresh = { ...order, ...((await trx('export_orders').where({ id: order.id }).first()) || {}) };
  if (fresh.status !== order.status) return { changed: false, order: fresh };
  const blockers = await readyToShipProblems(trx, fresh, 'Ready to Ship');
  if (blockers.length) {
    return { changed: false, order: fresh, blockers };
  }

  const updatedOrder = await transitionOrder(trx, {
    order: fresh,
    toStatus: 'Ready to Ship',
    userId,
    reason: reason || 'Pre-shipment documents approved',
  });

  return { changed: true, order: updatedOrder };
}

async function maybePromoteAfterAdvance(trx, { order, newAdvanceReceived, userId, reason }) {
  const advanceFull = Math.abs(settledAmount(order.advance_expected) - settledAmount(newAdvanceReceived)) <= MONEY_EPSILON
    || settledAmount(newAdvanceReceived) > settledAmount(order.advance_expected);

  // The advance can be the last thing an order with its documents done was
  // waiting on: it is then Ready to Ship.
  if (advanceFull && ['Docs In Preparation', 'Awaiting Balance'].includes(order.status)) {
    const out = await maybePromoteAfterDocuments(trx, {
      order, userId, reason: reason || `Advance payment of ${newAdvanceReceived} confirmed`,
    });
    return { ...out, advanceFull };
  }

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

// The balance no longer gates shipment. The one stage it still touches is the
// legacy 'Awaiting Balance', which a receipt nudges on to Ready to Ship when the
// rest of that gate passes (it could move without the balance anyway).
async function maybePromoteAfterBalance(trx, { order, newBalanceReceived, userId, reason }) {
  const balanceFull = Math.abs(settledAmount(order.balance_expected) - settledAmount(newBalanceReceived)) <= MONEY_EPSILON
    || settledAmount(newBalanceReceived) > settledAmount(order.balance_expected);

  if (!balanceFull || order.status !== 'Awaiting Balance') {
    return { changed: false, order, balanceFull };
  }

  const out = await maybePromoteAfterDocuments(trx, {
    order, userId, reason: reason || `Balance payment of ${newBalanceReceived} confirmed`,
  });
  return { ...out, balanceFull };
}

// Post-shipment balance track, derived from the money (financial_status is the
// ADVANCE track and its CHECK has no balance values). 'Due After Shipment' while
// the goods are still here, 'Balance Due' once they have sailed and it is owed.
function deriveBalanceStatus(order) {
  const expected = settledAmount(order.balance_expected);
  const received = settledAmount(order.balance_received);
  if (expected <= 0) return 'Not Required';
  if (received + MONEY_EPSILON >= expected) return 'Received';
  if (['Shipped', 'Arrived', 'Closed'].includes(order.status)) {
    return received > 0 ? 'Partially Received' : 'Balance Due';
  }
  return 'Due After Shipment';
}

// #2 financial-status track. Resolve the advance-confirmation state of an order
// from its amounts. Used to backfill / recompute after a confirm; the explicit
// 'Pending Confirmation' state is stamped by recordExportReceipt (it can't be
// derived from the order alone — it lives on the pending payments row).
// Values mirror the CHECK in migration 276 + the client's Financial Status list.
function deriveFinancialStatus(order) {
  const expected = settledAmount(order.advance_expected);
  const received = settledAmount(order.advance_received);
  if (expected <= 0) return 'Not Required';
  if (received >= expected) return 'Confirmed';
  if (received > 0) return 'Partially Confirmed';
  return 'Advance Not Entered';
}

module.exports = {
  STATUS_TRANSITIONS,
  STATUS_STEP,
  MONEY_EPSILON,
  BALANCE_COLLECTION_STATUSES,
  BALANCE_OUTSTANDING_SQL,
  settledAmount,
  getAllowedTransitions,
  getAllowedActions,
  getStepForStatus,
  canTransition,
  transitionOrder,
  deriveFinancialStatus,
  deriveBalanceStatus,
  advanceConfirmed,
  readyToShipProblems,
  closeProblems,
  draftSubmitProblems,
  submitTargetFor,
  DOC_TYPE_ALIASES,
  REQUIRED_DOCS,
  PRE_SHIPMENT_DOCS,
  POST_SHIPMENT_DOCS,
  requiredDocsApproved,
  preShipmentDocsApproved,
  maybePromoteAfterDocuments,
  maybePromoteAfterAdvance,
  maybePromoteAfterBalance,
};
