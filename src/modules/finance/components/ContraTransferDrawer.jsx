import { btnPrimary, btnSecondary } from '../utils/uiClasses';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Paperclip, FileText, X, AlertTriangle, Info } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import FieldError from '../../../shared/components/FieldError';
import api from '../../../api/client';
import { useBankAccounts, useCreateContraTransfer, useReplaceFundTransfer, useContraRate } from '../../../api/queries';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import { favStar } from '../../../shared/utils/favorites';
import { todayLocalISO, fmtMoney } from '../../../shared/utils/format';
import { useDefaultAccount } from '../../../shared/hooks/useDefaultAccount';
import {
  cur, ent, entityLabel, classifyTransfer, isCrossCurrency, foreignCurrency,
  convertAmount, rateFromConverted, validateContra, contraOverdraft, newClientRef, transferDefaults,
} from '../utils/contraTransfer';

const REQ = <span className="text-red-500">*</span>;
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900';
const lbl = 'block text-xs font-medium text-gray-600 mb-1';
const ENTITY_ORDER = { general: 0, mill: 1, export: 2 };

/**
 * Contra Transfer — move money between the company's OWN accounts
 * (Cash → Bank, Bank → Cash, Bank → Bank, USD → PKR …).
 *
 *   Same entity      → settles at once; no journal (every account is GL 1000).
 *   Head Office ⇄ Mill → becomes a fund transfer the receiving side accepts.
 *   Different currencies → exchange rate + converted amount; the FX difference
 *                       is NOT booked (flagged for review).
 *
 * `editing` (a transfer, camelCase) turns the drawer into Edit: the server
 * reverses the original and records this as its replacement, in one step.
 *
 * W08–W10 — this is the ONE transfer flow. `lockDirection="mill_to_ho"` (Mill
 * Finance › Send Funds to Head Office, formerly TransferFundsDrawer) narrows it
 * to Mill PKR accounts → Head Office PKR accounts and hides Head Office
 * balances; every transfer goes through the same validation, the same review
 * step and the same duplicate guard (client_ref). The source and destination
 * this user last used are offered again (useDefaultAccount), shown and
 * editable; nothing is sent before Confirm.
 */
