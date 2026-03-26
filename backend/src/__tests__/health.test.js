const request = require('supertest');

// Mock config to avoid requiring real env vars during tests
jest.mock('../config', () => ({
  port: 3001,
  corsOrigin: '*',
  jwtSecret: 'test-secret',
  db: {
    host: 'localhost',
    port: 5432,
    name: 'test',
    user: 'test',
    password: 'test',
  },
}));

// Mock rate limiter to avoid issues in test environment
jest.mock('../middleware/rateLimiter', () => ({
  authLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
}));

const createApp = require('../app');

let app;

beforeAll(() => {
  app = createApp();
});

describe('Health endpoints', () => {
  it('GET /health should return 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('GET /api/health should return 200 with success', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body.message).toMatch(/RiceFlow/);
  });
});
