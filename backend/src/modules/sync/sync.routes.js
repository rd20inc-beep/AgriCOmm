// Offline sync routes (Stage 6a — pull path). Mounted under /api/sync with
// authenticate (applied in routes/index.js). Additive; nothing existing changes.
const express = require('express');
const controller = require('./sync.controller');

const router = express.Router();

router.post('/bootstrap', controller.bootstrap);
router.post('/pull', controller.pull);

module.exports = router;
