// Backward compatibility — re-exports from modular location
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const suppliersCtrl = require('../modules/masterData/suppliers.controller');

router.get('/', authorize('milling', 'view'), suppliersCtrl.list);
router.get('/:id', authorize('milling', 'view'), suppliersCtrl.getById);

module.exports = router;
