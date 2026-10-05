const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const { NotFoundError, ValidationError } = require('../../shared/errors');
const inventoryService = require('../inventory/inventory.service');

// Sample Analysis & Purchase Shortlisting (#7). Samples carry a quality analysis
// stored as jsonb using the SAME key set as inventory_lots.quality_json (plus a
// few sample-only outputs — sw/powder/sortex/stone/processing_loss) so an
// approved sample converts straight into a purchase lot.

const SAMPLE_QUALITY_KEYS = [
  // aggregate
  'moisture', 'broken', 'foreign_matter', 'chalky', 'purity', 'discoloration', 'grain_size', 'whiteness',
  // Pakistani grade breakdown
  'b1', 'b2', 'b3', 'csr', 'short_grain', 'cobba', 'nb', 'ov',
  // sample-only quality outputs
  'sw', 'powder', 'sortex', 'stone', 'processing_loss',
  // free text
  'notes',
];
// The subset that maps 1:1 into inventory_lots.quality_json on conversion.
const LOT_PASSTHROUGH_KEYS = ['moisture', 'broken', 'foreign_matter', 'chalky', 'purity', 'discoloration', 'grain_size', 'whiteness', 'b1', 'b2', 'b3', 'csr', 'short_grain', 'cobba', 'nb', 'ov', 'notes'];

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null));
const round2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

function sanitizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of SAMPLE_QUALITY_KEYS) {
    const v = raw[k];
    if (v == null || v === '') continue;
    out[k] = k === 'notes' ? String(v).slice(0, 1000) : (num(v) ?? undefined);
    if (out[k] === undefined) delete out[k];
  }
  return Object.keys(out).length ? out : null;
}

// Derived metrics for shortlisting/comparison — a simple, transparent estimate.
// Expected finished % = 100 − broken − foreign matter − processing loss (clamped).
function deriveMetrics(sample) {
  const a = sample.final_analysis_json || sample.analysis_json || {};
  const loss = (num(a.broken) || 0) + (num(a.foreign_matter) || 0) + (num(a.processing_loss) || 0);
  const finishedPct = Math.max(0, Math.min(100, 100 - loss));
  const qty = num(sample.offered_qty_kg) || 0;
  const rate = num(sample.offered_rate_per_kg) || 0;
  const expectedFinishedKg = round2(qty * finishedPct / 100);
  const expectedCostPerFinishedKg = expectedFinishedKg > 0 ? round2((qty * rate) / expectedFinishedKg) : null;
  return {
    expectedFinishedPct: round2(finishedPct),
    expectedFinishedKg,
    processingLossPct: round2(num(a.processing_loss) || 0),
    expectedCostPerFinishedKg,
    offeredValue: round2(qty * rate),
  };
}

