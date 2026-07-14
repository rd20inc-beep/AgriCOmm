// Offline Stage 7 — index to support opportunistic retention pruning of
// idempotency_keys (DELETE WHERE created_at < now - retention). Additive.

exports.up = async (knex) => {
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys (created_at)');
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_idempotency_keys_created_at');
};
