// Mill Finance KPIs (P4-02) — every figure the Mill Finance dashboard shows,
// computed here, for a period, from the canonical modules. The browser used to
// build them from the newest 200 batches it happened to have loaded:
//
//   - the hero "Net profit · {month}" was all-time, valued UNSOLD output at
//     selling price and took overheads that were already in batch costs
//     (RPT-07 / FIN-21);
//   - a phantom Rs 5/kg "milling fee" was subtracted for every kg milled
//     (MIL-02) — the fee is not a cost: the cost sheet (milling_costs) is;
//   - payroll was subtracted again after overheads that already held it
//     (MIL-29);
//   - stock was valued in the browser with hard-coded fallback prices, over
//     every entity (RPT-12 / MIL-41);
//   - averages silently stopped being totals past 200 batches (MIL-31).
//
// Contracts (docs/AGRIRICE_KPI_CONTRACTS.md):
//   mill_profit.v1        HEADLINE (owner decision D-13): profitDefinitions'
//                         "Mill (net)" — sales of mill output − their COGS −
//                         the period's mill overheads, by sale / movement /
//                         expense date. Unsold output is stock, not profit.
//   production_value.v1   SECONDARY, labelled: what the period's completed
//                         batches produced, at each batch's OWN selling prices.
//                         Not revenue and not profit.
//   yield.v1              Σ finished ÷ Σ raw over the period's completed
//                         company batches (milling/millingYield.js, D-14).
//   working_capital.v1    mill company stock on hand × landed cost per kg
//                         (inventory/stockValue.js, D-14). Point in time.
//
// PKR only; quantities in KG.

const { millAndLocalProfit, LOCAL_SALE_EXCLUDED, EXPENSE_EXCLUDED } = require('../finance/profitDefinitions');
const { stockValueByAccount, lotValueSql, lotAccountSql } = require('../inventory/stockValue');
const { onHandKg, ownershipSql } = require('../inventory/stockSql');
const { weightedYieldPct } = require('../milling/millingYield');
const { batchOutputValues } = require('../milling/batchOutputValues');
const { byproductSaleValue } = require('../milling/byproductPrices');
const { canonicalCostCategory, RAW_RICE, PACKAGING } = require('../milling/costCategories');
const { resolvePeriod, isoDay } = require('../../shared/fiscalYear');
const { KPI_CONTRACTS } = require('./contracts');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

