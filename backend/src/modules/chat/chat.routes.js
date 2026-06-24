const express = require('express');

const router = express.Router();
const chat = require('./chat.service');

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

router.post('/messages', async (req, res) => {
  try {
    const { recipient_id, body, broadcast } = req.body || {};
    const message = await chat.sendMessage(meId(req), { recipient_id, body, broadcast: !!broadcast });
    return res.json({ success: true, data: { message } });
  } catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
});

router.post('/read', async (req, res) => {
  try { await chat.markRead(meId(req), req.body?.scope); return res.json({ success: true }); }
  catch (e) { return res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
});

module.exports = router;
