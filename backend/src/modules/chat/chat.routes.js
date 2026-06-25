const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const chat = require('./chat.service');

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

module.exports = router;
