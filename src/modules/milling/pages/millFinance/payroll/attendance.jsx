import { useState } from 'react';
import { Receipt, CalendarDays, X, FileText } from 'lucide-react';
import { useAttendance, useBulkAttendance, useImportAttendance, useAttendanceHolidays } from '../../../../../api/queries';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { fmtPKR } from '../../../../../shared/utils/format';
import { Sm } from './EmployeeLedgerDrawer';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Monthly attendance register — rows = active employees, columns = each day of
// the month. Click a cell to cycle Present → Half-day → Leave → Absent. Feeds the
// payroll summary's effective-days math. Posts via the existing /attendance upsert.
const ATT_ORDER = ['present', 'half_day', 'leave', 'absent', 'off'];
const ATT_LETTER = { present: 'P', half_day: 'H', leave: 'L', absent: 'A', off: 'O' };
const ATT_STYLE = {
  present: 'bg-emerald-500 text-white',
  half_day: 'bg-amber-400 text-white',
  leave: 'bg-sky-400 text-white',
  absent: 'bg-red-400 text-white',
  off: 'bg-slate-400 text-white',
};
const ATT_LABEL = { present: 'Present', half_day: 'Half day', leave: 'Leave', absent: 'Absent', off: 'Off / holiday' };
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function EmployeeAttendanceGrid({ month, entity = 'mill', employees, recordAttMut, addToast }) {
  // One month of this entity's employees, uncapped on the server (PAY-10).
  const { data: records = [], isLoading } = useAttendance({ month, entity });
  const bulkMut = useBulkAttendance();
  const { data: holidays = [] } = useAttendanceHolidays(month);
  const [optimistic, setOptimistic] = useState({}); // `${id}|${date}` → status ('' = cleared) until refetch
  const [selDays, setSelDays] = useState(() => new Set());   // selected date columns
  const [selEmps, setSelEmps] = useState(() => new Set());   // selected employee rows (empty = all)
  const [showHolidays, setShowHolidays] = useState(false);
  const [holExcluded, setHolExcluded] = useState(() => new Set()); // holiday dates the user unticked
  const [showImport, setShowImport] = useState(false);

  const active = employees.filter(e => e.isActive);
  const activeIds = active.map(e => e.id);
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const dow = (d) => new Date(`${d}T00:00:00`).getDay();
  const isSunday = (d) => dow(d) === 0;
  const holidayByDate = {};
  for (const h of holidays) holidayByDate[String(h.date).slice(0, 10)] = h;

  const fetchedMap = {};
  for (const r of records) {
    const d = String(r.date).slice(0, 10);
    fetchedMap[`${r.workerId}|${d}`] = { status: r.status, overtimeHours: r.overtimeHours };
  }
  const statusOf = (id, date) => optimistic[`${id}|${date}`] ?? fetchedMap[`${id}|${date}`]?.status ?? null;

  async function cycle(emp, date) {
    const cur = statusOf(emp.id, date);
    const next = cur ? ATT_ORDER[(ATT_ORDER.indexOf(cur) + 1) % ATT_ORDER.length] : 'present';
    const key = `${emp.id}|${date}`;
    setOptimistic(o => ({ ...o, [key]: next }));
    try {
      await recordAttMut.mutateAsync({
        worker_id: emp.id, date, status: next,
        hours_worked: next === 'half_day' ? 4 : next === 'present' ? 8 : 0,
        overtime_hours: fetchedMap[key]?.overtimeHours || 0,
      });
      setOptimistic(o => { const n = { ...o }; delete n[key]; return n; });
    } catch (e) {
      setOptimistic(o => { const n = { ...o }; delete n[key]; return n; });
      addToast(e.message, 'error');
    }
  }

  // Apply one status across (dates × employees) in a single bulk call.
  async function bulkApply(targetDates, targetEmpIds, status, label) {
    const ds = [...targetDates], ids = targetEmpIds.length ? targetEmpIds : activeIds;
    if (!ds.length || !ids.length) return;
    const records2 = [], optim = {};
    for (const id of ids) for (const d of ds) {
      records2.push({ worker_id: id, date: d, status });
      optim[`${id}|${d}`] = status === 'clear' ? '' : status;
    }
    setOptimistic(o => ({ ...o, ...optim }));
    try {
      await bulkMut.mutateAsync({ records: records2 });
      setOptimistic(o => { const n = { ...o }; for (const k of Object.keys(optim)) delete n[k]; return n; });
      addToast(label || `${records2.length} cell(s) updated`, 'success');
    } catch (e) {
      setOptimistic(o => { const n = { ...o }; for (const k of Object.keys(optim)) delete n[k]; return n; });
      addToast(e.message, 'error');
    }
  }

  const toggleDay = (d) => setSelDays(s => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const toggleEmp = (id) => setSelEmps(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => { setSelDays(new Set()); setSelEmps(new Set()); };

  function applySelected(status) {
    const empIds = [...selEmps];
    bulkApply([...selDays], empIds, status,
      `${selDays.size} day(s)${empIds.length ? ` × ${empIds.length} emp` : ' · all'} → ${status === 'clear' ? 'cleared' : ATT_LABEL[status]}`);
    clearSel();
  }
  function markSundaysOff() {
    bulkApply(dates.filter(isSunday), activeIds, 'off', 'Sundays marked off');
  }
  function applyHolidays() {
    const pick = holidays.map(h => String(h.date).slice(0, 10)).filter(d => !holExcluded.has(d));
    if (!pick.length) { addToast('No holidays selected', 'error'); return; }
    bulkApply(pick, activeIds, 'off', `${pick.length} holiday(s) marked off`);
    setShowHolidays(false);
  }

  const effectiveDays = (emp) => dates.reduce((s, d) => {
    const st = statusOf(emp.id, d);
    return s + (st === 'present' ? 1 : st === 'half_day' ? 0.5 : 0);
  }, 0);
  // Total OT hours logged this month for an employee (from saved attendance).
  const otHours = (emp) => dates.reduce((s, d) => s + (parseFloat(fetchedMap[`${emp.id}|${d}`]?.overtimeHours) || 0), 0);
  const [otWorker, setOtWorker] = useState(null); // open the OT editor for this worker

  // Aggregate attendance stats for the summary strip.
  const stat = active.reduce((a, emp) => {
    for (const d of dates) { const st = statusOf(emp.id, d); if (st === 'present') a.present += 1; else if (st === 'half_day') a.half += 1; else if (st === 'absent') a.absent += 1; else if (st === 'leave') a.leave += 1; }
    a.ot += otHours(emp); return a;
  }, { present: 0, half: 0, absent: 0, leave: 0, ot: 0 });
  const markedCells = stat.present + stat.half + stat.absent + stat.leave;
  const attendanceRate = markedCells > 0 ? Math.round(((stat.present + stat.half * 0.5) / markedCells) * 100) : 0;

  if (active.length === 0) {
    return <div className="bg-white rounded-xl border border-gray-100 px-4 py-10 text-center text-sm text-gray-400">No active employees to mark attendance for.</div>;
  }

  return (
    <div className="space-y-3">
      {/* Attendance summary */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Sm label="Employees" value={String(active.length)} />
        <Sm label="Present days" value={String(stat.present)} tone="emerald" />
        <Sm label="Half days" value={String(stat.half)} tone="amber" />
        <Sm label="Absent / leave" value={`${stat.absent} / ${stat.leave}`} tone="rose" />
        <Sm label="Attendance %" value={`${attendanceRate}%`} />
        <Sm label="Overtime hrs" value={`${Math.round(stat.ot * 10) / 10}`} tone="amber" />
      </div>

      {/* Toolbar: quick actions + legend */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={markSundaysOff} disabled={bulkMut.isPending} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            <CalendarDays className="w-3.5 h-3.5" /> Mark Sundays Off
          </button>
          <button onClick={() => setShowImport(true)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
            <FileText className="w-3.5 h-3.5" /> Import CSV
          </button>
          <div className="relative">
            <button onClick={() => setShowHolidays(s => !s)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
              <Receipt className="w-3.5 h-3.5" /> 🇵🇰 Pakistan Holidays{holidays.length ? ` (${holidays.length})` : ''}
            </button>
            {showHolidays && (
              <div className="absolute z-30 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
                <div className="font-medium text-gray-700 mb-1.5">Federal holidays · {month}</div>
                {holidays.length === 0 ? (
                  <p className="text-gray-400 py-2">No federal holidays this month. Mark any day off via the grid or selection.</p>
                ) : (<>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {holidays.map(h => {
                      const d = String(h.date).slice(0, 10);
                      const checked = !holExcluded.has(d);
                      return (
                        <label key={d} className="flex items-center gap-2 py-0.5 cursor-pointer">
                          <input type="checkbox" checked={checked} onChange={() => setHolExcluded(s => { const n = new Set(s); checked ? n.add(d) : n.delete(d); return n; })} className="rounded border-gray-300" />
                          <span className="text-gray-700">{d.slice(8)} · {h.name}{h.approximate ? <span className="text-amber-500"> ~</span> : ''}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">~ Islamic dates are moon-sighting — verify the announced date.</p>
                  <button onClick={applyHolidays} disabled={bulkMut.isPending} className="mt-2 w-full px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">Mark selected as Off</button>
                </>)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-[11px] text-gray-500 flex-wrap">
          {ATT_ORDER.map(s => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`w-3.5 h-3.5 rounded-sm inline-flex items-center justify-center text-[9px] font-bold ${ATT_STYLE[s]}`}>{ATT_LETTER[s]}</span>
              {ATT_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Click a cell to cycle status. Click <span className="font-medium">date headers</span> (and optionally <span className="font-medium">employee names</span>) to select, then apply a status to many at once.</p>

      {/* Bulk action bar — appears when day columns are selected */}
      {selDays.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between flex-wrap gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-xs text-blue-800 font-medium">
            {selDays.size} day{selDays.size > 1 ? 's' : ''} {selEmps.size ? `× ${selEmps.size} employee${selEmps.size > 1 ? 's' : ''}` : '· all employees'} selected
          </span>
          <div className="flex items-center gap-1">
            {ATT_ORDER.map(s => (
              <button key={s} onClick={() => applySelected(s)} disabled={bulkMut.isPending}
                className={`px-2 py-1 rounded text-[11px] font-bold ${ATT_STYLE[s]} disabled:opacity-50`} title={ATT_LABEL[s]}>{ATT_LETTER[s]}</button>
            ))}
            <button onClick={() => applySelected('clear')} disabled={bulkMut.isPending} className="px-2 py-1 rounded text-[11px] font-medium bg-white text-gray-600 border border-gray-300 hover:bg-gray-50">Clear</button>
            <button aria-label="Clear selection" onClick={clearSel} className="ml-1 p-1 text-blue-400 hover:text-blue-700"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-x-auto">
        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">Loading attendance…</p>
        ) : (
        <table className="text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-gray-500">
              <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 font-medium min-w-[150px]">Employee</th>
              {dates.map(d => {
                const sel = selDays.has(d);
                const hol = holidayByDate[d];
                return (
                  <th key={d} className={`px-0 py-1 font-medium text-center w-7 ${sel ? 'bg-blue-100' : isSunday(d) ? 'bg-red-50' : ''}`}>
                    <button onClick={() => toggleDay(d)} title={`${d}${hol ? ` · ${hol.name}` : ''} — click to select`} className={`w-full leading-tight ${sel ? 'text-blue-700' : isSunday(d) || hol ? 'text-red-500' : 'text-gray-400'}`}>
                      <div className="text-[8px]">{WEEKDAY[dow(d)]}</div>
                      <div className="text-[10px] font-semibold">{d.slice(8)}</div>
                      {hol && <div className="text-[7px] leading-none text-amber-500">★</div>}
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2 font-medium text-right min-w-[64px]">Days</th>
              <th className="px-3 py-2 font-medium text-right min-w-[64px] no-print">OT hrs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {active.map(emp => {
              const empSel = selEmps.has(emp.id);
              return (
              <tr key={emp.id} className={`hover:bg-gray-50/50 ${empSel ? 'bg-blue-50/40' : ''}`}>
                <td className="sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">
                  <button onClick={() => toggleEmp(emp.id)} title="Click to select this employee for bulk actions" className={`font-medium ${empSel ? 'text-blue-700' : 'text-gray-800 hover:text-blue-600'}`}>
                    {empSel ? '☑ ' : ''}{emp.name}
                  </button>
                </td>
                {dates.map(d => {
                  const st = statusOf(emp.id, d);
                  const colSel = selDays.has(d);
                  return (
                    <td key={d} className={`px-0 py-1 text-center ${colSel ? 'bg-blue-50' : isSunday(d) ? 'bg-red-50/40' : ''}`}>
                      <button
                        onClick={() => cycle(emp, d)}
                        title={`${emp.name} · ${d}${st ? ` · ${ATT_LABEL[st]}` : ''}`}
                        className={`w-6 h-6 rounded text-[10px] font-bold transition ${st ? ATT_STYLE[st] : 'bg-gray-100 text-gray-300 hover:bg-gray-200'}`}
                      >
                        {st ? ATT_LETTER[st] : ''}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-gray-800">{effectiveDays(emp)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums no-print">
                  <button onClick={() => setOtWorker(emp)} title="Log overtime hours" className={`px-1.5 py-0.5 rounded text-xs font-medium ${otHours(emp) > 0 ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-blue-600 hover:bg-blue-50'}`}>
                    {otHours(emp) > 0 ? `${Math.round(otHours(emp) * 10) / 10}h` : '+ OT'}
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
      {otWorker && (
        <OvertimeEditor worker={otWorker} dates={dates} statusOf={statusOf}
          otFor={(d) => parseFloat(fetchedMap[`${otWorker.id}|${d}`]?.overtimeHours) || 0}
          recordAttMut={recordAttMut} addToast={addToast} onClose={() => setOtWorker(null)} />
      )}
      {showImport && (
        <AttendanceImportDrawer employees={active} month={month} addToast={addToast} onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}

// Bulk CSV attendance import (Phase 21). Parses a CSV client-side, matches each
// row to a worker (CNIC, else name), validates date+status, previews matched vs
// errored rows, then upserts via /attendance/import (status + hours + OVERTIME).
const ATT_STATUS_MAP = { p: 'present', present: 'present', a: 'absent', absent: 'absent', h: 'half_day', half: 'half_day', half_day: 'half_day', 'half day': 'half_day', hd: 'half_day', l: 'leave', leave: 'leave', o: 'off', off: 'off', holiday: 'off' };
function parseCsv(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = []; let cur = ''; let q = false;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (q) { if (c === '"' && raw[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((s) => s.trim()));
  }
  return rows;
}
function normalizeDate(s) {
  const t = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}
export function AttendanceImportDrawer({ employees, month, addToast, onClose }) {
  const importMut = useImportAttendance();
  const [parsed, setParsed] = useState(null); // { valid:[], errors:[] }
  const [fileName, setFileName] = useState('');

  const byCnic = new Map(employees.filter((e) => e.cnic).map((e) => [String(e.cnic).replace(/\s/g, ''), e]));
  const byName = new Map(employees.map((e) => [String(e.name).trim().toLowerCase(), e]));

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(reader.result);
      if (!rows.length) { setParsed({ valid: [], errors: [] }); return; }
      // header detection
      const header = rows[0].map((h) => h.toLowerCase());
      const col = (...names) => header.findIndex((h) => names.some((n) => h.includes(n)));
      const ci = { cnic: col('cnic'), name: col('name', 'employee', 'worker'), date: col('date'), status: col('status', 'attendance'), ot: col('overtime', 'ot') };
      const hasHeader = ci.date >= 0 || ci.status >= 0 || ci.cnic >= 0;
      const body = hasHeader ? rows.slice(1) : rows;
      if (!hasHeader) { ci.cnic = 0; ci.name = 1; ci.date = 2; ci.status = 3; ci.ot = 4; }
      const valid = []; const errors = [];
      body.forEach((r, idx) => {
        const rowNo = (hasHeader ? idx + 2 : idx + 1);
        const cnicV = ci.cnic >= 0 ? String(r[ci.cnic] || '').replace(/\s/g, '') : '';
        const nameV = ci.name >= 0 ? String(r[ci.name] || '').trim().toLowerCase() : '';
        const w = (cnicV && byCnic.get(cnicV)) || (nameV && byName.get(nameV)) || null;
        const date = normalizeDate(r[ci.date]);
        const status = ATT_STATUS_MAP[String(r[ci.status] || '').trim().toLowerCase()];
        const ot = Math.max(0, parseFloat(r[ci.ot]) || 0);
        if (!w) { errors.push({ row: rowNo, reason: `No match for "${r[ci.cnic] || r[ci.name] || '?'}"` }); return; }
        if (!date) { errors.push({ row: rowNo, reason: `Bad date "${r[ci.date] || ''}"` }); return; }
        if (!status) { errors.push({ row: rowNo, reason: `Bad status "${r[ci.status] || ''}"` }); return; }
        valid.push({ row: rowNo, worker_id: w.id, workerName: w.name, date, status, overtime_hours: ot });
      });
      setParsed({ valid, errors });
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!parsed?.valid.length) return;
    try {
      const res = await importMut.mutateAsync({ records: parsed.valid.map(({ row, worker_id, date, status, overtime_hours }) => ({ row, worker_id, date, status, overtime_hours })) });
      const d = res?.data || res;
      addToast(`Imported ${d.imported} row(s)${d.skipped ? `, ${d.skipped} skipped` : ''}`, d.skipped ? 'info' : 'success');
      onClose();
    } catch (e) { addToast(e.message, 'error'); }
  }

  function downloadTemplate() {
    const sample = employees.slice(0, 2);
    const rows = [['CNIC', 'Name', 'Date', 'Status', 'Overtime']];
    sample.forEach((e) => rows.push([e.cnic || '', e.name, `${month}-01`, 'present', '0']));
    if (!sample.length) rows.push(['35201-0000000-0', 'Worker Name', `${month}-01`, 'present', '2']);
    const csv = rows.map((r) => r.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `attendance-template-${month}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <SlideDrawer open onClose={onClose} title="Import attendance (CSV)" subtitle="Status + overtime for many employees at once" icon={FileText} size="lg">
      <div className="space-y-4">
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800">
          CSV columns: <b>CNIC</b> (or Name), <b>Date</b> (YYYY-MM-DD or DD/MM/YYYY), <b>Status</b> (present / absent / half_day / leave / off — P/A/H/L/O also work), <b>Overtime</b> (hours). Existing days are updated; overtime is set per row.
          <button onClick={downloadTemplate} className="ml-1 underline font-medium">Download template</button>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files[0])} className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-900 file:text-white hover:file:bg-gray-700" />
          {fileName && <span className="text-[11px] text-gray-400">{fileName}</span>}
        </label>

        {parsed && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-50 p-2.5"><div className="text-[10px] uppercase text-emerald-500">Ready to import</div><div className="text-lg font-bold text-emerald-700">{parsed.valid.length}</div></div>
              <div className="rounded-lg bg-red-50 p-2.5"><div className="text-[10px] uppercase text-red-500">Errors (skipped)</div><div className="text-lg font-bold text-red-700">{parsed.errors.length}</div></div>
            </div>
            {parsed.valid.length > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-xs mobile-cards">
                  <thead><tr className="bg-gray-50 text-gray-500"><th className="text-left px-3 py-1.5">Employee</th><th className="text-left px-3 py-1.5">Date</th><th className="text-left px-3 py-1.5">Status</th><th className="text-right px-3 py-1.5">OT</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsed.valid.slice(0, 60).map((v, i) => (
                      <tr key={i}><td data-label="OT" data-label="Status" data-label="Date" data-label="Employee" className="px-3 py-1 text-gray-800">{v.workerName}</td><td className="px-3 py-1 text-gray-500">{v.date}</td><td className="px-3 py-1 capitalize">{v.status.replace('_', ' ')}</td><td className="px-3 py-1 text-right tabular-nums">{v.overtime_hours || ''}</td></tr>
                    ))}
                  </tbody>
                </table>
                {parsed.valid.length > 60 && <div className="px-3 py-1.5 text-[11px] text-gray-400">+ {parsed.valid.length - 60} more…</div>}
              </div>
            )}
            {parsed.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-2.5 text-xs text-red-700 space-y-0.5 max-h-40 overflow-auto">
                {parsed.errors.slice(0, 30).map((e, i) => <div key={i}>Row {e.row}: {e.reason}</div>)}
                {parsed.errors.length > 30 && <div className="text-red-400">+ {parsed.errors.length - 30} more…</div>}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={doImport} disabled={!parsed.valid.length || importMut.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Import {parsed.valid.length} row(s)</button>
            </div>
          </>
        )}
      </div>
    </SlideDrawer>
  );
}

// Per-employee overtime editor — set OT hours on the month's present/half days
// (with a "set all" quick action). Posts via the attendance upsert; OT pay is
// valued at the worker's ot_rate_per_hour (or 1.5× hourly) in payroll.
export function OvertimeEditor({ worker, dates, statusOf, otFor, recordAttMut, addToast, onClose }) {
  const workDays = dates.filter(d => ['present', 'half_day'].includes(statusOf(worker.id, d)));
  const [otMap, setOtMap] = useState(() => Object.fromEntries(workDays.map(d => [d, String(otFor(d) || '')])));
  const [bulk, setBulk] = useState('');
  const [saving, setSaving] = useState(false);
  const dailyWage = parseFloat(worker.dailyWage) || (parseFloat(worker.monthlySalary) || 0) / 26;
  const otRate = parseFloat(worker.otRatePerHour) > 0 ? parseFloat(worker.otRatePerHour) : (dailyWage / 8 * 1.5);
  const totalOt = Object.values(otMap).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const setAll = () => { const v = bulk; setOtMap(Object.fromEntries(workDays.map(d => [d, v]))); };

  async function save() {
    setSaving(true);
    try {
      for (const d of workDays) {
        const v = Math.max(0, parseFloat(otMap[d]) || 0);
        if (v === (otFor(d) || 0)) continue; // unchanged
        await recordAttMut.mutateAsync({ worker_id: worker.id, date: d, status: statusOf(worker.id, d), hours_worked: statusOf(worker.id, d) === 'half_day' ? 4 : 8, overtime_hours: v });
      }
      addToast(`Overtime saved for ${worker.name}`, 'success'); onClose();
    } catch (e) { addToast(e.message, 'error'); } finally { setSaving(false); }
  }

  return (
    <SlideDrawer open onClose={onClose} title="Overtime" subtitle={`${worker.name} · ${worker.role || ''}`} icon={CalendarDays} size="md"
      footer={<div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-500">{Math.round(totalOt * 10) / 10}h × {PKR(otRate)}/h ≈ <span className="font-semibold text-amber-700">{PKR(totalOt * otRate)}</span></span>
        <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save overtime'}</button></div></div>}>
      <div className="space-y-3">
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">Enter overtime hours per worked day. OT is valued at {PKR(otRate)}/hour ({parseFloat(worker.otRatePerHour) > 0 ? 'fixed rate' : '1.5× hourly'}) and added to gross pay when the run is prepared.</div>
        {workDays.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No present/half days this month — mark attendance first.</p> : (
          <>
            <div className="flex items-end gap-2">
              <div className="flex-1"><label className="block text-[11px] text-gray-500 mb-1">Set all worked days to</label><input type="number" min="0" value={bulk} onChange={e => setBulk(e.target.value)} placeholder="hours" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums" /></div>
              <button onClick={setAll} className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700">Apply to all</button>
            </div>
            <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {workDays.map(d => (
                <div key={d} className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-sm text-gray-700">{new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}<span className="text-[10px] text-gray-400 ml-1 capitalize">{statusOf(worker.id, d) === 'half_day' ? 'half' : 'present'}</span></span>
                  <input type="number" min="0" value={otMap[d] || ''} onChange={e => setOtMap(m => ({ ...m, [d]: e.target.value }))} placeholder="0" className="w-20 border border-gray-200 rounded px-2 py-1 text-right text-sm tabular-nums" />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </SlideDrawer>
  );
}
