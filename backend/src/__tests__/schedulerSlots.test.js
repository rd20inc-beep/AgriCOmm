/**
 * Scheduler calendar slots (P2-27): next_run is the next CALENDAR slot strictly
 * after now — no drift, no skipped month-ends, real cron parsing (the old
 * runner treated any expression containing a '1' as weekly), and downtime
 * skips missed slots rather than replaying them.
 */
const { parseCron, nextCronTime, nextMonthlyDaySlot, addCadence, nextSlot } = require('../modules/admin/schedulerSlots');

const at = (s) => new Date(s);
const iso = (d) => d.toISOString();

describe('cron expressions', () => {
  test('daily at 09:00 UTC', () => {
    expect(iso(nextCronTime('0 9 * * *', at('2026-10-15T08:59:00Z')))).toBe('2026-10-15T09:00:00.000Z');
    expect(iso(nextCronTime('0 9 * * *', at('2026-10-15T09:00:00Z')))).toBe('2026-10-16T09:00:00.000Z');
  });

  test('weekly on Monday 08:00 — a "1" in the day-of-week, not "anything containing 1"', () => {
    // 2026-10-15 is a Thursday → next Monday 2026-10-19.
    expect(iso(nextCronTime('0 8 * * 1', at('2026-10-15T12:00:00Z')))).toBe('2026-10-19T08:00:00.000Z');
    // '0 10 * * *' contains a 1 but is DAILY.
    expect(iso(nextCronTime('0 10 * * *', at('2026-10-15T12:00:00Z')))).toBe('2026-10-16T10:00:00.000Z');
  });

  test('Friday 17:00, lists, ranges and steps', () => {
    expect(iso(nextCronTime('0 17 * * 5', at('2026-10-15T00:00:00Z')))).toBe('2026-10-16T17:00:00.000Z');
    expect(iso(nextCronTime('*/15 9-10 * * *', at('2026-10-15T09:20:00Z')))).toBe('2026-10-15T09:30:00.000Z');
    expect(iso(nextCronTime('0 6 1,15 * *', at('2026-10-15T07:00:00Z')))).toBe('2026-11-01T06:00:00.000Z');
  });

  test('month-end: the 31st skips months that have none', () => {
    expect(iso(nextCronTime('0 0 31 * *', at('2026-10-31T01:00:00Z')))).toBe('2026-12-31T00:00:00.000Z');
  });

  test('garbage is not a cron expression', () => {
    expect(parseCron('every tuesday')).toBeNull();
    expect(parseCron('0 25 * * *')).toBeNull();
    expect(nextCronTime('1', at('2026-10-15T00:00:00Z'))).toBeNull();
  });
});

describe('monthly payroll slot (day 1-28, 06:00 UTC)', () => {
  test('later the same day rolls to next month — never a slot in the past', () => {
    expect(iso(nextMonthlyDaySlot(28, at('2026-10-28T10:00:00Z')))).toBe('2026-11-28T06:00:00.000Z');
    expect(iso(nextMonthlyDaySlot(28, at('2026-10-28T05:00:00Z')))).toBe('2026-10-28T06:00:00.000Z');
  });
  test('December rolls into January', () => {
    expect(iso(nextMonthlyDaySlot(5, at('2026-12-20T00:00:00Z')))).toBe('2027-01-05T06:00:00.000Z');
  });
  test('day is clamped to 1..28', () => {
    expect(iso(nextMonthlyDaySlot(31, at('2027-02-01T00:00:00Z')))).toBe('2027-02-28T06:00:00.000Z');
  });
});

describe('cadence words keep their anchor', () => {
  test('monthly from the 31st stays at month-end (no drift to the 3rd)', () => {
    const a = at('2026-01-31T09:00:00Z');
    expect(iso(addCadence(a, 'monthly', 1))).toBe('2026-02-28T09:00:00.000Z');
    expect(iso(addCadence(a, 'monthly', 2))).toBe('2026-03-31T09:00:00.000Z');
  });

  test('downtime skips the missed slots and lands on the next one at the same time of day', () => {
    const task = { task_type: 'report_email', cron_expression: 'daily', next_run: '2026-10-10T09:00:00Z' };
    const slot = nextSlot(task, at('2026-10-15T13:00:00Z'));
    expect(iso(slot.at)).toBe('2026-10-16T09:00:00.000Z');
    expect(slot.known).toBe(true);
  });

  test('a run that finishes late does not push the next slot later', () => {
    const task = { task_type: 'report_email', cron_expression: 'weekly', next_run: '2026-10-12T08:00:00Z' };
    expect(iso(nextSlot(task, at('2026-10-12T08:47:00Z')).at)).toBe('2026-10-19T08:00:00.000Z');
  });

  test('payroll_prepare uses the configured day', () => {
    const task = { task_type: 'payroll_prepare', cron_expression: 'monthly', config: JSON.stringify({ day_of_month: 3 }) };
    expect(iso(nextSlot(task, at('2026-10-15T00:00:00Z')).at)).toBe('2026-11-03T06:00:00.000Z');
  });

  test('an unrecognised schedule falls back to daily and is flagged', () => {
    const slot = nextSlot({ task_type: 'x', cron_expression: 'whenever' }, at('2026-10-15T00:00:00Z'));
    expect(slot.known).toBe(false);
    expect(iso(slot.at)).toBe('2026-10-16T00:00:00.000Z');
  });
});
