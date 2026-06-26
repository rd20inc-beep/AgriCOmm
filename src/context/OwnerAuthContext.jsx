import { createContext, useContext, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import api from '../api/client';

/**
 * Owner-authorized approvals (frontend gate). Policy: only the Owner role
 * approves directly; everyone else must name which owner authorized it.
 *
 * Usage at any approve site:
 *   const { requestOwnerApproval } = useOwnerAuth();
 *   requestOwnerApproval((ownerId) => api.approve(id, { authorized_by_owner_id: ownerId }))
 *
 * If the current user IS an Owner, the action runs immediately with the owner's
 * own id. Otherwise a single global modal asks which owner authorized it, then
 * runs the action with that owner id. The backend enforces the same rule, so
 * this is UX, not security.
 */
const OwnerAuthContext = createContext(null);
export const useOwnerAuth = () => useContext(OwnerAuthContext) || { requestOwnerApproval: (fn) => fn(undefined), isOwner: false };

export function OwnerAuthProvider({ children }) {
  const { user } = useAuth();
  const isOwner = user?.role === 'Owner';
  const [pending, setPending] = useState(null); // { action, label, resolve, reject }
  const [ownerId, setOwnerId] = useState('');
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
      setPending({ action, opts, resolve, reject });
    });
  }, [isOwner, user]);

  async function confirm() {
    if (!ownerId || !pending) return;
    setBusy(true);
    try {
      const res = await pending.action(parseInt(ownerId, 10));
      pending.resolve?.(res);
      setPending(null);
    } catch (e) {
      pending.reject?.(e);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    pending?.reject?.(new Error('Owner authorization cancelled'));
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
                <p className="text-xs text-gray-500">{pending.opts.label || 'Only an Owner can approve. Which owner authorized this?'}</p>
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
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={cancel} className="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={confirm} disabled={busy || !ownerId}
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
