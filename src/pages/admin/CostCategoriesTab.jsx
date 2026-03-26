import { useState } from 'react';
import { Tags, Factory, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export default function CostCategoriesTab() {
  const {
    exportCostCategories, addExportCostCategory,
    millingCostCategories, addMillingCostCategory,
    companyProfileData,
    addToast,
  } = useApp();

  // Export cost category inline form state
  const [showCostCatForm, setShowCostCatForm] = useState(false);
  const [costCatKey, setCostCatKey] = useState('');
  const [costCatLabel, setCostCatLabel] = useState('');

  // Milling cost category inline form state
  const [showMillCostForm, setShowMillCostForm] = useState(false);
  const [millCostKey, setMillCostKey] = useState('');
  const [millCostLabel, setMillCostLabel] = useState('');

  return (
    <div className="space-y-6">
      {/* Export Cost Categories */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Tags className="w-5 h-5 text-indigo-600" />
            Export Cost Categories
          </h2>
          <button
            onClick={() => { setCostCatKey(''); setCostCatLabel(''); setShowCostCatForm(true); }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>
        {showCostCatForm && (
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50/50 flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Key</label>
              <input
                type="text"
                value={costCatKey}
                onChange={(e) => setCostCatKey(e.target.value)}
                placeholder="e.g. freight"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
              <input
                type="text"
                value={costCatLabel}
                onChange={(e) => setCostCatLabel(e.target.value)}
                placeholder="e.g. Freight Charges"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <button
              onClick={() => {
                if (!costCatKey.trim() || !costCatLabel.trim()) {
                  addToast('Both key and label are required', 'error');
                  return;
                }
                addExportCostCategory({ key: costCatKey.trim(), label: costCatLabel.trim() });
                addToast(`Export cost category "${costCatLabel.trim()}" added successfully`, 'success');
                setCostCatKey('');
                setCostCatLabel('');
                setShowCostCatForm(false);
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setShowCostCatForm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Key</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(exportCostCategories || []).map((cat, idx) => (
                <tr key={cat.key || idx} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{cat.key}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{cat.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Milling Cost Categories */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Factory className="w-5 h-5 text-orange-600" />
            Milling Cost Categories
            <span className="text-xs font-normal text-gray-400 ml-1">(PKR)</span>
          </h2>
          <button
            onClick={() => { setMillCostKey(''); setMillCostLabel(''); setShowMillCostForm(true); }}
            className="inline-flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>
        {showMillCostForm && (
          <div className="px-6 py-4 border-b border-gray-200 bg-orange-50/50 flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Key</label>
              <input
                type="text"
                value={millCostKey}
                onChange={(e) => setMillCostKey(e.target.value)}
                placeholder="e.g. fumigation"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Label</label>
              <input
                type="text"
                value={millCostLabel}
                onChange={(e) => setMillCostLabel(e.target.value)}
                placeholder="e.g. Fumigation Charges"
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
              />
            </div>
            <button
              onClick={() => {
                if (!millCostKey.trim() || !millCostLabel.trim()) {
                  addToast('Both key and label are required', 'error');
                  return;
                }
                addMillingCostCategory({ key: millCostKey.trim(), label: millCostLabel.trim() });
                addToast(`Milling cost category "${millCostLabel.trim()}" added`, 'success');
                setMillCostKey(''); setMillCostLabel(''); setShowMillCostForm(false);
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setShowMillCostForm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Key</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(millingCostCategories || []).map((cat, idx) => (
                <tr key={cat.key || idx} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{cat.key}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{cat.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* General Expense Categories */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Tags className="w-5 h-5 text-teal-600" />
            General Expense Categories
          </h2>
          <p className="text-xs text-gray-500 mt-1">Read-only. These categories are managed from the company profile.</p>
        </div>
        <div className="p-6 space-y-4">
          {companyProfileData?.expenseCategories?.length > 0 ? (
            companyProfileData.expenseCategories.map((cat) => (
              <div key={cat.key} className="border border-gray-100 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">{cat.label}</h3>
                <div className="flex flex-wrap gap-2">
                  {(cat.subcategories || []).map((sub, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
                    >
                      {sub}
                    </span>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">No expense categories configured in company profile.</p>
          )}
        </div>
      </div>
    </div>
  );
}
