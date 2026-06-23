import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { X, Printer, Download, ArrowDownLeft, ArrowUpRight, Scale, ExternalLink } from 'lucide-react';
import { accountingApi } from '../../accounting/api/services';
import PartyAllocationLedger from './PartyAllocationLedger';
import LedgerTypeCounts from './LedgerTypeCounts';
import OpenItemsPanel from './OpenItemsPanel';
import { printStatement } from './printStatement';

// Statements are shown in the party's transaction currency (mill suppliers are
// PKR), as returned by the backend. Mirrors finance/PartyLedger formatting.
function curSymbol(cur) {
  const c = (cur || 'PKR').toUpperCase();
  return c === 'PKR' ? 'Rs ' : c === 'USD' ? '$' : c === 'EUR' ? '€' : c === 'GBP' ? '£' : `${c} `;
}
const fmtCur = (v, cur) => `${curSymbol(cur)}${Math.round(parseFloat(v) || 0).toLocaleString()}`;

const STATUS_ROW = { Paid: 'bg-emerald-50', Partial: 'bg-amber-50', Unpaid: 'bg-rose-50' };
const STATUS_PILL = { Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700', Unpaid: 'bg-rose-100 text-rose-700' };

const METHOD_LABELS = {
  bank_transfer: 'Bank Transfer', cheque: 'Cheque', cash: 'Cash', online: 'Online',
  mobile: 'Mobile', tt: 'TT', wire: 'Wire', lc: 'Letter of Credit',
};
const methodLabel = (m) => METHOD_LABELS[m] || m;

const refLink = (refNo) => {
  if (!refNo) return null;
  if (refNo.startsWith('EX-')) return `/export/${refNo}`;
  if (refNo.startsWith('M-')) return `/milling/${refNo}`;
  return null;
};

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

/**
 * Inline supplier statement (debits/credits + running balance) for the Mill
 * Finance "Suppliers" tab. Reuses the same /accounting/statements/supplier/:id
 * endpoint the main Finance > Statements page uses, so the numbers reconcile.
 */
export default function MillSupplierStatement({ supplierId, supplierName, params = {}, onClose }) {
  const [view, setView] = useState('statement'); // 'statement' | 'allocation'
  const cardRef = useRef(null);
  const { data: statement, isLoading, isError, error } = useQuery({
    queryKey: ['mill-supplier-statement', supplierId, params],
    enabled: !!supplierId,
    queryFn: async () => {
      const res = await accountingApi.supplierStatement(supplierId, params);
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
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-800 text-white">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-300">Supplier statement</p>
          <p className="text-sm font-semibold truncate">{supplierName}</p>
        </div>
        <div className="statement-actions flex items-center gap-1.5 shrink-0">
          <div className="inline-flex rounded-lg bg-white/10 p-0.5 text-xs">
            <button onClick={() => setView('statement')} className={`px-2 py-1 rounded-md ${view === 'statement' ? 'bg-white text-slate-800 font-medium' : 'text-slate-200'}`}>Statement</button>
            <button onClick={() => setView('allocation')} className={`px-2 py-1 rounded-md ${view === 'allocation' ? 'bg-white text-slate-800 font-medium' : 'text-slate-200'}`}>Allocation</button>
          </div>
          <button onClick={() => printStatement(cardRef.current, `Statement - ${supplierName || 'Supplier'}`)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs" title="Print">
            <Printer size={13} /> Print
          </button>
          <button onClick={() => printStatement(cardRef.current, `Statement - ${supplierName || 'Supplier'}`)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs" title="Download PDF">
            <Download size={13} /> PDF
          </button>
          <Link
            to={`/finance/statements?type=supplier&id=${supplierId}`}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-xs"
            title="Open full statement in Finance"
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
        <div className="p-3"><PartyAllocationLedger partyType="supplier" partyId={supplierId} /></div>
      ) : (
      <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
        <Tile label="Opening" value={fmtCur(opening, cur)} icon={Scale} tone="text-gray-400" />
        <Tile label="Billed to us" value={fmtCur(totalCredit, cur)} icon={ArrowUpRight} tone="text-rose-500" />
        <Tile label="Paid" value={fmtCur(totalDebit, cur)} icon={ArrowDownLeft} tone="text-emerald-500" />
        <Tile label="We owe" value={fmtCur(closing, cur)} icon={Scale} tone={closing > 0 ? 'text-amber-500' : 'text-emerald-500'} bold />
      </div>

      {/* Transactions */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading statement…</div>
        ) : isError ? (
          <div className="p-6 text-center text-sm text-rose-500">Failed to load statement: {error?.message || 'error'}</div>
        ) : transactions.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">No transactions in this period.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-medium px-3 py-2">Date</th>
                <th className="text-left font-medium px-3 py-2">Type</th>
                <th className="text-left font-medium px-3 py-2">Voucher No.</th>
                <th className="text-left font-medium px-3 py-2">Description</th>
                <th className="text-right font-medium px-3 py-2">Paid (Dr)</th>
                <th className="text-right font-medium px-3 py-2">Billed (Cr)</th>
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
                  <tr key={i} className={STATUS_ROW[t.status] || 'hover:bg-gray-50/60'}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{fmtDate(t.date)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-500 text-xs">{t.vch_type || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                      {link ? <Link to={link} className="text-blue-600 hover:underline">{t.ref_no || t.vch_no}</Link> : (t.ref_no || t.vch_no || "—")}
                    </td>
                    <td className="px-3 py-1.5 min-w-[200px] max-w-[420px]">
                      <span className="block text-gray-700 whitespace-normal break-words">
                        {t.status && <span className={`mr-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold align-middle ${STATUS_PILL[t.status]}`}>{t.status}</span>}
                        {t.description || '—'}
                      </span>
                      {(t.account_code || t.account_name) && (
                        <span className="block text-[10px] text-gray-400 whitespace-normal break-words">{t.account_code} {t.account_name}</span>
                      )}
                      {t.paid_via && (
                        <span className="block text-[10px] text-emerald-600 whitespace-normal break-words">
                          Paid via {t.paid_via}{t.payment_method && t.payment_method !== 'cash' ? ` · ${methodLabel(t.payment_method)}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-600">{parseFloat(t.debit) ? fmtCur(t.debit, cur) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{parseFloat(t.credit) ? fmtCur(t.credit, cur) : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">{fmtCur(t.running_balance, cur)}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                <td className="px-3 py-2" colSpan={4}>Closing balance</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtCur(totalDebit, cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-700">{fmtCur(totalCredit, cur)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtCur(closing, cur)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      {transactions.length > 0 && <LedgerTypeCounts counts={statement?.type_counts} />}
      </>
      )}
      {statement?.open_items?.length > 0 && (
        <div className="p-3 border-t border-gray-100"><OpenItemsPanel items={statement.open_items} partyType="supplier" /></div>
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
