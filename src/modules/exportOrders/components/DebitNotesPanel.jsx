import React, { useMemo, useState } from 'react';
import { FileWarning, Plus, Loader2, Ban } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import useConfirm from '../../../hooks/useConfirm';
import { useDebitNotes, useIssueDebitNote, useCancelDebitNote } from '../../../api/queries';
import { todayLocalISO, fmtMoney, fmtNum, fmtDate } from '../../../shared/utils/format';

// Freight escalation debit notes.
//
// The clause on the Proforma and the Sales Contract promises the buyer that a
// rise in ocean freight between the date the rate was quoted and the date of the
// Bill of Lading is invoiced by debit note, "payable together with the balance
// of the contract value". This is where that note is raised — and the claim
// lands on the order's balance, exactly as the clause says, so the buyer wires
// one amount and the usual balance confirmation clears it.

const num = (v) => Number(parseFloat(v) || 0);
const money = (v, cur) => (cur ? fmtMoney(num(v), cur, { decimals: 2 }) : fmtNum(num(v), 2));

const BASES = [
  { code: 'freight_escalation', label: 'Freight escalation' },
  { code: 'surcharge', label: 'Carrier surcharge (BAF / war-risk / congestion)' },
  { code: 'insurance', label: 'Marine insurance' },
  { code: 'other', label: 'Other' },
];

const inputCls = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none';

