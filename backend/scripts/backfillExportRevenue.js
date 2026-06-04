/**
 * Historical export-revenue backfill.
 *
 * Recognizes revenue (DR 1110 Export AR / CR 4010 Sales) and matching COGS
 * (DR 5020 COGS / CR 1230 Finished Rice) for orders that shipped BEFORE the
 * revenue-recognition code existed — so their customer ledgers stop reading
 * credit-only and the P&L picks up the historical sales.
 *
 * Going-forward shipments already post these at dispatch and carry
 * revenue_posted = true, so they're excluded automatically; this only touches
 * the backlog.
 *
 * Each journal is dated at the order's actual departure (atd), i.e. the period
 * the revenue was earned — NOT today — so prior-period statements are correct.
 * Orders whose ship date lands in a closed/absent accounting period are
 * reported and skipped (createJournal refuses non-open periods); reopen the
 * period and re-run if you want them.
 *
 * SAFE: dry-run by default — prints the plan and writes nothing. Pass --commit
 * to actually post. Idempotent: re-running skips anything already flagged
 * revenue_posted. Each order is its own transaction, so one failure never
 * rolls back the others.
 *
 *   node scripts/backfillExportRevenue.js            # dry run
 *   node scripts/backfillExportRevenue.js --commit   # post for real
 */

const db = require('../src/config/database');
const accountingService = require('../src/modules/accounting/accounting.service');

const COMMIT = process.argv.includes('--commit');
const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const fmt = (n) => 'Rs ' + Math.round(n).toLocaleString();

async function main() {
  // Resolve the GL accounts the posting rules use.
  const accs = await db('chart_of_accounts')
    .whereIn('code', ['1110', '4010', '5020', '1230'])
    .select('id', 'code', 'name');
  const A = Object.fromEntries(accs.map((a) => [a.code, a]));
  for (const c of ['1110', '4010', '5020', '1230']) {
    if (!A[c]) throw new Error(`Chart of accounts missing code ${c} — aborting.`);
  }

  const orders = await db('export_orders')
    .whereIn('status', ['Shipped', 'Arrived', 'Closed'])
    .where(function () { this.where('revenue_posted', false).orWhereNull('revenue_posted'); })
    .select(
      'id', 'order_no', 'status', 'customer_id', 'contract_value', 'currency',
      'contract_value_pkr_locked', 'booked_fx_rate', 'inventory_cogs_total_pkr',
      'atd', 'bl_date', 'balance_date', 'updated_at', 'created_at',
    )
    .orderBy('id');

  console.log(`\nMode: ${COMMIT ? 'COMMIT (writing journals)' : 'DRY RUN (no writes)'}`);
  console.log(`Candidates (Shipped/Arrived/Closed, revenue not yet posted): ${orders.length}\n`);

  let totRev = 0, totCogs = 0, done = 0, skipped = 0;

  for (const o of orders) {
    const revenuePkr = round2(
      parseFloat(o.contract_value_pkr_locked)
      || (parseFloat(o.contract_value) || 0) * (parseFloat(o.booked_fx_rate) || 0)
      || (parseFloat(o.contract_value) || 0),
    );
    const cogsPkr = round2(o.inventory_cogs_total_pkr);
    const dateRaw = o.atd || o.bl_date || o.balance_date || o.updated_at || o.created_at;
    const jdate = new Date(dateRaw).toISOString().slice(0, 10);

    if (!(revenuePkr > 0)) {
      console.log(`  SKIP ${o.order_no} [${o.status}] — no contract value`);
      skipped++;
      continue;
    }

    const period = await db('accounting_periods')
      .where('period_start', '<=', jdate).andWhere('period_end', '>=', jdate).first();
    const periodNote = !period ? 'NO PERIOD — will skip' : period.status !== 'Open' ? `PERIOD ${period.status} — will skip` : 'period open';

    console.log(`  ${COMMIT ? 'POST' : 'PLAN'} ${o.order_no} [${o.status}] date=${jdate} cust=${o.customer_id} REV=${fmt(revenuePkr)} COGS=${cogsPkr > 0 ? fmt(cogsPkr) : '—'} (${periodNote})`);

    if (!period || period.status !== 'Open') { skipped++; continue; }
    totRev += revenuePkr;
    totCogs += cogsPkr;

    if (COMMIT) {
      try {
        await db.transaction(async (trx) => {
          const rev = await accountingService.createJournal(trx, {
            date: jdate, entity: 'export', refType: 'Export Order', refNo: o.order_no,
            description: `Revenue ${o.order_no} (historical backfill)`, isAuto: true, userId: null,
            partyType: 'customer', partyId: o.customer_id,
            lines: [
              { account_id: A['1110'].id, account: A['1110'].name, debit: revenuePkr, credit: 0, narration: `DR ${A['1110'].code} — revenue ${o.order_no}` },
              { account_id: A['4010'].id, account: A['4010'].name, debit: 0, credit: revenuePkr, narration: `CR ${A['4010'].code} — revenue ${o.order_no}` },
            ],
          });
          await accountingService.postJournal(trx, rev.id);

          if (cogsPkr > 0) {
            const cogs = await accountingService.createJournal(trx, {
              date: jdate, entity: 'export', refType: 'Export Order', refNo: o.order_no,
              description: `COGS ${o.order_no} (historical backfill)`, isAuto: true, userId: null,
              partyType: 'customer', partyId: o.customer_id,
              lines: [
                { account_id: A['5020'].id, account: A['5020'].name, debit: cogsPkr, credit: 0, narration: `DR ${A['5020'].code} — COGS ${o.order_no}` },
                { account_id: A['1230'].id, account: A['1230'].name, debit: 0, credit: cogsPkr, narration: `CR ${A['1230'].code} — COGS ${o.order_no}` },
              ],
            });
            await accountingService.postJournal(trx, cogs.id);
          }

          await trx('export_orders').where('id', o.id).update({ revenue_posted: true });
        });
        done++;
      } catch (e) {
        console.log(`    ERROR ${o.order_no}: ${e.message} (left unposted)`);
        skipped++;
        totRev -= revenuePkr;
        totCogs -= cogsPkr;
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${COMMIT ? 'Posted' : 'Would post'}: ${COMMIT ? done : orders.length - skipped} orders`);
  console.log(`Total revenue: ${fmt(totRev)}  |  Total COGS: ${fmt(totCogs)}  |  Gross profit: ${fmt(totRev - totCogs)}`);
  console.log(`Skipped: ${skipped}`);
  if (!COMMIT) console.log('\nDRY RUN — nothing was written. Re-run with --commit to post.');
  console.log('');
  await db.destroy();
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
