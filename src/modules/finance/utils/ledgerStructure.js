// Pure helpers for the per-account ledger (G-8) and the FX revaluation (G-7)
// screens. Kept out of the component files so Fast Refresh keeps working.

/**
 * Every cash / bank account has its own GL account under 1000 Cash & Bank
 * (G-8). Show them as one group: a Cash & Bank subtotal row, then each
 * account indented (1000 itself, if it still carries lines, as "unassigned").
 * A chart with no per-account children comes back unchanged.
 */
export function groupCashRows(accounts) {
  const isCash = (a) => a.parentCode === '1000' || a.code === '1000';
  const cash = accounts.filter(isCash);
  if (!cash.some((a) => a.parentCode === '1000')) return accounts.map((a) => ({ kind: 'row', a }));
  const sum = (k) => cash.reduce((t, a) => t + (Number(a[k]) || 0), 0);
  const group = { kind: 'group', code: '1000', name: 'Cash & Bank', debitTotal: sum('debitTotal'), creditTotal: sum('creditTotal'), balance: sum('balance') };
  const out = [];
  let placed = false;
  for (const a of accounts) {
    if (!isCash(a)) { out.push({ kind: 'row', a }); continue; }
    if (!placed) {
      out.push(group);
      for (const c of cash) out.push({ kind: 'row', a: c.code === '1000' ? { ...c, name: `${c.name} (unassigned)` } : c, child: true });
      placed = true;
    }
  }
  return out;
}

/** The month before `today`, as YYYY-MM — the usual one to close. */
export function lastMonth(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