// "col::date between from and to", only the bounds that are set.
function dateClause(col, { from, to }, params) {
  const parts = [];
  if (from) { parts.push(`(${col})::date >= ?::date`); params.push(from); }
  if (to) { parts.push(`(${col})::date <= ?::date`); params.push(to); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

/**
 * mill_profit.v1 — the D-13 headline, straight from profitDefinitions.
 */
async function millProfit(conn, { from = null, to = null } = {}) {
  const { mill } = await millAndLocalProfit(conn, { startDate: from, endDate: to });
  return {
    contract: KPI_CONTRACTS.millProfit,
    basis: 'mill_net',
    netProfitPkr: r2(mill.profitPkr),
    grossProfitPkr: r2(mill.grossProfitPkr),
    revenuePkr: r2(mill.revenuePkr),
    cogsPkr: r2(mill.cogsPkr),
    overheadsPkr: r2(mill.overheadsPkr),
    marginPct: mill.marginPct,
    grossMarginPct: mill.grossMarginPct,
    localSalesRevenuePkr: r2(mill.localSalesRevenuePkr),
    transferRevenuePkr: r2(mill.transferRevenuePkr),
    transferCostPkr: r2(mill.transferCostPkr),
    soldKg: r2(mill.soldKg),
    saleCount: mill.saleCount,
    transferCount: mill.transferCount,
    uncostedCount: mill.uncostedCount,
    uncostedRevenuePkr: r2(mill.uncostedRevenuePkr),
    overheadCount: mill.overheadCount,
    overheadsUnconvertedCount: mill.overheadsUnconvertedCount,
    overheadsBatchLinkedPkr: r2(mill.overheadsBatchLinkedPkr),
  };
}

// Is a milling_costs category the rice purchase / the bags?
const costKind = (category) => {
  const c = canonicalCostCategory(category) || String(category || '').toLowerCase();
  if (c === RAW_RICE) return 'raw';
  if (c === PACKAGING) return 'packaging';
  return 'other';
};

/**
 * Pure fold (unit-tested): the period's completed company batches → production
 * figures. batches: milling_batches rows; costs: { batch_id, category, amount };
 * consumed: Map(batchId → finished kg re-milled into a blend);
 * outputValues: batchOutputValues() Map.
 */
function foldProduction(batches = [], costs = [], consumed = new Map(), outputValues = new Map()) {
  const out = {
    batchCount: 0, blendCount: 0, rawKg: 0, finishedKg: 0, sellableFinishedKg: 0, wastageKg: 0,
    rawCostPkr: 0, packagingCostPkr: 0, otherCostPkr: 0,
    finishedValuePkr: 0, byproductValuePkr: 0, unpricedFinishedBatches: 0, unpricedFinishedKg: 0,
  };
  const costsBy = new Map();
  for (const c of costs) {
    const id = Number(c.batch_id);
    const m = costsBy.get(id) || { raw: 0, packaging: 0, other: 0 };
    m[costKind(c.category)] += num(c.amount);
    costsBy.set(id, m);
  }
  for (const b of batches) {
    const id = Number(b.id);
    const blend = b.processing_type === 'blended';
    out.batchCount += 1;
    if (blend) out.blendCount += 1;
    out.rawKg += num(b.raw_qty_kg);
    out.finishedKg += num(b.actual_finished_kg);
    out.wastageKg += num(b.wastage_kg);
    // A blend re-mills finished rice the company already owns: its raw_rice
    // cost is that stock's internal value, already counted on its source
    // batches — so it is not raw material again. Output re-milled into a blend
    // is sold once, as the blend's.
    const c = costsBy.get(id) || { raw: 0, packaging: 0, other: 0 };
    if (!blend) out.rawCostPkr += c.raw;
    out.packagingCostPkr += c.packaging;
    out.otherCostPkr += c.other;
    const sellable = Math.max(0, num(b.actual_finished_kg) - num(consumed.get(id)));
    out.sellableFinishedKg += sellable;
    const finPrice = num(b.finished_price_per_kg);
    if (finPrice > 0) out.finishedValuePkr += sellable * finPrice;
    else if (sellable > 0) { out.unpricedFinishedBatches += 1; out.unpricedFinishedKg += sellable; }
    // By-products at what the yield booked on the output lots; a batch with no
    // stored output at its own recorded per-kg prices. No default price.
    const stored = outputValues.get(id);
    out.byproductValuePkr += stored && stored.byproductValue != null ? num(stored.byproductValue) : byproductSaleValue(b);
  }
  const batchCostPkr = out.rawCostPkr + out.packagingCostPkr + out.otherCostPkr;
  return {
    contract: KPI_CONTRACTS.productionValue,
    batchCount: out.batchCount,
    blendCount: out.blendCount,
    rawKg: r2(out.rawKg),
    finishedKg: r2(out.finishedKg),
    sellableFinishedKg: r2(out.sellableFinishedKg),
    wastageKg: r2(out.wastageKg),
    yieldPct: weightedYieldPct(batches),
    yieldContract: KPI_CONTRACTS.yield,
    wastagePct: pct(out.wastageKg, out.rawKg),
    rawCostPkr: r2(out.rawCostPkr),
    packagingCostPkr: r2(out.packagingCostPkr),
    otherCostPkr: r2(out.otherCostPkr),
    batchCostPkr: r2(batchCostPkr),
    // Batch cost per sellable finished kg. Period overheads are NOT in it —
    // they are in the mill profit, once.
    batchCostPerKgPkr: out.sellableFinishedKg > 0 ? r2(batchCostPkr / out.sellableFinishedKg) : null,
    // SECONDARY (D-13): output at the batches' own selling prices. Not revenue.
    finishedValuePkr: r2(out.finishedValuePkr),
    byproductValuePkr: r2(out.byproductValuePkr),
    valueAtSellingPricePkr: r2(out.finishedValuePkr + out.byproductValuePkr),
    unpricedFinishedBatches: out.unpricedFinishedBatches,
    unpricedFinishedKg: r2(out.unpricedFinishedKg),
  };
}

/** The period's completed company (non-service) batches, by completion date. */
async function periodBatches(conn, { from, to }) {
  const params = [];
  return rowsOf(await conn.raw(`
    SELECT mb.*
      FROM milling_batches mb
     WHERE mb.status = 'Completed' AND mb.is_service_milling IS NOT TRUE${dateClause('mb.completed_at', { from, to }, params)}
     ORDER BY mb.completed_at, mb.id`, params));
}

/** production_value.v1 + yield.v1 for the period. */
async function production(conn, { from = null, to = null } = {}) {
  const batches = await periodBatches(conn, { from, to });
  if (!batches.length) return foldProduction([]);
  const ids = batches.map((b) => b.id);
  const [costs, consumedRows, outputValues] = await Promise.all([
    conn('milling_costs').whereIn('batch_id', ids).select('batch_id', 'category', 'amount'),
    // Finished output of these batches that a blend re-milled (as the batch
    // list computes finished_consumed_kg).
    conn('batch_source_lots as bsl').join('inventory_lots as il', 'il.id', 'bsl.lot_id')
      .where('bsl.lot_type', 'finished').whereIn('il.batch_ref', ids.map((id) => `batch-${id}`))
      .groupBy('il.batch_ref').select('il.batch_ref', conn.raw('SUM(bsl.qty_kg) as consumed')),
    batchOutputValues(conn, ids),
  ]);
  const consumed = new Map(consumedRows.map((r) => [parseInt(String(r.batch_ref).replace('batch-', ''), 10), num(r.consumed)]));
  return foldProduction(batches, costs, consumed, outputValues);
}

const ACCOUNT_KIND = { 1210: 'raw', 1220: 'finished', 1230: 'finished', 1240: 'byproduct' };

/** working_capital.v1 — mill company stock at the D-14 value, today. */
async function workingCapital(conn) {
  const rows = await stockValueByAccount(conn, { entity: 'mill' });
  const out = { rawPkr: 0, finishedPkr: 0, byproductPkr: 0, rawKg: 0, finishedKg: 0, byproductKg: 0, lots: 0, unpricedLots: 0, inWipPkr: 0 };
  for (const r of rows) {
    const kind = ACCOUNT_KIND[r.account];
    if (!kind) continue;
    out[`${kind}Pkr`] += r.value;
    out[`${kind}Kg`] += r.onHandKg;
    out.lots += r.lots;
    out.unpricedLots += r.unpricedLots;
    out.inWipPkr += r.committedValue;
  }
  const total = out.rawPkr + out.finishedPkr + out.byproductPkr;
  return {
    contract: KPI_CONTRACTS.workingCapital,
    stockValueContract: KPI_CONTRACTS.stockValue,
    basis: 'landed_cost_per_kg_x_on_hand_kg',
    entity: 'mill',
    asOf: isoDay(new Date()),
    rawPkr: r2(out.rawPkr),
    finishedPkr: r2(out.finishedPkr),
    byproductPkr: r2(out.byproductPkr),
    totalPkr: r2(total),
    rawKg: r2(out.rawKg),
    finishedKg: r2(out.finishedKg),
    byproductKg: r2(out.byproductKg),
    lots: out.lots,
    unpricedLots: out.unpricedLots,
    // Of the total, what sits committed to open milling batches (GL 1260 WIP).
    committedToMillingPkr: r2(out.inWipPkr),
  };
}

/**
 * Everything the Mill Finance Overview shows, for one period.
 * @param opts { period: 'month'|'quarter'|'fytd'|'fy'|'all'|'custom', from, to, today }
 */
async function millFinanceKpis(conn, { period = 'month', from = null, to = null, today = new Date() } = {}) {
  const p = resolvePeriod({ period, from, to, today });
  const [profit, prod, wc] = await Promise.all([
    millProfit(conn, p),
    production(conn, p),
    workingCapital(conn),
  ]);
  return {
    period: p,
    asOf: isoDay(today),
    currency: 'PKR',
    unit: 'kg',
    contracts: {
      millProfit: KPI_CONTRACTS.millProfit,
      productionValue: KPI_CONTRACTS.productionValue,
      yield: KPI_CONTRACTS.yield,
      workingCapital: KPI_CONTRACTS.workingCapital,
      stockValue: KPI_CONTRACTS.stockValue,
    },
    profit,
    production: prod,
    workingCapital: wc,
  };
}

/**
 * yield.v1 on its own — quantities only, no money, so screens that may not
 * show cost (the Milling dashboard) can read it. Same batches and formula as
 * production().yieldPct.
 */
async function yieldKpi(conn, { period = 'all', from = null, to = null, today = new Date() } = {}) {
  const p = resolvePeriod({ period, from, to, today });
  const batches = await periodBatches(conn, p);
  let raw = 0; let fin = 0; let waste = 0;
  for (const b of batches) { raw += num(b.raw_qty_kg); fin += num(b.actual_finished_kg); waste += num(b.wastage_kg); }
  return {
    contract: KPI_CONTRACTS.yield,
    period: p,
    asOf: isoDay(today),
    unit: 'kg',
    yieldPct: weightedYieldPct(batches),
    wastagePct: pct(waste, raw),
    batchCount: batches.length,
    rawKg: r2(raw),
    finishedKg: r2(fin),
  };
}

// ── Drill-down: the rows behind each figure, paged on the server ──────────

const DETAIL_PARTS = ['sales', 'overheads', 'batches', 'stock'];

async function paged(conn, sql, params, { page, limit }) {
  const [{ total }] = rowsOf(await conn.raw(`SELECT COUNT(*)::int AS total FROM (${sql}) x`, params));
  const rows = rowsOf(await conn.raw(`${sql} LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]));
  return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * The rows behind a figure. part:
 *   sales      mill-output local sales + transfers to export in the period
 *              (mill_profit.v1 revenue / COGS)
 *   overheads  the period's mill overheads (mill_profit.v1 overheads)
 *   batches    the period's completed company batches (production_value.v1, yield.v1)
 *   stock      mill company lots on hand at the D-14 value (working_capital.v1)
 */
async function millFinanceDetail(conn, { part, period = 'month', from = null, to = null, today = new Date(), page = 1, limit = 100 } = {}) {
  if (!DETAIL_PARTS.includes(part)) {
    const e = new Error(`Unknown part '${part}'. Use one of: ${DETAIL_PARTS.join(', ')}.`);
    e.status = 400;
    throw e;
  }
  const p = resolvePeriod({ period, from, to, today });
  const pg = { page: Math.max(1, parseInt(page, 10) || 1), limit: Math.min(1000, Math.max(1, parseInt(limit, 10) || 100)) };
  let res;
  if (part === 'sales') {
    const params = [LOCAL_SALE_EXCLUDED];
    const salesWhere = dateClause('ls.sale_date', p, params);
    const tWhere = dateClause('COALESCE(t.transaction_date, t.created_at::date)', p, params);
    res = await paged(conn, `
      SELECT * FROM (
        SELECT 'local_sale' AS kind, ls.id, ls.sale_no AS ref, ls.sale_date::date::text AS day, ls.quantity_kg AS kg,
               ls.total_amount AS revenue_pkr, ls.cogs_total_pkr AS cogs_pkr, l.lot_no
          FROM local_sales ls JOIN inventory_lots l ON l.id = ls.lot_id
         WHERE ls.status <> ALL(?) AND COALESCE(l.entity, 'mill') = 'mill'
           AND l.type IN ('finished', 'byproduct') AND COALESCE(l.ownership, 'company') <> 'client'${salesWhere}
        UNION ALL
        SELECT 'transfer' AS kind, t.id, it.transfer_no, COALESCE(t.transaction_date, t.created_at::date)::text, t.quantity_kg,
               t.quantity_kg * it.transfer_price_pkr / 1000,
               t.quantity_kg * COALESCE(NULLIF(t.unit_cost, 0), NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.cost_per_unit, 0)),
               l.lot_no
          FROM lot_transactions t
          JOIN inventory_lots l ON l.id = t.lot_id
          JOIN internal_transfers it ON t.reference_no = 'transfer-' || it.id
         WHERE t.transaction_type = 'warehouse_transfer_out' AND COALESCE(l.entity, 'mill') = 'mill'
           AND l.type IN ('finished', 'byproduct') AND COALESCE(l.ownership, 'company') <> 'client'${tWhere}
      ) s ORDER BY s.day, s.kind, s.id`, params, pg);
  } else if (part === 'overheads') {
    const params = [EXPENSE_EXCLUDED];
    const bWhere = dateClause('be.expense_date', p, params);
    const mWhere = dateClause('me.expense_date', p, params);
    res = await paged(conn, `
      SELECT * FROM (
        SELECT 'business_expense' AS source, be.id, be.expense_date::date::text AS day, be.category,
               COALESCE(be.amount_pkr, CASE WHEN COALESCE(be.currency, 'PKR') = 'PKR' THEN be.amount END) AS amount_pkr
          FROM business_expenses be
         WHERE be.expense_type = 'mill' AND be.batch_id IS NULL AND be.order_id IS NULL
           AND COALESCE(be.payment_status, '') <> ALL(?)${bWhere}
        UNION ALL
        SELECT 'mill_expense', me.id, me.expense_date::date::text, me.category,
               CASE WHEN COALESCE(me.currency, 'PKR') = 'PKR' THEN me.amount END
          FROM mill_expenses me WHERE TRUE${mWhere}
      ) o ORDER BY o.day, o.source, o.id`, params, pg);
  } else if (part === 'batches') {
    const params = [];
    res = await paged(conn, `
      SELECT mb.id, mb.batch_no, mb.batch_name, mb.processing_type, mb.completed_at::date::text AS completed_on,
             mb.raw_qty_kg, mb.actual_finished_kg, mb.wastage_kg, mb.finished_price_per_kg,
             (SELECT COALESCE(SUM(mc.amount), 0) FROM milling_costs mc WHERE mc.batch_id = mb.id) AS batch_cost_pkr
        FROM milling_batches mb
       WHERE mb.status = 'Completed' AND mb.is_service_milling IS NOT TRUE${dateClause('mb.completed_at', p, params)}
       ORDER BY mb.completed_at, mb.id`, params, pg);
  } else {
    res = await paged(conn, `
      SELECT l.id, l.lot_no, l.type, ${lotAccountSql('l')} AS account, ${onHandKg('l')} AS on_hand_kg,
             COALESCE(l.landed_cost_per_kg, 0) AS landed_cost_per_kg, ${lotValueSql('l')} AS value_pkr
        FROM inventory_lots l
       WHERE l.entity = 'mill' AND ${ownershipSql('l', 'company')} AND ${onHandKg('l')} > 0
       ORDER BY l.type, l.id`, [], pg);
  }
  return { part, period: p, currency: 'PKR', unit: 'kg', ...res };
}

module.exports = {
  millProfit, production, foldProduction, workingCapital, yieldKpi, millFinanceKpis, millFinanceDetail, DETAIL_PARTS,
};
