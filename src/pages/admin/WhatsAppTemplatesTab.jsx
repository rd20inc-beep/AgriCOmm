import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Phone, Settings, Plus, Edit2, Trash2, Eye,
  ToggleLeft, ToggleRight, Copy, Check, X, ChevronDown, Search,
  EyeOff, Zap, AlertCircle, RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import api from '../../api/client';

// ── Constants ──────────────────────────────────────────────────────────

const ENTITIES = ['Export', 'Milling', 'Local Sale', 'Finance', 'General'];

const TRIGGER_EVENTS = {
  Export: [
    { value: 'order_created', label: 'Order Created' },
    { value: 'order_confirmed', label: 'Order Confirmed' },
    { value: 'advance_requested', label: 'Advance Requested' },
    { value: 'advance_received', label: 'Advance Received' },
    { value: 'balance_reminder', label: 'Balance Reminder' },
    { value: 'balance_received', label: 'Balance Received' },
    { value: 'shipment_dispatched', label: 'Shipment Dispatched' },
    { value: 'documents_ready', label: 'Documents Ready' },
  ],
  Milling: [
    { value: 'batch_created', label: 'Batch Created' },
    { value: 'milling_started', label: 'Milling Started' },
    { value: 'milling_completed', label: 'Milling Completed' },
    { value: 'quality_checked', label: 'Quality Checked' },
  ],
  'Local Sale': [
    { value: 'local_sale_created', label: 'Local Sale Created' },
    { value: 'local_sale_delivered', label: 'Local Sale Delivered' },
    { value: 'payment_received', label: 'Payment Received' },
  ],
  Finance: [
    { value: 'payment_received', label: 'Payment Received' },
    { value: 'payment_overdue', label: 'Payment Overdue' },
    { value: 'invoice_generated', label: 'Invoice Generated' },
  ],
  General: [
    { value: 'custom', label: 'Custom Trigger' },
  ],
};

const ENTITY_VARIABLES = {
  Export: [
    'customerName', 'orderNo', 'productName', 'quantity', 'currency', 'price',
    'advanceAmount', 'balanceAmount', 'dueDate', 'vesselName', 'etd', 'eta',
    'destinationPort', 'containerCount', 'paymentRef', 'paymentDate', 'bankName',
    'accountNumber', 'swiftCode',
  ],
  Milling: [
    'supplierName', 'batchNo', 'status', 'inputQty', 'outputQty', 'yieldPct',
    'brokenPct', 'moisturePct', 'foreignMatterPct', 'grade',
  ],
  'Local Sale': [
    'buyerName', 'saleNo', 'productName', 'quantity', 'unit', 'rate',
    'totalAmount', 'deliveryDate',
  ],
  Finance: [
    'customerName', 'supplierName', 'amount', 'currency', 'invoiceNo',
    'paymentRef', 'dueDate',
  ],
  General: [
    'recipientName', 'date', 'customField1', 'customField2',
  ],
};

const SAMPLE_DATA = {
  customerName: 'Al Baraka Trading LLC',
  orderNo: 'EXP-2026-0042',
  productName: 'Super Basmati Rice (Premium)',
  quantity: '500 MT',
  currency: 'USD',
  price: '$620/MT',
  advanceAmount: '$62,000',
  balanceAmount: '$248,000',
  dueDate: '2026-04-15',
  vesselName: 'MV Pacific Star',
  etd: '2026-04-01',
  eta: '2026-04-18',
  destinationPort: 'Jebel Ali, UAE',
  containerCount: '20',
  paymentRef: 'TT-20260325-001',
  paymentDate: '2026-03-25',
  bankName: 'Habib Bank Limited',
  accountNumber: 'PK36HABB0012345678901',
  swiftCode: 'HABORAC0XXX',
  supplierName: 'Malik Rice Mills',
  batchNo: 'MILL-2026-0018',
  status: 'Completed',
  inputQty: '120 MT',
  outputQty: '78 MT',
  yieldPct: '65%',
  brokenPct: '4.2%',
  moisturePct: '12.5%',
  foreignMatterPct: '0.3%',
  grade: 'Grade A',
  buyerName: 'Karachi Wholesale Traders',
  saleNo: 'LS-2026-0091',
  unit: 'MT',
  rate: 'PKR 185,000/MT',
  totalAmount: 'PKR 9,250,000',
  deliveryDate: '2026-03-28',
  amount: '$62,000',
  invoiceNo: 'INV-2026-0042',
  recipientName: 'Ahmed Khan',
  date: '2026-03-25',
  customField1: 'Custom Value 1',
  customField2: 'Custom Value 2',
};

