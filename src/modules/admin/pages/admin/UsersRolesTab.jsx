import { useState } from 'react';
import { UsersRound, Plus, Shield, XCircle, CheckCircle } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useUsers, useCreateUser, useDeactivateUser, useActivateUser } from '../../../../api/queries';
import Modal from '../../../../components/Modal';

const ROLES = [
  { id: 1, name: 'Super Admin', color: 'bg-purple-100 text-purple-700' },
  { id: 2, name: 'Export Manager', color: 'bg-blue-100 text-blue-700' },
  { id: 3, name: 'Finance Manager', color: 'bg-green-100 text-green-700' },
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

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', password: '', roleId: '2' });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

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
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleToggleActive(user)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                        user.isActive
                          ? 'text-red-600 bg-red-50 hover:bg-red-100'
                          : 'text-green-600 bg-green-50 hover:bg-green-100'
                      }`}
                    >
                      {user.isActive ? <><XCircle className="w-3.5 h-3.5" /> Deactivate</> : <><CheckCircle className="w-3.5 h-3.5" /> Activate</>}
                    </button>
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
    </div>
  );
}
