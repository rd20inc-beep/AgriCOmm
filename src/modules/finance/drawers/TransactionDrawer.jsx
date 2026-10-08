import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Paperclip, FileText, Undo2, CheckCircle, Landmark } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import StatusBadge from '../../../shared/components/StatusBadge';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import useConfirm from '../../../hooks/useConfirm';
import { useBankAccounts, useClearCheque, useReversePayment } from '../../../api/queries';
import { accountsForMethod, METHOD_LABEL } from '../../../components/payments/paymentPayload';
import { invalidateMoney } from '../../../components/payments/invalidateMoney';
import { ClearChequeDialog } from '../pages/DueDates';
import { fmtDate, fmtDateTime } from '../../../shared/utils/format';
import { useFinanceDrawers } from './drawersContext';
import { Section, Row, LinkButton, DrawerActions } from './drawerParts';
import { fmtAmt, btnSecondary, btnDanger, btnPrimary, transactionActions, transactionKey } from './drawerLogic';
import { useTransactionDetail } from './drawerHooks';




const DOC_KIND = { receivable: 'receivable', payable: 'payable', local_sale: 'local_sale', expense: 'expense' };

/**
 * One money movement, both sides: the payment, the bank rows it wrote and the
 * journals it posted; who recorded / confirmed / reversed it; its document,
 * party and account (each opens its own drawer). Reverse, Clear cheque and
 * Attach document are shown only to a role the server lets do them, and only
 * when the movement can take them. A contra / fund-transfer row opens the
 * transfer's own drawer instead.
 */