export default function DebitNotesPanel({ order, addToast, canIssue = true }) {
  const orderId = order?.dbId || order?.id;
  const { data: notes = [], isLoading } = useDebitNotes(orderId);
  const issue = useIssueDebitNote();
  const cancel = useCancelDebitNote();
  const [open, setOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const currency = order?.currency || 'USD';
  const blank = {
    basis: 'freight_escalation',
    old_rate_per_mt: order?.freightPerMT ?? '',
    new_rate_per_mt: '',
    amount: '',
    issue_date: todayLocalISO(),
    reason: '',
  };
  const [form, setForm] = useState(blank);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const qtyMT = num(order?.qtyMT);
  // The working the buyer will check: the rise per ton times the tons shipped.
  const derived = useMemo(() => {
    const oldR = parseFloat(form.old_rate_per_mt);
    const newR = parseFloat(form.new_rate_per_mt);
    if (!Number.isFinite(oldR) || !Number.isFinite(newR) || qtyMT <= 0) return null;
    return Math.round((newR - oldR) * qtyMT * 100) / 100;
  }, [form.old_rate_per_mt, form.new_rate_per_mt, qtyMT]);

  const typed = form.amount === '' ? null : num(form.amount);
  const claim = typed != null ? typed : derived;
  const canSave = claim != null && claim > 0 && !issue.isPending;

  const issued = notes.filter((n) => n.status === 'Issued');
  const totalIssued = issued.reduce((s, n) => s + num(n.amount), 0);

  async function save() {
    try {
      const payload = {
        basis: form.basis,
        issue_date: form.issue_date || null,
        reason: form.reason || null,
        // Send the rates when they are what produced the figure, so the note can
        // print the working; send the amount when it was typed over the top.
        ...(typed != null
          ? { amount: typed }
          : { old_rate_per_mt: form.old_rate_per_mt, new_rate_per_mt: form.new_rate_per_mt, qty_mt: qtyMT }),
      };
      const res = await issue.mutateAsync({ id: orderId, data: payload });
      addToast?.(`${res?.data?.debit_note_no || 'Debit note'} raised — added to the balance`, 'success');
      setForm(blank);
      setOpen(false);
    } catch (err) {
      addToast?.(err?.data?.errors?.[0]?.message || err?.data?.message || err.message || 'Failed to raise the debit note', 'error');
    }
  }

  async function doCancel(note) {
    const ok = await confirm({
      title: `Cancel ${note.debit_note_no}?`,
      consequence: 'The claim is withdrawn, taken off the order balance, and reversed in the ledger by a signed delta journal.',
      amount: money(note.amount, note.currency),
      reason: 'optional',
      confirmLabel: 'Cancel debit note',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await cancel.mutateAsync({ id: orderId, noteId: note.id, data: { reason: ok.reason || null } });
      addToast?.(`${note.debit_note_no} cancelled`, 'success');
    } catch (err) {
      addToast?.(err?.data?.errors?.[0]?.message || err?.data?.message || err.message || 'Failed to cancel', 'error');
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide inline-flex items-center gap-1.5">
          <FileWarning className="w-4 h-4" /> Freight Debit Notes
        </h3>
        {canIssue && (
          <button onClick={() => { setForm(blank); setOpen(true); }}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Raise
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-500 leading-snug">
          None raised. If ocean freight rises between the date the rate was quoted and the
          Bill of Lading, the escalation clause lets you charge the difference — raising it
          here adds it to this order&rsquo;s balance and posts it to the ledger.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto mobile-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-gray-500">
                  <th className="py-1 pr-3">Note</th>
                  <th className="py-1 pr-3">Date</th>
                  <th className="py-1 pr-3">Basis</th>
                  <th className="py-1 pr-3 text-right">Amount</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id} className="border-t border-gray-100">
                    <td data-label="Note" className="py-1.5 pr-3 font-medium text-gray-900">{n.debit_note_no}</td>
                    <td data-label="Date" className="py-1.5 pr-3 text-gray-600">{fmtDate(n.issue_date)}</td>
                    <td data-label="Basis" className="py-1.5 pr-3 text-gray-600">
                      {(BASES.find((b) => b.code === n.basis) || {}).label || n.basis}
                      {num(n.new_rate_per_mt) > 0 && (
                        <span className="block text-[11px] text-gray-400">
                          {money(n.old_rate_per_mt, n.currency)} → {money(n.new_rate_per_mt, n.currency)}/MT × {num(n.qty_mt)} MT
                        </span>
                      )}
                    </td>
                    <td data-label="Amount" className={`py-1.5 pr-3 text-right font-medium ${n.status === 'Cancelled' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                      {money(n.amount, n.currency)}
                    </td>
                    <td data-label="Status" className="py-1.5 pr-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${n.status === 'Issued' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{n.status}</span>
                    </td>
                    <td className="py-1.5 text-right">
                      {canIssue && n.status === 'Issued' && (
                        <button onClick={() => doCancel(n)} disabled={cancel.isPending}
                          title="Withdraw this claim and reverse it in the ledger"
                          className="text-[11px] text-red-600 hover:text-red-700 inline-flex items-center gap-1 disabled:opacity-50">
                          <Ban className="w-3 h-3" /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 pt-2 border-t border-gray-100 text-xs text-gray-600">
            {issued.length} outstanding claim{issued.length === 1 ? '' : 's'} totalling{' '}
            <b className="text-gray-900">{money(totalIssued, currency)}</b> — already included in the balance above.
          </p>
        </>
      )}

      <SlideDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Raise a freight debit note"
        subtitle={`${order?.id || ''} · charged to ${order?.customerName || 'the buyer'}`}
        icon={FileWarning}
        size="lg"
        footer={(
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-gray-500">
              Claim: <span className="font-semibold text-gray-900">{claim != null ? money(claim, currency) : '—'}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={save} disabled={!canSave}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2">
                {issue.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Raise note
              </button>
            </div>
          </div>
        )}
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-600 leading-snug bg-amber-50 border border-amber-200 rounded-lg p-3">
            This charges the buyer for a freight increase they have already agreed to cover.
            It is added to this order&rsquo;s <b>balance</b>, so it is paid with the rest of the
            balance against documents, and it posts to the ledger as freight recovered.
          </p>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">What is being claimed</label>
            <select value={form.basis} onChange={(e) => set('basis', e.target.value)} className={inputCls}>
              {BASES.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rate contracted at ({currency}/MT)</label>
              <input type="number" min="0" step="0.01" value={form.old_rate_per_mt} onChange={(e) => set('old_rate_per_mt', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rate actually charged ({currency}/MT)</label>
              <input type="number" min="0" step="0.01" value={form.new_rate_per_mt} onChange={(e) => set('new_rate_per_mt', e.target.value)} className={inputCls} />
            </div>
          </div>
          {derived != null && (
            <p className={`text-[11px] leading-snug ${derived > 0 ? 'text-gray-500' : 'text-amber-700'}`}>
              {derived > 0
                ? `Works out at ${money(derived, currency)} over ${qtyMT} MT — the figure the buyer will check.`
                : 'The rate charged is not higher than the rate contracted, so there is nothing to claim. A debit note cannot reduce what the buyer owes.'}
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Amount ({currency}) <span className="font-normal text-gray-400">— leave blank to use the working above</span>
            </label>
            <input type="number" min="0" step="0.01" placeholder={derived != null && derived > 0 ? String(derived) : ''}
              value={form.amount} onChange={(e) => set('amount', e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Reason <span className="font-normal text-gray-400">— prints on the note the buyer receives</span>
            </label>
            <textarea rows={3} value={form.reason} onChange={(e) => set('reason', e.target.value)}
              placeholder="Carrier GRI and congestion surcharge, Karachi–Hamburg, applied 10-Oct-2026"
              className={inputCls} />
          </div>
        </div>
      </SlideDrawer>
      {confirmDialog}
    </div>
  );
}
