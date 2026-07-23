// User Access Scoping (#9 deferred item) — restrict a user to specific MODULES
// and/or WAREHOUSES on top of their role permissions.
//
// Scope model: rows in user_scopes. scope_type ∈ {module, warehouse}. A user with
// NO scope rows of a given type is UNRESTRICTED for that type (backward compatible
// — existing users keep full access). When module rows exist, only those modules
// are reachable (enforced in middleware/rbac). When warehouse rows exist, inventory
// listings are filtered to those warehouses (enforced where applied — a foundation,
// not yet swept across every query). Super Admin / Owner are never scoped.

const SCOPE_TYPES = ['module', 'warehouse'];

exports.up = async (knex) => {
  if (await knex.schema.hasTable('user_scopes')) return;
  await knex.schema.createTable('user_scopes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('scope_type', 20).notNullable(); // 'module' | 'warehouse'
    t.string('scope_value', 60).notNullable(); // module name, or warehouse id (as text)
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['user_id', 'scope_type', 'scope_value']);
    t.index(['user_id', 'scope_type']);
  });
  await knex.raw(
    `ALTER TABLE user_scopes ADD CONSTRAINT chk_user_scopes_type_valid ` +
    `CHECK (scope_type IN (${SCOPE_TYPES.map((s) => `'${s}'`).join(', ')}))`
  );
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('user_scopes');
};
