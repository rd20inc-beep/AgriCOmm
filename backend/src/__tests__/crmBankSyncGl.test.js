/**
 * A bank account synced in from the CRM gets its own GL sub-account, the way
 * Admin ▸ Bank Accounts creates one (createBankAccount → ensureAccountGl).
 * It was inserted bare, so its money posted to the 1000 control account and no
 * per-account ledger existed (glAccountFor falls back to 1000 with a warning).
 */
jest.mock('../config/database', () => require('./helpers/fakeKnex').fakeKnex({}));

const db = require('../config/database');
const integrationService = require('../services/integrationService');

function seed(tables) {
  for (const k of Object.keys(db.tables)) delete db.tables[k];
  for (const [k, rows] of Object.entries(tables)) db.tables[k] = rows.map((r) => ({ ...r }));
}

describe('CRM bank-account sync', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

  test('a new account is created with its own GL account under 1000; an existing one is only updated', async () => {
    seed({
      bank_accounts: [{ id: 1, name: 'HBL', account_number: 'OLD-1', bank_name: 'HBL', currency: 'PKR', entity: 'general', gl_account_id: 20 }],
      chart_of_accounts: [{ id: 10, code: '1000', name: 'Cash & Bank' }, { id: 20, code: '1001', name: 'HBL', parent_id: 10 }],
      integration_sync_logs: [],
    });
    jest.spyOn(integrationService, 'getIntegration').mockResolvedValue({ id: 5, base_url: 'https://crm.example/api/' });
    jest.spyOn(integrationService, 'logSync').mockResolvedValue(null);
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: [
        { account_number: 'OLD-1', bank_name: 'HBL Main', branch: 'Gulberg' },
        { account_number: 'NEW-9', bank_name: 'Meezan', account_title: 'AgriCommodities Meezan', currency: 'USD' },
      ] }),
    }));

    const out = await integrationService.syncCRMBankAccounts(5);
    expect(out).toMatchObject({ synced: 2, failed: 0 });

    const created = db.tables.bank_accounts.find((a) => a.account_number === 'NEW-9');
    expect(created.name).toBe('AgriCommodities Meezan');
    const gl = db.tables.chart_of_accounts.find((a) => a.id === created.gl_account_id);
    expect(gl).toMatchObject({ code: expect.stringMatching(/^10\d\d$/), parent_id: 10, type: 'Asset', currency: 'USD' });
    expect(gl.code).not.toBe('1001');

    // The existing account keeps its GL; no second one is made for it.
    expect(db.tables.bank_accounts.find((a) => a.id === 1).gl_account_id).toBe(20);
    expect(db.tables.chart_of_accounts).toHaveLength(3);
  });
});
