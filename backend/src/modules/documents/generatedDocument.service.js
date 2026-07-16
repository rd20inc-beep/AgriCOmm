const db = require('../../config/database');
const { nextDocNo } = require('../../utils/docNumber');
const { assembleDocument } = require('./exportDocument.controller');

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
};

module.exports = generatedDocumentService;
