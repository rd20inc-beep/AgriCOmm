/**
 * GET /api/approvals-inbox — every approval this user can act on (P5-02).
 *
 * Any signed-in user may call it: the list is filtered per item type by the
 * guard of that type's approve route, so a user with no approval rights gets
 * an empty inbox, never someone else's queue. Read-only — approving and
 * rejecting stay on each type's own endpoint.
 */
const express = require('express');
const { getInbox, TYPES } = require('./approvalsInbox.service');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await getInbox(req.user);
    const { type } = req.query;
    if (type && TYPES.some((t) => t.type === type)) {
      const items = data.items.filter((i) => i.type === type);
      return res.json({ success: true, data: { ...data, items } });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('approvals inbox error:', err);
    return res.status(500).json({ success: false, message: 'Could not load the approvals inbox.' });
  }
});

module.exports = router;
