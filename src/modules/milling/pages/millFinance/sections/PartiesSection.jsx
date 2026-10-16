import { useState } from 'react';
import { Users, Building2, Receipt, Wallet, Banknote } from 'lucide-react';
import SearchSelect from '../../../../../shared/components/SearchSelect';
import { favStar } from '../../../../../shared/utils/favorites';
import MillSupplierStatement from '../../../components/MillSupplierStatement';
import MillCustomerStatement from '../../../components/MillCustomerStatement';
import MillSupplierPayDrawer from '../../../components/MillSupplierPayDrawer';
import MillCustomerPayDrawer from '../../../components/MillCustomerPayDrawer';
import { UNASSIGNED } from '../../../utils/payableBuckets';
import Stat from '../components/Stat';
import { useSupplierDirectory, useCustomerDirectory } from '../hooks/usePartyDirectories';
import useMillFinancePerms from '../hooks/useMillFinancePerms';
import { PKR, COMPACT_PKR } from '../constants';

/**
 * Mill Finance ▸ Parties — what the mill owes each supplier and what each
 * local customer owes the mill, with the statement (finance only — it is the
 * GL party ledger) and Pay / Record Payment through the existing per-invoice
 * drawers. The selected party lives in the URL (?supplier= / ?customer=), so
 * the Mill Suppliers / Customers pages can link straight to a statement.
 */
