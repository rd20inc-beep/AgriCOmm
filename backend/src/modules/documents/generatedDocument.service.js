const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const { assembleDocument } = require('./exportDocument.controller');
const { sanitizeDocumentHtml } = require('./htmlSanitizer');

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

// D-30: only an Approved (or already issued) document may be sent to a buyer or
// bank — EXCEPT the Proforma Invoice, which is what gets sent to obtain the
// advance and so must go out before the document set is approved.
const PROFORMA_TYPES = new Set(['proforma-invoice', 'proforma_invoice', 'proforma', 'pi']);
const isProformaType = (docType) => PROFORMA_TYPES.has(String(docType || '').toLowerCase());

// The stored body a version renders from: the saved rendering, else (versions
// saved before renderings were stored) the operator's edited HTML. Sanitized
// again on the way out — older rows were stored before sanitizing existed.
function storedBody(row) {
  const body = row && (row.rendered_html || row.edited_html);
  return body ? sanitizeDocumentHtml(body) : null;
}

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * Throw unless this version may be emailed / WhatsApp-ed.
 * @param {object|null} row  generated_documents row
 */
function assertSendable(row) {
  if (!row) {
    throw httpError(409, 'DOC_NOT_SAVED', 'This document has not been saved yet. Open it in the Document Center first.');
  }
  if (row.status === 'Cancelled' || row.status === 'Revised' || row.is_latest === false) {
    throw httpError(409, 'DOC_NOT_SENDABLE', `This version is ${row.status === 'Cancelled' ? 'cancelled' : 'superseded'} and cannot be sent.`);
  }
  if (!isProformaType(row.doc_type) && !LOCKED_STATUSES.has(row.status)) {
    throw httpError(409, 'DOC_NOT_APPROVED',
      `This document is ${row.status} — it must be approved before it can be sent. Submit it for review and approve it first (only the Proforma Invoice can be sent before approval).`);
  }
}

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
  storedBody,
  assertSendable,
  isProformaType,
  LOCKED_STATUSES,

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
      const patch = { overrides_json: JSON.stringify(merged), updated_at: db.fn.now() };
      if (editedHtml != null) {
        // The edited preview IS the document now — store it (sanitized) as both
        // the edit and the rendering that PDF / send use.
        const clean = sanitizeDocumentHtml(editedHtml);
        patch.edited_html = clean;
        patch.rendered_html = clean || null;
        patch.rendered_at = db.fn.now();
      }
      const [updated] = await trx('generated_documents')
        .where({ id: genId })
        .update(patch)
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
      // Bank / audience / copy change what the document shows, so the stored
      // rendering is stale; the preview stores a fresh one on its next save.
      patch.rendered_html = null;
      patch.rendered_at = null;
      const [updated] = await trx('generated_documents').where({ id: genId }).update(patch).returning('*');
      return updated;
    });
  },

  /**
   * Store the document body as the operator sees it, for PDF / send.
   * Allowed while the version is open. Once locked it is frozen — except that a
   * version approved before renderings were stored (none on file) may have one
   * captured ONCE, by someone who may approve documents.
   */
  async saveRendering(genId, html, { canApprove = false } = {}) {
    const clean = sanitizeDocumentHtml(html);
    if (!clean.trim()) throw httpError(400, 'EMPTY', 'Document content is required.');
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).forUpdate().first();
      if (!row) throw httpError(404, undefined, 'Document version not found.');
      if (row.locked) {
        if (row.rendered_html || row.edited_html) {
          throw httpError(409, 'DOC_LOCKED', 'This document is locked. Create a revision to change it.');
        }
        if (!canApprove) {
          throw httpError(403, 'DOC_LOCKED', 'This approved document has no stored copy yet. Ask someone who can approve documents to open it once.');
        }
      }
      const [updated] = await trx('generated_documents').where({ id: genId })
        .update({ rendered_html: clean, rendered_at: db.fn.now(), updated_at: db.fn.now() })
        .returning('*');
      return updated;
    });
  },

  // Draft → Under Review.
  async submit(genId, userId) {
    return this._setStatus(genId, 'Under Review', { userId });
  },

  // Approve: validates the assembled document, then locks it.
  // `renderedHtml` is the document as the approver sees it on approval; it is
  // stored in the same transaction, so what was approved is what gets sent.
  async approve(genId, userId, renderedHtml) {
    return db.transaction(async (trx) => {
      const row = await trx('generated_documents').where({ id: genId }).first();
      if (!row) { const e = new Error('Document version not found.'); e.status = 404; throw e; }
      if (!(GEN_DOC_TRANSITIONS[row.status] || []).includes('Approved')) {
        const e = new Error(`Cannot approve a ${row.status} document.`); e.status = 409; throw e;
      }
      // Maker-checker (P2-32 / EXP-39): whoever generated this version may not
      // also approve it — unless they are the Owner, who may sign off alone.
      if (row.generated_by != null && userId != null && Number(row.generated_by) === Number(userId)) {
        const user = await trx('users').where({ id: userId }).first();
        const role = user && user.role_id != null ? await trx('roles').where({ id: user.role_id }).first() : null;
        if (role?.name !== 'Owner') {
          const e = new Error('You generated this document version — a different person must approve it (or the Owner).');
          e.status = 403; e.code = 'MAKER_CHECKER'; throw e;
        }
      }
      // Re-assemble fresh (bank re-resolved from the selected account) and validate.
      const doc = await this._assembledForRow(row, trx);
      const errors = validateForApproval(doc);
      if (errors.length) { const e = new Error('Document failed validation.'); e.status = 422; e.code = 'VALIDATION'; e.errors = errors; throw e; }
      const patch = { status: 'Approved', locked: true, approved_by: userId || null, approved_at: db.fn.now(), updated_at: db.fn.now() };
      const clean = renderedHtml ? sanitizeDocumentHtml(renderedHtml) : '';
      if (clean.trim()) { patch.rendered_html = clean; patch.rendered_at = db.fn.now(); }
      const [updated] = await trx('generated_documents').where({ id: genId })
        .update(patch)
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
