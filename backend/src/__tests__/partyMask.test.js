const { PARTY_VISIBLE_ROLES, isPartyMasked } = require('../shared/partyMask');

// Masking hid more than a name: it also nulled supplier_id, so on
// Mill Finance ▸ Parties ▸ Suppliers every payable collapsed into one generic
// "Supplier" row with no id — no Pay button, and a drawer reporting
// "No open invoices" against a balance the same page showed as outstanding.
describe('party visibility', () => {
  const masked = (roleName) => isPartyMasked({ user: { _roleName: roleName } });

  test('the people who settle payables can see who they are paying', async () => {
    await expect(masked('Finance Manager')).resolves.toBe(false);
    await expect(masked('Mill Manager')).resolves.toBe(false);
  });

  test('owners and admins keep full visibility', async () => {
    await expect(masked('Super Admin')).resolves.toBe(false);
    await expect(masked('Owner')).resolves.toBe(false);
    await expect(masked('Admin')).resolves.toBe(false);
  });

  test('everyone else stays masked', async () => {
    for (const r of ['Export Manager', 'QC Analyst', 'Inventory Officer',
      'Documentation Officer', 'Read-Only Auditor', 'Mill Operator']) {
      await expect(masked(r)).resolves.toBe(true);
    }
  });

  test('an unknown or missing role is masked, not exposed', async () => {
    await expect(masked('Some New Role')).resolves.toBe(true);
    await expect(isPartyMasked({ user: {} })).resolves.toBe(true);
    await expect(isPartyMasked({})).resolves.toBe(true);
  });

  test('the list is exactly the five agreed roles', () => {
    expect([...PARTY_VISIBLE_ROLES].sort()).toEqual(
      ['Admin', 'Finance Manager', 'Mill Manager', 'Owner', 'Super Admin'],
    );
  });
});

// finance.controller used to carry its own copy of the rule AND its own role
// list. Changing the shared one then fixed nothing, because the copy that masks
// payables kept the old list.
describe('the rule has one home', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/finance/finance.controller.js'), 'utf8',
  );

  test('finance.controller imports it rather than redefining it', () => {
    expect(src).toContain("require('../../shared/partyMask')");
  });

  test('finance.controller does not declare its own role list', () => {
    expect(src).not.toMatch(/const PARTY_VISIBLE_ROLES\s*=/);
  });

  test('finance.controller does not declare its own isPartyMasked', () => {
    expect(src).not.toMatch(/(async )?function isPartyMasked/);
  });
});
