const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const { assembleDocument } = require('./exportDocument.controller');

// Allowed status transitions for a generated document (self-contained — models
// the pattern of exportOrders.workflow but never touches order status).
const GEN_DOC_TRANSITIONS = {
  'Draft': ['Under Review', 'Cancelled'],
  'Under Review': ['Approved', 'Draft', 'Cancelled'],
  'Approved': ['Sent to Bank', 'Sent to Chamber', 'Issued to Customer', 'Cancelled'],
  'Sent to Bank': ['Sent to Chamber', 'Issued to Customer', 'Cancelled'],
  'Sent to Chamber': ['Sent to Bank', 'Issued to Customer', 'Cancelled'],
  'Issued to Customer': ['Cancelled'],
  'Revised': [],
  'Cancelled': [],
};
// A document is locked (immutable — edits require a Revise) once Approved or issued.
const LOCKED_STATUSES = new Set(['Approved', 'Sent to Bank', 'Sent to Chamber', 'Issued to Customer']);

// Hard validation that must pass before a document can be Approved. Mirrors the
// preview's blocking rules so the gate can't be bypassed from the client.
function validateForApproval(doc) {
  const errors = [];
  if (!doc) return ['Document could not be assembled.'];
  const totals = doc.totals || {};
  const net = parseFloat(totals.netWeightKg) || 0;
  const gross = parseFloat(totals.grossWeightKg) || 0;
  if (net > 0 && gross > 0 && gross + 0.001 < net) errors.push('Gross weight is less than net weight.');
  if (!net) errors.push('Net weight is not recorded.');
  if (!gross) errors.push('Gross weight is not recorded.');
  if (!(parseFloat(totals.totalPackages) || 0)) errors.push('Total packages is not recorded.');
  const items = Array.isArray(doc.items) ? doc.items : [];
  const singleHs = doc.order && doc.order.hsCodes && doc.order.hsCodes.single;
  items.forEach((it, i) => {
    const q = parseFloat(it.qtyMT) || 0;
    const p = parseFloat(it.pricePerMT) || 0;
    const a = parseFloat(it.lineTotal) || 0;
    if (q > 0 && p > 0 && Math.abs(a - q * p) > 0.5) errors.push(`Line ${i + 1}: amount ≠ quantity × unit price.`);
    if (!it.hsCode && !singleHs) errors.push(`Line ${i + 1}: HS code missing.`);
  });
  const b = (doc.company && doc.company.bank) || {};
  if (b.withheld) errors.push('No bank account is available for this document.');
  else {
    if (!b.title) errors.push('Bank account title is missing.');
    if (!b.account) errors.push('Bank account number is missing.');
    if (!b.iban) errors.push('Bank IBAN is missing.');
    if (!b.swift) errors.push('Bank SWIFT/BIC is missing.');
  }
  return errors;
}

// ── merge helpers ──────────────────────────────────────────────────────────
function isPlainObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}
// Recursively merge an overrides patch over the frozen snapshot. Arrays and
// scalars in the patch replace wholesale; nested plain objects merge key-by-key.
function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) {
    out[k] = isPlainObject(patch[k]) && isPlainObject(base[k]) ? deepMerge(base[k], patch[k]) : patch[k];
  }
  return out;
}

// The rendered (snapshot ⊕ overrides) document for a stored row.
function mergedDocument(row) {
  const snap = row.snapshot_json || {};
  const ov = row.overrides_json || {};
  return deepMerge(snap, ov);
}

