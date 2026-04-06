import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, BarChart3, Scale } from 'lucide-react';
import { FinanceTable } from '../../components/finance';
import { useJournalEntries } from '../../api/queries';
import StatusBadge from '../../components/StatusBadge';

const SUB_TABS = [
  { key: 'ledger', label: 'Ledger', icon: BookOpen },
  { key: 'journal', label: 'Journal Entries', icon: FileText },
];

function fmtAmount(v) {
  if (!v || v === 0) return '—';
  return `Rs ${Math.round(parseFloat(v)).toLocaleString()}`;
}

export default function Accounting() {
  const [subTab, setSubTab] = useState('ledger');
  const { data: journalData = [], isLoading } = useJournalEntries();

  function RefLink({ refNo, refType }) {
    if (!refNo) return <span className="text-gray-400">—</span>;
    const href = refNo.startsWith('EX-') ? `/export/${refNo}` : refNo.startsWith('M-') ? `/milling/${refNo}` : null;
    if (href) return <Link to={href} className="text-blue-600 hover:underline text-xs font-medium">{refNo}</Link>;
    return <span className="text-xs text-gray-600">{refNo}</span>;
  }

  const journalColumns = [
    { key: 'journalNo', label: 'Journal #', sortable: true },
    { key: 'date', label: 'Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' },
    { key: 'entity', label: 'Entity', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'mill' ? 'bg-amber-50 text-amber-700' : v === 'export' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'}`}>
        {v || 'General'}
      </span>
    )},
    { key: 'refNo', label: 'Reference', sortable: true, render: (v, row) => <RefLink refNo={v} refType={row.refType} /> },
    { key: 'description', label: 'Description', render: (v) => <span className="truncate max-w-[200px] block">{v || '—'}</span> },
    { key: 'totalDebit', label: 'Debit', sortable: true, align: 'right', render: (v) => fmtAmount(v) },
    { key: 'totalCredit', label: 'Credit', sortable: true, align: 'right', render: (v) => fmtAmount(v) },
    { key: 'status', label: 'Status', sortable: true },
  ];

  const ledgerEntries = journalData.map(j => ({
    ...j,
    account: j.refType || j.entity || 'General',
    debit: j.totalDebit || j.amount || 0,
    credit: j.totalCredit || 0,
  }));

  const ledgerColumns = [
    { key: 'date', label: 'Date', sortable: true, render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' },
    { key: 'account', label: 'Account', sortable: true },
    { key: 'description', label: 'Description', render: (v) => <span className="truncate max-w-[300px] block">{v || '—'}</span> },
    { key: 'debit', label: 'Debit', sortable: true, align: 'right', render: (v) => v > 0 ? fmtAmount(v) : '—' },
    { key: 'credit', label: 'Credit', sortable: true, align: 'right', render: (v) => v > 0 ? fmtAmount(v) : '—' },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-tab selector */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                subTab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'ledger' && (
        <FinanceTable title="General Ledger" columns={ledgerColumns} data={ledgerEntries}
          searchKeys={['description', 'account']} exportFilename="ledger" loading={isLoading}
          emptyText="No ledger entries found" />
      )}

      {subTab === 'journal' && (
        <FinanceTable title="Journal Entries" columns={journalColumns} data={journalData}
          searchKeys={['journalNo', 'description']} exportFilename="journal-entries" loading={isLoading}
          emptyText="No journal entries found" />
      )}
    </div>
  );
}
