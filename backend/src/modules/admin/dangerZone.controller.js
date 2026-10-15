const db = require('../../config/database');
const { postBankTransaction, deleteBankTransaction } = require('../../shared/bankBalance');
const { redactSecrets } = require('../../utils/redactSecrets');
const accountingService = require('../accounting/accounting.service');
const { mirrorJournals } = require('../milling/payrollReversal');
const { glAccountFor } = require('../../shared/accountGl');
const { deleteBatchTx } = require('../milling/milling.controller');
const { creditedOnSale } = require('../localSales/saleCredits');

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
 *
 * The books stay balanced (P2-23, owner decision D-23). A Posted journal is
 * NEVER hard-deleted here: the GL a deleted document posted is netted to zero
 * by Posted signed-delta journals dated today (closed periods are never
 * touched), so the trial balance and every account stay correct and the
 * history survives. A record whose money cannot be unwound that way (a lot
 * with payables / freight / open GL, a batch past the point its own delete
 * allows, a single Posted journal) is refused with the step to take instead.
 * A bank-balance correction posts its own delta journal against 1290 Suspense.
 */

async function auditDanger(trx, req, action, entityType, entityId, details) {
  await trx('audit_logs').insert({
    user_id: req.user?.id || null,
    action,
    entity_type: entityType,
    entity_id: String(entityId),
    details: JSON.stringify(redactSecrets(details || {})),
    ip_address: req.ip || req.headers['x-forwarded-for'] || null,
  });
}

const num = (v) => parseFloat(v) || 0;

// Master / config / system tables KEPT by a "reset to 0" — everything else in the
// public schema is transactional and gets wiped. Keep-list (not wipe-list) so a
// NEW transactional table is wiped by default; a new MASTER must be added here.
// The in-DB backup makes a mis-categorisation recoverable.
const KEEP_TABLES = new Set([
  // system / migrations
  'knex_migrations', 'knex_migrations_lock',
  // forensic trail — keep the audit history (incl. who ran the reset) across a
  // reset; the backup schema has a copy anyway, but the live log stays continuous.
  'audit_logs',
  // auth & user prefs — incl. module/warehouse scoping (a wiped scope makes a
  // scoped user unrestricted) and the device register (a wiped one forgets
  // every revocation)
  'users', 'roles', 'permissions', 'role_permissions', 'user_preferences',
  'user_scopes', 'devices',
  // core masters (haulers are a master since mig 284; a worker's salary
  // revisions are its pay history, kept with the worker)
  'products', 'suppliers', 'customers', 'warehouses', 'bag_types', 'mills', 'mill_workers',
  'mill_items', 'mill_consumption_ratios', 'product_categories', 'expense_vendors',
  'haulers', 'mill_salary_revisions',
  // payroll config (leave types + FBR/EOBI statutory rules) — config, not per-run
  // data; seeded once by migration so a reset would leave them empty permanently.
  'mill_leave_types', 'mill_statutory_deductions',
  // finance config / reference
  'chart_of_accounts', 'posting_rules', 'accounting_periods', 'fx_rates',
  'commodity_rate_master', 'bank_accounts', 'kpi_benchmarks', 'recovery_benchmarks',
  // templates / document config
  'document_templates', 'email_templates', 'whatsapp_templates',
  'country_doc_requirements', 'purchase_lot_templates',
  // app config / scheduling
  'system_settings', 'scheduled_tasks', 'scheduled_reports', 'saved_reports', 'api_integrations',
]);

// ─────────────────────────── LOTS ───────────────────────────

async function lotImpactCounts(q, lotId) {
  const tables = {
    lot_transactions: 'lot_id',
    inventory_reservations: 'lot_id',
    batch_source_lots: 'lot_id',
    stock_adjustments: 'lot_id',
    stock_count_items: 'lot_id',
    local_sales: 'lot_id',
    milling_vehicle_arrivals: 'lot_id',
    container_lots: 'lot_id',
  };
  const counts = {};
  for (const [t, col] of Object.entries(tables)) {
    const row = await q(t).where(col, lotId).count('id as c').first();
    counts[t] = parseInt(row?.c) || 0;
  }
  return counts;
}

// Net Posted GL still standing under these ref_nos, summed as |net| per
// account (0 = nothing open: never posted, or already netted by deltas).
async function openGlNet(q, refNos) {
  const refs = refNos.filter(Boolean);
  if (!refs.length) return 0;
  const rows = await q('journal_lines as jl')
    .join('journal_entries as je', 'je.id', 'jl.journal_id')
    .whereIn('je.ref_no', refs)
    .where('je.status', 'Posted')
    .groupBy('jl.account_id')
    .select(q.raw('COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as net'));
  return Math.round(rows.reduce((s, r) => s + Math.abs(num(r.net)), 0) * 100) / 100;
}

// The money a lot carries that a hard delete would strand (P2-23 / INV-07):
// its purchase / freight / commission payables, its freight records and the
// GL its intake posted under the lot number. A lot that is part of a milling
// batch is removed with that batch instead.
async function lotFinancialBlockers(q, lot) {
  const blockers = [];
  const payables = await q('payables')
    .where('linked_ref', lot.lot_no)
    .where((w) => w.where('paid_amount', '>', 0.01).orWhere('outstanding', '>', 0.01))
    .count('id as c').first();
  if (parseInt(payables?.c) > 0) blockers.push(`${payables.c} payable(s) (purchase / freight / commission) — reverse or void them first`);
  if (await q.schema.hasTable('transport_costs')) {
    const tc = await q('transport_costs').where('lot_id', lot.id)
      .whereRaw("COALESCE(lower(status), '') NOT IN ('cancelled', 'void')")
      .count('id as c').first();
    if (parseInt(tc?.c) > 0) blockers.push(`${tc.c} freight record(s)`);
  }
  const gl = await openGlNet(q, [lot.lot_no]);
  if (gl > 0.01) blockers.push(`Posted GL under ${lot.lot_no} still open — reverse the purchase first`);
  if (lot.batch_ref && /^batch-\d+$/.test(lot.batch_ref)) {
    const batch = await q('milling_batches').where('id', Number(lot.batch_ref.slice(6))).first('batch_no');
    if (batch) blockers.push(`belongs to milling batch ${batch.batch_no} — delete the batch instead`);
  }
  return blockers;
}

