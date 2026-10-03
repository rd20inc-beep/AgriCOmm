import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM: HERE does not exist, and these tests read files relative to themselves.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Structural guards for the shared ConfirmDialog.
 *
 * Two mistakes are easy to make and impossible to see in review:
 *
 *  1. Calling useConfirm() but never rendering {confirmDialog}. `await confirm(…)`
 *     then never resolves — the button does nothing at all, forever, with no
 *     error in the console.
 *  2. Reaching for window.confirm / window.prompt on a path that moves money.
 *     Those cannot show the figure or the consequence, which is the whole reason
 *     the shared dialog exists.
 *
 * Neither is caught by a type checker or by the build, so they are caught here.
 */
const SRC = path.resolve(HERE, '../..');

function jsxFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') jsxFiles(p, out); }
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
// Comments are stripped everywhere below: these files explain in prose what they
// replaced, and ConfirmDialog's own docblock shows the usage it documents. A
// match inside a comment is not a call site.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const FILES = jsxFiles(SRC).map((f) => [path.relative(SRC, f), stripComments(fs.readFileSync(f, 'utf8'))]);

// Every path here reverses, deletes or posts money, stock or a GL entry. They
// were converted deliberately; a native dialog reappearing on one is a
// regression, not a new call site.
const MONEY_MOVING = [
  'modules/finance/pages/MoneyOut.jsx',              // reverse a payment
  'modules/finance/pages/Cash.jsx',                  // reverse a fund transfer
  'modules/finance/pages/Suspense.jsx',              // reverse a suspense entry
  'modules/finance/pages/Confirmations.jsx',         // reject an export receipt
  'modules/milling/components/ServiceDispatchTab.jsx',   // reverse a dispatch
  'modules/milling/components/ServiceBillingTab.jsx',    // void a service invoice
  'modules/milling/pages/MillingBatchDetail.jsx',         // delete a batch / arrival
  'modules/milling/pages/ServiceMillingBatchDetail.jsx',  // delete a service lot / arrival
  'modules/milling/pages/MillFinanceDashboard.jsx',       // reject an advance, final settlement
  'modules/localSales/pages/LocalSales.jsx',              // reject a pending sale
  'modules/exportOrders/components/DebitNotesPanel.jsx',  // cancel a debit note
  'modules/exportOrders/components/PrintedBagsTab.jsx',   // delete a printed-bag order
  'modules/exportOrders/pages/ExportOrderDetail.jsx',     // cancel an export order
  'modules/admin/pages/admin/DangerZoneTab.jsx',          // hard deletes + bank adjust
  'modules/exportOrders/components/QuotationsPanel.jsx',  // convert a quote into a real order
  'modules/exportOrders/components/DocumentCenter.jsx',   // revise / cancel an approved document
];

describe('ConfirmDialog adoption', () => {
  it('every file that calls useConfirm also renders the dialog', () => {
    const broken = FILES
      .filter(([, src]) => /=\s*useConfirm\(\)/.test(src))
      .filter(([, src]) => !src.includes('{confirmDialog}'))
      .map(([f]) => f);
    expect(broken).toEqual([]);
  });

  it('calls the hook once per component that renders it', () => {
    // Two useConfirm() calls but one {confirmDialog} means one of them hangs.
    const mismatched = FILES
      .filter(([f]) => f !== 'hooks/useConfirm.jsx')
      .map(([f, src]) => [
        f,
        (src.match(/=\s*useConfirm\(\)/g) || []).length,
        (src.match(/\{confirmDialog\}/g) || []).length,
      ])
      .filter(([, calls, renders]) => calls !== renders)
      .map(([f, calls, renders]) => `${f}: ${calls} hook call(s), ${renders} render(s)`);
    expect(mismatched).toEqual([]);
  });

  it('keeps native dialogs off the paths that move money', () => {
    const regressed = MONEY_MOVING
      .map((f) => {
        const hit = FILES.find(([n]) => n === f);
        if (!hit) return `${f}: listed here but no longer exists — update this list`;
        return /window\.(confirm|prompt)\s*\(/.test(hit[1]) ? `${f}: uses a native dialog again` : null;
      })
      .filter(Boolean);
    expect(regressed).toEqual([]);
  });

  it('does not grow the number of native dialogs left elsewhere', () => {
    // A ratchet, not a target. Convert sites and lower it; never raise it.
    const BUDGET = 19;
    const sites = FILES
      .flatMap(([f, src]) => (src.match(/window\.(confirm|prompt)\s*\(/g) || []).map(() => f));
    if (sites.length > BUDGET) {
      throw new Error(
        `${sites.length} native confirm/prompt sites, budget ${BUDGET}. Use useConfirm() instead.\n`
        + [...new Set(sites)].sort().join('\n'),
      );
    }
    expect(sites.length).toBeLessThanOrEqual(BUDGET);
  });
});
