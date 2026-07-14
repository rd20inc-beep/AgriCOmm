// Offline Stage 16 — site-sync worker entry point. Runs as its own process on the LAN
// site box (docker-compose.site.yml `site-sync-worker` service). Loops runCycle on an
// interval, backing off when the cloud is unreachable. Never started by the cloud.
const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const { runCycle } = require('./siteSync');

const cfg = config.site;

function log(...a) { console.log('[site-sync]', ...a); }

async function tick() {
  try {
    const r = await runCycle({ db, cfg, fetchImpl: fetch, crypto });
    const pulls = Object.entries(r.pull).map(([d, n]) => `${d}:${n}`).join(' ');
    log(`push synced=${r.push.synced} conflicts=${r.push.conflicts} retried=${r.push.retried} | pull ${pulls}`);
  } catch (err) {
    log('cycle failed (will retry):', err.message);
  }
}

async function main() {
  if (!cfg.enabled) {
    log('SITE_MODE is not enabled — worker exiting.');
    process.exit(0);
  }
  if (!cfg.cloudApiUrl || !cfg.syncUser || !cfg.syncPassword) {
    log('Missing CLOUD_API_URL / SYNC_USER / SYNC_PASSWORD — worker exiting.');
    process.exit(1);
  }
  log(`starting for site "${cfg.id}" → ${cfg.cloudApiUrl} every ${cfg.syncIntervalMs}ms`);
  // First tick shortly after boot, then on the configured interval.
  setTimeout(async function loop() {
    await tick();
    setTimeout(loop, cfg.syncIntervalMs);
  }, 5000);
}

main();
