import { useState } from 'react';
import { Users, Plus, Globe, Mail, Phone } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useCreateCustomer } from '../../api/queries';
import Modal from '../../components/Modal';

export default function CustomersTab() {
  const { customersList, addToast } = useApp();
  const createCustomerMut = useCreateCustomer();

  const [customerModal, setCustomerModal] = useState(false);

  // Customer form state
  const [custName, setCustName] = useState('');
  const [custCountry, setCustCountry] = useState('');
  const [custContact, setCustContact] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custPhone, setCustPhone] = useState('');

  const resetCustomerForm = () => {
    setCustName('');
    setCustCountry('');
    setCustContact('');
    setCustEmail('');
    setCustPhone('');
  };

  const handleSaveCustomer = async () => {
    if (!custName.trim()) {
      addToast('Customer name is required', 'error');
      return;
    }
    try {
      await createCustomerMut.mutateAsync({
        name: custName.trim(),
        country: custCountry.trim(),
        contact_person: custContact.trim(),
        email: custEmail.trim(),
        phone: custPhone.trim(),
      });
      addToast(`Customer "${custName.trim()}" added successfully`, 'success');
      resetCustomerForm();
      setCustomerModal(false);
    } catch (err) {
      addToast(`Failed to create customer: ${err.message}`, 'error');
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Customers
          </h2>
          <button
            onClick={() => { resetCustomerForm(); setCustomerModal(true); }}
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
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Contact Person</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customersList.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5 text-gray-400" />
                      {c.country}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-900">{c.contact}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-gray-400" />
                      {c.email}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-gray-400" />
                      {c.phone}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Customer Modal */}
      <Modal
        isOpen={customerModal}
        onClose={() => { resetCustomerForm(); setCustomerModal(false); }}
        title="Add New Customer"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              placeholder="Customer name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <input
              type="text"
              value={custCountry}
              onChange={(e) => setCustCountry(e.target.value)}
              placeholder="e.g. Nigeria"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
            <input
              type="text"
              value={custContact}
              onChange={(e) => setCustContact(e.target.value)}
              placeholder="Contact person name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={custEmail}
              onChange={(e) => setCustEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="text"
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              placeholder="+1 234 567 890"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              onClick={() => setCustomerModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveCustomer}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Customer
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
