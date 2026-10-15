/**
 * P1-08 (EXP-12 / EXP-13) — export documents are rendered on the server from the
 * STORED version, sent only once Approved (Proforma Invoice excepted, D-30), and
 * previewing writes nothing.
 *
 * Runs the real generatedDocument controller + service + bundle controller on
 * the in-memory knex (helpers/fakeKnex); Chromium, email and WhatsApp are mocked
 * so the test sees exactly what would have been rendered and sent.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));
jest.mock('../utils/docNumber', () => ({ nextDocNo: jest.fn(async () => 'GD-00001') }));
jest.mock('../middleware/rbac', () => {
  const perms = { set: new Set() };
  const authorize = () => (req, res, next) => next();
  authorize.authorizeAny = () => (req, res, next) => next();
  authorize.userHasPermission = jest.fn(async (_req, m, a) => perms.set.has(`${m}.${a}`));
  authorize.perms = perms;
  return authorize;
});
jest.mock('../modules/documents/exportDocument.controller', () => ({
  assembleDocument: jest.fn(async () => ({ type: 'Commercial Invoice', company: { bank: {} } })),
  maskDocumentForViewer: jest.fn((d) => d),
  bankFromAccount: jest.fn(() => ({})),
}));
jest.mock('../modules/documents/pdf.service', () => ({
  htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')),
  isAvailable: jest.fn(() => true),
}));
jest.mock('../modules/communications/email.service', () => ({ sendEmail: jest.fn(async () => ({ status: 'Sent' })) }));
jest.mock('../modules/communications/whatsappQr.service', () => ({
  getStatus: jest.fn(() => ({ status: 'connected' })),
  sendDocument: jest.fn(async () => ({ ok: true, messageId: 'm1' })),
}));
jest.mock('../modules/communications/whatsapp.service', () => ({ logMessage: jest.fn(async () => null) }));
jest.mock('../modules/admin/audit.service', () => ({ log: jest.fn(async () => null) }));

const db = require('../config/database');
const rbac = require('../middleware/rbac');
const pdfService = require('../modules/documents/pdf.service');
const emailService = require('../modules/communications/email.service');
const whatsappQr = require('../modules/communications/whatsappQr.service');
const controller = require('../modules/documents/generatedDocument.controller');
const service = require('../modules/documents/generatedDocument.service');
const schemas = require('../middleware/schemas');

const STORED = '<div class="agri-doc"><div><p>STORED-APPROVED-BODY</p><p>ACC 01234567890</p></div></div>';
const POSTED = '<html><body><img src="http://127.0.0.1:3001/api/users">POSTED-BY-BROWSER</body></html>';

function seed(rows) {
  db.tables.export_orders = [{ id: 7, order_no: 'EX-007', customer_id: 3 }];
  db.tables.customers = [{ id: 3, name: 'Buyer', email: 'b@example.test', phone: '0300' }];
  db.tables.document_templates = [];
  db.tables.generated_documents = rows.map((r, i) => ({
    id: 100 + i, order_id: 7, version: 1, is_latest: true, locked: false, audience: 'internal',
    doc_no: `GD-0000${i + 1}`, snapshot_json: { type: 'Doc', company: { bank: { account: '01234567890' } } },
    ...r,
  }));
}

function mockRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  res.end = jest.fn((b) => { res.sent = b; return res; });
  return res;
}
const req = (params, body = {}) => ({ params, body, user: { id: 5, role_id: 2 }, ip: '127.0.0.1' });

beforeEach(() => {
  jest.clearAllMocks();
  rbac.perms.set = new Set(['finance.view_bank_details']);
});

describe('assertSendable — D-30', () => {
  const row = (o) => ({ doc_type: 'commercial-invoice', status: 'Draft', is_latest: true, ...o });
  it('rejects an unapproved non-proforma document', () => {
    for (const status of ['Draft', 'Under Review']) {
      expect(() => service.assertSendable(row({ status }))).toThrow(/must be approved before it can be sent/);
    }
  });
  it('allows an approved / issued document', () => {
    for (const status of ['Approved', 'Sent to Bank', 'Sent to Chamber', 'Issued to Customer']) {
      expect(() => service.assertSendable(row({ status }))).not.toThrow();
    }
  });
  it('allows the Proforma Invoice before approval — it is what obtains the advance', () => {
    expect(() => service.assertSendable(row({ doc_type: 'proforma-invoice', status: 'Draft' }))).not.toThrow();
    expect(() => service.assertSendable(row({ doc_type: 'proforma-invoice', status: 'Under Review' }))).not.toThrow();
  });
  it('never sends a cancelled / superseded / unsaved version', () => {
    expect(() => service.assertSendable(row({ doc_type: 'proforma-invoice', status: 'Cancelled' }))).toThrow();
    expect(() => service.assertSendable(row({ status: 'Revised', is_latest: false }))).toThrow();
    expect(() => service.assertSendable(null)).toThrow(/not been saved/);
  });
});

describe('send-email / send-whatsapp render the stored version and require approval', () => {
  it('an unapproved Commercial Invoice is refused with a clear message; nothing rendered or sent', async () => {
    seed([{ doc_type: 'commercial-invoice', status: 'Under Review', rendered_html: STORED }]);
    const res = mockRes();
    await controller.sendEmail(req({ id: '7', docType: 'commercial-invoice' }, { html: POSTED }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('DOC_NOT_APPROVED');
    expect(res.body.message).toMatch(/approved before it can be sent/);
    expect(pdfService.htmlToPdf).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();

    const res2 = mockRes();
    await controller.sendWhatsApp(req({ id: '7', docType: 'commercial-invoice' }, { html: POSTED }), res2);
    expect(res2.statusCode).toBe(409);
    expect(whatsappQr.sendDocument).not.toHaveBeenCalled();
  });

  it('a draft Proforma Invoice is emailed — rendered from the STORED body, never the posted HTML', async () => {
    seed([{ doc_type: 'proforma-invoice', status: 'Draft', rendered_html: STORED }]);
    const res = mockRes();
    await controller.sendEmail(req({ id: '7', docType: 'proforma-invoice' }, { html: POSTED, to: 'b@example.test' }), res);
    expect(res.statusCode).toBe(200);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    const page = pdfService.htmlToPdf.mock.calls[0][0];
    expect(page).toContain('STORED-APPROVED-BODY');
    expect(page).not.toContain('POSTED-BY-BROWSER');
    expect(page).not.toContain('127.0.0.1');
    expect(page).not.toMatch(/<script/i);
  });

  it('an approved Commercial Invoice is sent over WhatsApp from its stored body', async () => {
    seed([{ doc_type: 'commercial-invoice', status: 'Approved', locked: true, rendered_html: STORED }]);
    const res = mockRes();
    await controller.sendWhatsApp(req({ id: '7', docType: 'commercial-invoice' }, { html: POSTED, to: '923000000000' }), res);
    expect(res.statusCode).toBe(200);
    expect(whatsappQr.sendDocument).toHaveBeenCalledTimes(1);
    expect(pdfService.htmlToPdf.mock.calls[0][0]).toContain('STORED-APPROVED-BODY');
  });
});

describe('PDF download renders the stored version', () => {
  it('ignores posted HTML and returns the stored version', async () => {
    seed([{ doc_type: 'packing-list', status: 'Draft', rendered_html: STORED }]);
    const res = mockRes();
    await controller.downloadPdf(req({ id: '7', docType: 'packing-list' }, { html: POSTED, filename: 'pl.pdf' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    const page = pdfService.htmlToPdf.mock.calls[0][0];
    expect(page).toContain('STORED-APPROVED-BODY');
    expect(page).not.toContain('POSTED-BY-BROWSER');
  });

  it('a document never saved cannot be downloaded (409), and nothing is rendered', async () => {
    seed([]);
    const res = mockRes();
    await controller.downloadPdf(req({ id: '7', docType: 'packing-list' }, { html: POSTED }), res);
    expect(res.statusCode).toBe(409);
    expect(pdfService.htmlToPdf).not.toHaveBeenCalled();
  });

  it('a genId from another order / document type is refused', async () => {
    seed([{ doc_type: 'packing-list', status: 'Draft', rendered_html: STORED }]);
    db.tables.generated_documents[0].order_id = 99;
    const res = mockRes();
    await controller.downloadPdf(req({ id: '7', docType: 'packing-list' }, { genId: 100 }), res);
    expect(res.statusCode).toBe(404);
  });

  it('masks the bank account for a requester without view_bank_details', async () => {
    rbac.perms.set = new Set();
    seed([{ doc_type: 'packing-list', status: 'Draft', rendered_html: STORED }]);
    const res = mockRes();
    await controller.downloadPdf(req({ id: '7', docType: 'packing-list' }, {}), res);
    const page = pdfService.htmlToPdf.mock.calls[0][0];
    expect(page).not.toContain('01234567890');
    expect(page).toContain('•••• 7890');
  });

  it('falls back to edited_html for versions saved before renderings were stored — sanitized', async () => {
    seed([{ doc_type: 'packing-list', status: 'Approved', locked: true, edited_html: '<p>EDITED</p><script>x()</script><img src="file:///etc/passwd">' }]);
    const res = mockRes();
    await controller.downloadPdf(req({ id: '7', docType: 'packing-list' }, {}), res);
    const page = pdfService.htmlToPdf.mock.calls[0][0];
    expect(page).toContain('EDITED');
    expect(page).not.toMatch(/<script|file:/);
  });
});

describe('stored rendering', () => {
  it('is sanitized on save', async () => {
    seed([{ doc_type: 'packing-list', status: 'Draft' }]);
    const res = mockRes();
    await controller.saveRendering(req({ genId: '100' }, { html: '<p onclick="x()">ok</p><iframe src="http://127.0.0.1:3001/"></iframe>' }), res);
    expect(res.statusCode).toBe(200);
    expect(db.tables.generated_documents[0].rendered_html).toBe('<p>ok</p>');
    expect(res.body.data.version.has_rendering).toBe(true);
    expect(res.body.data.version.rendered_html).toBeUndefined();
  });

  it('is frozen once the version is approved', async () => {
    seed([{ doc_type: 'packing-list', status: 'Approved', locked: true, rendered_html: STORED }]);
    rbac.perms.set = new Set(['documents.approve']);
    const res = mockRes();
    await controller.saveRendering(req({ genId: '100' }, { html: '<p>CHANGED</p>' }), res);
    expect(res.statusCode).toBe(409);
    expect(db.tables.generated_documents[0].rendered_html).toBe(STORED);
  });

  it('an approved version with no stored copy may be captured once — by an approver only', async () => {
    seed([{ doc_type: 'packing-list', status: 'Approved', locked: true }]);
    rbac.perms.set = new Set();
    const res = mockRes();
    await controller.saveRendering(req({ genId: '100' }, { html: '<p>X</p>' }), res);
    expect(res.statusCode).toBe(403);

    rbac.perms.set = new Set(['documents.approve']);
    const res2 = mockRes();
    await controller.saveRendering(req({ genId: '100' }, { html: '<p>X</p>' }), res2);
    expect(res2.statusCode).toBe(200);
    expect(db.tables.generated_documents[0].rendered_html).toBe('<p>X</p>');
  });

  it('a settings change clears the (now stale) rendering', async () => {
    seed([{ doc_type: 'bank-fi-request', status: 'Draft', rendered_html: STORED }]);
    await service.updateSettings(100, { audience: 'customer' }, 5);
    expect(db.tables.generated_documents[0].rendered_html).toBeNull();
  });

  it('approve stores the approver\'s view atomically with the lock', async () => {
    seed([{ doc_type: 'packing-list', status: 'Under Review', rendered_html: '<p>OLD</p>', snapshot_json: {
      totals: { netWeightKg: 1, grossWeightKg: 2, totalPackages: 1 }, items: [],
      company: { bank: { title: 't', account: 'a', iban: 'i', swift: 's' } },
    } }]);
    const res = mockRes();
    await controller.approve(req({ genId: '100' }, { renderedHtml: '<p>APPROVED VIEW</p><script>x</script>' }), res);
    expect(res.statusCode).toBe(200);
    const row = db.tables.generated_documents[0];
    expect(row.status).toBe('Approved');
    expect(row.locked).toBe(true);
    expect(row.rendered_html).toBe('<p>APPROVED VIEW</p>');
  });

  // P2-32 / EXP-39 — maker-checker: the generator of a version may not approve
  // it, unless they are the Owner.
  const approvable = (generatedBy) => ({ doc_type: 'packing-list', status: 'Under Review', generated_by: generatedBy, snapshot_json: {
    totals: { netWeightKg: 1, grossWeightKg: 2, totalPackages: 1 }, items: [],
    company: { bank: { title: 't', account: 'a', iban: 'i', swift: 's' } },
  } });

  it('the generator of a version cannot approve it', async () => {
    seed([approvable(5)]);
    db.tables.users = [{ id: 5, role_id: 2 }];
    db.tables.roles = [{ id: 2, name: 'Export Manager' }];
    const res = mockRes();
    await controller.approve(req({ genId: '100' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('MAKER_CHECKER');
    expect(db.tables.generated_documents[0].status).toBe('Under Review');
  });

  it('the Owner may approve a version they generated', async () => {
    seed([approvable(5)]);
    db.tables.users = [{ id: 5, role_id: 9 }];
    db.tables.roles = [{ id: 9, name: 'Owner' }];
    const res = mockRes();
    await controller.approve(req({ genId: '100' }), res);
    expect(res.statusCode).toBe(200);
    expect(db.tables.generated_documents[0].status).toBe('Approved');
  });

  it('someone other than the generator may approve', async () => {
    seed([approvable(77)]);
    const res = mockRes();
    await controller.approve(req({ genId: '100' }), res);
    expect(res.statusCode).toBe(200);
  });
});

describe('bundle renders stored versions only', () => {
  const { bundle } = require('../modules/documents/bundle.controller');

  it('refuses generated documents without the documents download permission', async () => {
    rbac.perms.set = new Set();
    seed([{ doc_type: 'packing-list', status: 'Draft', rendered_html: STORED }]);
    const res = mockRes();
    await bundle(req({ id: '7' }, { generated: [{ docType: 'packing-list', html: POSTED }], format: 'pdf' }), res);
    expect(res.statusCode).toBe(403);
    expect(pdfService.htmlToPdf).not.toHaveBeenCalled();
  });

  it('renders the stored body, not posted HTML', async () => {
    rbac.perms.set = new Set(['documents.download', 'finance.view_bank_details']);
    seed([{ doc_type: 'packing-list', status: 'Draft', rendered_html: STORED }]);
    const res = mockRes();
    res.send = jest.fn();
    await bundle(req({ id: '7' }, { generated: [{ docType: 'packing-list', html: POSTED }], format: 'pdf' }), res).catch(() => {});
    expect(pdfService.htmlToPdf).toHaveBeenCalledTimes(1);
    const page = pdfService.htmlToPdf.mock.calls[0][0];
    expect(page).toContain('STORED-APPROVED-BODY');
    expect(page).not.toContain('POSTED-BY-BROWSER');
  });
});

describe('request bodies carry no HTML for PDF / send / bundle', () => {
  const opts = { abortEarly: false, stripUnknown: true };
  it.each(['downloadDocumentPdf', 'sendDocumentEmail', 'sendDocumentWhatsApp'])('%s strips html', (name) => {
    const { value } = schemas[name].validate({ html: POSTED, filename: 'x.pdf' }, opts);
    expect(value.html).toBeUndefined();
  });
  it('bundleDocuments strips html from generated entries', () => {
    const { value, error } = schemas.bundleDocuments.validate({ generated: [{ docType: 'invoice', html: POSTED }] }, opts);
    expect(error).toBeUndefined();
    expect(value.generated[0].html).toBeUndefined();
  });
  it('the new bodies keep their fields', () => {
    expect(schemas.saveDocumentRendering.validate({ html: '<p>x</p>' }, opts).value.html).toBe('<p>x</p>');
    expect(schemas.documentApprove.validate({ renderedHtml: '<p>x</p>' }, opts).value.renderedHtml).toBe('<p>x</p>');
    expect(schemas.downloadDocumentPdf.validate({ genId: 4 }, opts).value.genId).toBe(4);
  });
});

describe('route permissions', () => {
  const ROUTES = fs.readFileSync(path.join(__dirname, '../modules/exportOrders/exportOrders.routes.js'), 'utf8');
  const line = (frag) => {
    const l = ROUTES.split('\n').find((x) => x.includes(frag));
    if (!l) throw new Error(`route ${frag} not found`);
    return l;
  };

  it('/pdf needs the documents download permission on top of order view', () => {
    const l = line("'/:id/documents/:docType/pdf'");
    expect(l).toContain("authorize('export_orders', 'view')");
    expect(l).toContain("authorize('documents', 'download')");
  });

  it('creating a draft (a GD number) needs edit — viewers preview via GET only', () => {
    expect(line("'/:id/documents/:docType/draft'")).toContain('canEditDocuments');
    expect(ROUTES).toContain("authorize.authorizeAny(['export_orders', 'edit'], ['documents', 'edit'])");
    expect(line("'/:id/documents/:docType/current'")).toMatch(/^router\.get\(/);
  });

  it('storing a rendering needs edit; approving validates its body', () => {
    expect(line("'/documents/:genId/rendering'")).toContain('canEditDocuments');
    expect(line("'/documents/:genId/approve'")).toContain('schemas.documentApprove');
  });

  it('sending still needs send_email', () => {
    expect(line("'/:id/documents/:docType/send-email'")).toContain("authorize('export_orders', 'send_email')");
    expect(line("'/:id/documents/:docType/send-whatsapp'")).toContain("authorize('export_orders', 'send_email')");
  });
});
