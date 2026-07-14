require('dotenv').config({ quiet: true });

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
    secret: process.env.JWT_SECRET || 'riceflow-jwt-secret-change-in-production',
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

  // AI (OpenAI-compatible). Set OPENAI_API_KEY in the prod environment to enable;
  // when unset, AI features fall back to their non-AI defaults. OPENAI_BASE_URL
  // lets you point at Azure/OpenAI-compatible gateways.
  ai: {
    openaiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
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

module.exports = config;
