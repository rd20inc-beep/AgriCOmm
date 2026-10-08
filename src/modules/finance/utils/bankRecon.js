// Bank reconciliation (B5) — pure helpers for Accounts › Reconcile. The
// server (bankReconciliation.service.js) is the authority; these keep the
// screen's running figures in step while rows are ticked, before saving.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * The running figures for a set of ticked ids: what has cleared (opening +
 * Σ ticked, signed: money in +, out −) and how far that is from the statement.
 */
export function reconFigures({ opening = 0, transactions = [], ticked = new Set(), statementBalance = 0 }) {
  let tickedIn = 0; let tickedOut = 0; let count = 0;
  for (const t of transactions) {
    if (!ticked.has(t.id)) continue;
    count += 1;
    const s = Number(t.signed_amount) || 0;
    if (s >= 0) tickedIn += s; else tickedOut += -s;
  }
  const cleared = round2(Number(opening) + tickedIn - tickedOut);
  const difference = round2((Number(statementBalance) || 0) - cleared);
  return { tickedIn: round2(tickedIn), tickedOut: round2(tickedOut), count, cleared, difference, balanced: Math.abs(difference) < 0.005 };
}

/** True when the screen's ticks differ from what the server has saved. */
export function ticksChanged(saved, current) {
  if (saved.size !== current.size) return true;
  for (const id of current) if (!saved.has(id)) return true;
  return false;
}

// One CSV field list, honouring double quotes ("a, b" stays one field).
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const num = (s) => {
  const v = String(s ?? '').replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd → yyyy-mm-dd (bank statements here are day-first).
function isoDate(s) {
  const v = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Statement lines from a CSV: a header row naming date, description and
 * either amount (signed: deposits +, withdrawals −) or debit / credit
 * columns. Returns { lines: [{ date, reference, amount }], errors }.
 */
export function parseStatementCsv(text) {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!rows.length) return { lines: [], errors: ['The file is empty.'] };
  const head = splitCsvLine(rows[0]).map((h) => h.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iDate = col('date');
  const iDesc = col('description', 'narration', 'details', 'particulars', 'reference');
  const iAmt = col('amount');
  const iDebit = col('debit', 'withdrawal');
  const iCredit = col('credit', 'deposit');
  if (iDate < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) {
    return { lines: [], errors: ['The first row must name a date column and an amount (or debit / credit) column.'] };
  }
  const lines = []; const errors = [];
  rows.slice(1).forEach((raw, i) => {
    const f = splitCsvLine(raw);
    const date = isoDate(f[iDate]);
    let amount = iAmt >= 0 ? num(f[iAmt]) : null;
    if (amount === null && (iDebit >= 0 || iCredit >= 0)) {
      const cr = iCredit >= 0 ? num(f[iCredit]) : null;
      const dr = iDebit >= 0 ? num(f[iDebit]) : null;
      if (cr !== null || dr !== null) amount = (cr || 0) - (dr || 0);
    }
    if (!date || amount === null) { errors.push(`Row ${i + 2}: no readable date or amount.`); return; }
    lines.push({ date, reference: iDesc >= 0 ? (f[iDesc] || '').slice(0, 255) : '', amount: round2(amount) });
  });
  return { lines, errors };
}
