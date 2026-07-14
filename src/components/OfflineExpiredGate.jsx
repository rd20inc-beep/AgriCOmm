// Full-screen gate shown when the 72h offline grace has lapsed (Stage 9, R7).
// Blocks the app until the user reconnects and re-authenticates online. Saved work
// is preserved (not wiped) and syncs once back online. Non-invasive: overlays the
// app rather than changing auth/routing state.
import { useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../offline/useOnline';

export default function OfflineExpiredGate() {
  const { offlineExpired, recheckAuth } = useAuth();
  const online = useOnline();
  const [checking, setChecking] = useState(false);

  if (!offlineExpired) return null;

  const retry = async () => {
    setChecking(true);
    try { await recheckAuth(); } finally { setChecking(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 p-6 text-center">
      <div className="max-w-sm">
        <WifiOff className="mx-auto mb-4 text-amber-400" size={40} />
        <h2 className="text-lg font-bold text-white">You&rsquo;ve been offline too long</h2>
        <p className="mt-2 text-sm text-slate-300">
          For security, offline access is limited to 72 hours. Reconnect to the internet to continue &mdash;
          your saved work is preserved and will sync.
        </p>
        <button
          onClick={retry}
          disabled={checking}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
          {online ? 'Continue' : 'Retry connection'}
        </button>
        {!online && <p className="mt-3 text-xs text-slate-400">Still offline &mdash; connect to Wi-Fi or mobile data.</p>}
      </div>
    </div>
  );
}
