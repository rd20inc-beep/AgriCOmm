// Mill ▸ Rice Purchases ledger helpers (P3-14).

// One ledger row's figures, straight from the server (P3-14): KG and Rs/kg,
// value = weight_kg × price_per_kg. Shared by the table and the CSV so the
// two can never disagree.
export function purchaseFigures(r) {
  const weightKg = parseFloat(r.weight_kg) || 0;
  const pricePerKg = r.price_per_kg != null ? parseFloat(r.price_per_kg) : null;
  const valuePkr = r.value_pkr != null ? parseFloat(r.value_pkr) : null;
  return { weightKg, pricePerKg, valuePkr, variety: r.product_name || r.product_code || r.variety || '' };
}

const CSV_HEADER = ['Date', 'Vehicle', 'Driver', 'Supplier', 'Variety', 'Batch', 'Lot No', 'Weight (KG)', 'Bags', 'Price/KG', 'Value (PKR)', 'Moisture %', 'Broken %', 'Notes'];

export function purchasesCsv(rows) {
  const lines = rows.map(r => {
    const q = r.quality_json || {};
    const f = purchaseFigures(r);
    return [
      r.arrival_date ? new Date(r.arrival_date).toISOString().split('T')[0] : '',
      r.vehicle_no || '',
      r.driver_name || '',
      r.supplier_name || '',
      f.variety,
      r.batch_no || '',
      r.lot_no || '',
      f.weightKg ? f.weightKg.toFixed(2) : '',
      r.total_bags || '',
      f.pricePerKg != null ? f.pricePerKg : '',
      f.valuePkr != null ? f.valuePkr.toFixed(2) : '',
      q.moisture ?? '',
      q.broken ?? '',
      (r.notes || '').replace(/[\r\n,]/g, ' '),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [CSV_HEADER.join(','), ...lines].join('\n');
}