// Sample numbers used to be SMP-2026-0001 — opaque, and nothing like the lot the
// sample turns into. This mirrors the purchase-lot pattern (SUP-VARIETY-YYMMDD-SEQ,
// e.g. SHAP-1121BASM-260926-01) using the SAME helpers, so a sample and its lot
// abbreviate a supplier identically. Falls back to the old format when there is no
// supplier yet to key on.
async function buildSampleNo(trx, { supplierId, productId, date }) {
  if (!supplierId) {
    return nextDocNo(trx, { table: 'rice_samples', column: 'sample_no', prefix: `SMP-${new Date().getFullYear()}-`, pad: 4 });
  }
  const d = date ? new Date(date) : new Date();
  const dateStr = String(d.getFullYear()).slice(-2)
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const supCode = await inventoryService.deriveSupplierCode(trx, 'suppliers', supplierId, 'SUP');
  const varCode = productId ? await inventoryService.deriveProductCode(trx, productId) : 'SAMPLE';
  const prefix = `${supCode}-${varCode}-${dateStr}-`;
  const last = await trx('rice_samples').where('sample_no', 'like', `${prefix}%`).orderBy('sample_no', 'desc').first('sample_no');
  let seq = 1;
  if (last && last.sample_no) {
    const n = parseInt(last.sample_no.slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(2, '0')}`;
}

// sample_no carries a UNIQUE index, so a clash must be reported as a plain
// message rather than surfacing a raw constraint violation.
async function assertSampleNoFree(trx, sampleNo, exceptId) {
  const q = trx('rice_samples').whereRaw('lower(sample_no) = ?', [sampleNo.toLowerCase()]);
  if (exceptId) q.whereNot('id', exceptId);
  if (await q.first()) throw new ValidationError(`Sample ID "${sampleNo}" is already in use.`);
}

// Rename a sample. Allowed until it has been converted — after that the number is
// referenced by the lot it produced and by the audit trail.
async function rename(sampleId, sampleNo) {
  const wanted = String(sampleNo || '').trim();
  if (!wanted) throw new ValidationError('A sample ID is required.');
  if (wanted.length > 60) throw new ValidationError('Sample ID must be 60 characters or fewer.');
  const sample = await db('rice_samples').where({ id: sampleId }).first();
  if (!sample) throw new NotFoundError('Sample not found.');
  if (sample.status === 'Converted') throw new ValidationError('This sample has been converted to a purchase lot — its ID can no longer be changed.');
  if (wanted === sample.sample_no) return get(sampleId);
  await db.transaction(async (trx) => {
    await assertSampleNoFree(trx, wanted, sampleId);
    await trx('rice_samples').where({ id: sampleId }).update({ sample_no: wanted, updated_at: trx.fn.now() });
  });
  return get(sampleId);
}

async function create(payload, userId) {
  const p = payload || {};
  return db.transaction(async (trx) => {
    let sampleNo = String(p.sample_no || '').trim();
    if (sampleNo) {
      if (sampleNo.length > 60) throw new ValidationError('Sample ID must be 60 characters or fewer.');
      await assertSampleNoFree(trx, sampleNo, null);
    } else {
      sampleNo = await buildSampleNo(trx, { supplierId: p.supplier_id, productId: p.product_id, date: p.sample_date });
    }
    const [row] = await trx('rice_samples').insert({
      sample_no: sampleNo,
      sample_date: p.sample_date || new Date().toISOString().slice(0, 10),
      supplier_id: p.supplier_id || null,
      supplier_sample_ref: p.supplier_sample_ref || null,
      product_id: p.product_id || null,
      variety: p.variety || null,
      claimed_grade: p.claimed_grade || null,
      origin_area: p.origin_area || null,
      crop_year: p.crop_year || null,
      offered_qty_kg: num(p.offered_qty_kg),
      offered_rate_per_kg: num(p.offered_rate_per_kg),
      bags: p.bags != null && p.bags !== '' ? parseInt(p.bags, 10) : null,
      bag_weight_kg: num(p.bag_weight_kg),
      remarks: p.remarks || null,
      attachment_url: p.attachment_url || null,
      analysis_json: sanitizeAnalysis(p.analysis_json || p.analysis),
      analyzed_at: (p.analysis_json || p.analysis) ? trx.fn.now() : null,
      status: 'Under Review',
      created_by: userId || null,
    }).returning('*');
    return row;
  });
}

// which = 'initial' | 'final'
async function updateAnalysis(sampleId, which, analysis, userId) {
  const clean = sanitizeAnalysis(analysis);
  if (!clean) throw new ValidationError('No valid analysis values provided.');
  const sample = await db('rice_samples').where({ id: sampleId }).first();
  if (!sample) throw new NotFoundError('Sample not found.');
  if (sample.status === 'Converted') throw new ValidationError('This sample has already been converted to a purchase lot.');
  const patch = which === 'final'
    ? { final_analysis_json: clean, final_analyzed_at: db.fn.now() }
    : { analysis_json: clean, analyzed_at: db.fn.now() };
  await db('rice_samples').where({ id: sampleId }).update({ ...patch, updated_at: db.fn.now() });
  return get(sampleId);
}

const SHORTLIST_STATUSES = ['Under Review', 'Shortlisted', 'Rejected', 'Hold', 'Reanalysis Required', 'Approved for Purchase'];
async function setStatus(sampleId, status, notes, userId) {
  if (!SHORTLIST_STATUSES.includes(status)) throw new ValidationError(`Invalid status '${status}'.`);
  const sample = await db('rice_samples').where({ id: sampleId }).first();
  if (!sample) throw new NotFoundError('Sample not found.');
  if (sample.status === 'Converted') throw new ValidationError('This sample has already been converted.');
  await db('rice_samples').where({ id: sampleId }).update({
    status, decision_notes: notes || sample.decision_notes, decided_by: userId || null, updated_at: db.fn.now(),
  });
  return get(sampleId);
}

// Convert an approved sample into a purchase lot (reuses createPurchaseLot so the
// lot gets its payable / ledger / GL exactly like a normal purchase).
//
// The sample is CLAIMED first: a transaction locks its row (SELECT ... FOR NO
// KEY UPDATE — not FOR UPDATE, which would block the new lot's own
// inventory_lots.sample_id foreign-key check and deadlock) and holds the lock while the lot is created, then marks it Converted and
// commits. A second convert of the same sample waits on that lock and, once it
// gets it, re-reads the status and finds Converted — so two clicks (or two
// users) can no longer make two lots. ('Converting' would be a cleaner claim
// marker, but the status CHECK constraint doesn't allow it.) If creating the
// lot fails the transaction rolls back and the lock is released untouched.
async function convertToLot(sampleId, overrides, userId) {
  return db.transaction(async (trx) => {
    const sample = await trx('rice_samples').where({ id: sampleId }).forNoKeyUpdate().first();
    if (!sample) throw new NotFoundError('Sample not found.');
    if (sample.status === 'Converted' || sample.converted_lot_id) throw new ValidationError('This sample is already converted to a purchase lot.');
    if (!['Shortlisted', 'Approved for Purchase'].includes(sample.status)) {
      throw new ValidationError('Only a Shortlisted or Approved-for-Purchase sample can be converted.');
    }
    const o = overrides || {};
    const supplierId = o.supplier_id || sample.supplier_id;
    const productId = o.product_id || sample.product_id;
    if (!supplierId) throw new ValidationError('A supplier is required to create the purchase lot.');
    if (!productId) throw new ValidationError('A rice type (product) is required to create the purchase lot.');
    const qtyKg = num(o.qty_kg) || num(sample.offered_qty_kg);
    const rateKg = num(o.rate_per_kg) || num(sample.offered_rate_per_kg);
    if (!(qtyKg > 0)) throw new ValidationError('A positive quantity is required.');
    if (!(rateKg > 0)) throw new ValidationError('A positive rate is required.');

    // Carry the analysis forward into the lot's quality_json (pass-through subset).
    const analysis = sample.final_analysis_json || sample.analysis_json || {};
    const qualityJson = {};
    for (const k of LOT_PASSTHROUGH_KEYS) if (analysis[k] != null) qualityJson[k] = analysis[k];

    const product = await trx('products').where({ id: productId }).first();
    const itemName = o.item_name || sample.variety || (product && product.name) || 'Rice';

    const payload = {
      item_name: itemName, type: 'raw', entity: 'mill',
      sample_id: sample.id,
      supplier_id: supplierId, product_id: productId,
      variety: sample.variety || null, grade: sample.claimed_grade || (product && product.grade) || null,
      crop_year: sample.crop_year || null,
      moisture_pct: num(analysis.moisture), broken_pct: num(analysis.broken),
      quality_json: Object.keys(qualityJson).length ? qualityJson : null,
      quality_notes: sample.remarks || null,
      quantity_input: qtyKg, quantity_unit: 'kg',
      rate_input: rateKg, rate_unit: 'kg',
      bag_weight_kg: num(sample.bag_weight_kg) || 50,
      total_bags: sample.bags || null,
      purchase_date: o.purchase_date || new Date().toISOString().slice(0, 10),
      warehouse_id: o.warehouse_id || null,
      notes: `Converted from sample ${sample.sample_no}`,
    };

    // Invoke the existing purchase-lot creator with a synthetic req/res. It runs
    // its own transaction (on another connection); this one only holds the
    // sample's row lock until the lot exists and the sample says so.
    const lotController = require('../inventory/lotInventory.controller');
    const innerReq = { body: payload, user: { id: userId } };
    const cap = { _status: 200, status(c) { this._status = c; return this; }, json(b) { this._body = b; return this; } };
    await lotController.createPurchaseLot(innerReq, cap);
    if (cap._status >= 400) {
      const e = new Error(cap._body?.message || 'Failed to create the purchase lot from this sample.');
      e.statusCode = cap._status; throw e;
    }
    const lot = cap._body?.data?.lot;
    await trx('rice_samples').where({ id: sample.id }).update({
      status: 'Converted', converted_lot_id: lot?.id || null, converted_at: trx.fn.now(),
      decided_by: userId || null, updated_at: trx.fn.now(),
    });
    return { sample: await trx('rice_samples').where({ id: sample.id }).first(), lot };
  });
}

async function remove(sampleId) {
  const sample = await db('rice_samples').where({ id: sampleId }).first();
  if (!sample) throw new NotFoundError('Sample not found.');
  if (sample.status === 'Converted') throw new ValidationError('A converted sample cannot be deleted (it has a purchase lot).');
  await db('rice_samples').where({ id: sampleId }).del();
  return { deleted: true };
}

function enrich(row) {
  return { ...row, metrics: deriveMetrics(row) };
}

async function list(query = {}) {
  const q = db('rice_samples as s')
    .leftJoin('suppliers as sup', 's.supplier_id', 'sup.id')
    .leftJoin('products as p', 's.product_id', 'p.id')
    .select('s.*', 'sup.name as supplier_name', 'p.name as product_name')
    .orderBy('s.created_at', 'desc');
  if (query.status) q.where('s.status', query.status);
  if (query.supplier_id) q.where('s.supplier_id', query.supplier_id);
  const rows = await q;
  return rows.map(enrich);
}

async function get(sampleId) {
  const row = await db('rice_samples as s')
    .leftJoin('suppliers as sup', 's.supplier_id', 'sup.id')
    .leftJoin('products as p', 's.product_id', 'p.id')
    .leftJoin('inventory_lots as l', 's.converted_lot_id', 'l.id')
    .select('s.*', 'sup.name as supplier_name', 'p.name as product_name', 'l.lot_no as converted_lot_no')
    .where('s.id', sampleId).first();
  if (!row) throw new NotFoundError('Sample not found.');
  return enrich(row);
}

// Side-by-side comparison of several samples.
async function compare(ids) {
  const idList = (Array.isArray(ids) ? ids : String(ids || '').split(',')).map((x) => parseInt(x, 10)).filter(Boolean);
  if (!idList.length) return { samples: [], fields: SAMPLE_QUALITY_KEYS };
  const rows = await db('rice_samples as s')
    .leftJoin('suppliers as sup', 's.supplier_id', 'sup.id')
    .leftJoin('products as p', 's.product_id', 'p.id')
    .whereIn('s.id', idList)
    .select('s.*', 'sup.name as supplier_name', 'p.name as product_name');
  return { samples: rows.map(enrich), fields: SAMPLE_QUALITY_KEYS };
}

module.exports = { create, updateAnalysis, setStatus, convertToLot, rename, remove, list, get, compare, deriveMetrics, buildSampleNo, SAMPLE_QUALITY_KEYS };
