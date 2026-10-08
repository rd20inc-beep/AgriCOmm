import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import StatusBadge from '../../../shared/components/StatusBadge';
import SupplierPicker from '../../../components/SupplierPicker';
import TransactionDocument from '../../../components/TransactionDocument';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import { useReceivableReceipts, usePayablePayments, usePurchasePaymentTrail } from '../../../api/queries';
import { METHOD_LABEL } from '../../../components/payments/paymentPayload';
import { contextForDocument, isSettleable, canRecordVariant } from '../../../components/payments/paymentVariants';
import { isDerivedPayable, derivedPayableHint } from '../../../shared/utils/derivedPayables';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from './drawersContext';
import { Section, Row, LinkButton, DrawerActions, Figures } from './drawerParts';
import { MoreSection } from '../components/FinanceUI';
import { fmtAmt, btnPrimary, documentFigures } from './drawerLogic';
import { useDocumentRow } from './drawerHooks';




function useHistory(docKind, r) {
  const isLocal = docKind === 'local_sale' || r?.kind === 'local_sale';
  const recv = useReceivableReceipts(r?.id, isLocal ? 'local_sale_group' : 'export', !!r && (docKind === 'receivable' || docKind === 'local_sale'));
  const pay = usePayablePayments(r?.id, !!r && docKind === 'payable' && !isDerivedPayable(r));
  const trailSource = docKind === 'expense' ? 'expense' : docKind === 'purchase' ? r?.source : null;
  const trailId = docKind === 'expense' ? r?.id : docKind === 'purchase' ? r?.refId : null;
  const trail = usePurchasePaymentTrail(trailSource, trailId, !!r && !!trailSource);
  if (docKind === 'receivable' || docKind === 'local_sale') return { rows: recv.data?.payments || [], loading: recv.isLoading };
  if (docKind === 'payable') return { rows: pay.data?.payments || [], loading: pay.isLoading };
  return { rows: (trail.data?.payments || []).map((x) => ({ ...x, paymentDate: x.paymentDate || x.date, paymentMethod: x.paymentMethod || x.method, bankReference: x.bankReference || x.reference })), loading: trail.isLoading };
}

/**
 * A receivable, payable, expense or purchase: what it is, what is owed (in its
 * own currency), every payment against it (each opens the Transaction drawer),
 * and Receive / Pay through the Payment form, pre-filled. An expense can be
 * linked to its supplier here (finance.allocate_cost, as the route asks).
 */
