import { cappedHint } from '../utils/listCap';

// "Showing 200 of 1,234 — narrow the date range to see the rest." Renders
// nothing when every matching row is on screen. `rows` is the array a list
// hook returned (its non-enumerable listTotal is the server's match count).
export default function ListCapHint({ rows, total, className = '' }) {
  const shown = Array.isArray(rows) ? rows.length : 0;
  const hint = cappedHint(shown, total ?? rows?.listTotal);
  if (!hint) return null;
  return (
    <p className={`text-[11px] text-amber-700 ${className}`}>
      {hint} — newest first; narrow the date range or filters to see the rest.
    </p>
  );
}
