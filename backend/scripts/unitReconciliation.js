/* eslint-disable no-console */
/**
 * Unit-conversion reconciliation harness (Phase 5-0).
 *
 * The MT→KG storage conversion (Phase 5c) is a PURE RE-EXPRESSION of units: every
 * physical KG quantity and every PKR money value must be numerically IDENTICAL
 * before and after. This tool proves that.
 *
 *   node scripts/unitReconciliation.js snapshot <out.json>
 *   node scripts/unitReconciliation.js compare  <before.json> <after.json>
 *
 * A snapshot stores values ALREADY NORMALIZED to KG / per-KG / PKR — the
 * normalization (×1000 for an MT-era qty column, ÷1000 for a per-MT price)
 * happens at snapshot time, keyed off the auto-detected storage era. So a
 * correct conversion yields two snapshots whose normalized numbers match within
 * epsilon, regardless of whether the columns are stored in MT (before) or KG
 * (after). compare() asserts that equality and lists every drift.
 *
 * Anchors of three independent kinds, so a bug in any one layer is caught:
 *   - GL trial balance (PKR straight from journal_lines) — never unit-touched.
 *   - Per-lot physical stock (net_weight_kg is already KG; qty/available/reserved
 *     normalized) — catches a bad data backfill.
 *   - Per-batch persisted costing (*_per_kg_finished already per-kg; yield qty +
 *     finished price normalized) — catches a bad code cutover (a stray ×1000).
 */

const path = require('path');
const fs = require('fs');
const db = require('../src/config/database');

const EPS = 0.02; // KG / PKR tolerance for float noise

