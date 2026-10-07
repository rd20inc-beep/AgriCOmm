// Shared report view components — used by both the on-page printable
// reports preview (/reports/print) and the standalone print route
// (/print-report) that opens in a new tab. Pulling them into a single
// file keeps the two entry points in lockstep.
import { useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  fmtNum, fmtPKR, fmtUSD, fmtPct as houseFmtPct, fmtDate as houseFmtDate, fmtDateTime as fmtStamp,
} from '../../../shared/utils/format';

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

// Printed-report formatters, built on the shared format.js (fixed en-PK
// locale, exact figures). A missing value prints as 0 here, as it always has on
// these reports.
export function fmtMt(v) {
  return fmtNum(parseFloat(v) || 0, 2);
}
export function fmtKg(v) {
  return fmtNum(parseFloat(v) || 0, 0);
}
export function fmtPkr(v) {
  return fmtPKR(parseFloat(v) || 0);
}
// Cost columns (per kg, value) are dropped for viewers without
// reports.view_cost — the API already nulls them; this removes the column
// instead of printing "Rs 0". `drop` lists the column indexes to remove.
export function costCols(showCost, drop) {
  return (arr) => (showCost || !Array.isArray(arr) ? arr : arr.filter((_, i) => !drop.includes(i)));
}

export function fmtPct(v) {
  return houseFmtPct(parseFloat(v) || 0);
}
export function fmtDate(iso) {
  return houseFmtDate(iso);
}

