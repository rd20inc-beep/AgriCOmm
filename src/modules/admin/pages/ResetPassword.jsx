// Public password-reset page — the target of the emailed link and of the
// admin "Send password-reset link" action. The token arrives in the URL
// #fragment (never sent to the server, so it stays out of access logs); a legacy
// ?token= link still works. A successful reset also clears a sign-in lockout and
// signs the account out everywhere.
import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { authRepo } from '../../../data/repositories/auth';

function readToken(location) {
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  return hash.get('token') || new URLSearchParams(location.search || '').get('token') || '';
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useMemo(() => readToken(location), [location]);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Drop the token from the address bar/history once read.
  useEffect(() => {
    if (token && typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', '/reset-password');
    }
  }, [token]);

  const valid = form.password.length >= 8 && form.password === form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || !token) return;
    setBusy(true);
    setError('');
    try {
      const r = await authRepo.resetPassword(token, form.password);
      if (r.ok) {
        navigate('/login?reset=1', { replace: true });
        return;
      }
      setError((r.data && r.data.message) || 'Could not reset the password.');
    } catch {
      setError('Server is unreachable. Please try again later.');
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 mb-2"><KeyRound className="w-6 h-6 text-blue-600" /></div>
          <h1 className="text-lg font-bold text-gray-900">Set a new password</h1>
        </div>
        {!token ? (
          <p className="text-sm text-red-600">This reset link is incomplete. Request a new one from the sign-in page.</p>
        ) : (
          <>
            <div>
              <label htmlFor="rp-new" className="block text-xs font-medium text-gray-600 mb-1">New password (min 8 characters)</label>
              <input id="rp-new" type="password" autoComplete="new-password" value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label htmlFor="rp-confirm" className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
              <input id="rp-confirm" type="password" autoComplete="new-password" value={form.confirm}
                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {form.confirm && form.password !== form.confirm && (
                <p className="text-xs text-red-600 mt-1">Passwords do not match.</p>
              )}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={!valid || busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reset password'}
            </button>
          </>
        )}
        <button type="button" onClick={() => navigate('/login')} className="w-full text-xs text-gray-500 hover:text-gray-700">
          Back to sign in
        </button>
      </form>
    </div>
  );
}
