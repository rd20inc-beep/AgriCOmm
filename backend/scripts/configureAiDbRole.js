/**
 * (Re)apply the AI read-only DB role and grants from migration 333 — run this
 * as a DB user with CREATEROLE (or superuser) after setting AI_DB_PASSWORD, or
 * when the deploy's migration logged that it could not create the roles.
 * Idempotent; prints a status, never the password.
 *
 *   AI_DB_PASSWORD=... node scripts/configureAiDbRole.js
 */
const db = require('../src/config/database');
const { ensureAiRoles } = require('../migrations/20261015_333_ai_readonly_views_and_role');

ensureAiRoles(db)
  .then((status) => { console.log('[ai_ro]', JSON.stringify(status)); return db.destroy(); })
  .then(() => process.exit(0))
  .catch((err) => { console.error('[ai_ro] failed:', err.message); db.destroy().finally(() => process.exit(1)); });
