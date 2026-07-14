// Offline Stage 17 — sync protocol version + clock-skew helpers (pure, testable).
//
// The client advertises SYNC_PROTOCOL_VERSION on every sync call (X-Sync-Protocol).
// The server bumps its minimum when the sync contract changes after a schema
// migration; a client below that minimum is refused (426) and pauses its sync so it
// never pushes an incompatible payload (§6: schema-migration / app-version-mismatch).
export const SYNC_PROTOCOL_VERSION = 1;

// Is this client compatible with the server's advertised minimum?
export function isServerCompatible(minClientProtocol) {
  const min = Number(minClientProtocol);
  if (!Number.isFinite(min)) return true; // server didn't advertise → assume ok
  return SYNC_PROTOCOL_VERSION >= min;
}

// ── Clock skew (§6: device clock skew) ──────────────────────────────────────
// Ordering never relies on the device wall-clock (the outbox drains in insertion
// order via a monotonic seq, and the server stamps server_ts). We still surface a
// large skew so it can be flagged — a very wrong device clock is worth warning about.
const LARGE_SKEW_MS = 5 * 60 * 1000; // 5 minutes

export function computeClockSkew(serverTimeIso, nowMs) {
  const server = Date.parse(serverTimeIso);
  if (!Number.isFinite(server) || !Number.isFinite(nowMs)) return 0;
  return nowMs - server; // positive → device clock ahead of server
}

export function isSkewLarge(skewMs) {
  return Math.abs(Number(skewMs) || 0) > LARGE_SKEW_MS;
}
