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
 *    multi-file auth st. The folder must persist across container
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

const SESSION_ROOT = process.env.WA_SESSION_DIR || path.join('/app', 'wa-session');

// ONE SESSION PER USER. This used to be a single global socket, so whoever
// scanned the QR became the sender for everyone — invoices went out from one
// phone regardless of who pressed Send. Each user now pairs their own WhatsApp
// and sends as themselves, which is what the mill operator and finance need.
//
// Credentials live in a per-user subdirectory of the same volume, so sessions
// survive restarts exactly as the single one did.
const sessions = new Map(); // userId(String) → state

function sessionDirFor(userId) {
  return path.join(SESSION_ROOT, String(userId));
}

function freshState() {
  return {
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
}

function sessionFor(userId) {
  const key = String(userId);
  if (!sessions.has(key)) sessions.set(key, freshState());
  return sessions.get(key);
}

// Every entry point needs a user — without one we cannot know whose WhatsApp to
// use, and silently falling back to "somebody's" session is how invoices went
// out from the wrong phone.
function requireUser(userId) {
  if (userId === undefined || userId === null || userId === '') {
    throw new Error('A user is required to use WhatsApp — each user pairs their own account.');
  }
  return String(userId);
}

function wipeSession(userId) {
  const SESSION_DIR = sessionDirFor(userId);
  // SESSION_DIR is a Docker volume MOUNT POINT — rmSync on the dir itself fails
  // (can't remove a mountpoint) and, with force:true, the error is swallowed, so
  // the credentials never actually clear. Delete the CONTENTS instead.
  ensureDir(userId);
  try {
    for (const entry of fs.readdirSync(SESSION_DIR)) {
      fs.rmSync(path.join(SESSION_DIR, entry), { recursive: true, force: true });
    }
  } catch (_) { /* ignore */ }
}

// Detach + close any existing socket so a fresh one can be created without the
// old one's listeners firing (which would otherwise trigger a reconnect).
function teardown(userId) {
  const st = sessionFor(userId);
  const old = st.sock;
  st.sock = null;
  if (!old) return;
  try { old.ev.removeAllListeners('connection.update'); } catch (_) { /* ignore */ }
  try { old.ev.removeAllListeners('creds.update'); } catch (_) { /* ignore */ }
  try { old.end(new Error('restart')); } catch (_) { /* ignore */ }
  try { old.ws && old.ws.close(); } catch (_) { /* ignore */ }
}

function ensureDir(userId) {
  const SESSION_DIR = sessionDirFor(userId);
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Baileys expects a pino-style logger (it calls .child()). Build one lazily at
// 'silent' so its internal chatter never floods the container logs, while still
// giving the library the real logger interface it needs to run cleanly.
let _waLogger = null;
function getWaLogger() {
  if (_waLogger) return _waLogger;
  try {
    _waLogger = require('pino')({ level: 'silent' });
  } catch (_) {
    // Fallback shim if pino is somehow unavailable.
    const noop = () => {};
    const shim = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => shim };
    _waLogger = shim;
  }
  return _waLogger;
}

async function start(userId, force = false) {
  const uid = requireUser(userId);
  const st = sessionFor(uid);
  const SESSION_DIR = sessionDirFor(uid);
  // Already linked — nothing to pair. Use Disconnect to re-pair.
  if (!force && st.status === 'connected' && st.sock) {
    return getStatus(uid);
  }
  if (!force) {
    // User clicked "Generate QR Code": tear down any stale / stuck session and
    // start fresh so a NEW QR is produced on EVERY click. (The old guard made a
    // click while status was 'connecting' a no-op, so the QR never appeared.)
    teardown(uid);
    // A QR is only ever for a FRESH pairing, so clear any persisted credentials
    // first. This is decisive: leftover/corrupt creds make Baileys try to RESUME
    // (→ "Connection Failure", no QR); with none on disk it registers fresh and
    // emits a QR immediately. (To relink, the user is scanning anyway.)
    wipeSession(uid);
    st.qrString = null;
    st.qrDataUrl = null;
    st.error = null;
    st.qrShown = false;
    st.everOpen = false;
    st.failCount = 0;
    st.wiped = false;
  }
  st.status = 'connecting';
  st.error = null;
  st.startedAt = Date.now();

  try {
    ensureDir(uid);
    const baileys = require('@whiskeysockets/baileys');
    const QRCode = require('qrcode');
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
    } = baileys;

    // A quiet logger keeps Baileys' internals happy (it calls logger.child();
    // the default console shim can misbehave) without flooding container logs.
    const logger = getWaLogger();

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
      logger,
      // Cache the signal keys. Without this, the burst of app-state / history
      // notifications right after a fresh scan can fail to decrypt ("error in
      // handling message"), which drops the just-opened session — exactly the
      // post-pairing crash we were seeing.
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      // Present as an ordinary WhatsApp Web desktop login. A custom browser name
      // (e.g. 'AgriCOmm ERP') is a tell that flags the session as an unofficial
      // client and gets it logged out (401) shortly after connecting. A standard
      // fingerprint (Ubuntu/Chrome) looks like a normal linked device.
      browser: Browsers.ubuntu('Chrome'),
      // This is a send-only channel — we never need the phone's chat history or
      // to appear "online". Skipping both avoids the heavy post-pair sync that
      // the release-candidate build chokes on.
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      // Incoming messages we don't store — return undefined so Baileys doesn't
      // block on a lookup it can't satisfy.
      getMessage: async () => undefined,
    });
    st.sock = sock;

    // Only the CURRENT socket may write creds or drive st. A superseded
    // socket (e.g. an in-flight reconnect from before the user hit "Generate QR
    // Code") must not resurrect old credentials on disk after a wipe, nor fire
    // its own reconnects — otherwise a stale registration keeps coming back.
    sock.ev.on('creds.update', async () => { if (st.sock === sock) { try { await saveCreds(); } catch (_) { /* ignore */ } } });

    sock.ev.on('connection.update', async (update) => {
      if (st.sock !== sock) return; // ignore events from a superseded socket
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        st.qrString = qr;
        st.qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
        st.status = 'qr';
        st.qrShown = true;      // reached the QR stage — session isn't corrupt
        st.failCount = 0;
      }

      if (connection === 'open') {
        st.status = 'connected';
        st.qrString = null;
        st.qrDataUrl = null;
        st.error = null;
        st.everOpen = true;
        st.failCount = 0;
        st.phone = sock.user?.id ? String(sock.user.id).split(':')[0].split('@')[0] : null;
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        st.sock = null;
        st.failCount += 1;

        // Self-heal: the handshake keeps failing BEFORE we ever showed a QR or
        // connected → the persisted creds are stale/corrupt (a common leftover
        // of earlier failed attempts). Wipe the session and re-pair from clean,
        // which forces a fresh QR instead of an endless "Connection Failure".
        const corruptSession = !loggedOut && !st.everOpen && !st.qrShown && st.failCount >= 2 && !st.wiped;

        if (loggedOut) {
          // Phone unlinked us or banned. Clear the auth folder so the
          // next start() generates a fresh QR.
          st.status = 'disconnected';
          st.qrString = null;
          st.qrDataUrl = null;
          st.error = 'Logged out from WhatsApp. Scan a fresh QR to reconnect.';
          st.phone = null;
          wipeSession(uid);
        } else if (corruptSession) {
          st.status = 'connecting';
          st.qrString = null;
          st.qrDataUrl = null;
          st.error = null;
          st.failCount = 0;
          st.wiped = true;
          wipeSession();
          setTimeout(() => start(uid, true).catch(() => {}), 300);
        } else {
          // Transient (incl. the expected post-scan "restart required", 515) —
          // reconnect. force=true so the guard in start() doesn't swallow it.
          st.status = 'connecting';
          const restartRequired = code === DisconnectReason.restartRequired;
          setTimeout(() => start(uid, true).catch(() => {}), restartRequired ? 200 : 2500);
        }
      }
    });
  } catch (err) {
    st.status = 'error';
    st.error = err.message || 'Failed to start WhatsApp QR session';
    st.sock = null;
  }
  return getStatus(uid);
}

