/**
 * READ-ONLY FX review list (P2-20 / D-10). Writes nothing.
 *
 *   node scripts/detectFxRateSources.js
 *
 * The literal 280 fallback is gone going forward; this lists, by ID only, the
 * existing rows that may carry a rate that was never really booked, for the
 * accountant to review (no automatic correction — a booked rate is a business
 * fact, not something a script can infer):
 *   1. open export orders booked with fx_rate_source = 'system' (the rate the
 *      system picked — before P2-20 it could be the 280 default or another
 *      currency's rate), by currency;
 *   2. non-PKR export orders with no booked rate at all;
 *   3. non-PKR receivables whose PKR figure is missing (base_amount_pkr <= 0);
 *   4. non-PKR payments with neither a PKR figure nor a rate;
 *   5. currencies in use that have no rate in fx_rates.
 */
const db = require('../src/config/database');

async function main() {
  const system = await db('export_orders').where('fx_rate_source', 'system').whereNotIn('status', ['Cancelled', 'Closed'])
    .select('id', 'currency').orderBy('id');
  const byCur = {};
  for (const o of system) (byCur[String(o.currency || 'USD').toUpperCase()] ||= []).push(o.id);
  const unbooked = await db('export_orders').whereRaw("UPPER(COALESCE(currency, 'USD')) <> 'PKR'")
    .where((q) => q.whereNull('booked_fx_rate').orWhere('booked_fx_rate', '<=', 0)).pluck('id');
  const recv = await db('receivables').whereRaw("UPPER(COALESCE(currency, 'PKR')) <> 'PKR'")
    .where((q) => q.whereNull('base_amount_pkr').orWhere('base_amount_pkr', '<=', 0)).where('outstanding', '>', 0).pluck('id');
  const pays = await db('payments').whereRaw("UPPER(COALESCE(currency, 'PKR')) <> 'PKR'")
    .where((q) => q.whereNull('base_amount_pkr').orWhere('base_amount_pkr', '<=', 0))
    .where((q) => q.whereNull('fx_rate').orWhere('fx_rate', '<=', 1)).pluck('id');
  const inUse = new Set([
    ...(await db('export_orders').distinct('currency').pluck('currency')),
    ...(await db('receivables').distinct('currency').pluck('currency')),
    ...(await db('payables').distinct('currency').pluck('currency')),
    ...(await db('bank_accounts').distinct('currency').pluck('currency')),
  ].map((c) => String(c || 'PKR').toUpperCase()).filter((c) => c !== 'PKR'));
  const withRate = new Set((await db('fx_rates').where('rate', '>', 0).distinct('from_currency').pluck('from_currency')).map((c) => String(c).toUpperCase()));
  const noRate = [...inUse].filter((c) => !withRate.has(c)).sort();

  console.log(`open orders booked at a 'system' rate:          ${system.length} ${JSON.stringify(byCur)}`);
  console.log(`non-PKR orders with no booked rate (ids):       ${unbooked.length} ${JSON.stringify(unbooked)}`);
  console.log(`open non-PKR receivables with no PKR figure:    ${recv.length} ${JSON.stringify(recv)}`);
  console.log(`non-PKR payments with no PKR figure or rate:    ${pays.length} ${JSON.stringify(pays)}`);
  console.log(`currencies in use with no rate in fx_rates:     ${JSON.stringify(noRate)}`);
}

main()
  .then(() => db.destroy())
  .catch((e) => { console.error('fx review failed:', e.message); return db.destroy().then(() => process.exit(1)); });
