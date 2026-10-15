/**
 * HTTP handlers for local-sale returns (P3-11). The work is in saleReturns.js;
 * these resolve the sale (by id or sale_no), run it in one transaction and
 * map refusals to their status.
 */
const db = require('../../config/database');
const { createSaleReturn, listSaleReturns } = require('./saleReturns');

async function resolveSaleId(q, id) {
  const where = /^\d+$/.test(String(id)) ? { id: parseInt(id, 10) } : { sale_no: String(id) };
  const row = await q('local_sales').where(where).first('id');
  return row ? row.id : null;
}

const statusOf = (err) => err.statusCode || err.status || 500;

module.exports = {
  async list(req, res) {
    try {
      const saleId = await resolveSaleId(db, req.params.id);
      if (!saleId) return res.status(404).json({ success: false, message: 'Sale not found.' });
      const returns = await listSaleReturns(db, saleId);
      return res.json({ success: true, data: { returns } });
    } catch (err) {
      console.error('Local sale returns list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createReturn(req, res) {
    try {
      const saleId = await resolveSaleId(db, req.params.id);
      if (!saleId) return res.status(404).json({ success: false, message: 'Sale not found.' });
      const b = req.body || {};
      const ret = await db.transaction((trx) => createSaleReturn(trx, saleId, {
        quantity: b.quantity,
        reason: b.reason,
        settlement: b.settlement || null,
        returnDate: b.return_date ? new Date(b.return_date).toISOString().slice(0, 10) : null,
        refund: { bankAccountId: b.refund_bank_account_id || null, method: b.refund_method || null, reference: b.refund_reference || null },
      }, { userId: req.user?.id || null, ownerId: req.ownerAuth?.ownerId || null }));
      return res.status(201).json({ success: true, data: { return: ret } });
    } catch (err) {
      const status = statusOf(err);
      if (status >= 500) console.error('Local sale return error:', err);
      return res.status(status).json({ success: false, message: status >= 500 ? 'Internal server error.' : err.message });
    }
  },
};
