/**
 * Local Sales Controller — Sell inventory in the domestic market (PKR).
 */

const db = require('../../config/database');
const uc = require('../../services/unitConversion');
const inventoryService = require('../../services/inventoryService');
const { freedKattaFrom } = require('./freedKatta');
const accountingService = require('../accounting/accounting.service');
const { resolveCashAccountId } = require('../../shared/cashAccounts');
const { nextDocNo } = require('../../utils/docNumber');
const { isPartyMasked } = require('../../shared/partyMask');
const { isMillOnlyPayer, assertMillEntity, assertMillReceipt } = require('../../shared/millPayer');
const { inventoryAccountForLot } = require('./inventoryAccount');
const { postLocalReceiptJournal } = require('./receiptJournal');
const { assertAccountCurrency } = require('../../shared/accountCurrency');
const { resolveLineCost, priceSaleLine, salePaymentStatus } = require('./salePricing');
const { buildRateIndex, rateForLot } = require('../inventory/stockValuation');

async function generateSaleNo(trx) {
  return nextDocNo(trx || db, { table: 'local_sales', column: 'sale_no', prefix: 'LS-' });
}

const BANK_METHODS = ['bank_transfer', 'online', 'lc', 'tt', 'wire', 'mobile'];

// Which account a receipt lands in: cash → the cash-type account; bank transfer
// → the chosen bank account; cheque (uncleared) / credit (unpaid) → none.
async function resolveReceiptAccountId(trx, { paymentMode, bankAccountId, amount, collectionLocation }) {
  if (!(amount > 0)) return null;
  // Every non-cash method that moves money now (bank transfer, online, LC, TT,
  // wire, mobile) lands in the account picked for it. Only bank_transfer used
  // to: an 'online' receipt moved no account yet still posted Dr 1000.
  if (BANK_METHODS.includes(paymentMode)) return bankAccountId || null;
  if (paymentMode === 'cash') {
    // Local sales are mill sales — cash collected lands in the Mill's cash float
    // (Mill Cash) unless it was explicitly collected at Head Office.
    return resolveCashAccountId(trx, { entity: 'mill', collectionLocation: collectionLocation || null });
  }
  return null;
}

// A cheque never counts as money until it clears (owner decision 2026-10-07),
// whatever its date — so every cheque receipt is recorded uncleared.
function isChequeMode(mode) { return String(mode || '').toLowerCase() === 'cheque'; }

// Uncleared cheques already taken against these sale lines, by line id. They
// do not reduce due_amount until they clear, so a new receipt must leave room
// for them or the sale is collected twice once they do.
async function unclearedChequesBySale(trx, saleIds) {
  const out = new Map();
  if (!saleIds || !saleIds.length) return out;
  const rows = await trx('payments')
    .whereIn('local_sale_id', saleIds)
    .where({ payment_method: 'cheque', cleared: false })
    .whereNotIn('status', ['Reversed', 'Rejected'])
    .select('local_sale_id', 'amount');
  for (const r of rows || []) out.set(r.local_sale_id, uc.round2((out.get(r.local_sale_id) || 0) + (parseFloat(r.amount) || 0)));
  return out;
}

// Move a receiving account's balance by the amount received and drop a Cash &
// Bank sub-ledger row (linked to the payment so a delete can reverse it).
async function postReceiptToAccount(trx, { accountId, amount, paymentId, reference, notes, date, userId }) {
  if (!accountId || !(amount > 0)) return;
  // A PKR receipt: a non-PKR (e.g. USD) account must not be moved by a rupee figure.
  assertAccountCurrency(await trx('bank_accounts').where({ id: accountId }).first(), 'PKR');
  await trx('bank_accounts').where({ id: accountId }).increment('current_balance', amount);
  // Collision-safe BT- number (MAX trailing-digit + 1) — the hand-rolled
  // orderBy-id-desc + parse could regenerate an existing number under concurrent
  // receipts and collide on the unique transaction_no.
  const btNo = await nextDocNo(trx, { table: 'bank_transactions', column: 'transaction_no', prefix: 'BT-', pad: 4 });
  await trx('bank_transactions').insert({
    transaction_no: btNo, bank_account_id: accountId,
    type: 'credit', amount, currency: 'PKR', status: 'posted',
    transaction_date: date || new Date(), reference: reference || null,
    notes: notes || null, source: 'local_sale', linked_payment_id: paymentId, created_by: userId || null,
  });
}

// Batch 6 · item 9 — only a Mill Manager or Owner (or Super Admin) may release a
// sale's stock/money. A sale RECORDED by one of them auto-confirms; anyone else's
// sits Pending until confirmed.
const CONFIRM_ROLES = ['Super Admin', 'Owner', 'Mill Manager'];
async function recorderCanAutoConfirm(trx, roleId) {
  if (!roleId) return false;
  const r = await trx('roles').where('id', roleId).first('name');
  return !!r && CONFIRM_ROLES.includes(r.name);
}

// The money/stock side of a local sale, run on already-inserted sale rows. Shared
// by create() (auto-confirm path) and confirmSale() (deferred path) so the two
// stay byte-identical: draw the lot/mill-stock down, record the receipt (moving
// the cash/bank balance), open a receivable for any balance owed, lock COGS and
// post the revenue/AR journal. Re-checks availability — a Pending sale can't
// oversell if the stock moved while it waited for confirmation.
// Repacking a sale tips the rice out of the katta it was held in. Those empties
// go back to the mill store as KATTA-<size>, at zero value — they are worth
// something only when sold. A sale that is NOT repacked frees nothing: the rice
// ships in its original sacks and they leave with it. And a buyer can ask to
// keep the empties, which is what freed_katta_to_store: false records.
//
// Credited on confirmation, not on entry, because a pending sale that is
// rejected must not leave sacks behind. Idempotent per sale.
async function returnRepackedKatta(trx, saleRows, userId) {
  const first = saleRows && saleRows[0];
  if (!first) return;
  const rp = first.sale_group_no
    ? await trx('local_sale_repacking').where({ sale_group_no: first.sale_group_no }).first()
    : await trx('local_sale_repacking').where({ local_sale_id: first.id }).first();
  const freed = freedKattaFrom(rp);
  if (!freed) return;

  const credited = await inventoryService.creditFreedKatta(trx, {
    sizeKg: freed.sizeKg,
    count: freed.count,
    referenceType: 'sale_repack_katta',
    referenceId: rp.id,
    userId,
    notes: `Empty ${freed.sizeKg}kg katta freed by repacking sale ${first.sale_group_no || first.id}`,
  });
  if (credited) {
    await trx('local_sale_repacking').where({ id: rp.id })
      .update({ freed_katta_count: credited.bags, freed_katta_size_kg: credited.sizeKg, updated_at: trx.fn.now() });
  }
}

