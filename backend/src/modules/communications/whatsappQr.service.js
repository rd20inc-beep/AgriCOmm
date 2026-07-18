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
  // Self-heal a corrupt persisted session: if the handshake keeps failing
  // before we ever show a QR or open, the saved creds are bad — wipe + re-pair.
  qrShown: false,
  everOpen: false,
  failCount: 0,
  wiped: false, // only auto-wipe a corrupt session once per pairing attempt
};

function wipeSession() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    ensureDir();
  } catch (_) { /* ignore */ }
}

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

async function start(force = false) {
  // Ignore duplicate user-triggered starts while a session is already live.
  // Internal reconnects pass force=true — otherwise the post-scan "restart
  // required" would be swallowed here (status is 'connecting') and pairing
  // would hang forever on "connecting".
  if (!force && (state.sock || state.status === 'connecting' || state.status === 'connected')) {
    return getStatus();
  }
  if (!force) {
    // Fresh, user-initiated pairing attempt — reset the self-heal counters.
    state.qrShown = false;
    state.everOpen = false;
    state.failCount = 0;
    state.wiped = false;
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
      fetchLatestBaileysVersion,
    } = baileys;

    // WhatsApp rejects an outdated WA-Web protocol version with a bare
    // "Connection Failure" and never issues a QR (pairing appears to hang).
    // Always negotiate against the current version instead of the bundled one.
    let version;
    try {
      const info = await fetchLatestBaileysVersion();
      version = info && info.version;
    } catch (_) { /* fall back to the library's bundled version */ }

    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
      version,
      auth: authState,
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
        state.qrShown = true;      // reached the QR stage — session isn't corrupt
        state.failCount = 0;
      }

      if (connection === 'open') {
        state.status = 'connected';
        state.qrString = null;
        state.qrDataUrl = null;
        state.error = null;
        state.everOpen = true;
        state.failCount = 0;
        state.phone = sock.user?.id ? String(sock.user.id).split(':')[0].split('@')[0] : null;
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        state.sock = null;
        state.failCount += 1;

        // Self-heal: the handshake keeps failing BEFORE we ever showed a QR or
        // connected → the persisted creds are stale/corrupt (a common leftover
        // of earlier failed attempts). Wipe the session and re-pair from clean,
        // which forces a fresh QR instead of an endless "Connection Failure".
        const corruptSession = !loggedOut && !state.everOpen && !state.qrShown && state.failCount >= 2 && !state.wiped;

        if (loggedOut) {
          // Phone unlinked us or banned. Clear the auth folder so the
          // next start() generates a fresh QR.
          state.status = 'disconnected';
          state.qrString = null;
          state.qrDataUrl = null;
          state.error = 'Logged out from WhatsApp. Scan a fresh QR to reconnect.';
          state.phone = null;
          wipeSession();
        } else if (corruptSession) {
          state.status = 'connecting';
          state.qrString = null;
          state.qrDataUrl = null;
          state.error = null;
          state.failCount = 0;
          state.wiped = true;
          wipeSession();
          setTimeout(() => start(true).catch(() => {}), 300);
        } else {
          // Transient (incl. the expected post-scan "restart required", 515) —
          // reconnect. force=true so the guard in start() doesn't swallow it.
          state.status = 'connecting';
          const restartRequired = code === DisconnectReason.restartRequired;
          setTimeout(() => start(true).catch(() => {}), restartRequired ? 200 : 2500);
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

/**
 * Send a document (file) attachment via the QR-paired session.
 * @param {string} phone  digits only (E.164 without +)
 * @param {Buffer} buffer file contents
 * @param {object} opts   { fileName, mimetype='application/pdf', caption }
 * Returns { ok, messageId?, error? }.
 */
async function sendDocument(phone, buffer, { fileName = 'document.pdf', mimetype = 'application/pdf', caption } = {}) {
  if (state.status !== 'connected' || !state.sock) {
    return { ok: false, error: 'WhatsApp QR session is not connected.' };
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Invalid phone number' };
  if (!buffer || !buffer.length) return { ok: false, error: 'Empty document' };
  const jid = `${digits}@s.whatsapp.net`;
  try {
    const res = await state.sock.sendMessage(jid, {
      document: buffer, mimetype, fileName, caption: caption || undefined,
    });
    return { ok: true, messageId: res?.key?.id || null };
  } catch (err) {
    return { ok: false, error: err.message || 'sendDocument failed' };
  }
}

module.exports = { start, logout, getStatus, sendMessage, sendDocument };
