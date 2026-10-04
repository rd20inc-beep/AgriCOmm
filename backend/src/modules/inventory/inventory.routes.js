const express = require('express');
const router = express.Router();
const { authorize, authorizeRole } = require('../../middleware/rbac');
const auditAction = require('../../middleware/audit');
const inventoryController = require('./inventory.controller');

// --- Lot queries ---
router.get(
  '/',
  authorize('inventory', 'view'),
  inventoryController.listLots
);

router.get(
  '/summary',
  authorize('inventory', 'view'),
  inventoryController.getSummary
);

router.get(
  '/lots/:id',
  authorize('inventory', 'view'),
  inventoryController.getLotById
);

router.get(
  '/lots/:id/movements',
  authorize('inventory', 'view'),
  inventoryController.getLotMovements
);

// --- Movement queries ---
router.get(
  '/movements',
  authorize('inventory', 'view'),
  inventoryController.listMovements
);

// --- Create lot ---
router.post(
  '/lots',
  authorize('inventory', 'create'),
  auditAction('create_lot', 'inventory_lot', (req, data) => data.data && data.data.lot ? data.data.lot.id : null),
  inventoryController.createLot
);

// --- Record manual movement ---
router.post(
  '/movements',
  authorize('inventory', 'create'),
  auditAction('create_movement', 'inventory_movement', (req, data) => data.data && data.data.movement ? data.data.movement.id : null),
  inventoryController.createMovement
);

// --- Stock adjustment ---
// A direct lot write-off with no approval step, so it is Owner-only (owner
// decision 2026-10-05). authorizeRole has no bypass, so Super Admin is listed.
router.post(
  '/adjust',
  authorizeRole('Owner', 'Super Admin'),
  auditAction('adjust_stock', 'inventory_lot', (req) => req.body.lot_id),
  inventoryController.adjustStock
);

// --- Reservations ---
router.post(
  '/reserve',
  authorize('inventory', 'create'),
  auditAction('reserve_stock', 'inventory_reservation', (req, data) => data.data && data.data.reservation ? data.data.reservation.id : null),
  inventoryController.reserveStock
);

router.post(
  '/release/:id',
  authorize('inventory', 'create'), // the undo of /reserve, same permission
  auditAction('release_reservation', 'inventory_reservation'),
  inventoryController.releaseReservation
);

router.get(
  '/reservations',
  authorize('inventory', 'view'),
  inventoryController.listReservations
);

module.exports = router;
