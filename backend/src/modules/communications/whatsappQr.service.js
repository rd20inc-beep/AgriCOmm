/**
 * WhatsApp QR-pairing channel.
 *
 * Pairs the server as a WhatsApp Web client using @whiskeysockets/baileys.
 * The user scans a QR code from their phone (Linked Devices) — no Meta
 * Business API key, no business verification, no per-message fee. Trade-
 * off: violates WhatsApp ToS, so the sender number can be banned without
 * notice. We expose this as an alternative channel to the official API
 * config; admins choose per-template which channel to use.
 *
 * Design notes:
 *  - State is held in memory + a folder (auth_info_baileys) for the
 *    multi-file auth state. The folder must persist across container
 *    restarts — docker-compose mounts a named volume at WA_SESSION_DIR.
 *  - The QR string is captured into module state and re-emitted to the
 *    HTTP poller until pairing succeeds, after which it goes null.
 *  - Reconnects are automatic on transient errors. A logged-out / banned
 *    state clears the folder so the next start() shows a fresh QR.
 *  - Heavy imports (baileys, qrcode) are deferred behind a lazy require
 *    so the rest of the backend boots even if these deps are missing.
 */

const fs = require('fs');
const path = require('path');

const SESSION_DIR = process.env.WA_SESSION_DIR || path.join('/app', 'wa-session');

// In-memory state — single global session for the whole process.
const state = {
  sock: null,
  status: 'disconnected', // 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'
  qrString: null,
  qrDataUrl: null,
  error: null,
  phone: null, // E.164 of paired number once known
  startedAt: null,
};

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

async function start() {
  if (state.sock || state.status === 'connecting' || state.status === 'connected') {
    return getStatus();
  }
  state.status = 'connecting';
  state.error = null;
  state.startedAt = Date.now();

  try {
    ensureDir();
    const baileys = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
    } = baileys;

    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
      auth: authState,
      printQRInTerminal: false,
      browser: ['AgriCOmm ERP', 'Chrome', '1.0.0'],
    });
    state.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        state.qrString = qr;
        state.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        state.status = 'qr';
      }

      if (connection === 'open') {
        state.status = 'connected';
        state.qrString = null;
        state.qrDataUrl = null;
        state.error = null;
        state.phone = sock.user?.id ? String(sock.user.id).split(':')[0].split('@')[0] : null;
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        if (loggedOut) {
          // Phone unlinked us or banned. Clear the auth folder so the
          // next start() generates a fresh QR.
          state.sock = null;
          state.status = 'disconnected';
          state.qrString = null;
          state.qrDataUrl = null;
          state.error = 'Logged out from WhatsApp. Scan a fresh QR to reconnect.';
          state.phone = null;
          try {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            ensureDir();
          } catch (_) { /* ignore */ }
        } else {
          // Transient — try again.
          state.status = 'connecting';
          state.sock = null;
          setTimeout(() => start().catch(() => {}), 2500);
        }
      }
    });
  } catch (err) {
    state.status = 'error';
    state.error = err.message || 'Failed to start WhatsApp QR session';
    state.sock = null;
  }
  return getStatus();
}

async function logout() {
  try {
    if (state.sock) {
      try { await state.sock.logout(); } catch (_) { /* ignore */ }
    }
  } finally {
    state.sock = null;
    state.status = 'disconnected';
    state.qrString = null;
    state.qrDataUrl = null;
    state.phone = null;
    try {
      if (fs.existsSync(SESSION_DIR)) {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      }
    } catch (_) { /* ignore */ }
  }
  return getStatus();
}

function getStatus() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    phone: state.phone,
    error: state.error,
    startedAt: state.startedAt,
  };
}

/**
 * Send a text message to a phone number via the QR-paired session.
 * `phone` is digits only (E.164 without +), e.g. '923001234567'.
 * Returns { ok, messageId? , error? }.
 */
async function sendMessage(phone, text) {
  if (state.status !== 'connected' || !state.sock) {
    return { ok: false, error: 'WhatsApp QR session is not connected.' };
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Invalid phone number' };
  const jid = `${digits}@s.whatsapp.net`;
  try {
    const res = await state.sock.sendMessage(jid, { text });
    return { ok: true, messageId: res?.key?.id || null };
  } catch (err) {
    return { ok: false, error: err.message || 'sendMessage failed' };
  }
}

module.exports = { start, logout, getStatus, sendMessage };
