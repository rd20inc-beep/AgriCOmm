import { useState } from 'react';
import { AlertTriangle, Trash2, Landmark, Box, Receipt, ShieldAlert } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useLotInventory } from '../../../../api/queries';
import { adminApi } from '../../api/services';

const TXN_TYPES = [
  { value: 'local_sale',     label: 'Local Sale',     hint: 'restocks the lot, deletes its payment/receivable/journal' },
  { value: 'export_order',   label: 'Export Order',   hint: 'frees reservations, restocks dispatch, deletes items/costs/journals' },
  { value: 'milling_batch',  label: 'Milling Batch',  hint: 'deletes the batch + its raw/output lots, vehicles, costs & quality' },
  { value: 'payment',        label: 'Payment',        hint: 'restores the linked payable/receivable outstanding' },
  { value: 'mill_purchase',  label: 'Mill Purchase',  hint: 'reverses mill-store stock + deletes the payable' },
  { value: 'journal_entry',  label: 'Journal Entry',  hint: 'deletes the entry and its lines' },
  { value: 'lot_transaction',label: 'Lot Transaction',hint: 'deletes a single inventory-ledger row' },
  { value: 'customer',       label: 'Customer (master)', hint: 'deletes a customer — refused if still referenced by live data' },
  { value: 'supplier',       label: 'Supplier (master)', hint: 'deletes a supplier — refused if still referenced by live data' },
  { value: 'product',        label: 'Product (master)',  hint: 'deletes a product — refused if still referenced by live data' },
];

const errOf = (e) => e?.data?.message || e?.data?.errors?.[0]?.message || e?.message || 'Failed';

