import { describe, it, expect, vi } from 'vitest';
import { sendComposedEmail, plainTextToHtml } from '../emailComposerSend';

/**
 * The composer used to toast "Email sent" without calling anything. These run
 * the send path against a stub API: it must actually be called with the
 * composed mail, report 'sent' only when the call resolves, and let a server
 * error through so the caller shows it instead of a success.
 */
describe('EmailComposer send', () => {
  it('calls the API with the composed mail, body as escaped HTML', async () => {
    const api = vi.fn().mockResolvedValue({ success: true, data: {} });
    const out = await sendComposedEmail(api, {
      to: ' buyer@example.com ', cc: '', subject: ' Reminder ',
      body: 'Dear <Buyer>,\nPay USD 1,000 & thanks', linkedType: 'export_order', linkedId: 7,
    });
    expect(out).toBe('sent');
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toEqual({
      to: 'buyer@example.com', cc: null, subject: 'Reminder',
      body: 'Dear &lt;Buyer&gt;,<br/>Pay USD 1,000 &amp; thanks',
      linked_type: 'export_order', linked_id: 7,
    });
  });

  it('a server error is not a success', async () => {
    const err = Object.assign(new Error('Invalid login: 535 Authentication failed'), { status: 502 });
    const api = vi.fn().mockRejectedValue(err);
    await expect(sendComposedEmail(api, { to: 'a@b.c', subject: 's', body: 'b' })).rejects.toThrow('535');
  });

  it('an offline-queued send is reported as queued, not sent', async () => {
    const api = vi.fn().mockResolvedValue({ success: true, _offlineQueued: true });
    expect(await sendComposedEmail(api, { to: 'a@b.c', subject: 's', body: 'b' })).toBe('queued');
  });

  it('plainTextToHtml keeps line breaks and escapes markup', () => {
    expect(plainTextToHtml('a\nb<script>')).toBe('a<br/>b&lt;script&gt;');
  });
});