export default function PartiesSection({ party, supplierId, customerId, go }) {
  return (
    <div className="space-y-4" data-testid="mf-parties">
      <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label="Parties">
        {[['suppliers', 'Suppliers', Building2], ['customers', 'Customers', Users]].map(([k, l, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={party === k}
            onClick={() => go({ party: k, supplier: null, customer: null })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${party === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {Icon && <Icon size={13} aria-hidden="true" />} {l}
          </button>
        ))}
      </div>
      {party === 'customers'
        ? <CustomersView selectedId={customerId} select={(id) => go({ customer: id }, { replace: true })} />
        : <SuppliersView selectedId={supplierId} select={(id) => go({ supplier: id }, { replace: true })} />}
    </div>
  );
}

function SuppliersView({ selectedId, select }) {
  const { canFinance, canPay } = useMillFinancePerms();
  const { rows, totals, suppliers } = useSupplierDirectory();
  const [payParty, setPayParty] = useState(null);
  const found = selectedId ? (suppliers.find((s) => String(s.id) === String(selectedId)) || rows.find((r) => String(r.id) === String(selectedId))) : null;
  const selectedSupplier = found ? { id: found.id, name: found.name } : null;
  const selectSupplier = (s) => select(s ? s.id : null);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Mill suppliers" value={rows.length} sub="with mill payables" tone="slate" icon={Building2} />
        <Stat label="Total billed" value={COMPACT_PKR(totals.billed)} sub={`${COMPACT_PKR(totals.paid)} paid`} tone="blue" icon={Receipt} />
        <Stat label="Outstanding" value={COMPACT_PKR(totals.outstanding)} tone={totals.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
      </div>

      {/* Pick any supplier to view their statement (finance only — the
          statement is the GL party ledger). */}
      {canFinance && (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">View any supplier statement</p>
        <SearchSelect
          value={selectedSupplier?.id || ''}
          onChange={(val) => {
            const s = suppliers.find((x) => String(x.id) === String(val));
            selectSupplier(s ? { id: s.id, name: s.name } : null);
          }}
          options={suppliers.map((s) => ({ value: s.id, label: `${favStar(s)}${s.name}`, sub: s.location || s.city || s.country || '' }))}
          placeholder="Search suppliers…"
        />
      </div>
      )}

      {/* Inline statement */}
      {canFinance && selectedSupplier?.id && (
        <div className="space-y-2">
          {canPay && (
            <div className="flex justify-end">
              <button
                onClick={() => setPayParty({ id: selectedSupplier.id, name: selectedSupplier.name })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-medium"
              >
                <Banknote size={14} /> Record Payment
              </button>
            </div>
          )}
          <MillSupplierStatement
            supplierId={selectedSupplier.id}
            supplierName={selectedSupplier.name}
            onClose={() => selectSupplier(null)}
          />
        </div>
      )}

      {/* Directory */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Mill supplier directory</h3>
          <p className="text-[11px] text-gray-400">{canFinance ? 'Click a supplier to see its statement of money owed & paid.' : 'What the mill owes each supplier — billed, paid and outstanding.'}</p>
        </div>
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No mill supplier payables yet.</div>
          ) : (
            <table className="w-full text-sm mobile-cards">
              <thead>
                <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-medium px-4 py-2">Supplier</th>
                  <th className="text-right font-medium px-4 py-2">Invoices</th>
                  <th className="text-right font-medium px-4 py-2">Billed</th>
                  <th className="text-right font-medium px-4 py-2">Paid</th>
                  <th className="text-right font-medium px-4 py-2">Outstanding</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr
                    key={r.id || r.name}
                    className={`hover:bg-blue-50/40 ${canFinance && r.id && r.id !== UNASSIGNED ? 'cursor-pointer' : ''} ${selectedSupplier?.id === r.id ? 'bg-blue-50/60' : ''}`}
                    onClick={() => canFinance && r.id && r.id !== UNASSIGNED && selectSupplier({ id: r.id, name: r.name })}
                  >
                    <td data-label="Supplier" className="px-4 py-2 font-medium text-gray-800">{r.name}</td>
                    <td data-label="Invoices" className="mob-hide px-4 py-2 text-right tabular-nums text-gray-500">{r.count}</td>
                    <td data-label="Billed" className="px-4 py-2 text-right tabular-nums text-gray-700">{PKR(r.billed)}</td>
                    <td data-label="Paid" className="mob-hide px-4 py-2 text-right tabular-nums text-emerald-600">{PKR(r.paid)}</td>
                    <td data-label="Outstanding" className={`px-4 py-2 text-right tabular-nums font-medium ${r.outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{PKR(r.outstanding)}</td>
                    <td data-label="" className="px-2 py-2 text-right whitespace-nowrap">
                      {canPay && r.id && r.outstanding > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPayParty({ id: r.id, name: r.name }); }}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium mr-2"
                        >
                          <Banknote size={12} /> Pay
                        </button>
                      )}
                      {canFinance && r.id && r.id !== UNASSIGNED && <span className="text-blue-500 text-xs">View →</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {payParty && <MillSupplierPayDrawer supplier={payParty} onClose={() => setPayParty(null)} />}
    </div>
  );
}

function CustomersView({ selectedId, select }) {
  const { canFinance, canPay } = useMillFinancePerms();
  const { rows, totals, customers } = useCustomerDirectory();
  const [payParty, setPayParty] = useState(null);
  const found = selectedId ? customers.find((c) => String(c.id) === String(selectedId)) : null;
  const selectedCustomer = found ? { id: found.id, name: found.name } : null;
  const selectCustomer = (c) => select(c ? c.id : null);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Local customers" value={customers.length} sub="local-sales buyers" tone="slate" icon={Users} />
        <Stat label="Total billed" value={COMPACT_PKR(totals.billed)} sub={`${COMPACT_PKR(totals.paid)} received`} tone="blue" icon={Receipt} />
        <Stat label="Outstanding" value={COMPACT_PKR(totals.outstanding)} sub="owed to mill" tone={totals.outstanding > 0 ? 'amber' : 'green'} icon={Wallet} />
      </div>

      {/* Pick any customer to view their statement (finance only). */}
      {canFinance && (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">View any customer statement</p>
        <SearchSelect
          value={selectedCustomer?.id || ''}
          onChange={(val) => {
            const c = customers.find((x) => String(x.id) === String(val));
            selectCustomer(c ? { id: c.id, name: c.name } : null);
          }}
          options={customers.map((c) => ({ value: c.id, label: `${favStar(c)}${c.name}`, sub: c.country || c.port || '' }))}
          placeholder="Search customers…"
        />
      </div>
      )}

      {/* Inline statement */}
      {canFinance && selectedCustomer?.id && (
        <div className="space-y-2">
          {canPay && (
            <div className="flex justify-end">
              <button
                onClick={() => setPayParty({ id: selectedCustomer.id, name: selectedCustomer.name })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-sm font-medium"
              >
                <Banknote size={14} /> Record Payment
              </button>
            </div>
          )}
          <MillCustomerStatement
            customerId={selectedCustomer.id}
            customerName={selectedCustomer.name}
            onClose={() => selectCustomer(null)}
          />
        </div>
      )}

      {/* Directory */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Local customer directory</h3>
          <p className="text-[11px] text-gray-400">{canFinance ? 'Click a customer to see their statement of sales & receipts.' : 'What each local customer owes the mill — billed, received and outstanding.'}</p>
        </div>
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No local customers yet.</div>
          ) : (
            <table className="w-full text-sm mobile-cards">
              <thead>
                <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-medium px-4 py-2">Customer</th>
                  <th className="text-right font-medium px-4 py-2">Invoices</th>
                  <th className="text-right font-medium px-4 py-2">Billed</th>
                  <th className="text-right font-medium px-4 py-2">Received</th>
                  <th className="text-right font-medium px-4 py-2">Outstanding</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id}
                    className={`${canFinance ? 'cursor-pointer ' : ''}hover:bg-blue-50/40 ${selectedCustomer?.id === r.id ? 'bg-blue-50/60' : ''}`}
                    onClick={() => canFinance && selectCustomer({ id: r.id, name: r.name })}>
                    <td data-label="Customer" className="px-4 py-2 font-medium text-gray-900">
                      {r.name}
                      {(r.contact || r.country) && (
                        <span className="block text-[10px] text-gray-400 font-normal">{[r.contact, r.country].filter(Boolean).join(' · ')}</span>
                      )}
                    </td>
                    <td data-label="Invoices" className="mob-hide px-4 py-2 text-right tabular-nums text-gray-500">{r.count}</td>
                    <td data-label="Billed" className="px-4 py-2 text-right tabular-nums text-gray-700">{PKR(r.billed)}</td>
                    <td data-label="Received" className="mob-hide px-4 py-2 text-right tabular-nums text-emerald-600">{PKR(r.paid)}</td>
                    <td data-label="Outstanding" className={`px-4 py-2 text-right tabular-nums font-medium ${r.outstanding > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{PKR(r.outstanding)}</td>
                    <td data-label="" className="px-2 py-2 text-right whitespace-nowrap">
                      {canPay && r.outstanding > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPayParty({ id: r.id, name: r.name }); }}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium mr-2"
                        >
                          <Banknote size={12} /> Pay
                        </button>
                      )}
                      {canFinance && <span className="text-blue-500 text-xs">View →</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {payParty && <MillCustomerPayDrawer customer={payParty} onClose={() => setPayParty(null)} />}
    </div>
  );
}
