import { useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useCreateProduct } from '../../../../api/queries';
import Modal from '../../../../components/Modal';

export default function ProductsTab() {
  const { productsList, addToast } = useApp();
  const createProductMut = useCreateProduct();

  const [productModal, setProductModal] = useState(false);

  // Product form state
  const [prodName, setProdName] = useState('');
  const [prodCode, setProdCode] = useState('');
  const [prodBrokenPct, setProdBrokenPct] = useState(5);
  const [prodGrade, setProdGrade] = useState('Premium');

  const resetProductForm = () => {
    setProdName('');
    setProdCode('');
    setProdBrokenPct(5);
    setProdGrade('Premium');
  };

  const handleSaveProduct = async () => {
    if (!prodName.trim()) {
      addToast('Product name is required', 'error');
      return;
    }
    try {
      await createProductMut.mutateAsync({
        name: prodName.trim(),
        code: prodCode.trim(),
        broken_pct: prodBrokenPct,
        grade: prodGrade,
      });
      addToast(`Product "${prodName.trim()}" added successfully`, 'success');
      resetProductForm();
      setProductModal(false);
    } catch (err) {
      addToast(`Failed to create product: ${err.message}`, 'error');
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-600" />
            Products
          </h2>
          <button
            onClick={() => { resetProductForm(); setProductModal(true); }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            <Plus className="w-4 h-4" />
            Add New
          </button>
        </div>
        <div className="px-4 py-2 flex gap-4 text-xs text-gray-500 border-b border-gray-100">
          <span>Rice Products: <strong className="text-gray-900">{productsList.filter(p => !p.isByproduct).length}</strong></span>
          <span>By-Products: <strong className="text-amber-700">{productsList.filter(p => p.isByproduct).length}</strong></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Product Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Grade</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productsList.map(p => (
                <tr key={p.id} className={`hover:bg-gray-50 transition-colors ${p.isByproduct ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      p.category === 'By-Product' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {p.category || 'Rice'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.grade || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {p.isByproduct ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">By-Product</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Finished</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Product Modal */}
      <Modal
        isOpen={productModal}
        onClose={() => { resetProductForm(); setProductModal(false); }}
        title="Add New Product"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={prodName}
              onChange={(e) => setProdName(e.target.value)}
              placeholder="Product name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
            <input
              type="text"
              value={prodCode}
              onChange={(e) => setProdCode(e.target.value)}
              placeholder="e.g. IR-5-P"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Broken %</label>
            <input
              type="number"
              step="1"
              min="0"
              max="100"
              value={prodBrokenPct}
              onChange={(e) => setProdBrokenPct(parseFloat(e.target.value) || 0)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
            <select
              value={prodGrade}
              onChange={(e) => setProdGrade(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="Premium">Premium</option>
              <option value="Standard">Standard</option>
              <option value="Economy">Economy</option>
              <option value="Specialty">Specialty</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              onClick={() => setProductModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveProduct}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Product
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
