/**
 * FX Rate Service — Single source of truth for currency conversion rates.
 * No other file should hardcode conversion rates or read system_settings.pkr_rate directly.
 */
const db = require('../../config/database');

const fxRateService = {
  /**
   * Get the effective rate for a currency on a specific date.
   * Falls back to the most recent prior rate if exact date not found.
   */
  async getRateForDate(currencyCode, date) {
    const row = await db('fx_rates')
      .where('from_currency', currencyCode.toUpperCase())
      .where('to_currency', 'PKR')
      .where('effective_date', '<=', date)
      .orderBy('effective_date', 'desc')
      .first();

    if (row) return { rate: parseFloat(row.rate), source: 'fx_rates', effectiveDate: row.effective_date, id: row.id };

    // Fallback to system_settings
    const setting = await db('system_settings').where('key', 'pkr_rate').first();
    const fallbackRate = parseFloat(setting?.value) || 280;
    return { rate: fallbackRate, source: 'system_settings_fallback', effectiveDate: null, id: null, warning: `No FX rate found for ${currencyCode} on ${date}, using system default ${fallbackRate}` };
  },

  /**
   * Get the latest active rate for a currency.
   */
  async getLatestRate(currencyCode = 'USD') {
    const row = await db('fx_rates')
      .where('from_currency', currencyCode.toUpperCase())
      .where('to_currency', 'PKR')
      .where('is_active', true)
      .orderBy('effective_date', 'desc')
      .first();

    if (row) return { rate: parseFloat(row.rate), source: 'fx_rates', effectiveDate: row.effective_date, id: row.id };

    const setting = await db('system_settings').where('key', 'pkr_rate').first();
    const fallbackRate = parseFloat(setting?.value) || 280;
    return { rate: fallbackRate, source: 'system_settings_fallback', effectiveDate: null, warning: `No active FX rate for ${currencyCode}, using system default` };
  },

  /**
   * Lock a rate for an export order at booking time.
   * Returns the rate to store on the order.
   */
  async lockRateForOrder(currencyCode, bookingDate, manualRate = null) {
    if (manualRate && manualRate > 0) {
      return { rate: manualRate, source: 'manual', effectiveDate: bookingDate };
    }
    return this.getRateForDate(currencyCode, bookingDate);
  },

  /**
   * Compute FX gain/loss between locked and current rate.
   */
  computeFxGainLoss(foreignAmount, lockedRate, currentRate) {
    const bookedPkr = foreignAmount * lockedRate;
    const currentPkr = foreignAmount * currentRate;
    return {
      bookedPkr,
      currentPkr,
      gainLossPkr: currentPkr - bookedPkr,
      lockedRate,
      currentRate,
    };
  },

  /**
   * Get the system default PKR rate (for backward compat).
   */
  async getSystemRate() {
    const latest = await this.getLatestRate('USD');
    return latest.rate;
  },

  /**
   * List all FX rates for a currency, ordered by date desc.
   */
  async listRates(currencyCode = 'USD') {
    return db('fx_rates')
      .where('from_currency', currencyCode.toUpperCase())
      .where('to_currency', 'PKR')
      .orderBy('effective_date', 'desc');
  },

  /**
   * Add a new FX rate entry.
   */
  async addRate({ currencyCode, rate, effectiveDate, sourceType = 'manual', notes = null, createdBy = null }) {
    const [row] = await db('fx_rates').insert({
      from_currency: currencyCode.toUpperCase(),
      to_currency: 'PKR',
      rate,
      effective_date: effectiveDate,
      source: sourceType,
      source_type: sourceType,
      is_active: true,
      notes,
      created_by: createdBy,
    }).returning('*');

    // Also update system_settings if this is the latest rate
    const latest = await db('fx_rates')
      .where('from_currency', currencyCode.toUpperCase())
      .where('to_currency', 'PKR')
      .orderBy('effective_date', 'desc')
      .first();
    if (latest && latest.id === row.id) {
      await db('system_settings').where('key', 'pkr_rate').update({ value: String(rate) });
    }

    return row;
  },

  /**
   * Update current FX values on all open export orders (for reporting).
   */
  async refreshCurrentFxValues() {
    const currentRate = await this.getLatestRate('USD');
    const updated = await db('export_orders')
      .whereNotIn('status', ['Cancelled', 'Closed'])
      .update({
        current_fx_rate_to_pkr: currentRate.rate,
        current_fx_value_pkr: db.raw('contract_value * ?', [currentRate.rate]),
        fx_gain_loss_pkr: db.raw('(contract_value * ?) - contract_value_pkr_locked', [currentRate.rate]),
      });
    return { updatedOrders: updated, currentRate: currentRate.rate };
  },
};

module.exports = fxRateService;
