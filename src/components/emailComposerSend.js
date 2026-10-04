// The composer's body is plain text; the mail goes out as HTML. Escape it and
// keep the line breaks the user typed.
export function plainTextToHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}

// Send what the composer holds. Resolves 'sent' only on a 2xx from the server
// (which now answers 502 when SMTP refused the mail), 'queued' when the client
// parked it in the offline outbox; any error propagates to the caller.
export async function sendComposedEmail(sendEmail, { to, cc, subject, body, linkedType, linkedId }) {
  const res = await sendEmail({
    to: String(to || '').trim(),
    cc: String(cc || '').trim() || null,
    subject: String(subject || '').trim(),
    body: plainTextToHtml(body),
    linked_type: linkedType || null,
    linked_id: linkedId || null,
  });
  return res?._offlineQueued ? 'queued' : 'sent';
}
