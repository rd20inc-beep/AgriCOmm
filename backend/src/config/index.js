require('dotenv').config({ quiet: true });

// Literal fallbacks that have shipped in this repo (config + docker-compose). A
// token signed with one of these is forgeable by anyone who has read the source,
// so production refuses to start with any of them (or with no secret at all).
const INSECURE_JWT_SECRETS = new Set([
  'riceflow-jwt-secret-change-in-production',
  'change-me-in-production',
]);
const DEV_JWT_SECRET = 'riceflow-jwt-secret-change-in-production';

// Trust-proxy setting for Express (drives req.ip, which keys the rate limiters).
// Default 1 = trust exactly the nginx container in front of the API (unchanged
// behaviour). Behind a second proxy (host nginx → container nginx → API) set
// TRUST_PROXY=2 (or a subnet list such as "loopback, uniquelocal") once the outer
// proxy is confirmed to append X-Forwarded-For; otherwise a client could choose
// its own rate-limit bucket.
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return 1;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3001,

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'riceflow_erp',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },

  jwt: {
    secret: process.env.JWT_SECRET || DEV_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    senderName: process.env.SMTP_SENDER_NAME || 'AGRI COMMODITIES',
    senderEmail: process.env.SMTP_SENDER_EMAIL || 'info@agririce.com',
  },

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // Public URL of the web app — used to build links sent by email (password
  // reset). Never derived from the request (Host-header injection). Falls back
  // to the first configured CORS origin.
  appUrl: (process.env.APP_URL || String(process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim())
    .replace(/\/$/, ''),

  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // AI (OpenAI-compatible). Set OPENAI_API_KEY in the prod environment to enable;
  // when unset, AI features fall back to their non-AI defaults. OPENAI_BASE_URL
  // lets you point at Azure/OpenAI-compatible gateways.
  ai: {
    openaiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    // NL→SQL runs as a dedicated read-only role (migration 333), never as the
    // app's DB user. No password = AI querying is not configured.
    dbUser: process.env.AI_DB_USER || 'agri_ai_query',
    dbPassword: process.env.AI_DB_PASSWORD || '',
  },

  // Optional on-premises "site server" mode (offline Stage 16). When SITE_MODE=true
  // this backend runs on a LAN box against a LOCAL Postgres and is the site's live
  // source of truth during an internet outage; a background worker (src/site/worker.js)
  // replays the site's writes up to the cloud and pulls master data down. The cloud
  // stays globally authoritative — the site is "a big offline device". Off by default,
  // so the cloud deployment is completely unaffected.
  site: {
    enabled: process.env.SITE_MODE === 'true',
    id: process.env.SITE_ID || 'site-1',
    cloudApiUrl: (process.env.CLOUD_API_URL || '').replace(/\/$/, ''),
    syncUser: process.env.SYNC_USER || '',
    syncPassword: process.env.SYNC_PASSWORD || '',
    // How often the worker attempts a push/pull cycle (ms).
    syncIntervalMs: parseInt(process.env.SITE_SYNC_INTERVAL_MS, 10) || 60 * 1000,
    // Master/reference domains the site refreshes from the cloud (id-aligned:
    // the site box is initialized from a cloud snapshot; these are centrally managed).
    pullDomains: (process.env.SITE_PULL_DOMAINS || 'customers,suppliers,products,warehouses,bank_accounts')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },
};

// Refuse to boot production with a missing or well-known JWT secret.
function assertSecureConfig(cfg, rawSecret = process.env.JWT_SECRET) {
  if (cfg.env !== 'production') return;
  if (!rawSecret || INSECURE_JWT_SECRETS.has(rawSecret)) {
    throw new Error('[config] JWT_SECRET is unset or set to a default value. Refusing to start in production — set a strong, unique JWT_SECRET.');
  }
}

assertSecureConfig(config);

module.exports = config;
module.exports.assertSecureConfig = assertSecureConfig;
module.exports.INSECURE_JWT_SECRETS = INSECURE_JWT_SECRETS;
