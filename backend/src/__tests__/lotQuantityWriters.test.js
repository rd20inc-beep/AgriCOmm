/**
 * P3-01 — one writer of a lot's quantity columns.
 *
 * qty, available_qty, reserved_qty, milling_reserved_qty, net_weight_kg and
 * gross_weight_kg change only inside inventoryService.postMovement (which also
 * writes the lot_transactions row, under a lock). This static sweep reads every
 * knex update / insert on inventory_lots in backend/src and fails when one
 * writes those columns anywhere else:
 *
 *   - an object literal that sets a quantity column to anything but 0 (a new
 *     lot is created empty, then filled by a movement);
 *   - an object literal that spreads another row (`...clone`) without zeroing
 *     every quantity column after it;
 *   - a variable payload (`.update(row)`), which the sweep can't read.
 *
 * Each of the last two, and the few deliberate exceptions, carries a marker
 * comment within the three lines above the call:
 *   // lot-qty-writer: <why>   — writes quantities; only in WRITER_FILES
 *   // lot-qty-free: <why>     — the payload holds no quantity column
 *
 * lot_transactions rows are written by postMovement alone.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const QTY_COLS = ['qty', 'available_qty', 'reserved_qty', 'milling_reserved_qty', 'net_weight_kg', 'gross_weight_kg'];

// Files allowed to carry a lot-qty-writer marker, and how many each may carry.
const WRITER_FILES = {
  // postMovement itself + the re-yield reset of an existing output lot, whose
  // own batch ledger rows are cleared just before it (P3-03 owns that path).
  'modules/inventory/inventory.service.js': 3,
  // Super-Admin hard deletes: the ledger rows being restocked are deleted with
  // the document, so the restock is written straight back (derived available).
  'modules/admin/dangerZone.controller.js': 3,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

// The text between the parens that open at `start` (index of '(').
function parenArg(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(start + 1, i); }
  }
  return '';
}

// Top-level `key: value` pairs and spreads of an object literal.
function literalEntries(obj) {
  const body = obj.trim().replace(/^\{/, '').replace(/\}$/, '');
  const entries = [];
  let depth = 0; let cur = '';
  for (const c of body) {
    if ('([{'.includes(c)) depth += 1;
    if (')]}'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { entries.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) entries.push(cur.trim());
  return entries.map((e) => e.replace(/\/\/.*$/gm, '').trim()).filter(Boolean);
}

function writesOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const found = [];
  const re = /\(\s*['"]inventory_lots['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf(';', m.index);
    const stmt = src.slice(m.index, end < 0 ? undefined : end);
    const call = /\.(update|insert)\(/.exec(stmt);
    if (!call) continue;
    const at = m.index + call.index + call[0].length - 1;
    const arg = parenArg(src, at).trim();
    const line = src.slice(0, m.index).split('\n').length;
    const before = src.split('\n').slice(Math.max(0, line - 4), line).join('\n');
    found.push({ file, line, kind: call[1], arg, marker: (/lot-qty-(writer|free):/.exec(before) || [])[1] || null });
  }
  return found;
}

function verdict(w) {
  if (!w.arg.startsWith('{')) return w.marker ? null : 'variable payload without a lot-qty marker';
  const entries = literalEntries(w.arg);
  const set = {};
  for (const e of entries) {
    const kv = /^([a-z_]+)\s*:\s*([\s\S]+)$/.exec(e);
    if (kv) set[kv[1]] = kv[2].trim();
  }
  const spreads = entries.some((e) => e.startsWith('...'));
  const nonZero = QTY_COLS.filter((c) => c in set && set[c] !== '0');
  if (nonZero.length) return w.marker === 'writer' ? null : `sets ${nonZero.join(', ')}`;
  if (spreads && !QTY_COLS.every((c) => set[c] === '0')) {
    return w.marker ? null : 'spreads a row without zeroing every quantity column';
  }
  return null;
}

const files = walk(path.join(SRC, 'modules')).concat(walk(path.join(SRC, 'shared')), walk(path.join(SRC, 'services')));
const writes = files.flatMap(writesOf);
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');

describe('lot quantity columns have one writer (P3-01)', () => {
  test('the sweep finds the known writes', () => {
    // Guard against the regex silently matching nothing.
    expect(writes.length).toBeGreaterThan(20);
    expect(writes.some((w) => rel(w.file) === 'modules/inventory/inventory.service.js' && w.marker === 'writer')).toBe(true);
  });

  test('the sweep flags what it should', () => {
    expect(verdict({ arg: '{ available_qty: Math.max(0, newAvailable), updated_at: trx.fn.now() }', marker: null })).toMatch(/sets available_qty/);
    expect(verdict({ arg: '{ qty: 0, available_qty: 0, lot_no: x }', marker: null })).toBeNull();
    expect(verdict({ arg: '{ ...clone, lot_no: n, qty: 0 }', marker: null })).toMatch(/spreads/);
    expect(verdict({ arg: 'lotUpdate', marker: null })).toMatch(/variable payload/);
    expect(verdict({ arg: 'update', marker: 'free' })).toBeNull();
    expect(verdict({ arg: '{ qty: newQty }', marker: 'free' })).toMatch(/sets qty/);
  });

  test('no inventory_lots write sets a quantity column outside postMovement', () => {
    const bad = writes
      .map((w) => ({ w, why: verdict(w) }))
      .filter((x) => x.why)
      .map((x) => `${rel(x.w.file)}:${x.w.line} ${x.w.kind} — ${x.why}`);
    expect(bad).toEqual([]);
  });

  test('lot-qty-writer markers appear only in the allowed files, and no more often', () => {
    const counts = {};
    for (const w of writes.filter((x) => x.marker === 'writer')) counts[rel(w.file)] = (counts[rel(w.file)] || 0) + 1;
    for (const [f, n] of Object.entries(counts)) {
      expect({ file: f, allowed: f in WRITER_FILES }).toEqual({ file: f, allowed: true });
      expect(n).toBeLessThanOrEqual(WRITER_FILES[f]);
    }
  });

  test('lot_transactions rows are inserted by postMovement only', () => {
    const inserts = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const re = /\(\s*['"]lot_transactions['"]\s*\)\s*\.insert\(/g;
      let m;
      while ((m = re.exec(src))) inserts.push(`${rel(f)}:${src.slice(0, m.index).split('\n').length}`);
    }
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/^modules\/inventory\/inventory\.service\.js:/);
    const svc = fs.readFileSync(path.join(SRC, 'modules/inventory/inventory.service.js'), 'utf8');
    const pm = svc.indexOf('async postMovement(');
    const next = svc.indexOf('\n  async ', pm + 1);
    const at = svc.search(/\(\s*['"]lot_transactions['"]\s*\)\s*\.insert\(/);
    expect(at > pm && at < next).toBe(true);
  });
});
