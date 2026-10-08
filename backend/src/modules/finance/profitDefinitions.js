/**
 * Profit definitions — the ONE place every profit tile reads from (owner
 * decisions G-2 and G-3, 2026-10-09). All figures are PKR. No live FX rate is
 * ever used to price revenue or cost.
 *
 * EXPORT (G-2) — per export order whose status is not Draft / Cancelled, in the
 * period by ORDER DATE (export_orders.created_at):
 *
 *   revenue   = contract_value_pkr_locked, else contract_value × booked_fx_rate
 *               (a PKR order: contract_value). No booked figure → unpriced.
 *   op costs  = export_order_costs actually recorded, every category except the
 *               internal rice/milling allocations, in PKR.
 *   rice cost, first that applies:
 *     'locked'    inventory_cogs_total_pkr, once shipped / cost_locked_at_dispatch
 *     'reserved'  Active inventory_reservations × the lot's landed cost per kg
 *                 (any un-reserved remainder of the order's kg is estimated as
 *                 below → 'reserved+estimate', flagged estimated)
 *     'allocated' the internal rice/milling rows a linked batch or transfer put
 *                 on export_order_costs
 *     'estimate'  each line's kg × the weighted landed cost per kg of the
 *                 company's finished stock of that product — FLAGGED estimated
 *     unpriced    none of the above: left OUT of Booked and counted. Missing
 *                 cost is never read as 100% profit.
 *
 *   Booked    = Σ (revenue − op costs − rice cost) over priced orders.
 *   Realised  = Σ (revenue − op costs − locked COGS) over Shipped / Arrived /
 *               Closed orders with a locked COGS — the same amounts the GL posts
 *               at shipment (4xxx revenue, 5020 COGS). A shipped order with no
 *               locked COGS is counted in realisedUnpricedCount, not guessed.
 *               Same order-date period as Booked, so Pipeline = Booked − Realised
 *               (the GL dates the shipment journal by shipment date instead).
 *   FX        = PKR actually received (advance_received_pkr + balance_received_pkr)
 *               − the same foreign amounts at the booked rate. Realised FX only;
 *               the open balance revalued at today's rate is returned apart as
 *               fxOpenRevaluationPkr and is never added to profit.
 *   Pipeline  = Booked − Realised.
 *
 * MILL (G-3) — mill profit = sales of mill output − the cost of those sales.
 * Unsold output is stock, not profit. In the period by sale / movement date:
 *
 *   - local sales of a company mill-output lot (entity 'mill', type finished or
 *     byproduct): revenue total_amount, cost cogs_total_pkr (the COGS the sale
 *     posted to 5000). A sale of such a lot with no COGS is left out and counted.
 *   - transfers of mill output to export (lot_transactions warehouse_transfer_out
 *     tied to internal_transfers): revenue = kg × the transfer price, cost =
 *     kg × the moved lot's cost per kg.
 *
 * LOCAL (other) — every other local sale: raw-rice lots, service / labour /
 * packaging lines. A lot sale with no COGS is left out and counted; a line with
 * no lot (service, packaging) has cost cogs_total_pkr or 0.
 *
 * Each local_sales row lands in exactly ONE of mill / local, so no sale is
 * counted twice. A transfer's mill margin plus the export order's profit (whose
 * rice is carried at the transfer price) add up to contract − true cost, so
 * the consolidated figure doesn't double count across mill and export either.
 *
 * CONSOLIDATED: booked = export Booked + mill realised + local other;
 *               realised = export Realised + mill realised + local other.
 *               FX is shown beside them, never inside.
 */

const EXCLUDED_ORDER_STATUSES = ['Draft', 'Cancelled'];
const SHIPPED_STATUSES = ['Shipped', 'Arrived', 'Closed'];
const LOCAL_SALE_EXCLUDED = ['Cancelled', 'Voided', 'Returned', 'Pending'];
const INTERNAL_COST_CATS = ['rice', 'raw_rice', 'milling'];
// A reservation covering at least this share of the order's kg needs no estimate.
const COVERAGE_TOLERANCE = 0.005;

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

