const express = require('express');
const authenticate = require('../middleware/auth');

const router = express.Router();

// Public routes
router.use('/auth', require('./auth'));
router.use('/streams', require('./streams'));

// Protected routes — all require authentication
router.use('/users', authenticate, require('./users'));
router.use('/customers', authenticate, require('./customers'));
router.use('/suppliers', authenticate, require('./suppliers'));
router.use('/products', authenticate, require('./products'));
router.use('/export-orders', authenticate, require('./exportOrders'));
router.use('/milling', authenticate, require('./milling'));
router.use('/inventory', authenticate, require('./inventory'));
router.use('/lot-inventory', authenticate, require('./lotInventory'));
router.use('/local-sales', authenticate, require('./localSales'));
router.use('/finance', authenticate, require('./finance'));
router.use('/advances', authenticate, require('./advances'));
router.use('/procurement', authenticate, require('./procurement'));
router.use('/admin', authenticate, require('./admin'));
router.use('/audit-logs', authenticate, require('./auditLogs'));
router.use('/accounting', authenticate, require('./accounting'));
router.use('/documents', authenticate, require('./documents'));
router.use('/communication', authenticate, require('./communication'));
router.use('/reporting', authenticate, require('./reporting'));
router.use('/enterprise', require('./enterprise')); // Note: health is public, rest require auth (handled in route file)
router.use('/control', authenticate, require('./control'));
router.use('/intelligence', authenticate, require('./intelligence'));
router.use('/smart', authenticate, require('./smart'));

module.exports = router;
