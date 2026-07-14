const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

function createApp() {
  const app = express();

  // Trust proxy (Nginx reverse proxy sets X-Forwarded-For)
  app.set('trust proxy', 1);

  // Security headers
  app.use(helmet());

  // CORS
  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
  }));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request logging
  app.use(requestLogger);

  // Swagger API docs (non-production only)
  if (config.env !== 'production') {
    const swaggerUi = require('swagger-ui-express');
    const swaggerSpec = require('./config/swagger');
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'RiceFlow ERP API is running.' });
  });

  // Simple app-level health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  // Rate limiting (general only — login uses captcha guard per-IP)
  app.use('/api', apiLimiter);

  // Block a revoked device's writes (offline-sync device binding via X-Device-Id).
  app.use('/api', require('./middleware/deviceGuard'));

  // Idempotency for replay-safe writes (only activates when the offline-sync
  // client sends an Idempotency-Key; normal online traffic is unaffected).
  app.use('/api', require('./middleware/idempotency'));

  // Mount routes
  const routes = require('./routes/index');
  app.use('/api', routes);

  // Centralized error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