// ── era detection + column picking ──────────────────────────────────────────
const _colCache = {};
async function colExists(table, col) {
  const key = `${table}.${col}`;
  if (key in _colCache) return _colCache[key];
  const r = await db.raw(
    `SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
    [table, col]
  );
  return (_colCache[key] = r.rows.length > 0);
}
async function pickCol(table, candidates) {
  for (const c of candidates) if (await colExists(table, c)) return c;
  return null;
}
async function detectEra() {
  // KG era once any quantity column has been renamed to its *_kg form.
  if (await colExists('milling_batches', 'raw_qty_kg')) return 'kg';
  if (await colExists('inventory_lots', 'qty_kg')) return 'kg';
  return 'mt';
}

const num = (v) => parseFloat(v) || 0;
const qtyToKg = (v, era) => num(v) * (era === 'mt' ? 1000 : 1);
const priceToPerKg = (v, era) => num(v) / (era === 'mt' ? 1000 : 1);
const r4 = (n) => Math.round(n * 10000) / 10000;

// ── snapshot ────────────────────────────────────────────────────────────────
async function snapshot() {
  const era = await detectEra();

  // 1) GL trial balance — pure PKR, independent of units.
  const tbRows = await db('journal_lines as jl')
    .join('journal_entries as je', 'jl.journal_id', 'je.id')
    .where('je.status', 'Posted')
    .groupBy('jl.account_id')
    .select('jl.account_id')
    .sum({ debit: 'jl.debit', credit: 'jl.credit' });
  const trialBalance = {};
  for (const r of tbRows) trialBalance[r.account_id] = { debit: r4(num(r.debit)), credit: r4(num(r.credit)) };

  // 2) Per-lot physical stock + value.
  const qtyC = await pickCol('inventory_lots', ['qty_kg', 'qty']);
  const availC = await pickCol('inventory_lots', ['available_qty_kg', 'available_qty']);
  const resvC = await pickCol('inventory_lots', ['reserved_qty_kg', 'reserved_qty']);
  const millResvC = await pickCol('inventory_lots', ['milling_reserved_qty_kg', 'milling_reserved_qty']);
  const lotRows = await db('inventory_lots').select('*').orderBy('id');
  const lots = lotRows.map((l) => ({
    id: l.id,
    lot_no: l.lot_no,
    physical_kg: qtyToKg(l[qtyC], era),
    available_kg: qtyToKg(l[availC], era),
    reserved_kg: qtyToKg(l[resvC], era),
    milling_reserved_kg: millResvC ? qtyToKg(l[millResvC], era) : 0,
    net_weight_kg: r4(num(l.net_weight_kg)), // already KG — must be identical
    total_value: r4(num(l.total_value)),
    landed_cost_total: r4(num(l.landed_cost_total)),
  }));

  // 3) Per-batch yield (KG) + persisted costing (per-kg / PKR).
  const rawC = await pickCol('milling_batches', ['raw_qty_kg', 'raw_qty_mt']);
  const finC = await pickCol('milling_batches', ['actual_finished_kg', 'actual_finished_mt']);
  const yieldCols = {};
  for (const base of ['broken', 'bran', 'husk', 'wastage', 'sortex_rejects', 'powder', 'sweeping', 'b1', 'b2', 'b3', 'csr', 'short_grain']) {
    yieldCols[base] = await pickCol('milling_batches', [`${base}_kg`, `${base}_mt`]);
  }
  const finPriceC = await pickCol('milling_batches', ['finished_price_per_kg', 'finished_price_per_mt']);
  const bRows = await db('milling_batches').select('*').orderBy('id');
  const batches = bRows.map((b) => {
    const yieldKg = {};
    for (const [base, col] of Object.entries(yieldCols)) yieldKg[base] = col ? qtyToKg(b[col], era) : 0;
    return {
      id: b.id,
      batch_no: b.batch_no,
      raw_kg: qtyToKg(b[rawC], era),
      finished_kg: qtyToKg(b[finC], era),
      yield_kg: yieldKg,
      // these costing columns are ALREADY per-kg / PKR and must not move
      raw_cost_per_kg_finished: r4(num(b.raw_cost_per_kg_finished)),
      milling_cost_per_kg_finished: r4(num(b.milling_cost_per_kg_finished)),
      total_cost_per_kg_finished: r4(num(b.total_cost_per_kg_finished)),
      raw_cost_total: r4(num(b.raw_cost_total)),
      finished_price_per_kg: r4(priceToPerKg(b[finPriceC], era)),
    };
  });

  // 4) Movements + reservations physical KG.
  const mQtyC = await pickCol('inventory_movements', ['qty_kg', 'qty']);
  const mRows = await db('inventory_movements').select('id', mQtyC + ' as q');
  const movements = mRows.map((m) => ({ id: m.id, qty_kg: qtyToKg(m.q, era) }));

  const rResvC = await pickCol('inventory_reservations', ['reserved_qty_kg', 'reserved_qty']);
  const rRows = await db('inventory_reservations').select('id', rResvC + ' as q');
  const reservations = rRows.map((r) => ({ id: r.id, reserved_kg: qtyToKg(r.q, era) }));

  // 5) Aggregate invariants.
  const aggregates = {
    total_physical_kg: r4(lots.reduce((s, l) => s + l.physical_kg, 0)),
    total_available_kg: r4(lots.reduce((s, l) => s + l.available_kg, 0)),
    total_net_weight_kg: r4(lots.reduce((s, l) => s + l.net_weight_kg, 0)),
    total_lot_value: r4(lots.reduce((s, l) => s + l.total_value, 0)),
  };

  return { era, generated_for: 'unit-reconciliation', trialBalance, lots, batches, movements, reservations, aggregates };
}

// ── compare ─────────────────────────────────────────────────────────────────
function near(a, b) { return Math.abs(num(a) - num(b)) <= EPS; }

function compare(before, after) {
  const drift = [];
  const note = (where, field, a, b) => drift.push(`${where} ${field}: before=${a} after=${b} (Δ=${r4(num(b) - num(a))})`);

  // trial balance
  const accts = new Set([...Object.keys(before.trialBalance), ...Object.keys(after.trialBalance)]);
  for (const acc of accts) {
    const x = before.trialBalance[acc] || { debit: 0, credit: 0 };
    const y = after.trialBalance[acc] || { debit: 0, credit: 0 };
    if (!near(x.debit, y.debit)) note(`TB acct ${acc}`, 'debit', x.debit, y.debit);
    if (!near(x.credit, y.credit)) note(`TB acct ${acc}`, 'credit', x.credit, y.credit);
  }

  // lots
  const byId = (arr) => Object.fromEntries(arr.map((r) => [r.id, r]));
  const lb = byId(before.lots), la = byId(after.lots);
  for (const id of new Set([...Object.keys(lb), ...Object.keys(la)])) {
    const x = lb[id], y = la[id];
    if (!x || !y) { drift.push(`lot ${id} present in only one snapshot`); continue; }
    for (const f of ['physical_kg', 'available_kg', 'reserved_kg', 'milling_reserved_kg', 'net_weight_kg', 'total_value', 'landed_cost_total']) {
      if (!near(x[f], y[f])) note(`lot ${id} (${x.lot_no})`, f, x[f], y[f]);
    }
  }

  // batches
  const bb = byId(before.batches), ba = byId(after.batches);
  for (const id of new Set([...Object.keys(bb), ...Object.keys(ba)])) {
    const x = bb[id], y = ba[id];
    if (!x || !y) { drift.push(`batch ${id} present in only one snapshot`); continue; }
    for (const f of ['raw_kg', 'finished_kg', 'raw_cost_per_kg_finished', 'milling_cost_per_kg_finished', 'total_cost_per_kg_finished', 'raw_cost_total', 'finished_price_per_kg']) {
      if (!near(x[f], y[f])) note(`batch ${id} (${x.batch_no})`, f, x[f], y[f]);
    }
    for (const k of new Set([...Object.keys(x.yield_kg), ...Object.keys(y.yield_kg)])) {
      if (!near(x.yield_kg[k], y.yield_kg[k])) note(`batch ${id} (${x.batch_no})`, `yield.${k}`, x.yield_kg[k], y.yield_kg[k]);
    }
  }

  // movements + reservations
  for (const [name, key] of [['movements', 'qty_kg'], ['reservations', 'reserved_kg']]) {
    const mb = byId(before[name]), ma = byId(after[name]);
    for (const id of new Set([...Object.keys(mb), ...Object.keys(ma)])) {
      const x = mb[id], y = ma[id];
      if (!x || !y) { drift.push(`${name} ${id} present in only one snapshot`); continue; }
      if (!near(x[key], y[key])) note(`${name} ${id}`, key, x[key], y[key]);
    }
  }

  // aggregates
  for (const f of Object.keys(before.aggregates)) {
    if (!near(before.aggregates[f], after.aggregates[f])) note('aggregate', f, before.aggregates[f], after.aggregates[f]);
  }

  return drift;
}

// ── cli ─────────────────────────────────────────────────────────────────────
(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'snapshot') {
      const snap = await snapshot();
      const out = a || `recon-${snap.era}.json`;
      fs.writeFileSync(path.resolve(out), JSON.stringify(snap, null, 2));
      console.log(`Snapshot written: ${out}  (era=${snap.era}, lots=${snap.lots.length}, batches=${snap.batches.length}, accounts=${Object.keys(snap.trialBalance).length})`);
      console.log(`  total_physical_kg=${snap.aggregates.total_physical_kg}  total_net_weight_kg=${snap.aggregates.total_net_weight_kg}  total_lot_value=${snap.aggregates.total_lot_value}`);
    } else if (cmd === 'compare') {
      if (!a || !b) throw new Error('compare needs <before.json> <after.json>');
      const before = JSON.parse(fs.readFileSync(path.resolve(a), 'utf8'));
      const after = JSON.parse(fs.readFileSync(path.resolve(b), 'utf8'));
      const drift = compare(before, after);
      if (drift.length === 0) {
        console.log(`✅ RECONCILED — every KG/PKR invariant identical (${before.era} → ${after.era}). ${after.lots.length} lots, ${after.batches.length} batches checked.`);
        process.exit(0);
      } else {
        console.log(`❌ ${drift.length} DRIFT(S) — conversion changed a value it must not have:`);
        for (const d of drift) console.log('   • ' + d);
        process.exit(1);
      }
    } else {
      console.log('usage: unitReconciliation.js snapshot <out.json> | compare <before.json> <after.json>');
      process.exit(2);
    }
  } finally {
    await db.destroy();
  }
})();
