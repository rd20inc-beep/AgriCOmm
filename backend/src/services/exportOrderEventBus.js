const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function eventName(orderId) {
  return `export-order:${orderId}`;
}

function publishExportOrderUpdate(orderId, payload = {}) {
  emitter.emit(eventName(orderId), {
    orderId,
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

function subscribeExportOrderUpdates(orderId, handler) {
  const name = eventName(orderId);
  emitter.on(name, handler);
  return () => emitter.off(name, handler);
}

module.exports = {
  publishExportOrderUpdate,
  subscribeExportOrderUpdates,
};
