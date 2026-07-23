import { useState } from 'react';
import { UsersRound, Plus, XCircle, CheckCircle, KeyRound, Trash2, Pencil, Shield, ChevronDown, Lock, Unlock, RotateCcw, Link2, Ban } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useUsers, useCreateUser, useDeactivateUser, useActivateUser, useSetUserPassword, useDeleteUser, useUpdateUser, useSetUserStatus, useForceUserPasswordChange, useUserResetLink, useRevokeUserSessions } from '../../../../api/queries';
import Modal from '../../components/AdminDrawer';

// #9 Account lifecycle status badge colours.
const STATUS_BADGE = {
  active: 'bg-emerald-100 text-emerald-700',
  invited: 'bg-blue-100 text-blue-700',
  suspended: 'bg-amber-100 text-amber-700',
  locked: 'bg-orange-100 text-orange-700',
  deactivated: 'bg-red-100 text-red-700',
};

function MenuItem({ icon: Icon, label, onClick, tone }) {
  const t = tone === 'red' ? 'text-red-600 hover:bg-red-50' : tone === 'emerald' ? 'text-emerald-700 hover:bg-emerald-50' : 'text-gray-700 hover:bg-gray-50';
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium ${t}`}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

const ROLES = [
  { id: 1, name: 'Super Admin', color: 'bg-purple-100 text-purple-700' },
  { id: 2, name: 'Export Manager', color: 'bg-blue-100 text-blue-700' },
  { id: 3, name: 'Finance Manager', color: 'bg-emerald-100 text-emerald-700' },
  { id: 4, name: 'Mill Manager', color: 'bg-amber-100 text-amber-700' },
  { id: 5, name: 'QC Analyst', color: 'bg-cyan-100 text-cyan-700' },
  { id: 6, name: 'Documentation Officer', color: 'bg-indigo-100 text-indigo-700' },
  { id: 7, name: 'Viewer', color: 'bg-gray-100 text-gray-700' },
];

function getRoleColor(roleName) {
  const role = ROLES.find(r => r.name === roleName);
  return role?.color || 'bg-gray-100 text-gray-700';
}

export default function UsersRolesTab() {
  const { addToast } = useApp();
  const { data: users = [], isLoading } = useUsers();
  const createUserMut = useCreateUser();
  const deactivateMut = useDeactivateUser();
  const activateMut = useActivateUser();
  const setPasswordMut = useSetUserPassword();
  const deleteUserMut = useDeleteUser();
  const updateUserMut = useUpdateUser();

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', roleId: '2' });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const [pwUser, setPwUser] = useState(null);   // user whose password is being set
  const [pwValue, setPwValue] = useState('');

  const [editUser, setEditUser] = useState(null);  // user being edited
  const [editForm, setEditForm] = useState({ fullName: '', email: '', roleId: '2' });
  const openEdit = (user) => {
    setEditUser(user);
    setEditForm({ fullName: user.fullName || '', email: user.email || '', roleId: String(user.roleId || 2) });
  };
  const handleUpdate = async () => {
    if (!editForm.fullName.trim() || !editForm.email.trim()) { addToast('Name and email are required', 'error'); return; }
    try {
      await updateUserMut.mutateAsync({ id: editUser.id, data: {
        full_name: editForm.fullName.trim(),
        email: editForm.email.trim().toLowerCase(),
        role_id: parseInt(editForm.roleId),
      } });
      addToast(`${editForm.fullName.trim()} updated`, 'success');
      setEditUser(null);
    } catch (err) {
      addToast(`Failed to update user: ${err.message}`, 'error');
    }
  };

  const handleSetPassword = async () => {
    if (!pwValue || pwValue.length < 8) { addToast('Password must be at least 8 characters', 'error'); return; }
    try {
      await setPasswordMut.mutateAsync({ id: pwUser.id, password: pwValue });
      addToast(`Password updated for ${pwUser.fullName}`, 'success');
      setPwUser(null); setPwValue('');
    } catch (err) {
      addToast(`Failed to update password: ${err.message}`, 'error');
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Permanently delete ${user.fullName}? This can't be undone. (If they have activity in the system, deactivate them instead.)`)) return;
    try {
      await deleteUserMut.mutateAsync(user.id);
      addToast(`${user.fullName} deleted`, 'success');
    } catch (err) {
      addToast(err.message || 'Failed to delete user', 'error');
    }
  };

  const resetForm = () => setForm({ fullName: '', email: '', password: '', roleId: '2' });

  const handleCreate = async () => {
    if (!form.fullName.trim() || !form.email.trim() || !form.password) {
      addToast('Name, email, and password are required', 'error');
      return;
    }
    try {
      await createUserMut.mutateAsync({
        full_name: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role_id: parseInt(form.roleId),
      });
      addToast(`User "${form.fullName.trim()}" created`, 'success');
      resetForm();
      setShowModal(false);
    } catch (err) {
      addToast(`Failed to create user: ${err.message}`, 'error');
    }
  };

  const handleToggleActive = async (user) => {
    try {
      if (user.isActive) {
        await deactivateMut.mutateAsync(user.id);
        addToast(`${user.fullName} deactivated`, 'info');
      } else {
        await activateMut.mutateAsync(user.id);
        addToast(`${user.fullName} activated`, 'success');
      }
    } catch (err) {
      addToast(`Failed to update user: ${err.message}`, 'error');
    }
  };

  // #9 lifecycle + security
  const statusMut = useSetUserStatus();
  const forcePwMut = useForceUserPasswordChange();
  const resetLinkMut = useUserResetLink();
  const revokeMut = useRevokeUserSessions();
  const [menuFor, setMenuFor] = useState(null); // user id whose security menu is open

  const run = async (fn, ok) => { try { const r = await fn(); addToast(typeof ok === 'function' ? ok(r) : ok, 'success'); setMenuFor(null); } catch (e) { addToast(e?.data?.message || e?.message || 'Action failed', 'error'); } };
  const setStatus = (user, status) => run(() => statusMut.mutateAsync({ id: user.id, status }), `${user.fullName} is now ${status}.`);
  const forcePw = (user) => run(() => forcePwMut.mutateAsync({ id: user.id, force: true }), `${user.fullName} must reset their password at next sign-in.`);
  const revoke = (user) => run(() => revokeMut.mutateAsync(user.id), `Signed out all active sessions for ${user.fullName}.`);
  const resetLink = (user) => run(async () => {
    const r = await resetLinkMut.mutateAsync(user.id);
    const link = r?.data?.link ? `${window.location.origin}${r.data.link}` : '';
    if (link && navigator.clipboard) { try { await navigator.clipboard.writeText(link); } catch { /* ignore */ } }
    return r;
  }, `Reset link generated for ${user.fullName} (copied to clipboard, valid 24h).`);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UsersRound className="w-5 h-5 text-gray-600" />
            Users & Roles
            <span className="ml-2 text-xs font-normal text-gray-500">({users.length} users)</span>
          </h2>
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Invite User
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Name</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Email</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Role</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Status</th>
                <th className="text-left py-3 px-4 font-semibold text-gray-600">Last Login</th>
                <th className="text-center py-3 px-4 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading users...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found.</td></tr>
              ) : users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-gray-900">{user.fullName}</td>
                  <td className="py-3 px-4 text-gray-600">{user.email}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getRoleColor(user.roleName)}`}>
                      {user.roleName || 'Unknown'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${STATUS_BADGE[user.status] || (user.isActive ? STATUS_BADGE.active : STATUS_BADGE.deactivated)}`}>
                        {user.status || (user.isActive ? 'active' : 'deactivated')}
                      </span>
                      {user.forcePasswordChange && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700" title="Must reset password at next sign-in">pw reset</span>}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => openEdit(user)}
                        title="Edit name, email or role"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => { setPwUser(user); setPwValue(''); }}
                        title="Set / reset this user's password"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors"
                      >
                        <KeyRound className="w-3.5 h-3.5" /> Password
                      </button>
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                          user.isActive
                            ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                            : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        {user.isActive ? <><XCircle className="w-3.5 h-3.5" /> Deactivate</> : <><CheckCircle className="w-3.5 h-3.5" /> Activate</>}
                      </button>
                      {/* #9 Security menu */}
                      <div className="relative">
                        <button
                          onClick={() => setMenuFor(menuFor === user.id ? null : user.id)}
                          title="Account security"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          <Shield className="w-3.5 h-3.5" /> Security <ChevronDown className="w-3 h-3" />
                        </button>
                        {menuFor === user.id && (
                          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 text-left">
                            {user.status !== 'suspended'
                              ? <MenuItem icon={Ban} label="Suspend account" onClick={() => setStatus(user, 'suspended')} />
                              : <MenuItem icon={CheckCircle} label="Reactivate account" onClick={() => setStatus(user, 'active')} tone="emerald" />}
                            {user.status !== 'locked'
                              ? <MenuItem icon={Lock} label="Lock account" onClick={() => setStatus(user, 'locked')} />
                              : <MenuItem icon={Unlock} label="Unlock account" onClick={() => setStatus(user, 'active')} tone="emerald" />}
                            <MenuItem icon={RotateCcw} label="Force password change" onClick={() => forcePw(user)} />
                            <MenuItem icon={Link2} label="Send password-reset link" onClick={() => resetLink(user)} />
                            <MenuItem icon={XCircle} label="Revoke all sessions" onClick={() => revoke(user)} tone="red" />
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(user)}
                        title="Permanently delete this user"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Invite New User" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input type="text" value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="Full name" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@company.com" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Minimum 8 characters" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={form.roleId} onChange={e => set('roleId', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
              {ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleCreate} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">Create User</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={`Edit user — ${editUser?.fullName || ''}`} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
            <input type="text" value={editForm.fullName} onChange={e => setEditForm(p => ({ ...p, fullName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select value={editForm.roleId} onChange={e => setEditForm(p => ({ ...p, roleId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
              {ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setEditUser(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleUpdate} disabled={updateUserMut.isPending} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Save Changes</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!pwUser} onClose={() => setPwUser(null)} title={`Set password — ${pwUser?.fullName || ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Set a new password for <span className="font-semibold text-gray-900">{pwUser?.email}</span>. They'll use it on their next login.</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password *</label>
            <input
              type="password" value={pwValue} autoFocus
              onChange={e => setPwValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSetPassword(); }}
              placeholder="Minimum 8 characters"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button onClick={() => setPwUser(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
            <button onClick={handleSetPassword} disabled={setPasswordMut.isPending || pwValue.length < 8} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Update Password</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
