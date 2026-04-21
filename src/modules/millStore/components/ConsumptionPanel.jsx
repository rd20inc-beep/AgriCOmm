import { useState, useEffect } from 'react';
import { Package, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useConsumptionHistory, useSuggestConsumption, useConfirmConsumption } from '../api/queries';

function formatPKR(v) {
  return 'Rs ' + Math.round(Number(v) || 0).toLocaleString('en-PK');
}

export default function ConsumptionPanel({ batchId, batchStatus, addToast }) {
  const { data: historyData, isLoading: histLoading } = useConsumptionHistory(batchId);
  const suggestMut = useSuggestConsumption();
  const confirmMut = useConfirmConsumption();

  const [suggestions, setSuggestions] = useState(null);
  const [lines, setLines] = useState([]);
  const [showForm, setShowForm] = useState(false);

  const history = historyData || {};
  const logs = Array.isArray(history.logs) ? history.logs : [];
  const isClosed = batchStatus === 'Closed';

  async function handleSuggest() {
    try {
      const res = await suggestMut.mutateAsync(batchId);
      const data = res?.data?.data || res?.data || res;
      const suggs = Array.isArray(data?.suggestions) ? data.suggestions : [];
      setSuggestions(suggs);
      setLines(suggs.map(s => ({
        item_id: s.item_id,
        item_name: s.item_name,
        item_code: s.item_code,
        unit: s.unit,
        category: s.category,
        quantity: s.suggested_qty,
        on_hand: s.on_hand,
        cost_per_unit: s.avg_cost_per_unit,
        sufficient: s.sufficient,
        include: true,
      })));
      setShowForm(true);
    } catch (err) {
      addToast?.(`Failed to get suggestions: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  async function handleConfirm() {
    const toConsume = lines.filter(l => l.include && Number(l.quantity) > 0);
    if (toConsume.length === 0) {
      addToast?.('Select at least one item to consume', 'error');
      return;
    }
    try {
      await confirmMut.mutateAsync({
        batchId,
        data: {
          lines: toConsume.map(l => ({
            item_id: l.item_id,
            quantity: Number(l.quantity),
          })),
        },
      });
      addToast?.('Consumption recorded — stock deducted, batch cost updated', 'success');
      setShowForm(false);
      setSuggestions(null);
    } catch (err) {
      addToast?.(`Failed: ${err?.response?.data?.message || err.message}`, 'error');
    }
  }

  const totalEstimated = lines.filter(l => l.include).reduce(
    (s, l) => s + (Number(l.quantity) || 0) * (Number(l.cost_per_unit) || 0), 0
  );

  return (
    <div className="space-y-5">
      {/* History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Consumption History</h3>
          {history.total_consumption_cost > 0 && (
            <span className="text-sm font-bold text-gray-900">{formatPKR(history.total_consumption_cost)} total</span>
          )}
        </div>
        {histLoading ? (
          <div className="animate-pulse h-16 bg-gray-100 rounded" />
        ) : logs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No consumption recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1.5 px-2 font-semibold text-gray-600">Item</th>
                  <th className="text-left py-1.5 px-2 font-semibold text-gray-600">Category</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-gray-600">Qty</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-gray-600">Cost/unit</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-gray-600">Total</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-gray-600">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="py-1.5 px-2">
                      <span className="font-medium text-gray-900">{l.item_name}</span>
                      <span className="ml-1 text-gray-400 font-mono">{l.item_code}</span>
                    </td>
                    <td className="py-1.5 px-2 capitalize text-gray-500">{l.category}</td>
                    <td className="py-1.5 px-2 text-right">{Number(l.quantity_used)} {l.unit}</td>
                    <td className="py-1.5 px-2 text-right">{formatPKR(l.cost_per_unit)}</td>
                    <td className="py-1.5 px-2 text-right font-medium">{formatPKR(l.total_cost)}</td>
                    <td className="py-1.5 px-2 text-right text-gray-500">{l.used_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record new consumption */}
      {!isClosed && !showForm && (
        <button
          onClick={handleSuggest}
          disabled={suggestMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {suggestMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
          Record Consumption
        </button>
      )}

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Suggested Materials</h3>
            <p className="text-xs text-gray-500">Edit quantities then confirm</p>
          </div>

          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={line.item_id} className="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-gray-100">
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={line.include}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx] = { ...updated[idx], include: e.target.checked };
                      setLines(updated);
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600"
                  />
                </div>
                <div className="col-span-4">
                  <p className="text-sm font-medium text-gray-900">{line.item_name}</p>
                  <p className="text-[11px] text-gray-500 capitalize">{line.category} · {line.unit}</p>
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={line.quantity}
                    onChange={(e) => {
                      const updated = [...lines];
                      updated[idx] = { ...updated[idx], quantity: e.target.value };
                      setLines(updated);
                    }}
                    disabled={!line.include}
                    className="form-input w-full text-sm"
                  />
                </div>
                <div className="col-span-2 text-right">
                  <p className={`text-xs ${line.sufficient ? 'text-green-600' : 'text-red-600'}`}>
                    {line.on_hand} avail
                    {!line.sufficient && <AlertTriangle size={10} className="inline ml-0.5" />}
                  </p>
                </div>
                <div className="col-span-3 text-right">
                  <p className="text-sm font-medium text-gray-900">
                    {formatPKR(Number(line.quantity) * Number(line.cost_per_unit))}
                  </p>
                  <p className="text-[10px] text-gray-400">@ {formatPKR(line.cost_per_unit)}/{line.unit}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <p className="text-sm font-bold text-gray-900">
              Total: {formatPKR(totalEstimated)}
            </p>
            <div className="flex gap-2">
              <button onClick={() => { setShowForm(false); setSuggestions(null); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmMut.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {confirmMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Confirm & Deduct
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
