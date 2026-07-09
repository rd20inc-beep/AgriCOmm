import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles, RefreshCw, ShieldCheck, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import api from '../../../api/client';

const SEV_DOT = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-400' };
const SEV_TEXT = { high: 'text-red-700', medium: 'text-amber-700', low: 'text-slate-600' };

// Finance-dashboard card: auto-scans for anomalies via the AI endpoint, cached
// 10 min (so it surfaces proactively without an OpenAI call on every page view).
export default function AnomalyWatchCard() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['ai-anomalies'],
    queryFn: async () => (await api.get('/api/ai/anomalies'))?.data,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const aiOff = data && data.aiEnabled === false;
  const anomalies = data?.anomalies || [];
  const top = anomalies.slice(0, 4);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
          <h2 className="text-sm font-semibold text-gray-900">AI Anomaly Watch</h2>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/ai" className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5">Open <ExternalLink className="w-3 h-3" /></Link>
          <button onClick={() => refetch()} disabled={isFetching || aiOff} title="Re-scan" className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-40">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {aiOff ? (
        <p className="text-xs text-gray-400 py-3">AI is off. Add <code className="px-1 bg-gray-100 rounded">OPENAI_API_KEY</code> on the server to surface anomalies here.</p>
      ) : isFetching && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Scanning payroll, GL, stock & cash…</div>
      ) : anomalies.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-600 py-3"><ShieldCheck className="w-4 h-4" /> All clear — nothing unusual found.</div>
      ) : (
        <div className="space-y-2">
          {top.map((a, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEV_DOT[a.severity] || SEV_DOT.low}`} />
              <div className="min-w-0">
                <div className="text-sm text-gray-800"><span className={`font-medium ${SEV_TEXT[a.severity] || ''}`}>{a.title}</span> <span className="text-[10px] uppercase text-gray-400">· {a.area}</span></div>
                <div className="text-xs text-gray-500 truncate">{a.detail}</div>
              </div>
            </div>
          ))}
          {anomalies.length > top.length && (
            <Link to="/ai" className="block text-xs text-blue-600 hover:underline pt-1">+{anomalies.length - top.length} more →</Link>
          )}
        </div>
      )}
    </div>
  );
}
