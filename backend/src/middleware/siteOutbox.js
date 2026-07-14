// Offline Stage 16 — site outbox recorder. Mounted on /api ONLY when SITE_MODE=true
// (see app.js), so the cloud request path is byte-for-byte unchanged. It records each
// SUCCESSFUL business mutation the site backend served into the site_outbox table; a
// background worker (src/site/worker.js) later replays those to the cloud with the
// stored Idempotency-Key, so the cloud re-runs each op through its real validation.
//
// Stage 16b: it also captures the site's OWN response so we learn which local row the
// request created (entity + local_ref) — the worker later pairs that with the cloud's
// finalized id/doc number in site_id_map.
const db = require('../config/database');
const { buildOutboxEntry } = require('../site/recordable');
const { deriveEntity, extractRef } = require('../site/identity');

module.exports = function siteOutbox(req, res, next) {
  // Decide recordability up front (before a handler could mutate the body), but only
  // persist once we know the handler succeeded.
  const entry = buildOutboxEntry(req);
  if (!entry) return next();

  // Capture the response body so we can learn the created local row's id.
  let captured;
  const origJson = res.json.bind(res);
  res.json = (body) => { captured = body; return origJson(body); };

  let recorded = false;
  res.on('finish', () => {
    if (recorded) return;
    recorded = true;
    if (res.statusCode >= 400) return; // 4xx/5xx changed nothing worth replaying

    const entity = deriveEntity(entry.path);
    const localRef = entry.method === 'POST' ? extractRef(captured) : null;
    db('site_outbox')
      .insert({
        ...entry,
        body: entry.body ? JSON.stringify(entry.body) : null,
        entity,
        local_ref: localRef !== null && localRef !== undefined ? String(localRef) : null,
        status: 'pending',
      })
      .onConflict('idempotency_key')
      .ignore() // a device-replay that already carried this key is captured once
      .catch((err) => console.error('siteOutbox record error:', err.message));
  });

  return next();
};
