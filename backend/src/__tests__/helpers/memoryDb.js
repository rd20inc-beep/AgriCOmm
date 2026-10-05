/**
 * A small in-memory stand-in for the Knex query builder, enough to EXECUTE the
 * export-order handlers (rather than grep their source). Tables are plain
 * arrays on `state.tables`; each test seeds what it needs.
 *
 * Supported: where(obj | field, value | field, op, value), whereIn, orderBy,
 * select, first, forUpdate, insert().returning, update().returning, del,
 * sum('col as alias').first(), count().first(), transaction, fn.now.
 *
 * Use from a jest.mock factory:  jest.mock('../config/database', () => require('./helpers/memoryDb').db);
 */

const state = { tables: {}, seq: {} };

function reset(tables = {}) {
  state.tables = {};
  state.seq = {};
  for (const [name, rows] of Object.entries(tables)) {
    state.tables[name] = rows.map((r) => ({ ...r }));
    state.seq[name] = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}

function test(row, c) {
  if (c.type === 'obj') return Object.entries(c.value).every(([k, v]) => eq(row[k], v));
  if (c.type === 'in') return c.values.some((v) => eq(row[c.field], v));
  const l = row[c.field];
  const r = c.value;
  switch (c.op) {
    case '=': return eq(l, r);
    case '!=': case '<>': return !eq(l, r);
    case '>': return parseFloat(l) > parseFloat(r);
    case '>=': return parseFloat(l) >= parseFloat(r);
    case '<': return parseFloat(l) < parseFloat(r);
    case '<=': return parseFloat(l) <= parseFloat(r);
    case 'like': return String(l || '').includes(String(r).replace(/%/g, ''));
    default: throw new Error(`memoryDb: unsupported operator ${c.op}`);
  }
}

class Mutation {
  constructor(rows) { this.rows = rows; }
  returning() { return Promise.resolve(clone(this.rows)); }
  then(ok, ko) { return Promise.resolve(this.rows.length).then(ok, ko); }
}

class Query {
  constructor(table) {
    this.table = table;
    if (!state.tables[table]) state.tables[table] = [];
    this.conds = [];
    this.sort = null;
    this.only = false;
    this.fields = null;
    this.agg = null;
  }

  rows() {
    let rows = state.tables[this.table].filter((r) => this.conds.every((c) => test(r, c)));
    if (this.sort) {
      const { field, dir } = this.sort;
      rows = [...rows].sort((a, b) => {
        if (a[field] === b[field]) return 0;
        const asc = a[field] > b[field] ? 1 : -1;
        return dir === 'desc' ? -asc : asc;
      });
    }
    return rows;
  }

  where(a, b, c) {
    if (typeof a === 'object') this.conds.push({ type: 'obj', value: a });
    else if (c === undefined) this.conds.push({ type: 'cmp', field: a, op: '=', value: b });
    else this.conds.push({ type: 'cmp', field: a, op: b, value: c });
    return this;
  }
  andWhere(...args) { return this.where(...args); }
  whereIn(field, values) { this.conds.push({ type: 'in', field, values }); return this; }
  orderBy(field, dir = 'asc') { this.sort = { field, dir }; return this; }
  select(...f) { this.fields = f.flat(); return this; }
  forUpdate() { return this; }
  modify(fn) { fn(this); return this; }
  whereRaw() { this.conds.push({ type: 'in', field: '__never__', values: [] }); return this; }
  first(...f) { this.only = true; if (f.length) this.fields = f.flat(); return this; }

  sum(expr) { this.agg = { fn: 'sum', expr }; return this; }
  count(expr = 'count') { this.agg = { fn: 'count', expr }; return this; }

  insert(payload) {
    const list = Array.isArray(payload) ? payload : [payload];
    const out = list.map((row) => {
      const id = row.id || state.seq[this.table] || 1;
      state.seq[this.table] = Math.max(state.seq[this.table] || 1, id) + 1;
      const rec = { id, ...clone(row) };
      state.tables[this.table].push(rec);
      return rec;
    });
    return new Mutation(out);
  }

  update(patch) {
    const rows = this.rows();
    rows.forEach((r) => Object.assign(r, clone(patch)));
    return new Mutation(rows);
  }

  del() {
    const rows = this.rows();
    state.tables[this.table] = state.tables[this.table].filter((r) => !rows.includes(r));
    return Promise.resolve(rows.length);
  }
  delete() { return this.del(); }

  then(ok, ko) {
    let result;
    if (this.agg) {
      const m = String(this.agg.expr).match(/^(.+?)(?:\s+as\s+(.+))?$/i);
      const col = m[1].trim();
      const alias = (m[2] || this.agg.fn).trim();
      const rows = this.rows();
      const value = this.agg.fn === 'sum'
        ? (rows.length ? rows.reduce((s, r) => s + (parseFloat(r[col]) || 0), 0) : null)
        : String(rows.length);
      result = this.only ? { [alias]: value } : [{ [alias]: value }];
    } else {
      result = this.rows().map((r) => {
        if (!this.fields || !this.fields.length || this.fields[0] === '*') return clone(r);
        return Object.fromEntries(this.fields.map((f) => [f, r[f]]));
      });
      if (this.only) result = result[0];
    }
    return Promise.resolve(result).then(ok, ko);
  }
}

function db(table) { return new Query(table); }
db.fn = { now: () => '2026-10-05T00:00:00.000Z' };
db.raw = (sql) => sql;
db.transaction = async (fn) => fn(db);

module.exports = { db, state, reset };
