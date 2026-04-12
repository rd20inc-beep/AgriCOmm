import { useState, useMemo } from 'react';
import {
  BookOpen,
  Search,
  Filter,
  Calendar,
  FileText,
  User,
  Link2,
} from 'lucide-react';
import { useJournalEntries } from '../../../api/queries';
import Modal from '../../../components/Modal';

function formatNumber(value) {
  if (!value && value !== 0) return '--';
  return (parseFloat(value) || 0).toLocaleString('en-US');
}

function formatAmount(value, entity) {
  if (!value) return '--';
  const num = parseFloat(value) || 0;
  if (entity === 'mill') return 'Rs ' + Math.round(num).toLocaleString('en-PK');
  return '$' + num.toLocaleString('en-US');
}

export default function Ledger() {
  const { data: journalEntries = [] } = useJournalEntries();
  const [entityFilter, setEntityFilter] = useState('All');
  const [refTypeFilter, setRefTypeFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJournal, setSelectedJournal] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const entities = ['All', ...new Set(journalEntries.map((j) => j.entity))];
  const refTypes = ['All', ...new Set(journalEntries.map((j) => j.refType))];

  const filtered = useMemo(() => {
    return journalEntries.filter((j) => {
      if (entityFilter !== 'All' && j.entity !== entityFilter) return false;
      if (refTypeFilter !== 'All' && j.refType !== refTypeFilter) return false;
      if (dateFrom && j.date < dateFrom) return false;
      if (dateTo && j.date > dateTo) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const match =
          (j.id || '').toLowerCase().includes(term) ||
          (j.description || '').toLowerCase().includes(term) ||
          (j.refNo || '').toLowerCase().includes(term);
        if (!match) return false;
      }
      return true;
    });
  }, [journalEntries, entityFilter, refTypeFilter, dateFrom, dateTo, searchTerm]);

  function openDetail(journal) {
    setSelectedJournal(journal);
    setModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">General Ledger</h1>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="filter-bar">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {entities.map((e) => (
                <option key={e} value={e}>
                  {e === 'All' ? 'All Entities' : e}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={refTypeFilter}
              onChange={(e) => setRefTypeFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {refTypes.map((r) => (
                <option key={r} value={r}>
                  {r === 'All' ? 'All Ref Types' : r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search journal no, description, ref..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Journal Entries Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Journal Entries</h2>
          <span className="text-sm text-gray-500">{filtered.length} entries</span>
        </div>
        <div className="table-container">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-6 py-3 font-medium text-gray-600">Journal No</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ref Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ref No</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Debit</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Credit</th>
                <th className="text-center px-6 py-3 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((j) => (
                <tr
                  key={j.id}
                  onClick={() => openDetail(j)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-3 font-mono font-semibold text-blue-600">{j.id}</td>
                  <td className="px-4 py-3 text-gray-600">{j.date}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        j.entity === 'Export'
                          ? 'bg-blue-100 text-blue-700'
                          : j.entity === 'Mill'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {j.entity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{j.refType}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{j.refNo}</td>
                  <td className="px-4 py-3 text-gray-900 max-w-[250px] truncate">{j.description}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-900 text-sm">
                    {formatAmount(j.totalDebit, j.entity)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-900 text-sm">
                    {formatAmount(j.totalCredit, j.entity)}
                  </td>
                  <td className="px-6 py-3 text-center">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        j.status === 'Posted'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                    No journal entries match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Journal Detail Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={selectedJournal ? `Journal Entry - ${selectedJournal.id}` : 'Journal Entry'}
        size="lg"
      >
        {selectedJournal && (
          <div className="space-y-6">
            {/* Header Info */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Journal No</p>
                <p className="text-sm font-semibold text-gray-900">{selectedJournal.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Date</p>
                <p className="text-sm font-semibold text-gray-900">{selectedJournal.date}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Entity</p>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    selectedJournal.entity === 'Export'
                      ? 'bg-blue-100 text-blue-700'
                      : selectedJournal.entity === 'Mill'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {selectedJournal.entity}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Reference Type</p>
                <p className="text-sm text-gray-900">{selectedJournal.refType}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Reference No</p>
                <p className="text-sm font-mono text-gray-900">{selectedJournal.refNo}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    selectedJournal.status === 'Posted'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {selectedJournal.status}
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="text-xs text-gray-500 mb-1">Description</p>
              <p className="text-sm text-gray-900">{selectedJournal.description}</p>
            </div>

            {/* Lines Table */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Journal Lines</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Account</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Debit</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(selectedJournal.lines || []).map((line, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-2 text-gray-900">{line.account}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {line.debit ? formatAmount(line.debit, selectedJournal.entity) : '--'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">
                          {line.credit ? formatAmount(line.credit, selectedJournal.entity) : '--'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-4 py-2 text-gray-700">Total</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900">
                        {formatNumber(selectedJournal.totalDebit)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-900">
                        {formatNumber(selectedJournal.totalCredit)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Narration */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Narration</h3>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-sm text-gray-700">{selectedJournal.narration}</p>
              </div>
            </div>

            {/* Related Order/Batch Link */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Link2 size={16} className="text-blue-500" />
                <span className="text-sm text-gray-600">Related:</span>
                <span className="text-sm font-semibold text-blue-600">{selectedJournal.refNo}</span>
              </div>
            </div>

            {/* Posted By */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
              <User size={16} className="text-gray-400" />
              <span className="text-sm text-gray-500">Posted by:</span>
              <span className="text-sm font-medium text-gray-700">Finance Manager</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
