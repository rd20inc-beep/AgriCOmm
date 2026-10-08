// GET /api/finance/alerts sends `severity` ('danger' | 'warning' | 'info') and
// a `type` that names the subject ('payable', 'bank', 'cheque' …), plus
// `title`, `message` and `link`. Normalise the severity in one place so the
// Home panel and the Alerts page colour an alert the same way.
export function alertSeverity(a) {
  const raw = String(a?.severity || a?.type || '').toLowerCase();
  if (['danger', 'critical', 'high', 'urgent'].includes(raw)) return 'danger';
  if (['warning', 'medium', 'warn'].includes(raw)) return 'warning';
  return 'info';
}
