// Lot report views — detailed printable report used by the Lot Reports page
// (/reports/lots) and the standalone print route (/print-report?type=lot).
//
// Behaviour:
//   • ONE lot  → its full standalone detail sheet (shown as-is).
//   • MANY lots → a single COMBINED report: one consolidated set of tables
//     (overview, quantities, costing, quality, blend inputs, yield, ledger)
//     with a row per lot, so the selected lots read as one merged document.
//
// Reads the snake_case shape returned by GET /api/lot-inventory/lots-report
// (api.get does NOT transform keys), one bundle per lot:
//   { lot, transactions, reservations, millingBatches, blendRecipe, batchYield }
import {
  Header, Section, Table, Footer, SummaryRow,
  fmtMt, fmtKg, fmtPkr, fmtDate,
} from './PrintableReportsViews';

const num = (v) => (v == null || v === '' ? null : parseFloat(v));
const show = (v, suffix = '') => (v == null || v === '' ? '—' : `${v}${suffix}`);
const pct = (v) => (num(v) == null ? '—' : `${num(v)}%`);

function typeLabel(t) {
  if (t === 'raw') return 'Unprocessed Rice';
  if (t === 'finished') return 'Finished Rice';
  if (t === 'byproduct') return 'Byproduct';
  return t || '—';
}

// Net weight a lot row represents, in kg (mirrors backend enrichLot logic).
function netKg(lot) {
  const raw = num(lot.net_weight_kg);
  if (raw && raw > 0) return raw;
  return (num(lot.qty) || 0);
}
function lotValuePkr(lot) {
  const landed = num(lot.landed_cost_per_kg) ?? num(lot.rate_per_kg) ?? 0;
  return netKg(lot) * landed;
}
const lotName = (lot) => lot.lot_no || `#${lot.id}`;

