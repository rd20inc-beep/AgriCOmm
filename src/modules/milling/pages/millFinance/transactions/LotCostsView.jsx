import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck, Layers, ExternalLink, Banknote } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { useMillLotCosts } from '../../../../../api/queries';
import useMillFinancePerms from '../hooks/useMillFinancePerms';
import { PayTransporterDrawer } from '../drawers/PayableDrawers';
import { PKR } from '../constants';

/**
 * Lot additional costs (transport, labour, unloading, packing, bags…) traced
 * to the source lot; a transporter's freight payable is paid inline (#14).
 */
export default function LotCostsView() {
  const { addToast } = useApp();
  const { canPay } = useMillFinancePerms();
  const { data: lotCosts = { categories: [], grandTotal: 0 } } = useMillLotCosts();
  const [payTransport, setPayTransport] = useState(null);
  return (
    <div className="space-y-4" data-testid="mf-lotcosts">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Lot additional costs</h3>
          <p className="text-xs text-gray-500">Transport, labor, unloading, packing, bag &amp; other — itemised and traced to the source lot.</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total recorded</p>
          <p className="text-lg font-bold text-gray-900">{PKR(lotCosts.grandTotal)}</p>
        </div>
      </div>

      {(!lotCosts.categories || lotCosts.categories.length === 0) ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">No additional costs recorded on any lot yet.</div>
      ) : (
        <div className="space-y-3">
          {lotCosts.categories.map((cat) => (
            <div key={cat.key} className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  {cat.key === 'transport' ? <Truck size={15} className="text-indigo-500 shrink-0" /> : <Layers size={15} className="text-gray-400 shrink-0" />}
                  <span className="font-semibold text-gray-800 text-sm">{cat.label}</span>
                  <span className="text-[11px] text-gray-400">{cat.count} lot{cat.count === 1 ? '' : 's'}</span>
                  {cat.inCogs
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">in rice cost</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">hauler payable</span>}
                </div>
                <span className="font-bold text-gray-900 text-sm tabular-nums">{PKR(cat.total)}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {cat.lots.map((l) => (
                  <div key={l.lotId} className="flex items-center justify-between px-4 py-2 text-sm gap-3">
                    <Link to={`/lot-inventory/${l.lotNo}`} className="font-mono text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0">
                      {l.lotNo}<ExternalLink size={11} />
                    </Link>
                    <div className="flex items-center gap-3 min-w-0">
                      {cat.key === 'transport' && (
                        l.unassigned
                          ? <span className="text-[11px] text-amber-600 whitespace-nowrap">no hauler set</span>
                          : <span className="text-[11px] text-gray-500 truncate">{l.haulerName || '—'}{l.outstanding > 0 ? ` · ${PKR(l.outstanding)} due` : ' · paid'}</span>
                      )}
                      {/* #14 — pay the transporter right here (opens a slider that
                          records against the real transporter payable). */}
                      {cat.key === 'transport' && canPay && l.payableId && l.outstanding > 0 && (
                        <button onClick={() => setPayTransport({ payableId: l.payableId, haulerName: l.haulerName, outstanding: l.outstanding, lotNo: l.lotNo })}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-[11px] font-medium shrink-0">
                          <Banknote size={11} /> Pay
                        </button>
                      )}
                      <span className="font-medium text-gray-900 tabular-nums shrink-0">{PKR(l.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-gray-400">In-rice-cost items are part of finished COGS (inside Raw Material). Transport is a separate payable owed to the hauler.</p>
        </div>
      )}
      {payTransport && <PayTransporterDrawer payTransport={payTransport} onClose={() => setPayTransport(null)} addToast={addToast} />}
    </div>
  );
}
