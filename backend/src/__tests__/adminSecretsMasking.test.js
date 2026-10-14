/**
 * P1-02 / P1-17 — admin read endpoints never return secrets; settings PUT is a
 * strict allowlist that records updated_by.
 *   - GET /api/admin/settings: secret keys only as secrets.<key>.is_set
 *   - PUT /api/admin/settings: unknown / camelCase keys → 400; updated_by stamped
 *   - admin CRUD bank_accounts / customers: masked without finance.view_bank_details
 *   - integrations: auth_credentials never returned
 */
jest.mock('../config/database', () => require('./helpers/recordingKnex')());

let mockCanSeeBank = false;
jest.mock('../middleware/rbac', () => {
  const fn = () => (req, res, next) => next();
  fn.userHasPermission = async (_req, module, action) => module === 'finance' && action === 'view_bank_details' && mockCanSeeBank;
  return fn;
});

const db = require('../config/database');
db.transaction = async (fn) => fn(db);
const controller = require('../modules/admin/admin.controller');
const { toPublicIntegration } = require('../services/integrationService');

const FAKE_KEY = 'FAKE-test-secret-1';
const resMock = () => {
  const res = { statusCode: 200 };
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  return res;
};

const SETTINGS_ROWS = [
  { key: 'payment_reminder_days', value: '7' },
  { key: 'companyProfile', value: '{"name":"Agri"}' },
  { key: 'whatsapp_api_key', value: FAKE_KEY },
  { key: 'whatsapp_api_url', value: 'https://wa.example' },
  { key: 'smtp_password', value: '' },
];

describe('settings', () => {
  beforeEach(() => db.__set({
    system_settings: (q) => (q.terminal === 'first' ? undefined : SETTINGS_ROWS),
  }));

  test('GET masks secret settings to is_set flags (snapshot of shape)', async () => {
    const res = resMock();
    await controller.getSettings({ user: { id: 1 } }, res);
    expect(res.body).toEqual({
      success: true,
      data: {
        settings: { payment_reminder_days: 7, companyProfile: { name: 'Agri' }, whatsapp_api_url: 'https://wa.example' },
        secrets: { whatsapp_api_key: { is_set: true }, smtp_password: { is_set: false } },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });

  test('PUT rejects an unknown or camelCase key (not silently stripped)', async () => {
    for (const body of [{ paymentReminderDays: 9 }, { lowMarginThreshold: 3 }, { anything: 'x' }, {}]) {
      const res = resMock();
      await controller.updateSettings({ user: { id: 5 }, body }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(db.__calls.some((c) => c.updates.length || c.inserts.length)).toBe(false);
  });

  test('PUT rejects out-of-range values', async () => {
    const res = resMock();
    await controller.updateSettings({ user: { id: 5 }, body: { min_margin_pct: 500 } }, res);
    expect(res.statusCode).toBe(400);
  });

  test('PUT writes the snake_case keys readers use, stamps updated_by, response stays masked', async () => {
    const res = resMock();
    await controller.updateSettings({
      user: { id: 5 },
      body: { payment_reminder_days: 9, min_margin_pct: 4.5, pkr_rate: 281.5, whatsapp_api_key: FAKE_KEY, collection_target_pct_USD: 90 },
    }, res);
    expect(res.statusCode).toBe(200);
    const writes = db.__calls.filter((c) => c.table === 'system_settings' && c.inserts.length);
    const byKey = Object.fromEntries(writes.map((c) => [c.inserts[0].key, c.inserts[0]]));
    expect(Object.keys(byKey).sort()).toEqual(['collection_target_pct_USD', 'min_margin_pct', 'payment_reminder_days', 'pkr_rate', 'whatsapp_api_key']);
    expect(byKey.payment_reminder_days).toMatchObject({ value: '9', updated_by: 5 });
    expect(byKey.pkr_rate.value).toBe('281.5');
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });
});

describe('admin CRUD bank masking', () => {
  const ACCT = {
    id: 1, name: 'HBL', account_number: '0012345678901', iban: 'PK36HABB0000001234567890',
    swift_bic: 'HABBPKKA', correspondent_account: '400099991234', correspondent_swift: 'CHASUS33', current_balance: '10',
  };
  const CUST = { id: 4, name: 'Buyer', bank_account: '99887766', bank_iban: 'AE07033123456789', bank_swift: 'EBILAEAD' };
  beforeEach(() => db.__set({
    bank_accounts: (q) => (q.terminal === 'first' ? (q.wheres.length ? ACCT : { total: 1 }) : [ACCT]),
    customers: (q) => (q.terminal === 'first' ? (q.wheres.length ? CUST : { total: 1 }) : [CUST]),
  }));

  test('admin.view without finance.view_bank_details sees last-4 only', async () => {
    mockCanSeeBank = false;
    const res = resMock();
    await controller.listBankAccounts({ query: {}, user: { id: 2 } }, res);
    const row = res.body.data.bank_accounts[0];
    expect(row.account_number).toBe('•••• 8901');
    expect(row.iban).toBe('•••• 7890');
    expect(row.swift_bic).toBe('•••• PKKA');
    expect(row.correspondent_account).toBe('•••• 1234');
    expect(row.bank_details_masked).toBe(true);
    expect(row.name).toBe('HBL');

    const one = resMock();
    await controller.getBankAccount({ params: { id: 1 }, user: { id: 2 } }, one);
    expect(one.body.data.bank_account.iban).toBe('•••• 7890');

    const cust = resMock();
    await controller.listCustomers({ query: {}, user: { id: 2 } }, cust);
    expect(cust.body.data.customers[0]).toMatchObject({ bank_account: '•••• 7766', bank_iban: '•••• 6789', name: 'Buyer' });
  });

  test('holder of finance.view_bank_details sees full values', async () => {
    mockCanSeeBank = true;
    const res = resMock();
    await controller.listBankAccounts({ query: {}, user: { id: 1 } }, res);
    expect(res.body.data.bank_accounts[0].account_number).toBe('0012345678901');
    expect(res.body.data.bank_accounts[0].bank_details_masked).toBeUndefined();
  });

  test('a masked placeholder sent back by an edit form is not written', async () => {
    mockCanSeeBank = false;
    const res = resMock();
    await controller.updateCustomer({ params: { id: 4 }, user: { id: 2 }, body: { name: 'Buyer 2', bank_iban: '•••• 6789' } }, res);
    const upd = db.__calls.find((c) => c.table === 'customers' && c.updates.length).updates[0];
    expect(upd.name).toBe('Buyer 2');
    expect(upd).not.toHaveProperty('bank_iban');
  });
});

describe('integrations', () => {
  test('auth_credentials never leave the API; config secrets redacted', () => {
    const out = toPublicIntegration({
      id: 1, name: 'agri_crm', auth_type: 'bearer', auth_credentials: { token: FAKE_KEY }, config: { api_key: FAKE_KEY, region: 'pk' },
    });
    expect(out).not.toHaveProperty('auth_credentials');
    expect(out.auth_credentials_set).toBe(true);
    expect(out.config).toEqual({ api_key: '[REDACTED]', region: 'pk' });
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);
    expect(toPublicIntegration({ id: 2, auth_credentials: null }).auth_credentials_set).toBe(false);
  });
});
