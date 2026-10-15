// Finance settings the export receipt path reads (migration 343). Each falls
// back to its default when the row is missing or unreadable.
//
//   export_short_receipt_tolerance_usd  bank charges / short balance a USD order
//                                       may settle to 6200 Bank Charges (D-8)
//   export_short_write_off_account      account for a write-off above that;
//                                       empty = refused until one is named
//   export_advance_term_days            advance receivable due, days after creation

const DEFAULT_TOLERANCE_USD = 50;
const DEFAULT_ADVANCE_TERM_DAYS = 14;
const BANK_CHARGES_CODE = '6200';

async function settingRaw(conn, key) {
  const row = await conn('system_settings').where({ key }).first();
  return row ? row.value : undefined;
}

async function shortReceiptToleranceUsd(conn) {
  const n = parseFloat(await settingRaw(conn, 'export_short_receipt_tolerance_usd'));
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TOLERANCE_USD;
}

async function shortWriteOffAccount(conn) {
  const v = String((await settingRaw(conn, 'export_short_write_off_account')) || '').trim();
  return v || null;
}

async function advanceTermDays(conn) {
  const n = parseInt(await settingRaw(conn, 'export_advance_term_days'), 10);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : DEFAULT_ADVANCE_TERM_DAYS;
}

/** 'YYYY-MM-DD' `days` from today. */
function dueInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

module.exports = {
  shortReceiptToleranceUsd, shortWriteOffAccount, advanceTermDays, dueInDays,
  DEFAULT_TOLERANCE_USD, DEFAULT_ADVANCE_TERM_DAYS, BANK_CHARGES_CODE,
};
