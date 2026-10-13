// P1-07 — portal PIN rule + deterministic login when a CNIC is ambiguous.
jest.mock('../config/database', () => {
  const rows = { mill_workers: [] };
  const db = (table) => {
    const q = {
      where: () => q, orderBy: () => q, whereNot: () => q,
      limit: (n) => Promise.resolve(rows[table].slice(0, n)),
      first: () => Promise.resolve(rows[table][0]),
    };
    return q;
  };
  db.__rows = rows;
  db.raw = jest.fn(() => { throw new Error('no attempt may be counted for an ambiguous CNIC'); });
  return db;
});

const express = require('express');
const request = require('supertest');
const db = require('../config/database');
const { newPinError } = require('../modules/portal/portalAuth');

describe('newPinError', () => {
  test.each(['123456', '1234567', '12345678'])('accepts %s', (p) => expect(newPinError(p)).toBeNull());
  test.each(['', '1234', '12345', '123456789', '12a456', ' 123456', null, undefined])('rejects %p', (p) => {
    expect(newPinError(p)).toMatch(/6–8 digits/);
  });
});

describe('portal login with a CNIC shared by two active workers', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/portal', require('../modules/portal/portal.routes'));

  test('is refused with a contact-admin message, never logs into either account', async () => {
    db.__rows.mill_workers = [
      { id: 1, name: 'A', portal_enabled: true, portal_pin_hash: 'x' },
      { id: 2, name: 'B', portal_enabled: true, portal_pin_hash: 'y' },
    ];
    const r = await request(app).post('/api/portal/login').send({ cnic: '11111-1111111-1', pin: '123456' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/more than one employee.*administrator/i);
    expect(db.raw).not.toHaveBeenCalled();
  });
});
