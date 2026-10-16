/**
 * P5-12 + D-19 against a real, migrated Postgres.
 *
 *  - Automatic customer emails are OPT-IN per event (system_settings
 *    `customer_email_events`, default OFF).
 *  - They are sent only after the transaction COMMITS; a rollback sends none.
 *  - A payment confirmation carries the order's / receipt's currency, not USD.
 *  - D-19: an export document that is not approved is refused on the backend
 *    send endpoints — except the Proforma Invoice.
 *  - Pairing your own WhatsApp needs communications.whatsapp_pair (mig 440),
 *    not admin.manage_settings; a read-only role cannot pair.
 *
 * DB-gated: skipped unless DB_HOST is set. Rows carry a per-run suffix. No
 * real email, WhatsApp or Chromium: the transports are stubbed.
 */
jest.mock('../middleware/rateLimiter', () => require('./helpers/passThroughLimiters'));
jest.mock('../modules/documents/pdf.service', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 stub')) }));
jest.mock('../modules/communications/whatsappQr.service', () => ({
  getStatus: jest.fn(() => ({ status: 'disconnected', qrDataUrl: null, phone: null, error: null })),
  start: jest.fn(async () => ({ status: 'connecting' })),
  logout: jest.fn(async () => ({ status: 'disconnected' })),
  sendDocument: jest.fn(async () => ({ ok: true, messageId: 'x' })),
  sendMessage: jest.fn(async () => ({ ok: true })),
  resumeOnBoot: jest.fn(async () => {}),
}));

const hasDb = !!process.env.DB_HOST;
const d = hasDb ? describe : describe.skip;
jest.setTimeout(60000);

// Let the work queued by afterCommit run: the email helpers read the order
// (real DB round-trips) before they reach the transport, so give them time.
const settle = () => new Promise((r) => setTimeout(r, 400));
const waitFor = async (pred, ms = 3000) => {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};

d('customer communications policy (DB-gated)', () => {
  let db; let app; let request; let automation; let emailService; let policy;
  const run = `${Date.now()}`.slice(-7);
  const tok = {};
  const ids = {};
  let sendEmailSpy;

  const auth = (who) => ({ Authorization: `Bearer ${tok[who]}` });
  const setEvents = async (events) => {
    const value = JSON.stringify(events);
    const has = await db('system_settings').where({ key: policy.SETTING_KEY }).first();
    if (has) await db('system_settings').where({ key: policy.SETTING_KEY }).update({ value });
    else await db('system_settings').insert({ key: policy.SETTING_KEY, value });
  };

  beforeAll(async () => {
    db = require('../config/database');
    request = require('supertest');
    app = require('../app')();
    automation = require('../modules/admin/automation.service');
    emailService = require('../modules/communications/email.service');
    policy = require('../modules/communications/customerEmailPolicy');
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const roleId = async (name) => (await db('roles').where({ name }).first()).id;
    for (const [key, role] of [['sa', 'Super Admin'], ['mm', 'Mill Manager'], ['fm', 'Finance Manager'], ['ro', 'Read-Only Auditor']]) {
      const [u] = await db('users').insert({
        email: `zz-p512-${key}-${run}@test.local`, full_name: `ZZ ${role} ${run}`,
        password_hash: 'x', role_id: await roleId(role), is_active: true, status: 'active',
      }).returning('*');
      ids[key] = u.id;
      tok[key] = jwt.sign({ id: u.id, role_id: u.role_id, email: u.email }, config.jwt.secret);
    }
    ids.product = (await db('products').insert({ name: `ZZ P512 Rice ${run}` }).returning('*'))[0].id;
    const [c] = await db('customers').insert({ name: `ZZ P512 Buyer ${run}`, email: `buyer-${run}@example.test`, phone: `92300${run}` }).returning('*');
    ids.cust = c.id;
    const [o] = await db('export_orders').insert({
      order_no: `ZZP512-${run}`, customer_id: c.id, product_id: ids.product, created_by: ids.sa, currency: 'EUR',
      status: 'Shipped',
    }).returning('*');
    ids.order = o.id;
  });

  beforeEach(() => {
    // Never reach SMTP; record what would have gone out.
    sendEmailSpy = jest.spyOn(emailService, 'sendEmail').mockImplementation(async (args) => ({ id: 0, status: 'Sent', to_email: args.to, args }));
  });
  afterEach(() => { sendEmailSpy.mockRestore(); });

  afterAll(async () => {
    if (!db) return;
    await db('system_settings').where({ key: policy.SETTING_KEY }).del();
    await db.destroy();
  });

  test('default OFF: no customer email on shipment departure', async () => {
    await db('system_settings').where({ key: policy.SETTING_KEY }).del();
    expect(await policy.getSettings(db)).toEqual(Object.fromEntries(Object.keys(policy.CUSTOMER_EMAIL_EVENTS).map((k) => [k, false])));
    await db.transaction((trx) => automation.onShipmentDeparted(trx, { orderId: ids.order, userId: ids.sa }));
    await settle();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test('switched ON: the shipment email waits for COMMIT, then goes once', async () => {
    await setEvents({ shipment_departed: true });
    let calledInside = null;
    await db.transaction(async (trx) => {
      await automation.onShipmentDeparted(trx, { orderId: ids.order, userId: ids.sa });
      await settle();
      calledInside = sendEmailSpy.mock.calls.length;
    });
    await waitFor(() => sendEmailSpy.mock.calls.length > 0);
    expect(calledInside).toBe(0); // nothing before the commit
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0][0]).toMatchObject({ to: `buyer-${run}@example.test`, templateSlug: 'shipment_notification' });
  });

  test('a rolled-back transaction sends NO email', async () => {
    await setEvents({ shipment_departed: true });
    await expect(db.transaction(async (trx) => {
      await automation.onShipmentDeparted(trx, { orderId: ids.order, userId: ids.sa });
      throw new Error('boom — shipment posting failed');
    })).rejects.toThrow('boom');
    await settle();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test('a nested savepoint does not release the email — only the outer commit does', async () => {
    await setEvents({ shipment_departed: true });
    await expect(db.transaction(async (outer) => {
      await outer.transaction((inner) => automation.onShipmentDeparted(inner, { orderId: ids.order, userId: ids.sa }));
      await settle();
      throw new Error('outer rollback');
    })).rejects.toThrow('outer rollback');
    await settle();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test('payment confirmation carries the order currency (EUR), not a hard-coded USD', async () => {
    await setEvents({ advance_confirmed: true, balance_confirmed: true });
    await automation.onAdvanceConfirmed(db, { orderId: ids.order, amount: 1234.5, userId: ids.sa });
    await waitFor(() => sendEmailSpy.mock.calls.length > 0);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy.mock.calls[0][0].variables).toMatchObject({ amount: 1234.5, currency: 'EUR' });

    // The receipt's own currency wins when it is given.
    sendEmailSpy.mockClear();
    await automation.onBalanceConfirmed(db, { orderId: ids.order, amount: 10, currency: 'GBP', userId: ids.sa });
    await waitFor(() => sendEmailSpy.mock.calls.length > 0);
    expect(sendEmailSpy.mock.calls[0][0].variables.currency).toBe('GBP');
  });

  test('payment confirmation stays silent while its event is OFF', async () => {
    await setEvents({ shipment_departed: true }); // advance_confirmed not on
    await automation.onAdvanceConfirmed(db, { orderId: ids.order, amount: 5, userId: ids.sa });
    await settle();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  test('Admin settings accepts the opt-in switches and rejects unknown events', async () => {
    const ok = await request(app).put('/api/admin/settings').set(auth('sa'))
      .send({ customer_email_events: { shipment_departed: true, advance_confirmed: false } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.settings.customer_email_events).toEqual({ shipment_departed: true, advance_confirmed: false });
    const bad = await request(app).put('/api/admin/settings').set(auth('sa'))
      .send({ customer_email_events: { email_everyone: true } });
    expect(bad.status).toBe(400);
  });

  describe('D-19: unapproved export documents are not sent (Proforma excepted)', () => {
    const doc = async (docType, status) => {
      await db('generated_documents').where({ order_id: ids.order, doc_type: docType }).update({ is_latest: false });
      const [row] = await db('generated_documents').insert({
        order_id: ids.order, doc_type: docType, doc_no: `ZZ${docType.slice(0, 4)}${status.slice(0, 2)}${run}${Math.random().toString(36).slice(2, 6)}`, version: 1,
        status, is_latest: true, locked: ['Approved'].includes(status), audience: 'customer',
        rendered_html: '<div>stub document</div>',
      }).returning('*');
      return row;
    };
    const send = (docType, channel) => request(app)
      .post(`/api/export-orders/${ids.order}/documents/${docType}/send-${channel}`).set(auth('sa'))
      .send(channel === 'email' ? { to: `buyer-${run}@example.test` } : { to: '923001234567' });

    test.each(['Draft', 'Under Review'])('a %s Commercial Invoice is refused by email and WhatsApp', async (status) => {
      await doc('commercial-invoice', status);
      const e = await send('commercial-invoice', 'email');
      expect(e.status).toBe(409);
      expect(e.body.code).toBe('DOC_NOT_APPROVED');
      const w = await send('commercial-invoice', 'whatsapp');
      expect(w.status).toBe(409);
      expect(w.body.code).toBe('DOC_NOT_APPROVED');
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    test('an Approved Commercial Invoice is emailed', async () => {
      await doc('commercial-invoice', 'Approved');
      const e = await send('commercial-invoice', 'email');
      expect(e.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    test('a Draft Proforma Invoice may be sent (it obtains the advance)', async () => {
      await doc('proforma-invoice', 'Draft');
      const e = await send('proforma-invoice', 'email');
      expect(e.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    test('the generic WhatsApp route cannot be used to send an export document around the gate', async () => {
      const r = await request(app).post('/api/communication/whatsapp/send-document').set(auth('sa'))
        .send({ to: '923001234567', html: '<p>Commercial Invoice</p>', linked_type: 'export_order', linked_id: ids.order });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('USE_DOCUMENT_CENTER');
    });
  });

  describe('per-user WhatsApp pairing has its own permission', () => {
    test.each([['mm', 'Mill Manager'], ['fm', 'Finance Manager'], ['sa', 'Super Admin']])('%s (%s) may pair their own WhatsApp', async (who) => {
      const r = await request(app).post('/api/communication/whatsapp/qr/start').set(auth(who)).send({});
      expect(r.status).toBe(200);
      const qr = require('../modules/communications/whatsappQr.service');
      expect(qr.start).toHaveBeenLastCalledWith(ids[who]);
    });

    test('Read-Only Auditor may not pair or unpair', async () => {
      const s = await request(app).post('/api/communication/whatsapp/qr/start').set(auth('ro')).send({});
      expect(s.status).toBe(403);
      const l = await request(app).post('/api/communication/whatsapp/qr/logout').set(auth('ro')).send({});
      expect(l.status).toBe(403);
    });

    test('the permission exists and is held by the sending roles only', async () => {
      const rows = await db('role_permissions as rp').join('roles as r', 'r.id', 'rp.role_id')
        .join('permissions as p', 'p.id', 'rp.permission_id')
        .where({ 'p.module': 'communications', 'p.action': 'whatsapp_pair' }).pluck('r.name');
      expect(rows).toEqual(expect.arrayContaining(['Mill Manager', 'Finance Manager', 'Export Manager', 'Owner', 'Super Admin']));
      expect(rows).not.toContain('Read-Only Auditor');
    });
  });
});
