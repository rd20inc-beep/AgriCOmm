const fs = require('fs');
const path = require('path');
const {
  PAYMENT_METHODS, ACCEPTED_METHODS, normalizePaymentMethod,
} = require('../shared/constants/paymentMethods');

const read = (p) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SCHEMAS = read('../middleware/schemas.js');
const SERVICE = strip(read('../modules/expenses/expenses.service.js'));
const CONTROLLER = strip(read('../modules/expenses/expenses.controller.js'));
const MIG = strip(read('../../migrations/20261004_313_canonical_expense_payment_method.js'));

describe('normalizePaymentMethod', () => {
  it('maps the legacy shorthand the expense form and payroll send', () => {
    expect(normalizePaymentMethod('bank')).toBe('bank_transfer');
  });

  it('treats a missing method as a bank transfer, which is what the form defaulted to', () => {
    expect(normalizePaymentMethod(null)).toBe('bank_transfer');
    expect(normalizePaymentMethod(undefined)).toBe('bank_transfer');
    expect(normalizePaymentMethod('')).toBe('bank_transfer');
  });

  it('passes a canonical value through untouched', () => {
    for (const m of PAYMENT_METHODS) expect(normalizePaymentMethod(m)).toBe(m);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizePaymentMethod(' Cash ')).toBe('cash');
    expect(normalizePaymentMethod('BANK')).toBe('bank_transfer');
  });

  it('throws on an unknown value rather than coercing it', () => {
    // Coercing would write a method nobody chose. Letting it through used to
    // reach the CHECK on payments.payment_method and surface as a 500 after the
    // UI had already reported success.
    expect(() => normalizePaymentMethod('venmo')).toThrow(/Unknown payment method "venmo"/);
  });

  it('agrees with the canonical set the recordPayment schema validates', () => {
    const line = SCHEMAS.split('\n').find((l) => l.includes('payment_method: Joi.string().valid('));
    const allowed = [...line.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...PAYMENT_METHODS].sort()).toEqual([...allowed].sort());
  });

  it('accepts the legacy value on the way in, but never produces it', () => {
    expect(ACCEPTED_METHODS).toContain('bank');
    expect(PAYMENT_METHODS).not.toContain('bank');
  });
});

describe('expenses write a canonical method to both columns', () => {
  it('normalises every payment_method it stores', () => {
    // business_expenses at create, plus the method handed to the payment
    // engine at create and at markPaid (the engine writes the payments row and
    // stamps the same method back onto the expense when it settles it; a
    // post-dated cheque goes through the same call).
    const normalised = (SERVICE.match(/(payment_method|method):\s*(pay_now \? )?(normalizePaymentMethod|payMethod)/g) || []).length;
    expect(normalised).toBeGreaterThanOrEqual(3);
  });

  it('no longer hard-codes the shorthand as a fallback', () => {
    expect(SERVICE).not.toMatch(/payment_method\s*\|\|\s*'bank'/);
    expect(SERVICE).not.toMatch(/payment_method:\s*'bank'/);
  });

  it('validates the method on the request instead of accepting any 30 characters', () => {
    // Joi max(30) let a typo reach the database. Both schemas now check it.
    expect(CONTROLLER).not.toMatch(/payment_method: Joi\.string\(\)\.max\(30\)/);
    expect((CONTROLLER.match(/payment_method: Joi\.string\(\)\.valid\(\.\.\.ACCEPTED_METHODS\)/g) || []).length).toBe(2);
  });

  it('defaults a payment to a bank transfer, not to the shorthand', () => {
    expect(CONTROLLER).toContain("default('bank_transfer')");
  });
});

describe('migration 313', () => {
  it('rewrites the stored shorthand on both expense tables', () => {
    expect(MIG).toMatch(/UPDATE business_expenses SET payment_method = 'bank_transfer' WHERE payment_method = 'bank'/);
    expect(MIG).toMatch(/UPDATE mill_expenses SET payment_method = 'bank_transfer' WHERE payment_method = 'bank'/);
  });

  it('guards mill_expenses, which not every environment has', () => {
    expect(MIG).toMatch(/hasTable\('mill_expenses'\)/);
  });

  it('is reversible', () => {
    expect(MIG).toMatch(/exports\.down/);
    expect(MIG).toMatch(/SET payment_method = 'bank' WHERE payment_method = 'bank_transfer'/);
  });

  it('leaves the payments table alone — it was always canonical', () => {
    expect(MIG).not.toMatch(/UPDATE payments/);
  });
});
