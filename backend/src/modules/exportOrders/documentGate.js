// The export document gate (P3-17, owner decision D-17 (a), 2026-10-15).
//
// ONE state machine for "is this required document in place?". It used to be
// three: export_order_documents (a 'Confirm Ready' tick with no file behind
// it), document_checklists.is_fulfilled (reset by the second of two upload
// calls) and document_store (the files themselves). The gate now reads only
// the evidence:
//
//   * a STORED file of the type — live (is_latest, Approved/Final, no deletion
//     pending, a file on disk) and CHECKED by a second person (checked_by,
//     stamped by documents.service.approveDocument, which refuses the uploader
//     unless they are the Owner — the same maker/checker rule generated
//     documents already follow); or
//   * an APPROVED generated document of the type (the system renders it, a
//     second person approves it, and the copy approved is stored).
//
// A tick is not enough. document_checklists stays as the list of what an order
// requires and as a cache of the answer (other modules read is_fulfilled);
// syncChecklist rewrites it from the evidence after every document change.
//
// Post-shipment documents (Certificate of Origin, BL Final and the other
// documents issued once the vessel has sailed) need the order Shipped before
// they can be generated or approved (EXP-34).

// The seven checklist documents an export order needs, each with every doc_type
// spelling that has been stored for it (checklist rows use the snake_case one,
// uploads from the Documents tab the camelCase key).
const DOC_TYPE_ALIASES = {
  'phyto': ['phyto', 'Phytosanitary Certificate'],
  'blDraft': ['blDraft', 'bl_draft', 'BL Draft'],
  'blFinal': ['blFinal', 'bl_final', 'BL Final'],
  'invoice': ['invoice', 'commercial_invoice', 'Commercial Invoice'],
  'packingList': ['packingList', 'packing_list', 'Packing List'],
  'coo': ['coo', 'Certificate of Origin'],
  'fumigation': ['fumigation', 'Fumigation Certificate'],
};
const REQUIRED_DOCS = Object.keys(DOC_TYPE_ALIASES);
// Issued only once the vessel has sailed, so they can't hold up the shipment
// they evidence: the BL Final comes from the carrier, and the Certificate of
// Origin is endorsed by the chamber against the shipped BL. Both are still
// required, for Close.
const POST_SHIPMENT_DOCS = ['blFinal', 'coo'];
const PRE_SHIPMENT_DOCS = REQUIRED_DOCS.filter((k) => !POST_SHIPMENT_DOCS.includes(k));
const POST_SHIPMENT_DOC_TYPES = new Set(POST_SHIPMENT_DOCS.flatMap((k) => DOC_TYPE_ALIASES[k]));

// The system-generated document types that stand for a checklist document.
// Phyto, fumigation and the BL Final are issued outside the system: upload only.
const GENERATED_TYPES = {
  invoice: ['commercial-invoice'],
  packingList: ['packing-list'],
  blDraft: ['bill-of-lading'],
  coo: ['certificate-of-origin'],
};
// Generated documents that only exist once the goods have sailed: the
// certificate / statement of origin and the letters covering the shipped set.
const POST_SHIPMENT_GENERATED = new Set([
  'certificate-of-origin', 'statement-of-origin', 'bank-covering-letter', 'buyer-covering-letter',
]);
const SHIPPED_STATUSES = new Set(['Shipped', 'Arrived', 'Closed']);

// A generated version counts once approved; the issued statuses follow
// approval and stay locked.
const GENERATED_APPROVED = ['Approved', 'Sent to Bank', 'Sent to Chamber', 'Issued to Customer'];
const FILE_LIVE = ['Approved', 'Final'];

const DOC_LABELS = {
  phyto: 'Phytosanitary Certificate', blDraft: 'BL Draft', blFinal: 'BL Final',
  invoice: 'Commercial Invoice', packingList: 'Packing List', coo: 'Certificate of Origin',
  fumigation: 'Fumigation Certificate',
};

/** The checklist key ('invoice', 'blDraft', …) a stored doc_type belongs to, or null. */
function keyForDocType(docType) {
  return REQUIRED_DOCS.find((k) => DOC_TYPE_ALIASES[k].includes(docType)) || null;
}

const GENERATED_LABELS = {
  'certificate-of-origin': 'Certificate of Origin', 'statement-of-origin': 'Statement of Origin',
  'bank-covering-letter': 'Bank Covering Letter', 'buyer-covering-letter': 'Buyer Covering Letter',
};

function docLabel(docTypeOrKey) {
  const key = DOC_TYPE_ALIASES[docTypeOrKey] ? docTypeOrKey : keyForDocType(docTypeOrKey);
  return key ? DOC_LABELS[key] : (GENERATED_LABELS[docTypeOrKey] || docTypeOrKey);
}

/** True for a stored doc_type that is one of the gate's documents. */
function isGateFileType(docType) {
  return keyForDocType(docType) !== null;
}

/** True for a stored or generated doc_type that is only issued after sailing. */
function isPostShipmentDocType(docType) {
  return POST_SHIPMENT_DOC_TYPES.has(docType) || POST_SHIPMENT_GENERATED.has(docType);
}

/**
 * Why a post-shipment document may not be generated / approved yet for this
 * order, or null when it may. `action` reads into the message ("generated").
 */
function postShipmentProblem(order, docType, action = 'issued') {
  if (!order || !isPostShipmentDocType(docType)) return null;
  if (SHIPPED_STATUSES.has(order.status)) return null;
  return `The ${docLabel(docType)} is a post-shipment document and can only be ${action} once the order is Shipped (it is ${order.status}).`;
}