async function postSaleSideEffects(trx, saleRows, { userId } = {}) {
  await returnRepackedKatta(trx, saleRows, userId);
  const groupPaid = uc.round2(saleRows.reduce((s, r) => s + (parseFloat(r.paid_amount) || 0), 0));
  const first = saleRows[0] || {};
  const receiptAccountId = await resolveReceiptAccountId(trx, {
    paymentMode: first.payment_mode, bankAccountId: first.bank_account_id, amount: groupPaid, collectionLocation: first.collection_location,
  });

  for (const sale of saleRows) {
    const qtyKg = parseFloat(sale.quantity_kg) || 0;
    // A cheque taken at the time of sale is not money until it clears — not
    // even a same-day one. It is recorded as an UNCLEARED payment below and the
    // sale stays Credit with its whole total owed; Clear Cheque (Due Dates)
    // settles the sale, moves the bank and posts the receipt journal then.
    const tendered = parseFloat(sale.paid_amount) || 0;
    const chequeAmt = isChequeMode(sale.payment_mode) ? tendered : 0;
    const paid = chequeAmt > 0 ? 0 : tendered;
    let dueAmt = parseFloat(sale.due_amount) || 0;
    if (chequeAmt > 0) {
      dueAmt = uc.round2(parseFloat(sale.total_amount) || 0);
      const patch = { paid_amount: 0, due_amount: dueAmt, payment_status: salePaymentStatus({ due: dueAmt, paid: 0, paymentMode: sale.payment_mode }) };
      await trx('local_sales').where({ id: sale.id }).update({ ...patch, updated_at: trx.fn.now() });
      Object.assign(sale, patch);
    }

    if (sale.mill_item_id) {
      const count = parseFloat(sale.quantity_bags) || qtyKg;
      const mi = await trx('mill_items').where({ id: sale.mill_item_id }).first();
      if (!mi) throw new Error('Packaging item not found');
      const ms = await trx('mill_stock').where({ item_id: sale.mill_item_id, warehouse_id: null }).first();
      const avail = parseFloat(ms && ms.quantity_available) || 0;
      if (count > avail + 0.01) { const e = new Error(`Insufficient ${mi.name}: ${Math.round(avail)} in stock, ${count} needed.`); e.status = 400; throw e; }
      await trx('mill_stock').where({ id: ms.id }).update({ quantity_available: trx.raw('GREATEST(quantity_available - ?, 0)', [count]), updated_at: trx.fn.now() });
      await trx('mill_stock_movements').insert({
        item_id: sale.mill_item_id, warehouse_id: null, movement_type: 'consumption', quantity: -count,
        reference_type: 'local_sale', reference_id: sale.id, reason: `Sold ${count} ${mi.unit || 'pcs'} — ${sale.sale_no}`, performed_by: userId || null,
      });
    } else if (sale.lot_id) {
      const lot = await trx('inventory_lots').where({ id: sale.lot_id }).first();
      if (!lot) throw new Error('Inventory lot not found');
      const availKg = parseFloat(lot.available_qty) || 0;
      if (qtyKg > availKg + 0.01) { const e = new Error(`Insufficient stock: ${sale.item_name} needs ${Math.round(qtyKg)} kg but only ${availKg.toFixed(0)} kg available in ${lot.lot_no}`); e.status = 400; throw e; }
      await inventoryService.postMovement(trx, {
        movementType: 'local_sale', lotId: lot.id, qty: qtyKg,
        fromWarehouseId: lot.warehouse_id, sourceEntity: lot.entity, linkedRef: sale.sale_no,
        notes: `Local sale ${sale.sale_no} to ${sale.buyer_name || 'customer'}${sale.gate_pass_no ? ` · Gate Pass ${sale.gate_pass_no}` : ''}`,
        costPerUnit: parseFloat(lot.cost_per_unit) || 0, currency: 'PKR', userId,
      });
      await trx('inventory_lots').where({ id: sale.lot_id }).update({ sold_weight_kg: (parseFloat(lot.sold_weight_kg) || 0) + qtyKg });

      // Post COGS to the GL so the P&L reflects real cost of goods sold + gross
      // profit, and inventory is relieved when stock leaves. Dr 5000 COGS /
      // Cr the lot's inventory account — raw 1210, finished mill 1220 / export
      // 1230, by-product 1240. Without this the sale only posted revenue → P&L
      // showed 100% margin.
      const cogsAmt = uc.round2(parseFloat(sale.landed_cost_total) || (parseFloat(sale.cost_per_kg) || 0) * qtyKg);
      if (cogsAmt > 0) {
        const invCode = inventoryAccountForLot(lot);
        const [cogsAcc, invAcc] = await Promise.all([
          trx('chart_of_accounts').where({ code: '5000' }).first(),
          trx('chart_of_accounts').where({ code: invCode }).first(),
        ]);
        if (cogsAcc && invAcc) {
          const j = await accountingService.createJournal(trx, {
            date: (sale.sale_date ? new Date(sale.sale_date) : new Date()).toISOString().slice(0, 10),
            entity: 'mill', refType: 'Local Sale COGS', refNo: sale.sale_no,
            description: `COGS — local sale ${sale.sale_no} — ${sale.item_name}`.slice(0, 240),
            currency: 'PKR', fxRate: 1, isAuto: true, userId,
            lines: [
              { account_id: cogsAcc.id, account: cogsAcc.name, debit: cogsAmt, credit: 0, narration: `DR ${cogsAcc.code} ${cogsAcc.name} — ${sale.sale_no}` },
              { account_id: invAcc.id, account: invAcc.name, debit: 0, credit: cogsAmt, narration: `CR ${invAcc.code} ${invAcc.name} — ${sale.sale_no}` },
            ],
          });
          if (j?.id) await accountingService.postJournal(trx, j.id);
        }
      }
    }

    if (chequeAmt > 0) {
      const paymentNo = await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'PL-', pad: 0 });
      await trx('payments').insert({
        payment_no: paymentNo, type: 'receipt',
        amount: chequeAmt, currency: 'PKR', fx_rate: 1, base_amount_pkr: chequeAmt,
        payment_method: 'cheque', bank_reference: sale.payment_reference || null,
        bank_account_id: sale.bank_account_id || null,
        // The cheque date; without one it is due the day of the sale. Due Dates
        // lists only cheques that carry a date, so it always gets one.
        due_date: sale.due_date || sale.sale_date || new Date().toISOString().split('T')[0],
        cleared: false,
        payment_date: sale.sale_date || trx.fn.now(), notes: `Cheque for local sale ${sale.sale_no} — ${sale.item_name} (settles when cleared)`,
        local_sale_id: sale.id, created_by: userId || null,
      }).returning('id');
      // No bank move, no Dr 1000 / Cr 1120 — both happen on Clear Cheque.
    }

    if (paid > 0) {
      const payMethod = (sale.payment_mode && sale.payment_mode !== 'credit') ? sale.payment_mode : 'cash';
      const paymentNo = await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'PL-', pad: 0 });
      const [payRow] = await trx('payments').insert({
        payment_no: paymentNo, type: 'receipt',
        amount: paid, currency: 'PKR', fx_rate: 1, base_amount_pkr: paid,
        payment_method: payMethod, bank_reference: sale.payment_reference || null,
        bank_account_id: receiptAccountId || sale.bank_account_id || null, due_date: sale.due_date || null,
        payment_date: sale.sale_date || trx.fn.now(), notes: `Local sale ${sale.sale_no} — ${sale.item_name}`,
        local_sale_id: sale.id, created_by: userId || null,
      }).returning('id');
      await postReceiptToAccount(trx, {
        accountId: receiptAccountId, amount: paid, paymentId: payRow.id,
        reference: sale.payment_reference || sale.sale_no, notes: `Local sale ${sale.sale_no} receipt — ${sale.item_name}`,
        date: sale.sale_date, userId,
      });
      // Clear the receivable this sale just raised: Dr 1000 / Cr 1120.
      await postLocalReceiptJournal(trx, { paymentNo, amount: paid, sale, date: sale.sale_date, userId, bankAccountId: receiptAccountId || sale.bank_account_id || null });
    }

    if (dueAmt > 0) {
      await trx('receivables').insert({
        recv_no: await nextDocNo(trx, { table: 'receivables', column: 'recv_no', prefix: 'RCV-LS-', pad: 0 }), entity: 'mill',
        customer_id: sale.customer_id, local_sale_id: sale.id, type: 'Local Sale',
        expected_amount: sale.total_amount, received_amount: paid, outstanding: dueAmt,
        due_date: sale.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: paid > 0 ? 'Partial' : 'Pending', currency: 'PKR', aging: 0,
        notes: `Local sale ${sale.sale_no} — ${sale.buyer_name || 'walk-in'} — ${sale.item_name}${sale.gate_pass_no ? ` · Gate Pass ${sale.gate_pass_no}` : ''}`,
      });
    }

    if (sale.id && sale.lot_id) await inventoryService.lockSaleCOGS(trx, sale.id);

    await accountingService.autoPost(trx, {
      triggerEvent: 'local_sale_recorded', entity: 'mill', amount: sale.total_amount, currency: 'PKR',
      refType: 'Local Sale', refNo: sale.sale_no,
      description: `Local sale ${sale.sale_no} — ${sale.buyer_name || 'walk-in'} — ${sale.item_name}`.slice(0, 240),
      userId,
    });
  }
}

