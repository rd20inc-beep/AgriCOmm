import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Info, ShieldAlert } from 'lucide-react';
import api from '../../api/client';
import { useBankAccounts } from '../../api/queries';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import SlideDrawer from '../SlideDrawer';
import { invalidateMoney } from './invalidateMoney';
import PaymentDrawer from './PaymentDrawer';
import { money } from './paymentPayload';
import {
  variantConfig, paymentRequest, contextForDocument, canRecordVariant,
} from './paymentVariants';

/**
 * The Payment form — one component for every way money is received or paid
 * against a document. `doc` is a document as the finance lists carry it
 * ({ docKind, row }); the variant, the endpoint, the body and what the form
 * offers come from paymentVariants.js. What the context already knows (party,
 * document, currency, outstanding, the order's bank account, the collection
 * point) is shown at the top and pre-filled; the amount, method, account,
 * date and reference stay editable. The route guard is mirrored: a user who
 * cannot record this variant gets an explanation, not a form.
 *
 *   <PaymentFormDrawer doc={{ docKind: 'payable', row }} onClose={…} onDone={…} />
 *   <PaymentFormDrawer variant="receive_export" ctx={{ orderId, kind: 'advance', currency: 'USD', outstanding }} … />
 */
export default function PaymentFormDrawer({ doc, variant: variantIn, ctx: ctxIn, onClose, onDone, open = true }) {
  const ctx = ctxIn ? { ...ctxIn, variant: variantIn || ctxIn.variant } : contextForDocument(doc);
  const variant = variantIn || ctx?.variant;
  const cfg = variantConfig(variant);
  const { hasPermission } = useAuth();
  const { addToast } = useApp();
  const qc = useQueryClient();
  // A mill role that pays only through milling.edit reads (and may use) the
  // mill's own accounts; its cash defaults to Mill Cash.
  const millOnly = !hasPermission('finance', 'confirm_payment') && hasPermission('milling', 'edit');
  // The account list every payment screen reads (as AppContext does): the
  // finance list, or the mill's own for a role without finance.view. A
  // mill-only payer is offered only mill accounts (the server refuses others).
  const { data: allAccounts = [] } = useBankAccounts({ millOnly: !hasPermission('finance', 'view') });
  const accounts = millOnly ? allAccounts.filter((a) => String(a.entity || '').toLowerCase() === 'mill') : allAccounts;
  // What the endpoint answered — an export order's receivable recorded through
  // POST /finance/payments comes back pending Finance's confirmation.
  const lastResponse = useRef(null);

  if (!cfg || !ctx) return null;
  const isReceipt = cfg.side === 'receipt';
  const currency = ctx.currency || 'PKR';
  const title = cfg.title;
  const subtitle = [ctx.ref, ctx.party?.name].filter(Boolean).join(' · ');

  if (!canRecordVariant(variant, hasPermission)) {
    return (
      <SlideDrawer open={open} onClose={onClose} title={title} subtitle={subtitle} icon={ShieldAlert} size="md">
        <p className="text-sm text-gray-600" data-testid="payment-not-allowed">
          Your role can view this document but not record {isReceipt ? 'a receipt' : 'a payment'} against it.
        </p>
      </SlideDrawer>
    );
  }

  const req = paymentRequest(variant, ctx, { amount: 0, method: 'bank_transfer', date: '' });
  const taxes = cfg.taxes === 'pkr' ? currency === 'PKR' : !!cfg.taxes;
  // The document upload is its own route (finance.confirm_payment).
  const attach = !!cfg.attach && hasPermission('finance', 'confirm_payment');

  const summary = [
    ctx.party?.name ? [ctx.party.type === 'hauler' ? 'Transporter' : (isReceipt ? 'Customer' : 'Payee'), ctx.party.name] : null,
    ctx.ref ? ['Document', ctx.ref] : null,
    ['Currency', currency],
    ctx.outstanding != null ? ['Outstanding', money(ctx.outstanding, currency)] : null,
  ].filter(Boolean);

  const banner = cfg.pending ? (
    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="pending-note">
      <Info size={13} className="mt-0.5 shrink-0" />
      This records the receipt for Finance to confirm with the rate the bank applied. Nothing moves in the bank or the ledger until then.
    </p>
  ) : null;

  async function submit(body) {
    const res = await api[req.method](req.url, body);
    lastResponse.current = res;
    return res;
  }

  return (
    <PaymentDrawer
      open={open} onClose={onClose} addToast={addToast}
      title={title} subtitle={subtitle} icon={isReceipt ? ArrowDownLeft : ArrowUpRight} size="md"
      type={cfg.side} currency={currency} outstanding={ctx.outstanding ?? null}
      summary={summary} banner={banner}
      amountLabel={`${isReceipt ? 'Amount received' : 'Amount to pay'} (${currency}) *`}
      submitLabel={cfg.submit}
      methods={cfg.methods} cashLocation={!!cfg.cashLocation}
      extras={taxes || attach} taxes={taxes} attach={attach}
      defaultMethod={millOnly ? 'cash' : 'bank_transfer'}
      defaultNotes={ctx.notes || ''}
      initial={{ bankAccountId: ctx.bankAccountId ? String(ctx.bankAccountId) : undefined, fxRate: ctx.fxRate ? String(ctx.fxRate) : undefined, collectionLocation: ctx.collectionLocation }}
      requireAccountFor={cfg.accountRequired}
      accounts={accounts}
      formId={`payment-form-${variant}`}
      buildBody={(form) => paymentRequest(variant, ctx, form).body}
      renderExtra={cfg.fxEstimate && currency !== 'PKR' ? ({ form, set }) => (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="pay-fx">Rate estimate (1 {currency} = ? PKR)</label>
          <input id="pay-fx" type="number" step="0.0001" min="0" value={form.fxRate || ''} onChange={(e) => set('fxRate', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" placeholder="Optional" />
          <p className="text-[11px] text-gray-400 mt-1">Finance enters the rate the bank actually applied when it confirms.</p>
        </div>
      ) : null}
      onSubmit={submit}
      onDone={(form) => {
        invalidateMoney(qc);
        const amt = money(form.amount, currency);
        const res = lastResponse.current;
        const pending = cfg.pending || !!(res?.data?.pending_confirmation);
        addToast?.(res?._offlineQueued
          ? 'Offline — the payment will be recorded when the connection returns.'
          : pending
          ? `${amt} recorded — waiting for Finance to confirm`
          : `${amt} ${isReceipt ? 'received' : 'paid'}${ctx.ref ? ` — ${ctx.ref}` : ''}`, 'success');
        onDone?.(form);
        onClose?.();
      }}
    />
  );
}

