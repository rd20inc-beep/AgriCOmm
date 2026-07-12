const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const exportOrderController = require('../exportOrders/exportOrders.controller');

const num = (v) => parseFloat(v) || 0;
const round2 = (v) => Math.round((num(v)) * 100) / 100;
const today = () => new Date().toISOString().split('T')[0];

// Statuses a quote can be in, and the transitions the UI is allowed to request.
const STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired'];
const TRANSITIONS = {
  Draft: ['Sent', 'Rejected'],
  Sent: ['Accepted', 'Rejected', 'Expired', 'Draft'],
  Accepted: ['Sent'], // allow re-open before conversion
  Rejected: ['Draft'],
  Expired: ['Draft', 'Sent'],
};

// Normalize incoming line items to the quotation_items row shape.
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && (it.product_id || it.product_name))
    .map((it, idx) => {
      const qty = num(it.qty_mt);
      const price = num(it.price_per_mt);
      return {
        line_no: idx + 1,
        product_id: it.product_id != null && it.product_id !== '' ? parseInt(it.product_id) || null : null,
        product_name: it.product_name || null,
        qty_mt: qty,
        price_per_mt: price,
        line_total: round2(qty * price),
        hs_code: it.hs_code || null,
        packing: it.packing || null,
        bag_size_kg: it.bag_size_kg != null && it.bag_size_kg !== '' ? parseFloat(it.bag_size_kg) : null,
        bag_count: it.bag_count != null && it.bag_count !== '' ? parseInt(it.bag_count) : null,
        bag_type: it.bag_type || null,
        quality_description: it.quality_description || null,
        broken_pct_target: it.broken_pct_target != null && it.broken_pct_target !== '' ? parseFloat(it.broken_pct_target) : null,
        notes: it.notes || null,
      };
    });
}

// Fill in product_name for items that carry a product_id but no name — happens
// when a rice type was just quick-added in the picker (the client only knows the
// new id). Keeps stored quotes + the produced order showing the real name.
async function fillProductNames(trx, items) {
  const ids = items.filter((it) => it.product_id && !it.product_name).map((it) => it.product_id);
  if (!ids.length) return;
  const prods = await trx('products').whereIn('id', ids).select('id', 'name');
  const map = new Map(prods.map((p) => [p.id, p.name]));
  for (const it of items) {
    if (it.product_id && !it.product_name) it.product_name = map.get(it.product_id) || null;
  }
}

async function resolveId(idParam) {
  if (/^\d+$/.test(String(idParam))) return parseInt(idParam);
  const row = await db('export_quotations').where({ quotation_no: idParam }).first('id');
  return row ? row.id : null;
}

// Lazily flip Sent quotes whose validity has passed to Expired. Cheap and
// reliable (no scheduler needed) — runs on every list/get.
async function expireStale(trx = db) {
  await trx('export_quotations')
    .where({ status: 'Sent' })
    .whereNotNull('valid_until')
    .andWhere('valid_until', '<', today())
    .update({ status: 'Expired', updated_at: trx.fn.now() });
}

