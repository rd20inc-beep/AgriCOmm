import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';
import { chatApi } from '../../chat/api';
import { useAcceptFundTransfer } from '../../../api/queries';
import { useApp } from '../../../context/AppContext';

const unwrap = (res) => res?.data || res || {};

/**
 * Pending approvals on the dashboard — the SAME feed the chat widget shows
 * (/api/chat/approvals: fund transfers, export confirmations, stock adjustments,
 * master-data). Shares the ['chat-approvals'] query cache with ChatWidget so the
 * two never disagree. `excludeKinds` lets the dashboard hide kinds it already
 * renders with a richer inline UI (milling batches have their own approve/reject
 * card), to avoid showing them twice.
 */
export default function PendingApprovalsCard({ excludeKinds = [] }) {
  const navigate = useNavigate();
  const { addToast } = useApp();
  const acceptTransfer = useAcceptFundTransfer();

  const { data, isLoading } = useQuery({
    queryKey: ['chat-approvals'],
    queryFn: async () => unwrap(await chatApi.approvals()),
    refetchInterval: 15000,
  });

  const items = (data?.items || []).filter((a) => !excludeKinds.includes(a.kind));

  async function act(item) {
    if (item.kind === 'fund_transfer') {
      try {
        await acceptTransfer.mutateAsync(item.transferId);
        addToast?.('Funds accepted', 'success');
      } catch (e) {
        addToast?.(e?.response?.data?.message || e?.message || 'Could not accept funds', 'error');
      }
    } else if (item.link) {
      navigate(item.link);
    }
  }

  // Nothing to show — render nothing so the dashboard stays tidy.
  if (!isLoading && items.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Pending approvals ({items.length})
      </p>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${a.kind === 'fund_transfer' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                  {a.kind === 'fund_transfer' ? <CheckCircle2 className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{a.message}</p>
                </div>
              </div>
              <div className="flex-shrink-0">
                {a.kind === 'fund_transfer' ? (
                  <button onClick={() => act(a)} disabled={acceptTransfer.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Accept funds
                  </button>
                ) : (
                  <button onClick={() => act(a)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                    Review →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
