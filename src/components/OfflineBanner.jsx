// A thin, unobtrusive banner shown while the app can't reach the server. Makes
// the offline state obvious (so users know saves are held / data is a snapshot)
// instead of silently failing. Reappears/clears automatically on reconnect.
import { WifiOff } from 'lucide-react';
import { useOnline } from '../offline/useOnline';

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white shadow-sm">
      <WifiOff size={14} />
      <span>You're offline — showing saved data. New changes will sync when the connection returns.</span>
    </div>
  );
}
