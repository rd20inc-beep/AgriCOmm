import { Files, Eye, CheckCircle } from 'lucide-react';

const TEMPLATES = [
  { name: 'Proforma Invoice', key: 'proforma', format: 'PDF', status: 'Active', desc: 'Generated from export order data with company letterhead' },
  { name: 'Commercial Invoice', key: 'commercial_invoice', format: 'PDF', status: 'Active', desc: 'Final invoice with bank details and shipping references' },
  { name: 'Packing List', key: 'packing_list', format: 'PDF', status: 'Active', desc: 'Container-wise packing details with bag counts and weights' },
  { name: 'Bill of Lading', key: 'bl_draft', format: 'PDF', status: 'Active', desc: 'Draft BL template with shipper/consignee details' },
  { name: 'Phytosanitary Certificate', key: 'phyto', format: 'PDF', status: 'Active', desc: 'Plant quarantine certificate for rice exports' },
  { name: 'Certificate of Origin', key: 'coo', format: 'PDF', status: 'Active', desc: 'Country of origin declaration' },
  { name: 'Fumigation Certificate', key: 'fumigation', format: 'PDF', status: 'Active', desc: 'Pest treatment certificate for export compliance' },
];

export default function DocTemplatesTab() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Files className="w-5 h-5 text-gray-600" />
            Document Templates
            <span className="ml-2 text-xs font-normal text-gray-500">({TEMPLATES.length} templates)</span>
          </h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEMPLATES.map((tpl) => (
              <div key={tpl.key} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-900 text-sm">{tpl.name}</h3>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> {tpl.status}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-3">{tpl.desc}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Format: {tpl.format}</span>
                  <span className="text-xs text-gray-400">Auto-generated from order data</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-700">
            Templates are auto-generated from export order data. To generate a document, go to an order's Documents tab and use the Document Center.
          </div>
        </div>
      </div>
    </div>
  );
}
