import { btnPrimary, btnSecondary } from '../utils/uiClasses';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Building2, Factory } from 'lucide-react';
import SlideDrawer from '../../../components/SlideDrawer';
import { useBankAccounts, useCreateFundTransfer } from '../../../api/queries';
import { favStar } from '../../../shared/utils/favorites';
import FieldError from '../../../shared/components/FieldError';
import { todayLocalISO, fmtPKR } from '../../../shared/utils/format';

const TODAY = () => todayLocalISO();
const fmt = (n) => fmtPKR(parseFloat(n) || 0, { decimals: 2 });
const REQ = <span className="text-red-500">*</span>;

// Reusable Head Office ⇄ Mill money-transfer drawer. Moves cash between two real
// accounts AND records the inter-company GL; used from both Finance (Cash) and
// Mill Finance. `defaultDirection` pre-selects ho_to_mill / mill_to_ho.
export default function TransferFundsDrawer({ open, onClose, defaultDirection = 'ho_to_mill', lockDirection = null, onDone }) {
  const { data: accounts = [] } = useBankAccounts();
  const createMut = useCreateFundTransfer();

  // When lockDirection is set the direction is fixed (e.g. the Mill can only send
  // to Head Office) and the toggle is hidden.
  const [direction, setDirection] = useState(lockDirection || defaultDirection);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(TODAY());
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  // Required-field problems, shown under the field they belong to.
  const [fieldErrors, setFieldErrors] = useState({});

  const pkr = useMemo(() => accounts.filter((a) => (a.currency || 'PKR') === 'PKR' && a.isActive !== false), [accounts]);
  const hoAccts = useMemo(() => pkr.filter((a) => (a.entity || 'general') !== 'mill'), [pkr]);
  const millAccts = useMemo(() => pkr.filter((a) => (a.entity || 'general') === 'mill'), [pkr]);

  const fromOptions = direction === 'ho_to_mill' ? hoAccts : millAccts;
  const toOptions = direction === 'ho_to_mill' ? millAccts : hoAccts;
  // When the Mill is sending to Head Office it must not see Head Office bank
  // balances — show the destination account names only.
  const hideToBalance = lockDirection === 'mill_to_ho';

  // Reset sensible defaults whenever the drawer opens or the direction flips.
  useEffect(() => {
    if (!open) return;
    setError('');
    setFieldErrors({});
    const f = (direction === 'ho_to_mill' ? hoAccts : millAccts);
    const t = (direction === 'ho_to_mill' ? millAccts : hoAccts);
    setFromId(f[0] ? String(f[0].id) : '');
    setToId(t[0] ? String(t[0].id) : '');
  }, [open, direction, accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) setDirection(lockDirection || defaultDirection); }, [open, defaultDirection, lockDirection]);

  const fromAcct = pkr.find((a) => String(a.id) === String(fromId));
  const toAcct = pkr.find((a) => String(a.id) === String(toId));
  const amt = parseFloat(amount) || 0;

  async function submit() {
    if (createMut.isPending) return;
    setError('');
    const fe = {};
    if (!fromId) fe.from = 'Pick a source account.';
    if (!toId) fe.to = 'Pick a destination account.';
    if (fromId && toId && String(fromId) === String(toId)) fe.to = 'Source and destination must be different.';
    if (!(amt > 0)) fe.amount = 'Enter an amount greater than zero.';
    setFieldErrors(fe);
    if (Object.keys(fe).length) return;
    try {
      await createMut.mutateAsync({
        direction, from_account_id: Number(fromId), to_account_id: Number(toId),
        amount: amt, transfer_date: date, method, reference: reference || null, notes: notes || null,
      });
      onClose?.();
      setAmount(''); setReference(''); setNotes('');
      onDone?.();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Transfer failed.');
    }
  }

  const noMill = millAccts.length === 0;

  return (
    <SlideDrawer open={open} onClose={onClose}
      title={lockDirection === 'mill_to_ho' ? 'Send Funds to Head Office' : 'Transfer Funds'}
      subtitle={lockDirection === 'mill_to_ho' ? 'Send money from the Mill to Head Office' : 'Move money between Head Office and the Mill'}
      icon={ArrowLeftRight}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={submit} disabled={createMut.isPending || noMill} className={btnPrimary}>
            <ArrowLeftRight className="w-4 h-4" aria-hidden="true" /> {createMut.isPending ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        {noMill && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">No Mill account found. Run the latest migration to seed the Mill Cash account.</div>}

        {/* Direction toggle (hidden when locked to a single direction) */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
          {lockDirection ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-800">
              {lockDirection === 'mill_to_ho' ? <><Factory className="w-3.5 h-3.5" /> Mill → Head Office</> : <><Building2 className="w-3.5 h-3.5" /> Head Office → Mill</>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {[
                { k: 'ho_to_mill', label: 'Head Office → Mill', icon: Building2 },
                { k: 'mill_to_ho', label: 'Mill → Head Office', icon: Factory },
              ].map(({ k, label, icon: Ic }) => (
                <button key={k} type="button" onClick={() => setDirection(k)}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border ${direction === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400'}`}>
                  <Ic className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* From */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From account ({direction === 'ho_to_mill' ? 'Head Office' : 'Mill'}) {REQ}</label>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900">
            <option value="">Select account…</option>
            {fromOptions.map((a) => <option key={a.id} value={a.id}>{favStar(a)}{a.name} — {fmt(a.currentBalance)}</option>)}
          </select>
          <FieldError error={fieldErrors.from} />
        </div>

        {/* To */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To account ({direction === 'ho_to_mill' ? 'Mill' : 'Head Office'}) {REQ}</label>
          <select value={toId} onChange={(e) => setToId(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900">
            <option value="">Select account…</option>
            {toOptions.map((a) => <option key={a.id} value={a.id}>{favStar(a)}{a.name}{hideToBalance ? '' : ` — ${fmt(a.currentBalance)}`}</option>)}
          </select>
          <FieldError error={fieldErrors.to} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount (PKR) {REQ}</label>
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            <FieldError error={fieldErrors.amount} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900">
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reference <span className="text-gray-400 font-normal">· optional</span></label>
            <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Slip / cheque #"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notes <span className="text-gray-400 font-normal">· optional</span></label>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
        </div>

        {amt > 0 && fromAcct && toAcct && (
          <div className="text-xs text-gray-600 border border-gray-200 rounded-lg p-3 bg-gray-50">
            <span className="font-medium">{fmt(amt)}</span> leaves <span className="font-medium break-words">{fromAcct.name}</span> now. The
            <span className="font-medium"> {direction === 'ho_to_mill' ? 'Mill' : 'Head Office'}</span> must <span className="font-medium">accept</span> it before it lands in
            <span className="font-medium break-words"> {toAcct.name}</span> and can be used.
          </div>
        )}
        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      </div>
    </SlideDrawer>
  );
}
