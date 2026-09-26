/**
 * WhatsApp is paired per USER. It used to be one global socket, so whoever
 * scanned the QR became the sender for everyone — invoices went out from one
 * phone regardless of who pressed Send.
 */
const wa = require('../modules/communications/whatsappQr.service');

describe('WhatsApp sessions are per user', () => {
  test('two users have independent status', () => {
    const a = wa.getStatus(101);
    const b = wa.getStatus(202);
    expect(a.status).toBe('disconnected');
    expect(b.status).toBe('disconnected');
    // Distinct objects — not one shared state handed to both.
    expect(a).not.toBe(b);
  });

  test('status without a user reports disconnected instead of throwing', () => {
    // The status panel renders before anyone has paired anything.
    expect(wa.getStatus().status).toBe('disconnected');
    expect(wa.getStatus(null).status).toBe('disconnected');
    expect(wa.getStatus('').qrDataUrl).toBeNull();
  });

  test('sending with nobody paired fails with a message naming the user’s own account', async () => {
    const res = await wa.sendDocument(101, '923001234567', Buffer.from('x'), { fileName: 'a.pdf' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/i);
    expect(res.error).toMatch(/your whatsapp/i);   // not "WhatsApp is not connected" globally
  });

  test('sending without a user is refused outright — we cannot guess whose account to use', async () => {
    await expect(wa.sendDocument(undefined, '923001234567', Buffer.from('x'))).rejects.toThrow(/user is required/i);
    await expect(wa.sendMessage(null, '923001234567', 'hi')).rejects.toThrow(/user is required/i);
  });

  test('a text send for an unpaired user also fails cleanly', async () => {
    const res = await wa.sendMessage(202, '923001234567', 'hello');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/i);
  });
});