// ─── One lot, full standalone detail ───────────────────────────────────
function LotCard({ bundle }) {
  const { lot, transactions = [], reservations = [], blendRecipe, batchYield } = bundle;
  const qj = lot.quality_json || {};
  const NAMED = new Set(['moisture', 'broken', 'whiteness', 'purity', 'chalky', 'foreign_matter']);
  const extraQuality = Object.entries(qj).filter(([k]) => !NAMED.has(k));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between border-b border-gray-300 pb-2">
        <div>
          <div className="text-lg font-bold text-gray-900">{lotName(lot)}</div>
          <div className="text-xs text-gray-500">
            {typeLabel(lot.type)} · {lot.entity === 'export' ? 'Export' : 'Mill'} · Status: {lot.status || '—'}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div>Created {fmtDate(lot.created_at)}</div>
          {lot.blend_batch_no && <div>Blend of batch {lot.blend_batch_no}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Table
          head={['Field', 'Value']}
          align={['left', 'left']}
          rows={[
            ['Supplier', show(lot.supplier_name)],
            ['Warehouse', show(lot.warehouse_name)],
            ['Product', show(lot.product_name || lot.product_code)],
            ['Variety', show(lot.variety || lot.item_name)],
            ['Grade', show(lot.grade)],
            ['Bag weight', show(num(lot.bag_weight_kg), ' kg')],
          ]}
          empty=""
        />
        <Table
          head={['Quantity', 'MT', 'Katta', 'Maund']}
          align={['left', 'right', 'right', 'right']}
          rows={[
            ['Total', fmtMt(num(lot.qty) != null ? num(lot.qty) / 1000 : 0), fmtKg(lot.total_katta), fmtKg(lot.total_maund)],
            ['Available', fmtMt(num(lot.available_qty) != null ? num(lot.available_qty) / 1000 : 0), fmtKg(lot.available_katta), fmtKg(lot.available_maund)],
            ['Reserved', fmtMt(num(lot.reserved_qty) != null ? num(lot.reserved_qty) / 1000 : 0), fmtKg(lot.reserved_katta), '—'],
            ['Sold', fmtMt(num(lot.sold_weight_kg) != null ? num(lot.sold_weight_kg) / 1000 : 0), fmtKg(lot.sold_katta), fmtKg(lot.sold_maund)],
            ['Damaged', fmtMt(num(lot.damaged_weight_kg) != null ? num(lot.damaged_weight_kg) / 1000 : 0), fmtKg(lot.damaged_katta), fmtKg(lot.damaged_maund)],
          ]}
          empty=""
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Costing">
          <Table
            head={['Measure', 'Value']}
            align={['left', 'right']}
            rows={[
              ['Rate / kg', fmtPkr(lot.rate_per_kg)],
              ['Rate / maund', fmtPkr(lot.rate_per_maund)],
              ['Landed / kg', fmtPkr(lot.landed_cost_per_kg)],
              ['Landed / maund', fmtPkr(lot.landed_cost_per_maund)],
              ['Net weight', `${fmtKg(netKg(lot))} kg`],
              ['Total value', fmtPkr(lotValuePkr(lot))],
            ]}
            empty=""
          />
        </Section>
        <Section title="Quality">
          <Table
            head={['Spec', 'Value']}
            align={['left', 'right']}
            rows={[
              ['Moisture', pct(qj.moisture ?? lot.moisture_pct)],
              ['Broken', pct(qj.broken ?? lot.broken_pct)],
              ['Whiteness', show(qj.whiteness ?? lot.whiteness)],
              ['Purity', pct(qj.purity ?? lot.purity)],
              ['Chalky', pct(qj.chalky ?? lot.chalky)],
              ['Foreign matter', pct(qj.foreign_matter ?? lot.foreign_matter)],
              ...extraQuality.map(([k, v]) => [k.replace(/_/g, ' '), show(v)]),
            ]}
            empty=""
          />
        </Section>
      </div>

      {blendRecipe && Array.isArray(blendRecipe.inputs) && blendRecipe.inputs.length > 0 && (
        <Section title={`Blend recipe — batch ${blendRecipe.batch_no} (${Math.round(num(blendRecipe.raw_qty_kg) || 0).toLocaleString()} kg raw)`}>
          <Table
            head={['Variety', 'Source Lot', 'Supplier', 'Qty kg', 'Ratio', 'Moisture', 'Broken', 'Grade']}
            align={['left', 'left', 'left', 'right', 'right', 'right', 'right', 'left']}
            rows={blendRecipe.inputs.map((i) => [
              i.variety || '—', i.source_lot_no || '—', i.supplier_name || '—',
              Math.round(num(i.qty_kg) || 0).toLocaleString(), i.ratio_pct != null ? `${i.ratio_pct}%` : '—',
              pct(i.moisture), pct(i.broken), i.grade || '—',
            ])}
            empty=""
          />
        </Section>
      )}

      {batchYield && (
        <Section title="Output composition (from yield)">
          <Table
            head={['Output', 'kg']}
            align={['left', 'right']}
            rows={[
              ['Finished', fmtKg(batchYield.actual_finished_kg)], ['B1', fmtKg(batchYield.b1_kg)],
              ['B2', fmtKg(batchYield.b2_kg)], ['B3', fmtKg(batchYield.b3_kg)], ['CSR', fmtKg(batchYield.csr_kg)],
              ['Short grain', fmtKg(batchYield.short_grain_kg)], ['Broken (total)', fmtKg(batchYield.broken_kg)],
              ['Powder', fmtKg(batchYield.powder_kg)], ['Sweepings', fmtKg(batchYield.sweeping_kg)], ['Choba', fmtKg(batchYield.choba_kg)], ['Sortex rejects', fmtKg(batchYield.sortex_rejects_kg)],
            ].filter((r) => parseFloat(String(r[1]).replace(/,/g, '')) > 0)}
            empty="No yield recorded."
          />
        </Section>
      )}

      {reservations.length > 0 && (
        <Section title="Reservations">
          <Table
            head={['Order', 'Reserved kg', 'Status']}
            align={['left', 'right', 'left']}
            rows={reservations.map((r) => [r.order_no || `#${r.order_id}`, fmtKg(r.reserved_qty), r.status || '—'])}
            empty=""
          />
        </Section>
      )}

      <Section title="Movement ledger">
        <Table
          head={['Date', 'Txn', 'Type', 'Qty (kg)', 'Balance (kg)', 'Reference', 'Remarks']}
          align={['left', 'left', 'left', 'right', 'right', 'left', 'left']}
          rows={transactions.map((t) => [
            fmtDate(t.transaction_date), t.transaction_no || '—', (t.transaction_type || '').replace(/_/g, ' '),
            fmtKg(t.quantity_kg), t.balance_kg != null ? fmtKg(t.balance_kg) : '—',
            t.reference_no || (t.reference_module ? t.reference_module.replace(/_/g, ' ') : '—'), t.remarks || '—',
          ])}
          empty="No movements recorded."
        />
      </Section>
    </div>
  );
}

