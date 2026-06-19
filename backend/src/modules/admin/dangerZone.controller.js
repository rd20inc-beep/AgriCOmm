const db = require('../../config/database');

/**
 * Super-Admin "Danger Zone" — permanent, cascading hard-deletes and manual
 * balance corrections. Every route is gated to the Super Admin role only
 * (authorizeRole) and every mutation is audit-logged with a before-snapshot.
 *
 * These operations are irreversible by design (the user explicitly wants a
 * clean-up-bad-data tool, not a reversible void). To stay safe they:
 *   - run inside a single transaction (all-or-nothing),
 *   - reverse the obvious side effects (restock a lot when a sale is deleted,
 *     reduce mill_stock when a purchase is deleted, restore payable/receivable
 *     outstanding when a payment is deleted),
 *   - refuse to delete a lot that has been sold or milled unless `force` is set.
 */

async function auditDanger(trx, req, action, entityType, entityId, details) {
  await trx('audit_logs').insert({
    user_id: req.user?.id || null,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    details: JSON.stringify(details || {}),
    ip_address: req.ip || req.headers['x-forwarded-for'] || null,
  });
}

const num = (v) => parseFloat(v) || 0;

// ─────────────────────────── LOTS ───────────────────────────

async function lotImpactCounts(q, lotId) {
  const tables = {
    inventory_movements: 'lot_id',
    lot_transactions: 'lot_id',
    inventory_reservations: 'lot_id',
    batch_source_lots: 'lot_id',
    stock_adjustments: 'lot_id',
    stock_count_items: 'lot_id',
    local_sales: 'lot_id',
    milling_vehicle_arrivals: 'lot_id',
  };
  const counts = {};
  for (const [t, col] of Object.entries(tables)) {
    const row = await q(t).where(col, lotId).count('id as c').first();
    counts[t] = parseInt(row?.c) || 0;
  }
  return counts;
}

