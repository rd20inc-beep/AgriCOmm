/**
 * POST /api/communication/email/send reports a failed send as a failure.
 *
 * emailService logs an SMTP failure (status 'Failed') instead of throwing, and
 * the controller answered 200 for it — so a composer that waits for a 2xx
 * still said "Email sent" for mail that never left.
 */
jest.mock('../services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../config/database', () => () => ({}));

const emailService = require('../services/emailService');
const controller = require('../modules/communications/communications.controller');

const resStub = () => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const req = { body: { to: 'buyer@example.com', subject: 'Reminder', body: 'Hi' }, user: { id: 1 } };

describe('communications sendEmail', () => {
  it('a logged failure is a 502 carrying the SMTP error', async () => {
    emailService.sendEmail.mockResolvedValueOnce({ id: 1, status: 'Failed', error_message: 'Invalid login: 535' });
    const res = resStub();
    await controller.sendEmail(req, res);
    expect(res.code).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('535');
  });

  it('a sent mail is a 200', async () => {
    emailService.sendEmail.mockResolvedValueOnce({ id: 2, status: 'Sent' });
    const res = resStub();
    await controller.sendEmail(req, res);
    expect(res.code).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
