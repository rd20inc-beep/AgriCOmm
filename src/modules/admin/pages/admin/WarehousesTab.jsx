import { useState } from 'react';
import { Warehouse, Plus } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateWarehouse } from '../../../../api/queries';
import Modal from '../../../../components/Modal';

export default function WarehousesTab() {
  const { warehousesList, addToast } = useApp();
  const createWarehouseMut = useCreateWarehouse();

  const [warehouseModal, setWarehouseModal] = useState(false);

  // Warehouse form state
  const [whName, setWhName] = useState('');
  const [whEntity, setWhEntity] = useState('mill');
  const [whType, setWhType] = useState('raw');

  const resetWarehouseForm = () => {
    setWhName('');
    setWhEntity('mill');
    setWhType('raw');
  };

  const handleSaveWarehouse = async () => {
    if (!whName.trim()) {
      addToast('Warehouse name is required', 'error');
      return;
    }
    try {
      await createWarehouseMut.mutateAsync({
        name: whName.trim(),
        entity: whEntity,
        type: whType,
      });
      addToast(`Warehouse "${whName.trim()}" added successfully`, 'success');
      resetWarehouseForm();
      setWarehouseModal(false);
    } catch (err) {
      addToast(`Failed to create warehouse: ${err.message}`, 'error');
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Warehouse className="w-5 h-5 text-teal-600" />
            Warehouses
          </h2>
          <button
            onClick={() => { resetWarehouseForm(); setWarehouseModal(true); }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add New
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Warehouse Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Entity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {warehousesList.map(w => (
                <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{w.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{w.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      w.entity === 'mill' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {w.entity === 'mill' ? 'Mill' : 'Export'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      w.type === 'raw' ? 'bg-amber-100 text-amber-700' :
                      w.type === 'finished' ? 'bg-green-100 text-green-700' :
                      w.type === 'byproduct' ? 'bg-purple-100 text-purple-700' :
                      'bg-cyan-100 text-cyan-700'
                    }`}>
                      {w.type.charAt(0).toUpperCase() + w.type.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Warehouse Modal */}
      <Modal
        isOpen={warehouseModal}
        onClose={() => { resetWarehouseForm(); setWarehouseModal(false); }}
        title="Add New Warehouse"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              placeholder="Warehouse name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entity</label>
            <select
              value={whEntity}
              onChange={(e) => setWhEntity(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="mill">Mill</option>
              <option value="export">Export</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={whType}
              onChange={(e) => setWhType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="raw">Raw</option>
              <option value="finished">Finished</option>
              <option value="byproduct">Byproduct</option>
              <option value="transit">Transit</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              onClick={() => setWarehouseModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveWarehouse}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Warehouse
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