async function logout(userId) {
  const uid = requireUser(userId);
  const st = sessionFor(uid);
  try {
    if (st.sock) {
      try { await st.sock.logout(); } catch (_) { /* ignore */ }
    }
  } finally {
    teardown(uid);
    st.status = 'disconnected';
    st.qrString = null;
    st.qrDataUrl = null;
    st.phone = null;
    wipeSession(uid); // delete this user's session contents (see wipeSession)
  }
  return getStatus(uid);
}

/**
 * Reconnect an already-linked session on server boot — WITHOUT showing a QR.
 *
 * A WhatsApp multi-device link survives server restarts: the credentials on the
 * volume stay valid, so we just need to re-open the socket. Without this, every
 * container restart/deploy leaves WhatsApp stuck "disconnected" until someone
 * manually re-scans — which is exactly the "keeps getting disconnected" symptom.
 *
 * Only auto-resume a REGISTERED session (creds.json.registered === true). If the
 * saved creds are unregistered (a half-finished pairing), do nothing and wait
 * for the user to scan a QR from the UI — booting into QR churn would be worse.
 */
async function resumeOnBoot() {
  try {
    // A LAN site box must never own a WhatsApp session (see routes).
    if (require('../../config').site?.enabled) return;
    if (!fs.existsSync(SESSION_ROOT)) {
      console.log('[WhatsApp] No saved sessions; awaiting QR pairing.');
      return;
    }
    // Each paired user has their own subdirectory. A creds.json sitting at the
    // ROOT is from the old single-session design and belongs to nobody we can
    // identify, so it is reported rather than silently adopted by some user.
    if (fs.existsSync(path.join(SESSION_ROOT, 'creds.json'))) {
      console.log('[WhatsApp] A legacy shared session is on the volume; it is ignored — each user now pairs their own. Delete it once everyone has re-paired.');
    }
    const userDirs = fs.readdirSync(SESSION_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name);
    if (userDirs.length === 0) {
      console.log('[WhatsApp] No saved sessions; awaiting QR pairing.');
      return;
    }
    for (const uid of userDirs) await resumeUser(uid);
  } catch (err) {
    console.error('[WhatsApp] resumeOnBoot failed:', err && err.message);
  }
}