// ─── Many lots, merged into one combined report ────────────────────────
function CombinedReport({ lots }) {
  // Pre-flatten the cross-lot rows once.
  const qualityRows = lots.map(({ lot }) => {
    const qj = lot.quality_json || {};
    return [
      lotName(lot), pct(qj.moisture ?? lot.moisture_pct), pct(qj.broken ?? lot.broken_pct),
      show(qj.whiteness ?? lot.whiteness), pct(qj.purity ?? lot.purity),
      pct(qj.chalky ?? lot.chalky), pct(qj.foreign_matter ?? lot.foreign_matter),
    ];
  });

  const blendRows = lots
    .filter((b) => b.blendRecipe && Array.isArray(b.blendRecipe.inputs) && b.blendRecipe.inputs.length)
    .flatMap((b) => b.blendRecipe.inputs.map((i) => [
      lotName(b.lot), i.variety || '—', i.source_lot_no || '—', i.supplier_name || '—',
      Math.round(num(i.qty_kg) || 0).toLocaleString(), i.ratio_pct != null ? `${i.ratio_pct}%` : '—', pct(i.moisture), i.grade || '—',
    ]));

  const yieldRows = lots
    .filter((b) => b.batchYield)
    .map((b) => {
      const y = b.batchYield;
      return [
        lotName(b.lot), fmtKg(y.actual_finished_kg), fmtKg(y.b1_kg), fmtKg(y.b2_kg),
        fmtKg(y.b3_kg), fmtKg(y.csr_kg), fmtKg(y.short_grain_kg), fmtKg(y.broken_kg),
      ];
    });

  const reservationRows = lots.flatMap((b) =>
    (b.reservations || []).map((r) => [lotName(b.lot), r.order_no || `#${r.order_id}`, fmtKg(r.reserved_qty), r.status || '—']));

  const ledgerRows = lots.flatMap((b) =>
    (b.transactions || []).map((t) => [
      lotName(b.lot), fmtDate(t.transaction_date), (t.transaction_type || '').replace(/_/g, ' '),
      fmtKg(t.quantity_kg), t.balance_kg != null ? fmtKg(t.balance_kg) : '—',
      t.reference_no || (t.reference_module ? t.reference_module.replace(/_/g, ' ') : '—'),
    ]));

  return (
    <div className="space-y-5">
      <Section title="Quantities">
        <Table
          head={['Lot', 'Total kg', 'Available kg', 'Reserved kg', 'Sold kg', 'Damaged kg']}
          align={['left', 'right', 'right', 'right', 'right', 'right']}
          rows={lots.map(({ lot }) => [
            lotName(lot), fmtKg(lot.qty), fmtKg(lot.available_qty), fmtKg(lot.reserved_qty),
            fmtKg(num(lot.sold_weight_kg) || 0),
            fmtKg(num(lot.damaged_weight_kg) || 0),
          ])}
          empty=""
        />
      </Section>

      <Section title="Costing">
        <Table
          head={['Lot', 'Rate/kg', 'Landed/kg', 'Net (kg)', 'Value']}
          align={['left', 'right', 'right', 'right', 'right']}
          rows={lots.map(({ lot }) => [
            lotName(lot), fmtPkr(lot.rate_per_kg), fmtPkr(lot.landed_cost_per_kg), fmtKg(netKg(lot)), fmtPkr(lotValuePkr(lot)),
          ])}
          totalRow={['TOTAL', '', '', fmtKg(lots.reduce((s, b) => s + netKg(b.lot), 0)), fmtPkr(lots.reduce((s, b) => s + lotValuePkr(b.lot), 0))]}
          empty=""
        />
      </Section>

      <Section title="Quality">
        <Table
          head={['Lot', 'Moisture', 'Broken', 'Whiteness', 'Purity', 'Chalky', 'Foreign']}
          align={['left', 'right', 'right', 'right', 'right', 'right', 'right']}
          rows={qualityRows}
          empty=""
        />
      </Section>

      {blendRows.length > 0 && (
        <Section title="Blend inputs">
          <Table
            head={['Output Lot', 'Variety', 'Source Lot', 'Supplier', 'Qty kg', 'Ratio', 'Moisture', 'Grade']}
            align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'left']}
            rows={blendRows}
            empty=""
          />
        </Section>
      )}

      {yieldRows.length > 0 && (
        <Section title="Yield output composition (kg)">
          <Table
            head={['Lot', 'Finished', 'B1', 'B2', 'B3', 'CSR', 'Short', 'Broken']}
            align={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
            rows={yieldRows}
            empty=""
          />
        </Section>
      )}

      {reservationRows.length > 0 && (
        <Section title="Reservations">
          <Table
            head={['Lot', 'Order', 'Reserved kg', 'Status']}
            align={['left', 'left', 'right', 'left']}
            rows={reservationRows}
            empty=""
          />
        </Section>
      )}

      <Section title="Movement ledger (all lots)">
        <Table
          head={['Lot', 'Date', 'Type', 'Qty (kg)', 'Balance (kg)', 'Reference']}
          align={['left', 'left', 'left', 'right', 'right', 'left']}
          rows={ledgerRows}
          empty="No movements recorded."
        />
      </Section>
    </div>
  );
}

