/**
 * Mill ▸ Rice Purchases ledger — one row per vehicle arrival (P3-14:
 * INV-01 / MIL-26).
 *
 * Everything is KG and Rs/kg, like the stock engine: value = weight_kg ×
 * price_per_kg. (It used to multiply KG by the per-MT price — 1000× too
 * high — and label the KG total "MT".)
 *
 * A truck reaches its lot either through its batch (the raw lot stamped
 * batch_ref 'batch-<id>') or directly (lot-first arrivals carry
 * milling_vehicle_arrivals.lot_id and no batch). Supplier and variety come
 * from the batch, else from that lot, so lot-first trucks are no longer
 * blank and the supplier / variety filters find them.
 */
const { perMtToPerKg } = require('../../shared/units');

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * The Rs/kg a truck was bought at. Same order the cost engine uses
 * (recomputeRawRiceCostFromVehicles / receiveRice): the truck's own price —
 * price_per_mt is the per-MT document figure, so ÷1000 — then the batch's
 * arrival analysis, then the lot's purchase rate (a lot-first or priced
 * source lot IS the price). null when nothing is priced.
 */
function vehiclePricePerKg(qj, arrival, lotRatePerKg) {
  const q = qj || {};
  const a = arrival || {};
  const perMt = numOrNull(q.price_per_mt);
  if (perMt != null && perMt > 0) return perMtToPerKg(perMt);
  const perKg = numOrNull(q.price_per_kg);
  if (perKg != null && perKg > 0) return perKg;
  const aKg = numOrNull(a.price_per_kg);
  if (aKg != null && aKg > 0) return aKg;
  const aMt = numOrNull(a.price_per_mt);
  if (aMt != null && aMt > 0) return perMtToPerKg(aMt);
  const lotRate = numOrNull(lotRatePerKg);
  return lotRate != null && lotRate > 0 ? lotRate : null;
}

/** Pure: one DB row → one ledger row (KG, Rs/kg, value). */
function shapePurchaseRow(r) {
  const qj = r.quality_json || {};
  const {
    aq_moisture: aqMoisture, aq_broken: aqBroken, aq_price_per_mt: aqPerMt, aq_price_per_kg: aqPerKg,
    lot_rate_per_kg: lotRate, ...rest
  } = r;
  const weightKg = numOrNull(r.weight_kg) || 0;
  const pricePerKg = vehiclePricePerKg(qj, { price_per_kg: aqPerKg, price_per_mt: aqPerMt }, lotRate);
  return {
    ...rest,
    weight_kg: weightKg,
    weighbridge_kg: numOrNull(r.weighbridge_kg),
    accepted_kg: numOrNull(r.accepted_kg),
    price_per_kg: pricePerKg,
    value_pkr: pricePerKg != null ? round2(weightKg * pricePerKg) : null,
    // The arrival analysis fills moisture / broken the truck row lacks; a
    // value on the truck's own quality_json wins.
    quality_json: {
      ...qj,
      moisture: qj.moisture ?? numOrNull(aqMoisture),
      broken: qj.broken ?? numOrNull(aqBroken),
    },
  };
}

function summarise(rows) {
  return {
    count: rows.length,
    totalWeightKg: round2(rows.reduce((s, r) => s + (r.weight_kg || 0), 0)),
    totalValuePKR: round2(rows.reduce((s, r) => s + (r.value_pkr || 0), 0)),
    // Trucks with no price anywhere — their weight counts, their value can't.
    unpricedCount: rows.filter((r) => r.price_per_kg == null).length,
  };
}

async function listRicePurchases(db, { from_date, to_date, supplier_id, product_id, limit = 500 } = {}) {
  let q = db('milling_vehicle_arrivals as va')
    .leftJoin('milling_batches as mb', 'va.batch_id', 'mb.id')
    // The batch's raw lot (one per batch with the merge logic) — picked
    // deterministically.
    .leftJoin(
      db('inventory_lots')
        .select('batch_ref', db.raw('MIN(id) as lot_id'))
        .where({ type: 'raw', entity: 'mill' })
        .groupBy('batch_ref')
        .as('blot'),
      'blot.batch_ref', db.raw("'batch-' || mb.id"),
    )
    // The truck's lot: its own lot_id (lot-first), else the batch's raw lot.
    .leftJoin('inventory_lots as vl', 'vl.id', db.raw('COALESCE(va.lot_id, blot.lot_id)'))
    .leftJoin('suppliers as s', 's.id', db.raw('COALESCE(mb.supplier_id, vl.supplier_id)'))
    .leftJoin('products as p', 'p.id', db.raw('COALESCE(mb.product_id, vl.product_id)'))
    // Arrival analysis carries the agreed price + moisture/broken for the
    // batch (entered after the truck arrives).
    .leftJoin(
      db.raw(`(SELECT DISTINCT ON (batch_id) batch_id, moisture, broken, price_per_kg, price_per_mt
               FROM milling_quality_samples WHERE analysis_type = 'arrival'
               ORDER BY batch_id, created_at DESC) as aq`),
      'aq.batch_id', 'mb.id',
    )
    .select(
      'va.id', 'va.vehicle_no', 'va.driver_name', 'va.driver_phone',
      'va.weight_kg', 'va.weighbridge_kg', 'va.accepted_kg',
      'va.bag_size_kg', 'va.total_bags', 'va.arrival_date', 'va.gate_pass_no',
      'va.quality_json', 'va.notes', 'va.created_at',
      'mb.id as batch_id', 'mb.batch_no', 'mb.status as batch_status',
      's.id as supplier_id', 's.name as supplier_name',
      'p.id as product_id', 'p.code as product_code', 'p.name as product_name',
      'vl.variety as variety',
      'vl.lot_no', 'vl.id as lot_id', 'vl.rate_per_kg as lot_rate_per_kg',
      'aq.moisture as aq_moisture', 'aq.broken as aq_broken',
      'aq.price_per_kg as aq_price_per_kg', 'aq.price_per_mt as aq_price_per_mt',
    )
    .orderBy('va.arrival_date', 'desc')
    .orderBy('va.created_at', 'desc')
    .limit(Math.min(parseInt(limit, 10) || 500, 2000));

  if (from_date) q = q.where('va.arrival_date', '>=', from_date);
  if (to_date) q = q.where('va.arrival_date', '<=', to_date);
  if (supplier_id) q = q.whereRaw('COALESCE(mb.supplier_id, vl.supplier_id) = ?', [supplier_id]);
  if (product_id) q = q.whereRaw('COALESCE(mb.product_id, vl.product_id) = ?', [product_id]);

  const purchases = (await q).map(shapePurchaseRow);
  return { purchases, summary: summarise(purchases) };
}

module.exports = { listRicePurchases, vehiclePricePerKg, shapePurchaseRow, summarise };
