/**
 * Per-user warehouse scoping (#9-scoping, follow-up).
 *
 * A user may be restricted to a subset of warehouses via `user_scopes`
 * (scope_type='warehouse'). `rbac.getScopedWarehouseIds` resolves that list;
 * this module is the thin layer every READ path uses to apply it, so the rule
 * lives in exactly one place instead of being re-typed at ~50 query sites.
 *
 * Semantics (kept identical to the module allow-list):
 *   - no warehouse scope rows      → unrestricted (returns null)
 *   - Super Admin / Owner          → never scoped (returns null)
 *   - an infra error while loading → fail-open (returns null)
 *
 * IMPORTANT: scoping is for READ paths only (lists, detail, reports, pickers).
 * The movement/milling/dispatch engines must never be scoped — filtering a
 * write path would silently corrupt stock rather than hide it.
 */

const rbac = require('../middleware/rbac');

// Sentinel so a resolved `null` (unrestricted) is still cached rather than
// re-queried on every call within the same request.
const UNSET = Symbol('warehouse-scope-unset');

/**
 * Resolve the caller's warehouse scope once per request.
 * @returns {Promise<number[]|null>} allowed warehouse ids, or null = unrestricted
 */
async function resolveWarehouseScope(req) {
  if (!req || !req.user) return null;
  if (req._warehouseScope !== undefined && req._warehouseScope !== UNSET) return req._warehouseScope;
  const ids = await rbac.getScopedWarehouseIds(req.user);
  req._warehouseScope = ids;
  return ids;
}

/**
 * Apply a resolved scope to a knex query on a table that has a warehouse_id.
 * No-op when unrestricted. An empty scope matches nothing (`[-1]`) rather than
 * degrading to "everything".
 *
 * @param {import('knex').Knex.QueryBuilder} query
 * @param {number[]|null} scope  result of resolveWarehouseScope()
 * @param {string} column        fully-qualified column, e.g. 'l.warehouse_id'
 */
function applyWarehouseScope(query, scope, column = 'warehouse_id') {
  if (!scope) return query;
  return query.whereIn(column, scope.length ? scope : [-1]);
}

/**
 * NOTE — there is deliberately NO async `scopeQuery(query, req, col)` helper.
 *
 * A knex QueryBuilder is a thenable, so `await someAsyncFn()` that resolves to
 * a builder does NOT hand back the builder: the runtime chain-resolves the
 * thenable, RUNS the query, and yields rows. Callers then blow up on
 * `query.clone is not a function`. Always resolve the scope first (async), then
 * apply it (sync):
 *
 *   const scope = await resolveWarehouseScope(req);
 *   q = applyWarehouseScope(q, scope, 'l.warehouse_id');
 */

/**
 * True when this warehouse id is visible to the caller. Used by single-record
 * endpoints (lot detail, warehouse ledger) to 404/403 instead of leaking a row
 * the list view would have hidden.
 */
function isWarehouseInScope(scope, warehouseId) {
  if (!scope) return true;
  const id = parseInt(warehouseId, 10);
  if (!Number.isFinite(id)) return false;
  return scope.includes(id);
}

/**
 * Guard for single-record read handlers. Returns true when the request was
 * rejected (response already sent), so callers can `if (await denyOutOfScope(...)) return;`
 */
function denyOutOfScope(res, scope, warehouseId) {
  if (isWarehouseInScope(scope, warehouseId)) return false;
  res.status(403).json({
    success: false,
    message: 'Access restricted: this record belongs to a warehouse outside your access scope.',
  });
  return true;
}

module.exports = {
  resolveWarehouseScope,
  applyWarehouseScope,
  isWarehouseInScope,
  denyOutOfScope,
};
