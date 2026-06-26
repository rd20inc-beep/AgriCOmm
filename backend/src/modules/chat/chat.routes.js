const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const router = express.Router();
const chat = require('./chat.service');
const db = require('../../config/database');
const { publishSignal } = require('./callSignalBus');

// WebRTC ICE config — public STUN plus, when a TURN relay is configured, a TURN
// server with EPHEMERAL credentials (coturn REST/auth-secret: username is an
// expiry timestamp, credential = base64 HMAC-SHA1(secret, username)). TURN lets
// calls connect across mobile/symmetric NATs where STUN alone fails.
router.get('/ice-config', (req, res) => {
  const secret = process.env.TURN_SECRET;
  const turnUrl = process.env.TURN_URL || '69.197.139.11:3478';
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', `stun:${turnUrl}`] }];
  if (secret) {
    const expiry = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h TTL
    const username = `${expiry}:agricomm`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    iceServers.push({
      urls: [`turn:${turnUrl}?transport=udp`, `turn:${turnUrl}?transport=tcp`],
      username,
      credential,
    });
  }
  return res.json({ success: true, data: { iceServers } });
});

// Chat files live in the PERSISTED uploads volume (/app/uploads/chat), not the
// documents module's non-persisted dir.
const CHAT_DIR = path.join(process.cwd(), 'uploads', 'chat');
const storage = multer.diskStorage({
  destination: (req, file, cb) => { fs.mkdirSync(CHAT_DIR, { recursive: true }); cb(null, CHAT_DIR); },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

// All routes are mounted behind `authenticate`, so req.user is set. Chat is open
// to any authenticated user (no extra RBAC) — it's an internal team tool.
const meId = (req) => req.user?.id;

router.get('/users', async (req, res) => {
  try { return res.json({ success: true, data: { users: await chat.listUsers(meId(req)) } }); }
  catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});

router.get('/conversations', async (req, res) => {
  try { return res.json({ success: true, data: await chat.getConversations(meId(req)) }); }
  catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});

router.get('/unread', async (req, res) => {
  try { return res.json({ success: true, data: await chat.getUnread(meId(req)) }); }
  catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});

router.get('/approvals', async (req, res) => {
  try { return res.json({ success: true, data: await chat.getApprovals(meId(req)) }); }
  catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});

router.get('/messages', async (req, res) => {
  try {
    const broadcast = req.query.broadcast === '1' || req.query.broadcast === 'true';
    return res.json({ success: true, data: { messages: await chat.getMessages(meId(req), { peer: req.query.peer, broadcast }) } });
  } catch (e) { return res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
});

router.post('/messages', upload.single('file'), async (req, res) => {
  try {
    const { recipient_id, body } = req.body || {};
    const broadcast = req.body?.broadcast === 'true' || req.body?.broadcast === true || req.body?.broadcast === '1';
    const attachment = req.file ? { path: req.file.path, name: req.file.originalname, type: req.file.mimetype, size: req.file.size } : null;
    const message = await chat.sendMessage(meId(req), { recipient_id: recipient_id ? Number(recipient_id) : null, body, broadcast, attachment });
    return res.json({ success: true, data: { message } });
  } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
});

router.post('/read', async (req, res) => {
  try { await chat.markRead(meId(req), req.body?.scope); return res.json({ success: true }); }
  catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
});

// Relay a WebRTC signal (offer/answer/ice/decline/hangup) to another user. The
// sender id/name are stamped server-side so the callee knows who is calling.
router.post('/signal', async (req, res) => {
  try {
    const { to, type, payload, kind } = req.body || {};
    if (!to || !type) return res.status(400).json({ success: false, message: 'to and type are required.' });
    const me = await db('users').where('id', meId(req)).first('id', 'full_name');
    publishSignal(Number(to), { type, kind: kind || null, payload: payload ?? null, from: me.id, fromName: me.full_name || 'User' });
    return res.json({ success: true });
  } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
});

module.exports = router;
