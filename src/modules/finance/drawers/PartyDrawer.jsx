import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Users, Truck, ArrowDownLeft, ArrowUpRight, BookOpen } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import StatusBadge from '../../../shared/components/StatusBadge';
import { useAuth } from '../../../context/AuthContext';
import { useReceivables, usePayables } from '../../../api/queries';
import { accountingApi } from '../../accounting/api/services';
import { isSettleable, canRecordVariant, contextForDocument } from '../../../components/payments/paymentVariants';
import { fmtDate } from '../../../shared/utils/format';
import { useFinanceDrawers } from './drawersContext';
import { Section, Row, PerCurrency, DrawerActions } from './drawerParts';
import { fmtAmt, btnPrimary, btnSecondary, partyOpenItems } from './drawerLogic';
import { btnRowSecondary } from '../utils/uiClasses';
import { receivablesPkrEquiv, pkrEquivText } from '../utils/currencyTiles';
import { PkrEquivLine } from '../components/FinanceUI';

// A statement line that is a payment carries the payment number.
const PAYMENT_NO = /^PAY-/i;


/**
 * A customer or supplier at a glance: what is open, per currency (never added
 * across currencies), the open items (each opens its Document drawer, with
 * Receive / Pay), the last ledger lines, and the full statement. Receive /
 * Pay across the open items is the statement's own FIFO allocator.
 */