const generatedDocumentService = {
  deepMerge,
  mergedDocument,

  // Return the latest live version for (order, doc_type), or null.
  async getLatest(orderId, docType, trx = db) {
    return trx('generated_documents')
      .where({ order_id: orderId, doc_type: docType, is_latest: true })
      .first();
  },

  // Create a Draft, or return the existing open version. Throws 409 when the
  // latest version is locked (Approved / Issued) — the caller must Revise.
  async createDraft(orderId, docType, userId) {
    return db.transaction(async (trx) => {
      const latest = await this.getLatest(orderId, docType, trx);
      if (latest) {
        if (latest.locked) {
          const e = new Error(`This document is ${latest.status} and locked. Create a revision to make changes.`);
          e.status = 409;
          e.code = 'DOC_LOCKED';
          throw e;
        }
        return latest;
      }
      const snapshot = await assembleDocument(orderId, docType);
      const doc_no = await nextDocNo(trx, { table: 'generated_documents', column: 'doc_no', prefix: 'GD-', pad: 5 });
      const [row] = await trx('generated_documents')
        .insert({
          doc_no,
          order_id: orderId,
          doc_type: docType,
          version: 1,
          is_latest: true,
          status: 'Draft',
          snapshot_json: JSON.stringify(snapshot),
          audience: 'internal',
          generated_by: userId || null,
        })
        .returning('*');
      return row;
    });
  },

  // Save preview edits as an overrides patch. Rejects when locked.
  async saveOverrides(genId, { overrides, editedHtml }, userId) {
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).first();
      if (!row) { const e = new Error('Document version not found.'); e.status = 404; throw e; }
      if (row.locked) { const e = new Error('This document is locked. Create a revision to edit it.'); e.status = 409; e.code = 'DOC_LOCKED'; throw e; }
      const merged = deepMerge(row.overrides_json || {}, overrides || {});
      const [updated] = await trx('generated_documents')
        .where({ id: genId })
        .update({
          overrides_json: JSON.stringify(merged),
          edited_html: editedHtml != null ? editedHtml : row.edited_html,
          updated_at: db.fn.now(),
        })
        .returning('*');
      return updated;
    });
  },

  async getById(genId) {
    return db('generated_documents').where({ id: genId }).first();
  },

  async listVersions(orderId, docType) {
    return db('generated_documents')
      .where({ order_id: orderId, doc_type: docType })
      .orderBy('version', 'desc');
  },

  transitions: GEN_DOC_TRANSITIONS,
  validateForApproval,

  // Update preview settings (bank account / audience / copy label). Rejected
  // when locked. Does NOT touch the order/customer source.
  async updateSettings(genId, { bankAccountId, audience, copyLabel }, userId) { // eslint-disable-line no-unused-vars
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).first();
      if (!row) { const e = new Error('Document version not found.'); e.status = 404; throw e; }
      if (row.locked) { const e = new Error('This document is locked. Create a revision to change it.'); e.status = 409; e.code = 'DOC_LOCKED'; throw e; }
      const patch = { updated_at: db.fn.now() };
      if (bankAccountId !== undefined) patch.bank_account_id = bankAccountId || null;
      if (audience !== undefined) patch.audience = audience;
      if (copyLabel !== undefined) patch.copy_label = copyLabel || null;
      const [updated] = await trx('generated_documents').where({ id: genId }).update(patch).returning('*');
      return updated;
    });
  },

  // Draft → Under Review.
  async submit(genId, userId) {
    return this._setStatus(genId, 'Under Review', { userId });
  },

  // Approve: validates the assembled document, then locks it.
  async approve(genId, userId) {
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).first();
      if (!row) { const e = new Error('Document version not found.'); e.status = 404; throw e; }
      if (!(GEN_DOC_TRANSITIONS[row.status] || []).includes('Approved')) {
        const e = new Error(`Cannot approve a ${row.status} document.`); e.status = 409; throw e;
      }
      // Re-assemble fresh (bank re-resolved from the selected account) and validate.
      const doc = await this._assembledForRow(row, trx);
      const errors = validateForApproval(doc);
      if (errors.length) { const e = new Error('Document failed validation.'); e.status = 422; e.code = 'VALIDATION'; e.errors = errors; throw e; }
      const [updated] = await trx('generated_documents').where({ id: genId })
        .update({ status: 'Approved', locked: true, approved_by: userId || null, approved_at: db.fn.now(), updated_at: db.fn.now() })
        .returning('*');
      return updated;
    });
  },

  // Approved → Sent to Bank / Sent to Chamber / Issued to Customer / Cancelled.
  async setStatus(genId, toStatus, userId) {
    return this._setStatus(genId, toStatus, { userId });
  },

  async _setStatus(genId, toStatus, { userId }) {
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).first();
      if (!row) { const e = new Error('Document version not found.'); e.status = 404; throw e; }
      if (!(GEN_DOC_TRANSITIONS[row.status] || []).includes(toStatus)) {
        const e = new Error(`Cannot move a ${row.status} document to ${toStatus}.`); e.status = 409; throw e;
      }
      const patch = { status: toStatus, updated_at: db.fn.now() };
      // Moving back to Draft (rework from review) unlocks; issuing keeps locked.
      if (toStatus === 'Draft') patch.locked = false;
      if (LOCKED_STATUSES.has(toStatus)) patch.locked = true;
      const [updated] = await trx('generated_documents').where({ id: genId }).update(patch).returning('*');
      return updated;
    });
  },

  // Revise a locked (Approved/issued) document: retire the old version and open
  // a fresh Draft with a re-gathered snapshot, chained via previous_version_id.
  async revise(genId, userId, reason) {
    if (!reason || !String(reason).trim()) { const e = new Error('A revision reason is required.'); e.status = 400; throw e; }
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).first();
      if (!row) { const e = new Error('Document version not found.'); e.status = 404; throw e; }
      if (!row.is_latest) { const e = new Error('Only the latest version can be revised.'); e.status = 409; throw e; }
      const snapshot = await assembleDocument(row.order_id, row.doc_type);
      const doc_no = await nextDocNo(trx, { table: 'generated_documents', column: 'doc_no', prefix: 'GD-', pad: 5 });
      await trx('generated_documents').where({ id: row.id }).update({ is_latest: false, status: 'Revised', updated_at: db.fn.now() });
      const [created] = await trx('generated_documents').insert({
        doc_no,
        order_id: row.order_id,
        doc_type: row.doc_type,
        version: (row.version || 1) + 1,
        is_latest: true,
        previous_version_id: row.id,
        status: 'Draft',
        snapshot_json: JSON.stringify(snapshot),
        audience: row.audience,
        bank_account_id: row.bank_account_id,
        copy_label: row.copy_label,
        revision_reason: String(reason).trim(),
        generated_by: userId || null,
        locked: false,
      }).returning('*');
      return created;
    });
  },

  // Re-resolve the document for a row: merged snapshot ⊕ overrides, with the
  // bank re-resolved from the row's selected account (so switching accounts in
  // the preview reflects immediately). UNMASKED — caller masks per viewer.
  async _assembledForRow(row, trx = db) {
    const doc = mergedDocument(row);
    if (row.bank_account_id) {
      const { bankFromAccount } = require('./exportDocument.controller');
      const acct = await trx('bank_accounts').where({ id: row.bank_account_id }).first();
      if (acct && doc.company) doc.company.bank = bankFromAccount(acct);
    }
    return doc;
  },
};

module.exports = generatedDocumentService;