export default function ContraTransferDrawer({ open, onClose, editing = null, onDone, fromAccountId = null, lockDirection = null }) {
  const { hasPermission } = useAuth();
  const { addToast } = useApp();
  const locked = lockDirection === 'mill_to_ho' || lockDirection === 'ho_to_mill';
  // A mill role that pays only through milling.edit may use only the mill's accounts.
  const millOnly = !hasPermission('finance', 'confirm_payment') && hasPermission('milling', 'edit');
  // Locked Mill → Head Office: the destination is a Head Office account, so the
  // finance list is read whenever the role may (as the old drawer did); its
  // Head Office balances are not shown.
  const { data: allAccounts = [] } = useBankAccounts({ millOnly: locked ? !hasPermission('finance', 'view') : millOnly });
  const createMut = useCreateContraTransfer();
  const replaceMut = useReplaceFundTransfer();
  const busy = createMut.isPending || replaceMut.isPending;

  const accounts = useMemo(
    () => allAccounts.filter((a) => a.isActive !== false && (locked || !millOnly || ent(a) === 'mill')),
    [allAccounts, millOnly, locked],
  );
  const { fromAccounts, toAccounts } = useMemo(() => {
    if (!locked) return { fromAccounts: accounts, toAccounts: accounts };
    const pkr = accounts.filter((a) => cur(a) === 'PKR');
    const mill = pkr.filter((a) => ent(a) === 'mill');
    const ho = pkr.filter((a) => ent(a) === 'general');
    return lockDirection === 'mill_to_ho' ? { fromAccounts: mill, toAccounts: ho } : { fromAccounts: ho, toAccounts: mill };
  }, [accounts, locked, lockDirection]);
  const hideToBalance = lockDirection === 'mill_to_ho';
  const fromGroups = useMemo(() => groupAccounts(fromAccounts), [fromAccounts]);
  const toGroups = useMemo(() => groupAccounts(toAccounts), [toAccounts]);
  const memoryEntity = lockDirection || 'contra';
  const { accountId: lastFrom, remember: rememberFrom } = useDefaultAccount({ currency: '*', entity: memoryEntity, purpose: 'transfer_from', accounts: fromAccounts });
  const { accountId: lastTo, remember: rememberTo } = useDefaultAccount({ currency: '*', entity: memoryEntity, purpose: 'transfer_to', accounts: toAccounts });

  // `fromAccountId` — opened from an account (Account drawer › Transfer): the
  // source is inherited, still changeable.
  const [form, setForm] = useState(() => initialForm(editing, fromAccountId));
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [step, setStep] = useState('form'); // 'form' | 'review'
  const [clientRef, setClientRef] = useState(newClientRef);
  const [rateTouched, setRateTouched] = useState(false);
  const [methodTouched, setMethodTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Fresh form (and a fresh duplicate-guard id) every time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setError(''); setFieldErrors({}); setStep('form'); setClientRef(newClientRef()); setRateTouched(!!editing);
    setMethodTouched(!!editing);
    setForm(initialForm(editing, fromAccountId));
  }, [open, editing, fromAccountId]);

  // Defaults for a new transfer, once the accounts are known: the source and
  // destination this user last used here; locked Mill → Head Office falls back
  // to the first Mill / Head Office account, as the old drawer did. Never over
  // a choice already made.
  const fromKey = fromAccounts.map((a) => a.id).join(',');
  const toKey = toAccounts.map((a) => a.id).join(',');
  useEffect(() => {
    if (!open || editing) return;
    setForm((f) => {
      const { fromId, toId } = transferDefaults({ fromId: f.fromId, toId: f.toId, fromAccounts, toAccounts, lastFrom, lastTo, locked });
      return fromId === f.fromId && toId === f.toId ? f : { ...f, fromId, toId };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, fromKey, toKey, lastFrom, lastTo, locked]);

  const fromAcct = fromAccounts.find((a) => String(a.id) === String(form.fromId));
  const toAcct = toAccounts.find((a) => String(a.id) === String(form.toId));
  // How the money moved — cash out of a cash account, otherwise a bank
  // transfer — until the user picks one.
  const method = methodTouched ? form.method : (fromAcct?.type === 'cash' ? 'cash' : 'bank_transfer');
  const fromCur = cur(fromAcct);
  const toCur = cur(toAcct);
  const kind = classifyTransfer(fromAcct, toAcct);
  const fx = isCrossCurrency(fromAcct, toAcct) && kind === 'internal';
  const foreign = fx ? foreignCurrency(fromCur, toCur) : null;
  const { data: sysRate } = useContraRate(foreign, form.date);

  // Pre-fill the rate from fx_rates until the user types their own.
  useEffect(() => {
    if (!fx || rateTouched || !sysRate?.rate) return;
    setForm((f) => ({ ...f, rate: String(sysRate.rate), converted: fmtInput(convertAmount(f.amount, sysRate.rate, fromCur, toCur)) }));
  }, [fx, rateTouched, sysRate?.rate, fromCur, toCur]);

  function onAmount(v) {
    setForm((f) => ({ ...f, amount: v, converted: fx ? fmtInput(convertAmount(v, f.rate, fromCur, toCur)) : f.converted }));
  }
  function onRate(v) {
    setRateTouched(true);
    setForm((f) => ({ ...f, rate: v, converted: fmtInput(convertAmount(f.amount, v, fromCur, toCur)) }));
  }
  function onConverted(v) {
    setRateTouched(true);
    setForm((f) => ({ ...f, converted: v, rate: fmtInput(rateFromConverted(f.amount, v, fromCur, toCur), 6) }));
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.upload('/api/finance/fund-transfers/attachment', fd);
      const d = res?.data || res;
      if (d?.url) setForm((f) => ({ ...f, attachmentUrl: d.url, attachmentName: d.name || file.name }));
      else if (res?._offlineQueued) addToast?.('Offline — attach the document once the connection returns.', 'info');
      else throw new Error('Upload failed');
    } catch (err) {
      addToast?.(err?.data?.message || err?.message || 'Attachment upload failed', 'error');
    } finally { setUploading(false); }
  }

  // On an edit with the same source account, the reversal hands the original
  // amount + charges back before the new one leaves.
  const returning = editing && String(editing.fromAccountId) === String(form.fromId)
    ? (Number(editing.amount) || 0) + (Number(editing.bankCharges) || 0) : 0;
  // B2: more than the source holds still goes through — warned, not blocked.
  const overdraft = contraOverdraft({ fromAcct, amount: form.amount, charges: form.charges, returning });
  const overdraftNote = overdraft && (
    <div role="status" data-testid="contra-overdraft" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
      <span>{overdraft.message} The transfer still goes through; {fromAcct?.name} shows as overdrawn until it is funded.</span>
    </div>
  );

  function review() {
    setError('');
    const fe = validateContra({
      fromAcct, toAcct, amount: form.amount, rate: form.rate, converted: form.converted,
      reference: form.reference, charges: form.charges,
    });
    if (editing && !String(form.reason || '').trim()) fe.reason = 'Say why the transfer is being changed.';
    setFieldErrors(fe);
    if (Object.keys(fe).length === 0) setStep('review');
  }

  async function submit() {
    if (busy) return;
    setError('');
    const body = {
      from_account_id: Number(form.fromId), to_account_id: Number(form.toId),
      amount: Number(form.amount), currency: fromCur,
      to_currency: toCur,
      to_amount: fx ? Number(form.converted) : null,
      fx_rate: fx ? Number(form.rate) : null,
      rate_date: fx ? form.date : null,
      bank_charges: Number(form.charges) > 0 ? Number(form.charges) : 0,
      transfer_date: form.date, method,
      reference: String(form.reference).trim(), notes: form.notes || null,
      attachment_url: form.attachmentUrl || null, attachment_name: form.attachmentName || null,
      client_ref: clientRef,
    };
    try {
      const res = editing
        ? await replaceMut.mutateAsync({ id: editing.id, ...body, reason: String(form.reason).trim() })
        : await createMut.mutateAsync(body);
      // Remember the two ends for next time (shown and editable, never auto-sent).
      if (!editing) { rememberFrom(form.fromId); rememberTo(form.toId); }
      if (res?._offlineQueued) addToast?.('Offline — the transfer will be recorded when the connection returns.', 'info');
      else {
        const t = res?.data?.transfer;
        addToast?.(kind === 'cross_entity'
          ? `${t?.transfer_no || 'Transfer'} sent — it lands once the ${entityLabel(ent(toAcct))} accepts it.`
          : `${t?.transfer_no || 'Contra transfer'} ${editing ? 'replaces the original' : 'recorded'}.`, 'success');
        // B2: the server's overdraft warning, after the fact.
        const w = res?.data?.warning;
        if (w?.account_name) addToast?.(`${w.account_name} is now overdrawn by ${fmtMoney(w.overdrawn_by, w.currency, { decimals: 2 })}.`, 'warning');
      }
      onClose?.();
      onDone?.(res?.data);
    } catch (e) {
      const existing = e?.data?.data?.transfer;
      if (e?.status === 409 && existing) {
        addToast?.(`Already recorded as ${existing.transfer_no} — not saved twice.`, 'warning');
        onClose?.();
        return;
      }
      setStep('form');
      setError(e?.data?.message || e?.message || 'The transfer could not be recorded.');
    }
  }

  const amt = Number(form.amount) || 0;
  const charges = Number(form.charges) || 0;
  const converted = fx ? Number(form.converted) || 0 : amt;
  const pkrEquivalent = fx ? (fromCur === 'PKR' ? amt : converted) : null;

  const acctOption = (a) => (
    <option key={a.id} value={a.id}>
      {favStar(a)}{a.name}{a.currentBalance != null ? ` — ${fmtMoney(Number(a.currentBalance) || 0, cur(a), { decimals: 2 })}` : ''}
    </option>
  );
  const select = (value, onChange, placeholder, groups, { hideBalance = false, id } = {}) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inp}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.key} label={g.label}>
          {g.list.map((a) => (hideBalance ? <option key={a.id} value={a.id}>{favStar(a)}{a.name}</option> : acctOption(a)))}
        </optgroup>
      ))}
    </select>
  );
  const lastUsedHint = (id, last) => (last && String(id) === String(last)
    ? <p className="text-[11px] text-gray-500 mt-1" data-testid="account-default-hint">Last used — change it if needed.</p>
    : null);
  const title = editing ? `Edit ${editing.transferNo}`
    : lockDirection === 'mill_to_ho' ? 'Send Funds to Head Office'
    : lockDirection === 'ho_to_mill' ? 'Send Funds to the Mill'
    : 'Contra Transfer';
  const subtitle = editing ? 'The original is reversed and this replaces it'
    : lockDirection === 'mill_to_ho' ? 'From a Mill account to a Head Office account — Head Office accepts it'
    : "Move money between the company's own accounts";
  const noSource = locked && fromAccounts.length === 0;

  return (
    <SlideDrawer open={open} onClose={onClose} size="lg"
      title={title}
      subtitle={subtitle}
      icon={ArrowLeftRight}
      footer={
        <div className="flex items-center justify-end gap-2">
          {step === 'review'
            ? <button type="button" onClick={() => setStep('form')} className={btnSecondary}>Back</button>
            : <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>}
          {step === 'review' ? (
            <button type="button" onClick={submit} disabled={busy} className={btnPrimary}>
              <ArrowLeftRight className="w-4 h-4" aria-hidden="true" /> {busy ? 'Saving…' : (editing ? 'Reverse & replace' : 'Confirm transfer')}
            </button>
          ) : (
            <button type="button" onClick={review} disabled={uploading || noSource} className={btnPrimary} data-action="review-transfer">
              Review
            </button>
          )}
        </div>
      }>
      <div className="space-y-4">
        {step === 'form' ? (
          <>
            {noSource && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2" data-testid="no-source-account">No active account to send from.</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl} htmlFor="contra-from">From account{lockDirection === 'mill_to_ho' ? ' (Mill)' : lockDirection === 'ho_to_mill' ? ' (Head Office)' : ''} {REQ}</label>
                {select(form.fromId || '', (v) => { set('fromId', v); setRateTouched(!!editing); }, 'Select account…', fromGroups, { id: 'contra-from' })}
                {lastUsedHint(form.fromId, lastFrom)}
                <FieldError error={fieldErrors.from} />
              </div>
              <div>
                <label className={lbl} htmlFor="contra-to">To account{lockDirection === 'mill_to_ho' ? ' (Head Office)' : lockDirection === 'ho_to_mill' ? ' (Mill)' : ''} {REQ}</label>
                {select(form.toId || '', (v) => { set('toId', v); setRateTouched(!!editing); }, 'Select account…', toGroups, { hideBalance: hideToBalance, id: 'contra-to' })}
                {lastUsedHint(form.toId, lastTo)}
                <FieldError error={fieldErrors.to} />
              </div>
            </div>

            {kind === 'same' && (
              <p className="text-xs text-red-600" data-testid="same-account">From and To must be different accounts.</p>
            )}
            {kind === 'cross_entity' && (
              <div className="flex gap-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3" data-testid="cross-entity-note">
                <Info className="w-4 h-4 shrink-0" />
                <span>
                  These accounts belong to {entityLabel(ent(fromAcct))} and {entityLabel(ent(toAcct))}, so this becomes a
                  <span className="font-medium"> {entityLabel(ent(fromAcct))} → {entityLabel(ent(toAcct))} transfer</span>: the money leaves
                  {' '}{fromAcct?.name} now and lands in {toAcct?.name} once the {entityLabel(ent(toAcct))} <span className="font-medium">accepts</span> it.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={lbl}>Date {REQ}</label>
                <input type="date" value={form.date || ''} onChange={(e) => set('date', e.target.value)} className={inp} />
              </div>
              <div>
                <label className={lbl}>Amount {REQ}</label>
                <input type="number" min="0" step="0.01" value={form.amount || ''} onChange={(e) => onAmount(e.target.value)} placeholder="0" className={inp} />
                <FieldError error={fieldErrors.amount} />
              </div>
              <div>
                <label className={lbl}>Currency</label>
                <input type="text" readOnly value={fromAcct ? fromCur : '—'} aria-label="Currency (from the source account)"
                  className={`${inp} bg-gray-50 text-gray-600`} />
              </div>
            </div>

            {fx && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-3" data-testid="fx-fields">
                <div className="text-xs font-semibold text-amber-800">{fromCur} → {toCur} — exchange</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Exchange rate (PKR per 1 {foreign}) {REQ}</label>
                    <input type="number" min="0" step="0.000001" value={form.rate || ''} onChange={(e) => onRate(e.target.value)} className={inp} />
                    {sysRate?.rate ? (
                      <p className="text-[11px] text-gray-500 mt-1">System rate {sysRate.rate}{sysRate.source === 'fx_rates' ? '' : ' (default)'} · you can override it</p>
                    ) : null}
                    <FieldError error={fieldErrors.rate} />
                  </div>
                  <div>
                    <label className={lbl}>Converted amount ({toCur}) {REQ}</label>
                    <input type="number" min="0" step="0.01" value={form.converted || ''} onChange={(e) => onConverted(e.target.value)} className={inp} />
                    <FieldError error={fieldErrors.converted} />
                  </div>
                </div>
                <p className="text-[11px] text-amber-800">Each account moves by its own currency amount. The FX difference is not booked — it is flagged for review.</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={lbl} htmlFor="contra-method">Method</label>
                <select id="contra-method" value={method} onChange={(e) => { setMethodTouched(true); set('method', e.target.value); }} className={inp}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Reference / transaction no. {REQ}</label>
                <input type="text" value={form.reference || ''} onChange={(e) => set('reference', e.target.value)} placeholder="Slip / TT / cheque #" className={inp} />
                <FieldError error={fieldErrors.reference} />
              </div>
              <div>
                <label className={lbl}>Bank charges ({fromAcct ? fromCur : 'source currency'}) <span className="text-gray-400 font-normal">· optional</span></label>
                <input type="number" min="0" step="0.01" value={form.charges || ''} onChange={(e) => set('charges', e.target.value)} placeholder="0" className={inp} />
                <FieldError error={fieldErrors.charges} />
              </div>
            </div>
            {overdraftNote}

            <div>
              <label className={lbl}>Notes <span className="text-gray-400 font-normal">· optional</span></label>
              <textarea rows={2} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} className={inp} />
            </div>

            <div>
              <label className={`${lbl} inline-flex items-center gap-1`}><Paperclip size={12} /> Attachment <span className="text-gray-400 font-normal">· optional</span></label>
              {form.attachmentUrl ? (
                <div className="flex items-center justify-between text-xs bg-white rounded-md border border-gray-200 px-3 py-2">
                  <span className="text-gray-700 truncate inline-flex items-center gap-1.5"><FileText size={13} className="text-emerald-600" /> {form.attachmentName || 'Attached'}</span>
                  <button type="button" onClick={() => setForm((f) => ({ ...f, attachmentUrl: '', attachmentName: '' }))} aria-label="Remove attachment" className="text-red-500 hover:text-red-600"><X size={14} /></button>
                </div>
              ) : (
                <input type="file" onChange={onFile} disabled={uploading}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
              )}
              {uploading && <p className="text-[11px] text-gray-400 mt-1">Uploading…</p>}
            </div>

            {editing && (
              <div>
                <label className={lbl}>Reason for the change {REQ}</label>
                <textarea rows={2} value={form.reason || ''} onChange={(e) => set('reason', e.target.value)} className={inp}
                  placeholder="e.g. wrong amount keyed in" />
                <FieldError error={fieldErrors.reason} />
              </div>
            )}
          </>
        ) : (
          <ContraSummary fromAcct={fromAcct} toAcct={toAcct} amount={amt} converted={converted} charges={charges}
            rate={fx ? Number(form.rate) : null} kind={kind} fx={fx} pkrEquivalent={pkrEquivalent}
            reference={form.reference} date={form.date} editing={editing} method={method} />
        )}
        {step === 'review' && overdraftNote}
        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      </div>
    </SlideDrawer>
  );
}

// Account picker groups: Head Office / Mill / Export, each per currency.
function groupAccounts(list) {
  const m = new Map();
  for (const a of list) {
    const key = `${ent(a)}|${cur(a)}`;
    if (!m.has(key)) m.set(key, { key, label: `${entityLabel(ent(a))} · ${cur(a)}`, entity: ent(a), list: [] });
    m.get(key).list.push(a);
  }
  return [...m.values()].sort((x, y) => (ENTITY_ORDER[x.entity] ?? 9) - (ENTITY_ORDER[y.entity] ?? 9) || x.label.localeCompare(y.label));
}

const METHOD_LABEL = { bank_transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', online: 'Online' };

// The form for a new transfer, or pre-filled from the transfer being edited.
function initialForm(editing, fromAccountId = null) {
  if (!editing) {
    return {
      fromId: fromAccountId ? String(fromAccountId) : '', toId: '', amount: '', date: todayLocalISO(), reference: '', notes: '',
      rate: '', converted: '', charges: '', attachmentUrl: '', attachmentName: '', reason: '', method: 'bank_transfer',
    };
  }
  return {
    method: editing.method || 'bank_transfer',
    fromId: String(editing.fromAccountId || ''), toId: String(editing.toAccountId || ''),
    amount: editing.amount != null ? String(Number(editing.amount)) : '',
    date: String(editing.transferDate || todayLocalISO()).slice(0, 10),
    reference: editing.reference || '', notes: '',
    rate: editing.fxRate != null ? String(Number(editing.fxRate)) : '',
    converted: editing.toAmount != null ? String(Number(editing.toAmount)) : '',
    charges: Number(editing.bankCharges) > 0 ? String(Number(editing.bankCharges)) : '',
    attachmentUrl: editing.attachmentUrl || '', attachmentName: editing.attachmentName || '',
    reason: '',
  };
}

function fmtInput(n, dp = 2) {
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 10 ** dp) / 10 ** dp);
}

/** The pre-confirm summary. Exported for tests. */
export function ContraSummary({ fromAcct, toAcct, amount, converted, charges, rate, kind, fx, pkrEquivalent, reference, date, editing, method = null }) {
  const fc = cur(fromAcct); const tc = cur(toAcct);
  const row = (k, v, cls = '') => (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-gray-500">{k}</span><span className={`text-right font-medium text-gray-900 break-words ${cls}`}>{v}</span>
    </div>
  );
  return (
    <div className="space-y-3" data-testid="contra-summary">
      <div className="text-sm font-semibold text-gray-800">Check before you confirm</div>
      <div className="text-xs rounded-lg border border-gray-200 bg-white px-3">
        {row('From', `${fromAcct?.name || '—'} (${entityLabel(ent(fromAcct))} · ${fc})`)}
        {row('To', `${toAcct?.name || '—'} (${entityLabel(ent(toAcct))} · ${tc})`)}
        {row('Date', date || '—')}
        {row('Reference', reference || '—')}
        {method && row('Method', METHOD_LABEL[method] || method)}
        {row('Amount', fmtMoney(amount, fc, { decimals: 2 }))}
        {fx && row('Converted', `${fmtMoney(converted, tc, { decimals: 2 })} @ ${rate}`)}
        {row('Bank charges', charges > 0 ? `${fmtMoney(charges, fc, { decimals: 2 })} — expense (6200)` : 'None')}
        {row('Leaves ' + (fromAcct?.name || 'source'), fmtMoney(amount + (charges > 0 ? charges : 0), fc, { decimals: 2 }))}
        {row('Arrives in ' + (toAcct?.name || 'destination'), kind === 'cross_entity' ? `${fmtMoney(converted, tc, { decimals: 2 })} — after acceptance` : fmtMoney(converted, tc, { decimals: 2 }))}
      </div>
      {fx ? (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          <div>PKR equivalent moves between your accounts: <span className="font-semibold">{fmtMoney(pkrEquivalent, 'PKR', { decimals: 2 })}</span></div>
          <div className="inline-flex items-center gap-1 font-medium"><AlertTriangle size={12} /> FX difference not booked — review</div>
        </div>
      ) : (
        <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          Net internal movement: <span className="font-semibold">{fc} 0</span> — money moves between your own accounts; nothing is income or expense{charges > 0 ? ' except the bank charges' : ''}.
        </div>
      )}
      {kind === 'cross_entity' && (
        <div className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">
          This is a {entityLabel(ent(fromAcct))} → {entityLabel(ent(toAcct))} transfer: it waits for the {entityLabel(ent(toAcct))} to accept it.
        </div>
      )}
      {editing && (
        <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">
          {editing.transferNo} will be reversed (both sides{Number(editing.bankCharges) > 0 ? ' and its bank charges' : ''}) and this transfer recorded in its place. Both stay in the history.
        </div>
      )}
    </div>
  );
}