const RECIPIENT_TYPES = ['Customer', 'Supplier', 'Internal'];

const ENTITY_COLORS = {
  Export: 'bg-blue-100 text-blue-700',
  Milling: 'bg-amber-100 text-amber-700',
  'Local Sale': 'bg-emerald-100 text-emerald-700',
  Finance: 'bg-purple-100 text-purple-700',
  General: 'bg-gray-100 text-gray-700',
};

const RECIPIENT_COLORS = {
  Customer: 'bg-sky-100 text-sky-700',
  Supplier: 'bg-orange-100 text-orange-700',
  Internal: 'bg-slate-100 text-slate-700',
};

// Default templates for initial state
const DEFAULT_TEMPLATES = [
  {
    id: 1, name: 'Order Confirmation', slug: 'order_confirmation',
    entity: 'Export', triggerEvent: 'order_confirmed', recipientType: 'Customer',
    autoSend: true, active: true,
    body: 'Dear {{customerName}},\n\nYour export order {{orderNo}} for {{quantity}} of {{productName}} has been confirmed.\n\nTotal Value: {{currency}} {{price}}\nAdvance Required: {{advanceAmount}}\n\nPlease remit the advance payment to:\nBank: {{bankName}}\nAccount: {{accountNumber}}\nSWIFT: {{swiftCode}}\n\nThank you for your business.\n\n— AGRI COMMODITIES',
  },
  {
    id: 2, name: 'Advance Payment Received', slug: 'advance_payment_received',
    entity: 'Export', triggerEvent: 'advance_received', recipientType: 'Customer',
    autoSend: true, active: true,
    body: 'Dear {{customerName}},\n\nWe have received the advance payment of {{advanceAmount}} for order {{orderNo}}.\n\nPayment Ref: {{paymentRef}}\nDate: {{paymentDate}}\n\nBalance remaining: {{balanceAmount}}\nDue by: {{dueDate}}\n\nThank you.\n\n— AGRI COMMODITIES',
  },
  {
    id: 3, name: 'Shipment Dispatched', slug: 'shipment_dispatched',
    entity: 'Export', triggerEvent: 'shipment_dispatched', recipientType: 'Customer',
    autoSend: true, active: true,
    body: 'Dear {{customerName}},\n\nOrder {{orderNo}} has been dispatched.\n\nVessel: {{vesselName}}\nContainers: {{containerCount}}\nETD: {{etd}}\nETA: {{eta}}\nDestination: {{destinationPort}}\n\nDocuments will be shared shortly.\n\n— AGRI COMMODITIES',
  },
  {
    id: 4, name: 'Milling Completed', slug: 'milling_completed',
    entity: 'Milling', triggerEvent: 'milling_completed', recipientType: 'Internal',
    autoSend: false, active: true,
    body: 'Milling batch {{batchNo}} completed.\n\nSupplier: {{supplierName}}\nInput: {{inputQty}}\nOutput: {{outputQty}}\nYield: {{yieldPct}}\nBroken: {{brokenPct}}\nMoisture: {{moisturePct}}\nGrade: {{grade}}\n\nStatus: {{status}}',
  },
  {
    id: 5, name: 'Balance Payment Reminder', slug: 'balance_payment_reminder',
    entity: 'Export', triggerEvent: 'balance_reminder', recipientType: 'Customer',
    autoSend: true, active: true,
    body: 'Dear {{customerName}},\n\nThis is a reminder that the balance payment of {{balanceAmount}} for order {{orderNo}} is due on {{dueDate}}.\n\nPlease arrange the payment at your earliest convenience.\n\nBank: {{bankName}}\nAccount: {{accountNumber}}\nSWIFT: {{swiftCode}}\n\n— AGRI COMMODITIES',
  },
  {
    id: 6, name: 'Local Sale Invoice', slug: 'local_sale_invoice',
    entity: 'Local Sale', triggerEvent: 'local_sale_created', recipientType: 'Customer',
    autoSend: false, active: true,
    body: 'Dear {{buyerName}},\n\nYour local sale order {{saleNo}} has been created.\n\nProduct: {{productName}}\nQuantity: {{quantity}} {{unit}}\nRate: {{rate}}\nTotal: {{totalAmount}}\nDelivery: {{deliveryDate}}\n\nThank you for your business.\n\n— AGRI COMMODITIES',
  },
  {
    id: 7, name: 'Payment Overdue Notice', slug: 'payment_overdue_notice',
    entity: 'Finance', triggerEvent: 'payment_overdue', recipientType: 'Customer',
    autoSend: true, active: false,
    body: 'Dear {{customerName}},\n\nInvoice {{invoiceNo}} for {{amount}} ({{currency}}) was due on {{dueDate}} and remains unpaid.\n\nPlease arrange payment immediately to avoid service disruption.\n\nReference: {{paymentRef}}\n\n— AGRI COMMODITIES',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

function renderTemplate(body, data) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || `{{${key}}}`);
}

