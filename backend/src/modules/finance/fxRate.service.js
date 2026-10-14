/**
 * FX Rate Service — the one source of currency → PKR rates.
 *
 * Owner decision D-10 (P2-20): there is no hard-coded fallback rate any more.
 *   - Rates live per currency in fx_rates (the Rates Center / "rate master"),
 *     written by addRate() only (POST /finance/fx-rates, audit-logged).
 *   - DISPLAY reads the latest rate for the currency and labels it
 *     `estimated: true` (and `stale` when it is older than STALE_DAYS); with no
 *     rate on file it gets `rate: null` and shows "no rate" — never 280, and
 *     never another currency's rate.
 *   - POSTINGS call requireRate(): a currency with no rate on or before the
 *     date is refused (422 FX_RATE_MISSING) until a rate is entered.
 * system_settings.pkr_rate is no longer read for conversion; addRate keeps it
 * mirrored to the latest USD rate only (it used to be overwritten by a rate of
 * ANY currency, then applied to USD).
 */
const db = require('../../config/database');

const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const httpError = (message, statusCode, code) => { const e = new Error(message); e.statusCode = statusCode; if (code) e.code = code; return e; };
const dayOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

/** A rate row → the resolver's answer. Pure; exported for tests. */
function shape(currency, row, now = new Date()) {
  const cur = String(currency || '').toUpperCase();
  if (cur === 'PKR') return { currency: 'PKR', rate: 1, source: 'identity', effectiveDate: null, estimated: false, stale: false, missing: false };
  if (!row || !(parseFloat(row.rate) > 0)) {
    return {
      currency: cur, rate: null, source: 'none', effectiveDate: null, estimated: false, stale: false, missing: true,
      warning: `No ${cur}→PKR rate is on file — add one in Rates Center.`,
    };
  }
  const eff = row.effective_date;
  const ageDays = eff ? Math.floor((now.getTime() - new Date(`${dayOf(eff)}T00:00:00Z`).getTime()) / DAY_MS) : null;
  return {
    currency: cur,
    rate: parseFloat(row.rate),
    source: 'fx_rates',
    effectiveDate: eff,
    id: row.id,
    estimated: true,
    stale: ageDays != null && ageDays > STALE_DAYS,
    ageDays,
    missing: false,
  };
}

