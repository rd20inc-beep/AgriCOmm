// Accounting › Periods (owner decision D-1, 2026-10-16). The fiscal year is
// the Pakistani tax year, 1 July – 30 June, in monthly periods.
//   - The Finance Manager (finance.post_journal) closes a month; from then on
//     journals and bank / cash movements dated in it are refused. Closing
//     never alters a posted journal.
//   - Only the Owner reopens a month, with a reason (OwnerAuthContext asks a
//     non-Owner for the Owner's approval on this screen).
//   - Next year's twelve months can be created ahead of time.
// Each month links to its trial balance and balance sheet as at month-end.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, CalendarPlus } from 'lucide-react';
import { useAccountingPeriods } from '../../../api/queries';
import { accountingApi } from '../../accounting/api/services';
import { useAuth } from '../../../context/AuthContext';
import { useOwnerAuth } from '../../../context/OwnerAuthContext';
import { useApp } from '../../../context/AppContext';
import { fmtDate, fmtDateTime } from '../../../shared/utils/format';
import { customRangeKey } from '../financeNav';
import { StateBox } from '../components/GlStatementParts';
import { btnPrimary, btnSecondary, th } from '../utils/uiClasses';
import { dayOf as day, fyLabel, groupByFiscalYear } from '../utils/periods';

const STATUS_TONE = {
  Open: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Closed: 'bg-gray-100 text-gray-700 ring-gray-200',
  Locked: 'bg-red-50 text-red-700 ring-red-200',
};

export default function Periods() {
  const { hasPermission } = useAuth();
  const { requestOwnerApproval } = useOwnerAuth();
  const { addToast } = useApp() || {};
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useAccountingPeriods();
  const canManage = hasPermission('finance', 'post_journal');
  const periods = useMemo(() => data?.periods || [], [data]);
  const groups = useMemo(() => groupByFiscalYear(periods), [periods]);
  const years = Object.keys(groups).sort().reverse();
  const currentStart = data?.currentFiscalYear?.startYear;
  const currentLabel = currentStart ? fyLabel(currentStart) : null;
  const [fy, setFy] = useState('');
  const shown = fy || (currentLabel && groups[currentLabel] ? currentLabel : years[0]) || '';
  const lastStart = years.length ? parseInt(years[0].slice(0, 4), 10) : currentStart;
  const nextStart = Number.isFinite(lastStart) ? lastStart + 1 : null;
  const [busy, setBusy] = useState(null);
  const [reopening, setReopening] = useState(null); // { id, name }
  const [reason, setReason] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['accounting-periods'] });
    qc.invalidateQueries({ queryKey: ['trial-balance'] });
    qc.invalidateQueries({ queryKey: ['balance-sheet'] });
  };
  const fail = (e) => addToast?.(e?.message || 'Something went wrong', 'error');

  async function close(p) {
    if (!window.confirm(`Close ${p.name}? Nothing dated in it can post afterwards; only the Owner can reopen it.`)) return;
    setBusy(p.id);
    try { await accountingApi.closePeriod(p.id); addToast?.(`${p.name} closed`, 'success'); refresh(); } catch (e) { fail(e); }
    setBusy(null);
  }
  async function reopen() {
    if (!reopening || reason.trim().length < 5) return;
    setBusy(reopening.id);
    try {
      await requestOwnerApproval((ownerId) => accountingApi.reopenPeriod(reopening.id, reason.trim(), ownerId),
        { label: `Reopen ${reopening.name}` });
      addToast?.(`${reopening.name} reopened`, 'success');
      setReopening(null); setReason(''); refresh();
    } catch (e) { fail(e); }
    setBusy(null);
  }
  async function createNext() {
    if (!nextStart) return;
    setBusy('fy');
    try {
      await accountingApi.createFiscalYear(nextStart);
      addToast?.(`FY ${fyLabel(nextStart)} periods created`, 'success');
      refresh();
    } catch (e) { fail(e); }
    setBusy(null);
  }

  const rows = groups[shown] || [];
  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Accounting periods</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Fiscal year 1 July – 30 June, monthly. A closed month takes no journals or money movements; only the Owner reopens it. Closing never changes a posted journal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={shown} onChange={(e) => setFy(e.target.value)} aria-label="Fiscal year"
            className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
            {years.map((y) => <option key={y} value={y}>FY {y}{y === currentLabel ? ' (current)' : ''}</option>)}
          </select>
          {canManage && nextStart && (
            <button type="button" className={btnSecondary} onClick={createNext} disabled={busy === 'fy'} data-testid="create-fy">
              <CalendarPlus size={14} /> Create FY {fyLabel(nextStart)}
            </button>
          )}
        </div>
      </div>
      <StateBox isLoading={isLoading} error={error} onRetry={refetch} empty={rows.length === 0}>
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto mobile-cards" data-testid="periods-table">
          <table className="w-full text-sm">
            <thead><tr>
              {['Month', 'From', 'To', 'Status', 'Closed', 'Month-end', ''].map((h) => <th key={h} className={`${th} text-left`}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((p) => {
                const asAt = customRangeKey(day(p.periodStart), day(p.periodEnd));
                return (
                  <tr key={p.id} data-testid={`period-${p.id}`}>
                    <td data-label="Month" className="px-4 py-2 font-medium text-gray-800">{p.name}</td>
                    <td data-label="From" className="px-4 py-2 text-gray-600">{fmtDate(day(p.periodStart))}</td>
                    <td data-label="To" className="px-4 py-2 text-gray-600">{fmtDate(day(p.periodEnd))}</td>
                    <td data-label="Status" className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${STATUS_TONE[p.status] || STATUS_TONE.Closed}`}>{p.status}</span>
                    </td>
                    <td data-label="Closed" className="px-4 py-2 text-xs text-gray-500">
                      {p.closedAt ? `${fmtDateTime(p.closedAt)}${p.closedByName ? ` · ${p.closedByName}` : ''}` : '—'}
                    </td>
                    <td data-label="Month-end" className="px-4 py-2 text-xs whitespace-nowrap">
                      <Link className="text-blue-600 hover:underline" to={`/finance/accounting/trial-balance?range=${asAt}`}>Trial balance</Link>
                      {' · '}
                      <Link className="text-blue-600 hover:underline" to={`/finance/accounting/balance-sheet?range=${asAt}`}>Balance sheet</Link>
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {canManage && p.status === 'Open' && (
                        <button type="button" className={btnSecondary} disabled={busy === p.id} onClick={() => close(p)}>
                          <Lock size={13} /> Close
                        </button>
                      )}
                      {canManage && p.status === 'Closed' && (
                        <button type="button" className={btnSecondary} disabled={busy === p.id}
                          onClick={() => { setReopening({ id: p.id, name: p.name }); setReason(''); }}>
                          <Unlock size={13} /> Reopen…
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </StateBox>
      {reopening && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2" data-testid="reopen-form">
          <p className="text-sm font-medium text-amber-900">Reopen {reopening.name} — needs the Owner&apos;s approval and a reason.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} aria-label="Reason"
            placeholder="Why the month must be reopened (at least 5 characters)"
            className="w-full text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white" />
          <div className="flex gap-2">
            <button type="button" className={btnPrimary} disabled={reason.trim().length < 5 || busy === reopening.id} onClick={reopen}>Reopen</button>
            <button type="button" className={btnSecondary} onClick={() => setReopening(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
