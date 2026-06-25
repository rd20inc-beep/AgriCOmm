const { EventEmitter } = require('events');

// In-memory pub/sub for WebRTC call signaling, keyed by the RECEIVING user's id.
// Single-instance only (prod runs one backend container) — fine for an internal
// team tool. Each connected user opens an SSE channel that subscribes to their id;
// a POST relays a signal (offer/answer/ice/decline/hangup) to the target user.
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const ev = (userId) => `call-signal:${userId}`;

function publishSignal(toUserId, signal) {
  emitter.emit(ev(toUserId), { ...signal, at: new Date().toISOString() });
}

function subscribeSignals(userId, handler) {
  const name = ev(userId);
  emitter.on(name, handler);
  return () => emitter.off(name, handler);
}

module.exports = { publishSignal, subscribeSignals };
