// Shared report view components — used by both the on-page printable
// reports preview (/reports/print) and the standalone print route
// (/print-report) that opens in a new tab. Pulling them into a single
// file keeps the two entry points in lockstep.
import { useState } from 'react';
import { Link } from 'react-router-dom';

// A reference that's a clickable link on screen but prints as plain text.
export function RefLink({ to, children }) {
  if (!to) return <span>{children}</span>;
  return <Link to={to} className="text-blue-600 hover:underline print:text-gray-900 print:no-underline">{children}</Link>;
}

// A filter chip for the inventory tags on the Stock (detail) report.
export function TagChip({ label, count, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400'}`}>
      {label}<span className={`text-[10px] ${active ? 'text-blue-100' : 'text-gray-400'}`}>{count}</span>
    </button>
  );
}

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

      {/* Blends re-mill already-finished owned rice, so their tonnage is kept
          OUT of Raw Input / Finished above to avoid double-counting the
          original purchase. Surface it here so the number is transparent. */}
      {(summary.blendedCount > 0 || summary.pendingCount > 0) && (
        <div className="text-xs text-gray-600 border border-gray-200 rounded p-2 bg-gray-50 space-y-1">
          {summary.pendingCount > 0 && (
            <div>
              Excludes {summary.pendingCount} not-yet-received batch{summary.pendingCount === 1 ? '' : 'es'}
              {' '}(Queued/Planned) holding {fmtMt(summary.pendingRawMt)} MT — raw not received yet.
            </div>
          )}
          {summary.blendedCount > 0 && (
            <div>
              Excludes {summary.blendedCount} blend batch{summary.blendedCount === 1 ? '' : 'es'} that re-milled
              {' '}{fmtMt(summary.blendedRawMt)} MT of finished rice → {fmtMt(summary.blendedFinishedMt)} MT
              {' '}(not counted as new raw input, to avoid double-counting).
            </div>
          )}
        </div>
      )}

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
            <RefLink to={`/milling/${b.id}`}>{b.isBlend ? `${b.batchNo} (blend)` : b.batchNo}</RefLink>,
            b.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${b.supplierId}`}>{b.supplierName}</RefLink> : (b.supplierName || '—'),
            b.productName || '—',
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
        { label: 'Katta', value: fmtKg(grand.bags) },
        { label: 'Available', value: `${fmtKg(grand.availableKg)} kg` },
        { label: 'Per kg', value: fmtPkr(grand.perKg) },
        { label: 'Value', value: fmtPkr(grand.valuePkr) },
      ]} />

      <Section title="Stock Breakdown">
        <Table
          head={[groupLabel || 'Group', 'Lots', 'Total (kg)', 'Katta', 'Available (kg)', 'Reserved (kg)', 'Per kg', 'Value (PKR)']}
          align={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
          rows={rows.map(r => [
            r.name, r.lotCount, fmtKg(r.totalKg), fmtKg(r.bags), fmtKg(r.availableKg), fmtKg(r.reservedKg), fmtPkr(r.perKg), fmtPkr(r.valuePkr),
          ])}
          empty="No stock to report."
          totalRow={['TOTAL', grand.lotCount, fmtKg(grand.totalKg), fmtKg(grand.bags), fmtKg(grand.availableKg), fmtKg(grand.reservedKg), fmtPkr(grand.perKg), fmtPkr(grand.valuePkr)]}
        />
      </Section>

      <Footer />
    </div>
  );
}

// ─── Profit & Loss report view ─────────────────────────────────────────
export function PnlReportView({ data, companyName, range, preset }) {
  const { revenue, costs, netProfitPkr, marginPct, detail } = data;
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

      {/* Line-item drill-downs */}
      {detail && (detail.export?.length > 0) && (
        <Section title="Export Sales — detail">
          <Table head={['Order', 'Customer', 'Product', 'Revenue (PKR)']} align={['left', 'left', 'left', 'right']}
            rows={detail.export.map(r => [<RefLink to={`/export/${r.id}`}>{r.ref}</RefLink>, r.party || '—', r.item || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
      {detail && (detail.local?.length > 0) && (
        <Section title="Local Sales — detail">
          <Table head={['Sale', 'Customer', 'Item', 'Revenue (PKR)']} align={['left', 'left', 'left', 'right']}
            rows={detail.local.map(r => [r.lotId ? <RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink> : r.ref, r.party || '—', r.item || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
      {detail && (detail.purchases?.length > 0) && (
        <Section title="Raw Rice Purchases — detail">
          <Table head={['Lot', 'Supplier', 'Item', 'Landed Cost (PKR)']} align={['left', 'left', 'left', 'right']}
            rows={detail.purchases.map(r => [<RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink>, r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.party}</RefLink> : (r.party || '—'), r.item || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
      {detail && (detail.expenses?.length > 0) && (
        <Section title="Business Expenses — detail">
          <Table head={['Expense', 'Category', 'Payee', 'Type', 'Amount (PKR)']} align={['left', 'left', 'left', 'left', 'right']}
            rows={detail.expenses.map(r => [r.ref, r.category || '—', r.party || '—', r.kind || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
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
        <Section title="Receipts (largest first)">
          <Table
            head={['Payment', 'Date', 'Received From', 'Method', 'Amount (PKR)']}
            align={['left', 'left', 'left', 'left', 'right']}
            rows={topReceipts.map(r => [
              r.paymentNo, fmtDate(r.date),
              r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.counterparty}</RefLink> : r.counterparty,
              r.method || '—', fmtPkr(r.amountPkr),
            ])}
            empty=""
          />
        </Section>
      )}
      {(topPayments || []).length > 0 && (
        <Section title="Payments (largest first)">
          <Table
            head={['Payment', 'Date', 'Paid To', 'Method', 'Amount (PKR)']}
            align={['left', 'left', 'left', 'left', 'right']}
            rows={topPayments.map(r => [
              r.paymentNo, fmtDate(r.date),
              r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.counterparty}</RefLink> : r.counterparty,
              r.method || '—', fmtPkr(r.amountPkr),
            ])}
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
          rows={rows.map(r => {
            const partyId = isAR ? r.customerId : r.supplierId;
            return [
              isAR ? r.recvNo : r.payableNo,
              partyId ? <RefLink to={`/finance/statements?type=${isAR ? 'customer' : 'supplier'}&id=${partyId}`}>{r.counterparty}</RefLink> : r.counterparty,
              r.dueDate ? fmtDate(r.dueDate) : '—',
              r.ageDays,
              r.bucket,
              fmtPkr(r.outstandingPkr),
            ];
          })}
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

// ─── Purchase ledger ───────────────────────────────────────────────────
export function PurchaseLedgerView({ data, companyName, range }) {
  const { rows, totals } = data;
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Purchase Ledger" subtitle={range?.from ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'All purchases'} />
      <SummaryRow items={[
        { label: 'Purchases', value: totals.lots },
        { label: 'Total Qty', value: `${fmtMt(totals.mt)} MT` },
        { label: 'Total Value', value: fmtPkr(totals.valuePkr) },
      ]} />
      <Section title="Purchase Detail — every raw-rice lot & its supplier">
        <Table
          head={['Date', 'Lot', 'Supplier', 'Rice Type', 'Variety/Grade', 'Qty (MT)', 'kg', 'Per kg', 'Katta', 'Value (PKR)', 'Payment']}
          align={['left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={rows.map(r => [
            fmtDate(r.date),
            <RefLink to={`/lot-inventory/${r.lotId}`}>{r.lotNo}</RefLink>,
            r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.supplier}</RefLink> : (r.supplier || '—'),
            r.riceType || '—', r.variety || r.grade || '—',
            fmtMt(r.mt), fmtKg(r.mt * 1000), fmtPkr(r.ratePerKg), fmtKg(r.bags), fmtPkr(r.valuePkr), r.paymentStatus || '—',
          ])}
          empty="No purchases in this period."
          totalRow={['', '', '', '', 'TOTAL', fmtMt(totals.mt), fmtKg(totals.mt * 1000), '', fmtKg(rows.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0)), fmtPkr(totals.valuePkr), '']}
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Sales ledger (local + export) ─────────────────────────────────────
export function SalesLedgerView({ data, companyName, range }) {
  const { local, export: exp, totals } = data;
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Sales Ledger" subtitle={range?.from ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'All sales'} />
      <SummaryRow items={[
        { label: 'Local Sales', value: totals.localCount },
        { label: 'Local Qty', value: `${fmtMt(totals.localMt)} MT` },
        { label: 'Local Value', value: fmtPkr(totals.localPkr) },
        { label: 'Export Orders', value: totals.exportCount },
        { label: 'Export Value', value: `$${(totals.exportUsd || 0).toLocaleString()}` },
      ]} />
      <Section title="Local Sales">
        <Table
          head={['Sale No', 'Date', 'Customer', 'Item', 'Qty (MT)', 'kg', 'Per kg', 'Katta', 'Value (PKR)', 'Payment']}
          align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={local.map(r => [
            r.lotId ? <RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink> : r.ref,
            fmtDate(r.date), r.customer || '—', r.item || '—',
            fmtMt(r.mt), fmtKg(r.mt * 1000), fmtPkr(r.ratePerKg), fmtKg(r.bags), fmtPkr(r.valuePkr), r.paymentStatus || '—',
          ])}
          empty="No local sales."
          totalRow={['', '', '', 'TOTAL', fmtMt(totals.localMt), fmtKg(totals.localMt * 1000), '', fmtKg(local.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0)), fmtPkr(totals.localPkr), '']}
        />
      </Section>
      <Section title="Export Orders">
        <Table
          head={['Order No', 'Date', 'Customer', 'Product', 'Qty (MT)', 'kg', '$/MT', '$/kg', 'Katta', 'Value (USD)', 'Status']}
          align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={exp.map(r => [
            <RefLink to={`/export/${r.id}`}>{r.ref}</RefLink>,
            fmtDate(r.date), r.customer || '—', r.item || '—',
            fmtMt(r.mt), fmtKg(r.mt * 1000), `$${(r.ratePerMt || 0).toLocaleString()}`, `$${((r.ratePerMt || 0) / 1000).toFixed(3)}`, fmtKg(r.bags), `$${(r.valueUsd || 0).toLocaleString()}`, r.status || '—',
          ])}
          empty="No export orders."
          totalRow={['', '', '', 'TOTAL', fmtMt(totals.exportMt), fmtKg(totals.exportMt * 1000), '', '', fmtKg(exp.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0)), `$${(totals.exportUsd || 0).toLocaleString()}`, '']}
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Detailed stock (traceable) ────────────────────────────────────────
export function StockDetailView({ data, companyName }) {
  const { rows, millStore, totals } = data;
  const [tag, setTag] = useState('all');

  // Build the tag chips from the lots' subtypes, ordered by a sensible priority.
  const ORDER = ['Finished Rice', 'Raw Rice', 'B1', 'B2', 'B3', 'CSR', 'Short Grain', 'Broken', 'Powder', 'Sweeping', 'Sortex', 'Rice Bran', 'Rice Husk', 'Other'];
  const byTag = {};
  for (const r of rows) {
    const t = r.subtype || 'Other';
    if (!byTag[t]) byTag[t] = { count: 0, mt: 0, value: 0 };
    byTag[t].count += 1; byTag[t].mt += r.onHandMt || 0; byTag[t].value += r.valuePkr || 0;
  }
  const tags = Object.keys(byTag).sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const shown = tag === 'all' ? rows : rows.filter(r => (r.subtype || 'Other') === tag);
  const shownMt = shown.reduce((s, r) => s + (r.onHandMt || 0), 0);
  const shownValue = shown.reduce((s, r) => s + (r.valuePkr || 0), 0);
  const shownBags = shown.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0);

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Stock — Detailed & Traceable" subtitle={`As of ${new Date().toLocaleString()}${tag !== 'all' ? ` · ${tag}` : ''}`} />
      <SummaryRow items={[
        { label: 'Lots on hand', value: totals.lots },
        { label: 'Total Qty', value: `${fmtMt(totals.mt)} MT` },
        { label: 'Stock Value', value: fmtPkr(totals.valuePkr) },
        { label: 'Mill Store Items', value: millStore.length },
        { label: 'Mill Store Value', value: fmtPkr(totals.millStoreValue) },
      ]} />

      {/* Inventory tags — click to filter the detail to that subtype. */}
      <div className="flex flex-wrap gap-2 no-print">
        <TagChip label="All" count={rows.length} active={tag === 'all'} onClick={() => setTag('all')} />
        {tags.map(t => <TagChip key={t} label={t} count={byTag[t].count} active={tag === t} onClick={() => setTag(t)} />)}
      </div>

      <Section title={tag === 'all' ? 'Rice Stock — by lot, traced to its source' : `${tag} — ${shown.length} lot${shown.length === 1 ? '' : 's'} · ${fmtMt(shownMt)} MT · ${fmtPkr(shownValue)}`}>
        <Table
          head={['Lot', 'Tag', 'Item', 'Variety/Grade', 'On hand (MT)', 'kg', 'Per kg', 'Katta', 'Available', 'Source / Supplier', 'Warehouse', 'Value (PKR)']}
          align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left', 'left', 'right']}
          rows={shown.map(r => [
            <RefLink to={`/lot-inventory/${r.lotId}`}>{r.lotNo}</RefLink>,
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 print:bg-transparent print:px-0">{r.subtype}</span>,
            r.item || '—', r.variety || r.grade || '—',
            fmtMt(r.onHandMt), fmtKg(r.onHandMt * 1000), fmtPkr(r.costPerKg), fmtKg(r.bags),
            fmtMt(r.availableMt),
            r.supplier
              ? (r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.supplier}</RefLink> : r.supplier)
              : (r.sourceSupplier ? <span className="text-gray-600">milled from {r.sourceSupplier}{r.sourceBatch ? ` · ${r.sourceBatch}` : ''}</span> : '—'),
            r.warehouse || '—', fmtPkr(r.valuePkr),
          ])}
          empty="No stock for this tag."
          totalRow={['', '', '', 'TOTAL', fmtMt(shownMt), fmtKg(shownMt * 1000), '', fmtKg(shownBags), '', '', '', fmtPkr(shownValue)]}
        />
      </Section>
      {millStore.length > 0 && (
        <Section title="Mill Store — packaging & consumables">
          <Table
            head={['Item', 'Category', 'Qty', 'Unit', 'Cost/unit', 'Supplier', 'Value (PKR)']}
            align={['left', 'left', 'right', 'left', 'right', 'left', 'right']}
            rows={millStore.map(m => [m.name, m.category || '—', fmtKg(m.qty), m.unit || '—', fmtPkr(m.costPerUnit), m.supplier || '—', fmtPkr(m.qty * m.costPerUnit)])}
            empty="Mill store empty."
          />
        </Section>
      )}
      <Footer />
    </div>
  );
}

// ─── Sweeping report ───────────────────────────────────────────────────
export function SweepingReportView({ data, companyName }) {
  const { rows, totals } = data;
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Sweeping Output" subtitle={`As of ${new Date().toLocaleString()}`} />
      <SummaryRow items={[
        { label: 'Sweeping Lots', value: totals.lots },
        { label: 'From Batches', value: totals.batches },
        { label: 'Total Sweeping', value: `${fmtMt(totals.sweepingMt)} MT` },
        { label: 'Total Value', value: fmtPkr(totals.valuePkr) },
      ]} />
      <Section title="Sweeping by lot — milled from which batch & raw supplier">
        <Table
          head={['Lot', 'From Batch', 'Raw Supplier', 'Rice Milled', 'Raw In (MT)', 'Sweeping (MT)', 'Available', 'Rate/kg', 'Value (PKR)', 'Status']}
          align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={rows.map(r => [
            <RefLink to={`/lot-inventory/${r.lotId}`}>{r.lotNo}</RefLink>,
            r.batchId ? <RefLink to={`/milling/${r.batchId}`}>{r.batchNo}</RefLink> : (r.batchNo || '—'),
            r.rawSupplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.rawSupplierId}`}>{r.rawSupplier}</RefLink> : (r.rawSupplier || '—'),
            r.milledProduct || '—',
            r.rawMt != null ? fmtMt(r.rawMt) : '—',
            fmtMt(r.sweepingMt), fmtMt(r.availableMt), fmtPkr(r.ratePerKg), fmtPkr(r.valuePkr), r.status || '—',
          ])}
          empty="No sweeping output yet."
          totalRow={['', '', '', '', '', fmtMt(totals.sweepingMt), '', '', fmtPkr(totals.valuePkr), '']}
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Accrual P&L (revenue vs COGS-of-goods-sold) ───────────────────────
export function PnlAccrualView({ data, companyName, range, preset }) {
  const { revenue, cogs, grossProfitPkr, grossMarginPct, opex, netProfitPkr, netMarginPct, inventoryOnHandPkr, inventory, detail } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';
  const pct = (n) => `${(n || 0).toFixed(1)}%`;
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} P&L — Accrual`} subtitle={range ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : ''} />
      <SummaryRow items={[
        { label: 'Revenue', value: fmtPkr(revenue.totalPkr) },
        { label: 'COGS', value: fmtPkr(cogs.totalPkr) },
        { label: 'Gross Profit', value: fmtPkr(grossProfitPkr) },
        { label: 'Op. Expenses', value: fmtPkr(opex.totalPkr) },
        { label: 'Net Profit', value: fmtPkr(netProfitPkr) },
      ]} />

      <div className="text-xs text-gray-600 border border-gray-200 rounded p-2 bg-gray-50">
        Accrual basis: cost of goods <span className="font-medium">sold</span> is matched to revenue. Rice still in stock isn't expensed —
        <span className="font-medium"> {fmtPkr(inventoryOnHandPkr)}</span> of inventory on hand carries forward and becomes COGS when it sells.
      </div>

      <Section title="Gross Profit — by channel">
        <Table
          head={['Channel', 'Sales', 'Revenue (PKR)', 'COGS (PKR)', 'Gross Profit', 'Margin']}
          align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={[
            ['Export (shipped/closed)', revenue.exportCount, fmtPkr(revenue.exportPkr), fmtPkr(cogs.exportPkr), fmtPkr(revenue.exportPkr - cogs.exportPkr), revenue.exportPkr > 0 ? pct((revenue.exportPkr - cogs.exportPkr) / revenue.exportPkr * 100) : '—'],
            ['Local (completed)', revenue.localCount, fmtPkr(revenue.localPkr), fmtPkr(cogs.localPkr), fmtPkr(revenue.localPkr - cogs.localPkr), revenue.localPkr > 0 ? pct((revenue.localPkr - cogs.localPkr) / revenue.localPkr * 100) : '—'],
          ]}
          totalRow={['TOTAL', revenue.exportCount + revenue.localCount, fmtPkr(revenue.totalPkr), fmtPkr(cogs.totalPkr), fmtPkr(grossProfitPkr), pct(grossMarginPct)]}
          empty="No sales recognized in this period."
        />
      </Section>

      <Section title="Operating Expenses — by category">
        <Table
          head={['Category', 'Count', 'Amount (PKR)']}
          align={['left', 'right', 'right']}
          rows={[
            ...(opex.byCategory || []).map(c => [c.category || '—', c.count, fmtPkr(c.amountPkr)]),
            ...(opex.sellingPkr > 0 ? [['Export selling costs (freight/customs/…)', opex.sellingCount, fmtPkr(opex.sellingPkr)]] : []),
          ]}
          totalRow={['TOTAL', opex.businessCount + opex.sellingCount, fmtPkr(opex.totalPkr)]}
          empty="No operating expenses in this period."
        />
      </Section>

      <Section title="Bottom Line (accrual)">
        <Table
          head={['Line', 'Amount (PKR)']}
          align={['left', 'right']}
          rows={[
            ['Revenue', fmtPkr(revenue.totalPkr)],
            ['Less: COGS (goods sold)', `(${fmtPkr(cogs.totalPkr)})`],
            ['= Gross Profit', `${fmtPkr(grossProfitPkr)}  ·  ${pct(grossMarginPct)}`],
            ['Less: Operating Expenses', `(${fmtPkr(opex.totalPkr)})`],
            ['= Net Profit', `${fmtPkr(netProfitPkr)}  ·  ${pct(netMarginPct)}`],
          ]}
          empty=""
        />
      </Section>

      {inventory && (
        <Section title="Inventory Roll-Forward (cost basis)">
          <Table
            head={['Line', 'Amount (PKR)']}
            align={['left', 'right']}
            rows={[
              ['Opening inventory', fmtPkr(inventory.openingPkr)],
              ['Add: Raw purchases landed (this period)', fmtPkr(inventory.purchasesPkr)],
              ['Less: COGS (cost of goods sold)', `(${fmtPkr(inventory.cogsPkr)})`],
            ]}
            totalRow={['= Closing inventory on hand', fmtPkr(inventory.closingPkr)]}
            empty=""
          />
          <p className="text-[11px] text-gray-500 mt-1 print:text-gray-700">
            Identity: Opening + Purchases − COGS = Closing. Closing is the current on-hand cost; opening is derived so the
            roll-forward ties out exactly (the system keeps no historical stock snapshot). This reconciles the period's COGS
            to the change in inventory value.
          </p>
        </Section>
      )}

      {detail && (detail.sales?.length > 0) && (
        <Section title="Sales — detail (revenue, COGS, gross)">
          <Table
            head={['Channel', 'Ref', 'Customer', 'Item', 'Revenue', 'COGS', 'Gross', 'Margin']}
            align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right']}
            rows={detail.sales.map(r => [
              r.channel,
              r.channel === 'Export' ? <RefLink to={`/export/${r.id}`}>{r.ref}</RefLink> : (r.lotId ? <RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink> : r.ref),
              r.party || '—', r.item || '—',
              fmtPkr(r.revPkr), fmtPkr(r.cogsPkr), fmtPkr(r.grossPkr), r.revPkr > 0 ? pct(r.grossPkr / r.revPkr * 100) : '—',
            ])}
            empty=""
          />
        </Section>
      )}
      <Footer />
    </div>
  );
}

// ─── Cash vs Accrual P&L — side by side ────────────────────────────────
export function PnlCompareView({ data, companyName, range, preset }) {
  const { cash, accrual } = data;
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';
  const pct = (n) => `${(n || 0).toFixed(1)}%`;
  const diff = (accrual.netProfitPkr || 0) - (cash.netProfitPkr || 0); // accrual is higher by the deferred inventory
  const cashOtherCosts = (cash.costs.millStorePkr || 0) + (cash.costs.exportOpCostsPkr || 0) + (cash.costs.businessExpensesPkr || 0);
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} P&L — Cash vs Accrual`} subtitle={range ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : ''} />
      <SummaryRow items={[
        { label: 'Revenue', value: fmtPkr(accrual.revenue.totalPkr) },
        { label: 'Net (Cash)', value: fmtPkr(cash.netProfitPkr) },
        { label: 'Net (Accrual)', value: fmtPkr(accrual.netProfitPkr) },
        { label: 'Difference', value: fmtPkr(diff) },
        { label: 'Inventory deferred', value: fmtPkr(accrual.inventoryOnHandPkr) },
      ]} />

      <Section title="Side by side">
        <Table
          head={['Line', 'Cash basis', 'Accrual basis']}
          align={['left', 'right', 'right']}
          rows={[
            ['Revenue (recognized sales)', fmtPkr(cash.revenue.totalPkr), fmtPkr(accrual.revenue.totalPkr)],
            ['Cost of goods sold (sold stock)', '—', fmtPkr(accrual.cogs.totalPkr)],
            ['Raw rice purchased (this period)', fmtPkr(cash.costs.rawRicePkr), 'deferred to inventory'],
            ['= Gross Profit', '—', `${fmtPkr(accrual.grossProfitPkr)} · ${pct(accrual.grossMarginPct)}`],
            ['Operating / other costs', fmtPkr(cashOtherCosts), fmtPkr(accrual.opex.totalPkr)],
            ['= NET PROFIT', fmtPkr(cash.netProfitPkr), fmtPkr(accrual.netProfitPkr)],
            ['Margin', pct(cash.marginPct), pct(accrual.netMarginPct)],
          ]}
          totalRow={['NET PROFIT', fmtPkr(cash.netProfitPkr), fmtPkr(accrual.netProfitPkr)]}
          empty=""
        />
      </Section>

      <div className="text-xs text-gray-700 border border-gray-200 rounded p-3 bg-gray-50 space-y-1">
        <div className="font-medium">Why they differ by {fmtPkr(diff)}</div>
        <div>
          The <span className="font-medium">cash basis</span> expenses the full cost of all rice <span className="font-medium">purchased</span> this
          period ({fmtPkr(cash.costs.rawRicePkr)}). The <span className="font-medium">accrual basis</span> only expenses the cost of rice actually
          <span className="font-medium"> sold</span> ({fmtPkr(accrual.cogs.totalPkr)}) and carries the rest — {fmtPkr(accrual.inventoryOnHandPkr)} of stock —
          on the balance sheet until it sells. Accrual reflects true period performance; cash reflects money tied up in inventory.
        </div>
      </div>

      <Footer />
    </div>
  );
}
