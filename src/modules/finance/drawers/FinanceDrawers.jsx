import { lazy, Suspense, useCallback, useContext, useMemo, useReducer } from 'react';
import { useAuth } from '../../../context/AuthContext';
import { drawerStack } from './drawerStack';
import { DrawersContext } from './drawersContext';

/**
 * The Finance drawers — Transaction, Document, Party, Account, the Payment
 * form, the payment picker, Transfer (the contra drawer), the fund-transfer
 * detail and New expense — opened from anywhere with one call:
 *
 *   const drawers = useFinanceDrawers();          // null outside a provider
 *   drawers?.openParty({ type: 'customer', id, name });
 *   drawers?.openTransaction('payment', 42);
 *   drawers?.openDocument({ docKind: 'payable', row });
 *   drawers?.openPayment({ docKind: 'receivable', row });
 *
 * Drawers stack: a Payment form opened from a Document drawer closes back to
 * the document. Only the top one is shown. The provider is idempotent — a
 * nested one passes through to the outer one — so a screen that may render
 * outside the main layout (an export order under the Export shell) can wrap
 * itself without opening a second stack.
 *
 * What the user may open mirrors the read routes: the transaction, document,
 * party and account drawers read /api/finance (finance.view), so without it
 * those openers are null and callers fall back to their plain link.
 */

const TransactionDrawer = lazy(() => import('./TransactionDrawer'));
const DocumentDrawer = lazy(() => import('./DocumentDrawer'));
const PartyDrawer = lazy(() => import('./PartyDrawer'));
const AccountDrawer = lazy(() => import('./AccountDrawer'));
const PaymentPickerDrawer = lazy(() => import('./PaymentPickerDrawer'));
const PaymentFormDrawer = lazy(() => import('../../../components/payments/PaymentFormDrawer'));
const ContraTransferDrawer = lazy(() => import('../components/ContraTransferDrawer'));
const FundTransferDetailDrawer = lazy(() => import('../components/FundTransferDetailDrawer'));
const ExpenseCreateDrawer = lazy(() => import('../components/ExpenseCreateDrawer'));
const StatementPayDrawer = lazy(() => import('../components/StatementPayDrawer'));

export function FinanceDrawersProvider({ children }) {
  const outer = useContext(DrawersContext);
  if (outer) return children;
  return <DrawerHost>{children}</DrawerHost>;
}

function DrawerHost({ children }) {
  const { hasPermission, user } = useAuth();
  const [stack, dispatch] = useReducer(drawerStack, []);
  const canView = hasPermission('finance', 'view');

  const open = useCallback((drawer) => dispatch({ type: 'open', drawer }), []);
  const replace = useCallback((drawer) => dispatch({ type: 'replace', drawer }), []);
  const close = useCallback(() => dispatch({ type: 'close' }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  const api = useMemo(() => ({
    open, replace, close, reset,
    canView,
    openTransaction: canView ? (txKind, id) => open({ kind: 'transaction', txKind, id }) : null,
    openDocument: canView ? (doc) => open({ kind: 'document', doc }) : null,
    openParty: canView ? (party) => party?.id && ['customer', 'supplier'].includes(party.type) && open({ kind: 'party', party }) : null,
    openAccount: canView ? (account) => open({ kind: 'account', account }) : null,
    openFundTransfer: canView ? (id) => open({ kind: 'fundTransfer', id }) : null,
    // The forms check their own permission (the route guard, mirrored).
    openPayment: (doc, extra = {}) => open({ kind: 'payment', doc, ...extra }),
    openPicker: (mode, party = null) => open({ kind: 'picker', mode, party }),
    openTransfer: (fromAccountId = null) => open({ kind: 'transfer', fromAccountId }),
    openExpense: () => open({ kind: 'expense' }),
    openStatementPay: (mode, party) => open({ kind: 'statementPay', mode, party }),
  }), [open, replace, close, reset, canView]);

  const top = stack[stack.length - 1] || null;
  // Owner / Super Admin may reverse or edit a transfer (the server's own check).
  const canManageTransfer = user?.role === 'Owner' || user?.role === 'Super Admin';

  return (
    <DrawersContext.Provider value={api}>
      {children}
      {top && (
        <Suspense fallback={null}>
          <ActiveDrawer key={stack.length} d={top} api={api} canManageTransfer={canManageTransfer} />
        </Suspense>
      )}
    </DrawersContext.Provider>
  );
}

function ActiveDrawer({ d, api, canManageTransfer }) {
  const onClose = api.close;
  switch (d.kind) {
    case 'transaction': return <TransactionDrawer txKind={d.txKind} id={d.id} onClose={onClose} />;
    case 'document': return <DocumentDrawer doc={d.doc} onClose={onClose} />;
    case 'party': return <PartyDrawer party={d.party} onClose={onClose} />;
    case 'account': return <AccountDrawer account={d.account} onClose={onClose} />;
    case 'picker': return <PaymentPickerDrawer mode={d.mode} party={d.party} onClose={onClose} />;
    case 'payment': return <PaymentFormDrawer doc={d.doc} variant={d.variant} ctx={d.ctx} onClose={onClose} onDone={d.onDone} />;
    case 'transfer': return <ContraTransferDrawer open fromAccountId={d.fromAccountId} onClose={onClose} />;
    case 'fundTransfer':
      return (
        <FundTransferDetailDrawer open transferId={d.id} canManage={canManageTransfer} onClose={onClose}
          onNavigate={(id) => api.replace({ kind: 'fundTransfer', id })} />
      );
    case 'expense': return <ExpenseCreateDrawer open onClose={onClose} />;
    case 'statementPay': return <StatementPayDrawer mode={d.mode} party={d.party} onClose={onClose} />;
    default: return null;
  }
}