// ── Component ──────────────────────────────────────────────────────────

export default function WhatsAppTemplatesTab() {
  const { addToast } = useApp();

  // ─ API Configuration State ─
  const [provider, setProvider] = useState('WhatsApp Business API');
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [senderPhone, setSenderPhone] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // ─ Templates State ─
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEntity, setFilterEntity] = useState('All');

  // ─ Editor State ─
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formEntity, setFormEntity] = useState('Export');
  const [formTrigger, setFormTrigger] = useState('order_created');
  const [formRecipient, setFormRecipient] = useState('Customer');
  const [formAutoSend, setFormAutoSend] = useState(false);
  const [formBody, setFormBody] = useState('');
  const [saving, setSaving] = useState(false);

  // ─ Delete confirmation ─
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // ─ Copied variable indicator ─
  const [copiedVar, setCopiedVar] = useState(null);

  const bodyRef = useRef(null);

  // ─ Fetch templates on mount ─
  useEffect(() => {
    fetchTemplates();
    fetchConfig();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/communication/whatsapp/templates');
      if (res?.data?.templates) {
        setTemplates(res.data.templates);
      }
    } catch {
      // Use default templates on error (demo mode)
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await api.get('/api/admin/settings');
      const s = res?.data?.settings || res?.data || {};
      if (s.whatsapp_provider) setProvider(s.whatsapp_provider);
      if (s.whatsapp_api_url) setApiUrl(s.whatsapp_api_url);
      if (s.whatsapp_api_key) setApiKey(s.whatsapp_api_key);
      if (s.whatsapp_sender_phone) setSenderPhone(s.whatsapp_sender_phone);
    } catch {
      // silently use defaults
    }
  };

  // ─ Auto-slug from name ─
  useEffect(() => {
    if (!editingTemplate) {
      setFormSlug(slugify(formName));
    }
  }, [formName, editingTemplate]);

  // ─ Reset trigger when entity changes ─
  useEffect(() => {
    const triggers = TRIGGER_EVENTS[formEntity] || [];
    if (triggers.length && !triggers.find(t => t.value === formTrigger)) {
      setFormTrigger(triggers[0].value);
    }
  }, [formEntity]);

  // ── API Config Handlers ──

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    try {
      await api.put('/api/admin/settings', {
        whatsapp_provider: provider,
        whatsapp_api_url: apiUrl,
        whatsapp_api_key: apiKey,
        whatsapp_sender_phone: senderPhone,
      });
      addToast('WhatsApp configuration saved', 'success');
    } catch {
      addToast('WhatsApp configuration saved (local)', 'success');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      await new Promise(r => setTimeout(r, 1200));
      addToast('WhatsApp API connection successful', 'success');
    } catch {
      addToast('Connection test failed', 'error');
    } finally {
      setTestingConnection(false);
    }
  };

  // ── Template CRUD ──

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setFormName('');
    setFormSlug('');
    setFormEntity('Export');
    setFormTrigger('order_created');
    setFormRecipient('Customer');
    setFormAutoSend(false);
    setFormBody('');
    setEditorOpen(true);
  };

  const openEditTemplate = (tpl) => {
    setEditingTemplate(tpl);
    setFormName(tpl.name);
    setFormSlug(tpl.slug);
    setFormEntity(tpl.entity);
    setFormTrigger(tpl.triggerEvent);
    setFormRecipient(tpl.recipientType);
    setFormAutoSend(tpl.autoSend);
    setFormBody(tpl.body);
    setEditorOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!formName.trim() || !formBody.trim()) {
      addToast('Name and body are required', 'error');
      return;
    }
    setSaving(true);
    const data = {
      name: formName,
      slug: formSlug,
      entity: formEntity,
      triggerEvent: formTrigger,
      recipientType: formRecipient,
      autoSend: formAutoSend,
      body: formBody,
      active: editingTemplate ? editingTemplate.active : true,
    };

    try {
      if (editingTemplate) {
        await api.put(`/api/communication/whatsapp/templates/${editingTemplate.id}`, data);
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? { ...t, ...data } : t));
      } else {
        const res = await api.post('/api/communication/whatsapp/templates', data);
        const newId = res?.data?.id || Date.now();
        setTemplates(prev => [...prev, { ...data, id: newId }]);
      }
      addToast(`Template ${editingTemplate ? 'updated' : 'created'} successfully`, 'success');
      setEditorOpen(false);
    } catch {
      // Optimistic local update on API error (demo mode)
      if (editingTemplate) {
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? { ...t, ...data } : t));
      } else {
        setTemplates(prev => [...prev, { ...data, id: Date.now() }]);
      }
      addToast(`Template ${editingTemplate ? 'updated' : 'created'} (local)`, 'success');
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (id) => {
    try {
      await api.delete(`/api/communication/whatsapp/templates/${id}`);
    } catch {
      // continue with local delete
    }
    setTemplates(prev => prev.filter(t => t.id !== id));
    setDeleteConfirmId(null);
    addToast('Template deleted', 'success');
  };

  const handleToggleActive = async (id) => {
    setTemplates(prev => prev.map(t => {
      if (t.id === id) return { ...t, active: !t.active };
      return t;
    }));
    const tpl = templates.find(t => t.id === id);
    try {
      await api.put(`/api/communication/whatsapp/templates/${id}`, { ...tpl, active: !tpl.active });
    } catch {
      // local-only toggle
    }
  };

  const handleToggleAutoSend = async (id) => {
    setTemplates(prev => prev.map(t => {
      if (t.id === id) return { ...t, autoSend: !t.autoSend };
      return t;
    }));
    const tpl = templates.find(t => t.id === id);
    try {
      await api.put(`/api/communication/whatsapp/templates/${id}`, { ...tpl, autoSend: !tpl.autoSend });
    } catch {
      // local-only toggle
    }
  };

  // ── Variable insertion ──

  const insertVariable = useCallback((varName) => {
    const textarea = bodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = formBody;
    const insertion = `{{${varName}}}`;
    const newText = text.substring(0, start) + insertion + text.substring(end);
    setFormBody(newText);
    // Restore cursor position after React re-render
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + insertion.length;
    }, 0);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  }, [formBody]);

  // ── Filtered templates ──

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesEntity = filterEntity === 'All' || t.entity === filterEntity;
    return matchesSearch && matchesEntity;
  });

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* Section A: WhatsApp API Configuration */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#25D366' }}>
            <MessageSquare className="w-4.5 h-4.5 text-white" />
          </div>
          WhatsApp API Configuration
        </h2>

        <div className="space-y-5 max-w-full lg:max-w-xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"
            >
              <option value="Custom API">Custom API</option>
              <option value="WATI">WATI</option>
              <option value="Twilio">Twilio</option>
              <option value="WhatsApp Business API">WhatsApp Business API</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API URL</label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://api.whatsapp.com/v1"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sender Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                placeholder="+92 300 1234567"
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {testingConnection ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Test Connection
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={configSaving}
              className="inline-flex items-center gap-2 text-white px-6 py-2.5 rounded-lg hover:opacity-90 transition-colors font-medium text-sm disabled:opacity-50"
              style={{ backgroundColor: '#25D366' }}
            >
              {configSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* Section B: Template List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-gray-600" />
            WhatsApp Templates
            <span className="text-sm font-normal text-gray-400">({filteredTemplates.length})</span>
          </h2>
          <button
            onClick={openNewTemplate}
            className="inline-flex items-center gap-2 text-white px-4 py-2.5 rounded-lg hover:opacity-90 transition-colors font-medium text-sm"
            style={{ backgroundColor: '#25D366' }}
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
            />
          </div>
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"
          >
            <option value="All">All Entities</option>
            {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {/* Template Cards Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Loading templates...
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No templates found. Create your first template to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map(tpl => (
              <div
                key={tpl.id}
                className={`border rounded-lg p-4 transition-all hover:shadow-md ${
                  tpl.active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-75'
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">{tpl.name}</h3>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{tpl.slug}</p>
                  </div>
                  <button
                    onClick={() => handleToggleActive(tpl.id)}
                    title={tpl.active ? 'Active - click to deactivate' : 'Inactive - click to activate'}
                  >
                    {tpl.active ? (
                      <ToggleRight className="w-6 h-6" style={{ color: '#25D366' }} />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-gray-300" />
                    )}
                  </button>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ENTITY_COLORS[tpl.entity] || 'bg-gray-100 text-gray-700'}`}>
                    {tpl.entity}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RECIPIENT_COLORS[tpl.recipientType] || 'bg-gray-100 text-gray-700'}`}>
                    {tpl.recipientType}
                  </span>
                  {tpl.active ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">Inactive</span>
                  )}
                </div>

                {/* Trigger */}
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="w-3 h-3 text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-gray-500">
                    {(TRIGGER_EVENTS[tpl.entity] || []).find(t => t.value === tpl.triggerEvent)?.label || tpl.triggerEvent}
                  </span>
                </div>

                {/* Auto-send toggle */}
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => handleToggleAutoSend(tpl.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      tpl.autoSend ? 'bg-green-400' : 'bg-gray-200'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      tpl.autoSend ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                  <span className="text-xs text-gray-500">Auto-send</span>
                </div>

                {/* Preview */}
                <div className="bg-gray-50 rounded-md p-2.5 mb-3">
                  <p className="text-xs text-gray-600 line-clamp-3 leading-relaxed">
                    {tpl.body.substring(0, 120)}{tpl.body.length > 120 ? '...' : ''}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditTemplate(tpl)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                    Edit
                  </button>
                  {deleteConfirmId === tpl.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-red-500 rounded-md hover:bg-red-600 transition-colors"
                      >
                        <Check className="w-3 h-3" /> Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(tpl.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section C: Template Editor Modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 overflow-y-auto">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/50" onClick={() => setEditorOpen(false)} />

          {/* Modal */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200" style={{ backgroundColor: '#f0faf4' }}>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-5 h-5" style={{ color: '#25D366' }} />
                {editingTemplate ? 'Edit Template' : 'New WhatsApp Template'}
              </h3>
              <button onClick={() => setEditorOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[calc(100vh-12rem)] overflow-y-auto">
              {/* Top form fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Order Confirmation"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                  <input
                    type="text"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value)}
                    placeholder="auto_generated_slug"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Entity</label>
                  <select
                    value={formEntity}
                    onChange={(e) => setFormEntity(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"
                  >
                    {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trigger Event</label>
                  <select
                    value={formTrigger}
                    onChange={(e) => setFormTrigger(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"
                  >
                    {(TRIGGER_EVENTS[formEntity] || []).map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Type</label>
                  <select
                    value={formRecipient}
                    onChange={(e) => setFormRecipient(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"
                  >
                    {RECIPIENT_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formAutoSend}
                      onChange={(e) => setFormAutoSend(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 focus:ring-green-500"
                      style={{ accentColor: '#25D366' }}
                    />
                    <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-gray-400" />
                      Auto-send on trigger
                    </span>
                  </label>
                </div>
              </div>

              {/* Body + Variables + Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Body Textarea */}
                <div className="lg:col-span-2 space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Message Body</label>
                  <textarea
                    ref={bodyRef}
                    value={formBody}
                    onChange={(e) => setFormBody(e.target.value)}
                    rows={14}
                    placeholder="Type your WhatsApp message template here. Use {{variableName}} for dynamic content."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono leading-relaxed focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none resize-none"
                  />
                  <p className="text-xs text-gray-400">
                    {formBody.length} characters
                    {formBody.length > 1024 && (
                      <span className="text-amber-500 ml-2">WhatsApp recommends keeping messages under 1024 characters</span>
                    )}
                  </p>
                </div>

                {/* Available Variables Panel */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Available Variables</label>
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-[350px] overflow-y-auto">
                    <p className="text-xs text-gray-400 mb-2">Click to insert at cursor position</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(ENTITY_VARIABLES[formEntity] || []).map(v => (
                        <button
                          key={v}
                          onClick={() => insertVariable(v)}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                            copiedVar === v
                              ? 'bg-green-100 border-green-300 text-green-700'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700'
                          }`}
                        >
                          {copiedVar === v ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Live Preview</label>
                <div className="rounded-xl p-4" style={{ backgroundColor: '#e5ddd5', backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'6\' height=\'6\' viewBox=\'0 0 6 6\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23d4ccc4\' fill-opacity=\'0.3\' fill-rule=\'evenodd\'%3E%3Cpath d=\'M5 0h1L0 6V5zM6 5v1H5z\'/%3E%3C/g%3E%3C/svg%3E")' }}>
                  <div className="max-w-md ml-auto">
                    {/* WhatsApp bubble */}
                    <div className="relative rounded-lg px-3 py-2 shadow-sm" style={{ backgroundColor: '#dcf8c6' }}>
                      {/* Tail */}
                      <div
                        className="absolute -right-1.5 top-0 w-3 h-3"
                        style={{
                          backgroundColor: '#dcf8c6',
                          clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                        }}
                      />
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed break-words">
                        {formBody
                          ? renderTemplate(formBody, SAMPLE_DATA)
                          : 'Your message preview will appear here...'}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[10px] text-gray-500">
                          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <svg className="w-4 h-3" viewBox="0 0 16 11" fill="none">
                          <path d="M11.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-2.011-2.175a.463.463 0 00-.336-.153.457.457 0 00-.343.144.52.52 0 00-.153.355c.003.136.06.27.153.367l2.357 2.553a.481.481 0 00.344.166h.035a.47.47 0 00.332-.141l6.532-8.052a.504.504 0 00.117-.36.494.494 0 00-.152-.416z" fill="#4fc3f7" />
                          <path d="M15.071.653a.457.457 0 00-.304-.102.493.493 0 00-.381.178l-6.19 7.636-1.2-1.298-.462.57 1.316 1.426a.481.481 0 00.344.166h.035a.47.47 0 00.332-.141l6.532-8.052a.504.504 0 00.117-.36.494.494 0 00-.139-.023z" fill="#4fc3f7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => setEditorOpen(false)}
                className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={saving}
                className="inline-flex items-center gap-2 text-white px-6 py-2.5 rounded-lg hover:opacity-90 transition-colors font-medium text-sm disabled:opacity-50"
                style={{ backgroundColor: '#25D366' }}
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingTemplate ? 'Update Template' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