const quotationsController = {
  async list(req, res) {
    try {
      await expireStale();
      const q = db('export_quotations as q')
        .leftJoin('customers as c', 'c.id', 'q.customer_id')
        .leftJoin('export_orders as o', 'o.id', 'q.converted_order_id')
        .select(
          'q.*',
          'c.name as customer_name',
          'o.order_no as converted_order_no',
          db.raw('(select count(*) from export_quotation_items i where i.quotation_id = q.id) as item_count'),
        )
        .orderBy('q.created_at', 'desc');
      if (req.query.status && req.query.status !== 'All') q.where('q.status', req.query.status);
      if (req.query.customer_id) q.where('q.customer_id', req.query.customer_id);
      const rows = await q;
      return res.json({ success: true, data: { quotations: rows } });
    } catch (err) {
      console.error('Quotation list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getById(req, res) {
    try {
      await expireStale();
      const id = await resolveId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      const quote = await db('export_quotations as q')
        .leftJoin('customers as c', 'c.id', 'q.customer_id')
        .leftJoin('export_orders as o', 'o.id', 'q.converted_order_id')
        .where('q.id', id)
        .select('q.*', 'c.name as customer_name', 'c.country as customer_country',
          'c.email as customer_email', 'c.phone as customer_phone', 'c.address as customer_address',
          'o.order_no as converted_order_no')
        .first();
      if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      const items = await db('export_quotation_items').where({ quotation_id: id }).orderBy('line_no');
      return res.json({ success: true, data: { quotation: { ...quote, items } } });
    } catch (err) {
      console.error('Quotation get error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async create(req, res) {
    const b = req.body || {};
    try {
      if (!b.customer_id) return res.status(400).json({ success: false, message: 'customer_id is required.' });
      const items = normalizeItems(b.items);
      if (items.length === 0) return res.status(400).json({ success: false, message: 'At least one line item is required.' });
      const subtotal = round2(items.reduce((s, it) => s + num(it.line_total), 0));

      const result = await db.transaction(async (trx) => {
        await fillProductNames(trx, items);
        const quotationNo = await nextDocNo(trx, { table: 'export_quotations', column: 'quotation_no', prefix: 'QUO-' });
        const [quote] = await trx('export_quotations').insert({
          quotation_no: quotationNo,
          customer_id: b.customer_id,
          country: b.country || null,
          status: b.status === 'Sent' ? 'Sent' : 'Draft',
          quote_date: b.quote_date || today(),
          valid_until: b.valid_until || null,
          currency: b.currency || 'USD',
          incoterm: b.incoterm || null,
          destination_port: b.destination_port || null,
          port_of_loading: b.port_of_loading || null,
          payment_terms: b.payment_terms || null,
          advance_pct: num(b.advance_pct),
          subtotal,
          total_amount: subtotal,
          notes: b.notes || null,
          created_by: req.user?.id || null,
        }).returning('*');
        await trx('export_quotation_items').insert(items.map((it) => ({ ...it, quotation_id: quote.id })));
        return quote;
      });
      return res.status(201).json({ success: true, data: { quotation: result } });
    } catch (err) {
      console.error('Quotation create error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async update(req, res) {
    const b = req.body || {};
    try {
      const id = await resolveId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      const quote = await db('export_quotations').where({ id }).first();
      if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      if (quote.converted_order_id) {
        return res.status(409).json({ success: false, message: `Quotation already converted to order ${quote.converted_order_id}; it can no longer be edited.` });
      }
      if (!['Draft', 'Sent', 'Expired', 'Rejected'].includes(quote.status)) {
        return res.status(409).json({ success: false, message: `Cannot edit a ${quote.status} quotation.` });
      }

      const patch = { updated_at: db.fn.now() };
      for (const f of ['country', 'currency', 'incoterm', 'destination_port', 'port_of_loading', 'payment_terms', 'notes', 'quote_date', 'valid_until']) {
        if (b[f] !== undefined) patch[f] = b[f] === '' ? null : b[f];
      }
      if (b.customer_id !== undefined) patch.customer_id = b.customer_id;
      if (b.advance_pct !== undefined) patch.advance_pct = num(b.advance_pct);

      await db.transaction(async (trx) => {
        if (Array.isArray(b.items)) {
          const items = normalizeItems(b.items);
          if (items.length === 0) throw Object.assign(new Error('At least one line item is required.'), { code: 'EMPTY_ITEMS' });
          await fillProductNames(trx, items);
          await trx('export_quotation_items').where({ quotation_id: id }).del();
          await trx('export_quotation_items').insert(items.map((it) => ({ ...it, quotation_id: id })));
          const subtotal = round2(items.reduce((s, it) => s + num(it.line_total), 0));
          patch.subtotal = subtotal;
          patch.total_amount = subtotal;
        }
        await trx('export_quotations').where({ id }).update(patch);
      });
      const updated = await db('export_quotations').where({ id }).first();
      return res.json({ success: true, data: { quotation: updated } });
    } catch (err) {
      if (err.code === 'EMPTY_ITEMS') return res.status(400).json({ success: false, message: err.message });
      console.error('Quotation update error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // Draft → Sent, Sent → Accepted/Rejected, etc. (see TRANSITIONS).
  async updateStatus(req, res) {
    try {
      const id = await resolveId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      const status = req.body?.status;
      if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: `Unknown status "${status}".` });
      const quote = await db('export_quotations').where({ id }).first();
      if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      if (quote.converted_order_id) return res.status(409).json({ success: false, message: 'Quotation already converted; status is locked.' });
      const allowed = TRANSITIONS[quote.status] || [];
      if (quote.status !== status && !allowed.includes(status)) {
        return res.status(409).json({ success: false, message: `Cannot move a ${quote.status} quotation to ${status}.` });
      }
      await db('export_quotations').where({ id }).update({ status, updated_at: db.fn.now() });
      const updated = await db('export_quotations').where({ id }).first();
      return res.json({ success: true, data: { quotation: updated } });
    } catch (err) {
      console.error('Quotation status error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // One-click convert an accepted quotation into a real export order. Reuses the
  // export-order create handler (via a synthetic req/res) so the order gets the
  // full treatment — FX lock, receivables, document checklists — identically to
  // a directly-created order. Then links the quote to the produced order.
  async convert(req, res) {
    try {
      const id = await resolveId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      const quote = await db('export_quotations').where({ id }).first();
      if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      if (quote.converted_order_id) {
        return res.status(409).json({ success: false, message: `Quotation already converted to order #${quote.converted_order_id}.` });
      }
      if (quote.status !== 'Accepted') {
        return res.status(409).json({ success: false, message: 'Only an Accepted quotation can be converted to an order. Mark it Accepted first.' });
      }
      const items = await db('export_quotation_items').where({ quotation_id: id }).orderBy('line_no');
      if (!items.length) return res.status(400).json({ success: false, message: 'Quotation has no line items to convert.' });

      const body = {
        customer_id: quote.customer_id,
        country: quote.country,
        currency: quote.currency || 'USD',
        incoterm: quote.incoterm,
        destination_port: quote.destination_port,
        advance_pct: num(quote.advance_pct),
        payment_terms: quote.payment_terms,
        notes: quote.notes,
        source: 'Quotation',
        status: 'Awaiting Advance',
        items: items.map((it) => ({
          product_id: it.product_id,
          product_name: it.product_name,
          qty_mt: it.qty_mt,
          price_per_mt: it.price_per_mt,
          hs_code: it.hs_code,
          packing: it.packing,
          bag_size_kg: it.bag_size_kg,
          bag_count: it.bag_count,
          bag_type: it.bag_type,
          quality_description: it.quality_description,
          broken_pct_target: it.broken_pct_target,
          notes: it.notes,
        })),
      };

      // Synthetic invocation of the export-order create handler.
      let created = null; let errStatus = null; let errBody = null;
      const fakeRes = {
        _code: 200,
        status(code) { this._code = code; return this; },
        json(obj) {
          if (this._code >= 400) { errStatus = this._code; errBody = obj; }
          else created = obj;
          return this;
        },
      };
      await exportOrderController.create({ body, user: req.user }, fakeRes);
      const order = created && created.data && created.data.order;
      if (!order) {
        return res.status(errStatus || 500).json(errBody || { success: false, message: 'Failed to create order from quotation.' });
      }

      await db('export_quotations').where({ id }).update({
        converted_order_id: order.id,
        status: 'Accepted',
        updated_at: db.fn.now(),
      });

      return res.status(201).json({ success: true, data: { order, quotation_id: id, order_no: order.order_no } });
    } catch (err) {
      console.error('Quotation convert error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async remove(req, res) {
    try {
      const id = await resolveId(req.params.id);
      if (!id) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      const quote = await db('export_quotations').where({ id }).first();
      if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found.' });
      if (quote.converted_order_id) {
        return res.status(409).json({ success: false, message: 'Quotation was converted to an order; delete the order instead if needed.' });
      }
      await db('export_quotations').where({ id }).del(); // items cascade
      return res.json({ success: true, data: { deleted: id } });
    } catch (err) {
      console.error('Quotation delete error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = quotationsController;
