import { UsersRound, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function UsersRolesTab() {
  const { addToast } = useApp();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UsersRound className="w-5 h-5 text-gray-600" />
            Users & Roles
          </h2>
          <button onClick={() => addToast('Invite User form coming soon', 'info')} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Invite User
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-600">Name</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Email</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Role</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Admin User', email: 'admin@riceflow.com', role: 'Super Admin', color: 'bg-purple-100 text-purple-700' },
                { name: 'Akmal Amin', email: 'akmal@agririce.com', role: 'Export Manager', color: 'bg-blue-100 text-blue-700' },
                { name: 'Finance Team', email: 'finance@agririce.com', role: 'Finance Manager', color: 'bg-green-100 text-green-700' },
                { name: 'Mill Manager', email: 'mill@agririce.com', role: 'Mill Manager', color: 'bg-amber-100 text-amber-700' },
                { name: 'QC Analyst', email: 'qc@agririce.com', role: 'QC Analyst', color: 'bg-cyan-100 text-cyan-700' },
                { name: 'Doc Officer', email: 'docs@agririce.com', role: 'Documentation Officer', color: 'bg-indigo-100 text-indigo-700' },
              ].map((user) => (
                <tr key={user.email} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{user.name}</td>
                  <td className="py-3 px-4 text-gray-600">{user.email}</td>
                  <td className="py-3 px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${user.color}`}>{user.role}</span></td>
                  <td className="py-3 px-4"><span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
