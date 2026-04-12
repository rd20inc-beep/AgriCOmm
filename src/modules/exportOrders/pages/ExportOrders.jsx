import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../../context/AppContext';
import StatusBadge from '../../../components/StatusBadge';
import { Plus, Search, Eye, ArrowUpDown, Ship, FileText, DollarSign, Package, Clock, Filter, FileDown, Mail } from 'lucide-react';
import Modal from '../../../components/Modal';
import ProformaInvoice from '../../../components/ProformaInvoice';
import EmailComposer from '../../../components/EmailComposer';

const tabs = [
  { key: 'All', label: 'All' },
  { key: 'Awaiting Advance', label: 'Awaiting Advance' },
  { key: 'Procurement', label: 'Procurement' },
  { key: 'Docs Pending', label: 'Docs Pending' },
  { key: 'Awaiting Balance', label: 'Awaiting Balance' },
  { key: 'Ready to Ship', label: 'Ready to Ship' },
  { key: 'Shipped', label: 'Shipped' },
];

function matchesTab(order, tab) {
  if (tab === 'All') return true;
  if (tab === 'Awaiting Advance') return order.status === 'Awaiting Advance';
  if (tab === 'Procurement') return ['Advance Received', 'Procurement Pending', 'In Milling'].includes(order.status);
  if (tab === 'Docs Pending') return order.status === 'Docs In Preparation';
  if (tab === 'Awaiting Balance') return order.status === 'Awaiting Balance';
  if (tab === 'Ready to Ship') return order.status === 'Ready to Ship';
  if (tab === 'Shipped') return order.status === 'Shipped' || order.status === 'Arrived';
  return false;
}