// Net every Posted journal under these ref_nos back to zero with Posted
// signed-delta journals dated today (never delete or edit a Posted journal;
// never reverse + repost). Idempotent per original journal. Unposted drafts
// are not in the books and are simply removed.
async function neutralizeRefs(trx, refNos, { userId, reason }) {
  const out = [];
  for (const refNo of [...new Set(refNos.filter(Boolean))]) {
    const refTypes = (await trx('journal_entries').where({ ref_no: refNo, status: 'Posted' })
      .whereNull('reversal_of').distinct('ref_type')).map((r) => r.ref_type).filter(Boolean);
    if (refTypes.length) {
      out.push(...await mirrorJournals(trx, {
        refNo, refTypes, refType: 'Danger Zone Reversal', description: reason, userId,
      }));
    }
    // A Posted original with a NULL ref_type is outside mirrorJournals' filter.
    const untyped = await trx('journal_entries').where({ ref_no: refNo, status: 'Posted' }).whereNull('ref_type').whereNull('reversal_of').count('id as c').first();
    if (parseInt(untyped?.c) > 0) {
      const e = new Error(`Journal(s) under ${refNo} have no ref type and cannot be netted automatically — reverse them in Accounting first.`);
      e.status = 409; throw e;
    }
    // Every account under the ref must now net to zero — if anything still
    // stands (an orphan delta of an original no longer Posted), refuse rather
    // than leave the books half-unwound.
    if (await openGlNet(trx, [refNo]) > 0.01) {
      const e = new Error(`The GL under ${refNo} could not be netted to zero automatically — reverse it in Accounting first.`);
      e.status = 409; throw e;
    }
    const drafts = trx('journal_entries').where({ ref_no: refNo, status: 'Draft' }).select('id');
    await trx('journal_lines').whereIn('journal_id', drafts).del();
    await trx('journal_entries').where({ ref_no: refNo, status: 'Draft' }).del();
  }
  return out.filter(Boolean);
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
      if (counts.container_lots > 0) blockers.push(`packed into ${counts.container_lots} shipment container(s)`);
      if (num(lot.reserved_qty) > 0) blockers.push(`${lot.reserved_qty} ${lot.unit || 'MT'} reserved for export`);
      // Money blockers cannot be overridden with force (P2-23).
      const financialBlockers = await lotFinancialBlockers(db, lot);
      return res.json({ success: true, data: { lot, counts, blockers, financialBlockers } });
    } catch (err) {
      console.error('getLotImpact error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  async hardDeleteLot(req, res) {
    const force = req.body?.force === true || req.query?.force === 'true';
    if ((req.query?.confirm || req.body?.confirm) !== 'DELETE') {
      return res.status(400).json({ success: false, message: 'Confirmation required — pass confirm=DELETE to hard-delete.' });
    }
    try {
      const result = await db.transaction(async (trx) => {
        const lot = await trx('inventory_lots').where('id', req.params.id).first();
        if (!lot) { const e = new Error('Lot not found.'); e.status = 404; throw e; }

        const counts = await lotImpactCounts(trx, lot.id);
        const blockers = [];
        if (counts.local_sales > 0) blockers.push(`${counts.local_sales} local sale(s) reference this lot`);
        if (counts.batch_source_lots > 0) blockers.push(`fed ${counts.batch_source_lots} milling batch(es)`);
        if (counts.container_lots > 0) blockers.push(`packed into ${counts.container_lots} shipment container(s)`);
        if (num(lot.reserved_qty) > 0) blockers.push(`${lot.reserved_qty} reserved for export`);
        // Money the lot carries is never stranded — force does not override it.
        const financialBlockers = await lotFinancialBlockers(trx, lot);
        if (financialBlockers.length) {
          const e = new Error(`Lot ${lot.lot_no} has financial records (${financialBlockers.join('; ')}). Deleting it would leave AP / GL for stock that no longer exists.`);
          e.status = 409; e.payload = { blockers, financialBlockers, counts }; throw e;
        }
        if (blockers.length && !force) {
          const e = new Error(`Lot ${lot.lot_no} is in use (${blockers.join('; ')}). Re-run with force to delete anyway.`);
          e.status = 409; e.payload = { blockers, counts }; throw e;
        }

        // The lot's stock ledger and holds (RESTRICT since mig 368 — removed
        // explicitly, only here, only for a lot with no money attached).
        await trx('lot_transactions').where('lot_id', lot.id).del();
        await trx('inventory_reservations').where('lot_id', lot.id).del();
        // Delete NO-ACTION children first (these have no cascade).
        await trx('stock_count_items').where('lot_id', lot.id).del();
        await trx('stock_adjustments').where('lot_id', lot.id).del();
        await trx('batch_source_lots').where('lot_id', lot.id).del();
        await trx('lot_source_mapping').where('parent_lot_id', lot.id).orWhere('child_lot_id', lot.id).del();
        // container_lots.lot_id is a NO-ACTION FK (a lot packed into a shipment
        // container) — clean it, else the lot delete 500s with an opaque 23503.
        await delIfExists(trx, 'container_lots', (q) => q.where('lot_id', lot.id));
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
    if ((req.query?.confirm || req.body?.confirm) !== 'DELETE') {
      return res.status(400).json({ success: false, message: 'Confirmation required — pass confirm=DELETE to hard-delete.' });
    }
    try {
      const { type, id } = req.params;
      const result = await db.transaction(async (trx) => {
        switch (type) {
          case 'local_sale':   return deleteLocalSale(trx, req, id);
          case 'payment':      return deletePayment(trx, req, id);
          case 'journal_entry':return deleteJournalEntry(trx, req, id);
          case 'lot_transaction': return deleteLotTransaction(trx, req, id);
          case 'mill_purchase':return deleteMillPurchase(trx, req, id);
          case 'export_order': return deleteExportOrder(trx, req, id);
          case 'milling_batch': return deleteMillingBatch(trx, req, id);
          case 'customer':
          case 'supplier':
          case 'product': return deleteMaster(trx, req, type, id);
          default: { const e = new Error(`Unsupported transaction type: ${type}`); e.status = 400; throw e; }
        }
      });
      return res.json({ success: true, message: result.message, data: result });
    } catch (err) {
      // Surface any status-carrying error (404 not-found, 400 bad-type, 409
      // still-referenced) as itself rather than collapsing it to a 500.
      if ([400, 404, 409].includes(err.status)) return res.status(err.status).json({ success: false, message: err.message });
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
        const acct = await trx('bank_accounts').where('id', req.params.id).forUpdate().first();
        if (!acct) { const e = new Error('Bank account not found.'); e.status = 404; throw e; }
        const before = num(acct.current_balance);
        const after = mode === 'set' ? amt : before + amt;
        const delta = mode === 'set' ? (after - before) : amt;

        // The GL moves with the balance (P2-23 / ADM-17): a Posted delta journal
        // between this account's own GL account and 1290 Suspense — the
        // correction is unexplained money until Finance classifies it out of
        // Suspense. GL is PKR-base: a foreign-currency account needs the rate
        // (no fallback rate — D-10).
        let journalNo = null;
        if (Math.abs(delta) > 0.004) {
          const ccy = acct.currency || 'PKR';
          const rate = ccy === 'PKR' ? 1 : parseFloat(req.body?.fx_rate);
          if (!(rate > 0)) {
            const e = new Error(`This is a ${ccy} account — pass fx_rate (PKR per ${ccy}) so the correction can be posted to the GL.`);
            e.status = 400; throw e;
          }
          const [bankGl, suspense] = await Promise.all([
            glAccountFor(trx, acct),
            trx('chart_of_accounts').where({ code: '1290' }).first(),
          ]);
          if (!bankGl || !suspense) {
            const e = new Error('GL account for this bank account or 1290 Suspense is missing — cannot post the correction.');
            e.status = 409; throw e;
          }
          const pkr = Math.round(Math.abs(delta) * rate * 100) / 100;
          const why = `Danger Zone balance ${mode} — ${acct.name}${reason ? `: ${reason}` : ''}`.slice(0, 500);
          const lines = delta > 0
            ? [
              { account_id: bankGl.id, account: bankGl.name, debit: pkr, credit: 0, narration: why },
              { account_id: suspense.id, account: suspense.name, debit: 0, credit: pkr, narration: why },
            ]
            : [
              { account_id: suspense.id, account: suspense.name, debit: pkr, credit: 0, narration: why },
              { account_id: bankGl.id, account: bankGl.name, debit: 0, credit: pkr, narration: why },
            ];
          const j = await accountingService.createJournal(trx, {
            date: new Date().toISOString().slice(0, 10),
            entity: acct.entity || 'mill',
            refType: 'Bank Adjustment', refNo: `BANKADJ-${acct.id}`,
            description: why, currency: 'PKR', fxRate: 1, isAuto: true,
            userId: req.user?.id || null, lines,
            origCurrency: ccy === 'PKR' ? null : ccy, origFxRate: ccy === 'PKR' ? null : rate,
          });
          if (j && j.id) await accountingService.postJournal(trx, j.id);
          journalNo = j?.journal_no || null;
        }

        // The correction is a bank row like any other money move, written by
        // the single balance writer (P2-17), so it is visible in the account's
        // history and the balance stays Σ of its rows.
        await postBankTransaction(trx, {
          accountId: acct.id,
          type: delta >= 0 ? 'credit' : 'debit',
          amount: Math.abs(delta),
          transaction_date: new Date().toISOString().slice(0, 10),
          reference: 'Danger Zone',
          category: 'manual_adjustment',
          source: 'manual_adjustment',
          notes: reason || `Manual balance ${mode} by super admin`,
          created_by: req.user?.id || null,
        });
        await auditDanger(trx, req, 'adjust_balance', 'bank_account', acct.id, { name: acct.name, mode, amount: amt, before, after, reason: reason || null, journal_no: journalNo });
        return { id: acct.id, name: acct.name, currency: acct.currency, before, after, journalNo };
      });
      return res.json({
        success: true,
        message: `Balance updated: ${result.before} → ${result.after}${result.journalNo ? ` (GL ${result.journalNo} against 1290 Suspense)` : ''}`,
        data: result,
      });
    } catch (err) {
      if ([400, 404, 409].includes(err.status)) return res.status(err.status).json({ success: false, message: err.message });
      console.error('adjustBankBalance error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  },

  // ─────────────────────── RESET TO 0 ───────────────────────
  // Wipe ALL transactional data (everything not in KEEP_TABLES), keep masters,
  // zero bank balances. Backs every wiped table up into a backup_reset_<ts>
  // schema FIRST (same transaction, so a failure rolls back with no data lost).
  async resetTransactional(req, res) {
    try {
      if ((req.body?.confirm || '') !== 'RESET') {
        return res.status(400).json({ success: false, message: 'Type RESET to confirm — this permanently wipes all transactional data.' });
      }
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
      const backupSchema = `backup_reset_${stamp}`;

      const result = await db.transaction(async (trx) => {
        const allTables = await trx('information_schema.tables')
          .where({ table_schema: 'public', table_type: 'BASE TABLE' })
          .pluck('table_name');
        const wipe = allTables.filter((t) => !KEEP_TABLES.has(t) && !t.startsWith('backup_'));

        // 1. Backup each wipe table (rows only) into a fresh schema.
        await trx.raw(`CREATE SCHEMA IF NOT EXISTS "${backupSchema}"`);
        for (const t of wipe) {
          await trx.raw(`CREATE TABLE "${backupSchema}"."${t}" AS TABLE public."${t}"`);
        }

        // 2. Wipe them all in one go (CASCADE resolves FKs among the set).
        if (wipe.length) {
          const list = wipe.map((t) => `public."${t}"`).join(', ');
          await trx.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
        }

        // 3. Clear in-flight master-data approval requests. Pending quick-adds
        //    live as approval_status='pending' rows INSIDE the kept master tables
        //    (products/suppliers/customers), so a plain wipe leaves the Approvals
        //    queue + top-bar badge populated after a reset. Back the pending rows
        //    up, then delete them so a reset truly starts clean. Approved masters
        //    are untouched. (Runs after the wipe, so transactional FKs are gone.)
        const APPROVAL_MASTERS = ['products', 'suppliers', 'customers'];
        let clearedApprovals = 0;
        for (const t of APPROVAL_MASTERS) {
          if (!(await trx.schema.hasColumn(t, 'approval_status'))) continue;
          await trx.raw(
            `CREATE TABLE "${backupSchema}"."${t}_pending_approvals" AS
               SELECT * FROM public."${t}" WHERE approval_status = 'pending'`
          );
          clearedApprovals += await trx(t).where({ approval_status: 'pending' }).del();
        }

        // 4. Zero bank/cash balances (accounts are kept masters).
        await trx('bank_accounts').update({ current_balance: 0, updated_at: trx.fn.now() });

        // 5. Audit (audit_logs was just wiped — write a fresh record).
        await auditDanger(trx, req, 'reset_transactional', 'system', 'all', {
          wiped_tables: wipe.length, kept_tables: allTables.length - wipe.length,
          cleared_pending_approvals: clearedApprovals, backup_schema: backupSchema,
        });

        return { wiped: wipe.length, kept: allTables.length - wipe.length, clearedApprovals, backupSchema, wipedTables: wipe };
      });

      return res.json({
        success: true,
        message: `System reset complete — ${result.wiped} transactional tables wiped (backup: ${result.backupSchema}), ${result.kept} master/config tables kept, ${result.clearedApprovals} pending approval(s) cleared, bank balances zeroed.`,
        data: result,
      });
    } catch (err) {
      console.error('resetTransactional error:', err);
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
    return { type, row: j, children: { journal_lines: await cnt(q, 'journal_lines', 'journal_id', id) },
      willReverse: j.status === 'Draft' ? 'unposted draft — removed' : `refused: a ${j.status} journal is never deleted — reverse it in Accounting` };
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
  if (type === 'export_order') {
    const o = await q('export_orders').where('id', id).first();
    if (!o) return null;
    return { type, row: o, willReverse: 'free reservations + restock any dispatch',
      children: { items: await cnt(q, 'export_order_items', 'order_id', id), receivables: await cnt(q, 'receivables', 'order_id', id), reservations: await cnt(q, 'inventory_reservations', 'order_id', id) } };
  }
  if (type === 'milling_batch') {
    const b = await q('milling_batches').where('id', id).first();
    if (!b) return null;
    return { type, row: b, willReverse: 'same as deleting it in Milling: refused once yielded / Completed / transporter paid; otherwise raw lot, source holds, store and freight reversed (GL by signed delta)',
      children: { vehicles: await cnt(q, 'milling_vehicle_arrivals', 'batch_id', id), costs: await cnt(q, 'milling_costs', 'batch_id', id), lots: await q('inventory_lots').where('batch_ref', `batch-${id}`).count('id as c').first().then(r => parseInt(r?.c) || 0) } };
  }
  if (['customer', 'supplier', 'product'].includes(type)) {
    const table = { customer: 'customers', supplier: 'suppliers', product: 'products' }[type];
    const row = await q(table).where('id', id).first();
    if (!row) return null;
    return { type, row, willReverse: 'refuses if still referenced by live transactions' };
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
  // A return (P3-11) is its own document with its own stock, GL and refund
  // trail; a hard delete of the sale would orphan it. Refused.
  const ret = await trx('local_sale_returns').where({ local_sale_id: sale.id }).first('return_no');
  if (ret) { const e = new Error(`${sale.sale_no} has a return (${ret.return_no}) on record — it cannot be hard-deleted.`); e.status = 409; throw e; }

  // A Pending (unconfirmed) or Cancelled (rejected) sale never moved stock/money
  // — deleting it must NOT restock (that would mint phantom inventory) or reverse
  // receipts/GL that were never posted. Only a confirmed sale gets unwound.
  const posted = !['Pending', 'Cancelled'].includes(sale.status);

  // Reverse the inventory deduction back onto the lot (if still present).
  if (posted && sale.lot_id) {
    const lot = await trx('inventory_lots').where('id', sale.lot_id).first();
    if (lot) {
      // Post-5c the engine is KG end-to-end: the sale deducted `kg` from qty /
      // available_qty via postMovement, so the reversal must add back `kg` too.
      // (This was ÷1000, restocking MT → a 1000× under-restock that silently
      // destroyed the sold stock and left available_qty ≠ net_weight_kg.)
      const kg = num(sale.quantity_kg);
      await trx('inventory_lots').where('id', lot.id).update({
        qty: num(lot.qty) + kg,
        available_qty: num(lot.available_qty) + kg,
        sold_weight_kg: Math.max(0, num(lot.sold_weight_kg) - kg),
        net_weight_kg: num(lot.net_weight_kg) + kg,
        updated_at: trx.fn.now(),
      });
    }
  }
  // Packaging (e.g. katta) sale → restock mill_stock by the count sold.
  if (posted && sale.mill_item_id) {
    const count = num(sale.quantity_kg); // count stored in quantity_kg for mill-item lines
    const ms = await trx('mill_stock').where({ item_id: sale.mill_item_id, warehouse_id: null }).first();
    if (ms) await trx('mill_stock').where('id', ms.id).update({ quantity_available: num(ms.quantity_available) + count, updated_at: trx.fn.now() });
    await trx('mill_stock_movements').insert({
      item_id: sale.mill_item_id, warehouse_id: null, movement_type: 'return', quantity: count,
      reference_type: 'local_sale_reversal', reference_id: id, reason: `Reversed sale ${sale.sale_no}`, performed_by: req.user?.id || null,
    });
  }
  // Delete the sale's stock ledger rows.
  await trx('lot_transactions').where('reference_no', sale.sale_no).whereIn('transaction_type', ['local_sale_out', 'export_dispatch_out']).del();
  // Payments (+ their bank_transactions) and receivables tied to the sale.
  const payRows = await trx('payments').where('local_sale_id', id).select('id', 'payment_no');
  const payIds = payRows.map(r => r.id);
  // Each receipt carries its own GL journal (ref_no = payment_no) and the sale
  // its revenue / COGS journals (ref_no = sale_no) — net them all to zero with
  // signed deltas, as deletePayment does, or the cash would stay in the bank GL.
  const payNos = payRows.map(r => r.payment_no).filter(Boolean);
  await neutralizeRefs(trx, [sale.sale_no, ...payNos], { userId: req.user?.id, reason: `Danger Zone: local sale ${sale.sale_no} deleted` });
  if (payIds.length) {
    // Reverse any account-balance movement these receipts posted before removing
    // the ledger rows (a credit added cash → debit it back on delete).
    const bts = await trx('bank_transactions').whereIn('linked_payment_id', payIds).select('id', 'bank_account_id', 'type', 'amount', 'status');
    for (const bt of bts) await deleteBankTransaction(trx, bt);
  }
  await trx('payments').where('local_sale_id', id).del();
  await trx('receivables').where('local_sale_id', id).del();
  await trx('local_sales').where('id', id).del();

  await auditDanger(trx, req, 'hard_delete', 'local_sale', id, { sale_no: sale.sale_no, snapshot: sale });
  return { message: `Local sale ${sale.sale_no} deleted${posted ? ' and lot restocked' : ''}.`, sale_no: sale.sale_no };
}

// Reverse the CASH effect of a payment being hard-deleted: restore the bank
// balance it moved and drop its sub-ledger rows. A receipt incremented the
// balance (→ decrement to reverse); a payment decremented it (→ increment). An
// uncleared post-dated cheque never moved the balance, so skip it. Currency-aware:
// a foreign payment into a matching account moved the native amount, else the PKR
// equivalent — mirror what recordPayment/payPurchase banked.
async function reversePaymentCash(trx, p) {
  if (!p) return;
  if (p.bank_account_id && p.cleared !== false) {
    const acct = await trx('bank_accounts').where('id', p.bank_account_id).first();
    const moved = acct && acct.currency === (p.currency || 'PKR')
      ? num(p.amount)
      : (num(p.base_amount_pkr) || num(p.amount));
    if (moved > 0) {
      const dir = p.type === 'receipt' ? -1 : 1;
      await trx('bank_accounts').where('id', p.bank_account_id).increment('current_balance', dir * moved);
    }
  }
  // A bounced cheque moved nothing itself, but its bank return charge (and any
  // legacy move it undid) left rows of their own — put their balance back.
  if (p.cleared === false) {
    const bounceRows = await trx('bank_transactions').where({ linked_payment_id: p.id, source: 'cheque_bounce' });
    for (const b of Array.isArray(bounceRows) ? bounceRows : []) {
      const signed = (b.type === 'credit' ? -1 : 1) * num(b.amount);
      if (b.bank_account_id && signed) await trx('bank_accounts').where('id', b.bank_account_id).increment('current_balance', signed);
    }
  }
  // Delete the bank_transactions trail. linked_payment_id is now set at source;
  // the notes fallback catches legacy record_payment rows that predate that fix.
  await trx('bank_transactions')
    .where('linked_payment_id', p.id)
    .orWhere((q) => q.where('notes', 'ilike', `%${p.payment_no}%`).whereIn('source', ['record_payment', 'cheque_clear', 'local_sale']))
    .del();
}

// Draw a local sale's paid/due state back by `amt` when a receipt against it is
// deleted (the inverse of recordPayment/create's forward mirror).
async function unmirrorLocalSale(trx, saleId, amt) {
  const sale = await trx('local_sales').where('id', saleId).first();
  if (!sale) return;
  const paid = Math.max(0, num(sale.paid_amount) - amt);
  // A return's credit (P3-11) stays off the total — it is not a payment.
  const due = Math.max(0, num(sale.total_amount) - paid - await creditedOnSale(trx, sale.id));
  // Paid / Partial / Credit only — 'Unpaid' is not allowed by
  // chk_local_sales_payment_status_valid.
  const status = due <= 0.01 ? 'Paid' : (paid > 0.01 ? 'Partial' : 'Credit');
  await trx('local_sales').where('id', sale.id).update({ paid_amount: paid, due_amount: due, payment_status: status, updated_at: trx.fn.now() });
}

async function deletePayment(trx, req, id) {
  const p = await trx('payments').where('id', id).first();
  if (!p) { const e = new Error('Payment not found.'); e.status = 404; throw e; }
  const amt = num(p.amount);
  // An uncleared post-dated cheque never settled the payable/receivable or moved
  // the source row — so only un-apply the settlement when the payment cleared (M2).
  const settled = p.cleared !== false;

  if (settled && p.linked_payable_id) {
    const pay = await trx('payables').where('id', p.linked_payable_id).first();
    if (pay) {
      const paid = Math.max(0, num(pay.paid_amount) - amt);
      const outstanding = num(pay.outstanding) + amt;
      await trx('payables').where('id', pay.id).update({
        paid_amount: paid, outstanding,
        status: paid <= 0 ? 'Pending' : 'Partial', updated_at: trx.fn.now(),
      });
      // Un-mirror the source row's paid state (recordPayment mirrors it forward,
      // so a deleted payment must un-mirror it or the source reads paid while the
      // payable reads unpaid — the two ledgers drift) (M1).
      for (const st of ['business_expenses', 'mill_purchases']) {
        if (pay.source_table === st && pay.source_id) {
          const src = await trx(st).where('id', pay.source_id).first();
          if (src) {
            const sp = Math.max(0, num(src.paid_amount) - amt);
            await trx(st).where('id', src.id).update({
              paid_amount: sp, payment_status: sp <= 0 ? 'Pending' : 'Partial', updated_at: trx.fn.now(),
            });
          }
        }
      }
    }
  }
  if (settled && p.linked_receivable_id) {
    const rec = await trx('receivables').where('id', p.linked_receivable_id).first();
    if (rec) {
      const received = Math.max(0, num(rec.received_amount) - amt);
      const outstanding = num(rec.outstanding) + amt;
      await trx('receivables').where('id', rec.id).update({
        received_amount: received, outstanding,
        status: received <= 0 ? 'Pending' : 'Partial', updated_at: trx.fn.now(),
      });
      // Un-mirror the parent local sale (M1) — recordPayment draws it down forward.
      if (rec.local_sale_id) await unmirrorLocalSale(trx, rec.local_sale_id, amt);
    }
  }
  // A receipt linked ONLY to a local sale (no receivable) — draw the sale back too.
  if (settled && p.local_sale_id && !p.linked_receivable_id) await unmirrorLocalSale(trx, p.local_sale_id, amt);
  await reversePaymentCash(trx, p); // restore bank balance + drop the bank trail
  // Net the payment's GL (and a bounce's) back to zero with signed deltas.
  await neutralizeRefs(trx, [p.payment_no], { userId: req.user?.id, reason: `Danger Zone: payment ${p.payment_no} deleted` });
  await trx('payments').where('id', id).del();

  await auditDanger(trx, req, 'hard_delete', 'payment', id, { payment_no: p.payment_no, snapshot: p });
  return { message: `Payment ${p.payment_no} deleted${p.linked_payable_id || p.linked_receivable_id ? ' and AR/AP restored' : ''}.`, payment_no: p.payment_no };
}

async function deleteJournalEntry(trx, req, id) {
  const j = await trx('journal_entries').where('id', id).first();
  if (!j) { const e = new Error('Journal entry not found.'); e.status = 404; throw e; }
  // Only an unposted draft may go: a Posted (or Reversed) journal is the
  // books' history — deleting it rewrites the trial balance, in any period
  // (P2-23 / ADM-17). Reverse it in Accounting instead.
  if (j.status !== 'Draft') {
    const e = new Error(`Journal ${j.journal_no} is ${j.status} — it cannot be deleted. Reverse it in Accounting (a signed-delta journal) instead.`);
    e.status = 409; throw e;
  }
  // Null out any reversal references pointing at this entry (NO ACTION FK).
  await trx('journal_entries').where('reversal_of', id).update({ reversal_of: null });
  await trx('journal_lines').where('journal_id', id).del(); // RESTRICT since mig 368
  await trx('journal_entries').where('id', id).del();
  await auditDanger(trx, req, 'hard_delete', 'journal_entry', id, { journal_no: j.journal_no, snapshot: j });
  return { message: `Journal entry ${j.journal_no} deleted.`, journal_no: j.journal_no };
}

async function deleteLotTransaction(trx, req, id) {
  const t = await trx('lot_transactions').where('id', id).first();
  if (!t) { const e = new Error('Lot transaction not found.'); e.status = 404; throw e; }
  // A ledger row that moved stock is what the lot's quantity is built from —
  // deleting it leaves the lot out of step with its ledger (ADM-17). Only a
  // zero-quantity row (a note / failed post) may go; correct stock with a
  // stock adjustment instead.
  if (Math.abs(num(t.quantity_kg)) > 0.0005) {
    const e = new Error(`Lot transaction ${t.transaction_no || id} moved ${t.quantity_kg} kg — deleting it would put the lot out of step with its ledger. Post a stock adjustment instead.`);
    e.status = 409; throw e;
  }
  await trx('lot_transactions').where('id', id).del();
  await auditDanger(trx, req, 'hard_delete', 'lot_transaction', id, { transaction_no: t.transaction_no, snapshot: t });
  return { message: `Lot transaction ${t.transaction_no} deleted.`, transaction_no: t.transaction_no };
}

async function deleteMillPurchase(trx, req, id) {
  const mp = await trx('mill_purchases').where('id', id).first();
  if (!mp) { const e = new Error('Mill purchase not found.'); e.status = 404; throw e; }
  // Reverse stock added by this purchase — keyed on (item_id, warehouse_id), the
  // same bucket createPurchase upserted into (a plain item_id match could hit the
  // wrong warehouse row).
  const items = await trx('mill_purchase_items').where('purchase_id', id);
  for (const it of items) {
    const stockQ = trx('mill_stock').where('item_id', it.item_id);
    if (it.warehouse_id == null) stockQ.whereNull('warehouse_id'); else stockQ.where('warehouse_id', it.warehouse_id);
    const stock = await stockQ.first();
    if (stock) {
      await trx('mill_stock').where('id', stock.id).update({
        quantity_available: Math.max(0, num(stock.quantity_available) - num(it.quantity)), updated_at: trx.fn.now(),
      });
    }
  }
  await trx('mill_stock_movements').where({ reference_type: 'purchase', reference_id: id }).del();
  // Reverse + drop any payments made against this purchase's payable (restore the
  // bank balance, drop the bank trail) before deleting the payable, so a paid
  // purchase doesn't leave orphaned payments + cash drift.
  const payableIds = (await trx('payables').where({ source_table: 'mill_purchases', source_id: id }).select('id')).map((r) => r.id);
  const pays = payableIds.length ? await trx('payments').whereIn('linked_payable_id', payableIds) : [];
  for (const pay of pays) await reversePaymentCash(trx, pay);
  // Net the store_purchase GL (DR 1250 / CR 2010, keyed on purchase_no) and
  // each payment's GL to zero with signed deltas — never delete them.
  await neutralizeRefs(trx, [mp.purchase_no, ...pays.map((p) => p.payment_no)], {
    userId: req.user?.id, reason: `Danger Zone: mill purchase ${mp.purchase_no} deleted`,
  });
  if (pays.length) await trx('payments').whereIn('linked_payable_id', payableIds).del();
  await trx('payables').where({ source_table: 'mill_purchases', source_id: id }).del();
  await trx('mill_purchases').where('id', id).del(); // mill_purchase_items cascade
  await auditDanger(trx, req, 'hard_delete', 'mill_purchase', id, { purchase_no: mp.purchase_no, snapshot: mp });
  return { message: `Mill purchase ${mp.purchase_no} deleted (stock, GL & payments reversed).`, purchase_no: mp.purchase_no };
}

// Best-effort table delete that ignores "table does not exist" so the cascade
// helpers below stay resilient to schema differences.
async function delIfExists(trx, table, where) {
  if (await trx.schema.hasTable(table)) await trx(table).where(where).del();
}

// Delete rows by a column value, skipping the table if it (or the column)
// doesn't exist — so a child table missing the expected FK column never 500s
// the whole cascade.
async function delByCol(trx, table, col, id) {
  if (!(await trx.schema.hasTable(table))) return;
  if (!(await trx.schema.hasColumn(table, col))) return;
  await trx(table).where(col, id).del();
}

async function deleteExportOrder(trx, req, id) {
  const order = await trx('export_orders').where('id', id).first();
  if (!order) { const e = new Error('Export order not found.'); e.status = 404; throw e; }
  const orderNo = order.order_no;

  // Credit / debit notes and printed-bag orders carry their own postings and
  // payables (RESTRICT since mig 368) — cancel / void those first.
  for (const [t, label] of [['credit_notes', 'credit note(s)'], ['export_debit_notes', 'debit note(s)'], ['printed_bag_orders', 'printed-bag order(s)']]) {
    if (!(await trx.schema.hasTable(t))) continue;
    const c = await trx(t).where('order_id', id).count('id as c').first();
    if (parseInt(c?.c) > 0) {
      const e = new Error(`Export order ${orderNo} has ${c.c} ${label} — void or delete those first.`);
      e.status = 409; throw e;
    }
  }

  // Free reservations + restock anything already dispatched, so inventory stays right.
  const reservations = await trx('inventory_reservations').where('order_id', id);
  for (const r of reservations) {
    const lot = await trx('inventory_lots').where('id', r.lot_id).first();
    if (lot) {
      const newReserved = Math.max(0, num(lot.reserved_qty) - num(r.reserved_qty));
      await trx('inventory_lots').where('id', lot.id).update({ reserved_qty: newReserved, available_qty: num(lot.qty) - newReserved, updated_at: trx.fn.now() });
    }
  }
  await trx('inventory_reservations').where('order_id', id).del();
  // Restock what was dispatched, from the canonical ledger (signed KG). Each
  // export_dispatch_out row's quantity_kg is negative; add its magnitude back to
  // qty / available_qty / net_weight_kg (postMovement moved all three on dispatch).
  const dispatched = await trx('lot_transactions').where({ reference_no: orderNo, transaction_type: 'export_dispatch_out' });
  for (const m of dispatched) {
    const restoreKg = Math.abs(num(m.quantity_kg));
    const lot = await trx('inventory_lots').where('id', m.lot_id).first();
    if (lot) await trx('inventory_lots').where('id', lot.id).update({ qty: num(lot.qty) + restoreKg, available_qty: num(lot.available_qty) + restoreKg, net_weight_kg: num(lot.net_weight_kg) + restoreKg, updated_at: trx.fn.now() });
  }
  await trx('lot_transactions').where('reference_no', orderNo).whereIn('transaction_type', ['export_dispatch_out', 'export_allocation', 'export_release']).del();

  // Payments tied to this order's receivables (+ their bank trail), then the rest.
  // Receipts: put the bank balance back (as deletePayment does — this used to
  // drop the bank rows without restoring the balance) and net their GL.
  const recvIds = (await trx('receivables').where('order_id', id).select('id')).map((r) => r.id);
  const pays = recvIds.length ? await trx('payments').whereIn('linked_receivable_id', recvIds) : [];
  for (const p of pays) await reversePaymentCash(trx, p);
  // The order's own GL (revenue / COGS / advance clearing, ref_no = order_no)
  // and each receipt's GL are netted to zero by signed deltas — never deleted.
  await neutralizeRefs(trx, [orderNo, ...pays.map((p) => p.payment_no)], {
    userId: req.user?.id, reason: `Danger Zone: export order ${orderNo} deleted`,
  });
  if (pays.length) await trx('payments').whereIn('id', pays.map((p) => p.id)).del();
  for (const t of ['export_order_items', 'export_order_status_history', 'export_order_costs', 'export_order_documents', 'order_packing_lines', 'shipment_containers', 'receivables', 'advance_allocations', 'advance_payments']) {
    await delByCol(trx, t, 'order_id', id); // skips tables without an order_id column
  }
  await delByCol(trx, 'internal_transfers', 'export_order_id', id);
  await trx('export_orders').where('id', id).del();

  await auditDanger(trx, req, 'hard_delete', 'export_order', id, { order_no: orderNo, snapshot: order });
  return { message: `Export order ${orderNo} deleted (reservations freed, dispatch restocked).`, order_no: orderNo };
}

// A milling batch goes through the milling module's own delete (P2-23 /
// MIL-18): the same refusals (Completed / yielded / paid transporter / service
// invoices) and the same reversals (raw lot, source-lot holds, store
// consumption, packaging, packing GL and freight accrual as signed deltas).
// The Danger Zone used to hard-delete the batch's journals by ref_no and its
// raw-rice payable + payments without their GL; a batch past that point is now
// refused with the step to take first (reverse the yield).
async function deleteMillingBatch(trx, req, id) {
  const batch = await trx('milling_batches').where('id', id).first();
  if (!batch) { const e = new Error('Milling batch not found.'); e.status = 404; throw e; }
  try {
    await deleteBatchTx(trx, batch.id, req.user?.id || null);
  } catch (err) {
    if (err.statusCode) {
      const e = new Error(err.message);
      e.status = err.statusCode === 404 ? 404 : 409;
      throw e;
    }
    throw err;
  }
  await auditDanger(trx, req, 'hard_delete', 'milling_batch', id, { batch_no: batch.batch_no, snapshot: batch, via: 'milling.deleteBatch' });
  return { message: `Milling batch ${batch.batch_no} deleted (raw lot, holds, store and freight reversed).`, batch_no: batch.batch_no };
}

// Delete a master record only if nothing live still references it.
async function deleteMaster(trx, req, type, id) {
  const table = { customer: 'customers', supplier: 'suppliers', product: 'products' }[type];
  const refs = {
    customer: [['export_orders', 'customer_id'], ['local_sales', 'customer_id'], ['receivables', 'customer_id']],
    supplier: [['inventory_lots', 'supplier_id'], ['milling_batches', 'supplier_id'], ['payables', 'supplier_id'], ['mill_purchases', 'supplier_id']],
    product: [['inventory_lots', 'product_id'], ['export_orders', 'product_id'], ['export_order_items', 'product_id'], ['milling_batches', 'product_id']],
  }[type];
  const row = await trx(table).where('id', id).first();
  if (!row) { const e = new Error(`${type} not found.`); e.status = 404; throw e; }
  for (const [t, col] of refs) {
    if (!(await trx.schema.hasTable(t))) continue;
    const used = await trx(t).where(col, id).count('id as c').first();
    if (parseInt(used?.c) > 0) {
      const e = new Error(`Cannot delete this ${type}: still referenced by ${used.c} ${t} row(s). Delete those first or reset the system.`);
      e.status = 409; throw e;
    }
  }
  // The enumerated guard above covers the common references with a friendly count,
  // but many other NO-ACTION FKs point at these masters. Catch a Postgres FK
  // violation (23503) from the delete and surface it as the same 409 instead of an
  // opaque 500, naming the referencing table so the user knows what still points here.
  try {
    await trx(table).where('id', id).del();
  } catch (err) {
    if (err.code === '23503') {
      const refTable = err.table || 'another record';
      const e = new Error(`Cannot delete this ${type}: still referenced by ${refTable}. Delete those first or reset the system.`);
      e.status = 409; throw e;
    }
    throw err;
  }
  await auditDanger(trx, req, 'hard_delete', type, id, { name: row.name, snapshot: row });
  return { message: `${type} "${row.name || id}" deleted.`, id };
}

module.exports = dangerZone;
module.exports.KEEP_TABLES = KEEP_TABLES;
