import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { X, ArrowDownLeft, ArrowUpRight, Scale, ExternalLink, Printer, Download } from 'lucide-react';
import { accountingApi } from '../../accounting/api/services';
import PartyAllocationLedger from './PartyAllocationLedger';
import LedgerTypeCounts from './LedgerTypeCounts';
import { printStatement } from './printStatement';

// Inline customer statement (charges/receipts + running balance) for the Mill
// Finance "Customers" tab — mirrors MillSupplierStatement but for local-sales
// customers. Reuses /accounting/statements/customer/:id (now includes local
// sales) so the numbers reconcile with Finance > Statements.
function curSymbol(cur) {
  const c = (cur || 'PKR').toUpperCase();
  return c === 'PKR' ? 'Rs ' : c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : `${c} `;
}
const fmtCur = (v, cur) => `${curSymbol(cur)}${Math.round(parseFloat(v) || 0).toLocaleString()}`;

const refLink = (refNo) => {
  if (!refNo) return null;
  if (refNo.startsWith('LS-')) return '/local-sales';
  if (refNo.startsWith('EX-')) return `/export/${refNo}`;
  return null;
};

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

export default function MillCustomerStatement({ customerId, customerName, params = {}, onClose }) {
  const [view, setView] = useState('statement'); // 'statement' | 'allocation'
  const cardRef = useRef(null);
  const { data: statement, isLoading, isError, error } = useQuery({
    queryKey: ['mill-customer-statement', customerId, params],
    enabled: !!customerId,
    queryFn: async () => {
      const res = await accountingApi.customerStatement(customerId, params);
      return res?.data ?? res;
    },
  });

  const transactions = useMemo(() => statement?.transactions || [], [statement]);
  const cur = statement?.currency || 'PKR';
  const opening = parseFloat(statement?.opening_balance) || 0;
  const closing = parseFloat(statement?.closing_balance) || 0;
  const totalDebit = useMemo(() => transactions.reduce((s, t) => s + (parseFloat(t.debit) || 0), 0), [transactions]);
  const totalCredit = useMemo(() => transactions.reduce((s, t) => s + (parseFloat(t.credit) || 0), 0), [transactions]);

  return (
    <div ref={cardRef} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-800 text-white">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-300">Customer statement</p>
          <p className="text-sm font-semibold truncate">{customerName}</p>
        </div>
        <div className="statement-actions flex items-center gap-1.5 shrink-0">
          <div className="inline-flex rounded-lg bg-white/10 p-0.5 text-xs">
            <button onClick={() => setView('statement')} className={`px-2 py-1 rounded-md ${view === 'statement' ? 'bg-white text-slate-800 font-medium' : 'text-slate-200'}`}>Statement</button>
            <button onClick={() => setView('allocation')} className={`px-2 py-1 rounded-md ${view === 'allocation' ? 'bg-white text-slate-800 font-medium' : 'text-slate-200'}`}>Allocation</button>
          </div>
          <button onClick={() => printStatement(cardRef.current, `Statement - ${customerName || 'Customer'}`)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs" title="Print">
            <Printer size={13} /> Print
          </button>
          <button onClick={() => printStatement(cardRef.current, `Statement - ${customerName || 'Customer'}`)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs" title="Download PDF">
            <Download size={13} /> PDF
          </button>
          <Link
            to={`/milling/statements?type=customer&id=${customerId}&scope=local`}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs"
            title="Open full statement"
          >
            <ExternalLink size={13} /> Full view
          </Link>
          {onClose && (
            <button onClick={onClose} className="rounded-lg bg-white/10 hover:bg-white/20 p-1.5" title="Close">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {view === 'allocation' ? (
        <div className="p-3"><PartyAllocationLedger partyType="customer" partyId={customerId} /></div>
      ) : (
      <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
        <Tile label="Opening" value={fmtCur(opening, cur)} icon={Scale} tone="text-gray-400" />
        <Tile label="Charged" value={fmtCur(totalDebit, cur)} icon={ArrowUpRight} tone="text-gray-500" />
        <Tile label="Received" value={fmtCur(totalCredit, cur)} icon={ArrowDownLeft} tone="text-emerald-500" />
        <Tile label="They owe" value={fmtCur(closing, cur)} icon={Scale} tone={closing > 0 ? 'text-amber-500' : 'text-emerald-500'} bold />
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading statement…</div>
        ) : isError ? (
          <div className="p-6 text-center text-sm text-rose-500">Failed to load statement: {error?.message || 'error'}</div>
        ) : transactions.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No transactions yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Vch Type</th>
                <th className="text-left font-medium px-3 py-2">Vch No</th>
                <th className="text-left font-medium px-3 py-2">Description</th>
                <th className="text-right font-medium px-3 py-2">Charge (Dr)</th>
                <th className="text-right font-medium px-3 py-2">Received (Cr)</th>
                <th className="text-right font-medium px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="bg-gray-50/60 text-gray-500">
                <td className="px-3 py-1.5" colSpan={6}>Opening balance</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtCur(opening, cur)}</td>
              </tr>
              {transactions.map((t, i) => {
                const link = refLink(t.ref_no);
                return (
                  <tr key={i} className="hover:bg-gray-50/60">
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{fmtDate(t.date)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs text-gray-500">{t.vch_type || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                      {link ? <Link to={link} className="text-blue-600 hover:underline">{t.vch_no || t.ref_no}</Link> : (t.vch_no || t.ref_no || '—')}
                    </td>
                    <td className="px-3 py-1.5 min-w-[200px] max-w-[420px]">
                      <span className="block text-gray-700 whitespace-normal break-words">{t.description || '—'}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">{parseFloat(t.debit) ? fmtCur(t.debit, cur) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600">{parseFloat(t.credit) ? fmtCur(t.credit, cur) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">{fmtCur(t.running_balance, cur)}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                <td className="px-3 py-2" colSpan={4}>Closing balance</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtCur(totalDebit, cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtCur(totalCredit, cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCur(closing, cur)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      {transactions.length > 0 && <LedgerTypeCounts counts={statement?.type_counts} />}
      </>
      )}
    </div>
  );
}

function Tile({ label, value, icon: Icon, tone, bold }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
        {Icon && <Icon size={13} className={tone} />}
      </div>
      <p className={`mt-0.5 tabular-nums ${bold ? 'text-base font-semibold text-gray-900' : 'text-sm text-gray-700'}`}>{value}</p>
    </div>
  );
}
