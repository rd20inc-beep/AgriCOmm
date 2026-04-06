/**
 * Commodity Rate Service — manages product/by-product/milling rates.
 * Replaces all hardcoded pricing constants.
 */
const db = require('../config/database');

const commodityRateService = {
  /**
   * Get the latest effective rate for a rate_type + product_type.
   */
  async getRate(rateType, productType = null, asOfDate = null) {
    // Safe check — table may not exist on pre-migration databases
    const exists = await db.schema.hasTable('commodity_rate_master');
    if (!exists) return null;

    let query = db('commodity_rate_master')
      .where('rate_type', rateType);

    if (productType) query = query.where('product_type', productType);
    if (asOfDate) query = query.where('effective_date', '<=', asOfDate);

    const row = await query.orderBy('effective_date', 'desc').first();
    if (!row) return null;

    return {
      rateValue: parseFloat(row.rate_value),
      currency: row.rate_currency,
      unit: row.unit,
      effectiveDate: row.effective_date,
      isLocked: row.is_locked,
      id: row.id,
    };
  },

  /**
   * Get all rates of a specific type (e.g., all finished_rice rates).
   */
  async listRates(rateType = null) {
    const exists = await db.schema.hasTable('commodity_rate_master');
    if (!exists) return [];
    let query = db('commodity_rate_master').orderBy('effective_date', 'desc');
    if (rateType) query = query.where('rate_type', rateType);
    return query;
  },

  /**
   * Get all current rates (latest per type+product).
   */
  async getCurrentRates() {
    const exists = await db.schema.hasTable('commodity_rate_master');
    if (!exists) return [];
    const all = await db('commodity_rate_master').orderBy('effective_date', 'desc');
    const latest = {};
    for (const r of all) {
      const key = `${r.rate_type}:${r.product_type || ''}`;
      if (!latest[key]) latest[key] = r;
    }
    return Object.values(latest).map(r => ({
      id: r.id,
      rateType: r.rate_type,
      productType: r.product_type,
      unit: r.unit,
      currency: r.rate_currency,
      rateValue: parseFloat(r.rate_value),
      effectiveDate: r.effective_date,
      isLocked: r.is_locked,
    }));
  },

  /**
   * Add or update a commodity rate.
   */
  async upsertRate({ rateType, productType = null, unit = 'per_mt', currency = 'PKR', rateValue, effectiveDate, isLocked = false, sourceReference = null, notes = null, createdBy = null }) {
    const [row] = await db('commodity_rate_master').insert({
      rate_type: rateType,
      product_type: productType,
      unit,
      rate_currency: currency,
      rate_value: rateValue,
      effective_date: effectiveDate,
      is_locked: isLocked,
      source_reference: sourceReference,
      notes,
      created_by: createdBy,
    }).returning('*');
    return row;
  },

  /**
   * Get mill product rates for profitability (finished, broken, bran, husk).
   * Returns rates from commodity_rate_master if available, else null.
   */
  async getMillProductRates(asOfDate = null) {
    const types = ['finished_rice', 'broken_rice', 'bran', 'husk'];
    const result = {};
    for (const t of types) {
      const rate = await this.getRate(t, null, asOfDate);
      result[t] = rate ? rate.rateValue : null;
    }
    return result;
  },
};

module.exports = commodityRateService;
