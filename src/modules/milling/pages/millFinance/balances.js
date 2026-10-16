/**
 * Per-entity, per-currency account balances for the Mill Finance Overview.
 * Head Office and the Mill are kept apart, and PKR and USD are never added
 * together: each total is the sum of bank_accounts.current_balance for ONE
 * entity in ONE currency. Presentation only — the balances are the server's.
 */
export function groupBalances(accounts = []) {
  const out = { mill: {}, general: {} };
  for (const a of accounts || []) {
    if (a.isActive === false) continue;
    const ent = (a.entity || 'general') === 'mill' ? 'mill' : 'general';
    const cur = a.currency || 'PKR';
    const g = (out[ent][cur] = out[ent][cur] || { currency: cur, total: 0, accounts: [] });
    g.total += parseFloat(a.currentBalance) || 0;
    g.accounts.push(a);
  }
  const order = (m) => Object.values(m).sort((x, y) => {
    if (x.currency === y.currency) return 0;
    if (x.currency === 'PKR') return -1;
    if (y.currency === 'PKR') return 1;
    return x.currency.localeCompare(y.currency);
  });
  return { mill: order(out.mill), general: order(out.general) };
}
