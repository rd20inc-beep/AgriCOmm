/**
 * One-off backfill — rename existing incoming-rice lots from the old
 * LOT-YYYYMMDD-SSSS format to the new SUP-VARIETY-YYMMDD-SEQ format.
 *
 * The mill receives already-milled finished rice from upstream suppliers
 * and stores it as type='raw' (raw from the mill's perspective). This
 * script renames those receipt lots only.
 *
 * Scope:
 *   - Only inventory_lots WHERE type='raw' AND entity='mill'
 *   - Output lots (finished, byproduct) keep their existing lot_no.
 *
 * For each affected lot we build the new code from:
 *   SUP     = first 3-6 alnum chars of supplier name (collision-extended)
 *   VARIETY = product.code if set, else first 3-6 alnum chars of product.name
 *   YYMMDD  = lot.created_at date
 *   SEQ     = per (supplier, product, date) ordered by created_at
 *
 * If we can't resolve supplier or product, we fall back to a marker
 * ('UNK' / 'RAW') so the format stays parseable.
 *
 * Idempotent — lots already matching `^[A-Z0-9]+-[A-Z0-9]+-\d{6}-\d{2,}$`
 * are skipped.
 *
 * Run inside the backend container:
 *   docker exec riceflow-backend node scripts/renameRiceLotsToNewFormat.js
 *
 * Add --dry to preview without writing:
 *   docker exec riceflow-backend node scripts/renameRiceLotsToNewFormat.js --dry
 */
require('dotenv').config();
const db = require('../src/config/database');

const DRY = process.argv.includes('--dry');
const NEW_FORMAT = /^[A-Z0-9]+-[A-Z0-9]+-\d{6}-\d{2,}$/;

function alnumUpper(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function ymd(date) {
  const d = new Date(date);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

async function buildSupplierCode(trx, supplierId, cache) {
  if (!supplierId) return 'UNK';
  if (cache.has(supplierId)) return cache.get(supplierId);
  const row = await trx('suppliers').where({ id: supplierId }).first('name');
  const base = alnumUpper(row && row.name);
  if (!base) {
    cache.set(supplierId, 'UNK');
    return 'UNK';
  }
  for (let len = 3; len <= 6; len++) {
    const candidate = base.slice(0, len);
    const dup = await trx('suppliers')
      .whereRaw('UPPER(REGEXP_REPLACE(name, ?, ?, ?)) LIKE ?', ['[^A-Za-z0-9]', '', 'g', `${candidate}%`])
      .andWhereNot({ id: supplierId })
      .first('id');
    if (!dup) {
      cache.set(supplierId, candidate);
      return candidate;
    }
  }
  const out = base.slice(0, 6);
  cache.set(supplierId, out);
  return out;
}

async function buildProductCode(trx, productId, cache) {
  if (!productId) return 'RAW';
  if (cache.has(productId)) return cache.get(productId);
  const p = await trx('products').where({ id: productId }).first('code', 'name');
  let out;
  if (p && p.code) {
    out = alnumUpper(p.code).slice(0, 8) || 'RAW';
  } else {
    out = alnumUpper(p && p.name).slice(0, 6) || 'RAW';
  }
  cache.set(productId, out);
  return out;
}

async function main() {
  const lots = await db('inventory_lots')
    .where({ type: 'raw', entity: 'mill' })
    .orderBy('created_at', 'asc')
    .select('id', 'lot_no', 'supplier_id', 'product_id', 'created_at', 'batch_ref');

  console.log(`Found ${lots.length} raw mill lots.`);

  const skipped = [];
  const planned = [];
  const supplierCache = new Map();
  const productCache = new Map();
  // Track sequence per (sup-var-date) prefix
  const seqByPrefix = new Map();

  await db.transaction(async (trx) => {
    // Pre-seed seqByPrefix from any lots already on the new format so we
    // don't collide on re-run.
    const existing = await trx('inventory_lots')
      .where({ type: 'raw', entity: 'mill' })
      .select('lot_no');
    for (const r of existing) {
      if (!NEW_FORMAT.test(r.lot_no || '')) continue;
      const m = r.lot_no.match(/^([A-Z0-9]+)-([A-Z0-9]+)-(\d{6})-(\d+)$/);
      if (!m) continue;
      const prefix = `${m[1]}-${m[2]}-${m[3]}`;
      const seq = parseInt(m[4], 10);
      const cur = seqByPrefix.get(prefix) || 0;
      if (seq > cur) seqByPrefix.set(prefix, seq);
    }

    for (const lot of lots) {
      if (NEW_FORMAT.test(lot.lot_no || '')) {
        skipped.push({ id: lot.id, reason: 'already-new-format', lot_no: lot.lot_no });
        continue;
      }
      // Try to resolve supplier_id; if missing on lot, look up the batch
      // it belongs to via batch_ref.
      let supplierId = lot.supplier_id;
      let productId = lot.product_id;
      if ((!supplierId || !productId) && lot.batch_ref && lot.batch_ref.startsWith('batch-')) {
        const batchId = parseInt(lot.batch_ref.replace('batch-', ''), 10);
        if (batchId) {
          const b = await trx('milling_batches').where({ id: batchId }).first('supplier_id', 'product_id');
          if (b) {
            supplierId = supplierId || b.supplier_id;
            productId = productId || b.product_id;
          }
        }
      }
      const sup = await buildSupplierCode(trx, supplierId, supplierCache);
      const variety = await buildProductCode(trx, productId, productCache);
      const date = ymd(lot.created_at);
      const prefix = `${sup}-${variety}-${date}`;
      const nextSeq = (seqByPrefix.get(prefix) || 0) + 1;
      seqByPrefix.set(prefix, nextSeq);
      const newLotNo = `${prefix}-${String(nextSeq).padStart(2, '0')}`;
      planned.push({ id: lot.id, old: lot.lot_no, new: newLotNo });
    }

    if (DRY) {
      console.log(`Skipped: ${skipped.length}, planned renames: ${planned.length}`);
      for (const p of planned.slice(0, 50)) {
        console.log(`  ${p.old}  ->  ${p.new}`);
      }
      if (planned.length > 50) console.log(`  ... and ${planned.length - 50} more`);
      throw new Error('--dry: rolling back');
    }

    for (const p of planned) {
      await trx('inventory_lots').where({ id: p.id }).update({
        lot_no: p.new,
        updated_at: trx.fn.now(),
      });
    }
  }).catch((err) => {
    if (DRY && /--dry/.test(err.message)) {
      console.log('Dry run complete — no rows written.');
      return;
    }
    throw err;
  });

  if (!DRY) {
    console.log(`Renamed ${planned.length} lots, skipped ${skipped.length}.`);
  }
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
