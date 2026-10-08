// Accounting › Rates — month-end FX revaluation (G-7).
// Preview → Post: open USD receivables (1110) and each USD account's GL are
// restated at the month's closing rate; the unrealised gain / loss posts to
// 6210 dated month-end and reverses itself on the 1st. A month already
// revalued is refused unless the user re-runs it (the old entry is netted by
// delta). Gated by finance.post_journal, like every journal.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { accountingApi } from '../../accounting/api/services';
import { useApp } from '../../../context/AppContext';
import { fmtDate, fmtNum, fmtPKR } from '../../../shared/utils/format';
import { btnPrimary, btnSecondary } from '../utils/uiClasses';

/** The month before today, as YYYY-MM — the usual one to close. Pure. */
export function lastMonth(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const signed = (n) => `${Number(n) >= 0 ? '+' : '−'}${fmtPKR(Math.abs(Number(n) || 0))}`;

export default function FxRevaluationPanel() {
  const { addToast } = useApp();
  const qc = useQueryClient();
  const [month, setMonth] = useState(lastMonth());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const { data: history } = useQuery({
    queryKey: ['fx-revaluations'],
    queryFn: () => accountingApi.fxRevaluations().then((r) => r?.data?.revaluations || []),
  });
  const rows = Array.isArray(history) ? history : [];

  async function runPreview() {
    setBusy(true); setAlreadyDone(false);
    try {
      const res = await accountingApi.fxRevaluationPreview({ month_end: month, currency: 'USD' });
      setPreview(res?.data || null);
    } catch (err) {
      setPreview(null);
      addToast(err.message, 'error');
    } finally { setBusy(false); }
  }

  async function post(rerun = false) {
    setBusy(true);
    try {
      await accountingApi.fxRevaluate({ month_end: month, currency: 'USD', rerun });
      addToast(`USD revaluation for ${month} posted — it reverses on the 1st.`, 'success');
      setPreview(null); setAlreadyDone(false);
      qc.invalidateQueries({ queryKey: ['fx-revaluations'] });
    } catch (err) {
      if (err.status === 409) setAlreadyDone(true);
      addToast(err.message, 'error');
    } finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-testid="fx-revaluation">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Scale size={15} aria-hidden="true" /> Revalue month (USD)</h2>
          <p className="text-xs text-gray-500">Open USD receivables and USD accounts at the month's closing rate → 6210, reversed on the 1st.</p>
        </div>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Month</span>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); setAlreadyDone(false); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
        </label>
        <button type="button" onClick={runPreview} disabled={busy || !month} data-action="fx-revaluation-preview" className={btnSecondary}>Preview</button>
      </div>

      {preview && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm space-y-2" data-testid="fx-revaluation-preview">
          <p className="text-gray-700">
            Closing rate <strong className="tabular-nums">{fmtNum(preview.rate, 2)}</strong> ({fmtDate(preview.rateDate)}) · posts on {fmtDate(preview.monthEnd)}, reverses {fmtDate(preview.nextFirst)}
          </p>
          <ul className="text-gray-700 space-y-0.5">
            <li>Open USD receivables {fmtNum(preview.arForeign, 2)} → <span className="tabular-nums">{signed(preview.arUnrealised)}</span></li>
            {(preview.banks || []).map((b) => (
              <li key={b.bank_account_id}>{b.name}: USD {fmtNum(b.native_balance, 2)} (book {fmtPKR(b.book_pkr)}) → <span className="tabular-nums">{signed(b.unrealised_pkr)}</span></li>
            ))}
          </ul>
          <p className="font-semibold text-gray-900">Unrealised {Number(preview.total) >= 0 ? 'gain' : 'loss'}: <span className="tabular-nums">{signed(preview.total)}</span></p>
          <div className="flex flex-wrap gap-2">
            {!alreadyDone && (
              <button type="button" onClick={() => post(false)} disabled={busy} data-action="fx-revaluation-post" className={btnPrimary}>Post revaluation</button>
            )}
            {alreadyDone && (
              <button type="button" onClick={() => post(true)} disabled={busy} data-action="fx-revaluation-rerun" className={btnPrimary}>Replace the earlier revaluation</button>
            )}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-xs mobile-cards">
          <thead><tr className="text-gray-500 text-left"><th className="py-1">Month end</th><th>Rate</th><th className="text-right">Unrealised</th><th>Status</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Month end" className="py-1">{fmtDate(r.month_end)}</td>
                <td data-label="Rate" className="tabular-nums">{fmtNum(r.rate, 2)}</td>
                <td data-label="Unrealised" className="text-right tabular-nums">{signed(r.total_unrealised_pkr)}</td>
                <td data-label="Status" className="capitalize">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
