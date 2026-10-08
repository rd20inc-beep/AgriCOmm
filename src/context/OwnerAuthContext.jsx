import { createContext, useContext, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import api, { withOwnerCredential } from '../api/client';

/**
 * Owner-authorized approvals (owner decision G-11): the Owner must actually
 * approve. An Owner acting themselves runs the action directly; anyone else
 * gets a modal where the authorizing Owner picks their name and enters THEIR
 * password on this screen. The password rides on that one request as the
 * X-Owner-Credential header (api/client withOwnerCredential) and the server
 * checks it before the action runs (backend middleware/ownerApproval.js) —
 * wrong password: 403 and nothing happens; 5 wrong in 15 min: locked 15 min.
 *
 * Usage at any approve site (unchanged):
 *   const { requestOwnerApproval } = useOwnerAuth();
 *   requestOwnerApproval((ownerId) => api.approve(id, { authorized_by_owner_id: ownerId }))
 */
const OwnerAuthContext = createContext(null);
export const useOwnerAuth = () => useContext(OwnerAuthContext) || { requestOwnerApproval: (fn) => fn(undefined), isOwner: false };

export function OwnerAuthProvider({ children }) {
  const { user } = useAuth();
  const isOwner = user?.role === 'Owner';
  const [pending, setPending] = useState(null); // { action, label, resolve, reject }
  const [ownerId, setOwnerId] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: owners = [], isLoading: ownersLoading } = useQuery({
    queryKey: ['owners-list'],
    queryFn: async () => { const r = await api.get('/api/users/owners'); return r?.data?.owners || r?.owners || []; },
    enabled: !!user && !isOwner,
    staleTime: 5 * 60 * 1000,
  });

  const requestOwnerApproval = useCallback((action, opts = {}) => {
    // Owner → run directly with their own id (backend records self-approval).
    if (isOwner) return Promise.resolve(action(user?.id));
    return new Promise((resolve, reject) => {
      setOwnerId('');
      setPassword('');
      setAuthError('');
      setPending({ action, opts, resolve, reject });
    });
  }, [isOwner, user]);

  async function confirm() {
    if (!ownerId || !password || !pending) return;
    setBusy(true);
    setAuthError('');
    const id = parseInt(ownerId, 10);
    try {
      const res = await withOwnerCredential(id, password, () => pending.action(id));
      pending.resolve?.(res);
      setPending(null);
    } catch (e) {
      const code = e?.data?.code;
      if (code === 'OWNER_AUTH_FAILED' || code === 'OWNER_AUTH_LOCKED' || code === 'OWNER_AUTH_CREDENTIAL_REQUIRED') {
        // Nothing was done — let the owner try again (or wait out a lockout).
        setAuthError(e.message || 'Owner authorization failed.');
      } else {
        pending.reject?.(e);
        setPending(null);
      }
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  function cancel() {
    pending?.reject?.(new Error('Owner authorization cancelled'));
    setPassword('');
    setPending(null);
  }

  return (
    <OwnerAuthContext.Provider value={{ requestOwnerApproval, isOwner }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={cancel}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Owner authorization</h3>
                <p className="text-xs text-gray-500">{pending.opts.label || 'Only an Owner can approve. The owner enters their own password here.'}</p>
              </div>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Authorizing owner</label>
            {ownersLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading owners…</div>
            ) : owners.length === 0 ? (
              <p className="text-sm text-red-600 py-2">No active owners found. An owner must be configured to approve.</p>
            ) : (
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} autoFocus
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500">
                <option value="">Select owner…</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
              </select>
            )}
            <label htmlFor="owner-auth-password" className="block text-sm font-medium text-gray-700 mt-3 mb-1">Owner's password</label>
            <input id="owner-auth-password" type="password" autoComplete="off" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
              placeholder="The owner types their password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
            {authError && <p role="alert" className="text-xs text-red-600 mt-2">{authError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={cancel} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={confirm} disabled={busy || !ownerId || !password}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Confirm & approve
              </button>
            </div>
          </div>
        </div>
      )}
    </OwnerAuthContext.Provider>
  );
}
