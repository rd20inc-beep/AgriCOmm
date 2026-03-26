import { Factory, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function MillsTab() {
  const { addToast } = useApp();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Factory className="w-5 h-5 text-gray-600" />
            Mills
          </h2>
          <button onClick={() => addToast('Add Mill form coming soon', 'info')} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Mill
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-600">Name</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Location</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Capacity (MT/day)</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-4 font-medium text-gray-900">Agri Rice Mill</td>
                <td className="py-3 px-4 text-gray-600">Karachi</td>
                <td className="py-3 px-4 text-gray-600">50</td>
                <td className="py-3 px-4"><span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span></td>
              </tr>
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-4 font-medium text-gray-900">ARC Processing Unit</td>
                <td className="py-3 px-4 text-gray-600">Hyderabad</td>
                <td className="py-3 px-4 text-gray-600">30</td>
                <td className="py-3 px-4"><span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span></td>
              </tr>
              <tr className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-4 font-medium text-gray-900">Sindh Rice Processors</td>
                <td className="py-3 px-4 text-gray-600">Sukkur</td>
                <td className="py-3 px-4 text-gray-600">20</td>
                <td className="py-3 px-4"><span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Maintenance</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
