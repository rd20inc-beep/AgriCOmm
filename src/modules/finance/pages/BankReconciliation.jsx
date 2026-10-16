// Accounts › Reconcile (owner decision B5) — one bank / cash account against
// its bank statement. Start a reconciliation for the statement date with the
// statement's closing balance, tick the account's own transactions that are
// on the statement, watch the cleared balance close on the statement balance,
// save progress, and complete it once the difference is 0. Statement lines can
// be imported from a CSV (date, description, amount) to suggest ticks.
// Server: /api/accounting/reconciliations (finance.view to read,
// finance.post_journal to change — mirrored here with PermissionGate).
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Landmark, Save, Upload, Wand2 } from 'lucide-react';
import { useBankAccounts } from '../../../api/queries';
import { accountingApi } from '../../accounting/api/services';
import { useApp } from '../../../context/AppContext';
import PermissionGate from '../../../shared/components/PermissionGate';
import StatusBadge from '../../../shared/components/StatusBadge';
import { favStar } from '../../../shared/utils/favorites';
import { fmtMoney, fmtDate, todayLocalISO } from '../../../shared/utils/format';
import { EmptyLine, InlineError } from '../components/FinanceUI';
import { btnPrimary, btnSecondary, btnQuiet, card, cardPad, th, tdMoney, kpiLabel, errorText } from '../utils/uiClasses';
import { reconFigures, ticksChanged, parseStatementCsv } from '../utils/bankRecon';
import { useDefaultAccount } from '../../../shared/hooks/useDefaultAccount';

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900';
const lbl = 'block text-xs font-medium text-gray-600 mb-1';
const errMsg = (e, fallback) => e?.data?.message || e?.message || fallback;