const fxRateService = {
  STALE_DAYS,
  shape,

  /**
   * The rate for `currencyCode` in effect on `date` (the latest on or before
   * it). { rate: null, missing: true } when the currency has none.
   */
  async getRateForDate(currencyCode, date, knex = db) {
    const cur = String(currencyCode || '').toUpperCase();
    if (cur === 'PKR') return shape('PKR');
    const row = await knex('fx_rates')
      .where('from_currency', cur)
      .where('to_currency', 'PKR')
      .where('effective_date', '<=', dayOf(date))
      .where('rate', '>', 0)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc')
      .first();
    return shape(cur, row);
  },

  /** The latest active rate for a currency (display: `estimated`, `stale`). */
  async getLatestRate(currencyCode = 'USD', knex = db) {
    const cur = String(currencyCode || '').toUpperCase();
    if (cur === 'PKR') return shape('PKR');
    const row = await knex('fx_rates')
      .where('from_currency', cur)
      .where('to_currency', 'PKR')
      .where('is_active', true)
      .where('rate', '>', 0)
      .orderBy('effective_date', 'desc')
      .orderBy('id', 'desc')
      .first();
    return shape(cur, row);
  },

  /**
   * A rate a POSTING may use: the rate on or before `date` for the currency.
   * Throws 422 (code FX_RATE_MISSING) when there is none — D-10: postings are
   * blocked until a rate is entered. PKR is 1.
   */
  async requireRate(currencyCode, date, { what = 'This entry', knex = db } = {}) {
    const cur = String(currencyCode || '').toUpperCase();
    if (cur === 'PKR') return 1;
    const day = dayOf(date || new Date());
    const r = await fxRateService.getRateForDate(cur, day, knex);
    if (!(r.rate > 0)) {
      throw httpError(`${what} needs a ${cur}→PKR rate on or before ${day} — add one in Rates Center (or enter the rate) first.`, 422, 'FX_RATE_MISSING');
    }
    return r.rate;
  },

  /**
   * The rate to lock on an export order at booking: the manual rate when one is
   * typed, else the currency's rate for the booking date. Throws 400 when the
   * currency has none (an order is never booked at a made-up rate).
   */
  async lockRateForOrder(currencyCode, bookingDate, manualRate = null) {
    const cur = String(currencyCode || 'USD').toUpperCase();
    if (manualRate && manualRate > 0) {
      return { rate: manualRate, source: 'manual', effectiveDate: bookingDate };
    }
    if (cur === 'PKR') return { rate: 1, source: 'identity', effectiveDate: bookingDate };
    const r = await fxRateService.getRateForDate(cur, bookingDate);
    if (!(r.rate > 0)) {
      throw httpError(`No ${cur}→PKR rate is on file for ${dayOf(bookingDate)} — enter the booked rate on the order, or add a ${cur} rate in Rates Center.`, 400, 'FX_RATE_MISSING');
    }
    return r;
  },

  /** The latest USD rate, or null (backward compat). */
  async getSystemRate() {
    const latest = await fxRateService.getLatestRate('USD');
    return latest.rate;
  },

  /** All rates for a currency, newest first. */
  async listRates(currencyCode = 'USD') {
    return db('fx_rates')
      .where('from_currency', currencyCode.toUpperCase())
      .where('to_currency', 'PKR')
      .orderBy('effective_date', 'desc');
  },

  /**
   * The one writer of rates (POST /finance/fx-rates, audit-logged there).
   * Mirrors system_settings.pkr_rate for USD only.
   */
  async addRate({ currencyCode, rate, effectiveDate, sourceType = 'manual', notes = null, createdBy = null }) {
    const cur = String(currencyCode || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur) || cur === 'PKR') throw httpError('currency_code must be a 3-letter non-PKR code.', 400);
    if (!(Number(rate) > 0)) throw httpError('rate must be greater than zero.', 400);
    const [row] = await db('fx_rates').insert({
      from_currency: cur,
      to_currency: 'PKR',
      rate,
      effective_date: effectiveDate,
      source: sourceType,
      source_type: sourceType,
      is_active: true,
      notes,
      created_by: createdBy,
    }).returning('*');

    if (cur === 'USD') {
      const latest = await db('fx_rates')
        .where('from_currency', 'USD')
        .where('to_currency', 'PKR')
        .orderBy('effective_date', 'desc')
        .orderBy('id', 'desc')
        .first();
      if (latest && latest.id === row.id) {
        await db('system_settings').where('key', 'pkr_rate').update({ value: String(rate) });
      }
    }
    return row;
  },

  /**
   * Update current FX values on open export orders (for reporting), each at
   * its OWN currency's latest rate. An order whose currency has no rate is
   * left untouched.
   */
  async refreshCurrentFxValues() {
    const currencies = await db('export_orders').whereNotIn('status', ['Cancelled', 'Closed'])
      .distinct('currency').pluck('currency');
    let updated = 0;
    const rates = {};
    for (const c of currencies) {
      const cur = String(c || 'USD').toUpperCase();
      const r = await fxRateService.getLatestRate(cur);
      if (!(r.rate > 0)) continue;
      rates[cur] = r.rate;
      updated += await db('export_orders')
        .whereNotIn('status', ['Cancelled', 'Closed'])
        .where('currency', c)
        .update({
          current_fx_rate_to_pkr: r.rate,
          current_fx_value_pkr: db.raw('contract_value * ?', [r.rate]),
          fx_gain_loss_pkr: db.raw('(contract_value * ?) - contract_value_pkr_locked', [r.rate]),
        });
    }
    return { updatedOrders: updated, currentRate: rates.USD || null, rates };
  },
};

module.exports = fxRateService;