export default function TransactionDrawer({ txKind, id, onClose }) {
  const { data, isLoading, isError } = useTransactionDetail(txKind, id);
  const drawers = useFinanceDrawers();
  const { hasPermission } = useAuth();
  const { addToast } = useApp();
  const qc = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  const reverseMut = useReversePayment();
  const clearMut = useClearCheque();
  const { data: allAccounts = [] } = useBankAccounts();
  const [clearing, setClearing] = useState(null);
  const [uploading, setUploading] = useState(false);

  // A transfer row belongs to the transfer drawer.
  useEffect(() => {
    if (data?.kind === 'fund_transfer' && drawers) drawers.replace({ kind: 'fundTransfer', id: data.fund_transfer_id });
  }, [data, drawers]);

  const p = data?.payment;
  const bt = data?.bank_transaction;
  const acts = transactionActions(data, hasPermission);
  const refresh = () => { invalidateMoney(qc); qc.invalidateQueries({ queryKey: transactionKey(txKind, id) }); };

  async function reverse() {
    const ok = await confirm({
      title: `Reverse ${p.type === 'receipt' ? 'receipt' : 'payment'} ${p.payment_no}?`,
      consequence: p.type === 'receipt'
        ? 'The receivable goes back to outstanding, the money comes out of the account it landed in, and the ledger entries are reversed. The receipt stays on record as Reversed.'
        : 'The payable goes back to outstanding, the account balance is restored, and the ledger entries are reversed. The payment stays on record as Reversed.',
      amount: fmtAmt(p.amount, p.currency),
      reason: 'required',
      confirmLabel: 'Reverse',
      cancelLabel: 'Go back',
    });
    if (!ok) return;
    try {
      await reverseMut.mutateAsync({ id: p.id, reason: ok.reason || null });
      addToast?.(`${p.payment_no} reversed`, 'success');
      refresh();
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Reversal failed', 'error');
    }
  }

  async function onClearConfirm(accountId) {
    try {
      await clearMut.mutateAsync({ id: p.id, data: { bank_account_id: parseInt(accountId, 10) } });
      addToast?.(`Cheque cleared — ${fmtAmt(p.amount, p.currency)} settled and posted`, 'success');
      setClearing(null);
      refresh();
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Failed to clear cheque', 'error');
    }
  }

  async function onAttach(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api.upload('/api/finance/payments/attachment', fd);
      const d = up?.data || up;
      if (!d?.url) throw new Error(up?._offlineQueued ? 'Offline — attach the document once the connection returns.' : 'Upload failed');
      await api.put(`/api/finance/payments/${p.id}/attachment`, { attachment_url: d.url, attachment_name: d.name || file.name });
      addToast?.('Document attached', 'success');
      refresh();
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Could not attach the document', 'error');
    } finally { setUploading(false); }
  }

  const openAttachment = () => api.open(`/api/finance/payments/attachment/${encodeURIComponent(p.attachment_url)}`, p.attachment_name);

  const isIn = p ? p.type === 'receipt' : bt?.type === 'credit';
  const title = p?.payment_no || bt?.transaction_no || 'Transaction';
  const subtitle = p ? `${p.type === 'receipt' ? 'Money in' : 'Money out'} · ${fmtDate(p.payment_date)}`
    : bt ? `${bt.type === 'credit' ? 'Money in' : 'Money out'} · ${fmtDate(bt.transaction_date)}` : undefined;

  const footer = p && (acts.reverse || acts.clear) ? (
    <DrawerActions>
      {acts.clear && (
        <button type="button" className={btnPrimary} disabled={clearMut.isPending} data-action="clear-cheque"
          onClick={() => setClearing({ paymentId: p.id, paymentNo: p.payment_no, reference: p.bank_reference, amount: p.amount, currency: p.currency, bankAccountId: p.bank_account_id, party: data.party?.name, partyType: p.type === 'receipt' ? 'customer' : 'supplier' })}>
          <CheckCircle size={14} /> Clear cheque
        </button>
      )}
      {acts.reverse && (
        <button type="button" className={btnDanger} disabled={reverseMut.isPending} onClick={reverse} data-action="reverse">
          <Undo2 size={14} /> Reverse
        </button>
      )}
    </DrawerActions>
  ) : null;

  return (
    <SlideDrawer open onClose={onClose} title={title} subtitle={subtitle} icon={isIn ? ArrowDownLeft : ArrowUpRight} size="lg" footer={footer}>
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p>
        : isError || !data ? <p className="text-sm text-red-600">This transaction could not be loaded.</p>
        : data.kind === 'fund_transfer' ? <p className="text-sm text-gray-400">Opening the transfer…</p>
        : (
          <div className="space-y-5" data-testid="transaction-drawer">
            {/* The amount, in its own currency */}
            <div className={`rounded-lg p-3 text-center ${isIn ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <p className="text-xs text-gray-500">{isIn ? 'Received' : 'Paid'}</p>
              <p className={`text-2xl font-bold tabular-nums ${isIn ? 'text-emerald-700' : 'text-red-700'}`}>{fmtAmt(p ? p.amount : bt.amount, p ? p.currency : bt.currency)}</p>
              {p && p.currency !== 'PKR' && p.base_amount_pkr > 0 && (
                <p className="text-[11px] text-gray-500">Booked at {p.fx_rate} · {fmtAmt(p.base_amount_pkr, 'PKR')} in the PKR ledger</p>
              )}
              <div className="mt-1.5 flex justify-center gap-1.5">
                <StatusBadge status={p ? p.status : (bt.status || 'posted')} />
                {p?.payment_method === 'cheque' && <StatusBadge status={p.cleared ? 'Cleared' : 'Uncleared'} />}
              </div>
            </div>

            {p && (
              <Section title="Details">
                <div>
                  <Row label="Date">{fmtDate(p.payment_date)}</Row>
                  <Row label="Method">{METHOD_LABEL[p.payment_method] || p.payment_method}</Row>
                  <Row label={isIn ? 'Into' : 'From'}>
                    {p.account ? (drawers?.openAccount
                      ? <LinkButton onClick={() => drawers.openAccount({ id: p.account.id })}>{p.account.name}{p.account.bank_name ? ` · ${p.account.bank_name}` : ''}</LinkButton>
                      : `${p.account.name}`) : (p.payment_method === 'cheque' && !p.cleared ? 'Chosen when the cheque clears' : '—')}
                  </Row>
                  {p.bank_reference && <Row label={p.payment_method === 'cheque' ? 'Cheque #' : 'Reference'}>{p.bank_reference}</Row>}
                  {p.payment_method === 'cheque' && <Row label="Cheque clears on">{fmtDate(p.due_date)}</Row>}
                  {p.wht_amount > 0 && <Row label={`WHT${p.wht_rate ? ` (${p.wht_rate}%)` : ''}`}>{fmtAmt(p.wht_amount, p.currency)}</Row>}
                  {p.discount_amount > 0 && <Row label="Discount">{fmtAmt(p.discount_amount, p.currency)}</Row>}
                  {p.notes && <Row label="Notes">{p.notes}</Row>}
                </div>
              </Section>
            )}

            {bt && !p && (
              <Section title="Details">
                <div>
                  <Row label="Date">{fmtDate(bt.transaction_date)}</Row>
                  <Row label="Account">{drawers?.openAccount ? <LinkButton onClick={() => drawers.openAccount({ id: bt.bank_account_id })}>{bt.account_name}</LinkButton> : bt.account_name}</Row>
                  {bt.reference && <Row label="Reference">{bt.reference}</Row>}
                  {bt.counterparty && <Row label="Counterparty">{bt.counterparty}</Row>}
                  {bt.category && <Row label="Kind"><span className="capitalize">{String(bt.category).replace(/_/g, ' ')}</span></Row>}
                  {bt.notes && <Row label="Notes">{bt.notes}</Row>}
                  <Row label="Recorded">{bt.created_by_name ? `${bt.created_by_name} · ` : ''}{fmtDateTime(bt.created_at)}</Row>
                </div>
              </Section>
            )}

            {p && (data.document || data.party) && (
              <Section title="Against">
                <div>
                  {data.document && (
                    <Row label="Document">
                      {DOC_KIND[data.document.kind] && drawers?.openDocument
                        ? <LinkButton onClick={() => drawers.openDocument({ docKind: DOC_KIND[data.document.kind], id: data.document.id })}>{data.document.ref}</LinkButton>
                        : data.document.href ? <Link to={data.document.href} className="text-blue-600 hover:underline">{data.document.ref}</Link>
                        : data.document.ref}
                      {data.document.order_no && data.document.order_id && (
                        <span className="block text-[11px]"><Link to={`/export/${data.document.order_id}`} className="text-blue-600 hover:underline">{data.document.order_no}</Link></span>
                      )}
                    </Row>
                  )}
                  {data.party && (
                    <Row label={data.party.type === 'customer' ? 'Customer' : data.party.type === 'hauler' ? 'Transporter' : 'Supplier'}>
                      {data.party.id && drawers?.openParty && ['customer', 'supplier'].includes(data.party.type)
                        ? <LinkButton onClick={() => drawers.openParty(data.party)}>{data.party.name}</LinkButton>
                        : data.party.name || '—'}
                    </Row>
                  )}
                </div>
              </Section>
            )}

            {p && (
              <Section title="Audit">
                <div>
                  <Row label="Recorded by">{p.created_by_name || '—'} · {fmtDateTime(p.created_at)}</Row>
                  {p.confirmed_by_name && <Row label="Confirmed by">{p.confirmed_by_name}{p.confirmed_at ? ` · ${fmtDateTime(p.confirmed_at)}` : ''}</Row>}
                  {p.status === 'Reversed' && (
                    <Row label="Reversed">{p.reversed_by_name || '—'}{p.reversed_at ? ` · ${fmtDateTime(p.reversed_at)}` : ''}{p.reversal_reason ? ` — ${p.reversal_reason}` : ''}</Row>
                  )}
                  {p.reject_reason && <Row label="Rejected">{p.reject_reason}</Row>}
                </div>
              </Section>
            )}

            {p && (
              <Section title="Supporting document">
                {p.attachment_url ? (
                  <button type="button" onClick={openAttachment} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                    <FileText size={14} /> {p.attachment_name || 'Open document'}
                  </button>
                ) : acts.attach ? (
                  <label className={`${btnSecondary} cursor-pointer`} data-action="attach">
                    <Paperclip size={14} /> {uploading ? 'Uploading…' : 'Attach document'}
                    <input type="file" className="hidden" onChange={onAttach} disabled={uploading} />
                  </label>
                ) : <p className="text-xs text-gray-400">None attached.</p>}
              </Section>
            )}

            {p && (
              <Section title="Bank side">
                {data.bank_transactions?.length ? (
                  <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
                    {data.bank_transactions.map((b) => (
                      <div key={b.id} className={`flex items-center justify-between px-3 py-2 ${data.focus_bank_transaction_id === b.id ? 'bg-blue-50' : ''}`}>
                        <span className="min-w-0 truncate"><Landmark size={12} className="inline mr-1 text-gray-400" />{b.account_name} · {b.transaction_no} · {fmtDate(b.transaction_date)}</span>
                        <span className={`tabular-nums font-medium ${b.type === 'credit' ? 'text-emerald-700' : 'text-red-700'}`}>{b.type === 'credit' ? '+' : '−'}{fmtAmt(b.amount, b.currency)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-gray-400">{p.payment_method === 'cheque' && !p.cleared ? 'No money has moved — the cheque has not cleared.' : 'No bank movement recorded.'}</p>}
              </Section>
            )}

            <Section title="Ledger">
              {data.journals?.length ? data.journals.map((j) => (
                <div key={j.id} className="rounded-lg border border-gray-200 text-xs">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                    <span className="font-medium text-gray-700">{j.journal_no} · {j.ref_type}{j.ref_no ? ` ${j.ref_no}` : ''}</span>
                    <StatusBadge status={j.status} />
                  </div>
                  <table className="w-full">
                    <tbody>
                      {j.lines.map((l) => (
                        <tr key={l.id} className="border-t border-gray-50">
                          <td className="px-3 py-1 text-gray-700">{l.account_code} {l.account_name}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{l.debit ? fmtAmt(l.debit, 'PKR') : ''}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{l.credit ? fmtAmt(l.credit, 'PKR') : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )) : <p className="text-xs text-gray-400">{p?.payment_method === 'cheque' && !p?.cleared ? 'Nothing is posted until the cheque clears.' : p && ['Pending Finance Confirmation', 'Rejected'].includes(p.status) ? 'Nothing is posted until Finance confirms it.' : 'No journal found for this movement.'}</p>}
            </Section>

            {acts.reverseBlockedReason && p.status !== 'Reversed' && hasPermission('finance', 'confirm_payment') && (
              <p className="text-[11px] text-gray-500" data-testid="reverse-blocked">{acts.reverseBlockedReason}</p>
            )}
          </div>
        )}
      {clearing && (
        <ClearChequeDialog key={clearing.paymentId} item={clearing} accounts={accountsForMethod(allAccounts, 'cheque')}
          busy={clearMut.isPending} onCancel={() => setClearing(null)} onConfirm={onClearConfirm} />
      )}
      {confirmDialog}
    </SlideDrawer>
  );
}
