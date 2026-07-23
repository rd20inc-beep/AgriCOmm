// #9 Change Password — self-service. Also the forced landing page when an admin
// has set force_password_change (a temp password / new account): the user must
// set their own password before using the app.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useApp } from '../../../context/AppContext';
import { authApi } from '../api/services';

export default function ChangePassword() {
  const { user, logout, recheckAuth } = useAuth();
  const { addToast } = useApp();
  const navigate = useNavigate();
  const forced = !!(user?.force_password_change || user?.forcePasswordChange);
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [busy, setBusy] = useState(false);

  const valid = form.oldPassword && form.newPassword.length >= 8 && form.newPassword === form.confirm;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await authApi.changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
      addToast('Password changed.', 'success');
      await recheckAuth?.();
      navigate('/');
    } catch (e) {
      addToast(e?.data?.message || e?.message || 'Could not change the password.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 mb-2"><KeyRound className="w-6 h-6 text-blue-600" /></div>
          <h1 className="text-lg font-bold text-gray-900">{forced ? 'Set a new password' : 'Change password'}</h1>
          <p className="text-xs text-gray-500 mt-1">{forced ? 'For your security, you must set your own password before continuing.' : 'Update your account password.'}</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{forced ? 'Current / temporary password' : 'Current password'}</label>
            <input type="password" value={form.oldPassword} onChange={e => set('oldPassword', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" autoComplete="current-password" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
            <input type="password" value={form.newPassword} onChange={e => set('newPassword', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" autoComplete="new-password" />
            <p className="text-[11px] text-gray-400 mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
            <input type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" autoComplete="new-password" />
            {form.confirm && form.confirm !== form.newPassword && <p className="text-[11px] text-red-600 mt-1">Passwords don't match.</p>}
          </div>
        </div>
        <button onClick={submit} disabled={!valid || busy} className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{busy ? 'Saving…' : 'Set password'}</button>
        <button onClick={logout} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-700"><LogOut className="w-3.5 h-3.5" /> Sign out</button>
      </div>
    </div>
  );
}