// Assemble the Invoice 360 payload for one local sale (the sale row IS the
// invoice). `includeAdmin` adds internal financials (COGS/margin/remaining
// stock) + linked records — callers MUST gate that on role. Returns null if
// the sale is not found. Read-only; no create/stock/payment side effects.
async function assembleInvoice(id, includeAdmin = false) {
  const num = (v) => parseFloat(v) || 0;
  const isNumeric = /^\d+$/.test(String(id));

  const base = await db('local_sales as ls')
    .leftJoin('customers as c', 'ls.customer_id', 'c.id')
    .leftJoin('users as u', 'u.id', 'ls.created_by')
    .where(isNumeric ? { 'ls.id': parseInt(id, 10) } : { 'ls.sale_no': id })
    .select('ls.*', 'c.name as customer_name', 'c.phone as customer_phone',
      'c.address as customer_address', 'c.contact_person as customer_contact', 'c.email as customer_email',
      'u.full_name as created_by_name')
    .first();
  if (!base) return null;

  const itemQuery = db('local_sales as ls')
    .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
    .leftJoin('warehouses as w', 'il.warehouse_id', 'w.id');
  if (base.sale_group_no) itemQuery.where('ls.sale_group_no', base.sale_group_no);
  else itemQuery.where('ls.id', base.id);
  const rows = await itemQuery.select(
    'ls.id', 'ls.sale_no', 'ls.item_name', 'ls.item_type', 'ls.quantity_kg', 'ls.quantity_bags',
    'ls.bag_weight_kg', 'ls.rate_per_kg', 'ls.rate_input', 'ls.rate_unit', 'ls.quantity_unit',
    'ls.total_amount', 'ls.paid_amount', 'ls.due_amount', 'ls.lot_id', 'ls.lot_no',
    // admin-only financial columns (selected always, exposed only when includeAdmin)
    'ls.cost_per_kg', 'ls.landed_cost_total', 'ls.cogs_total_pkr', 'ls.gross_profit', 'ls.margin_pct',
    'il.lot_no as lot_ref', 'il.type as lot_type', 'il.variety as lot_variety',
    'il.grade as lot_grade', 'il.item_name as lot_item_name', 'il.warehouse_id', 'il.batch_ref',
    'il.processing_type', 'il.available_qty as lot_available_qty', 'il.net_weight_kg as lot_net_weight_kg',
    'w.name as warehouse_name',
  ).orderBy('ls.id', 'asc');

  // Resolve source batches + their source purchased rice lots for milled output.
  const batchIds = [...new Set(rows
    .map(r => (r.batch_ref ? parseInt(String(r.batch_ref).replace(/^batch-/, ''), 10) : null))
    .filter(Boolean))];
  const batchById = {}; const srcByBatch = {};
  if (batchIds.length) {
    const batches = await db('milling_batches').whereIn('id', batchIds).select('id', 'batch_no', 'batch_name');
    for (const b of batches) batchById[b.id] = b;
    const srcs = await db('batch_source_lots as bsl')
      .leftJoin('inventory_lots as src', 'bsl.lot_id', 'src.id')
      .leftJoin('suppliers as s', 'src.supplier_id', 's.id')
      .whereIn('bsl.batch_id', batchIds)
      .select('bsl.batch_id', 'bsl.qty_kg', 'src.id as lot_id', 'src.lot_no',
        db.raw("COALESCE(s.name, '—') as supplier"));
    for (const s of srcs) (srcByBatch[s.batch_id] = srcByBatch[s.batch_id] || []).push({
      lotId: s.lot_id, lotNo: s.lot_no, supplier: s.supplier, qtyMt: num(s.qty_kg),
      href: s.lot_id ? `/lot-inventory/${s.lot_id}` : null,
    });
  }

  const items = rows.map(r => {
    const batchId = r.batch_ref ? parseInt(String(r.batch_ref).replace(/^batch-/, ''), 10) : null;
    const b = batchId ? batchById[batchId] : null;
    const item = {
      id: r.id, saleNo: r.sale_no,
      riceType: r.lot_variety || r.lot_item_name || r.item_name || '—',
      gradeProduct: r.item_name || r.lot_grade || '—',
      itemType: r.item_type || null,
      quantityKg: num(r.quantity_kg), quantityMt: num(r.quantity_kg) / 1000,
      unit: r.quantity_unit || 'kg', bags: r.quantity_bags != null ? Number(r.quantity_bags) : null,
      bagWeightKg: num(r.bag_weight_kg) || null,
      ratePerKg: num(r.rate_per_kg), rateInput: num(r.rate_input), rateUnit: r.rate_unit || 'kg',
      amount: num(r.total_amount),
      lotId: r.lot_id, lotNo: r.lot_no || r.lot_ref || null,
      lotType: r.lot_type || null, warehouse: r.warehouse_name || null,
      isBlend: r.processing_type === 'blended',
      batchId: b ? b.id : null, batchNo: b ? b.batch_no : null, batchName: b ? (b.batch_name || null) : null,
      batchHref: b ? `/milling/${b.id}` : null,
      finishedGoodsHref: r.lot_id ? `/lot-inventory/${r.lot_id}` : null,
      sourceLots: batchId ? (srcByBatch[batchId] || []) : [],
    };
    if (includeAdmin) {
      const cogs = num(r.cogs_total_pkr) || num(r.landed_cost_total) || num(r.cost_per_kg) * num(r.quantity_kg);
      item.costPerKg = num(r.cost_per_kg);
      item.cogs = cogs;
      item.grossMargin = num(r.total_amount) - cogs;
      item.marginPct = num(r.total_amount) > 0 ? ((num(r.total_amount) - cogs) / num(r.total_amount)) * 100 : 0;
      item.remainingStockKg = num(r.lot_net_weight_kg) || num(r.lot_available_qty);
    }
    return item;
  });

  // Intake (purchase) vehicles — the trucks each item's source rice lot(s)
  // arrived on (milling_vehicle_arrivals, scoped by lot or batch). Surfaced for
  // traceability alongside the outbound sale/dispatch vehicle.
  const arrLotIds = new Set(); const arrBatchIds = new Set();
  for (const it of items) {
    if (it.lotId) arrLotIds.add(it.lotId);
    if (it.batchId) arrBatchIds.add(it.batchId);
    for (const sl of (it.sourceLots || [])) if (sl.lotId) arrLotIds.add(sl.lotId);
  }
  let arrivals = [];
  if (arrLotIds.size || arrBatchIds.size) {
    arrivals = await db('milling_vehicle_arrivals')
      .where(function () {
        if (arrLotIds.size) this.whereIn('lot_id', [...arrLotIds]);
        if (arrBatchIds.size) this.orWhereIn('batch_id', [...arrBatchIds]);
      })
      .select('id', 'lot_id', 'batch_id', 'vehicle_no', 'driver_name', 'driver_phone', 'weight_kg', 'total_bags', 'arrival_date');
  }
  const fmtVeh = (a) => ({ vehicleNo: a.vehicle_no, driverName: a.driver_name || null, driverPhone: a.driver_phone || null, weightKg: num(a.weight_kg), totalBags: a.total_bags || null, arrivalDate: a.arrival_date || null });
  for (const it of items) {
    const srcIds = new Set((it.sourceLots || []).map(s => s.lotId).filter(Boolean));
    if (it.lotId) srcIds.add(it.lotId);
    const seen = new Set();
    it.intakeVehicles = arrivals
      .filter(a => (a.lot_id && srcIds.has(a.lot_id)) || (it.batchId && a.batch_id === it.batchId))
      .filter(a => { const k = a.vehicle_no || a.id; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(fmtVeh);
  }
  const aggSeen = new Set(); const intakeVehicles = [];
  for (const it of items) for (const v of it.intakeVehicles) { if (v.vehicleNo && !aggSeen.has(v.vehicleNo)) { aggSeen.add(v.vehicleNo); intakeVehicles.push(v); } }

  // Payment timeline with running balance.
  const itemIds = rows.map(r => r.id);
  let pays = await db('payments').whereIn('local_sale_id', itemIds.length ? itemIds : [base.id])
    .select('id', 'payment_no', 'payment_date', 'payment_method', 'amount', 'bank_reference', 'cleared', 'notes')
    .orderBy('payment_date', 'asc').orderBy('id', 'asc');
  if (pays.length === 0 && base.sale_no) {
    pays = await db('payments').where('notes', 'ilike', `%${base.sale_no}%`)
      .select('id', 'payment_no', 'payment_date', 'payment_method', 'amount', 'bank_reference', 'cleared', 'notes')
      .orderBy('payment_date', 'asc').orderBy('id', 'asc');
  }

  const grandTotal = items.reduce((s, i) => s + i.amount, 0);
  // Received / outstanding must sum across ALL group lines — `base` is only the
  // first line, so a multi-item invoice was showing the group total against just
  // the first line's paid/due (customer-facing wrong money). rows is group-scoped.
  const groupReceived = rows.reduce((s, r) => s + num(r.paid_amount), 0);
  const groupOutstanding = rows.reduce((s, r) => s + num(r.due_amount), 0);
  const timeline = [{ kind: 'created', date: base.sale_date || base.created_at, label: 'Invoice created', amount: grandTotal, balance: grandTotal }];
  let bal = grandTotal;
  for (const p of pays) {
    bal = Math.max(0, bal - num(p.amount));
    timeline.push({
      kind: 'payment', date: p.payment_date, paymentNo: p.payment_no,
      mode: p.payment_method, reference: p.bank_reference || null,
      cleared: p.cleared !== false, amount: num(p.amount), balance: bal,
    });
  }

  const outstanding = groupOutstanding;
  const today = new Date().toISOString().slice(0, 10);
  const dueIso = base.due_date ? new Date(base.due_date).toISOString().slice(0, 10) : null;
  const overdue = outstanding > 0.01 && !!dueIso && dueIso < today;

  const data = {
    sale: {
      id: base.id, invoiceNo: base.sale_no, saleGroupNo: base.sale_group_no,
      customerId: base.customer_id || null,
      customer: base.customer_name || base.buyer_name || 'Walk-in customer',
      customerPhone: base.customer_phone || base.buyer_phone || null,
      customerEmail: base.customer_email || null,
      customerAddress: base.customer_address || base.buyer_address || null,
      customerContact: base.customer_contact || null,
      date: base.sale_date || base.created_at,
      paymentStatus: base.payment_status, paymentMode: base.payment_mode,
      total: grandTotal, received: groupReceived, outstanding,
      dueDate: base.due_date || null, overdue,
      createdByName: base.created_by_name || null, notes: base.notes || null,
      gatePassNo: base.gate_pass_no || null,
      status: base.status || null,
    },
    items,
    payments: timeline,
    dispatch: {
      dispatched: !!base.dispatched,
      awaitingConfirmation: base.status === 'Pending',
      deliveryStatus: base.status === 'Pending'
        ? 'Not yet dispatched — awaiting confirmation'
        : (base.dispatched ? 'Dispatched' : 'Not dispatched'),
      dispatchDate: base.dispatch_date || null,
      vehicleNo: base.vehicle_no || null, driverName: base.driver_name || null,
      collectionLocation: base.collection_location || null,
      intakeVehicles, // trucks the source rice lot(s) were purchased/received on
    },
    totals: {
      quantityKg: items.reduce((s, i) => s + i.quantityKg, 0),
      bags: items.reduce((s, i) => s + (i.bags || 0), 0),
      total: grandTotal, received: groupReceived, outstanding,
    },
  };

  // #5 Repacking summary for the sale group (bag source / bag change / labour /
  // packing loss). The packaging + labour amounts already appear as line items;
  // this block adds the who-supplied-bags note + the packing details.
  const rp = base.sale_group_no
    ? await db('local_sale_repacking').where({ sale_group_no: base.sale_group_no }).first()
    : await db('local_sale_repacking').where({ local_sale_id: base.id }).first();
  if (rp) {
    data.repacking = {
      bagSource: rp.bag_source,
      bagSourceLabel: rp.bag_source === 'customer' ? 'Customer-provided bags'
        : rp.bag_source === 'company' ? 'Company inventory bags' : 'No bag change',
      originalBagSizeKg: num(rp.original_bag_size_kg), originalBagCount: rp.original_bag_count != null ? Number(rp.original_bag_count) : null,
      newBagSizeKg: num(rp.new_bag_size_kg), newBagCount: rp.new_bag_count != null ? Number(rp.new_bag_count) : null,
      packagingCharge: num(rp.packaging_charge), labourMode: rp.labour_mode, labourTotal: num(rp.labour_total),
      packingLossKg: num(rp.packing_loss_kg), finalDispatchedKg: num(rp.final_dispatched_kg),
      notes: rp.notes || null,
    };
  }

  if (includeAdmin) {
    const saleNos = [...new Set(rows.map(r => r.sale_no).filter(Boolean))];
    const cogsTotal = items.reduce((s, i) => s + (i.cogs || 0), 0);
    const [receivables, lotTxns] = await Promise.all([
      db('receivables').whereIn('local_sale_id', itemIds.length ? itemIds : [base.id])
        .select('recv_no', 'type', 'expected_amount', 'received_amount', 'outstanding', 'status', 'due_date'),
      saleNos.length ? db('lot_transactions').whereIn('reference_no', saleNos)
        .select('transaction_no', 'transaction_type', 'quantity_kg', 'balance_kg', 'transaction_date')
        .orderBy('transaction_date', 'asc') : [],
    ]);
    data.financials = {
      salesAmount: grandTotal, cogsTotal,
      grossMargin: grandTotal - cogsTotal,
      marginPct: grandTotal > 0 ? ((grandTotal - cogsTotal) / grandTotal) * 100 : 0,
    };
    data.linked = {
      receivables: receivables.map(r => ({ recvNo: r.recv_no, type: r.type, expected: num(r.expected_amount), received: num(r.received_amount), outstanding: num(r.outstanding), status: r.status, dueDate: r.due_date })),
      lotTransactions: lotTxns.map(t => ({ txnNo: t.transaction_no, type: t.transaction_type, qtyKg: num(t.quantity_kg), balanceKg: num(t.balance_kg), date: t.transaction_date })),
    };

    // Source-batch by-product pricing (INTERNAL/ADMIN ONLY — never on the
    // customer copy): for each milling batch that produced the sold rice, the
    // per-grade output valuation set at yield (same basis as Batch 360).
    if (batchIds.length) {
      const priceBatches = await db('milling_batches').whereIn('id', batchIds)
        .select('id', 'batch_no', 'finished_price_per_kg', 'b1_price_per_kg', 'b2_price_per_kg', 'b3_price_per_kg',
          'csr_price_per_kg', 'short_grain_price_per_kg', 'broken_price_per_kg', 'powder_price_per_kg',
          'sweeping_price_per_kg', 'choba_price_per_kg', 'sortex_rejects_price_per_kg');
      const priceById = {}; for (const b of priceBatches) priceById[b.id] = b;
      const outRefs = batchIds.map(bid => `batch-${bid}`);
      const outLots = await db('inventory_lots as l').leftJoin('warehouses as w', 'l.warehouse_id', 'w.id')
        .whereIn('l.batch_ref', outRefs).whereIn('l.type', ['finished', 'byproduct'])
        .select('l.id', 'l.lot_no', 'l.batch_ref', 'l.type', 'l.item_name', 'l.grade', 'l.variety',
          'l.net_weight_kg', 'l.received_net_weight_kg', 'l.landed_cost_per_kg', 'w.name as warehouse_name');
      const priceForOutput = (o, b) => {
        const g = String(o.grade || '').toUpperCase();
        const n = String(o.item_name || '').toLowerCase();
        let perMt = 0;
        if (o.type === 'finished') perMt = num(b.finished_price_per_kg);
        else if (g === 'B1') perMt = num(b.b1_price_per_kg);
        else if (g === 'B2') perMt = num(b.b2_price_per_kg);
        else if (g === 'B3') perMt = num(b.b3_price_per_kg);
        else if (g === 'CSR') perMt = num(b.csr_price_per_kg);
        else if (g === 'SHORT GRAIN') perMt = num(b.short_grain_price_per_kg);
        else if (n.includes('powder')) perMt = num(b.powder_price_per_kg);
        else if (n.includes('sweep')) perMt = num(b.sweeping_price_per_kg);
            else if (n.includes('choba')) perMt = num(b.choba_price_per_kg);
        else if (n.includes('sortex')) perMt = num(b.sortex_rejects_price_per_kg);
        else if (n.includes('broken')) perMt = num(b.broken_price_per_kg);
        return perMt;
      };
      const byBatch = {};
      for (const o of outLots) {
        const bid = parseInt(String(o.batch_ref).replace(/^batch-/, ''), 10);
        const b = priceById[bid] || {};
        const produced = num(o.received_net_weight_kg) || num(o.net_weight_kg);
        const salePerKg = priceForOutput(o, b);
        (byBatch[bid] = byBatch[bid] || []).push({
          lotId: o.id, lotNo: o.lot_no, type: o.type,
          productGrade: o.grade || o.item_name || '—', riceType: o.variety || o.item_name || '—',
          producedKg: produced, costPerKg: num(o.landed_cost_per_kg),
          salePricePerKg: salePerKg, recoveryValue: produced * salePerKg,
          warehouse: o.warehouse_name || null, href: `/lot-inventory/${o.id}`,
        });
      }
      data.batchByproducts = batchIds.map(bid => ({
        batchId: bid, batchNo: (batchById[bid] || {}).batch_no || `#${bid}`, batchName: (batchById[bid] || {}).batch_name || null, batchHref: `/milling/${bid}`,
        outputs: (byBatch[bid] || []).sort((a, c) => (a.type === 'byproduct' ? 0 : 1) - (c.type === 'byproduct' ? 0 : 1)),
        byproductRecovery: (byBatch[bid] || []).filter(o => o.type === 'byproduct').reduce((s, o) => s + o.recoveryValue, 0),
      })).filter(x => x.outputs.length);
    }
  }

  return data;
}

// Server-side customer-invoice HTML for emailing (inline styles, email-safe).
// Mirrors the on-screen customer invoice; NO cost/margin.
function renderInvoiceEmailHtml(data, company = {}) {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pkr = (v) => `Rs ${(parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const d = (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const { sale, items = [], dispatch = {}, totals = {} } = data;
  const coName = company.legal_name || company.name || 'AGRI COMMODITIES';
  const coBits = [company.address, company.phone, company.email].filter(Boolean).map(esc).join(' &middot; ');
  const rows = items.map((it) => `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${esc(it.riceType)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${esc(it.gradeProduct)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${Math.round(it.quantityKg).toLocaleString()} kg</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${it.bags != null ? it.bags : '—'}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${it.ratePerKg > 0 ? pkr(it.ratePerKg) : '—'}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${pkr(it.amount)}</td>
  </tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#111827;max-width:720px">
    <div style="border-bottom:2px solid #111827;padding-bottom:8px;display:flex;justify-content:space-between">
      <div><div style="font-size:18px;font-weight:800">${esc(coName)}</div>${coBits ? `<div style="font-size:11px;color:#6b7280">${coBits}</div>` : ''}${company.ntn ? `<div style="font-size:11px;color:#6b7280">NTN ${esc(company.ntn)}</div>` : ''}</div>
      <div style="text-align:right"><div style="font-size:15px;font-weight:800">SALES INVOICE</div><div style="font-size:12px;color:#374151">${esc(sale.invoiceNo)}</div><div style="font-size:11px;color:#6b7280">${d(sale.date)}</div></div>
    </div>
    <p style="font-size:13px;margin:10px 0 4px">Dear ${esc(sale.customer)},</p>
    <p style="font-size:12px;color:#374151;margin:0 0 10px">Please find your invoice below. Payment status: <b>${esc(sale.paymentStatus)}</b>${sale.dueDate ? ` &middot; Due ${d(sale.dueDate)}` : ''}.</p>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:#f3f4f6">
        <th style="text-align:left;padding:6px 8px">Rice Type</th><th style="text-align:left;padding:6px 8px">Grade / Product</th>
        <th style="text-align:right;padding:6px 8px">Qty</th><th style="text-align:right;padding:6px 8px">Bags</th>
        <th style="text-align:right;padding:6px 8px">Rate</th><th style="text-align:right;padding:6px 8px">Amount</th>
      </tr></thead><tbody>${rows}</tbody></table>
    <table style="margin-left:auto;margin-top:8px;font-size:12px">
      <tr><td style="padding:2px 8px">Total</td><td style="padding:2px 8px;text-align:right;font-weight:700">${pkr(totals.total)}</td></tr>
      <tr><td style="padding:2px 8px">Received</td><td style="padding:2px 8px;text-align:right">${pkr(totals.received)}</td></tr>
      <tr><td style="padding:2px 8px;border-top:1px solid #d1d5db">Outstanding</td><td style="padding:2px 8px;text-align:right;border-top:1px solid #d1d5db;font-weight:700">${pkr(totals.outstanding)}</td></tr>
    </table>
    ${(dispatch.vehicleNo || dispatch.driverName || dispatch.dispatchDate || items[0]?.warehouse) ? `<div style="margin-top:12px;font-size:11px;color:#6b7280"><b>Dispatch:</b> ${[items[0]?.warehouse, dispatch.deliveryStatus, dispatch.vehicleNo ? 'Truck ' + esc(dispatch.vehicleNo) : '', dispatch.driverName, dispatch.dispatchDate ? d(dispatch.dispatchDate) : ''].filter(Boolean).map(esc).join(' &middot; ')}</div>` : ''}
    <p style="font-size:11px;color:#9ca3af;margin-top:14px">Computer-generated sales invoice from ${esc(coName)}.</p>
  </div>`;
}

// ── Receipts ────────────────────────────────────────────────────────────────

// Validate + normalise a receipt body (single-line and group payments share it).
function readReceiptInput(body = {}) {
  const { amount, payment_method = 'cash', payment_date, reference, notes, bank_account_id, due_date, collection_location } = body || {};
  if (!amount || parseFloat(amount) <= 0) return { error: 'A positive amount is required.' };
  // Same guard as create: a bank-transfer receipt must name its account, else
  // the payment records but no bank balance moves.
  if (BANK_METHODS.includes(payment_method) && !bank_account_id) return { error: `A bank account is required for a ${payment_method === 'bank_transfer' ? 'bank-transfer' : String(payment_method).replace(/_/g, ' ')} receipt.` };
  // A cheque — any cheque, same-day included — is recorded but does NOT
  // settle the sale until it is cleared in Due Dates: the sale stays
  // Partial/Credit, no bank moves, no journal. It keeps its cheque date (or the
  // receipt date) so Due Dates lists it.
  const isUncleared = isChequeMode(payment_method);
  const today = new Date().toISOString().split('T')[0];
  return {
    amount: parseFloat(amount), paymentMethod: payment_method, paymentDate: payment_date || null,
    reference: reference || null, notes: notes || null, bankAccountId: bank_account_id || null,
    dueDate: due_date || (isUncleared ? (payment_date || today) : null),
    collectionLocation: collection_location || null, isUncleared,
  };
}

function assertSaleTakesPayment(sale) {
  if (sale.status === 'Completed') return;
  const e = new Error(sale.status === 'Pending'
    ? `${sale.sale_no} has not been confirmed yet — confirm it before taking a payment.`
    : `${sale.sale_no} is ${String(sale.status || '').toLowerCase()} — nothing is owed on it.`);
  e.status = 409; throw e;
}

// Pure. Split one tendered amount across a sale's lines, oldest line (lowest
// id) first: each line is settled in full before the next takes anything.
// Lines with nothing due are skipped. Any sub-paisa remainder within the 0.01
// tolerance the callers allow lands on the last line paid.
function allocateOldestFirst(amount, lines) {
  let left = uc.round2(parseFloat(amount) || 0);
  const out = [];
  for (const sale of [...(lines || [])].sort((a, b) => a.id - b.id)) {
    if (left <= 0.005) break;
    const due = uc.round2(parseFloat(sale.due_amount) || 0);
    if (due <= 0) continue;
    const take = uc.round2(Math.min(due, left));
    out.push({ sale, amount: take });
    left = uc.round2(left - take);
  }
  if (left > 0 && out.length) out[out.length - 1].amount = uc.round2(out[out.length - 1].amount + left);
  return out;
}

// Apply ONE receipt to ONE locked, confirmed sale line inside the caller's
// transaction: the line's paid/due/status, the payments row, the receiving
// account's balance + Cash & Bank sub-ledger row, the Dr 1000 / Cr 1120
// journal and the linked receivable. The single-line Pay and the group Pay
// both come through here, so a receipt is recorded the same way either way.
async function applyReceiptToSale(trx, sale, {
  amount, paymentMethod = 'cash', paymentDate, reference, notes, bankAccountId, dueDate, collectionLocation, isUncleared = false, userId,
}) {
  const payAmount = uc.round2(parseFloat(amount) || 0);
  const newPaid = (parseFloat(sale.paid_amount) || 0) + payAmount;
  const newDue = Math.max(0, (parseFloat(sale.total_amount) || 0) - newPaid);

  if (!isUncleared) {
    await trx('local_sales').where({ id: sale.id }).update({
      paid_amount: uc.round2(newPaid),
      due_amount: uc.round2(newDue),
      payment_status: newDue <= 0.01 ? 'Paid' : 'Partial',
      // Record WHERE this cash/udhaar was collected (Mill / Head Office).
      ...(collectionLocation ? { collection_location: collectionLocation } : {}),
      updated_at: trx.fn.now(),
    });
  }

  // Create payment record (cleared=false for a cheque until it clears).
  const receiptAccountId = isUncleared ? null : await resolveReceiptAccountId(trx, { paymentMode: paymentMethod, bankAccountId, amount: payAmount, collectionLocation });
  const paymentNo = await nextDocNo(trx, { table: 'payments', column: 'payment_no', prefix: 'PL-', pad: 0 });
  const [payRow] = await trx('payments').insert({
    payment_no: paymentNo,
    type: 'receipt',
    amount: payAmount,
    currency: 'PKR',
    fx_rate: 1,
    base_amount_pkr: payAmount,
    payment_method: paymentMethod,
    due_date: dueDate || null,
    cleared: !isUncleared,
    bank_reference: reference || null,
    bank_account_id: receiptAccountId || bankAccountId || null,
    payment_date: paymentDate || trx.fn.now(),
    notes: notes || `Payment for local sale ${sale.sale_no}${collectionLocation && paymentMethod === 'cash' ? ` (collected at ${collectionLocation})` : ''}`,
    local_sale_id: sale.id,
    created_by: userId || null,
  }).returning('id');

  if (!isUncleared) {
    // Cash / bank receipt → move the receiving account's balance.
    await postReceiptToAccount(trx, {
      accountId: receiptAccountId, amount: payAmount, paymentId: payRow.id,
      reference: reference || sale.sale_no, notes: `Payment for local sale ${sale.sale_no}`,
      date: paymentDate, userId,
    });
    // …and into the GL: Dr 1000 Cash & Bank / Cr 1120 Local AR. A cheque
    // journals when it clears (finance clearCheque).
    await postLocalReceiptJournal(trx, { paymentNo, amount: payAmount, sale, date: paymentDate, userId, bankAccountId: receiptAccountId || bankAccountId || null });

    // Update linked receivable — prefer FK, fall back to notes search
    const receivable = await trx('receivables')
      .where('local_sale_id', sale.id)
      .first()
      || await trx('receivables')
        .where('notes', 'ilike', `%${sale.sale_no}%`)
        .first();
    if (receivable) {
      const rcvNewReceived = (parseFloat(receivable.received_amount) || 0) + payAmount;
      const rcvNewOutstanding = Math.max(0, (parseFloat(receivable.expected_amount) || 0) - rcvNewReceived);
      await trx('receivables').where({ id: receivable.id }).update({
        received_amount: uc.round2(rcvNewReceived),
        outstanding: uc.round2(rcvNewOutstanding),
        status: rcvNewOutstanding <= 0 ? 'Paid' : 'Partial',
        updated_at: trx.fn.now(),
      });
    }
  }
  return { paymentNo, paymentId: payRow.id };
}

// ── Sale form inputs ────────────────────────────────────────────────────────

function ymd(d, utc) {
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const m = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const day = utc ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Pure. LS-10: the sale date typed on the form. Absent → { date: null } (the
// caller keeps its old default). Must be a real YYYY-MM-DD and not in the
// future. "Future" carries one day of slack: the form builds the date in the
// user's local time (PKT, UTC+5) and the server may run on UTC, so just after
// midnight the user's today is the server's tomorrow.
function validateSaleDate(input, now = new Date()) {
  if (input == null || String(input).trim() === '') return { date: null };
  const s = String(input).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'Sale date must be a date (YYYY-MM-DD).' };
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { error: `${s} is not a real date.` };
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const latest = [ymd(tomorrow, false), ymd(tomorrow, true)].sort().pop();
  if (s > latest) return { error: 'Sale date cannot be in the future.' };
  return { date: s };
}

// LS-11b: the customer a walk-in CREDIT buyer's balance is tracked against.
// The buyer's identity is their PHONE NUMBER (owner decision 2026-10-07, final):
// a walk-in credit sale must carry one, and it is matched on digits only
// against LOCAL customers. A match is that customer even when the name typed
// today differs — the existing record is kept as it is, nothing is updated.
// No match → a new local customer is created with that phone.
function phoneDigits(phone) { return String(phone || '').replace(/\D/g, ''); }
async function resolveWalkInCustomer(trx, { name, phone, userId }) {
  const nm = String(name || '').trim();
  const digits = phoneDigits(phone);
  if (!digits) {
    const e = new Error('A walk-in credit sale needs the buyer\'s phone number — it is how their balance is tracked.');
    e.status = 400; throw e;
  }
  const existing = await trx('customers')
    .where('customer_type', 'local')
    .whereRaw("regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ?", [digits])
    .orderBy('id', 'asc')
    .first();
  if (existing) return existing;
  const [cust] = await trx('customers').insert({
    name: nm, phone: String(phone).trim(), payment_terms: 'Credit', currency: 'PKR',
    customer_type: 'local', is_active: true, approval_status: 'pending',
    submitted_by: userId || null, submitted_at: trx.fn.now(),
  }).returning('*');
  return cust;
}

// Pure. Why a gate pass may not be issued for this sale, or null if it may.
function gatePassRefusal(sale) {
  const ref = (sale && (sale.saleGroupNo || sale.invoiceNo)) || 'This sale';
  if (sale && sale.status === 'Pending') {
    return { code: 'AWAITING_CONFIRMATION', message: `Awaiting manager confirmation — ${ref} has not been confirmed by a Mill Manager or Owner, so the goods may not leave and no gate pass can be issued yet.` };
  }
  if (sale && sale.status === 'Cancelled') {
    return { code: 'SALE_REJECTED', message: `${ref} was rejected — there is nothing to release.` };
  }
  return null;
}

// LS-12: the gate pass number already on another (non-rejected) sale, if any.
async function findGatePassConflict(trx, gatePassNo, excludeGroupNo = null) {
  if (!gatePassNo) return null;
  let q = trx('local_sales')
    .where('gate_pass_no', gatePassNo)
    .whereNot('status', 'Cancelled');
  if (excludeGroupNo) q = q.whereNot('sale_group_no', excludeGroupNo);
  return q.orderBy('id', 'asc').first('id', 'sale_no', 'sale_group_no', 'buyer_name', 'sale_date');
}

function gatePassConflictBody(gatePassNo, conflict) {
  const ref = conflict.sale_group_no || conflict.sale_no;
  return {
    success: false,
    code: 'GATE_PASS_DUPLICATE',
    message: `Gate Pass ${gatePassNo} is already on sale ${ref}${conflict.buyer_name ? ` (${conflict.buyer_name})` : ''}.`,
    conflict: { id: conflict.id, sale_no: conflict.sale_no, sale_group_no: ref, buyer_name: conflict.buyer_name || null, sale_date: conflict.sale_date || null },
  };
}

module.exports = {

  // List all local sales
  async list(req, res) {
    try {
      const { page = 1, limit = 50, status, lot_id, customer_id, from_date, to_date, search } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'u.full_name as created_by_name'
        );

      if (status && status !== 'all') query = query.where('ls.status', status);
      if (lot_id) query = query.where('ls.lot_id', lot_id);
      if (customer_id) query = query.where('ls.customer_id', customer_id);
      if (from_date) query = query.where('ls.sale_date', '>=', from_date);
      if (to_date) query = query.where('ls.sale_date', '<=', to_date);
      if (search) {
        query = query.where(function () {
          this.where('ls.sale_no', 'ilike', `%${search}%`)
            .orWhere('ls.item_name', 'ilike', `%${search}%`)
            .orWhere('ls.buyer_name', 'ilike', `%${search}%`)
            .orWhere('ls.gate_pass_no', 'ilike', `%${search}%`) // #6 searchable by gate pass
            .orWhere('c.name', 'ilike', `%${search}%`);
        });
      }

      const [{ count: total }] = await query.clone().clearSelect().count('ls.id as count');
      let sales = await query.orderBy('ls.sale_date', 'desc').limit(limit).offset(offset);

      // Confidentiality: a finance-readable (non Owner/Admin) role sees the sale
      // reference but NOT the customer name — mask customer_name + buyer_name.
      if (await isPartyMasked(req)) {
        sales = sales.map((s) => ({ ...s, customer_name: 'Customer', buyer_name: s.buyer_name ? 'Customer' : s.buyer_name }));
      }

      return res.json({ success: true, data: { sales, pagination: { page: +page, limit: +limit, total: +total } } });
    } catch (err) {
      console.error('Local sales list error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get single sale
  async getById(req, res) {
    try {
      const { id } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const where = isNumeric ? { 'ls.id': parseInt(id) } : { 'ls.sale_no': id };

      const sale = await db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('inventory_lots as il', 'ls.lot_id', 'il.id')
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .select(
          'ls.*', 'c.name as customer_name', 'il.lot_no as lot_ref',
          'il.landed_cost_per_kg as lot_cost_per_kg', 'il.landed_cost_total as lot_landed_total',
          'il.item_name as lot_item_name', 'il.variety as lot_variety', 'il.grade as lot_grade',
          'il.supplier_id as lot_supplier_id', 'u.full_name as created_by_name'
        )
        .where(where).first();

      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });
      // Mask the customer for finance-readable (non Owner/Admin) roles — same as
      // the list — so the detail shows the sale reference, not the buyer name.
      if (await isPartyMasked(req)) {
        sale.customer_name = 'Customer';
        if (sale.buyer_name) sale.buyer_name = 'Customer';
      }
      return res.json({ success: true, data: { sale } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Create local sale — deducts from inventory lot
  async create(req, res) {
    try {
      const {
        sale_date, customer_id, buyer_name, buyer_phone, buyer_address,
        payment_mode = 'cash', paid_amount, payment_reference,
        collection_location, bank_account_id, due_date,
        vehicle_no, driver_name, dispatched = true, notes,
        gate_pass_no, // #6 dedicated gate pass number (separate from Internal Notes)
      } = req.body;
      const gatePassNo = gate_pass_no != null && String(gate_pass_no).trim() ? String(gate_pass_no).trim() : null;

      // LS-10: a typed sale date must be a real date and not in the future.
      // Absent → today, as before.
      const saleDateCheck = validateSaleDate(sale_date);
      if (saleDateCheck.error) return res.status(400).json({ success: false, message: saleDateCheck.error });
      const saleDate = saleDateCheck.date || new Date().toISOString().split('T')[0];

      // LS-12: a gate pass number belongs to one sale. Checked BEFORE anything
      // is written (it used to be a warning after the sale was saved).
      if (gatePassNo) {
        const conflict = await findGatePassConflict(db, gatePassNo);
        if (conflict) return res.status(409).json(gatePassConflictBody(gatePassNo, conflict));
      }

      // One sale can carry several inventory items (multi-item). Accept items[]
      // or fall back to the legacy single top-level item fields (backward compat).
      const rawItems = (Array.isArray(req.body.items) && req.body.items.length)
        ? req.body.items
        : [{
            lot_id: req.body.lot_id, item_name: req.body.item_name, item_type: req.body.item_type,
            quantity_input: req.body.quantity_input, quantity_unit: req.body.quantity_unit,
            bag_weight_kg: req.body.bag_weight_kg, rate_input: req.body.rate_input, rate_unit: req.body.rate_unit,
          }];

      // Validate + price every line up front.
      const lines = rawItems.map((it, i) => {
        if (!it.item_name || !it.quantity_input || !it.rate_input) {
          const e = new Error(`Item ${i + 1}: item_name, quantity and rate are required.`); e.status = 400; throw e;
        }
        // Reject non-positive qty/rate: a negative slips past the truthy check above
        // and (on the mill-item path) GREATEST(stock − (−x),0) would INCREASE stock
        // while booking a negative sale.
        if (parseFloat(it.quantity_input) <= 0 || parseFloat(it.rate_input) < 0) {
          const e = new Error(`Item ${i + 1}: quantity must be positive and rate cannot be negative.`); e.status = 400; throw e;
        }
        // A mill-store packaging line (e.g. empty katta) is COUNT-based: pieces ×
        // rate, deducting mill_stock — no weight/unit conversion.
        if (it.mill_item_id) {
          const count = parseFloat(it.quantity_input) || 0;
          const rate = parseFloat(it.rate_input) || 0;
          return {
            isMillItem: true, mill_item_id: it.mill_item_id, lot_id: null,
            item_name: it.item_name, item_type: 'packaging', count,
            quantity_input: count, quantity_unit: 'pcs', rate_input: rate, rate_unit: 'pcs',
            bagWt: 0, qtyKg: count, ratePerKg: rate, total: uc.round2(count * rate),
          };
        }
        // A goods line MUST reference an inventory lot — that's its cost basis
        // (milled/raw landed cost) and the traceability back to the source lot.
        // Without it the sale would book 100% profit and no lot lineage. Explicit
        // service charges (e.g. repacking labour) are exempt — they have no COGS.
        const SERVICE_TYPES = ['labour', 'labor', 'service', 'charge'];
        const isService = SERVICE_TYPES.includes(String(it.item_type || '').toLowerCase());
        if (!it.lot_id && !isService) {
          const e = new Error(`Item ${i + 1} (${it.item_name}): select the inventory lot it is sold from — needed for cost and traceability.`);
          e.status = 400; throw e;
        }
        const bagWt = parseFloat(it.bag_weight_kg) || 50;
        const qtyKg = uc.toKg(it.quantity_input, it.quantity_unit || 'kg', bagWt);
        const ratePerKg = uc.rateToPerKg(it.rate_input, it.rate_unit || 'kg', bagWt);
        return {
          lot_id: it.lot_id || null, item_name: it.item_name, item_type: it.item_type || null,
          quantity_input: parseFloat(it.quantity_input), quantity_unit: it.quantity_unit || 'kg',
          rate_input: parseFloat(it.rate_input), rate_unit: it.rate_unit || 'kg',
          bagWt, qtyKg, ratePerKg, total: uc.round2(qtyKg * ratePerKg),
        };
      });

      const grandTotal = uc.round2(lines.reduce((s, l) => s + l.total, 0));
      // Explicit amount wins; otherwise credit mode defaults to UNPAID (the whole
      // amount is owed), every other mode defaults to fully paid.
      const totalPaid = (paid_amount != null && paid_amount !== '')
        ? (parseFloat(paid_amount) || 0)
        : (payment_mode === 'credit' ? 0 : grandTotal);
      // A bank_transfer receipt MUST name the account it landed in — otherwise the
      // sale would be marked paid but no bank balance moves and no bank_transactions
      // row is written (the money is "collected" nowhere). Reject up front.
      if (payment_mode === 'bank_transfer' && totalPaid > 0 && !bank_account_id) {
        return res.status(400).json({ success: false, message: 'A bank account is required for a bank-transfer receipt.' });
      }
      // Allocate the single tendered amount across lines proportionally; the last
      // line absorbs the rounding remainder so Σ(line paid) === totalPaid exactly.
      let allocated = 0;
      lines.forEach((l, i) => {
        if (i === lines.length - 1) l.paid = uc.round2(Math.max(0, totalPaid - allocated));
        else { l.paid = grandTotal > 0 ? uc.round2(totalPaid * (l.total / grandTotal)) : 0; allocated += l.paid; }
      });
      // A credit / partial sale leaves a balance owed → a receivable, which needs
      // a customer to chase. (receivables.customer_id is NOT NULL.) A cheque is
      // not money until it clears, so a cheque sale is owed in full until then.
      const hasDue = totalPaid < grandTotal - 0.01 || (isChequeMode(payment_mode) && grandTotal > 0.01);

      // Walk-in credit buyer → identified by phone (see resolveWalkInCustomer).
      // Refused up front, before anything is written. A cash walk-in needs none.
      if (hasDue && !customer_id) {
        if (!String(buyer_name || '').trim()) {
          return res.status(400).json({ success: false, message: 'A credit or partial sale needs a buyer name (or a registered customer) so the balance can be tracked.' });
        }
        if (!phoneDigits(buyer_phone)) {
          return res.status(400).json({ success: false, code: 'WALK_IN_PHONE_REQUIRED', message: 'A walk-in credit sale needs the buyer\'s phone number — it is how their balance is tracked. Enter a phone, or pick a registered customer.' });
        }
      }

      // A sale RECORDED by a Mill Manager/Owner auto-confirms (posts immediately);
      // anyone else's sits Pending until a Mill Manager/Owner confirms it.
      const autoConfirm = await recorderCanAutoConfirm(db, req.user?.role_id);

      const result = await db.transaction(async (trx) => {
        // Resolve the customer for any owed balance: use the selected one, else
        // register the walk-in buyer (a LOCAL customer matched on phone, see
        // resolveWalkInCustomer) so credit sales work without a manual
        // registration step. A fully-paid walk-in stays anonymous.
        let resolvedCustomerId = customer_id || null;
        if (hasDue && !resolvedCustomerId) {
          const nm = (buyer_name || '').trim();
          if (!nm) { const e = new Error('A credit or partial sale needs a buyer name (or a registered customer) so the balance can be tracked.'); e.status = 400; throw e; }
          const cust = await resolveWalkInCustomer(trx, { name: nm, phone: buyer_phone, userId: req.user?.id });
          resolvedCustomerId = cust.id;
        }

        let groupNo = null;
        const created = [];

        for (const l of lines) {
          const saleNo = await generateSaleNo(trx);
          if (!groupNo) groupNo = saleNo; // first line's number identifies the group

          // Cost basis is a READ here — availability is enforced and stock is
          // drawn down only when the sale is confirmed (postSaleSideEffects).
          const { costPerKg, lotNo } = await resolveLineCost(trx, {
            lotId: l.lot_id, millItemId: l.isMillItem ? l.mill_item_id : null, qtyKg: l.qtyKg, itemName: l.item_name,
          });
          const priced = priceSaleLine({ qtyKg: l.qtyKg, total: l.total, costPerKg, bagWt: l.bagWt, isMillItem: l.isMillItem });

          const dueAmt = Math.max(0, uc.round2(l.total - l.paid));
          const paymentStatus = salePaymentStatus({ due: dueAmt, paid: l.paid, paymentMode: payment_mode });

          const [sale] = await trx('local_sales').insert({
            sale_no: saleNo, sale_group_no: groupNo,
            sale_date: saleDate,
            entity: 'mill', customer_id: resolvedCustomerId,
            buyer_name: buyer_name || null, buyer_phone: buyer_phone || null, buyer_address: buyer_address || null,
            lot_id: l.lot_id, lot_no: lotNo, mill_item_id: l.mill_item_id || null,
            item_name: l.item_name, item_type: l.item_type,
            quantity_unit: l.quantity_unit, quantity_input: l.quantity_input, quantity_kg: l.qtyKg,
            quantity_bags: priced.quantity_bags, bag_weight_kg: l.isMillItem ? null : l.bagWt,
            rate_unit: l.rate_unit, rate_input: l.rate_input, rate_per_kg: l.ratePerKg,
            total_amount: l.total, currency: 'PKR',
            payment_mode: payment_mode || 'cash', payment_status: paymentStatus,
            paid_amount: l.paid, due_amount: dueAmt, payment_reference: payment_reference || null,
            collection_location: collection_location || null, due_date: due_date || null,
            bank_account_id: bank_account_id || null,
            vehicle_no: vehicle_no || null, driver_name: driver_name || null,
            // Goods may not leave before a manager confirms a clerk's sale: a
            // Pending sale is not dispatched; confirmSale dispatches it.
            dispatched: autoConfirm ? !!dispatched : false,
            dispatch_date: autoConfirm && dispatched ? saleDate : null,
            notes: notes || null,
            gate_pass_no: gatePassNo,
            status: autoConfirm ? 'Completed' : 'Pending',
            confirmed_by: autoConfirm ? (req.user?.id || null) : null,
            confirmed_at: autoConfirm ? trx.fn.now() : null,
            created_by: req.user?.id || null,
            cost_per_kg: priced.cost_per_kg, landed_cost_total: priced.landed_cost_total, gross_profit: priced.gross_profit,
            profit_per_kg: priced.profit_per_kg, margin_pct: priced.margin_pct,
          }).returning('*');

          created.push(sale);
        }

        // #5 Repacking metadata for the sale group (bag source / bag change /
        // labour / packing loss). The money lines (company bags, labour) are
        // already recorded above as normal sale lines; this row keeps the
        // repacking detail + a back-link so it's traceable + printable.
        const rp = req.body.repacking;
        if (rp && (rp.required || rp.bag_source)) {
          const numOrNull = (v) => (v == null || v === '' ? null : parseFloat(v));
          const intOrNull = (v) => (v == null || v === '' ? null : parseInt(v, 10));
          await trx('local_sale_repacking').insert({
            local_sale_id: created[0].id,
            sale_group_no: groupNo,
            bag_source: ['customer', 'company', 'none'].includes(rp.bag_source) ? rp.bag_source : 'none',
            packaging_item_id: intOrNull(rp.packaging_item_id),
            original_bag_size_kg: numOrNull(rp.original_bag_size_kg),
            original_bag_count: intOrNull(rp.original_bag_count),
            new_bag_size_kg: numOrNull(rp.new_bag_size_kg),
            new_bag_count: intOrNull(rp.new_bag_count),
            bag_rate: numOrNull(rp.bag_rate),
            packaging_charge: numOrNull(rp.packaging_charge),
            labour_mode: ['per_bag', 'per_kg', 'fixed'].includes(rp.labour_mode) ? rp.labour_mode : null,
            labour_rate: numOrNull(rp.labour_rate),
            labour_total: numOrNull(rp.labour_total),
            packing_loss_kg: numOrNull(rp.packing_loss_kg),
            final_dispatched_kg: numOrNull(rp.final_dispatched_kg),
            notes: rp.notes || null,
            // Repacking empties the katta the rice was held in. Those sacks
            // normally come back to the mill, but a buyer can ask to keep them,
            // so the choice is recorded rather than assumed. The store is only
            // credited when the sale is CONFIRMED (see postSaleSideEffects) —
            // crediting here would hand us sacks for a sale that is later
            // rejected.
            freed_katta_to_store: rp.freed_katta_to_store !== false,
            created_by: req.user?.id || null,
          });
        }

        // Only a confirmed sale moves stock/money. Pending sits inert until a Mill
        // Manager/Owner confirms it (POST /:id/confirm) — nothing to unwind on reject.
        if (autoConfirm) await postSaleSideEffects(trx, created, { userId: req.user?.id });

        return { groupNo, sales: created, autoConfirm };
      });

      // A duplicate gate pass is refused before the save (above), so a saved
      // sale never carries one. The flag stays in the response for callers
      // that still read it.
      const gatePassDuplicate = false;

      return res.status(201).json({
        success: true,
        data: {
          sale: result.sales[0], sales: result.sales, group_no: result.groupNo, item_count: result.sales.length,
          status: result.autoConfirm ? 'Completed' : 'Pending', pending: !result.autoConfirm,
          gate_pass_no: gatePassNo, gate_pass_duplicate: gatePassDuplicate,
        },
      });
    } catch (err) {
      console.error('Local sale create error:', err);
      const status = err.status || (String(err.message).includes('Insufficient') ? 400 : 500);
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // Pending-confirmation inbox (Batch 6 · item 9) — sales awaiting a Mill
  // Manager/Owner, grouped by sale_group_no.
  async listPending(req, res) {
    try {
      const rows = await db('local_sales as ls')
        .leftJoin('customers as c', 'ls.customer_id', 'c.id')
        .leftJoin('users as u', 'u.id', 'ls.created_by')
        .where('ls.status', 'Pending')
        .orderBy('ls.sale_date', 'desc').orderBy('ls.sale_group_no', 'desc').orderBy('ls.id', 'asc')
        .select('ls.*', 'c.name as customer_name', 'u.full_name as created_by_name');
      const groups = [];
      const byGroup = new Map();
      for (const r of rows) {
        const key = r.sale_group_no || r.sale_no;
        if (!byGroup.has(key)) { const g = { sale_group_no: key, id: r.id, sale_date: r.sale_date, buyer_name: r.buyer_name, customer_name: r.customer_name, created_by_name: r.created_by_name, total_amount: 0, items: [] }; byGroup.set(key, g); groups.push(g); }
        const g = byGroup.get(key);
        g.total_amount = uc.round2((parseFloat(g.total_amount) || 0) + (parseFloat(r.total_amount) || 0));
        g.items.push(r);
      }
      return res.json({ success: true, data: { pending: groups, count: groups.length } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Confirm a pending sale — Mill Manager/Owner only (route-gated). Runs the
  // deferred stock/money side-effects (re-checking availability) and marks the
  // whole sale group Completed. Idempotent-safe: only Pending rows are posted.
  // ── Edit a sale ─────────────────────────────────────────────────────────────
  // What may change depends entirely on whether the sale has been CONFIRMED,
  // because that is the moment anything leaves the local_sales row:
  // postSaleSideEffects deducts the lot, writes the receivable and posts the
  // revenue and COGS journals. A Pending sale is just a row.
  //
  //   Pending    → quantity, rate, item and the presentation fields. Nothing
  //                downstream exists yet, so the money is simply recomputed.
  //   Confirmed  → presentation only: who it is for, how it left, what it says.
  //                Changing a confirmed quantity or rate would mean unwinding a
  //                stock movement and two journals and re-posting them, which is
  //                the reverse-and-repost pattern that double-counts. Refused
  //                with that reason rather than half-done.
  async update(req, res) {
    // Safe on any sale: none of these touch stock, the ledger or a balance.
    const PRESENTATION = [
      'buyer_name', 'buyer_phone', 'buyer_address', 'vehicle_no', 'driver_name',
      'notes', 'gate_pass_no', 'collection_location',
    ];
    // Only while Pending — each of these changes what will be posted.
    const PENDING_ONLY = [
      'item_name', 'quantity_input', 'quantity_unit', 'bag_weight_kg',
      'rate_input', 'rate_unit', 'sale_date', 'due_date',
    ];
    try {
      const sale = await db('local_sales').where({ id: req.params.id }).first();
      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });

      const body = req.body || {};
      const isPending = sale.status === 'Pending';
      const groupKey = sale.sale_group_no || null;
      // LS-12: presentation fields describe the whole SALE (one buyer, one
      // truck, one gate pass, one invoice) — they are written to every line of
      // the sale_group_no below, not just the line that was opened.
      const presentation = {};
      for (const f of PRESENTATION) if (body[f] !== undefined) presentation[f] = body[f] === '' ? null : body[f];
      if (typeof presentation.gate_pass_no === 'string') presentation.gate_pass_no = presentation.gate_pass_no.trim() || null;
      if (presentation.gate_pass_no && presentation.gate_pass_no !== sale.gate_pass_no) {
        const conflict = await findGatePassConflict(db, presentation.gate_pass_no, groupKey);
        if (conflict && conflict.id !== sale.id) return res.status(409).json(gatePassConflictBody(presentation.gate_pass_no, conflict));
      }
      const patch = {};

      const moneyFields = PENDING_ONLY.filter((f) => body[f] !== undefined);
      if (moneyFields.length && !isPending) {
        return res.status(409).json({
          success: false,
          code: 'SALE_ALREADY_CONFIRMED',
          message: `${sale.sale_no} has been confirmed — its stock and ledger entries are posted, so ${moneyFields.join(', ')} can no longer be changed here. Correct it with a credit note or return instead.`,
        });
      }

      if (isPending && moneyFields.length) {
        for (const f of PENDING_ONLY) if (body[f] !== undefined) patch[f] = body[f] === '' ? null : body[f];
        if (patch.sale_date != null) {
          const chk = validateSaleDate(patch.sale_date);
          if (chk.error) return res.status(400).json({ success: false, message: chk.error });
          patch.sale_date = chk.date;
        }

        // Recompute with the SAME helpers the sale was created with, so an
        // edited line cannot disagree with a created one.
        const bagWt = parseFloat(patch.bag_weight_kg ?? sale.bag_weight_kg) || 50;
        const qtyInput = parseFloat(patch.quantity_input ?? sale.quantity_input);
        const rateInput = parseFloat(patch.rate_input ?? sale.rate_input);
        if (!(qtyInput > 0)) return res.status(400).json({ success: false, message: 'Quantity must be greater than zero.' });
        if (!(rateInput >= 0)) return res.status(400).json({ success: false, message: 'Rate cannot be negative.' });

        const isMillItem = !!sale.mill_item_id;
        const qtyKg = uc.toKg(qtyInput, patch.quantity_unit ?? sale.quantity_unit ?? 'kg', bagWt);
        const ratePerKg = uc.rateToPerKg(rateInput, patch.rate_unit ?? sale.rate_unit ?? 'kg', bagWt);
        const total = uc.round2(qtyKg * ratePerKg);

        const paid = parseFloat(sale.paid_amount) || 0;
        // A tendered amount now exceeding the total would leave a phantom credit.
        if (paid > total + 0.01) {
          return res.status(400).json({ success: false, message: `Rs ${paid.toLocaleString()} has already been taken against this sale — the new total of Rs ${total.toLocaleString()} is lower. Refund or cancel instead.` });
        }

        // Re-read the cost basis the way create does — it also refuses to sell
        // more than the lot holds (create enforces it; an edit must not walk
        // past it) and refuses an uncosted lot. Then recompute every derived
        // figure, because confirm posts COGS from landed_cost_total.
        let cost;
        try {
          cost = await resolveLineCost(db, { lotId: sale.lot_id, millItemId: sale.mill_item_id, qtyKg, itemName: patch.item_name ?? sale.item_name });
        } catch (e) {
          if (e.status === 400) return res.status(400).json({ success: false, message: e.message });
          throw e;
        }
        const priced = priceSaleLine({ qtyKg, total, costPerKg: cost.costPerKg, bagWt, isMillItem });

        patch.bag_weight_kg = isMillItem ? null : bagWt;
        patch.quantity_kg = qtyKg;
        patch.rate_per_kg = ratePerKg;
        patch.total_amount = total;
        patch.due_amount = uc.round2(Math.max(0, total - paid));
        Object.assign(patch, priced);
        patch.payment_status = salePaymentStatus({ due: patch.due_amount, paid, paymentMode: sale.payment_mode });
      }

      if (!Object.keys(patch).length && !Object.keys(presentation).length) {
        return res.status(400).json({ success: false, message: 'Nothing to change.' });
      }
      await db.transaction(async (trx) => {
        if (Object.keys(presentation).length) {
          await trx('local_sales')
            .where(groupKey ? { sale_group_no: groupKey } : { id: sale.id })
            .update({ ...presentation, updated_at: trx.fn.now() });
        }
        if (Object.keys(patch).length) {
          await trx('local_sales').where({ id: sale.id }).update({ ...patch, updated_at: trx.fn.now() });
        }
      });
      const updated = await db('local_sales').where({ id: sale.id }).first();
      return res.json({ success: true, data: { sale: updated, editable: isPending ? 'all' : 'presentation' } });
    } catch (err) {
      console.error('update local sale error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async confirmSale(req, res) {
    try {
      const { id } = req.params;
      const head = await db('local_sales').where(/^\d+$/.test(String(id)) ? { id: parseInt(id, 10) } : { sale_no: id }).first();
      if (!head) return res.status(404).json({ success: false, message: 'Sale not found.' });
      const groupKey = head.sale_group_no || head.sale_no;

      const result = await db.transaction(async (trx) => {
        const rows = await trx('local_sales').where({ sale_group_no: groupKey, status: 'Pending' }).forUpdate().orderBy('id', 'asc');
        if (!rows.length) { const e = new Error('This sale is not awaiting confirmation.'); e.status = 409; throw e; }
        await postSaleSideEffects(trx, rows, { userId: req.user?.id });
        const ids = rows.map((r) => r.id);
        // Confirmation is the release: the goods leave now, so the sale is
        // dispatched on the day it is confirmed.
        await trx('local_sales').whereIn('id', ids).update({
          status: 'Completed', confirmed_by: req.user?.id || null, confirmed_at: trx.fn.now(), updated_at: trx.fn.now(),
          dispatched: true, dispatch_date: new Date().toISOString().split('T')[0],
        });
        return { count: ids.length, group_no: groupKey };
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Local sale confirm error:', err);
      const status = err.status || (String(err.message).includes('Insufficient') ? 400 : 500);
      return res.status(status).json({ success: false, message: err.message });
    }
  },

  // Reject a pending sale — Mill Manager/Owner only. Nothing was posted, so this
  // just marks the group Cancelled (no stock/GL reversal).
  async rejectSale(req, res) {
    try {
      const { id } = req.params;
      const reason = req.body?.reason || null;
      const head = await db('local_sales').where(/^\d+$/.test(String(id)) ? { id: parseInt(id, 10) } : { sale_no: id }).first();
      if (!head) return res.status(404).json({ success: false, message: 'Sale not found.' });
      const groupKey = head.sale_group_no || head.sale_no;
      const rows = await db('local_sales').where({ sale_group_no: groupKey, status: 'Pending' }).select('id', 'notes');
      if (!rows.length) return res.status(409).json({ success: false, message: 'Only a pending sale can be rejected.' });
      await db.transaction(async (trx) => {
        for (const r of rows) {
          await trx('local_sales').where('id', r.id).update({
            status: 'Cancelled',
            // Nothing is owed on a sale that never happened — leaving due_amount
            // standing kept a Pay button (and a receivable-looking balance) on it.
            due_amount: 0,
            notes: reason ? `${r.notes ? `${r.notes} · ` : ''}Rejected: ${reason}` : r.notes,
            updated_at: trx.fn.now(),
          });
        }
      });
      return res.json({ success: true, data: { count: rows.length, group_no: groupKey } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Accept payment against a local sale
  async acceptPayment(req, res) {
    try {
      const { id } = req.params;
      const input = readReceiptInput(req.body);
      if (input.error) return res.status(400).json({ success: false, message: input.error });
      // Came in on milling.edit alone (the Mill Operator): mill sales only.
      const millOnly = await isMillOnlyPayer(req, [['inventory', 'create']]);

      await db.transaction(async (trx) => {
        // Read (and lock) the sale INSIDE the transaction: two receipts racing
        // on the same sale would otherwise both read the old paid/due and the
        // second would overwrite the first (lost update + over-collection).
        const sale = await trx('local_sales').where({ id }).forUpdate().first();
        if (!sale) { const e = new Error('Sale not found.'); e.status = 404; throw e; }
        // Only a confirmed sale is owed anything. A Pending sale's paid_amount is
        // taken as a receipt again when it is confirmed (postSaleSideEffects), so
        // paying it here would record the money twice; a Cancelled one never
        // happened.
        assertSaleTakesPayment(sale);
        if (millOnly) {
          assertMillEntity(sale.entity, 'sales');
          await assertMillReceipt(trx, input);
        }

        // Uncleared cheques already on this sale will settle it when they
        // clear — leave room for them so the sale is not collected twice.
        const pendingCheques = (await unclearedChequesBySale(trx, [sale.id])).get(sale.id) || 0;
        const currentDue = uc.round2(Math.max(0, (parseFloat(sale.due_amount) || 0) - pendingCheques));
        if (input.amount > currentDue + 0.01) {
          const e = new Error(`Cannot pay Rs ${input.amount} — only Rs ${currentDue.toFixed(2)} remaining${pendingCheques > 0 ? ` (Rs ${pendingCheques.toFixed(2)} is in cheques waiting to clear)` : ''}.`); e.status = 400; throw e;
        }

        await applyReceiptToSale(trx, sale, { ...input, userId: req.user?.id });
      });

      const updated = await db('local_sales').where({ id }).first();
      return res.json({ success: true, data: { sale: updated } });
    } catch (err) {
      if (!err.status) console.error('Accept payment error:', err);
      return res.status(err.status || 500).json({ success: false, message: err.message });
    }
  },

  // One receipt for a whole multi-item sale (LS-08). Every Completed line of
  // the sale_group_no is locked, the amount is checked against the group's
  // total due, then split OLDEST LINE FIRST (lowest id — the order the lines
  // were entered and the order the invoice prints them): each line is settled
  // in full before the next one takes anything, so a part-payment closes whole
  // lines instead of leaving every line a little short. Each line's share goes
  // through applyReceiptToSale — the exact path a single-line receipt takes —
  // so the bank move, receivable and Dr 1000 / Cr 1120 journal are identical.
  // All lines or none: any failure rolls the whole receipt back.
  async acceptGroupPayment(req, res) {
    try {
      const groupNo = String(req.params.groupNo || '').trim();
      if (!groupNo) return res.status(400).json({ success: false, message: 'A sale number is required.' });
      const input = readReceiptInput(req.body);
      if (input.error) return res.status(400).json({ success: false, message: input.error });
      const millOnly = await isMillOnlyPayer(req, [['inventory', 'create']]);

      const result = await db.transaction(async (trx) => {
        const lines = await trx('local_sales')
          .where((q) => q.where('sale_group_no', groupNo).orWhere((q2) => q2.whereNull('sale_group_no').where('sale_no', groupNo)))
          .where('status', 'Completed')
          .orderBy('id', 'asc')
          .forUpdate();
        if (!lines || !lines.length) {
          const e = new Error(`${groupNo} has no confirmed lines to take a payment against.`); e.status = 409; throw e;
        }
        if (millOnly) {
          for (const l of lines) assertMillEntity(l.entity, 'sales');
          await assertMillReceipt(trx, input);
        }
        // Uncleared cheques count against what is still open on each line.
        const pending = await unclearedChequesBySale(trx, lines.map((l) => l.id));
        const open = lines.map((l) => ({ ...l, due_amount: uc.round2(Math.max(0, (parseFloat(l.due_amount) || 0) - (pending.get(l.id) || 0))) }));
        const totalDue = uc.round2(open.reduce((s, l) => s + (parseFloat(l.due_amount) || 0), 0));
        if (input.amount > totalDue + 0.01) {
          const e = new Error(`Cannot pay Rs ${input.amount} — only Rs ${totalDue.toFixed(2)} remaining on ${groupNo}.`); e.status = 400; throw e;
        }
        const allocations = allocateOldestFirst(input.amount, open);
        const applied = [];
        for (const { sale, amount } of allocations) {
          const r = await applyReceiptToSale(trx, sale, {
            ...input, amount, userId: req.user?.id,
            notes: input.notes || `Payment for local sale ${sale.sale_no} (sale ${groupNo})`,
          });
          applied.push({ sale_id: sale.id, sale_no: sale.sale_no, amount, payment_no: r.paymentNo });
        }
        return { group_no: groupNo, total_due: totalDue, applied };
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      if (!err.status) console.error('Accept group payment error:', err);
      return res.status(err.status || 500).json({ success: false, message: err.message });
    }
  },

  // Selling rate suggestion for a lot from the Rates Center
  // (commodity_rate_master), looked up the same way stock valuation does:
  // product + grade first, then the product on its own. Per KG; the form
  // converts it to the line's unit. A lot with no rate returns null.
  async rateSuggestion(req, res) {
    try {
      const lotId = parseInt(req.query.lot_id, 10);
      if (!lotId) return res.status(400).json({ success: false, message: 'lot_id is required.' });
      const lot = await db('inventory_lots').where({ id: lotId }).first('id', 'product_id', 'grade');
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });
      const hasRates = await db.schema.hasTable('commodity_rate_master');
      const rows = hasRates && lot.product_id ? await db('commodity_rate_master').where('product_id', lot.product_id).select('*') : [];
      const rate = rateForLot(lot, buildRateIndex(rows));
      return res.json({ success: true, data: { rate: rate ? { per_kg: rate.perKg, effective_date: rate.effectiveDate, unit: rate.unit } : null } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Get payment history for a sale
  async getPayments(req, res) {
    try {
      const { id } = req.params;
      const sale = await db('local_sales').where({ id }).first();
      if (!sale) return res.status(404).json({ success: false, message: 'Sale not found.' });

      // Prefer FK, fall back to notes search for legacy records
      let payments = await db('payments')
        .where('local_sale_id', id)
        .orderBy('payment_date', 'desc');
      if (payments.length === 0) {
        payments = await db('payments')
          .where('notes', 'ilike', `%${sale.sale_no}%`)
          .orderBy('payment_date', 'desc');
      }

      return res.json({ success: true, data: { payments, sale } });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Invoice 360 (customer-safe) — header, line items, stock traceability,
  // payment timeline, dispatch. EXCLUDES COGS/margin. Read-only.
  async getInvoice(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, false);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Gate pass — the release document that lets the goods out of the gate. A
  // clerk's sale awaiting a Mill Manager/Owner's confirmation has not been
  // released, so no gate pass is issued for it (409); a rejected one never
  // happened. Returns the customer-safe invoice payload the pass prints from.
  async getGatePass(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, false);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      const refusal = gatePassRefusal(data.sale);
      if (refusal) return res.status(409).json({ success: false, ...refusal });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Admin invoice copy — everything in getInvoice PLUS internal financials
  // (cost/kg · COGS · gross margin · margin % · remaining stock) and linked
  // records (receivables · inventory movements · lot transactions). Route is
  // role-gated (Owner / Super Admin / Finance Manager / Mill Manager) so this
  // is never exposed to Mill Operator, customers or unauthorized users.
  async getInvoiceAdmin(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, true);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // Email the customer invoice (Phase 5). Sends the customer-safe HTML (no
  // cost/margin) to the customer's email via the existing mailer. Read-only on
  // sales data; only sends an email + writes an email_logs row.
  async emailInvoice(req, res) {
    try {
      const data = await assembleInvoice(req.params.id, false);
      if (!data) return res.status(404).json({ success: false, message: 'Sale not found.' });
      let to = (req.body && req.body.to ? String(req.body.to).trim() : '') || data.sale.customerEmail || '';
      if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
        return res.status(400).json({ success: false, message: 'A valid recipient email is required (the customer has no email on file).' });
      }
      let company = {};
      try { const cp = await db('company_profile').first(); if (cp) company = cp; } catch (e) { /* default */ }
      const coName = company.legal_name || company.name || 'AGRI COMMODITIES';
      const html = renderInvoiceEmailHtml(data, company);
      const emailService = require('../communications/email.service');
      const log = await emailService.sendEmail({
        to, subject: `Invoice ${data.sale.invoiceNo} — ${coName}`, body: html,
        linkedType: 'local_sale', linkedId: data.sale.id, userId: req.user?.id || null,
      });
      return res.json({ success: true, to, status: (log && log.status) || 'Sent' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message || 'Failed to send invoice email.' });
    }
  },

  // Summary stats
  async summary(req, res) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

      // Mill-item (packaging) lines store a piece COUNT in quantity_kg, not kilos —
      // exclude them from the KG totals so a katta sale doesn't inflate "kg sold".
      const kgSum = "COALESCE(SUM(CASE WHEN mill_item_id IS NULL THEN quantity_kg ELSE 0 END),0) as qty_kg";
      const [todayStats, monthStats, totalStats, profitStats] = await Promise.all([
        db('local_sales').where('sale_date', today).where('status', 'Completed')
          .select(db.raw(`COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, ${kgSum}`)).first(),
        db('local_sales').where('sale_date', '>=', monthStart).where('status', 'Completed')
          .select(db.raw(`COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, ${kgSum}`)).first(),
        db('local_sales').where('status', 'Completed')
          .select(db.raw('COUNT(*) as count, COALESCE(SUM(total_amount),0) as total, COALESCE(SUM(due_amount),0) as due')).first(),
        db('local_sales').where('status', 'Completed')
          .select(db.raw('COALESCE(SUM(total_amount),0) as revenue, COALESCE(SUM(landed_cost_total),0) as cost, COALESCE(SUM(gross_profit),0) as profit, COALESCE(SUM(paid_amount),0) as collected')).first(),
      ]);

      return res.json({
        success: true,
        data: {
          today: { count: parseInt(todayStats.count), total: parseFloat(todayStats.total), qtyKg: parseFloat(todayStats.qty_kg) },
          month: { count: parseInt(monthStats.count), total: parseFloat(monthStats.total), qtyKg: parseFloat(monthStats.qty_kg) },
          all: { count: parseInt(totalStats.count), total: parseFloat(totalStats.total), due: parseFloat(totalStats.due) },
          profit: { revenue: parseFloat(profitStats.revenue), cost: parseFloat(profitStats.cost), grossProfit: parseFloat(profitStats.profit), collected: parseFloat(profitStats.collected) },
        },
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

// Exported for tests (and for any other receipt path that must settle a local
// sale the same way).
module.exports.applyReceiptToSale = applyReceiptToSale;
module.exports.allocateOldestFirst = allocateOldestFirst;
module.exports.validateSaleDate = validateSaleDate;
module.exports.resolveWalkInCustomer = resolveWalkInCustomer;
module.exports.gatePassRefusal = gatePassRefusal;
module.exports.readReceiptInput = readReceiptInput;
