/**
 * Cost / profit visibility — ONE rule for every endpoint that returns money
 * attached to stock (owner decision 2026-10-05).
 *
 *   cost   (purchase rates, landed cost, stock value) → reports.view_cost OR finance.view
 *   profit (profit, margin, revenue, receivables)     → reports.view_profit OR finance.view
 *
 * Super Admin / Owner always pass (via rbac.userHasPermission). The QC Analyst,
 * Inventory Officer and Documentation Officer hold neither, so they see
 * quantities but never what the rice cost or what it is worth. The Mill
 * Operator holds both since mig 314 (owner: "see everything regarding the
 * mill"); company-wide finance stays closed to it by role on the routes.
 *
 * Keys are matched NORMALISED (lower-case, underscores removed), so one list
 * covers both the camelCase report payloads and the raw snake_case lot rows:
 * 'landed_cost_per_kg' and 'landedCostPerKg' are the same key here.
 */
const { userHasPermission } = require('../middleware/rbac');

const norm = (k) => String(k).toLowerCase().replace(/_/g, '');

// Explicit cost/value keys (any spelling). Anything whose normalised name
// contains "cost" is also cost — see isCostKey.
const COST_KEYS = new Set([
  // original reporting.controller list (P6b)
  'costPerKg', 'costPerUnit', 'costPkr', 'stockValue', 'value', 'valuePkr',
  'landedCostPerKg', 'purchaseValue', 'totalCostOfSold', 'cogs', 'cogsOfSold',
  'totalInputCost', 'rawCost', 'processingCost', 'onHandValue', 'remainingStockValue',
  'avgCost', 'totalCost', 'unitCostPkr', 'costTotalPkr', 'outputValue',
  'byproductRecovery', 'processingCostAllocated', 'recoveryValue', 'ratePerKg', 'purchaseCost',
  // lot rows / stock reports
  'total_value', 'total_value_pkr', 'perKg', 'rate_per_kg', 'rate_per_katta', 'rate_per_maund',
  'rate_per_ton', 'rate_input_value', 'purchase_amount', 'paid_amount', 'due_amount',
  'commission_per_bag', 'commission_total', 'raw_purchase_rate_per_kg',
  'price_per_mt', 'price_per_kg', 'valuation', 'grand_total_value',
].map(norm));

// Booleans / labels that merely mention cost or price — not money.
const COST_NOT_MONEY = new Set(['costincomplete', 'costcurrency', 'bagcostincluded', 'pricesconfirmed'].map(norm));

const PROFIT_KEYS = new Set([
  'realizedProfit', 'realizedProfitPct', 'expectedProfitRemaining', 'revenue',
  'totalRevenue', 'directRevenue', 'processedRevenue', 'avgSaleRate', 'salePricePerKg',
  'paymentReceived', 'outstanding', 'outstandingSales', 'profit', 'margin', 'marginPct',
  'market_value', 'sale_value', 'selling_value',
].map(norm));

function isCostKey(k) {
  const n = norm(k);
  if (COST_NOT_MONEY.has(n)) return false;
  // Anything named cost / price / fee, and any rate per unit (rate_per_kg,
  // service_milling_rate_per_kg, ratePerKatta) — purchase and sale prices and
  // service billing rates are all money a cost-blind role must not see.
  return COST_KEYS.has(n) || n.includes('cost') || n.includes('price')
    || n.includes('rateper') || n.startsWith('ratein') || /fee(per|$)/.test(n);
}

function isProfitKey(k) {
  const n = norm(k);
  return PROFIT_KEYS.has(n) || n.includes('profit') || n.startsWith('margin');
}

/** Pure, synchronous: null the money keys in-place. extraCostKeys adds keys
 *  that are money only in one payload (e.g. stock valuation's grandTotal). */
function redactMoney(node, { cost = true, profit = true, extraCostKeys = [] } = {}) {
  if (cost && profit) return node;
  const extra = new Set(extraCostKeys.map(norm));
  const walk = (n) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (!n || typeof n !== 'object' || n instanceof Date) return;
    for (const k of Object.keys(n)) {
      if ((!cost && (isCostKey(k) || extra.has(norm(k)))) || (!profit && isProfitKey(k))) { n[k] = null; continue; }
      walk(n[k]);
    }
  };
  walk(node);
  return node;
}

async function canSeeCost(req) {
  return (await userHasPermission(req, 'reports', 'view_cost')) || userHasPermission(req, 'finance', 'view');
}

async function canSeeProfit(req) {
  return (await userHasPermission(req, 'reports', 'view_profit')) || userHasPermission(req, 'finance', 'view');
}

async function moneyVisibility(req) {
  const [cost, profit] = await Promise.all([canSeeCost(req), canSeeProfit(req)]);
  return { cost, profit };
}

/** Redact `data` for the caller. Mutates + returns it. */
async function redactForUser(req, data, opts = {}) {
  const vis = await moneyVisibility(req);
  return redactMoney(data, { ...vis, ...opts });
}

/** Route middleware: 403 unless the caller may see cost. */
function requireCostVisibility(req, res, next) {
  canSeeCost(req).then((ok) => {
    if (ok) return next();
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Cost and stock-value figures need the "View cost" permission.',
    });
  }).catch(next);
}

module.exports = {
  isCostKey, isProfitKey, redactMoney, canSeeCost, canSeeProfit, moneyVisibility,
  redactForUser, requireCostVisibility,
};