export default function ExportOrders() {
  const { exportOrders, companyProfileData, customersList, dataLoading } = useApp();
  const navigate = useNavigate();
  // Read status filter from URL (from dashboard pipeline click)
  const urlParams = new URLSearchParams(window.location.search);
  const urlStatus = urlParams.get('status');
  const [activeTab, setActiveTab] = useState(() => {
    if (!urlStatus) return 'All';
    if (urlStatus === 'Awaiting Advance') return 'Awaiting Advance';
    if (urlStatus === 'Advance Received' || urlStatus === 'Procurement Pending' || urlStatus === 'In Milling') return 'Procurement';
    if (urlStatus === 'Docs In Preparation') return 'Docs Pending';
    if (urlStatus === 'Awaiting Balance') return 'Awaiting Balance';
    if (urlStatus === 'Ready to Ship') return 'Ready to Ship';
    if (urlStatus === 'Shipped' || urlStatus === 'Arrived') return 'Shipped';
    return 'All';
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('Created Date');
  const [piOrder, setPiOrder] = useState(null);
  const [emailOrder, setEmailOrder] = useState(null);

  const filteredOrders = exportOrders
    .filter(order => matchesTab(order, activeTab))
    .filter(order => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        order.id.toLowerCase().includes(term) ||
        order.customerName.toLowerCase().includes(term) ||
        order.country.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'Created Date') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sortBy === 'Shipment Date') {
        if (!a.shipmentETA) return 1;
        if (!b.shipmentETA) return -1;
        return new Date(a.shipmentETA) - new Date(b.shipmentETA);
      }
      if (sortBy === 'Value') return b.contractValue - a.contractValue;
      return 0;
    });

  const formatCurrency = (value) => {
    return '$' + value.toLocaleString();
  };

  const getAdvanceStatus = (order) => {
    if (order.advanceReceived >= order.advanceExpected && order.advanceExpected > 0) return 'received';
    return 'pending';
  };

  const getBalanceStatus = (order) => {
    if (order.balanceReceived >= order.balanceExpected && order.balanceExpected > 0) return 'received';
    return 'pending';
  };

  const getShipmentStatus = (order) => {
    if (order.ata) return 'Arrived';
    if (order.atd) return 'In Transit';
    if (order.etd) return 'Booked';
    return 'Not Booked';
  };

  const getMargin = (order) => {
    const totalCosts = Object.values(order.costs || {}).reduce((sum, c) => sum + (parseFloat(c) || 0), 0);
    if (totalCosts === 0) return '—';
    const cv = parseFloat(order.contractValue) || 0;
    if (cv === 0) return '—';
    const margin = ((cv - totalCosts) / cv) * 100;
    return margin.toFixed(1) + '%';
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="text-2xl font-bold text-gray-900">Export Orders</h1>
        <Link
          to="/export/create"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          Create Export Order
        </Link>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="relative flex-1 max-w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order ID, customer, or country..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option>Created Date</option>
            <option>Shipment Date</option>
            <option>Value</option>
          </select>
        </div>
      </div>

      <div className="table-container">
        <div className="table-scroll">
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left">Order No</th>
                <th className="text-left">Customer</th>
                <th className="text-left">Country</th>
                <th className="text-left">Product Spec</th>
                <th className="text-right">Qty MT</th>
                <th className="text-right">Contract Value</th>
                <th className="text-center">Advance</th>
                <th className="text-center">Balance</th>
                <th className="text-center">Shipment</th>
                <th className="text-right">Margin %</th>
                <th className="text-center">Stage</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => {
                const advanceStatus = getAdvanceStatus(order);
                const balanceStatus = getBalanceStatus(order);
                const shipmentStatus = getShipmentStatus(order);
                const margin = getMargin(order);

                return (
                  <tr
                    key={order.id}
                    onClick={() => navigate(`/export/${order.id}`)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-blue-600">{order.id}</td>
                    <td className="px-4 py-3 text-gray-900">{order.customerName}</td>
                    <td className="px-4 py-3 text-gray-600">{order.country}</td>
                    <td className="px-4 py-3 text-gray-600">{order.productName}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{order.qtyMT}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">{formatCurrency(order.contractValue)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        advanceStatus === 'received'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {advanceStatus === 'received' ? 'Received' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        balanceStatus === 'received'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {balanceStatus === 'received' ? 'Received' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        shipmentStatus === 'Arrived' ? 'bg-green-100 text-green-700' :
                        shipmentStatus === 'In Transit' ? 'bg-blue-100 text-blue-700' :
                        shipmentStatus === 'Booked' ? 'bg-cyan-100 text-cyan-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {shipmentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-700">{margin}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/export/${order.id}`);
                          }}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPiOrder(order);
                          }}
                          className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-800 text-xs font-medium"
                          title="Proforma Invoice"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          PI
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEmailOrder(order);
                          }}
                          className="inline-flex items-center text-gray-500 hover:text-blue-600 text-xs font-medium"
                          title="Send Email"
                        >
                          <Mail className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-gray-500">
                    No export orders found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Proforma Invoice Modal */}
      <Modal isOpen={!!piOrder} onClose={() => setPiOrder(null)} title={piOrder ? `Proforma Invoice — ${piOrder.id}` : ''} size="lg">
        {piOrder && <ProformaInvoice order={piOrder} companyProfile={companyProfileData} />}
      </Modal>

      {/* Email Composer */}
      {emailOrder && (
        <EmailComposer
          isOpen={!!emailOrder}
          onClose={() => setEmailOrder(null)}
          defaultTo={(customersList.find(c => c.id === emailOrder.customerId) || {}).email || ''}
          defaultSubject={`Proforma Invoice - PI-${emailOrder.id.replace('EX-','')}`}
          defaultBody={`Dear Customer,\n\nPlease find attached the Proforma Invoice for Order ${emailOrder.id}.\n\nProduct: ${emailOrder.productName}\nQuantity: ${emailOrder.qtyMT} MT\nContract Value: $${emailOrder.contractValue.toLocaleString()}\n\nBest regards,\nAGRI COMMODITIES`}
          attachmentLabel={`PI-${emailOrder.id.replace('EX-','')}.pdf`}
        />
      )}
    </div>
  );
}