function Tile({ label, value, tone, testId }) {
  return (
    <div className={`${card} p-3 min-w-0`} data-testid={testId}>
      <p className={kpiLabel}>{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums break-words ${tone || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function StartForm({ account, onStarted }) {
  const { addToast } = useApp();
  const [date, setDate] = useState(todayLocalISO());
  const [balance, setBalance] = useState('');
  const [busy, setBusy] = useState(false);
  async function start(e) {
    e.preventDefault();
    if (balance === '' || !Number.isFinite(Number(balance))) { addToast?.('Enter the statement closing balance.', 'error'); return; }
    setBusy(true);
    try {
      const res = await accountingApi.createReconciliation({ bank_account_id: account.id, statement_date: date, statement_balance: Number(balance) });
      onStarted(res?.data?.reconciliation?.id);
    } catch (err) {
      const open = err?.data?.data?.reconciliation?.id;
      if (open) { addToast?.(errMsg(err, ''), 'warning'); onStarted(open); } else addToast?.(errMsg(err, 'Could not start the reconciliation.'), 'error');
    } finally { setBusy(false); }
  }
  return (
    <form onSubmit={start} className={`${card} ${cardPad} grid grid-cols-1 sm:grid-cols-3 gap-3 items-end`} data-testid="recon-start">
      <div>
        <label className={lbl} htmlFor="recon-date">Statement date *</label>
        <input id="recon-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} required />
      </div>
      <div>
        <label className={lbl} htmlFor="recon-balance">Statement closing balance ({account.currency || 'PKR'}) *</label>
        <input id="recon-balance" type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} className={`${inp} text-right tabular-nums`} required />
      </div>
      <button type="submit" disabled={busy} className={btnPrimary} data-action="start-reconciliation">Start reconciliation</button>
    </form>
  );
}

function Workspace({ id, canEdit, onChanged }) {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const { data: ws, isLoading, error, refetch } = useQuery({
    queryKey: ['reconciliation', id],
    queryFn: () => accountingApi.reconciliation(id).then((r) => r?.data),
    enabled: !!id,
  });
  const saved = useMemo(() => new Set((ws?.transactions || []).filter((t) => t.ticked).map((t) => t.id)), [ws]);
  // Unsaved edits; null = what the server has. Saving clears them.
  const [tickEdits, setTickEdits] = useState(null);
  const [statementEdit, setStatementEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  // W18: completing clears every ticked transaction at once, so it goes
  // through a review of what is about to be cleared first.
  const [reviewing, setReviewing] = useState(false);

  if (isLoading) return <div className="h-40 bg-gray-100 rounded-xl animate-pulse" aria-busy="true" />;
  if (error || !ws) return <InlineError message={errorText(error, 'The reconciliation')} onRetry={refetch} />;

  const r = ws.reconciliation;
  const ticked = tickEdits || saved;
  const setTicked = (fn) => setTickEdits(fn(ticked));
  const statement = statementEdit ?? String(r.statement_balance);
  const setStatement = setStatementEdit;
  const reset = () => { setTickEdits(null); setStatementEdit(null); };
  const cur = ws.account?.currency || 'PKR';
  const money = (v) => fmtMoney(v, cur, { decimals: 2 });
  const done = r.status === 'Completed';
  const editable = canEdit && !done;
  const statementBalance = Number(statement);
  const fig = reconFigures({ opening: ws.opening_balance, transactions: ws.transactions, ticked, statementBalance });
  const dirty = ticksChanged(saved, ticked) || (Number.isFinite(statementBalance) && Math.abs(statementBalance - Number(r.statement_balance)) >= 0.005);
  const suggested = (ws.suggestions || []).filter((s) => !ticked.has(s.bank_transaction_id));

  const toggle = (tid) => setTicked((s) => { const n = new Set(s); if (n.has(tid)) n.delete(tid); else n.add(tid); return n; });
  const allTicked = ws.transactions.length > 0 && ws.transactions.every((t) => ticked.has(t.id));
  const toggleAll = () => setTicked(() => (allTicked ? new Set() : new Set(ws.transactions.map((t) => t.id))));

  async function save({ quiet = false } = {}) {
    const res = await accountingApi.saveReconciliationTicks(r.id, { bank_transaction_ids: [...ticked], statement_balance: Number.isFinite(statementBalance) ? statementBalance : null });
    qc.setQueryData(['reconciliation', id], res?.data);
    reset();
    if (!quiet) addToast?.('Progress saved.', 'success');
    return res?.data;
  }
  async function onSave() {
    setBusy(true);
    try { await save(); onChanged?.(); } catch (e) { addToast?.(errMsg(e, 'Could not save.'), 'error'); } finally { setBusy(false); }
  }
  async function onComplete() {
    setReviewing(false);
    setBusy(true);
    try {
      if (dirty) await save({ quiet: true });
      const res = await accountingApi.completeReconciliation(r.id);
      qc.setQueryData(['reconciliation', id], res?.data);
      reset();
      addToast?.(`${ws.account.name} reconciled to ${fmtDate(r.statement_date)}.`, 'success');
      onChanged?.();
    } catch (e) { addToast?.(errMsg(e, 'Could not complete.'), 'error'); } finally { setBusy(false); }
  }
  async function onImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { lines, errors } = parseStatementCsv(await file.text());
    if (errors.length) addToast?.(errors.slice(0, 3).join(' '), lines.length ? 'warning' : 'error');
    if (!lines.length) return;
    setBusy(true);
    try {
      const res = await accountingApi.addReconciliationLines(r.id, lines);
      qc.setQueryData(['reconciliation', id], res?.data);
      addToast?.(`${lines.length} statement line(s) imported — ${(res?.data?.suggestions || []).length} match(es) suggested.`, 'success');
    } catch (err) { addToast?.(errMsg(err, 'Could not import the statement.'), 'error'); } finally { setBusy(false); }
  }
  const tickSuggested = () => setTicked((s) => new Set([...s, ...suggested.map((x) => x.bank_transaction_id)]));

  return (
    <div className="space-y-4" data-testid="recon-workspace">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <StatusBadge status={r.status} />
        <span>Statement to <span className="font-medium text-gray-900">{fmtDate(r.statement_date)}</span></span>
        {done && r.reconciled_by_name && <span>· completed by {r.reconciled_by_name}{r.reconciled_at ? ` on ${fmtDate(r.reconciled_at)}` : ''}</span>}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Opening cleared" value={money(ws.opening_balance)} />
        <Tile label={`Ticked (${fig.count})`} value={`+${money(fig.tickedIn)} / −${money(fig.tickedOut)}`} tone="text-gray-700" />
        <Tile label="Cleared balance" value={money(fig.cleared)} testId="recon-cleared" />
        <div className={`${card} p-3 min-w-0`}>
          <label className={kpiLabel} htmlFor="recon-statement">Statement balance</label>
          {editable
            ? <input id="recon-statement" type="number" step="0.01" value={statement} onChange={(e) => setStatement(e.target.value)} className={`${inp} mt-1 text-right tabular-nums font-bold`} />
            : <p className="mt-1 text-lg font-bold tabular-nums">{money(r.statement_balance)}</p>}
        </div>
        <Tile label="Difference" value={money(fig.difference)} tone={fig.balanced ? 'text-emerald-700' : 'text-red-700'} testId="recon-difference" />
      </div>
      {Math.abs(Number(ws.unexplained_balance) || 0) >= 0.005 && (
        <p className="text-xs text-amber-700">The account balance holds {money(ws.unexplained_balance)} that no bank transaction explains — it is counted as already cleared.</p>
      )}

      {editable && (
        <PermissionGate module="finance" action="post_journal">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImport} aria-label="Statement CSV" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={btnQuiet} data-action="import-statement">
              <Upload size={14} aria-hidden="true" /> Import statement CSV
            </button>
            {suggested.length > 0 && (
              <button type="button" onClick={tickSuggested} className={btnQuiet} data-action="tick-suggested">
                <Wand2 size={14} aria-hidden="true" /> Tick {suggested.length} suggested match{suggested.length === 1 ? '' : 'es'}
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onSave} disabled={busy || !dirty} className={btnSecondary} data-action="save-reconciliation">
              <Save size={14} aria-hidden="true" /> Save progress
            </button>
            <button type="button" onClick={() => setReviewing(true)} disabled={busy || !fig.balanced || reviewing}
              title={fig.balanced ? undefined : 'The difference must be 0 to complete'} className={btnPrimary} data-action="complete-reconciliation">
              <CheckCircle2 size={14} aria-hidden="true" /> Complete…
            </button>
          </div>
        </PermissionGate>
      )}

      {editable && reviewing && (
        <PermissionGate module="finance" action="post_journal">
          <CompleteReview account={ws.account} statementDate={r.statement_date} fig={fig} statementBalance={statementBalance}
            money={money} unsaved={dirty} busy={busy} onBack={() => setReviewing(false)} onConfirm={onComplete} />
        </PermissionGate>
      )}

      <div className={`${card} overflow-hidden`}>
        {ws.transactions.length === 0 ? (
          <EmptyLine icon={CheckCircle2}>No unreconciled transactions up to {fmtDate(r.statement_date)}.</EmptyLine>
        ) : (
          <div className="overflow-x-auto mobile-cards">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={`${th} w-10`}>
                  {editable && <input type="checkbox" checked={allTicked} onChange={toggleAll} aria-label="Tick all" className="rounded border-gray-300" />}
                </th>
                <th className={`${th} text-left`}>Date</th><th className={`${th} text-left`}>Transaction</th>
                <th className={`${th} text-right`}>Money in</th><th className={`${th} text-right`}>Money out</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {ws.transactions.map((t) => {
                  const on = ticked.has(t.id);
                  const hint = (ws.suggestions || []).some((s) => s.bank_transaction_id === t.id) && !on;
                  return (
                    <tr key={t.id} className={on ? 'bg-emerald-50/40' : hint ? 'bg-blue-50/40' : ''} data-ticked={on ? 'true' : 'false'}>
                      <td data-label="" className="py-2 px-4">
                        <input type="checkbox" checked={on} disabled={!editable} onChange={() => toggle(t.id)}
                          aria-label={`On the statement: ${t.transaction_no}`} className="rounded border-gray-300" />
                      </td>
                      <td data-label="Date" className="py-2 px-4 whitespace-nowrap text-gray-700">{fmtDate(t.transaction_date)}</td>
                      <td data-label="Transaction" className="py-2 px-4 min-w-0">
                        <span className="font-mono text-xs text-gray-500">{t.transaction_no}</span>
                        {hint && <span className="ml-1.5 text-[11px] text-blue-700">suggested</span>}
                        <p className="text-gray-800 break-words">{t.counterparty || t.notes || t.reference || t.source || '—'}</p>
                      </td>
                      <td data-label="Money in" className={`py-2 px-4 ${tdMoney} text-emerald-700`}>{t.signed_amount > 0 ? money(t.signed_amount) : ''}</td>
                      <td data-label="Money out" className={`py-2 px-4 ${tdMoney} text-red-700`}>{t.signed_amount < 0 ? money(-t.signed_amount) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {ws.statement_lines?.length > 0 && (
        <div className={`${card} ${cardPad}`}>
          <p className="text-sm font-semibold text-gray-900 mb-2">Imported statement lines ({ws.statement_lines.length})</p>
          <ul className="text-xs text-gray-700 divide-y divide-gray-50">
            {ws.statement_lines.map((l) => {
              const match = (ws.suggestions || []).find((s) => s.statement_item_id === l.id);
              return (
                <li key={l.id} className="py-1.5 flex flex-wrap gap-x-3 justify-between">
                  <span>{fmtDate(l.date)} · {l.reference || '—'}</span>
                  <span className="tabular-nums">{money(l.amount)}{match ? ' · suggested match' : ''}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The review before Complete (W18): what is about to be cleared, in one place,
 * with an explicit confirm. Exported for tests.
 */
export function CompleteReview({ account, statementDate, fig, statementBalance, money, unsaved, busy, onBack, onConfirm }) {
  const row = (k, v) => (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{k}</span><span className="text-right font-medium text-gray-900 tabular-nums">{v}</span>
    </div>
  );
  return (
    <div className={`${card} ${cardPad} space-y-3 border-blue-200`} data-testid="recon-complete-review" role="region" aria-label="Review before completing">
      <p className="text-sm font-semibold text-gray-900">Check before you complete</p>
      <div className="text-xs rounded-lg border border-gray-200 bg-white px-3">
        {row('Account', account?.name || '—')}
        {row('Statement date', fmtDate(statementDate))}
        {row('Transactions to clear', String(fig.count))}
        {row('Money in cleared', money(fig.tickedIn))}
        {row('Money out cleared', money(fig.tickedOut))}
        {row('Cleared balance', money(fig.cleared))}
        {row('Statement balance', money(statementBalance))}
        {row('Difference', money(fig.difference))}
      </div>
      <p className="text-xs text-gray-600">
        {fig.count} transaction{fig.count === 1 ? '' : 's'} will be marked reconciled to this statement. Nothing is posted to the ledger.
        {unsaved ? ' Your unsaved ticks are saved first.' : ''}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onBack} disabled={busy} className={btnSecondary} data-action="review-back">Back</button>
        <button type="button" onClick={onConfirm} disabled={busy || !fig.balanced} className={btnPrimary} data-action="confirm-complete-reconciliation">
          <CheckCircle2 size={14} aria-hidden="true" /> {busy ? 'Completing…' : 'Confirm & complete'}
        </button>
      </div>
    </div>
  );
}

export default function BankReconciliation() {
  const { data: accounts = [], isLoading: accLoading } = useBankAccounts();
  // ?account=<id> opens on that account (e.g. linked from the Account drawer);
  // otherwise the account this user reconciled last (W18), if still active.
  const [params] = useSearchParams();
  const [picked, setPicked] = useState(params.get('account') || null);
  const [openId, setOpenId] = useState(null);
  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive !== false), [accounts]);
  const { accountId: lastAccountId, remember } = useDefaultAccount({ currency: '*', entity: 'all', purpose: 'reconcile', accounts: activeAccounts });
  const accountId = picked ?? lastAccountId;
  const setAccountId = (id) => { setPicked(id); if (id) remember(id); };
  const account = accounts.find((a) => String(a.id) === String(accountId));
  const { data: history = [], refetch: refetchHistory, isLoading: histLoading } = useQuery({
    queryKey: ['reconciliations', accountId],
    queryFn: () => accountingApi.reconciliations({ bank_account_id: accountId }).then((r) => r?.data?.reconciliations || []),
    enabled: !!accountId,
  });
  const inProgress = history.find((h) => h.status !== 'Completed');
  const shownId = openId || inProgress?.id || null;
  const active = activeAccounts;

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600 max-w-3xl">
        Match an account against its bank statement: tick each transaction that appears on the statement until the cleared balance equals the statement balance, then complete it. Nothing is posted to the ledger — reconciling confirms what is already booked.
      </p>
      <div className={`${card} ${cardPad} grid grid-cols-1 sm:grid-cols-2 gap-3`}>
        <div>
          <label className={lbl} htmlFor="recon-account">Account</label>
          <select id="recon-account" value={accountId} onChange={(e) => { setAccountId(e.target.value); setOpenId(null); }} className={`${inp} bg-white`} disabled={accLoading}>
            <option value="">Choose an account…</option>
            {active.map((a) => (
              <option key={a.id} value={a.id}>{favStar(a)}{a.name}{a.bankName ? ` — ${a.bankName}` : ''} ({a.currency || 'PKR'})</option>
            ))}
          </select>
          {!picked && lastAccountId && String(accountId) === String(lastAccountId) && (
            <p className="text-[11px] text-gray-500 mt-1" data-testid="account-default-hint">The account you reconciled last — choose another if needed.</p>
          )}
        </div>
        {account && (
          <div className="text-sm text-gray-600 self-end">
            Book balance <span className="font-semibold text-gray-900 tabular-nums">{account.currentBalance == null ? '—' : fmtMoney(account.currentBalance, account.currency || 'PKR', { decimals: 2 })}</span>
          </div>
        )}
      </div>

      {!account ? (
        <EmptyLine icon={Landmark}>Choose the account to reconcile.</EmptyLine>
      ) : histLoading ? (
        <div className="h-24 bg-gray-100 rounded-xl animate-pulse" aria-busy="true" />
      ) : (
        <>
          {!shownId && (
            <PermissionGate module="finance" action="post_journal"
              fallback={<EmptyLine icon={Landmark}>No reconciliation in progress for {account.name}.</EmptyLine>}>
              <StartForm account={account} onStarted={(id) => { setOpenId(id); refetchHistory(); }} />
            </PermissionGate>
          )}
          {shownId && (
            <PermissionGate module="finance" action="post_journal" fallback={<Workspace key={shownId} id={shownId} canEdit={false} />}>
              <Workspace key={shownId} id={shownId} canEdit onChanged={() => { setOpenId(shownId); refetchHistory(); }} />
            </PermissionGate>
          )}
          {history.length > 0 && (
            <div className={`${card} overflow-hidden`}>
              <p className="px-4 sm:px-5 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">History</p>
              <div className="overflow-x-auto mobile-cards">
                <table className="w-full text-sm">
                  <thead><tr>
                    <th className={`${th} text-left`}>Statement date</th><th className={`${th} text-right`}>Statement balance</th>
                    <th className={`${th} text-left`}>Status</th><th className={th}><span className="sr-only">Open</span></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {history.map((h) => (
                      <tr key={h.id} className={String(h.id) === String(shownId) ? 'bg-blue-50/40' : ''}>
                        <td data-label="Statement date" className="py-2 px-4">{fmtDate(h.statement_date)}</td>
                        <td data-label="Statement balance" className={`py-2 px-4 ${tdMoney}`}>{fmtMoney(h.statement_balance, h.bank_account_currency || account.currency || 'PKR', { decimals: 2 })}</td>
                        <td data-label="Status" className="py-2 px-4"><StatusBadge status={h.status} /></td>
                        <td data-label="" className="py-2 px-4 text-right">
                          <button type="button" onClick={() => setOpenId(h.id)} className={btnQuiet}>Open</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!inProgress && shownId && (
                <PermissionGate module="finance" action="post_journal">
                  <div className="px-4 sm:px-5 py-3 border-t border-gray-100">
                    <button type="button" onClick={() => setOpenId(null)} className={btnSecondary} data-action="new-reconciliation">Reconcile the next statement</button>
                  </div>
                </PermissionGate>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