// ─── Production report view ────────────────────────────────────────────
export function ProductionReportView({ data, companyName, range, preset, showCost = true }) {
  const { summary, byProduct, batches } = data;
  const c = costCols(showCost, [6]);
  const periodLabel = preset === 'daily' ? 'Daily' : preset === 'weekly' ? 'Weekly' : preset === 'monthly' ? 'Monthly' : 'Custom Range';

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title={`${periodLabel} Production Report`} subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />

      <SummaryRow items={[
        { label: 'Batches', value: summary.batchCount },
        { label: 'Completed', value: summary.completed },
        { label: 'Input', value: `${fmtMt(summary.rawMt)} MT` },
        { label: 'Finished', value: `${fmtMt(summary.finishedMt)} MT` },
        { label: 'Avg Yield', value: fmtPct(summary.avgYieldPct) },
      ]} />

      {/* Blends re-mill already-finished owned rice, so their tonnage is kept
          OUT of Input / Finished above to avoid double-counting the
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
        <ExpandableGroupTable
          head={c(['Product / Batch', 'Supplier', 'Status', 'Input MT', 'Finished MT', 'kg', 'Per kg', 'Katta', 'Yield %', 'Created'])}
          align={c(['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left'])}
          groups={byProduct.map(r => {
            const mine = (batches || []).filter(b => (b.productName || '—') === r.name);
            return {
              key: r.name,
              cells: c([
                <span>{r.name} <span className="text-gray-400 font-normal">· {r.batchCount} batch{r.batchCount === 1 ? '' : 'es'}</span></span>,
                '', '', fmtMt(r.rawMt), fmtMt(r.finishedMt), fmtKg(r.finishedMt * 1000), '', '', fmtPct(r.yieldPct), '',
              ]),
              childRows: mine.map(b => c([
                <RefLink to={`/milling/${b.id}`}>{b.isBlend ? `${b.batchNo} (blend)` : b.batchNo}</RefLink>,
                b.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${b.supplierId}`}>{b.supplierName}</RefLink> : (b.supplierName || '—'),
                b.status, fmtMt(b.rawMt), fmtMt(b.finishedMt), fmtKg(b.finishedMt * 1000), fmtPkr(b.perKgFinished), fmtKg(b.bags), fmtPct(b.yieldPct), fmtDate(b.createdAt),
              ])),
            };
          })}
          empty="No production this period."
          hint="Click a product to see its batches."
        />
      </Section>

      <Section title="Batch Detail">
        <Table
          head={['Batch No', 'Supplier', 'Product', 'Status', 'Input MT', 'Finished MT', 'Yield %', 'Created']}
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
export function StockReportView({ data, companyName, groupLabel, showCost = true }) {
  const { rows, grand, asOf, groupBy } = data;
  const c = costCols(showCost, [7, 8]);
  const isSupplier = groupBy === 'supplier';
  // Katta are the 50 kg sacks; anything packed smaller (25 kg, 10 kg ...) is a
  // bag and is reported under its own heading with its size, never added in as
  // sacks. One size prints as "480 x 25 kg", a mix prints the count alone.
  const bagCell = (n, sizeKg) => (!n ? '—' : (sizeKg ? `${fmtKg(n)} \u00d7 ${Number(sizeKg)} kg` : fmtKg(n)));
  // Variety / Grade / By-product group lines link to the stock movement ledger.
  const ledgerLink = (r) => {
    if (groupBy === 'variety') return `/reports/stock-ledger?dimension=variety&key=${encodeURIComponent(r.name)}`;
    if (groupBy === 'grade') return `/reports/stock-ledger?dimension=grade&key=${encodeURIComponent(r.name)}`;
    if (groupBy === 'byproduct') {
      const [variety, tag] = String(r.name).split(' — ');
      return `/reports/stock-ledger?dimension=byproduct&key=${encodeURIComponent(tag || r.name)}${variety ? `&variety=${encodeURIComponent(variety)}` : ''}`;
    }
    return null;
  };
  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Stock Report" subtitle={`As of ${fmtStamp(asOf)} · ${groupLabel || ''}`} />

      <SummaryRow items={[
        { label: 'Lots', value: grand.lotCount },
        { label: 'Total', value: `${fmtKg(grand.totalKg)} kg` },
        { label: 'Katta', value: fmtKg(grand.bags) },
        { label: 'Bags', value: bagCell(grand.bagUnits) },
        { label: 'Available', value: `${fmtKg(grand.availableKg)} kg` },
        ...(showCost ? [
          { label: 'Per kg', value: fmtPkr(grand.perKg) },
          { label: 'Value', value: fmtPkr(grand.valuePkr) },
        ] : []),
      ]} />

      <Section title="Stock Breakdown">
        <ExpandableGroupTable
          head={c([`${groupLabel || 'Group'} / Lot`, 'Lots', 'On hand (kg)', 'Katta', 'Bags', 'Available (kg)', 'Reserved (kg)', 'Per kg', 'Value (PKR)'])}
          align={c(['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'])}
          groups={(rows || []).map((r, idx) => ({
            key: `${r.name}-${idx}`,
            cells: c([
              (isSupplier && r.supplierId)
                ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.name}</RefLink>
                : (ledgerLink(r) ? <RefLink to={ledgerLink(r)}>{r.name}</RefLink> : r.name),
              r.lotCount, fmtKg(r.totalKg), fmtKg(r.bags), bagCell(r.bagUnits, r.bagSizeKg), fmtKg(r.availableKg), fmtKg(r.reservedKg), fmtPkr(r.perKg), fmtPkr(r.valuePkr),
            ]),
            childRows: (r.lots || []).map(l => c([
              <span>
                <RefLink to={`/lot-inventory/${l.lotId}`}>{l.lotNo}</RefLink>
                <span className="text-gray-400"> · {[l.item, l.variety || l.grade].filter(Boolean).join(' · ') || '—'}</span>
                {(l.supplier && l.supplier !== '—') && <> · {l.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${l.supplierId}`}>{l.supplier}</RefLink> : <span className="text-gray-500">{l.supplier}</span>}</>}
                {(l.warehouse && l.warehouse !== '—') && <span className="text-gray-400"> · {l.warehouse}</span>}
              </span>,
              '', fmtKg(l.onHandKg), fmtKg(l.bags), bagCell(l.bagUnits, l.bagSizeKg), fmtKg(l.availableKg), '', fmtPkr(l.perKg), fmtPkr(l.valuePkr),
            ])),
          }))}
          totalRow={c(['TOTAL', grand.lotCount, fmtKg(grand.totalKg), fmtKg(grand.bags), bagCell(grand.bagUnits), fmtKg(grand.availableKg), fmtKg(grand.reservedKg), fmtPkr(grand.perKg), fmtPkr(grand.valuePkr)])}
          empty="No stock to report."
          hint="Click a group to expand its lots."
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
            ['Rice purchases (landed)', costs.rawRiceCount,           fmtPkr(costs.rawRicePkr)],
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
            rows={detail.export.map(r => [<RefLink to={`/export/${r.id}`}>{r.ref}</RefLink>, r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.party}</RefLink> : (r.party || '—'), r.item || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
      {detail && (detail.local?.length > 0) && (
        <Section title="Local Sales — detail">
          <Table head={['Sale', 'Customer', 'Item', 'Revenue (PKR)']} align={['left', 'left', 'left', 'right']}
            rows={detail.local.map(r => [r.lotId ? <RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink> : r.ref, r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.party}</RefLink> : (r.party || '—'), r.item || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
      {detail && (detail.purchases?.length > 0) && (
        <Section title="Rice Purchases — detail">
          <Table head={['Lot', 'Supplier', 'Item', 'Landed Cost (PKR)']} align={['left', 'left', 'left', 'right']}
            rows={detail.purchases.map(r => [<RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink>, r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.party}</RefLink> : (r.party || '—'), r.item || '—', fmtPkr(r.amountPkr)])} empty="" />
        </Section>
      )}
      {detail && (detail.expenses?.length > 0) && (
        <Section title="Business Expenses — detail">
          <Table head={['Expense', 'Category', 'Payee', 'Type', 'Amount (PKR)']} align={['left', 'left', 'left', 'left', 'right']}
            rows={detail.expenses.map(r => [r.ref, r.category || '—', r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.party}</RefLink> : (r.party || '—'), r.kind || '—', fmtPkr(r.amountPkr)])} empty="" />
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
      <Header companyName={companyName} title={title} subtitle={`As of ${fmtStamp(asOf)}`} />
      <SummaryRow items={[
        ...BUCKETS.map(b => ({ label: `${b} days`, value: fmtPkr(buckets[b]?.totalPkr || 0) })),
        { label: 'Total Outstanding', value: fmtPkr(totalPkr) },
      ]} />
      <Section title="By Bucket">
        <ExpandableGroupTable
          head={['Bucket / Item', 'Counterparty', 'Due', 'Days / Count', 'Outstanding (PKR)', '% of Total']}
          align={['left', 'left', 'left', 'right', 'right', 'right']}
          groups={BUCKETS.map(b => {
            const mine = rows.filter(r => r.bucket === b);
            return {
              key: b,
              cells: [
                `${b} days`, '', '',
                buckets[b]?.count || 0,
                fmtPkr(buckets[b]?.totalPkr || 0),
                totalPkr > 0 ? `${((buckets[b]?.totalPkr || 0) / totalPkr * 100).toFixed(1)}%` : '—',
              ],
              childRows: mine.map(r => {
                const partyId = isAR ? r.customerId : r.supplierId;
                return [
                  isAR ? r.recvNo : r.payableNo,
                  partyId ? <RefLink to={`/finance/statements?type=${isAR ? 'customer' : 'supplier'}&id=${partyId}`}>{r.counterparty}</RefLink> : r.counterparty,
                  r.dueDate ? fmtDate(r.dueDate) : '—', r.ageDays, fmtPkr(r.outstandingPkr), '',
                ];
              }),
            };
          })}
          totalRow={['TOTAL', '', '', rows.length, fmtPkr(totalPkr), '100%']}
          empty="No open balances."
          hint="Click a bucket to see its open items."
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
          <div className="text-xs text-gray-500">Generated {fmtStamp(new Date())}</div>
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
  // One row on screen/print regardless of how many KPIs (4–7). Static class
  // strings so Tailwind's scanner keeps them; falls back to 2 cols on phones.
  const cols = { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6', 7: 'sm:grid-cols-7' }[items.length] || 'sm:grid-cols-5';
  const printCols = { 3: 'print:grid-cols-3', 4: 'print:grid-cols-4', 5: 'print:grid-cols-5', 6: 'print:grid-cols-6', 7: 'print:grid-cols-7' }[items.length] || 'print:grid-cols-5';
  return (
    <div className={`grid grid-cols-2 ${cols} ${printCols} gap-2`}>
      {items.map((it, i) => (
        <div key={i} className="border border-gray-200 rounded px-2.5 py-2 min-w-0">
          <div className="text-[10px] text-gray-500 uppercase truncate">{it.label}</div>
          <div className="text-sm font-semibold text-gray-900 mt-0.5 tabular-nums truncate">{it.value}</div>
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
      <span>Page printed {fmtStamp(new Date())}</span>
    </div>
  );
}

// A grouped table whose rows expand in place to reveal underlying records.
// `groups` = [{ key, cells:[...], childRows:[[...], ...] }]. Child rows render
// INSIDE the same table sharing the parent's column grid, so every column lines
// up exactly (no separately-sized sub-table). A group with child rows gets a
// ▸/▾ chevron; child rows are indented and tinted.
export function ExpandableGroupTable({ head, align = [], groups, totalRow, empty, hint }) {
  const [open, setOpen] = useState({});
  if (!groups || groups.length === 0) {
    return <div className="text-center text-xs text-gray-400 py-4">{empty || 'No data.'}</div>;
  }
  return (
    <>
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
            {groups.map((g, gi) => {
              const k = g.key ?? gi;
              const kids = g.childRows || [];
              const canExpand = kids.length > 0;
              const isOpen = !!open[k];
              return (
                <Fragment key={k}>
                  <tr className={`border-b border-gray-100 ${canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    onClick={canExpand ? () => setOpen(o => ({ ...o, [k]: !o[k] })) : undefined}>
                    {g.cells.map((c, ci) => (
                      <td key={ci} className={`px-3 py-1.5 text-${align[ci] || 'left'}`}>
                        {ci === 0 ? (
                          <span className="inline-flex items-center gap-1.5">
                            {canExpand
                              ? <span className="text-gray-400 print:hidden w-3 inline-block">{isOpen ? '▾' : '▸'}</span>
                              : <span className="w-3 inline-block print:hidden" />}
                            <span className={canExpand ? 'font-medium text-blue-700 print:text-gray-900' : ''}>{c}</span>
                          </span>
                        ) : c}
                      </td>
                    ))}
                  </tr>
                  {isOpen && kids.map((cr, ri) => (
                    <tr key={ri} className="bg-gray-50/50 border-b border-gray-100 text-gray-600">
                      {cr.map((c, ci) => (
                        <td key={ci} className={`px-3 py-1 text-${align[ci] || 'left'} ${ci === 0 ? 'pl-9' : ''}`}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {totalRow && (
            <tfoot>
              <tr className="border-t-2 border-gray-700 font-semibold bg-gray-50">
                {totalRow.map((c, ci) => (<td key={ci} className={`px-3 py-2 text-${align[ci] || 'left'}`}>{c}</td>))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {hint && <p className="text-[11px] text-gray-400 mt-1 print:hidden">{hint}</p>}
    </>
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
      <Section title="Purchase Detail — every raw-rice lot, its supplier & where it went">
        <ExpandableGroupTable
          head={['Date', 'Lot', 'Supplier', 'Rice Type', 'Variety/Grade', 'Qty (MT)', 'kg', 'Per kg', 'Katta', 'Value (PKR)', 'Payment']}
          align={['left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left']}
          hint="Click a lot to see what's still on hand, what was sold (and to whom), and what was milled."
          empty="No purchases in this period."
          groups={rows.map(r => {
            const kids = [];
            // What's still in stock
            kids.push(['Remaining on hand', '', '', '', '', fmtMt(r.remainingKg / 1000), fmtKg(r.remainingKg), '', '', '', (r.remainingKg || 0) > 0 ? 'In stock' : 'None left']);
            // Milled into batch(es)
            for (const m of (r.milledInto || [])) {
              kids.push(['Milled into', <>{m.batchId ? <RefLink to={`/milling/${m.batchId}`}>{m.batchNo}</RefLink> : (m.batchNo || '—')}{m.batchName ? ` · ${m.batchName}` : ''}</>, '', '', '', fmtMt(m.kg / 1000), fmtKg(m.kg), '', '', '', '']);
            }
            // Trace through milling — who bought the finished / by-product output.
            for (const d of (r.downstreamSales || [])) {
              const shareTag = d.sharePct != null && d.sharePct < 99.5 ? ` (${Math.round(d.sharePct)}% share)` : '';
              const outLabel = (d.outputType === 'finished' ? 'Finished sold' : `${d.outputItem || 'By-product'} sold`) + shareTag;
              kids.push([
                outLabel,
                d.saleId ? <RefLink to={`/local-sales/${d.saleId}`}>{d.saleNo}</RefLink> : (d.saleNo || '—'),
                d.customerId ? <RefLink to={`/finance/statements?type=customer&id=${d.customerId}`}>{d.customer}</RefLink> : (d.customer || '—'),
                d.outputType === 'finished' ? (d.outputItem || 'Finished') : (d.outputItem || '—'), '',
                fmtMt(d.kg / 1000), fmtKg(d.kg), fmtPkr(d.ratePerKg), '', fmtPkr(d.valuePkr), d.paymentStatus || '—',
              ]);
            }
            // Sold directly — to whom
            for (const b of (r.buyers || [])) {
              kids.push([
                'Sold',
                b.lotSaleNo || b.saleNo || '—',
                b.customerId ? <RefLink to={`/finance/statements?type=customer&id=${b.customerId}`}>{b.customer}</RefLink> : (b.customer || '—'),
                '', '',
                fmtMt(b.kg / 1000), fmtKg(b.kg), fmtPkr(b.ratePerKg), '', fmtPkr(b.valuePkr), b.paymentStatus || '—',
              ]);
            }
            if ((r.buyers || []).length === 0 && (r.milledInto || []).length === 0) {
              kids.push(['Not yet sold or milled', '', '', '', '', '', '', '', '', '', '—']);
            }
            return {
              key: r.lotId,
              cells: [
                fmtDate(r.date),
                <RefLink to={`/lot-inventory/${r.lotId}`}>{r.lotNo}</RefLink>,
                r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.supplier}</RefLink> : (r.supplier || '—'),
                r.riceType || '—', r.variety || r.grade || '—',
                fmtMt(r.mt), fmtKg(r.mt * 1000), fmtPkr(r.ratePerKg), fmtKg(r.bags), fmtPkr(r.valuePkr), r.paymentStatus || '—',
              ],
              childRows: kids,
            };
          })}
          totalRow={['', '', '', '', 'TOTAL', fmtMt(totals.mt), fmtKg(totals.mt * 1000), '', fmtKg(rows.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0)), fmtPkr(totals.valuePkr), '']}
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Sales ledger (local + export) ─────────────────────────────────────
// The $/MT and $/kg cells of an export order. One price across the order's
// lines prints as before; several lines make the order figure an AVERAGE
// (24 MT @ 1290 + 24 MT @ 1250 → 1270), so it reads "avg $1,270" with the
// line range under it, never as a unit rate.
export function exportRateCells(r) {
  const rate = parseFloat(r?.ratePerMt) || 0;
  if (!r?.rateMixed) return [fmtUSD(rate), fmtUSD(rate / 1000, { decimals: 3 })];
  return [
    <span className="whitespace-nowrap">
      avg {fmtUSD(rate)}
      <span className="block text-[10px] text-gray-500">{fmtUSD(r.rateMin)}–{fmtUSD(r.rateMax)}</span>
    </span>,
    `avg ${fmtUSD(rate / 1000, { decimals: 3 })}`,
  ];
}

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
        { label: 'Export Value', value: fmtUSD(totals.exportUsd || 0) },
      ]} />
      <Section title="Local Sales">
        <Table
          head={['Sale No', 'Date', 'Customer', 'Item', 'Lot', 'Batch', 'Warehouse', 'Qty (MT)', 'kg', 'Per kg', 'Katta', 'Value (PKR)', 'Payment']}
          align={['left', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={local.map(r => [
            r.lotId ? <RefLink to={`/lot-inventory/${r.lotId}`}>{r.ref}</RefLink> : r.ref,
            fmtDate(r.date),
            r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.customer}</RefLink> : (r.customer || '—'),
            r.item || '—',
            r.lotId ? <RefLink to={`/lot-inventory/${r.lotId}`}>{r.lotNo || '—'}</RefLink> : (r.lotNo || '—'),
            r.batchNo || '—',
            r.warehouse || '—',
            fmtMt(r.mt), fmtKg(r.mt * 1000), fmtPkr(r.ratePerKg), fmtKg(r.bags), fmtPkr(r.valuePkr), r.paymentStatus || '—',
          ])}
          empty="No local sales."
          totalRow={['', '', '', 'TOTAL', '', '', '', fmtMt(totals.localMt), fmtKg(totals.localMt * 1000), '', fmtKg(local.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0)), fmtPkr(totals.localPkr), '']}
        />
      </Section>
      <Section title="Export Orders">
        <Table
          head={['Order No', 'Date', 'Customer', 'Product', 'Qty (MT)', 'kg', '$/MT', '$/kg', 'Katta', 'Value (USD)', 'Status']}
          align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'left']}
          rows={exp.map(r => [
            <RefLink to={`/export/${r.id}`}>{r.ref}</RefLink>,
            fmtDate(r.date),
            r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.customer}</RefLink> : (r.customer || '—'),
            r.item || '—',
            fmtMt(r.mt), fmtKg(r.mt * 1000), ...exportRateCells(r), fmtKg(r.bags), fmtUSD(r.valueUsd || 0), r.status || '—',
          ])}
          empty="No export orders."
          totalRow={['', '', '', 'TOTAL', fmtMt(totals.exportMt), fmtKg(totals.exportMt * 1000), '', '', fmtKg(exp.reduce((s, r) => s + (parseFloat(r.bags) || 0), 0)), fmtUSD(totals.exportUsd || 0), '']}
        />
      </Section>
      <Footer />
    </div>
  );
}

// ─── Detailed stock (traceable) ────────────────────────────────────────
// Packaging stock is reported PER TYPE and never combined: a 50 kg katta and a
// 25 kg retail bag are different things with different prices.
const PACK_TYPE_LABEL = {
  katta: 'Katta / Bardana',
  pp_bag: 'P.P. / Retail Bags',
  master_bag: 'Master (Outer) Bags',
  polythene: 'Polythene / Liners',
  other: 'Other consumables',
};

export function StockDetailView({ data, companyName, showCost = true }) {
  const { rows, millStore, totals } = data;
  // Lot table: Per kg (6) + Value (13). Category totals: Value (6).
  // Mill store tables: Cost/unit (4) + Value (6).
  const cLot = costCols(showCost, [6, 13]);
  const cCat = costCols(showCost, [6]);
  const cStore = costCols(showCost, [4, 6]);
  const packGroups = data.packGroups || [];
  // Everything in the store that is not a bag — fuel, spares, consumables.
  const nonPackaging = (millStore || []).filter(m => m.category !== 'packaging');
  const [tag, setTag] = useState('all');

  // Build the tag chips from the lots' subtypes, ordered by a sensible priority.
  const ORDER = ['Finished Rice', 'Unprocessed Rice', 'B1', 'B2', 'B3', 'CSR', 'Short Grain', 'Broken', 'Powder', 'Sweeping', 'Choba', 'Sortex', 'Other'];
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
  // Lots whose bag count disagrees with how they were actually packed. Three
  // separate bugs have produced a wrong figure here, each found by someone
  // reading it, so the report now says so rather than printing it quietly.
  const disagreeing = shown.filter((r) => r.specDisagrees);
  // Bags are the sub-50 kg packs (25 kg, 10 kg, 5 kg ...). They are counted and
  // reported separately from katta because a 25 kg bag is not a sack, and
  // adding the two together gives a sack count nobody can reconcile.
  const shownBagUnits = shown.reduce((s, r) => s + (parseFloat(r.bagUnits) || 0), 0);
  // A bag column is only meaningful with its size. One size across the rows
  // prints as "480 x 25 kg"; several print as a plain count.
  const bagLabel = (rws) => {
    const sizes = [...new Set(rws.filter(r => (parseFloat(r.bagUnits) || 0) > 0).map(r => Number(r.bagSizeKg)))];
    const n = rws.reduce((s2, r) => s2 + (parseFloat(r.bagUnits) || 0), 0);
    if (!n) return '—';
    return sizes.length === 1 ? `${fmtKg(n)} \u00d7 ${sizes[0]} kg` : fmtKg(n);
  };

  // One section per category. Raw then finished lead — that is the order the
  // mill thinks in — and every by-product follows alphabetically, so the report
  // reads the same way every time regardless of which categories happen to have
  // stock. Selecting a single tag collapses this to that one section.
  const LEAD = ['Unprocessed Rice', 'Finished Rice'];
  const sections = (tag === 'all' ? tags : [tag])
    .filter(t => byTag[t])
    .sort((a, b) => {
      const ia = LEAD.indexOf(a), ib = LEAD.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    })
    .map(t => {
      const rws = rows.filter(r => (r.subtype || 'Other') === t);
      return {
        name: t,
        rows: rws,
        mt: rws.reduce((s2, r) => s2 + (r.onHandMt || 0), 0),
        value: rws.reduce((s2, r) => s2 + (r.valuePkr || 0), 0),
        bags: rws.reduce((s2, r) => s2 + (parseFloat(r.bags) || 0), 0),
        bagUnits: rws.reduce((s2, r) => s2 + (parseFloat(r.bagUnits) || 0), 0),
        bagLabel: bagLabel(rws),
        masters: rws.reduce((s2, r) => s2 + (parseFloat(r.masterBags) || 0), 0),
      };
    });

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Stock — Detailed & Traceable" subtitle={`As of ${fmtStamp(new Date())}${tag !== 'all' ? ` · ${tag}` : ''}`} />
      {/* The summary must describe the rows actually being reported. It used to
          read `totals`, the whole warehouse, so picking CSR still showed every
          category's quantity and value at the top — the figure people read
          first and quote. It now follows the selected tag, and mill-store
          packaging (which is not rice and belongs to no rice category) drops
          out entirely rather than inflating a category it has nothing to do
          with. On "All" this is identical to what it always showed. */}
      <SummaryRow items={(tag === 'all' ? [
        { label: 'Lots on hand', value: totals.lots },
        { label: 'Total Qty', value: `${fmtMt(totals.mt)} MT` },
        { label: 'Stock Value', value: fmtPkr(totals.valuePkr), cost: true },
        { label: 'Mill Store Items', value: millStore.length },
        { label: 'Mill Store Value', value: fmtPkr(totals.millStoreValue), cost: true },
      ] : [
        { label: `${tag} — lots`, value: shown.length },
        { label: `${tag} — Qty`, value: `${fmtMt(shownMt)} MT` },
        { label: `${tag} — Value`, value: fmtPkr(shownValue), cost: true },
        { label: 'Katta', value: fmtKg(shownBags) },
        { label: 'Bags', value: bagLabel(shown) },
        { label: 'Share of stock', value: totals.mt > 0 ? `${(100 * shownMt / totals.mt).toFixed(1)}%` : '—' },
      ]).filter((it) => showCost || !it.cost)} />

      {disagreeing.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm">
          <b>{disagreeing.length} lot{disagreeing.length === 1 ? '' : 's'} show a bag count that disagrees with how it was packed.</b>
          <div className="mt-1 text-amber-900">
            {disagreeing.slice(0, 4).map((r) => (
              <div key={r.lotId}>
                {r.lotNo} — counted as {fmtKg(r.bags || r.bagUnits)} {r.isKatta ? 'katta' : `\u00d7 ${r.bagSizeKg} kg`},
                but packed as {fmtKg(r.packedUnits)} \u00d7 {r.packedSizeKg} kg.
              </div>
            ))}
            {disagreeing.length > 4 && <div>…and {disagreeing.length - 4} more.</div>}
          </div>
          <div className="mt-1.5 text-xs text-amber-700 no-print">
            The packed figure is the right one. Admin ▸ Inventory ▸ Data Problems will re-stamp
            these from their packing runs; until then read the packed figure.
          </div>
        </div>
      )}

      {/* Inventory tags — click to filter the detail to that subtype. */}
      <div className="flex flex-wrap gap-2 no-print">
        <TagChip label="All" count={rows.length} active={tag === 'all'} onClick={() => setTag('all')} />
        {tags.map(t => <TagChip key={t} label={t} count={byTag[t].count} active={tag === t} onClick={() => setTag(t)} />)}
      </div>

      {/* One report covering every category, each under its own heading. Raw and
          finished lead because that is how the mill thinks about its stock; the
          by-products follow in alphabetical order. Picking a single tag still
          prints just that one, as before. */}
      {sections.map(sec => (
        <Section key={sec.name}
          title={`${sec.name} — ${sec.rows.length} lot${sec.rows.length === 1 ? '' : 's'} · ${fmtMt(sec.mt)} MT${showCost ? ` · ${fmtPkr(sec.value)}` : ''}`}>
          <Table
            head={cLot(['Lot', 'Tag', 'Item', 'Variety/Grade', 'On hand (MT)', 'kg', 'Per kg', 'Katta', 'Bags', 'Masters', 'Available', 'Source / Supplier', 'Warehouse', 'Value (PKR)'])}
            align={cLot(['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left', 'right'])}
            rows={sec.rows.map(r => cLot([
              <RefLink to={`/lot-inventory/${r.lotId}`}>{r.lotNo}</RefLink>,
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 print:bg-transparent print:px-0">{r.subtype}</span>,
              r.item || '—', r.variety || r.grade || '—',
              fmtMt(r.onHandMt), fmtKg(r.onHandMt * 1000), fmtPkr(r.costPerKg), fmtKg(r.bags),
              r.specDisagrees
                ? <span className="text-amber-700" title={`Stamped at ${r.bagSizeKg || 'no'} kg but packed at ${r.packedSizeKg} kg`}>
                    {fmtKg(r.packedUnits)} &times; {r.packedSizeKg} kg <span className="text-[10px]">(packed)</span>
                  </span>
                : ((parseFloat(r.bagUnits) || 0) > 0 ? `${fmtKg(r.bagUnits)} \u00d7 ${Number(r.bagSizeKg)} kg` : '—'),
              /* Masters are OUTER packaging — a lot in retail bags inside masters
                 has both, and the store needs both to know how a pallet is made. */
              (parseFloat(r.masterBags) || 0) > 0
                ? `${fmtKg(r.masterBags)}${r.masterLabel ? ` \u00d7 ${r.masterLabel}` : ''}`
                : '—',
              fmtMt(r.availableMt),
              r.supplier
                ? (r.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${r.supplierId}`}>{r.supplier}</RefLink> : r.supplier)
                : (r.sourceSupplier ? <span className="text-gray-600">milled from {r.sourceSupplier}{r.sourceBatch ? ` · ${r.sourceBatch}` : ''}</span> : '—'),
              r.warehouse || '—', fmtPkr(r.valuePkr),
            ]))}
            empty="No stock in this category."
            totalRow={cLot(['', '', '', `${sec.name} TOTAL`, fmtMt(sec.mt), fmtKg(sec.mt * 1000), '', fmtKg(sec.bags), sec.bagLabel, sec.masters ? fmtKg(sec.masters) : '—', '', '', '', fmtPkr(sec.value)])}
          />
        </Section>
      ))}

      {/* With several sections above, the report needs one line that adds them up. */}
      {sections.length > 1 && (
        <Section title="All categories — total">
          <Table
            head={cCat(['Category', 'Lots', 'On hand (MT)', 'kg', 'Katta', 'Bags', 'Value (PKR)'])}
            align={cCat(['left', 'right', 'right', 'right', 'right', 'right', 'right'])}
            rows={sections.map(sec => cCat([sec.name, sec.rows.length, fmtMt(sec.mt), fmtKg(sec.mt * 1000), fmtKg(sec.bags), sec.bagLabel, fmtPkr(sec.value)]))}
            totalRow={cCat(['TOTAL', shown.length, fmtMt(shownMt), fmtKg(shownMt * 1000), fmtKg(shownBags), shownBagUnits ? fmtKg(shownBagUnits) : '—', fmtPkr(shownValue)])}
          />
        </Section>
      )}
      {/* Mill Store packaging, ONE SECTION PER TYPE with its own subtotal, so
          katta, P.P. bags and master bags are never read as one figure. They were
          listed flat under a single "packaging" category, which put a 50 kg sack
          and a 25 kg retail bag on adjacent lines with no subtotal for either. */}
      {tag === 'all' && packGroups.map(g => (
        <Section key={g.packType}
          title={`Mill Store — ${PACK_TYPE_LABEL[g.packType] || 'Packaging'} · ${fmtKg(g.units)} units${showCost ? ` · ${fmtPkr(g.valuePkr)}` : ''}`}>
          <Table
            head={cStore(['Item', 'Size', 'Qty', 'Unit', 'Cost/unit', 'Supplier', 'Value (PKR)'])}
            align={cStore(['left', 'left', 'right', 'left', 'right', 'left', 'right'])}
            rows={g.items.map(m => cStore([
              m.name, m.sizeLabel || '—', fmtKg(m.qty), m.unit || '—',
              m.costPerUnit > 0 ? fmtPkr(m.costPerUnit) : <span className="text-amber-700">no price set</span>,
              m.supplier || '—', fmtPkr(m.qty * m.costPerUnit),
            ]))}
            empty="None in stock."
            totalRow={cStore(['', `${PACK_TYPE_LABEL[g.packType]} TOTAL`, fmtKg(g.units), '', '', '', fmtPkr(g.valuePkr)])}
          />
        </Section>
      ))}

      {/* Anything in the store that is not packaging — fuel, spares and the like. */}
      {tag === 'all' && nonPackaging.length > 0 && (
        <Section title="Mill Store — other consumables">
          <Table
            head={cStore(['Item', 'Category', 'Qty', 'Unit', 'Cost/unit', 'Supplier', 'Value (PKR)'])}
            align={cStore(['left', 'left', 'right', 'left', 'right', 'left', 'right'])}
            rows={nonPackaging.map(m => cStore([m.name, m.category || '—', fmtKg(m.qty), m.unit || '—', fmtPkr(m.costPerUnit), m.supplier || '—', fmtPkr(m.qty * m.costPerUnit)]))}
            empty="None."
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
      <Header companyName={companyName} title="Sweeping Output" subtitle={`As of ${fmtStamp(new Date())}`} />
      <SummaryRow items={[
        { label: 'Sweeping Lots', value: totals.lots },
        { label: 'From Batches', value: totals.batches },
        { label: 'Total Sweeping', value: `${fmtMt(totals.sweepingMt)} MT` },
        { label: 'Total Value', value: fmtPkr(totals.valuePkr) },
      ]} />
      <Section title="Sweeping by lot — milled from which batch & source supplier">
        <Table
          head={['Lot', 'From Batch', 'Source Supplier', 'Rice Milled', 'Input (MT)', 'Sweeping (MT)', 'Available', 'Rate/kg', 'Value (PKR)', 'Status']}
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
        <ExpandableGroupTable
          head={['Category / Expense', 'Payee', 'Date', 'Count', 'Amount (PKR)']}
          align={['left', 'left', 'left', 'right', 'right']}
          groups={[
            ...(opex.byCategory || []).map(c => {
              const mine = (opex.expenses || []).filter(e => (e.category || '—') === (c.category || '—'));
              return {
                key: c.category || '—',
                cells: [c.category || '—', '', '', c.count, fmtPkr(c.amountPkr)],
                childRows: mine.map(e => [
                  e.ref,
                  e.supplierId ? <RefLink to={`/finance/statements?type=supplier&id=${e.supplierId}`}>{e.payee}</RefLink> : (e.payee || '—'),
                  fmtDate(e.date), '', fmtPkr(e.amountPkr),
                ]),
              };
            }),
            ...(opex.sellingPkr > 0 ? [{ key: '__selling', cells: ['Export selling costs (freight/customs/…)', '', '', opex.sellingCount, fmtPkr(opex.sellingPkr)], childRows: [] }] : []),
          ]}
          totalRow={['TOTAL', '', '', opex.businessCount + opex.sellingCount, fmtPkr(opex.totalPkr)]}
          empty="No operating expenses in this period."
          hint="Click a category to see its expenses."
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
            roll-forward ties out exactly (the system keeps no historical stock snapshot). A negative opening means period
            purchases exceeded closing stock + COGS — i.e. cost left inventory via milling yield loss or by-product recovery
            rather than a recognised sale, which is normal for a milling operation.
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
              r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.party}</RefLink> : (r.party || '—'),
              r.item || '—',
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
            ['Rice purchased (this period)', fmtPkr(cash.costs.rawRicePkr), 'deferred to inventory'],
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

// ── Audit Trail (printable) — full activity log over a period with a
// category/action/user summary + a detail table. ──
const AUDIT_CAT_ORDER = ['Create', 'Update', 'Approve', 'Payment', 'Delete', 'Auth', 'Other'];
const AUDIT_CAT_LABEL = { Create: 'Creates', Update: 'Updates', Approve: 'Approvals', Payment: 'Payments', Delete: 'Deletes', Auth: 'Logins', Other: 'Other' };
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function AuditReportView({ data, companyName, range }) {
  const cat = data.byCategory || {};
  const rows = data.rows || [];
  const summary = [
    { label: 'Total entries', value: fmtNum(data.total || 0) },
    ...AUDIT_CAT_ORDER.filter((c) => cat[c]).map((c) => ({ label: AUDIT_CAT_LABEL[c], value: fmtNum(cat[c] || 0) })),
  ];
  return (
    <div className="print-report space-y-5 text-gray-900">
      <Header companyName={companyName} title="Audit Trail Report" subtitle={range?.label || 'All time'} />
      <SummaryRow items={summary.slice(0, 7)} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 print:grid-cols-2">
        <Section title="Activity by action">
          <Table
            head={['Action', 'Count']} align={['left', 'right']}
            rows={(data.topActions || []).map((a) => [a.action, fmtNum(a.count)])}
            empty="No activity in this period."
          />
        </Section>
        <Section title="Activity by user">
          <Table
            head={['User', 'Count']} align={['left', 'right']}
            rows={(data.topUsers || []).map((u) => [u.user, fmtNum(u.count)])}
            empty="No activity in this period."
          />
        </Section>
      </div>

      <Section title={`Detail — ${fmtNum(rows.length)} ${data.truncated ? `of ${fmtNum(data.total || 0)} ` : ''}entries`}>
        {data.truncated && (
          <p className="text-[11px] text-amber-700 mb-2">Showing the most recent {fmtNum(rows.length)} entries. Narrow the date range or filters to see the rest.</p>
        )}
        <Table
          head={['Time', 'User', 'Action', 'Entity', 'Ref', 'Details']}
          align={['left', 'left', 'left', 'left', 'left', 'left']}
          rows={rows.map((r) => [
            fmtDateTime(r.date),
            r.user,
            r.action,
            r.entityType,
            r.entityId || '—',
            <span className="text-[10px] text-gray-500 break-all">{r.details}</span>,
          ])}
          empty="No audit entries match these filters."
        />
      </Section>

      <Footer />
    </div>
  );
}

// ─── Freight recovery ──────────────────────────────────────────────────
// What was charged to buyers against what was paid to carriers, per order.
// While ocean freight is volatile this is the number that says whether the
// freight terms are working — and the aggregate can look covered while half the
// shipments lose money, so the per-order rows carry the report and the ones that
// came up short are called out rather than averaged away.
export function FreightRecoveryView({ data, companyName }) {
  const { rows = [], totals = {}, gl = {} } = data || {};
  const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
  // Recovery reads as a percentage OF what was paid: 100% is break-even, under
  // is money lost on freight, over is margin made on it.
  const gapTone = (v) => (v < -0.01 ? 'text-red-600' : v > 0.01 ? 'text-emerald-700' : 'text-gray-900');
  const shown = rows.filter((r) => r.measurable);
  const short = shown.filter((r) => r.gapPkr < -0.01).sort((a, b) => a.gapPkr - b.gapPkr);

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header companyName={companyName} title="Freight Recovery" subtitle="Charged to buyers vs paid to carriers" />

      <SummaryRow items={[
        { label: 'Charged to buyers', value: fmtPkr(totals.chargedPkr) },
        { label: 'Paid to carriers', value: fmtPkr(totals.paidPkr) },
        { label: totals.gapPkr >= 0 ? 'Covered by' : 'Short by', value: fmtPkr(Math.abs(totals.gapPkr || 0)) },
        { label: 'Recovery', value: pct(totals.recoveryPct) },
        { label: 'Orders short', value: `${totals.shortOrders || 0} of ${totals.withFreight || 0}` },
      ]} />

      {/* The one-line answer, in words, because a table of PKR does not say
          whether the freight terms are working. */}
      <div className={`border rounded-lg p-3 text-sm ${(totals.gapPkr || 0) < -0.01 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        {totals.withFreight === 0
          ? 'No order in this period both charged and paid freight, so there is nothing to recover against yet.'
          : (totals.gapPkr || 0) < -0.01
            ? <>Freight is costing <b>{fmtPkr(Math.abs(totals.gapPkr))}</b> more than it is recovering — {pct(totals.recoveryPct)} of what was paid out. {totals.shortOrders > 0 && <>{totals.shortOrders} order{totals.shortOrders === 1 ? '' : 's'} came up short; they are listed below.</>}</>
            : <>Freight is fully recovered, with <b>{fmtPkr(totals.gapPkr)}</b> to spare across {totals.withFreight} order{totals.withFreight === 1 ? '' : 's'} — {pct(totals.recoveryPct)} of what was paid out.</>}
        {totals.unbilledOrders > 0 && (
          <div className="mt-1 text-red-700">
            {totals.unbilledOrders} order{totals.unbilledOrders === 1 ? '' : 's'} paid freight and charged the buyer nothing for it.
          </div>
        )}
        {totals.debitNotes > 0 && (
          <div className="mt-1 text-gray-600">
            Includes {fmtPkr(totals.debitNotePkr)} claimed back on {totals.debitNotes} escalation debit note{totals.debitNotes === 1 ? '' : 's'}.
          </div>
        )}
      </div>

      {short.length > 0 && (
        <Section title={`Short recovery — ${short.length} order${short.length === 1 ? '' : 's'}`}>
          <Table
            head={['Order', 'Customer', 'Incoterm', 'Charged (PKR)', 'Paid (PKR)', 'Short by', 'Recovery']}
            align={['left', 'left', 'left', 'right', 'right', 'right', 'right']}
            rows={short.map((r) => [
              <RefLink to={`/export/${r.orderNo}`}>{r.orderNo}</RefLink>,
              r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.customer}</RefLink> : r.customer,
              r.incoterm,
              fmtPkr(r.chargedPkr), fmtPkr(r.paidPkr),
              <span className="text-red-600">{fmtPkr(Math.abs(r.gapPkr))}</span>,
              pct(r.recoveryPct),
            ])}
            empty="None."
          />
        </Section>
      )}

      <Section title="Every order">
        <Table
          head={['Order', 'Customer', 'Qty (MT)', 'Incoterm', 'Freight terms', 'Charged (PKR)', 'Paid (PKR)', 'Gap', 'Recovery']}
          align={['left', 'left', 'right', 'left', 'left', 'right', 'right', 'right', 'right']}
          rows={rows.map((r) => [
            <RefLink to={`/export/${r.orderNo}`}>{r.orderNo}</RefLink>,
            r.customerId ? <RefLink to={`/finance/statements?type=customer&id=${r.customerId}`}>{r.customer}</RefLink> : r.customer,
            fmtMt(r.qtyMT),
            r.incoterm,
            r.freightPerMT > 0 || r.insurancePerMT > 0
              ? <span>
                  {r.currency} {r.freightPerMT.toFixed(2)}/MT{r.insurancePerMT > 0 ? ` + ${r.insurancePerMT.toFixed(2)} ins.` : ''}
                  <span className="block text-[11px] text-gray-500">
                    {r.freightDisplay === 'separate' ? 'charged separately' : 'inside the price'}
                    {r.debitNoteCount > 0 && ` · ${r.debitNoteCount} debit note${r.debitNoteCount === 1 ? '' : 's'}`}
                  </span>
                </span>
              : <span className="text-gray-400">none{r.unbilled ? ' — but freight was paid' : ''}</span>,
            r.chargedPkr > 0 ? fmtPkr(r.chargedPkr) : '—',
            r.paidPkr > 0 ? fmtPkr(r.paidPkr) : '—',
            r.measurable ? <span className={gapTone(r.gapPkr)}>{fmtPkr(r.gapPkr)}</span> : '—',
            r.measurable ? pct(r.recoveryPct) : '—',
          ])}
          empty="No export orders in this period."
          totalRow={['', '', '', '', 'TOTAL', fmtPkr(totals.chargedPkr), fmtPkr(totals.paidPkr), fmtPkr(totals.gapPkr), pct(totals.recoveryPct)]}
        />
      </Section>

      {/* The ledger's own answer, side by side with the operational one. They
          should agree; where they do not, that gap is the finding — a report
          that quietly reads only one of them would hide it. */}
      <Section title="Against the ledger">
        <Table
          head={['', 'Account', 'This report', 'General ledger', 'Difference']}
          align={['left', 'left', 'right', 'right', 'right']}
          rows={[
            ['Charged separately', gl.accounts?.revenue || '4070', fmtPkr(totals.in4070Pkr), '', ''],
            ['less: not yet shipped', 'recognised at shipment', <span className="text-gray-500">({fmtPkr(totals.awaitingShipmentPkr)})</span>, '', ''],
            ['Should be in the ledger', gl.accounts?.revenue || '4070',
              fmtPkr((totals.in4070Pkr || 0) - (totals.awaitingShipmentPkr || 0)),
              fmtPkr(gl.recoveredPkr),
              fmtPkr((totals.in4070Pkr || 0) - (totals.awaitingShipmentPkr || 0) - (gl.recoveredPkr || 0))],
            ['Paid to carriers', gl.accounts?.cost || '6010 + 6050', fmtPkr(totals.paidPkr), fmtPkr(gl.paidPkr), fmtPkr((totals.paidPkr || 0) - (gl.paidPkr || 0))],
          ]}
          empty="Nothing to compare."
        />
        <p className="mt-2 text-xs text-gray-500 leading-snug">
          Only freight charged <b>separately</b> is compared against 4070: freight quoted
          inside a CFR/CIF price is invoiced as part of the goods and is recognised in Export
          Sales instead — {fmtPkr(totals.inSalesPkr)} of what is charged above sits there,
          and is right to. Escalation debit notes always post to 4070, whichever way the
          freight itself was presented. Freight revenue reaches the ledger at shipment, so an
          order still in flight is charged on paper and not yet posted; that is the line
          subtracted above. Anything left in the Difference column is the orders and the
          ledger genuinely disagreeing, and is worth chasing.
        </p>
      </Section>

      <Footer />
    </div>
  );
}