const dangerZone = {
  async getLotImpact(req, res) {
    try {
      const lot = await db('inventory_lots').where('id', req.params.id).first();
      if (!lot) return res.status(404).json({ success: false, message: 'Lot not found.' });
      const counts = await lotImpactCounts(db, lot.id);
      const blockers = [];
      if (counts.local_sales > 0) blockers.push(`${counts.local_sales} local sale(s) reference this lot`);
      if (counts.batch_source_lots > 0) blockers.push(`fed ${counts.batch_source_lots} milling batch(es)`);
      if (num(lot.reserved_qty) > 0) blockers.push(`${lot.reserved_qty} ${lot.unit || 'MT'} reserved for export`);
      return res.json({ success: true, data: { lot, counts, blockers } });
    } catch (err) {
      console.error('getLotImpact error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async hardDeleteLot(req, res) {
    const force = req.body?.force === true || req.query?.force === 'true';
    try {
      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where('id', req.params.id).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }

        const counts = await lotImpactCounts(trx, lot.id);
        const blockers = [];
        if (counts.local_sales > 0) blockers.push(`${counts.local_sales} local sale(s) reference this lot`);
        if (counts.batch_source_lots > 0) blockers.push(`fed ${counts.batch_source_lots} milling batch(es)`);
        if (num(lot.reserved_qty) > 0) blockers.push(`${lot.reserved_qty} reserved for export`);
        if (blockers.length && !force) {
          const e = new Error(`Lot ${lot.lot_no} is in use (${blockers.join('; ')}). Re-run with force to delete anyway.`);
          e.status = 409; e.payload = { blockers, counts }; throw e;
        }

        // Delete NO-ACTION children first (these have no cascade).
        await trx('stock_count_items').where('lot_id', lot.id).del();
        await trx('stock_adjustments').where('lot_id', lot.id).del();
        await trx('batch_source_lots').where('lot_id', lot.id).del();
        await trx('lot_source_mapping').where('parent_lot_id', lot.id).orWhere('child_lot_id', lot.id).del();
        await trx('inventory_movements').where('lot_id', lot.id).del();
        // lot_transactions + inventory_reservations cascade on the lot delete.
        // local_sales / milling_vehicle_arrivals / historical_cost_repair_log SET NULL.
        await trx('inventory_lots').where('id', lot.id).del();

        await auditDanger(trx, req, 'hard_delete', 'inventory_lot', lot.id, { lot_no: lot.lot_no, snapshot: lot, counts, force });
        return { lot_no: lot.lot_no, counts };
      });
      return res.json({ success: true, message: `Lot ${result.lot_no} permanently deleted.`, data: result });
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ success: false, message: err.message, data: err.payload });
      if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
      console.error('hardDeleteLot error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────────────── TRANSACTIONS ───────────────────────

  async getTransactionImpact(req, res) {
    try {
      const { type, id } = req.params;
      const info = await describeTransaction(db, type, id);
      if (!info) return res.status(404).json({ success: false, message: `${type} not found.` });
      return res.json({ success: true, data: info });
    } catch (err) {
      console.error('getTransactionImpact error:', err);
      return res.status(err.status || 500).json({ success: false, message: err.message });
    }
  },

  async hardDeleteTransaction(req, res) {
    try {
      const { type, id } = req.params;
      const result = await db.transaction(async (trx) => {
        switch (type) {
          case 'local_sale':   return deleteLocalSale(trx, req, id);
          case 'payment':      return deletePayment(trx, req, id);
          case 'journal_entry':return deleteJournalEntry(trx, req, id);
          case 'lot_transaction': return deleteLotTransaction(trx, req, id);
          case 'mill_purchase':return deleteMillPurchase(trx, req, id);
          default: { const e = new Error(`Unsupported transaction type: ${type}`); e.status = 400; throw e; }
        }
      });
      return res.json({ success: true, message: result.message, data: result });
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
      if (err.status === 400) return res.status(400).json({ success: false, message: err.message });
      console.error('hardDeleteTransaction error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────────────── BANK BALANCE ───────────────────────

  async adjustBankBalance(req, res) {
    try {
      const { mode = 'add', amount, reason } = req.body || {};
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt)) return res.status(400).json({ success: false, message: 'A numeric amount is required.' });
      if (!['add', 'set'].includes(mode)) return res.status(400).json({ success: false, message: "mode must be 'add' or 'set'." });

      const result = await db.transaction(async (trx) => {
        const acct = await trx('bank_accounts').where('id', req.params.id).first();
        if (!acct) { const e = new Error('Bank account not found.'); e.status = 404; throw e; }
        const before = num(acct.current_balance);
        const after = mode === 'set' ? amt : before + amt;

        await trx('bank_accounts').where('id', acct.id).update({ current_balance: after, updated_at: trx.fn.now() });

        // Trail row so the correction is visible in the account's history.
        // type is constrained to credit/debit and status to posted/pending/reversed.
        const delta = mode === 'set' ? (after - before) : amt;
        if (await trx.schema.hasTable('bank_transactions')) {
          const last = await trx('bank_transactions').where('transaction_no', 'like', 'BT-%').orderBy('id', 'desc').first('transaction_no');
          const seq = last ? (parseInt(String(last.transaction_no).replace(/^BT-/, ''), 10) || 0) + 1 : 1;
          await trx('bank_transactions').insert({
            transaction_no: `BT-${String(seq).padStart(4, '0')}`,
            bank_account_id: acct.id,
            type: delta >= 0 ? 'credit' : 'debit',
            amount: Math.abs(delta),
            currency: acct.currency || 'PKR',
            transaction_date: new Date().toISOString().slice(0, 10),
            reference: 'Danger Zone',
            category: 'manual_adjustment',
            running_balance: after,
            status: 'posted',
            source: 'manual_adjustment',
            notes: reason || `Manual balance ${mode} by super admin`,
            created_by: req.user?.id || null,
          });
        }
        await auditDanger(trx, req, 'adjust_balance', 'bank_account', acct.id, { name: acct.name, mode, amount: amt, before, after, reason: reason || null });
        return { id: acct.id, name: acct.name, currency: acct.currency, before, after };
      });
      return res.json({ success: true, message: `Balance updated: ${result.before} → ${result.after}`, data: result });
    } catch (err) {
      if (err.status === 404) return res.status(404).json({ success: false, message: err.message });
      console.error('adjustBankBalance error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },
};

// ───────────────────── transaction helpers ─────────────────────

async function describeTransaction(q, type, id) {
  if (type === 'local_sale') {
    const sale = await q('local_sales').where('id', id).first();
    if (!sale) return null;
    return { type, row: sale, willReverse: sale.lot_id ? `restock lot ${sale.lot_no || sale.lot_id} by ${sale.quantity_kg} kg` : 'no lot to restock',
      children: { payments: await cnt(q, 'payments', 'local_sale_id', id), receivables: await cnt(q, 'receivables', 'local_sale_id', id) } };
  }
  if (type === 'payment') {
    const p = await q('payments').where('id', id).first();
    if (!p) return null;
    return { type, row: p, willReverse: p.linked_payable_id ? `restore payable #${p.linked_payable_id} outstanding +${p.amount}`
      : p.linked_receivable_id ? `restore receivable #${p.linked_receivable_id} outstanding +${p.amount}` : 'no linked AR/AP' };
  }
  if (type === 'journal_entry') {
    const j = await q('journal_entries').where('id', id).first();
    if (!j) return null;
    return { type, row: j, children: { journal_lines: await cnt(q, 'journal_lines', 'journal_id', id) } };
  }
  if (type === 'lot_transaction') {
    const t = await q('lot_transactions').where('id', id).first();
    if (!t) return null;
    return { type, row: t };
  }
  if (type === 'mill_purchase') {
    const mp = await q('mill_purchases').where('id', id).first();
    if (!mp) return null;
    return { type, row: mp, willReverse: 'reduce mill_stock by purchased quantities',
      children: { mill_purchase_items: await cnt(q, 'mill_purchase_items', 'purchase_id', id),
        payables: await q('payables').where({ source_table: 'mill_purchases', source_id: id }).count('id as c').first().then(r => parseInt(r?.c) || 0) } };
  }
  const e = new Error(`Unsupported transaction type: ${type}`); e.status = 400; throw e;
}

async function cnt(q, table, col, id) {
  const r = await q(table).where(col, id).count('id as c').first();
  return parseInt(r?.c) || 0;
}

async function deleteLocalSale(trx, req, id) {
  const sale = await trx('local_sales').where('id', id).first();
  if (!sale) { const e = new Error('Local sale not found.'); e.status = 404; throw e; }

  // Reverse the inventory deduction back onto the lot (if still present).
  if (sale.lot_id) {
    const lot = await trx('inventory_lots').where('id', sale.lot_id).first();
    if (lot) {
      const kg = num(sale.quantity_kg);
      const mt = kg / 1000;
      await trx('inventory_lots').where('id', lot.id).update({
        qty: num(lot.qty) + mt,
        available_qty: num(lot.available_qty) + mt,
        sold_weight_kg: Math.max(0, num(lot.sold_weight_kg) - kg),
        net_weight_kg: num(lot.net_weight_kg) + kg,
        updated_at: trx.fn.now(),
      });
    }
  }
  // Delete the sale's stock movement + ledger rows.
  await trx('inventory_movements').where('linked_ref', sale.sale_no).whereIn('movement_type', ['local_sale', 'export_dispatch']).del();
  await trx('lot_transactions').where('reference_no', sale.sale_no).whereIn('transaction_type', ['local_sale_out', 'export_dispatch_out']).del();
  // Payments (+ their bank_transactions) and receivables tied to the sale.
  const payIds = (await trx('payments').where('local_sale_id', id).select('id')).map(r => r.id);
  if (payIds.length) await trx('bank_transactions').whereIn('linked_payment_id', payIds).del();
  await trx('payments').where('local_sale_id', id).del();
  await trx('receivables').where('local_sale_id', id).del();
  // Journal entries posted for the sale (lines cascade).
  await trx('journal_entries').where('ref_no', sale.sale_no).del();
  await trx('local_sales').where('id', id).del();

  await auditDanger(trx, req, 'hard_delete', 'local_sale', id, { sale_no: sale.sale_no, snapshot: sale });
  return { message: `Local sale ${sale.sale_no} deleted and lot restocked.`, sale_no: sale.sale_no };
}

async function deletePayment(trx, req, id) {
  const p = await trx('payments').where('id', id).first();
  if (!p) { const e = new Error('Payment not found.'); e.status = 404; throw e; }
  const amt = num(p.amount);

  if (p.linked_payable_id) {
    const pay = await trx('payables').where('id', p.linked_payable_id).first();
    if (pay) {
      const paid = Math.max(0, num(pay.paid_amount) - amt);
      const outstanding = num(pay.outstanding) + amt;
      await trx('payables').where('id', pay.id).update({
        paid_amount: paid, outstanding,
        status: paid <= 0 ? 'Pending' : 'Partial', updated_at: trx.fn.now(),
      });
    }
  }
  if (p.linked_receivable_id) {
    const rec = await trx('receivables').where('id', p.linked_receivable_id).first();
    if (rec) {
      const received = Math.max(0, num(rec.received_amount) - amt);
      const outstanding = num(rec.outstanding) + amt;
      await trx('receivables').where('id', rec.id).update({
        received_amount: received, outstanding,
        status: received <= 0 ? 'Pending' : 'Partial', updated_at: trx.fn.now(),
      });
    }
  }
  await trx('bank_transactions').where('linked_payment_id', id).del();
  await trx('journal_entries').where('ref_no', p.payment_no).del();
  await trx('payments').where('id', id).del();

  await auditDanger(trx, req, 'hard_delete', 'payment', id, { payment_no: p.payment_no, snapshot: p });
  return { message: `Payment ${p.payment_no} deleted${p.linked_payable_id || p.linked_receivable_id ? ' and AR/AP restored' : ''}.`, payment_no: p.payment_no };
}

async function deleteJournalEntry(trx, req, id) {
  const j = await trx('journal_entries').where('id', id).first();
  if (!j) { const e = new Error('Journal entry not found.'); e.status = 404; throw e; }
  // Null out any reversal references pointing at this entry (NO ACTION FK).
  await trx('journal_entries').where('reversal_of', id).update({ reversal_of: null });
  await trx('journal_entries').where('id', id).del(); // journal_lines cascade
  await auditDanger(trx, req, 'hard_delete', 'journal_entry', id, { journal_no: j.journal_no, snapshot: j });
  return { message: `Journal entry ${j.journal_no} deleted.`, journal_no: j.journal_no };
}

async function deleteLotTransaction(trx, req, id) {
  const t = await trx('lot_transactions').where('id', id).first();
  if (!t) { const e = new Error('Lot transaction not found.'); e.status = 404; throw e; }
  await trx('lot_transactions').where('id', id).del();
  await auditDanger(trx, req, 'hard_delete', 'lot_transaction', id, { transaction_no: t.transaction_no, snapshot: t });
  return { message: `Lot transaction ${t.transaction_no} deleted.`, transaction_no: t.transaction_no };
}

async function deleteMillPurchase(trx, req, id) {
  const mp = await trx('mill_purchases').where('id', id).first();
  if (!mp) { const e = new Error('Mill purchase not found.'); e.status = 404; throw e; }
  // Reverse stock added by this purchase.
  const items = await trx('mill_purchase_items').where('purchase_id', id);
  for (const it of items) {
    const stock = await trx('mill_stock').where({ item_id: it.item_id }).first();
    if (stock) {
      await trx('mill_stock').where('id', stock.id).update({
        quantity_available: Math.max(0, num(stock.quantity_available) - num(it.quantity)), updated_at: trx.fn.now(),
      });
    }
  }
  await trx('mill_stock_movements').where({ reference_type: 'purchase', reference_id: id }).del();
  await trx('payables').where({ source_table: 'mill_purchases', source_id: id }).del();
  await trx('mill_purchases').where('id', id).del(); // mill_purchase_items cascade
  await auditDanger(trx, req, 'hard_delete', 'mill_purchase', id, { purchase_no: mp.purchase_no, snapshot: mp });
  return { message: `Mill purchase ${mp.purchase_no} deleted and stock reversed.`, purchase_no: mp.purchase_no };
}

module.exports = dangerZone;
