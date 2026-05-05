import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { FinanceTable } from '../../../components/finance';
import { useJournalEntries } from '../../../api/queries';

function fmtAmount(v) {
  if (!v || v === 0) return '—';
  return `Rs ${Math.round(parseFloat(v)).toLocaleString()}`;
}

// The previous "Ledger" sub-tab fabricated a general ledger by
// relabeling journal_entries.refType / entity as "account" — every
// row read "General" because journal_entries doesn't carry account
// info; that lives on journal_lines. A proper GL view needs a
// dedicated backend grouped on journal_lines.account_id and is
// scoped for a separate piece of work. For now we render only
// Journal Entries (the source of truth) and drop the fake tab.

export default function Accounting() {
  const { data: journalData = [], isLoading } = useJournalEntries();

  function RefLink({ refNo }) {
    if (!refNo) return <span className="text-gray-400">—</span>;
    const href = refNo.startsWith('EX-') ? `/export/${refNo}` : refNo.startsWith('M-') ? `/milling/${refNo}` : null;
    if (href) return <Link to={href} className="text-blue-600 hover:underline text-xs font-medium">{refNo}</Link>;
    return <span className="text-xs text-gray-600">{refNo}</span>;
  }

  const journalColumns = [
    { key: 'journalNo', label: 'Journal #', sortable: true },
    { key: 'date', label: 'Date', sortable: true,
      render: (v) => v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' },
    { key: 'entity', label: 'Entity', sortable: true, render: (v) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'mill' ? 'bg-amber-50 text-amber-700' : v === 'export' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'}`}>
        {v || 'General'}
      </span>
    )},
    { key: 'refNo', label: 'Reference', sortable: true, render: (v) => <RefLink refNo={v} /> },
    { key: 'description', label: 'Description', render: (v) => <span className="truncate max-w-[260px] block">{v || '—'}</span> },
    { key: 'totalDebit',  label: 'Debit',  sortable: true, align: 'right', render: (v) => fmtAmount(v) },
    { key: 'totalCredit', label: 'Credit', sortable: true, align: 'right', render: (v) => fmtAmount(v) },
    { key: 'status', label: 'Status', sortable: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <FileText size={16} className="text-blue-500" />
        <span className="font-semibold">Journal Entries</span>
        <span className="text-xs text-gray-400">— every receipt, payment and adjustment, posted in real time.</span>
      </div>

      <FinanceTable
        title="Journal Entries"
        columns={journalColumns}
        data={journalData}
        searchKeys={['journalNo', 'description']}
        exportFilename="journal-entries"
        loading={isLoading}
        emptyText="No journal entries posted yet."
      />
    </div>
  );
}
