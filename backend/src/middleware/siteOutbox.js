// Offline Stage 16 — site outbox recorder. Mounted on /api ONLY when SITE_MODE=true
// (see app.js), so the cloud request path is byte-for-byte unchanged. It records each
// SUCCESSFUL business mutation the site backend served into the site_outbox table; a
// background worker (src/site/worker.js) later replays those to the cloud with the
// stored Idempotency-Key, so the cloud re-runs each op through its real validation.
const db = require('../config/database');
const { buildOutboxEntry } = require('../site/recordable');

module.exports = function siteOutbox(req, res, next) {
  // Decide recordability up front (before the body could be mutated by a handler),
  // but only persist once we know the handler succeeded.
  const entry = buildOutboxEntry(req);
  if (!entry) return next();

  let recorded = false;
  res.on('finish', () => {
    if (recorded) return;
    recorded = true;
    // Only capture durable successes. 4xx/5xx changed nothing worth replaying.
    if (res.statusCode >= 400) return;
    db('site_outbox')
      .insert({ ...entry, body: entry.body ? JSON.stringify(entry.body) : null, status: 'pending' })
      .onConflict('idempotency_key')
      .ignore() // a device-replay that already carried this key is captured once
      .catch((err) => console.error('siteOutbox record error:', err.message));
  });

  return next();
};