function Card({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-200">
        <Icon size={16} className="text-red-600" />
        <div>
          <h3 className="text-sm font-semibold text-red-900">{title}</h3>
          {subtitle && <p className="text-[11px] text-red-700/80">{subtitle}</p>}
        </div>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

const INPUT = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-400 bg-white';
const LABEL = 'block text-[11px] font-semibold text-gray-600 uppercase mb-1';

export default function DangerZoneTab() {
  const { addToast, bankAccountsList = [] } = useApp();
  const { data: lots = [] } = useLotInventory({ limit: 200 });

  // ── Full reset ──
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  async function resetSystem() {
    if (resetConfirm !== 'RESET') { addToast('Type RESET to confirm', 'error'); return; }
    if (!window.confirm('PERMANENTLY wipe ALL transactional data (lots, orders, batches, sales, finance)?\n\nMasters are kept and a backup schema is created, but this cannot be undone from the UI.\n\nProceed?')) return;
    setResetBusy(true);
    try {
      const r = await adminApi.dangerReset({ confirm: 'RESET' });
      addToast(r?.message || 'System reset complete', 'success');
      setResetConfirm('');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { addToast(errOf(e), 'error'); }
    finally { setResetBusy(false); }
  }

  // ── Lot deletion ──
  const [lotId, setLotId] = useState('');
  const [lotImpact, setLotImpact] = useState(null);
  const [lotBusy, setLotBusy] = useState(false);

  async function previewLot(id) {
    setLotId(id); setLotImpact(null);
    if (!id) return;
    try { const r = await adminApi.dangerLotImpact(id); setLotImpact(r?.data || r); }
    catch (e) { addToast(errOf(e), 'error'); }
  }
  async function deleteLot() {
    const blocked = lotImpact?.blockers?.length > 0;
    const lot = lots.find(l => String(l.id) === String(lotId));
    if (!window.confirm(`Permanently delete lot ${lot?.lotNo || lotId}?${blocked ? '\n\nThis lot is in use:\n• ' + lotImpact.blockers.join('\n• ') + '\n\nForce delete anyway?' : ''}\n\nThis cannot be undone.`)) return;
    setLotBusy(true);
    try {
      await adminApi.dangerDeleteLot(lotId, blocked);
      addToast('Lot permanently deleted', 'success');
      setLotId(''); setLotImpact(null);
    } catch (e) { addToast(errOf(e), 'error'); }
    finally { setLotBusy(false); }
  }

  // ── Transaction deletion ──
  const [txnType, setTxnType] = useState('local_sale');
  const [txnId, setTxnId] = useState('');
  const [txnImpact, setTxnImpact] = useState(null);
  const [txnBusy, setTxnBusy] = useState(false);

  async function previewTxn() {
    setTxnImpact(null);
    if (!txnId) return;
    try { const r = await adminApi.dangerTxnImpact(txnType, txnId); setTxnImpact(r?.data || r); }
    catch (e) { addToast(errOf(e), 'error'); }
  }
  async function deleteTxn() {
    const tt = TXN_TYPES.find(t => t.value === txnType);
    if (!window.confirm(`Permanently delete ${tt.label} #${txnId}?\n\n${tt.hint}.\n\nThis cannot be undone.`)) return;
    setTxnBusy(true);
    try {
      const r = await adminApi.dangerDeleteTxn(txnType, txnId);
      addToast(r?.message || 'Transaction deleted', 'success');
      setTxnId(''); setTxnImpact(null);
    } catch (e) { addToast(errOf(e), 'error'); }
    finally { setTxnBusy(false); }
  }

  // ── Bank balance ──
  const [bankId, setBankId] = useState('');
  const [mode, setMode] = useState('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [bankBusy, setBankBusy] = useState(false);

  async function submitBalance() {
    if (!bankId || amount === '') { addToast('Pick an account and enter an amount', 'error'); return; }
    const acct = bankAccountsList.find(b => String(b.id) === String(bankId));
    if (!window.confirm(`${mode === 'set' ? 'Set' : 'Add to'} ${acct?.name} balance: ${amount}?`)) return;
    setBankBusy(true);
    try {
      const r = await adminApi.dangerAdjustBalance(bankId, { mode, amount: Number(amount), reason });
      addToast(r?.message || 'Balance updated', 'success');
      setAmount(''); setReason('');
    } catch (e) { addToast(errOf(e), 'error'); }
    finally { setBankBusy(false); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start gap-3 p-4 rounded-xl bg-red-600 text-white">
        <ShieldAlert size={20} className="flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm">Danger Zone — permanent actions</p>
          <p className="text-[12px] text-red-100">These hard-delete records and adjust balances. Changes are irreversible and audit-logged. Super Admin only.</p>
        </div>
      </div>

      {/* Delete a lot */}
      <Card icon={Box} title="Delete inventory lot" subtitle="Removes the lot and all its movements, ledger entries & reservations">
        <div>
          <label className={LABEL}>Lot</label>
          <select className={INPUT} value={lotId} onChange={e => previewLot(e.target.value)}>
            <option value="">Select a lot…</option>
            {lots.map(l => (
              <option key={l.id} value={l.id}>{l.lotNo} — {l.itemName} ({(Number(l.qty || 0) / 1000).toFixed(2)} MT, {l.status})</option>
            ))}
          </select>
        </div>
        {lotImpact && (
          <div className="text-[12px] bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
            <p className="font-medium text-gray-700">Will delete:</p>
            <p className="text-gray-600">
              {Object.entries(lotImpact.counts || {}).filter(([, c]) => c > 0).map(([t, c]) => `${c} ${t.replace(/_/g, ' ')}`).join(', ') || 'no child records'}
            </p>
            {lotImpact.blockers?.length > 0 && (
              <p className="text-red-700 font-medium flex items-center gap-1"><AlertTriangle size={13} /> In use: {lotImpact.blockers.join('; ')} — requires force delete</p>
            )}
          </div>
        )}
        <button disabled={!lotId || lotBusy} onClick={deleteLot}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-40">
          <Trash2 size={15} /> {lotBusy ? 'Deleting…' : 'Permanently delete lot'}
        </button>
      </Card>

      {/* Delete a transaction */}
      <Card icon={Receipt} title="Delete transaction" subtitle="Reverses the financial/stock effect, then removes the record">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Type</label>
            <select className={INPUT} value={txnType} onChange={e => { setTxnType(e.target.value); setTxnImpact(null); }}>
              {TXN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Record ID</label>
            <input className={INPUT} type="number" value={txnId} placeholder="numeric id"
              onChange={e => { setTxnId(e.target.value); setTxnImpact(null); }} onBlur={previewTxn} />
          </div>
        </div>
        <p className="text-[11px] text-gray-500">{TXN_TYPES.find(t => t.value === txnType)?.hint}</p>
        {txnImpact && (
          <div className="text-[12px] bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
            {txnImpact.willReverse && <p className="text-gray-700">Reversal: <span className="font-medium">{txnImpact.willReverse}</span></p>}
            {txnImpact.children && <p className="text-gray-600">Children: {Object.entries(txnImpact.children).map(([t, c]) => `${c} ${t.replace(/_/g, ' ')}`).join(', ')}</p>}
          </div>
        )}
        <button disabled={!txnId || txnBusy} onClick={deleteTxn}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-40">
          <Trash2 size={15} /> {txnBusy ? 'Deleting…' : 'Permanently delete transaction'}
        </button>
      </Card>

      {/* Adjust bank balance */}
      <Card icon={Landmark} title="Adjust bank / cash balance" subtitle="Add to or set an account balance (manual correction)">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL}>Account</label>
            <select className={INPUT} value={bankId} onChange={e => setBankId(e.target.value)}>
              <option value="">Select an account…</option>
              {bankAccountsList.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.currency || 'PKR'} {Number(b.current_balance ?? b.currentBalance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL}>Mode</label>
            <select className={INPUT} value={mode} onChange={e => setMode(e.target.value)}>
              <option value="add">Add to balance</option>
              <option value="set">Set balance to</option>
            </select>
          </div>
          <div>
            <label className={LABEL}>Amount</label>
            <input className={INPUT} type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div className="col-span-2">
            <label className={LABEL}>Reason</label>
            <input className={INPUT} type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. opening balance / correction" />
          </div>
        </div>
        <button disabled={bankBusy} onClick={submitBalance}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-black disabled:opacity-40">
          <Landmark size={15} /> {bankBusy ? 'Saving…' : 'Apply balance change'}
        </button>
      </Card>

      {/* Reset to 0 */}
      <div className="bg-white rounded-xl border-2 border-red-400 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-red-600 text-white">
          <ShieldAlert size={16} />
          <div>
            <h3 className="text-sm font-bold">Reset system to 0</h3>
            <p className="text-[11px] text-red-100">Wipe ALL transactional data — lots, orders, batches, sales, finance. Masters (products, suppliers, customers, users, warehouses, bank accounts) are kept; bank balances are zeroed.</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-600">A backup of every wiped table is created first (a <code className="text-red-700">backup_reset_…</code> schema in the database), but this cannot be undone from the UI. Type <b>RESET</b> to enable the button.</p>
          <div className="max-w-xs">
            <input className={`${INPUT} font-mono`} value={resetConfirm} onChange={e => setResetConfirm(e.target.value)} placeholder="Type RESET" />
          </div>
          <button disabled={resetBusy || resetConfirm !== 'RESET'} onClick={resetSystem}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 disabled:opacity-40">
            <Trash2 size={15} /> {resetBusy ? 'Resetting…' : 'Reset system to 0'}
          </button>
        </div>
      </div>
    </div>
  );
}
