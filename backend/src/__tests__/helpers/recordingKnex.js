/**
 * A recording stand-in for knex: every query is chainable, and its terminal
 * call (await / .first()) is answered by a per-table function that sees what
 * the query asked for. Writes are captured, not applied.
 *
 *   jest.mock('../config/database', () => require('./helpers/recordingKnex')());
 *   db.__set({ alerts: (q) => (q.terminal === 'first' ? undefined : []) });
 *   db.__calls  // [{ table, wheres, inserts, updates }] in call order
 */
module.exports = function recordingKnex() {
  let rows = {};
  const calls = [];
  const builder = (table) => {
    const state = { table: String(table).split(' ')[0], wheres: [], inserts: [], updates: [] };
    calls.push(state);
    const answer = (terminal) => {
      const r = rows[state.table];
      return typeof r === 'function' ? r({ ...state, terminal }) : r;
    };
    const b = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(answer('all') ?? []).then(res, rej);
        if (prop === 'first') return async () => answer('first');
        if (prop === 'where' || prop === 'whereNot' || prop === 'whereNotIn') {
          return (...a) => { state.wheres.push(a); return b; };
        }
        if (prop === 'insert') return (v) => { state.inserts.push(v); return b; };
        if (prop === 'update') return (v) => { state.updates.push(v); return b; };
        return () => b;
      },
    });
    return b;
  };
  const db = (table) => builder(table);
  db.raw = (...a) => ({ raw: a });
  db.fn = { now: () => 'now()' };
  db.__set = (r) => { rows = r; calls.length = 0; };
  db.__calls = calls;
  return db;
};
