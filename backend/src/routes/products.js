// Backward compatibility — re-exports from modular location
const express = require('express');
const router = express.Router();
const authorize = require('../middleware/rbac');
const productsCtrl = require('../modules/masterData/products.controller');

router.get('/', authorize('inventory', 'view'), productsCtrl.list);
router.get('/:id', authorize('inventory', 'view'), productsCtrl.getById);

module.exports = router;