// Resume ONE user's linked session, without showing a QR.
async function resumeUser(uid) {
  try {
    const credsFile = path.join(sessionDirFor(uid), 'creds.json');
    if (!fs.existsSync(credsFile)) return;
    // A session is LINKED once it has a paired account identity (creds.me). Some
    // Baileys flows leave the `registered` boolean false even on a fully paired,
    // stable connection — so `me` is the authoritative signal. Resume when either
    // is present; skip only a truly half-finished pairing (creds but no account).
    let linked = false;
    try {
      const c = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      linked = c.registered === true || !!(c.me && c.me.id);
    } catch (_) { /* corrupt */ }
    if (!linked) {
      console.log(`[WhatsApp] user ${uid}: saved session is not linked; awaiting a fresh QR scan.`);
      return;
    }
    console.log(`[WhatsApp] user ${uid}: resuming linked session from saved credentials…`);
    // force=true → connect with the existing creds (no wipe, no QR). A registered
    // session re-opens; a transient failure hits the normal auto-reconnect path.
    await start(uid, true);
  } catch (err) {
    console.error(`[WhatsApp] resume failed for user ${uid}:`, err && err.message);
  }
}

function getStatus(userId) {
  // No user → report disconnected rather than throwing; callers render a status
  // panel before anyone has paired anything.
  if (userId === undefined || userId === null || userId === '') {
    return { status: 'disconnected', qrDataUrl: null, phone: null, error: null, startedAt: null };
  }
  const st = sessionFor(String(userId));
  return {
    status: st.status,
    qrDataUrl: st.qrDataUrl,
    phone: st.phone,
    error: st.error,
    startedAt: st.startedAt,
  };
}

/**
 * Send a text message to a phone number via the QR-paired session.
 * `phone` is digits only (E.164 without +), e.g. '923001234567'.
 * Returns { ok, messageId? , error? }.
 */
async function sendMessage(userId, phone, text) {
  const st = sessionFor(requireUser(userId));
  if (st.status !== 'connected' || !st.sock) {
    return { ok: false, error: 'Your WhatsApp is not connected — pair it from Communications first.' };
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Invalid phone number' };
  const jid = `${digits}@s.whatsapp.net`;
  try {
    const res = await st.sock.sendMessage(jid, { text });
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
async function sendDocument(userId, phone, buffer, { fileName = 'document.pdf', mimetype = 'application/pdf', caption } = {}) {
  const st = sessionFor(requireUser(userId));
  if (st.status !== 'connected' || !st.sock) {
    return { ok: false, error: 'Your WhatsApp is not connected — pair it from Communications first.' };
  }
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return { ok: false, error: 'Invalid phone number' };
  // page.pdf() returns a Uint8Array; Baileys' media pipeline expects a Node
  // Buffer and throws deep inside ("...reading 'toString'") on a bare typed
  // array — so coerce it here.
  const buf = Buffer.isBuffer(buffer) ? buffer : (buffer ? Buffer.from(buffer) : null);
  if (!buf || !buf.length) return { ok: false, error: 'Empty document' };
  const jid = `${digits}@s.whatsapp.net`;
  try {
    const res = await st.sock.sendMessage(jid, {
      document: buf, mimetype, fileName, caption: caption || undefined,
    });
    return { ok: true, messageId: res?.key?.id || null };
  } catch (err) {
    return { ok: false, error: err.message || 'sendDocument failed' };
  }
}

module.exports = { start, logout, getStatus, sendMessage, sendDocument, resumeOnBoot };
