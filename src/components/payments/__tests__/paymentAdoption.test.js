import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM: HERE does not exist, and these tests read files relative to themselves.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Structural guards over every screen that records a payment.
 *
 * Eight screens each built their own recordPayment body, and the copies drifted
 * in ways nothing catches: validate() runs with stripUnknown, so a mistyped key
 * is deleted silently, and a `payment_method` outside the canonical set is only
 * refused by a database CHECK — at the end of the request, after the UI has
 * already said it worked.
 */
const SRC = path.resolve(HERE, '../../..');
const SCHEMAS = fs.readFileSync(path.resolve(SRC, '../backend/src/middleware/schemas.js'), 'utf8');

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') jsFiles(p, out); }
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const FILES = jsFiles(SRC).map((f) => [path.relative(SRC, f), stripComments(fs.readFileSync(f, 'utf8'))]);

const CANONICAL = new Set(
  [...FILES.length && SCHEMAS.split('\n').find((l) => l.includes('payment_method: Joi.string().valid('))
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]),
);

// 'bank' is a legacy shorthand the expenses module still stores on
// business_expenses.payment_method; expenses.service.js maps it to
// 'bank_transfer' before it reaches payments.payment_method, which is
// CHECK-constrained. It is listed so it stays deliberate rather than looking
// correct, and so a NEW screen cannot quietly adopt it.
const LEGACY = { bank: 'modules/finance/pages/Expenses.jsx' };

describe('payment method values', () => {
  it('only uses values the server accepts', () => {
    const bad = [];
    for (const [file, src] of FILES) {
      for (const m of src.matchAll(/payment_method:\s*'([a-z_]+)'/g)) {
        const v = m[1];
        if (CANONICAL.has(v)) continue;
        if (LEGACY[v] === file) continue;
        bad.push(`${file}: payment_method: '${v}'`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('only offers values the server accepts in a method dropdown', () => {
    // <option value="bank"> on a form that posts straight to payments would be
    // refused by the CHECK constraint, as a 500, after the user pressed Pay.
    const bad = [];
    for (const [file, src] of FILES) {
      if (!/payment_method|paymentMethod|'method'|\bmethod\b/.test(src)) continue;
      for (const m of src.matchAll(/<option value="([a-z_]+)">(?:Bank Transfer|Cash|Cheque|Online|Mobile)</g)) {
        const v = m[1];
        if (CANONICAL.has(v)) continue;
        if (LEGACY[v] === file) continue;
        bad.push(`${file}: <option value="${v}">`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('recordPayment bodies', () => {
  const declared = (() => {
    const start = SCHEMAS.indexOf('const recordPayment = Joi.object({');
    const body = SCHEMAS.slice(start, SCHEMAS.indexOf('});', start));
    return new Set([...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));
  })();

  /** Every object literal that looks like a recordPayment body, with its keys. */
  function bodies() {
    const found = [];
    for (const [file, src] of FILES) {
      for (const m of src.matchAll(/type:\s*'(payment|receipt)'/g)) {
        // Walk left to the literal's `{`, then right to its match.
        let d = 0, open = -1;
        for (let i = m.index; i >= 0; i -= 1) {
          const c = src[i];
          if ('}])'.includes(c)) d += 1;
          else if ('{[('.includes(c)) { d -= 1; if (d < 0) { open = i; break; } }
        }
        if (open < 0 || src[open] !== '{') continue;
        d = 0;
        let close = -1;
        for (let i = open; i < src.length; i += 1) {
          const c = src[i];
          if ('{[('.includes(c)) d += 1;
          else if ('}])'.includes(c)) { d -= 1; if (d === 0) { close = i; break; } }
        }
        if (close < 0) continue;
        const inner = src.slice(open + 1, close);
        // Top-level keys only.
        const keys = [];
        let depth = 0, token = '';
        const push = () => {
          const k = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(token);
          if (k) keys.push(k[1]);
          token = '';
        };
        for (const c of inner) {
          if ('{[('.includes(c)) depth += 1;
          else if ('}])'.includes(c)) depth -= 1;
          if (c === ',' && depth === 0) push(); else token += c;
        }
        push();
        found.push({ file, keys });
      }
    }
    return found;
  }

  it('finds the bodies it is meant to be checking', () => {
    // A guard that silently matches nothing passes forever. If the shape of
    // these call sites changes, this fails and the guard gets updated.
    expect(bodies().length).toBeGreaterThanOrEqual(3);
  });

  it('uses no key the schema would strip', () => {
    const stripped = bodies().flatMap(({ file, keys }) => keys
      .filter((k) => !declared.has(k))
      .map((k) => `${file}: ${k}`));
    expect(stripped).toEqual([]);
  });
});

describe('the shared drawer', () => {
  it('is what the payable-settling screens use', () => {
    // These four were one drawer copied four times. If a new copy appears, or
    // one of these stops using the shared drawer, that is a regression.
    for (const f of [
      'modules/milling/pages/MillFinanceDashboard.jsx',
      'modules/exportOrders/components/PrintedBagsTab.jsx',
      'modules/millStore/pages/StoreOverview.jsx',
    ]) {
      const hit = FILES.find(([n]) => n === f);
      expect(hit, f).toBeTruthy();
      expect(hit[1], f).toContain('PaymentDrawer');
    }
  });

  it('owns the payment arithmetic — no screen reimplements the overpayment check', () => {
    // Expenses.jsx settles through PUT /expenses/:id/pay, whose server-side
    // markPaid does its own capping; its message is its own. Everything else
    // that caps an amount should be doing it through validatePayment.
    const OWN_ENDPOINT = ['modules/finance/pages/Expenses.jsx'];
    const reimplemented = FILES
      .filter(([f]) => !f.startsWith('components/payments/') && !OWN_ENDPOINT.includes(f))
      .filter(([, src]) => /exceeds the outstanding/.test(src))
      .map(([f]) => f);
    expect(reimplemented).toEqual([]);
  });
});
