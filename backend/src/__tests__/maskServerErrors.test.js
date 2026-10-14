/**
 * P1-16 (TEC-06): 5xx responses never carry Postgres or code internals; business
 * messages a handler happens to send with a 500 still reach the user.
 */
const express = require('express');
const request = require('supertest');
const maskServerErrors = require('../middleware/maskServerErrors');

function appSending(status, body) {
  const app = express();
  app.use(maskServerErrors);
  app.get('/x', (req, res) => res.status(status).json(body));
  return app;
}

test.each([
  'insert into "payments" ("amount") values ($1) - null value in column "bank_account_id" violates not-null constraint',
  'relation "mill_salary_revisions" does not exist',
  'duplicate key value violates unique constraint "uq_mill_workers_active_cnic"',
  "Cannot read properties of undefined (reading 'id')",
  'syntax error at or near "WHERE"',
])('masks technical 500 text: %s', async (msg) => {
  const res = await request(appSending(500, { success: false, message: msg })).get('/x');
  expect(res.status).toBe(500);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toMatch(/Something went wrong on the server/);
  expect(res.body.message).not.toContain('"');
  expect(res.body.ref).toMatch(/^[0-9a-f]{8}$/);
});

test('keeps a business message sent with a 500', async () => {
  const msg = 'Lot L-12: only 400 kg available, requested 500 kg.';
  const res = await request(appSending(500, { success: false, message: msg })).get('/x');
  expect(res.body.message).toBe(msg);
});

test('never touches 4xx or 2xx bodies', async () => {
  const body = { success: false, message: 'column "x" is required' };
  expect((await request(appSending(400, body)).get('/x')).body).toEqual(body);
  expect((await request(appSending(200, { success: true, message: 'relation "x"' })).get('/x')).body.message).toBe('relation "x"');
});