export default function PartyDrawer({ party, onClose }) {
  const drawers = useFinanceDrawers();
  const { hasPermission } = useAuth();
  const isCustomer = party?.type === 'customer';
  const { data: receivables = [], isLoading: rl } = useReceivables({ customer_id: party?.id }, { enabled: isCustomer && !!party?.id });
  const { data: payables = [], isLoading: pl } = usePayables({ supplier_id: party?.id }, { enabled: !isCustomer && !!party?.id });
  const { items, totals, equivText } = useMemo(() => {
    const rows = isCustomer ? receivables.filter((r) => String(r.customerId) === String(party?.id))
      : payables.filter((r) => String(r.supplierId) === String(party?.id));
    const open = partyOpenItems(party?.type, rows);
    // C5: ≈ PKR equivalent of the open items, each at its own booked rate.
    const fallbackCur = isCustomer ? 'USD' : 'PKR';
    const eq = receivablesPkrEquiv(open.items.map((i) => ({ ...i.row, currency: i.row.currency || fallbackCur })), 'outstanding');
    return { ...open, equivText: pkrEquivText(eq) };
  }, [isCustomer, receivables, payables, party?.type, party?.id]);

  const { data: statement, isLoading: sl } = useQuery({
    queryKey: ['party-statement', party?.type, String(party?.id), 'drawer'],
    enabled: !!party?.id,
    queryFn: async () => {
      const fn = isCustomer ? accountingApi.customerStatement : accountingApi.supplierStatement;
      const res = await fn(party.id, {});
      return res?.data ?? res;
    },
  });
  const recent = (statement?.transactions || []).slice(-8).reverse();
  // Receiving / paying a party's balance records one payment per open
  // invoice (recordPayment), so it asks what recordPayment's route asks.
  const canAllocate = hasPermission('finance', 'confirm_payment') || hasPermission('milling', 'edit');
  const settleableItems = items.filter((d) => isSettleable(d));
  const statementHref = `/finance/accounting/statements?type=${isCustomer ? 'customer' : 'supplier'}&id=${party?.id}`;

  const footer = (
    <DrawerActions>
      <Link to={statementHref} onClick={onClose} className={btnSecondary} data-action="statement"><BookOpen size={14} aria-hidden="true" /> Full statement</Link>
      {canAllocate && settleableItems.length > 0 && (
        <button type="button" className={btnPrimary} data-action={isCustomer ? 'receive' : 'pay'}
          onClick={() => (settleableItems.length === 1
            ? drawers?.openPayment(settleableItems[0])
            : drawers?.openStatementPay(isCustomer ? 'customer' : 'supplier', { id: party.id, name: party.name }))}>
          {isCustomer ? <><ArrowDownLeft size={14} /> Receive</> : <><ArrowUpRight size={14} /> Pay</>}
        </button>
      )}
    </DrawerActions>
  );

  return (
    <SlideDrawer open onClose={onClose} title={party?.name || (isCustomer ? 'Customer' : 'Supplier')}
      subtitle={isCustomer ? 'Customer' : 'Supplier'} icon={isCustomer ? Users : Truck} size="lg" footer={footer}>
      <div className="space-y-5" data-testid="party-drawer">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{isCustomer ? 'They owe (open items)' : 'We owe (open items)'}</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums">{rl || pl ? '…' : <PerCurrency totals={totals} empty="Nothing open" />}</p>
          {!(rl || pl) && <PkrEquivLine text={equivText} className="mt-0.5" />}
          {statement && (
            <p className="text-xs text-gray-500 mt-1">
              Ledger balance (PKR books): {fmtAmt(statement.closing_balance, 'PKR')}
            </p>
          )}
        </div>

        <Section title={`Open items (${items.length})`}>
          {!items.length ? <p className="text-xs text-gray-400">Nothing open.</p> : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm" data-testid="party-open-items">
              {items.map((d) => {
                const r = d.row;
                const ctx = contextForDocument(d);
                const allowed = isSettleable(d) && canRecordVariant(ctx?.variant, hasPermission);
                return (
                  <div key={`${d.docKind}-${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <button type="button" onClick={() => drawers?.openDocument(d)} className="min-w-0 text-left">
                      <span className="block font-medium text-blue-600 hover:underline truncate">{r.recvNo || r.payNo}</span>
                      <span className="block text-xs text-gray-500">{r.type || r.category}{r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ''}</span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                      <StatusBadge status={r.status} />
                      <span className="tabular-nums font-medium">{fmtAmt(r.outstanding, ctx?.currency || r.currency)}</span>
                      {allowed && (
                        <button type="button" onClick={() => drawers?.openPayment(d)} data-action="item-settle" className={btnRowSecondary}>
                          {isCustomer ? 'Receive' : 'Pay'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Recent ledger lines">
          {sl ? <p className="text-xs text-gray-400">Loading…</p> : !recent.length ? <p className="text-xs text-gray-400">No posted entries.</p> : (
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
              {recent.map((t, i) => {
                const body = (
                  <>
                    <span className="min-w-0 truncate text-gray-600">{fmtDate(t.date)} · {t.vch_type || ''} {t.ref_no || t.journal_no}</span>
                    <span className="tabular-nums">{t.debit ? `Dr ${fmtAmt(t.debit, 'PKR')}` : `Cr ${fmtAmt(t.credit, 'PKR')}`}</span>
                  </>
                );
                return PAYMENT_NO.test(String(t.ref_no || '')) && drawers?.openTransaction ? (
                  <button key={i} type="button" onClick={() => drawers.openTransaction('payment', t.ref_no)} className="w-full flex items-center justify-between gap-2 px-3 py-2 min-h-10 hover:bg-blue-50 text-left focus-visible:outline-none focus-visible:bg-blue-50">{body}</button>
                ) : <div key={i} className="flex items-center justify-between px-3 py-1.5">{body}</div>;
              })}
            </div>
          )}
        </Section>

        {isCustomer && (statement?.open_items || []).length > 0 && (
          <Section title="Orders awaiting money">
            <div>
              {statement.open_items.map((o) => (
                <Row key={o.ref} label={`${o.label}${o.order_no ? ` · ${o.order_no}` : ''}`}>{fmtAmt(o.outstanding, o.currency)}</Row>
              ))}
            </div>
          </Section>
        )}
      </div>
    </SlideDrawer>
  );
}
