/**
 * Align confirmed local sales' reported COGS with the COGS the GL posted
 * (P3-12 / INV-54). DRY-RUN BY DEFAULT.
 *
 *   node scripts/correctLocalSaleCogsLock.js                    dry-run: counts + ids
 *   CORRECT_LOCAL_SALE_COGS=1 node scripts/correctLocalSaleCogsLock.js
 *                                                               writes, in ONE transaction
 *
 * What it writes (nothing else), for detector groups A and B only:
 *   local_sales.cogs_total_pkr   = net Dr 5000 of the sale's posted COGS journal(s)
 *   local_sales.cogs_per_kg      = that ÷ quantity_kg
 *   local_sales.gross_profit_pkr = total_amount − that
 *   local_sales.cost_locked_at_dispatch = true
 * The GL is the record and is NOT touched: no journal is posted, reversed or
 * edited, no stock moves. Group C (a cost but no COGS journal) is a GL gap and
 * is left for manual review.
 *
 * Output is counts and sale-line ids only. Runbook: docs/runbooks/local-sale-cogs-lock.md
 */
const { detect, report, SQL } = require('./detectLocalSaleCogsLock');

async function correct(db, { write, log = console.log }) {
  const before = await detect(db);
  const ids = [...before.nullLocked, ...before.mismatch];
  const tag = write ? '' : '[dry-run] ';
  log(`${tag}sale lines to align with their posted COGS journal: ${ids.length}`);
  log(`${tag}left for manual review (no COGS journal): ${before.noJournal.length}`);
  if (!write || !ids.length) return { before, corrected: 0 };

  let corrected = 0;
  await db.transaction(async (trx) => {
    const { rows } = await trx.raw(SQL);
    const glById = new Map(rows.map((r) => [r.id, parseFloat(r.gl_cogs)]));
    const sales = await trx('local_sales').whereIn('id', ids).forUpdate()
      .select('id', 'quantity_kg', 'total_amount', 'status');
    for (const s of sales) {
      const gl = glById.get(s.id);
      if (s.status !== 'Completed' || gl == null || Number.isNaN(gl)) continue;
      const cogs = Math.round(gl * 100) / 100;
      const qty = parseFloat(s.quantity_kg) || 0;
      await trx('local_sales').where({ id: s.id }).update({
        cogs_total_pkr: cogs,
        cogs_per_kg: qty > 0 ? Math.round((cogs / qty) * 10000) / 10000 : 0,
        gross_profit_pkr: Math.round(((parseFloat(s.total_amount) || 0) - cogs) * 100) / 100,
        cost_locked_at_dispatch: true,
      });
      corrected += 1;
    }
  });
  log(`aligned sale lines: ${corrected}`);
  return { before, corrected };
}

async function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  const write = env.CORRECT_LOCAL_SALE_COGS === '1' && !argv.includes('--dry-run');
  const db = require('../src/config/database');
  try {
    await correct(db, { write, log });
    if (write) {
      log('--- after ---');
      report(await detect(db), log);
    }
    return 0;
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('correctLocalSaleCogsLock failed:', err.message);
    process.exit(1);
  });
}

module.exports = { correct, main };
