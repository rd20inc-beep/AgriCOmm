/**
 * A tiny in-memory stand-in for a knex connection/transaction — just enough of
 * the query builder (where / whereIn / forUpdate / first / update…returning /
 * insert) to EXECUTE service code against rows held in plain arrays.
 *
 *   const db = fakeKnex({ stock_counts: [{ id: 1, status: 'Planned' }] });
 *   await db('stock_counts').where({ id: 1 }).first();
 *   db.tables.stock_counts  // inspect rows after the code under test ran
 *   db.locks                // [{ table }] for every forUpdate() read
 */
function fakeKnex(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const locks = [];
  let nextId = 1000;

  function builder(tableRef) {
    const table = String(tableRef).split(/\s+as\s+/i)[0]; // 'x as a' → 'x'
    const colOf = (k) => (String(k).includes('.') ? String(k).split('.').pop() : k);
    if (!tables[table]) tables[table] = [];
    const filters = [];
    let locked = false;
    const rows = () => tables[table].filter((row) => filters.every((f) => f(row)));

    const b = {
      where(a, op, c) {
        if (a && typeof a === 'object') {
          for (const [k, v] of Object.entries(a)) {
            const col = colOf(k);
            filters.push((r) => (v === null ? r[col] == null : String(r[col]) === String(v)));
          }
        } else if (c === undefined) {
          filters.push((r) => String(r[colOf(a)]) === String(op));
        } else {
          const cmp = { '>': (x, y) => x > y, '<': (x, y) => x < y, '=': (x, y) => x === y }[op];
          filters.push((r) => cmp(Number(r[a]), Number(c)));
        }
        return b;
      },
      whereIn(col, vals) { filters.push((r) => vals.map(String).includes(String(r[col]))); return b; },
      join() { return b; }, // joined columns are not resolved
      whereRaw() { return b; }, // raw SQL is not evaluated — matches every row
      forUpdate() { locked = true; return b; },
      select() { return b; },
      orderBy() { return b; },
      async first() {
        if (locked) locks.push({ table });
        const r = rows()[0];
        return r ? { ...r } : undefined;
      },
      update(patch) {
        const hit = rows();
        const resolved = {};
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) resolved[k] = v;
        hit.forEach((r) => Object.assign(r, resolved));
        const out = hit.map((r) => ({ ...r }));
        return { returning: async () => out, then: (res, rej) => Promise.resolve(out.length).then(res, rej) };
      },
      insert(data) {
        const list = (Array.isArray(data) ? data : [data]).map((d) => ({ id: nextId++, ...d }));
        tables[table].push(...list);
        const out = list.map((r) => ({ ...r }));
        return { returning: async () => out, then: (res, rej) => Promise.resolve(out).then(res, rej) };
      },
      then(res, rej) { return Promise.resolve(rows().map((r) => ({ ...r }))).then(res, rej); },
    };
    return b;
  }

  const knex = (table) => builder(table);
  knex.tables = tables;
  knex.locks = locks;
  knex.fn = { now: () => 'now()' };
  knex.raw = (sql) => sql;
  knex.transaction = async (cb) => cb(knex);
  return knex;
}

module.exports = { fakeKnex };
