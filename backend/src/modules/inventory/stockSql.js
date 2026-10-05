// Shared SQL for "what stock do we hold" — ONE definition used by the Stock
// Summary, the printable stock report, valuation/aging/turnover, the executive
// summary, intelligence KPIs and stock-take, so they can no longer disagree.
//
//  * companyStock(q, alias, ownership) — client-owned Service Milling lots
//    (ownership='client') sit in our warehouse but belong to the client, so they
//    are never company stock. Default is company-only; ?ownership=client gives
//    the Service view and ?ownership=all an admin view of both.
//  * onHandKg(alias) — the KG physically on hand. net_weight_kg is moved 1:1 by
//    postMovement; lots predating it fall back to qty (KG since Phase 5c).
//  * unitsOnHand / kattaOnHand / bagsOnHand — sacks still on hand. total_bags is
//    the INTAKE count and is never decremented, so it is scaled by the weight
//    left. A katta is a 50 kg sack (an unknown pack size counts as katta);
//    anything packed smaller is a retail Bag and is counted separately.

const OWNERSHIPS = new Set(['company', 'client', 'all']);

const normaliseOwnership = (ownership) => {
  const v = String(ownership || '').toLowerCase();
  return OWNERSHIPS.has(v) ? v : 'company';
};

const col = (alias, name) => (alias ? `${alias}.${name}` : name);

/**
 * Restrict a Knex query on inventory_lots to the requested ownership.
 * @param {import('knex').Knex.QueryBuilder} q
 * @param {string} [alias] table alias ('' / null for the bare table)
 * @param {string} [ownership] 'company' (default) | 'client' | 'all'
 */
function companyStock(q, alias = 'l', ownership = 'company') {
  const o = normaliseOwnership(ownership);
  if (o === 'all') return q;
  return q.where(col(alias, 'ownership'), o);
}

/** SQL predicate form, for raw queries. */
function ownershipSql(alias = 'l', ownership = 'company') {
  const o = normaliseOwnership(ownership);
  if (o === 'all') return 'TRUE';
  return `${col(alias, 'ownership')} = '${o}'`;
}

const onHandKg = (a = 'l') =>
  `(CASE WHEN ${col(a, 'net_weight_kg')} > 0 THEN ${col(a, 'net_weight_kg')} ELSE CAST(${col(a, 'qty')} AS DECIMAL) END)`;

const packKg = (a = 'l') =>
  `COALESCE(NULLIF(${col(a, 'bag_weight_kg')}, 0), NULLIF(${col(a, 'bag_size_kg')}, 0), 0)`;

const unitsOnHand = (a = 'l') => `(CASE
        WHEN COALESCE(${col(a, 'total_bags')}, 0) > 0 AND COALESCE(${col(a, 'received_net_weight_kg')}, 0) > 0
          THEN LEAST(${col(a, 'total_bags')}::numeric, ROUND(${col(a, 'total_bags')} * (${onHandKg(a)} / ${col(a, 'received_net_weight_kg')})))
        ELSE ROUND(${onHandKg(a)} / COALESCE(NULLIF(${packKg(a)}, 0), 50))
      END)`;

const isKatta = (a = 'l') => `(${packKg(a)} = 0 OR ${packKg(a)} >= 50)`;
const kattaOnHand = (a = 'l') => `(CASE WHEN ${isKatta(a)} THEN ${unitsOnHand(a)} ELSE 0 END)`;
const bagsOnHand = (a = 'l') => `(CASE WHEN ${isKatta(a)} THEN 0 ELSE ${unitsOnHand(a)} END)`;

// The Lot Inventory "Subtype" key, mirroring lotSubtype() in LotInventory.jsx
// so the filter can run on the server (over every lot, not one page of them).
// A blended broken lot's grade is batch-scoped ('M-033-B1'): strip the prefix.
const baseGradeSql = (a = 'l') => `LOWER(CASE
      WHEN ${col(a, 'processing_type')} = 'blended' AND ${col(a, 'blend_batch_no')} IS NOT NULL
        AND LEFT(${col(a, 'grade')}, LENGTH(${col(a, 'blend_batch_no')}) + 1) = ${col(a, 'blend_batch_no')} || '-'
        THEN SUBSTRING(${col(a, 'grade')} FROM LENGTH(${col(a, 'blend_batch_no')}) + 2)
      ELSE COALESCE(${col(a, 'grade')}, '') END)`;

const lotSubtypeSql = (a = 'l') => {
  const name = `LOWER(COALESCE(${col(a, 'item_name')}, ''))`;
  const g = baseGradeSql(a);
  return `(CASE
      WHEN ${col(a, 'type')} = 'finished' THEN 'finished'
      WHEN ${col(a, 'type')} = 'raw' THEN 'rice-in'
      WHEN ${g} = 'b1' THEN 'broken-b1'
      WHEN ${g} = 'b2' THEN 'broken-b2'
      WHEN ${g} = 'b3' THEN 'broken-b3'
      WHEN ${g} = 'csr' THEN 'broken-csr'
      WHEN ${g} IN ('short grain', 'sg') THEN 'broken-sg'
      WHEN ${name} LIKE '%broken%' THEN 'broken'
      WHEN ${name} LIKE '%sortex%' THEN 'sortex'
      WHEN ${name} LIKE '%powder%' THEN 'powder'
      WHEN ${name} LIKE '%sweeping%' THEN 'sweeping'
      WHEN ${name} LIKE '%choba%' THEN 'choba'
      WHEN ${name} LIKE '%bran%' THEN 'bran'
      WHEN ${name} LIKE '%husk%' THEN 'husk'
      ELSE 'other' END)`;
};

/** Filter by Lot Inventory subtype; 'broken' is the rollup of every broken-*. */
function whereSubtype(q, subtype, alias = 'l') {
  if (!subtype || subtype === 'All') return q;
  if (subtype === 'broken') return q.whereRaw(`${lotSubtypeSql(alias)} LIKE 'broken%'`);
  return q.whereRaw(`${lotSubtypeSql(alias)} = ?`, [subtype]);
}

/** A lot that holds nothing is not stock, whatever its status says. */
function hasStock(q, alias = 'l') {
  return q.whereRaw(`${onHandKg(alias)} > 0`);
}

module.exports = {
  companyStock,
  ownershipSql,
  normaliseOwnership,
  hasStock,
  lotSubtypeSql,
  whereSubtype,
  onHandKg,
  packKg,
  unitsOnHand,
  isKatta,
  kattaOnHand,
  bagsOnHand,
  // Pre-built for the conventional `inventory_lots as l` alias.
  ON_HAND_KG: onHandKg('l'),
  PACK_KG: packKg('l'),
  UNITS_ON_HAND: unitsOnHand('l'),
  IS_KATTA: isKatta('l'),
  KATTA_ON_HAND: kattaOnHand('l'),
  BAGS_ON_HAND: bagsOnHand('l'),
};