export default function DocumentDrawer({ doc, onClose }) {
  const drawers = useFinanceDrawers();
  const { hasPermission } = useAuth();
  const { addToast, suppliersList, companyProfileData } = useApp() || {};
  const qc = useQueryClient();
  const row = useDocumentRow(doc);
  const docKind = doc?.docKind === 'receivable' && row?.kind === 'local_sale' ? 'local_sale' : doc?.docKind;
  const figures = documentFigures(docKind, row);
  const history = useHistory(docKind, row);
  const fullDoc = { docKind, row };
  const ctx = row ? contextForDocument(fullDoc) : null;
  const variant = ctx?.variant;
  const settleable = row ? isSettleable(fullDoc) : false;
  const canSettle = settleable && canRecordVariant(variant, hasPermission);
  const isIn = docKind === 'receivable' || docKind === 'local_sale';

  const linkSupplier = useMutation({
    mutationFn: ({ id, supplier_id }) => api.put(`/api/expenses/${id}/supplier`, { supplier_id }),
    onSuccess: () => { ['expenses', 'payables', 'statement', 'party-statement'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });

  const ref = row ? (row.recvNo || row.payNo || row.expense_no || row.ref || `#${row.id}`) : '…';
  const title = ref;
  const subtitle = row ? ({
    receivable: `${row.type || 'Receivable'} · ${row.customerName || ''}`,
    local_sale: `Local sale · ${row.customerName || ''}`,
    payable: `${row.category || 'Payable'} · ${row.supplierName || row.haulerName || ''}`,
    expense: `Expense · ${(row.category || '').replace(/_/g, ' ')}`,
    purchase: `Purchase · ${row.supplierName || ''}`,
  }[docKind] || '') : '';

  const party = ctx?.party;
  const orderHref = row?.orderId && hasPermission('export_orders', 'view') ? `/export/${row.orderId}` : null;

  const footer = row ? (
    <DrawerActions>
      {canSettle && (
        <button type="button" className={btnPrimary} data-action={isIn ? 'receive' : 'pay'}
          onClick={() => drawers?.openPayment(fullDoc)}>
          {isIn ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />} {isIn ? 'Receive' : 'Pay'}
        </button>
      )}
    </DrawerActions>
  ) : null;

  return (
    <SlideDrawer open onClose={onClose} title={title} subtitle={subtitle} icon={FileText} size="lg" footer={footer}>
      {!row ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-5" data-testid="document-drawer">
          <Figures items={[
            { label: 'Total', value: fmtAmt(figures.total, figures.currency) },
            { label: figures.settledLabel, value: fmtAmt(figures.settled, figures.currency), tone: 'positive' },
            { label: 'Outstanding', value: fmtAmt(figures.outstanding, figures.currency), tone: figures.outstanding > 0 ? 'negative' : undefined, testId: 'doc-outstanding' },
          ]} />

          <Section title="Details">
            <div>
              <Row label="Status"><StatusBadge status={figures.status} /></Row>
              <Row label="Currency">{figures.currency}</Row>
              {party?.name && (
                <Row label={party.type === 'customer' ? 'Customer' : party.type === 'hauler' ? 'Transporter' : party.type === 'vendor' ? 'Payee' : 'Supplier'}>
                  {party.id && drawers?.openParty && ['customer', 'supplier'].includes(party.type)
                    ? <LinkButton onClick={() => drawers.openParty(party)}>{party.name}</LinkButton> : party.name}
                </Row>
              )}
              {(row.dueDate || row.due_date) && <Row label="Due">{fmtDate(row.dueDate || row.due_date)}</Row>}
              {docKind === 'payable' && row.linkedRef && <Row label="Linked to">{row.linkedRef}</Row>}
              {docKind === 'expense' && (row.batch_no || row.order_no) && <Row label="Linked to">{row.batch_no || row.order_no}</Row>}
              {docKind === 'expense' && row.description && <Row label="Description">{row.description}</Row>}
              {orderHref && <Row label="Order"><Link to={orderHref} className="text-blue-600 hover:underline">Open order <span aria-hidden="true">→</span></Link></Row>}
              {docKind === 'purchase' && row.source === 'lot' && row.ref && hasPermission('inventory', 'view') && (
                <Row label="Lot"><Link to={`/lot-inventory/${row.ref}`} className="text-blue-600 hover:underline">{row.ref} →</Link></Row>
              )}
              {docKind === 'local_sale' && <Row label="Sale"><Link to="/local-sales" className="text-blue-600 hover:underline">Local sales →</Link></Row>}
            </div>
          </Section>

          {docKind === 'payable' && isDerivedPayable(row) && figures.outstanding > 0 && (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2" data-testid="derived-hint">{derivedPayableHint(row)}</p>
          )}
          {settleable && !canSettle && (
            <p className="text-xs text-gray-500" data-testid="settle-not-allowed">Your role can view this document but not {isIn ? 'receive' : 'pay'} against it.</p>
          )}

          {docKind === 'expense' && (
            <Section title="Supplier ledger">
              <p className="text-xs text-gray-500">{row.supplier_id ? (row.supplier_name_joined || 'Linked to a supplier') : 'Not on any supplier’s ledger.'}</p>
              {hasPermission('finance', 'allocate_cost') && (
                <div className={linkSupplier.isPending ? 'opacity-50 pointer-events-none' : ''} data-action="link-supplier">
                  <SupplierPicker value={row.supplier_id ? String(row.supplier_id) : ''} suppliers={suppliersList || []} addToast={addToast} clearable
                    placeholder="— No supplier (one-off payee) —"
                    onChange={async (picked) => {
                      const supplier_id = picked || null;
                      if (String(supplier_id ?? '') === String(row.supplier_id ?? '')) return;
                      try {
                        await linkSupplier.mutateAsync({ id: row.id, supplier_id });
                        addToast?.(supplier_id ? 'Linked — this expense now shows on that supplier’s ledger' : 'Unlinked from the supplier', 'success');
                      } catch (err) { addToast?.(err?.data?.message || err?.message || 'Failed to link the supplier', 'error'); }
                    }} />
                  <p className="text-[11px] text-gray-500 mt-1">Linking shows the bill and its payment on that supplier&rsquo;s statement. It does not change the amount, the accounts or the trial balance.</p>
                </div>
              )}
            </Section>
          )}

          <Section title={isIn ? 'Receipts' : 'Payments'}>
            {history.loading ? <p className="text-xs text-gray-500">Loading…</p>
              : !history.rows.length ? <p className="text-xs text-gray-500">None recorded yet.</p>
              : (
                <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs" data-testid="doc-history">
                  {history.rows.map((h, i) => {
                    const open = h.id && drawers?.openTransaction ? () => drawers.openTransaction('payment', h.id) : null;
                    const body = (
                      <>
                        <span className="min-w-0 truncate text-gray-600">{fmtDate(h.paymentDate)} · {h.paymentNo || METHOD_LABEL[h.paymentMethod] || h.paymentMethod || '—'}{h.accountName ? ` · ${h.accountName}` : ''}</span>
                        <span className={`tabular-nums font-medium ${h.status === 'Reversed' ? 'line-through text-gray-400' : 'text-emerald-700'}`}>{fmtAmt(h.amount, h.currency || figures.currency)}</span>
                      </>
                    );
                    return open ? (
                      <button key={h.id || i} type="button" onClick={open} className="w-full flex items-center justify-between gap-2 px-3 py-2 min-h-11 hover:bg-blue-50 text-left focus-visible:outline-none focus-visible:bg-blue-50">{body}</button>
                    ) : <div key={h.id || i} className="flex items-center justify-between px-3 py-2">{body}</div>;
                  })}
                </div>
              )}
          </Section>

          {(docKind === 'receivable' || docKind === 'local_sale' || docKind === 'payable') && (
            <MoreSection title={isIn ? 'Printable receipt' : 'Printable voucher'} summary="Preview, print or share">
              <TransactionDocument kind={isIn ? 'receipt' : 'voucher'} data={row} companyProfile={companyProfileData} />
            </MoreSection>
          )}
        </div>
      )}
    </SlideDrawer>
  );
}
