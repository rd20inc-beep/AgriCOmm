// Repository layer — the single seam through which the UI reaches data/network.
//
// - authRepo / portalRepo / realtimeRepo wrap the calls that used to bypass the
//   data client (raw fetch / EventSource).
// - Domain data access (inventory, milling, sales, finance, payroll, …) flows
//   through the react-query hooks in src/api/queries.js → each module's
//   api/services.js → src/api/client.js. That chain IS the repository surface for
//   those domains; later stages route client.js reads through local SQLite and
//   writes through the outbox behind this same seam — without changing callers.
//
// Rule: UI components and hooks must not call fetch / EventSource / storage
// directly. Go through a repository (here) or the data client (src/api/client.js),
// both of which sit on the platform adapter (src/platform).
export { authRepo } from './auth';
export { portalRepo, portalRequest } from './portal';
export { realtimeRepo } from './realtime';
