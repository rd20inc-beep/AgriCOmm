/**
 * Cash forecast vs commitments (Reports ▸ Cash Forecast) — the pure fold.
 *
 * One forecast PER CURRENCY: each currency's own cash, plus what is due in
 * and out in that currency, day by day. PKR and USD are never added together
 * (owner decision G-1). Beside them, one ≈ PKR equivalent line per figure —
 * receivables at their own booked rate, bank balances and foreign payables at
 * today's rate (they keep no booked rate), labelled; never cash.
 *
 * Uncleared cheques follow the payments-feed rule (paymentsFeedTotals.js): a
 * cheque not yet cleared is not money — it has not moved the bank or settled
 * its document — so it is reported on its own as pending, never added to the
 * cash or the projection. Reversed / Bounced cheques are not pending either.
 */
const { foldPkrEquiv, payablePkrToday } = require('../finance/currencyFigures');

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => parseInt(v, 10) || 0;
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;
const curOf = (c) => String(c || 'PKR').toUpperCase();
const listOf = (rows) => (Array.isArray(rows) ? rows : []);
const dayOf = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// PKR first, then USD, then any other code alphabetically.
const rank = (c) => (c === 'PKR' ? 0 : c === 'USD' ? 1 : 2);
const sortCurrencies = (list) => [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

/**
 * @param receipts  [{ currency, due_day, amount, pkr_equiv, pkr_missing }] open receivables due in the window
 * @param payments  [{ currency, due_day, amount, count }] open payables due in the window
 * @param bank      [{ currency, total, count }] bank / cash account balances
 * @param cheques   [{ type: 'receipt'|'payment', currency, amount, count }] uncleared cheques
 * @param opts      { asOf 'YYYY-MM-DD', daysAhead, usdRate, rateDate }
 */
function foldCashForecast({ receipts = [], payments = [], bank = [], cheques = [] } = {},
  { asOf, daysAhead = 30, usdRate = 0, rateDate = null } = {}) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const days = Math.max(0, int(daysAhead));

  const cash = {}; const inByDay = {}; const outByDay = {};
  const pendingIn = {}; const pendingOut = {};
  for (const b of listOf(bank)) cash[curOf(b.currency)] = r2((cash[curOf(b.currency)] || 0) + num(b.total));
  const bump = (map, cur, day, amt) => {
    map[cur] = map[cur] || {};
    map[cur][day] = (map[cur][day] || 0) + num(amt);
  };
  for (const r of listOf(receipts)) bump(inByDay, curOf(r.currency), dayOf(r.due_day), r.amount);
  for (const p of listOf(payments)) bump(outByDay, curOf(p.currency), dayOf(p.due_day), p.amount);
  for (const c of listOf(cheques)) {
    const map = c.type === 'payment' ? pendingOut : pendingIn;
    const cur = curOf(c.currency);
    const prev = map[cur] || { amount: 0, count: 0 };
    map[cur] = { amount: r2(prev.amount + num(c.amount)), count: prev.count + int(c.count) };
  }

  const currencies = sortCurrencies(new Set([
    'PKR', ...Object.keys(cash), ...Object.keys(inByDay), ...Object.keys(outByDay),
    ...Object.keys(pendingIn), ...Object.keys(pendingOut),
  ]));

  const byCurrency = {};
  const projection = [];
  for (const cur of currencies) {
    let running = cash[cur] || 0; let totalIn = 0; let totalOut = 0;
    for (let i = 0; i <= days; i += 1) {
      const date = addDays(today, i);
      const inflow = r2((inByDay[cur] || {})[date] || 0);
      const outflow = r2((outByDay[cur] || {})[date] || 0);
      totalIn += inflow; totalOut += outflow;
      running += inflow - outflow;
      projection.push({
        currency: cur,
        date,
        expectedReceipts: inflow,
        expectedPayments: outflow,
        netCashFlow: r2(inflow - outflow),
        projectedBalance: r2(running),
      });
    }
    byCurrency[cur] = {
      currentCash: r2(cash[cur] || 0),
      expectedReceipts: r2(totalIn),
      expectedPayments: r2(totalOut),
      projectedBalance: r2(running),
      // Not money yet — shown beside the forecast, never inside it.
      pendingChequesIn: pendingIn[cur] || { amount: 0, count: 0 },
      pendingChequesOut: pendingOut[cur] || { amount: 0, count: 0 },
    };
  }

  // ≈ PKR equivalents — secondary lines only.
  const cashParts = Object.entries(cash).map(([cur, bal]) => {
    const pkr = payablePkrToday(cur, bal, usdRate); // a balance converts like a payable: today's rate
    return { currency: cur, pkr, basis: 'today' };
  });
  const inParts = listOf(receipts).map((r) => ({
    currency: r.currency, pkr: num(r.pkr_equiv), basis: 'booked', missing: int(r.pkr_missing),
  }));
  const outParts = listOf(payments).map((p) => {
    const pkr = payablePkrToday(p.currency, p.amount, usdRate);
    return { currency: p.currency, pkr, basis: 'today', missing: pkr == null ? (int(p.count) || 1) : 0, today: int(p.count) || 1 };
  });
  const pkrEquiv = {
    currentCash: foldPkrEquiv(cashParts, { rateDate }),
    expectedReceipts: foldPkrEquiv(inParts, { rateDate }),
    expectedPayments: foldPkrEquiv(outParts, { rateDate }),
    projectedBalance: foldPkrEquiv([...cashParts, ...inParts, ...outParts.map((p) => ({ ...p, sign: -1 }))], { rateDate }),
  };

  return {
    asOf: today,
    daysAhead: days,
    currencies,
    byCurrency,
    projection,
    pkrEquiv,
    usdRate: num(usdRate) || null,
    rateDate,
  };
}

module.exports = { foldCashForecast, addDays };