// 'YYYY-MM-DD' from a date string / timestamp string / Date, else null.
function toDay(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function period({ startDate, endDate } = {}) {
  return { from: toDay(startDate), to: toDay(endDate) };
}

// "col::date between from and to", only the bounds that are set.
function dateClause(col, { from, to }, params) {
  const parts = [];
  if (from) { parts.push(`(${col})::date >= ?::date`); params.push(from); }
  if (to) { parts.push(`(${col})::date <= ?::date`); params.push(to); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

const rowsOf = (res) => (Array.isArray(res) ? res : (res && res.rows) || []);

// A cost row in PKR. Operational costs are PKR by rule (mig 079); the internal
// allocation rows are in the order's currency with base_amount_pkr beside them.
function costRowPkr(c, orderRate) {
  const amt = num(c.amount);
  if (!amt) return 0;
  const cur = String(c.currency || 'PKR').toUpperCase();
  if (cur === 'PKR') return amt;
  if (num(c.base_amount_pkr)) return num(c.base_amount_pkr);
  if (num(c.fx_rate)) return amt * num(c.fx_rate);
  return orderRate ? amt * orderRate : amt;
}

/**
 * The export figures, per order and in total.
 * @param conn knex instance / transaction
 * @param opts { startDate, endDate, currentFxRate }
 */
async function exportProfit(conn, { startDate, endDate, currentFxRate } = {}) {
  const p = period({ startDate, endDate });
  const params = [EXCLUDED_ORDER_STATUSES];
  const orders = rowsOf(await conn.raw(`
    SELECT id, order_no, status, currency, contract_value, booked_fx_rate,
           contract_value_pkr_locked, inventory_cogs_total_pkr, cost_locked_at_dispatch,
           advance_received, advance_received_pkr, balance_received, balance_received_pkr,
           product_id, qty_mt, created_at
      FROM export_orders
     WHERE status <> ALL(?)${dateClause('created_at', p, params)}
     ORDER BY id`, params));

  const ids = orders.map((o) => o.id);
  let costs = []; let reserved = []; let lines = []; let rates = [];
  if (ids.length) {
    costs = rowsOf(await conn.raw(`
      SELECT order_id, category, amount, currency, base_amount_pkr, fx_rate
        FROM export_order_costs WHERE order_id = ANY(?)`, [ids]));
    reserved = rowsOf(await conn.raw(`
      SELECT r.order_id,
             SUM(r.reserved_qty) AS kg,
             SUM(CASE WHEN COALESCE(NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.cost_per_unit, 0)) IS NOT NULL
                      THEN r.reserved_qty END) AS costed_kg,
             SUM(r.reserved_qty * COALESCE(NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.cost_per_unit, 0), 0)) AS cost_pkr
        FROM inventory_reservations r
        JOIN inventory_lots l ON l.id = r.lot_id
       WHERE r.status = 'Active' AND r.order_id = ANY(?)
       GROUP BY r.order_id`, [ids]));
    lines = rowsOf(await conn.raw(`
      SELECT order_id, product_id, qty_mt FROM export_order_items WHERE order_id = ANY(?)`, [ids]));
    // Estimate basis: what the company's finished stock of each product is
    // carried at (weighted landed cost per kg of lots that still hold stock).
    rates = rowsOf(await conn.raw(`
      SELECT product_id,
             SUM(qty * COALESCE(NULLIF(landed_cost_per_kg, 0), cost_per_unit)) / NULLIF(SUM(qty), 0) AS per_kg
        FROM inventory_lots
       WHERE type = 'finished' AND qty > 0 AND product_id IS NOT NULL
         AND COALESCE(ownership, 'company') <> 'client' AND status <> 'Closed'
         AND COALESCE(NULLIF(landed_cost_per_kg, 0), NULLIF(cost_per_unit, 0)) IS NOT NULL
       GROUP BY product_id`));
  }
  const rateByProduct = new Map(rates.map((r) => [Number(r.product_id), num(r.per_kg)]));
  const resByOrder = new Map(reserved.map((r) => [Number(r.order_id), r]));

  const fxNow = num(currentFxRate);
  const rows = orders.map((o) => {
    const currency = String(o.currency || 'USD').toUpperCase();
    const bookedRate = currency === 'PKR' ? 1 : num(o.booked_fx_rate);
    const contract = num(o.contract_value);
    const lockedRevenue = num(o.contract_value_pkr_locked);
    const revenuePkr = lockedRevenue > 0 ? lockedRevenue
      : (currency === 'PKR' ? contract : (bookedRate > 0 ? contract * bookedRate : null));

    const orderCosts = costs.filter((c) => Number(c.order_id) === Number(o.id));
    const opCostsPkr = orderCosts.filter((c) => !INTERNAL_COST_CATS.includes(c.category))
      .reduce((s, c) => s + costRowPkr(c, bookedRate), 0);
    const allocatedPkr = orderCosts.filter((c) => INTERNAL_COST_CATS.includes(c.category))
      .reduce((s, c) => s + costRowPkr(c, bookedRate), 0);

    const orderLines = lines.filter((l) => Number(l.order_id) === Number(o.id));
    const kgLines = (orderLines.length ? orderLines : [{ product_id: o.product_id, qty_mt: o.qty_mt }])
      .map((l) => ({ productId: l.product_id ? Number(l.product_id) : null, kg: num(l.qty_mt) * 1000 }));
    const orderKg = kgLines.reduce((s, l) => s + l.kg, 0);
    // kg × stock cost per kg for every line, or null when any line has no basis.
    const estimateFor = (shareKg) => {
      if (!orderKg) return null;
      let total = 0;
      for (const l of kgLines) {
        const rate = l.productId ? rateByProduct.get(l.productId) : null;
        if (!rate) return null;
        total += (shareKg * (l.kg / orderKg)) * rate;
      }
      return total;
    };

    const shipped = SHIPPED_STATUSES.includes(o.status);
    const lockedCogs = num(o.inventory_cogs_total_pkr);
    const res = resByOrder.get(Number(o.id));
    let riceCostPkr = null; let riceCostBasis = 'unpriced'; let estimated = false;
    if (lockedCogs > 0 && (shipped || o.cost_locked_at_dispatch)) {
      riceCostPkr = lockedCogs; riceCostBasis = 'locked';
    } else if (res && num(res.costed_kg) > 0) {
      const remainder = Math.max(0, orderKg - num(res.costed_kg));
      if (orderKg > 0 && remainder > orderKg * COVERAGE_TOLERANCE) {
        const est = estimateFor(remainder);
        if (est != null) {
          riceCostPkr = num(res.cost_pkr) + est; riceCostBasis = 'reserved+estimate'; estimated = true;
        }
      } else {
        riceCostPkr = num(res.cost_pkr); riceCostBasis = 'reserved';
      }
    } else if (allocatedPkr > 0) {
      riceCostPkr = allocatedPkr; riceCostBasis = 'allocated';
    } else {
      const est = estimateFor(orderKg);
      if (est != null) { riceCostPkr = est; riceCostBasis = 'estimate'; estimated = true; }
    }

    const priced = revenuePkr != null && riceCostPkr != null;
    const bookedProfitPkr = priced ? revenuePkr - opCostsPkr - riceCostPkr : null;
    const realised = shipped && lockedCogs > 0 && revenuePkr != null;
    const realisedProfitPkr = realised ? revenuePkr - opCostsPkr - lockedCogs : null;

    // Realised FX: PKR the bank actually credited vs the same foreign amount at
    // the booked rate. Only for a foreign order with a booked rate.
    const receivedForeign = num(o.advance_received) + num(o.balance_received);
    const receivedPkr = num(o.advance_received_pkr) + num(o.balance_received_pkr);
    const fxRealisedPkr = (currency !== 'PKR' && bookedRate > 0 && receivedForeign > 0 && receivedPkr > 0)
      ? receivedPkr - receivedForeign * bookedRate : 0;
    const openForeign = Math.max(0, contract - receivedForeign);
    const fxOpenRevaluationPkr = (currency !== 'PKR' && bookedRate > 0 && fxNow > 0)
      ? openForeign * (fxNow - bookedRate) : 0;

    return {
      id: o.id,
      orderNo: o.order_no,
      status: o.status,
      orderDate: toDay(o.created_at),
      currency,
      contractValueForeign: contract,
      bookedFxRate: bookedRate || null,
      revenuePkr: revenuePkr == null ? null : r2(revenuePkr),
      opCostsPkr: r2(opCostsPkr),
      riceCostPkr: riceCostPkr == null ? null : r2(riceCostPkr),
      riceCostBasis,
      estimated,
      priced,
      totalCostPkr: riceCostPkr == null ? null : r2(opCostsPkr + riceCostPkr),
      bookedProfitPkr: bookedProfitPkr == null ? null : r2(bookedProfitPkr),
      realised,
      realisedProfitPkr: realisedProfitPkr == null ? null : r2(realisedProfitPkr),
      shippedMissingCogs: shipped && !(lockedCogs > 0),
      fxRealisedPkr: r2(fxRealisedPkr),
      fxOpenRevaluationPkr: r2(fxOpenRevaluationPkr),
      marginPct: priced && revenuePkr > 0 ? parseFloat(((bookedProfitPkr / revenuePkr) * 100).toFixed(1)) : null,
    };
  });

  const sum = (list, k) => r2(list.reduce((s, r) => s + num(r[k]), 0));
  const priced = rows.filter((r) => r.priced);
  const realisedRows = rows.filter((r) => r.realised);
  const unpriced = rows.filter((r) => !r.priced);
  const booked = sum(priced, 'bookedProfitPkr');
  const realisedTotal = sum(realisedRows, 'realisedProfitPkr');
  const bookedRevenue = sum(priced, 'revenuePkr');
  return {
    rows,
    totals: {
      orderCount: rows.length,
      bookedPkr: booked,
      bookedRevenuePkr: bookedRevenue,
      bookedMarginPct: bookedRevenue > 0 ? parseFloat(((booked / bookedRevenue) * 100).toFixed(1)) : null,
      pricedCount: priced.length,
      estimatedCount: rows.filter((r) => r.estimated).length,
      estimatedRiceCostPkr: sum(rows.filter((r) => r.estimated), 'riceCostPkr'),
      unpricedCount: unpriced.length,
      unpricedRevenuePkr: sum(unpriced, 'revenuePkr'),
      realisedPkr: realisedTotal,
      realisedCount: realisedRows.length,
      realisedRevenuePkr: sum(realisedRows, 'revenuePkr'),
      realisedUnpricedCount: rows.filter((r) => r.shippedMissingCogs).length,
      pipelinePkr: r2(booked - realisedTotal),
      fxRealisedPkr: sum(rows, 'fxRealisedPkr'),
      fxOpenRevaluationPkr: sum(rows, 'fxOpenRevaluationPkr'),
      opCostsPkr: sum(rows, 'opCostsPkr'),
      riceCostPkr: sum(priced, 'riceCostPkr'),
    },
  };
}

/**
 * Local sales split into mill output and other, plus mill → export transfers.
 * @returns { mill: {...totals, sales, transfers}, local: {...totals} }
 */
async function millAndLocalProfit(conn, { startDate, endDate } = {}) {
  const p = period({ startDate, endDate });
  const params = [LOCAL_SALE_EXCLUDED];
  const sales = rowsOf(await conn.raw(`
    SELECT ls.id, ls.sale_no, ls.sale_date, ls.status, ls.item_type, ls.item_name, ls.lot_id,
           ls.quantity_kg, ls.total_amount, ls.cogs_total_pkr,
           l.type AS lot_type, l.entity AS lot_entity, l.batch_ref,
           COALESCE(l.ownership, 'company') AS ownership
      FROM local_sales ls
      LEFT JOIN inventory_lots l ON l.id = ls.lot_id
     WHERE ls.status <> ALL(?)${dateClause('ls.sale_date', p, params)}
     ORDER BY ls.id`, params));

  const tParams = [];
  const transfers = rowsOf(await conn.raw(`
    SELECT t.id AS txn_id, t.transaction_date, t.quantity_kg, l.id AS lot_id, l.batch_ref,
           it.id AS transfer_id, it.transfer_no, it.transfer_price_pkr,
           t.quantity_kg * COALESCE(NULLIF(t.unit_cost, 0), NULLIF(l.landed_cost_per_kg, 0), NULLIF(l.cost_per_unit, 0)) AS cost_pkr
      FROM lot_transactions t
      JOIN inventory_lots l ON l.id = t.lot_id
      JOIN internal_transfers it ON t.reference_no = 'transfer-' || it.id
     WHERE t.transaction_type = 'warehouse_transfer_out'
       AND COALESCE(l.entity, 'mill') = 'mill'
       AND l.type IN ('finished', 'byproduct')
       AND COALESCE(l.ownership, 'company') <> 'client'${dateClause('COALESCE(t.transaction_date, t.created_at::date)', p, tParams)}`, tParams));

  return foldMillAndLocal(sales, transfers);
}

const isMillOutputLot = (s) => s.lot_id != null
  && String(s.lot_entity || 'mill') === 'mill'
  && ['finished', 'byproduct'].includes(s.lot_type)
  && s.ownership !== 'client';

// Pure fold (unit-tested): sales + transfer movements → mill / local totals.
function foldMillAndLocal(sales = [], transfers = []) {
  const mill = { revenuePkr: 0, cogsPkr: 0, profitPkr: 0, saleCount: 0, soldKg: 0, uncostedCount: 0, uncostedRevenuePkr: 0,
    localSalesRevenuePkr: 0, transferRevenuePkr: 0, transferCostPkr: 0, transferKg: 0, transferCount: 0 };
  const local = { revenuePkr: 0, cogsPkr: 0, profitPkr: 0, saleCount: 0, uncostedCount: 0, uncostedRevenuePkr: 0 };
  const saleSegments = [];

  for (const s of sales) {
    const revenue = num(s.total_amount);
    const cogs = num(s.cogs_total_pkr);
    const millOut = isMillOutputLot(s);
    const seg = millOut ? mill : local;
    seg.saleCount += 1;
    // A sale drawn from a lot must carry its COGS; without it the margin would
    // read as the whole price. A line with no lot (service, packaging) has none.
    const uncosted = s.lot_id != null && !(cogs > 0);
    saleSegments.push({ id: s.id, saleNo: s.sale_no, segment: millOut ? 'mill' : 'local', uncosted });
    if (uncosted) { seg.uncostedCount += 1; seg.uncostedRevenuePkr += revenue; continue; }
    seg.revenuePkr += revenue;
    seg.cogsPkr += cogs;
    seg.profitPkr += revenue - cogs;
    if (millOut) { mill.soldKg += num(s.quantity_kg); mill.localSalesRevenuePkr += revenue; }
  }

  const seen = new Set();
  for (const t of transfers) {
    const kg = num(t.quantity_kg);
    const revenue = kg * (num(t.transfer_price_pkr) / 1000); // transfer price is PKR per MT
    const cost = t.cost_pkr == null ? null : num(t.cost_pkr);
    if (cost == null || !(cost > 0)) { mill.uncostedCount += 1; mill.uncostedRevenuePkr += revenue; continue; }
    mill.revenuePkr += revenue;
    mill.cogsPkr += cost;
    mill.profitPkr += revenue - cost;
    mill.transferRevenuePkr += revenue;
    mill.transferCostPkr += cost;
    mill.transferKg += kg;
    mill.soldKg += kg;
    seen.add(t.transfer_id);
  }
  mill.transferCount = seen.size;

  for (const seg of [mill, local]) {
    for (const k of Object.keys(seg)) if (k.endsWith('Pkr') || k.endsWith('Kg')) seg[k] = r2(seg[k]);
    seg.marginPct = seg.revenuePkr > 0 ? parseFloat(((seg.profitPkr / seg.revenuePkr) * 100).toFixed(1)) : null;
  }
  return { mill, local, saleSegments };
}

/**
 * Per completed batch: its output at cost, what of it has been sold so far
 * (local sales + transfers to export, to date) and what is still in stock.
 * Information only — the period's mill profit is millAndLocalProfit().
 */
async function millBatchRows(conn, { startDate, endDate } = {}) {
  const p = period({ startDate, endDate });
  const params = [];
  const batches = rowsOf(await conn.raw(`
    SELECT id, batch_no, status, raw_qty_kg, actual_finished_kg, yield_pct, completed_at
      FROM milling_batches
     WHERE status = 'Completed'${dateClause('completed_at', p, params)}
     ORDER BY id`, params));
  if (!batches.length) return [];
  const refs = batches.map((b) => `batch-${b.id}`);

  const lots = rowsOf(await conn.raw(`
    SELECT l.id, l.batch_ref, l.type, l.qty,
           COALESCE(NULLIF(l.landed_cost_per_kg, 0), l.cost_per_unit, 0) AS per_kg,
           (SELECT COALESCE(SUM(t.quantity_kg), 0) FROM lot_transactions t
             WHERE t.lot_id = l.id AND t.reference_module = 'milling_batch'
               AND t.transaction_type IN ('milling_receipt', 'byproduct_receipt')) AS yield_kg
      FROM inventory_lots l
     WHERE l.batch_ref = ANY(?) AND l.type IN ('finished', 'byproduct')
       AND l.status <> 'Closed' AND COALESCE(l.ownership, 'company') <> 'client'`, [refs]));
  const lotIds = lots.map((l) => l.id);

  let sales = []; let moves = [];
  if (lotIds.length) {
    sales = rowsOf(await conn.raw(`
      SELECT lot_id, SUM(quantity_kg) AS kg, SUM(total_amount) AS revenue, SUM(COALESCE(cogs_total_pkr, 0)) AS cogs,
             COUNT(*) FILTER (WHERE COALESCE(cogs_total_pkr, 0) = 0) AS uncosted
        FROM local_sales WHERE lot_id = ANY(?) AND status <> ALL(?) GROUP BY lot_id`, [lotIds, LOCAL_SALE_EXCLUDED]));
    moves = rowsOf(await conn.raw(`
      SELECT t.lot_id, SUM(t.quantity_kg) AS kg,
             SUM(t.quantity_kg * it.transfer_price_pkr / 1000) AS revenue,
             SUM(t.quantity_kg * COALESCE(NULLIF(t.unit_cost, 0), NULLIF(l.landed_cost_per_kg, 0), l.cost_per_unit, 0)) AS cogs
        FROM lot_transactions t
        JOIN inventory_lots l ON l.id = t.lot_id
        JOIN internal_transfers it ON t.reference_no = 'transfer-' || it.id
       WHERE t.transaction_type = 'warehouse_transfer_out' AND t.lot_id = ANY(?)
       GROUP BY t.lot_id`, [lotIds]));
  }
  const salesByLot = new Map(sales.map((s) => [Number(s.lot_id), s]));
  const movesByLot = new Map(moves.map((m) => [Number(m.lot_id), m]));

  return batches.map((b) => {
    const mine = lots.filter((l) => l.batch_ref === `batch-${b.id}`);
    const acc = { outputKg: 0, outputValuePkr: 0, soldKg: 0, soldRevenuePkr: 0, soldCogsPkr: 0, unsoldKg: 0, unsoldValuePkr: 0, uncostedSales: 0 };
    for (const l of mine) {
      const perKg = num(l.per_kg);
      acc.outputKg += num(l.yield_kg);
      acc.outputValuePkr += num(l.yield_kg) * perKg;
      acc.unsoldKg += Math.max(0, num(l.qty));
      acc.unsoldValuePkr += Math.max(0, num(l.qty)) * perKg;
      const s = salesByLot.get(Number(l.id));
      if (s) {
        acc.soldKg += num(s.kg); acc.soldRevenuePkr += num(s.revenue); acc.soldCogsPkr += num(s.cogs);
        acc.uncostedSales += parseInt(s.uncosted, 10) || 0;
      }
      const m = movesByLot.get(Number(l.id));
      if (m) { acc.soldKg += num(m.kg); acc.soldRevenuePkr += num(m.revenue); acc.soldCogsPkr += num(m.cogs); }
    }
    const soldProfit = acc.soldRevenuePkr - acc.soldCogsPkr;
    return {
      id: b.id,
      batchNo: b.batch_no,
      status: b.status,
      completedAt: b.completed_at,
      rawQtyMT: num(b.raw_qty_kg) / 1000,
      finishedMT: num(b.actual_finished_kg) / 1000,
      yieldPct: num(b.yield_pct),
      outputKg: r2(acc.outputKg),
      outputValueAtCostPkr: r2(acc.outputValuePkr),
      soldKg: r2(acc.soldKg),
      soldRevenuePkr: r2(acc.soldRevenuePkr),
      soldCogsPkr: r2(acc.soldCogsPkr),
      soldProfitPkr: r2(soldProfit),
      soldMarginPct: acc.soldRevenuePkr > 0 ? parseFloat(((soldProfit / acc.soldRevenuePkr) * 100).toFixed(1)) : null,
      unsoldKg: r2(acc.unsoldKg),
      unsoldValueAtCostPkr: r2(acc.unsoldValuePkr),
      uncostedSales: acc.uncostedSales,
      hasOutputLots: mine.length > 0,
      currency: 'PKR',
    };
  });
}

/**
 * Everything at once — the shape every tile reads.
 */
async function profitDefinitions(conn, { startDate, endDate, currentFxRate } = {}) {
  const [exp, ml] = await Promise.all([
    exportProfit(conn, { startDate, endDate, currentFxRate }),
    millAndLocalProfit(conn, { startDate, endDate }),
  ]);
  const t = exp.totals;
  return {
    period: period({ startDate, endDate }),
    currency: 'PKR',
    export: t,
    exportRows: exp.rows,
    mill: ml.mill,
    local: ml.local,
    consolidated: {
      bookedPkr: r2(t.bookedPkr + ml.mill.profitPkr + ml.local.profitPkr),
      realisedPkr: r2(t.realisedPkr + ml.mill.profitPkr + ml.local.profitPkr),
      fxRealisedPkr: t.fxRealisedPkr,
    },
  };
}

module.exports = {
  profitDefinitions,
  exportProfit,
  millAndLocalProfit,
  millBatchRows,
  foldMillAndLocal,
  isMillOutputLot,
  toDay,
  EXCLUDED_ORDER_STATUSES,
  SHIPPED_STATUSES,
  LOCAL_SALE_EXCLUDED,
  INTERNAL_COST_CATS,
};
