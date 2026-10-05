// Local-sale words and small form helpers shared by Local Sales and the
// Finance › Local Sales / Money In screens.

const num = (v) => parseFloat(v) || 0;

// The one set of payment words (LS-07): Paid / Partial / Credit, plus
// Rejected for a sale that was turned down (status 'Cancelled'). Derived from
// the money, not the stored word — older rows carry 'Unpaid' / 'Pending'.
export function paymentWord(sale) {
  if (!sale) return 'Credit';
  if (sale.status === 'Cancelled') return 'Rejected';
  const due = num(sale.dueAmount ?? sale.due_amount);
  const paid = num(sale.paidAmount ?? sale.paid_amount);
  if (due <= 0.01) return 'Paid';
  if (paid > 0) return 'Partial';
  return 'Credit';
}

// The word for a multi-item sale: Rejected if every line was, else from the
// sum of the lines that still stand.
export function groupPaymentWord(items = []) {
  const live = items.filter((s) => s.status !== 'Cancelled');
  if (!live.length) return items.length ? 'Rejected' : 'Credit';
  return paymentWord({
    dueAmount: live.reduce((a, s) => a + num(s.dueAmount ?? s.due_amount), 0),
    paidAmount: live.reduce((a, s) => a + num(s.paidAmount ?? s.paid_amount), 0),
  });
}

// What can still be collected on a sale: the due on its CONFIRMED lines.
export function payableDue(items = []) {
  return Math.round(items
    .filter((s) => s.status === 'Completed')
    .reduce((a, s) => a + num(s.dueAmount ?? s.due_amount), 0) * 100) / 100;
}

// Today's date in the user's LOCAL time as YYYY-MM-DD. toISOString() is UTC,
// which in Pakistan (UTC+5) is still yesterday until 5 a.m.
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Last customer used on a local sale, remembered per browser. Storage can be
// blocked (private window) — then there is simply no default.
const LAST_CUSTOMER_KEY = 'riceflow.localSales.lastCustomerId';
export function readLastCustomerId() {
  try { return window.localStorage.getItem(LAST_CUSTOMER_KEY) || ''; } catch { return ''; }
}
export function rememberLastCustomerId(id) {
  try {
    if (id) window.localStorage.setItem(LAST_CUSTOMER_KEY, String(id));
    else window.localStorage.removeItem(LAST_CUSTOMER_KEY);
  } catch { /* storage unavailable — nothing to remember */ }
}

// The starred account among the options, else the only one, else none.
export function defaultBankAccountId(accounts = [], isFav) {
  const list = Array.isArray(accounts) ? accounts : [];
  const fav = list.find((a) => isFav(a));
  if (fav) return String(fav.id);
  return list.length === 1 ? String(list[0].id) : '';
}