// ─── Entry point ───────────────────────────────────────────────────────
export function LotReportView({ lots = [], companyName, detail = 'full', generatedAt }) {
  const single = lots.length === 1;
  const totalMt = lots.reduce((s, b) => s + (num(b.lot.qty) || 0), 0);
  const availMt = lots.reduce((s, b) => s + (num(b.lot.available_qty) || 0), 0);
  const reservedMt = lots.reduce((s, b) => s + (num(b.lot.reserved_qty) || 0), 0);
  const totalValue = lots.reduce((s, b) => s + lotValuePkr(b.lot), 0);

  return (
    <div className="print-report space-y-6 text-sm text-gray-900">
      <Header
        companyName={companyName}
        title={single ? 'Lot Report' : 'Combined Lot Report'}
        subtitle={`${lots.length} lot${single ? '' : 's'}${generatedAt ? ` · ${new Date(generatedAt).toLocaleString()}` : ''}`}
      />

      {single ? (
        // One lot → show its full detail as-is (no redundant overview).
        detail === 'full'
          ? <LotCard bundle={lots[0]} />
          : (
            <SummaryRow items={[
              { label: 'Lot', value: lotName(lots[0].lot) },
              { label: 'Type', value: typeLabel(lots[0].lot.type) },
              { label: 'Total', value: `${fmtKg(totalMt)} kg` },
              { label: 'Available', value: `${fmtKg(availMt)} kg` },
              { label: 'Value', value: fmtPkr(totalValue) },
            ]} />
          )
      ) : (
        // Many lots → one merged report.
        <>
          <SummaryRow items={[
            { label: 'Lots', value: lots.length },
            { label: 'Total', value: `${fmtKg(totalMt)} kg` },
            { label: 'Available', value: `${fmtKg(availMt)} kg` },
            { label: 'Reserved', value: `${fmtKg(reservedMt)} kg` },
            { label: 'Value', value: fmtPkr(totalValue) },
          ]} />

          <Section title="Lots">
            <Table
              head={['Lot No', 'Type', 'Variety', 'Supplier', 'Total kg', 'Avail kg', 'Rate/kg', 'Value']}
              align={['left', 'left', 'left', 'left', 'right', 'right', 'right', 'right']}
              rows={lots.map(({ lot }) => [
                lotName(lot), typeLabel(lot.type), lot.variety || lot.item_name || lot.product_name || '—',
                lot.supplier_name || '—', fmtKg(lot.qty), fmtKg(lot.available_qty), fmtPkr(lot.rate_per_kg), fmtPkr(lotValuePkr(lot)),
              ])}
              totalRow={['TOTAL', '', '', '', fmtKg(totalMt), fmtKg(availMt), '', fmtPkr(totalValue)]}
              empty="No lots selected."
            />
          </Section>

          {detail === 'full' && <CombinedReport lots={lots} />}
        </>
      )}

      <Footer />
    </div>
  );
}
