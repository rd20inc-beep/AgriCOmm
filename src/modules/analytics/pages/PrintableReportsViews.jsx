// Shared report view components — used by both the on-page printable
// reports preview (/reports/print) and the standalone print route
// (/print-report) that opens in a new tab. Pulling them into a single
// file keeps the two entry points in lockstep.

export function fmtMt(v) {
  return (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtKg(v) {
  return (parseFloat(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
export function fmtPkr(v) {
  return 'Rs ' + (parseFloat(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
export function fmtPct(v) {
  const n = parseFloat(v) || 0;
  return n.toFixed(1) + '%';
}
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

// ─── Production report view ────────────────────────────────────────────
export function ProductionReportView({ data, companyName, range, preset }) {
  const { summary, byProduct, batches } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} Production Report`} subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />

      <SummaryRow items={[
        { label: 'Batches', value: summary.batchCount },
        { label: 'Completed', value: summary.completed },
        { label: 'Raw Input', value: `${fmtMt(summary.rawMt)} MT` },
        { label: 'Finished', value: `${fmtMt(summary.finishedMt)} MT` },
        { label: 'Avg Yield', value: fmtPct(summary.avgYieldPct) },
      ]} />

      {/* "By Mill" section + the Mill column on Batch Detail are dropped
          since there is only one mill — the breakdown was always a
          single row identical to the period totals. */}

      <Section title="By Product">
        <Table
          head={['Product', 'Batches', 'Raw MT', 'Finished MT', 'Yield %']}
          align={['left', 'right', 'right', 'right', 'right']}
          rows={byProduct.map(r => [r.name, r.batchCount, fmtMt(r.rawMt), fmtMt(r.finishedMt), fmtPct(r.yieldPct)])}
          empty="No production this period."
        />
      </Section>

      <Section title="Batch Detail">
        <Table
          head={['Batch No', 'Supplier', 'Product', 'Status', 'Raw MT', 'Finished MT', 'Yield %', 'Created']}
          align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'left']}
          rows={batches.map(b => [
            b.batchNo, b.supplierName || '—', b.productName || '—',
            b.status, fmtMt(b.rawMt), fmtMt(b.finishedMt), fmtPct(b.yieldPct), fmtDate(b.createdAt),
          ])}
          empty="No batches in this period."
        />
      </Section>

      <Footer />
    </div>
  );
}

// ─── Stock report view ─────────────────────────────────────────────────
export function StockReportView({ data, companyName, groupLabel }) {
  const { rows, grand, asOf } = data;
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Stock Report" subtitle={`As of ${new Date(asOf).toLocaleString()} · ${groupLabel || ''}`} />

      <SummaryRow items={[
        { label: 'Lots', value: grand.lotCount },
        { label: 'Total', value: `${fmtKg(grand.totalKg)} kg` },
        { label: 'Available', value: `${fmtKg(grand.availableKg)} kg` },
        { label: 'Reserved', value: `${fmtKg(grand.reservedKg)} kg` },
        { label: 'Value', value: fmtPkr(grand.valuePkr) },
      ]} />

      <Section title="Stock Breakdown">
        <Table
          head={[groupLabel || 'Group', 'Lots', 'Total (kg)', 'Available (kg)', 'Reserved (kg)', 'Value (PKR)']}
          align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={rows.map(r => [
            r.name, r.lotCount, fmtKg(r.totalKg), fmtKg(r.availableKg), fmtKg(r.reservedKg), fmtPkr(r.valuePkr),
          ])}
          empty="No stock to report."
          totalRow={['TOTAL', grand.lotCount, fmtKg(grand.totalKg), fmtKg(grand.availableKg), fmtKg(grand.reservedKg), fmtPkr(grand.valuePkr)]}
        />
      </Section>

      <Footer />
    </div>
  );
}

// ─── Profit & Loss report view ─────────────────────────────────────────
export function PnlReportView({ data, companyName, range, preset }) {
  const { revenue, costs, netProfitPkr, marginPct } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} P&L`} subtitle={range ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : ''} />
      <SummaryRow items={[
        { label: 'Revenue', value: fmtPkr(revenue.totalPkr) },
        { label: 'Total Costs', value: fmtPkr(costs.totalPkr) },
        { label: 'Net Profit', value: fmtPkr(netProfitPkr) },
        { label: 'Margin', value: `${(marginPct || 0).toFixed(1)}%` },
        { label: 'Mill Output', value: `${fmtMt(revenue.millFinishedMt)} MT` },
      ]} />
      <Section title="Revenue Breakdown">
        <Table
          head={['Stream', 'Count', 'Amount (PKR)']}
          align={['left', 'right', 'right']}
          rows={[
            ['Export Orders (shipped/closed)', revenue.exportCount, fmtPkr(revenue.exportPkr)],
            ['Local Sales (completed)',        revenue.localCount,  fmtPkr(revenue.localPkr)],
            ['Mill batches completed',         revenue.millBatchCount, `${fmtMt(revenue.millFinishedMt)} MT`],
          ]}
          totalRow={['TOTAL', revenue.exportCount + revenue.localCount, fmtPkr(revenue.totalPkr)]}
          empty="No revenue in this period."
        />
      </Section>
      <Section title="Cost Breakdown">
        <Table
          head={['Category', 'Count', 'Amount (PKR)']}
          align={['left', 'right', 'right']}
          rows={[
            ['Raw rice purchases (landed)', costs.rawRiceCount,           fmtPkr(costs.rawRicePkr)],
            ['Mill store consumables',      costs.millStoreCount,          fmtPkr(costs.millStorePkr)],
            ['Export operational costs',    costs.exportOpCostsCount,      fmtPkr(costs.exportOpCostsPkr)],
            ['Business expenses',           costs.businessExpensesCount,   fmtPkr(costs.businessExpensesPkr)],
          ]}
          totalRow={['TOTAL', costs.rawRiceCount + costs.millStoreCount + costs.exportOpCostsCount + costs.businessExpensesCount, fmtPkr(costs.totalPkr)]}
          empty="No costs in this period."
        />
      </Section>
      <Section title="Bottom Line">
        <Table
          head={['Line', 'Amount (PKR)']}
          align={['left', 'right']}
          rows={[
            ['Revenue',          fmtPkr(revenue.totalPkr)],
            ['Less: Costs',      `(${fmtPkr(costs.totalPkr)})`],
            ['Net Profit (PKR)', fmtPkr(netProfitPkr)],
            ['Margin %',         `${(marginPct || 0).toFixed(1)}%`],
          ]}
          empty=""
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Cashflow report view ──────────────────────────────────────────────
export function CashflowReportView({ data, companyName, range, preset }) {
  const { summary, daily, topReceipts, topPayments } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} Cashflow`} subtitle={range ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : ''} />
      <SummaryRow items={[
        { label: 'Money In', value: fmtPkr(summary.inPkr) },
        { label: 'Money Out', value: fmtPkr(summary.outPkr) },
        { label: 'Net Cashflow', value: fmtPkr(summary.netPkr) },
        { label: 'Receipts', value: summary.inCount },
        { label: 'Payments', value: summary.outCount },
      ]} />
      <Section title="Daily Movement">
        <Table
          head={['Date', 'In (PKR)', 'Out (PKR)', 'Net (PKR)']}
          align={['left', 'right', 'right', 'right']}
          rows={(daily || []).map(d => [d.day, fmtPkr(d.In), fmtPkr(d.Out), fmtPkr(d.Net)])}
          empty="No payments recorded in this period."
        />
      </Section>
      {(topReceipts || []).length > 0 && (
        <Section title="Top Receipts">
          <Table
            head={['Payment', 'Date', 'Counterparty', 'Method', 'Amount (PKR)']}
            align={['left', 'left', 'left', 'left', 'right']}
            rows={topReceipts.map(r => [r.paymentNo, fmtDate(r.date), r.counterparty, r.method || '—', fmtPkr(r.amountPkr)])}
            empty=""
          />
        </Section>
      )}
      {(topPayments || []).length > 0 && (
        <Section title="Top Payments">
          <Table
            head={['Payment', 'Date', 'Counterparty', 'Method', 'Amount (PKR)']}
            align={['left', 'left', 'left', 'left', 'right']}
            rows={topPayments.map(r => [r.paymentNo, fmtDate(r.date), r.counterparty, r.method || '—', fmtPkr(r.amountPkr)])}
            empty=""
          />
        </Section>
      )}
      <Footer />
    </div>
  );
}

// ─── Aging report view (AR or AP) ──────────────────────────────────────
export function AgingReportView({ data, companyName, kind }) {
  const { asOf, buckets, totalPkr, rows } = data;
  const isAR = kind === 'receivable';
  const title = isAR ? 'Accounts Receivable Aging' : 'Accounts Payable Aging';
  const BUCKETS = ['0-30', '31-60', '61-90', '90+'];
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={title} subtitle={`As of ${new Date(asOf).toLocaleString()}`} />
      <SummaryRow items={[
        ...BUCKETS.map(b => ({ label: `${b} days`, value: fmtPkr(buckets[b]?.totalPkr || 0) })),
        { label: 'Total Outstanding', value: fmtPkr(totalPkr) },
      ]} />
      <Section title="By Bucket">
        <Table
          head={['Bucket', 'Count', 'Outstanding (PKR)', '% of Total']}
          align={['left', 'right', 'right', 'right']}
          rows={BUCKETS.map(b => [
            `${b} days`,
            buckets[b]?.count || 0,
            fmtPkr(buckets[b]?.totalPkr || 0),
            totalPkr > 0 ? `${((buckets[b]?.totalPkr || 0) / totalPkr * 100).toFixed(1)}%` : '—',
          ])}
          totalRow={['TOTAL', rows.length, fmtPkr(totalPkr), '100%']}
          empty="No open balances."
        />
      </Section>
      <Section title={isAR ? 'Open Receivables (oldest first)' : 'Open Payables (oldest first)'}>
        <Table
          head={[
            isAR ? 'Receivable' : 'Payable',
            'Counterparty',
            'Due',
            'Days',
            'Bucket',
            'Outstanding (PKR)',
          ]}
          align={['left', 'left', 'left', 'right', 'left', 'right']}
          rows={rows.map(r => [
            isAR ? r.recvNo : r.payableNo,
            r.counterparty,
            r.dueDate ? fmtDate(r.dueDate) : '—',
            r.ageDays,
            r.bucket,
            fmtPkr(r.outstandingPkr),
          ])}
          empty="No open balances."
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Shared print blocks ───────────────────────────────────────────────
export function Header({ companyName, title, subtitle }) {
  return (
    <div className="border-b-2 border-gray-900 pb-3">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-base font-bold uppercase tracking-wider">{companyName}</div>
          <div className="text-xs text-gray-500">Generated {new Date().toLocaleString()}</div>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-bold">{title}</h1>
          <div className="text-xs text-gray-600">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}

export function SummaryRow({ items }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {items.map((it, i) => (
        <div key={i} className="border border-gray-200 rounded p-3">
          <div className="text-[11px] text-gray-500 uppercase">{it.label}</div>
          <div className="text-base font-semibold text-gray-900 mt-1">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, children }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2 border-b border-gray-200 pb-1">{title}</h2>
      {children}
    </div>
  );
}

export function Table({ head, align = [], rows, empty, totalRow }) {
  if (!rows || rows.length === 0) {
    return <div className="text-center text-xs text-gray-400 py-4">{empty || 'No data.'}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b-2 border-gray-300">
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 font-semibold text-gray-700 text-${align[i] || 'left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-gray-100">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-1.5 text-${align[ci] || 'left'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalRow && (
          <tfoot>
            <tr className="border-t-2 border-gray-700 font-semibold bg-gray-50">
              {totalRow.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 text-${align[ci] || 'left'}`}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function Footer() {
  return (
    <div className="text-[11px] text-gray-400 pt-4 border-t border-gray-200 flex justify-between">
      <span>AgriCOmm ERP · Printable Report</span>
      <span>Page printed {new Date().toLocaleString()}</span>
    </div>
  );
}
