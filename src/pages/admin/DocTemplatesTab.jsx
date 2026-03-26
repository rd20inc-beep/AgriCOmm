import { Files, Eye, Edit3 } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function DocTemplatesTab() {
  const { addToast } = useApp();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Files className="w-5 h-5 text-gray-600" />
            Document Templates
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { name: 'Proforma Invoice', status: 'Active' },
            { name: 'Commercial Invoice', status: 'Active' },
            { name: 'Packing List', status: 'Active' },
            { name: 'Bill of Lading', status: 'Active' },
            { name: 'Phytosanitary Certificate', status: 'Active' },
            { name: 'Certificate of Origin', status: 'Active' },
            { name: 'Fumigation Certificate', status: 'Active' },
          ].map((tpl) => (
            <div key={tpl.name} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-medium text-gray-900 text-sm">{tpl.name}</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">{tpl.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => addToast(`Preview: ${tpl.name}`, 'info')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>
                <button
                  onClick={() => addToast(`Edit Template: ${tpl.name}`, 'info')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Edit Template
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
