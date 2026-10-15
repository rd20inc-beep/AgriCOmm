// Mill ▸ Rice Purchases ledger helpers (P3-14).
import { toCsv, csvNum, downloadCsv } from '../../shared/utils/csv';

// One ledger row's figures, straight from the server (P3-14): KG and Rs/kg,
// value = weight_kg × price_per_kg. Shared by the table and the CSV so the
// two can never disagree.
export function purchaseFigures(r) {
  const weightKg = parseFloat(r.weight_kg) || 0;
  const pricePerKg = r.price_per_kg != null ? parseFloat(r.price_per_kg) : null;
  const valuePkr = r.value_pkr != null ? parseFloat(r.value_pkr) : null;
  return { weightKg, pricePerKg, valuePkr, variety: r.product_name || r.product_code || r.variety || '' };
}

// Written by the app's one CSV exporter (shared/utils/csv): raw numbers,
// blanks for missing figures, formula-injection guard, BOM (P4-14).
const CSV_COLUMNS = [
  { label: 'Date', accessor: (r) => (r.arrival_date ? new Date(r.arrival_date).toISOString().split('T')[0] : null) },
  { label: 'Vehicle', key: 'vehicle_no' },
  { label: 'Driver', key: 'driver_name' },
  { label: 'Supplier', key: 'supplier_name' },
  { label: 'Variety', accessor: (r) => purchaseFigures(r).variety },
  { label: 'Batch', key: 'batch_no' },
  { label: 'Lot No', key: 'lot_no' },
  { label: 'Weight (KG)', accessor: (r) => purchaseFigures(r).weightKg || null },
  { label: 'Bags', accessor: (r) => csvNum(r.total_bags) },
  { label: 'Price/KG', accessor: (r) => purchaseFigures(r).pricePerKg },
  { label: 'Value (PKR)', accessor: (r) => purchaseFigures(r).valuePkr },
  { label: 'Moisture %', accessor: (r) => csvNum((r.quality_json || {}).moisture) },
  { label: 'Broken %', accessor: (r) => csvNum((r.quality_json || {}).broken) },
  { label: 'Notes', key: 'notes' },
];

export function purchasesCsv(rows) {
  return toCsv(rows, CSV_COLUMNS);
}

export function downloadPurchasesCsv(rows, filename) {
  return downloadCsv({ rows, columns: CSV_COLUMNS, filename });
}
