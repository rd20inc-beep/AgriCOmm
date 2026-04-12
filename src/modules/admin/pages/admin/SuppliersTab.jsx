import { useState } from 'react';
import { Truck, Plus, MapPin } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateSupplier } from '../../../../api/queries';
import Modal from '../../../../components/Modal';

export default function SuppliersTab() {
  const { suppliersList, addToast } = useApp();
  const createSupplierMut = useCreateSupplier();

  const [supplierModal, setSupplierModal] = useState(false);

  // Supplier form state
  const [suppName, setSuppName] = useState('');
  const [suppType, setSuppType] = useState('Farmer Cooperative');
  const [suppLocation, setSuppLocation] = useState('');
  const [suppContact, setSuppContact] = useState('');

  const resetSupplierForm = () => {
    setSuppName('');
    setSuppType('Farmer Cooperative');
    setSuppLocation('');
    setSuppContact('');
  };

  const handleSaveSupplier = async () => {
    if (!suppName.trim()) {
      addToast('Supplier name is required', 'error');
      return;
    }
    try {
      await createSupplierMut.mutateAsync({
        name: suppName.trim(),
        type: suppType,
        location: suppLocation.trim(),
        contact_person: suppContact.trim(),
      });
      addToast(`Supplier "${suppName.trim()}" added successfully`, 'success');
      resetSupplierForm();
      setSupplierModal(false);
    } catch (err) {
      addToast(`Failed to create supplier: ${err.message}`, 'error');
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-orange-600" />
            Suppliers
          </h2>
          <button
            onClick={() => { resetSupplierForm(); setSupplierModal(true); }}
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
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Location</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact Person</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppliersList.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.type === 'Farmer Cooperative' ? 'bg-green-100 text-green-700' :
                      s.type === 'Paddy Supplier' ? 'bg-blue-100 text-blue-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {s.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      {s.location}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900">{s.contact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Supplier Modal */}
      <Modal
        isOpen={supplierModal}
        onClose={() => { resetSupplierForm(); setSupplierModal(false); }}
        title="Add New Supplier"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={suppName}
              onChange={(e) => setSuppName(e.target.value)}
              placeholder="Supplier name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={suppType}
              onChange={(e) => setSuppType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="Farmer Cooperative">Farmer Cooperative</option>
              <option value="Paddy Supplier">Paddy Supplier</option>
              <option value="External Mill">External Mill</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              value={suppLocation}
              onChange={(e) => setSuppLocation(e.target.value)}
              placeholder="e.g. Abakaliki, Ebonyi"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
            <input
              type="text"
              value={suppContact}
              onChange={(e) => setSuppContact(e.target.value)}
              placeholder="Contact person name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              onClick={() => setSupplierModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSupplier}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Supplier
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