/**
 * The checklist keys this order requires. From its document_checklists rows
 * (is_required); an order with no checklist rows (created before checklists
 * existed) is held to the standard seven rather than to nothing.
 */
async function requiredKeys(conn, orderId) {
  const rows = await conn('document_checklists')
    .where({ linked_type: 'export_order', linked_id: orderId })
    .select('doc_type', 'is_required');
  if (!rows.length) return [...REQUIRED_DOCS];
  const keys = new Set();
  for (const r of rows) {
    const key = keyForDocType(r.doc_type);
    if (key && r.is_required) keys.add(key);
  }
  return REQUIRED_DOCS.filter((k) => keys.has(k));
}

/**
 * The gate, per checklist document, for one order:
 *   { [key]: { key, label, required, postShipment, fulfilled, source,
 *              documentId, generatedId, state } }
 * `state` says what is missing in words the Documents tab can show:
 *   'fulfilled' | 'awaiting_check' (a live file nobody else has approved) |
 *   'pending_review' (a file waiting for approval) | 'generated_unapproved' |
 *   'missing'.
 */
async function evaluateDocumentGate(conn, orderId) {
  const required = new Set(await requiredKeys(conn, orderId));
  const allFileTypes = REQUIRED_DOCS.flatMap((k) => DOC_TYPE_ALIASES[k]);
  const allGenTypes = Object.values(GENERATED_TYPES).flat();

  const [stored, generated] = await Promise.all([
    conn('document_store')
      .where({ linked_type: 'export_order', linked_id: orderId, is_latest: true })
      .whereIn('doc_type', allFileTypes)
      .select('id', 'doc_type', 'status', 'pending_action', 'file_path', 'checked_by', 'uploaded_by', 'created_at')
      .orderBy('id', 'desc'),
    conn('generated_documents')
      .where({ order_id: orderId, is_latest: true })
      .whereIn('doc_type', allGenTypes)
      .select('id', 'doc_type', 'status', 'approved_by', 'rendered_html', 'edited_html'),
  ]);

  const files = stored.filter((f) => f.status !== 'Deleted');

  const gate = {};
  for (const key of REQUIRED_DOCS) {
    const own = files.filter((f) => DOC_TYPE_ALIASES[key].includes(f.doc_type));
    const live = own.filter((f) => FILE_LIVE.includes(f.status) && !f.pending_action && f.file_path);
    const checked = live.find((f) => f.checked_by != null);
    const gens = generated.filter((g) => (GENERATED_TYPES[key] || []).includes(g.doc_type));
    const approvedGen = gens.find((g) => GENERATED_APPROVED.includes(g.status) && g.approved_by != null
      && (g.rendered_html || g.edited_html));

    let state = 'missing';
    if (checked || approvedGen) state = 'fulfilled';
    else if (live.length) state = 'awaiting_check';
    else if (own.some((f) => ['Pending Review', 'Under Review', 'Draft'].includes(f.status))) state = 'pending_review';
    else if (gens.length) state = 'generated_unapproved';

    gate[key] = {
      key,
      label: DOC_LABELS[key],
      required: required.has(key),
      postShipment: POST_SHIPMENT_DOCS.includes(key),
      fulfilled: state === 'fulfilled',
      source: checked ? 'file' : (approvedGen ? 'generated' : null),
      documentId: checked ? checked.id : (live[0] ? live[0].id : null),
      generatedId: approvedGen ? approvedGen.id : null,
      state,
    };
  }
  return gate;
}

/**
 * Required documents NOT in place, as checklist keys. phase 'pre' leaves out
 * the post-shipment ones (they gate Close, not Ready to Ship / Shipped).
 */
async function missingDocs(conn, orderId, phase = 'all') {
  const gate = await evaluateDocumentGate(conn, orderId);
  return Object.values(gate)
    .filter((g) => g.required && !g.fulfilled && (phase === 'all' || !g.postShipment))
    .map((g) => g.key);
}

/**
 * Rewrite the order's document_checklists rows from the evidence, so readers of
 * is_fulfilled (automation, intelligence, reporting) see the gate's answer.
 */
async function syncChecklist(conn, orderId) {
  if (!orderId) return;
  const gate = await evaluateDocumentGate(conn, orderId);
  const rows = await conn('document_checklists')
    .where({ linked_type: 'export_order', linked_id: orderId })
    .select('id', 'doc_type', 'is_fulfilled', 'document_id');
  for (const r of rows) {
    const key = keyForDocType(r.doc_type);
    if (!key) continue;
    const g = gate[key];
    // The checked file, else the live file awaiting its check, else none.
    const documentId = g.documentId || null;
    if (r.is_fulfilled === g.fulfilled && Number(r.document_id || 0) === Number(documentId || 0)) continue;
    await conn('document_checklists').where({ id: r.id }).update({
      is_fulfilled: g.fulfilled, document_id: documentId, updated_at: conn.fn.now(),
    });
  }
}

module.exports = {
  DOC_TYPE_ALIASES,
  REQUIRED_DOCS,
  POST_SHIPMENT_DOCS,
  PRE_SHIPMENT_DOCS,
  POST_SHIPMENT_DOC_TYPES,
  GENERATED_TYPES,
  POST_SHIPMENT_GENERATED,
  SHIPPED_STATUSES,
  DOC_LABELS,
  keyForDocType,
  docLabel,
  isGateFileType,
  isPostShipmentDocType,
  postShipmentProblem,
  requiredKeys,
  evaluateDocumentGate,
  missingDocs,
  syncChecklist,
};
