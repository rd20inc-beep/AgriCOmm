// Calendar slots for scheduled_tasks (P2-27). Pure functions, no DB.
//
// next_run used to be "the moment the task finished + an interval": every run
// drifted later, a run that finished on the 31st skipped a month, and any
// cron_expression containing a '1' was treated as weekly. A task's next run is
// now the next CALENDAR SLOT strictly after `now`:
//   - payroll_prepare      the configured day of the month, 06:00 UTC (11:00 PKT)
//   - 'daily' / 'weekly' / 'monthly'   stepped from the task's own anchor (its
//                          previous slot), so the time of day / weekday / day
//                          of month never wanders; missed slots during
//                          downtime are skipped, not replayed one by one
//   - a 5-field cron expression (minute hour day-of-month month day-of-week),
//     evaluated in UTC: '*', numbers, lists, ranges and steps
//   - anything else        24 hours from now (and the task is reported)

const DAY_MS = 86400000;

function parseField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    let lo; let hi;
    if (m[1] === '*') { lo = min; hi = max; } else if (m[1].includes('-')) { [lo, hi] = m[1].split('-').map(Number); } else { lo = Number(m[1]); hi = m[2] ? max : lo; }
    const step = m[2] ? Number(m[2]) : 1;
    if (!(step > 0) || lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** Parse a 5-field cron expression; null when it is not one. */
function parseCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseField(f[0], 0, 59);
  const hour = parseField(f[1], 0, 23);
  const dom = parseField(f[2], 1, 31);
  const month = parseField(f[3], 1, 12);
  const dowRaw = parseField(f[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set([...dowRaw].map((d) => d % 7)); // 7 = Sunday
  // Standard cron: when both day fields are restricted, either may match.
  return { minute, hour, dom, month, dow, domAny: f[2] === '*', dowAny: f[4] === '*' };
}

/** The first time strictly after `after` matching the cron expression (UTC). */
function nextCronTime(expr, after = new Date()) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  if (!c) return null;
  const t = new Date(after.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  const limit = after.getTime() + 366 * 4 * DAY_MS;
  while (t.getTime() <= limit) {
    const dayOk = (() => {
      const d = c.dom.has(t.getUTCDate()); const w = c.dow.has(t.getUTCDay());
      if (c.domAny && c.dowAny) return true;
      if (c.domAny) return w;
      if (c.dowAny) return d;
      return d || w;
    })();
    if (!c.month.has(t.getUTCMonth() + 1) || !dayOk) {
      t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(0, 0, 0, 0); continue;
    }
    if (!c.hour.has(t.getUTCHours())) { t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0); continue; }
    if (!c.minute.has(t.getUTCMinutes())) { t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0); continue; }
    return t;
  }
  return null;
}

/** The first monthly payroll slot (day-of-month 1..28, 06:00 UTC) strictly after `after`. */
function nextMonthlyDaySlot(dayOfMonth, after = new Date()) {
  const day = Math.min(28, Math.max(1, parseInt(dayOfMonth, 10) || 28));
  let y = after.getUTCFullYear(); let m = after.getUTCMonth();
  for (let i = 0; i < 3; i += 1) {
    const slot = new Date(Date.UTC(y, m, day, 6, 0, 0));
    if (slot.getTime() > after.getTime()) return slot;
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return new Date(Date.UTC(y, m, day, 6, 0, 0));
}

// Add `n` cadence steps to an anchor. Months are added to the ANCHOR's day
// (clamped to the month's last day) so the 31st stays month-end, not the 3rd.
function addCadence(anchor, cadence, n) {
  const a = new Date(anchor.getTime());
  if (cadence === 'daily') return new Date(a.getTime() + n * DAY_MS);
  if (cadence === 'weekly') return new Date(a.getTime() + n * 7 * DAY_MS);
  const y = a.getUTCFullYear(); const mo = a.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(a.getUTCDate(), last), a.getUTCHours(), a.getUTCMinutes(), 0));
}

/**
 * The next slot for a task strictly after `now`.
 * Returns { at: Date, rule: string, known: boolean }.
 */
function nextSlot(task, now = new Date()) {
  let cfg = task.config;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = {}; } }
  cfg = cfg || {};
  if (task.task_type === 'payroll_prepare') {
    return { at: nextMonthlyDaySlot(cfg.day_of_month, now), rule: `day ${cfg.day_of_month || 28} monthly`, known: true };
  }
  const cadence = String(task.cron_expression || '').trim();
  if (['daily', 'weekly', 'monthly'].includes(cadence)) {
    const anchor = task.next_run ? new Date(task.next_run) : now;
    let k = 0; let at = anchor;
    while (at.getTime() <= now.getTime() && k < 100000) { k += 1; at = addCadence(anchor, cadence, k); }
    return { at, rule: cadence, known: true };
  }
  const cron = nextCronTime(cadence, now);
  if (cron) return { at: cron, rule: `cron ${cadence}`, known: true };
  return { at: new Date(now.getTime() + DAY_MS), rule: 'unrecognised schedule — retried daily', known: false };
}

module.exports = { parseCron, nextCronTime, nextMonthlyDaySlot, addCadence, nextSlot };
