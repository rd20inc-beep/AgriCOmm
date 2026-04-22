/**
 * Simple CSV export utility — no dependencies.
 * Usage: downloadCSV(data, columns, filename)
 */

export function downloadCSV(data, columns, filename = 'export.csv') {
  if (!data || data.length === 0) return;

  const headers = columns.map(c => c.label || c.key);
  const rows = data.map(row =>
    columns.map(c => {
      let val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.key];
      if (val == null) val = '';
      // Escape CSV: wrap in quotes if contains comma, newline, or quote
      val = String(val);
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    })
  );

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
