/**
 * Inventory Constants & Movement Taxonomy Tests
 */

const {
  MOVEMENT_TYPES,
  INBOUND_TYPES,
  OUTBOUND_TYPES,
  RESERVATION_TYPES,
  LOT_TRANSACTION_TYPE_MAP,
  getMovementDirection,
  resolveReferenceModule,
} = require('../modules/inventory/inventory.constants');

describe('Inventory Movement Taxonomy', () => {
  describe('MOVEMENT_TYPES', () => {
    it('defines all 17 movement types', () => {
      expect(Object.keys(MOVEMENT_TYPES)).toHaveLength(17);
    });

    it('has unique values', () => {
      const values = Object.values(MOVEMENT_TYPES);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe('getMovementDirection', () => {
    it('returns +1 for inbound types', () => {
      expect(getMovementDirection(MOVEMENT_TYPES.PURCHASE_RECEIPT)).toBe(1);
      expect(getMovementDirection(MOVEMENT_TYPES.PRODUCTION_OUTPUT)).toBe(1);
      expect(getMovementDirection(MOVEMENT_TYPES.TRANSFER_IN)).toBe(1);
      expect(getMovementDirection(MOVEMENT_TYPES.ADJUSTMENT_PLUS)).toBe(1);
    });

    it('returns -1 for outbound types', () => {
      expect(getMovementDirection(MOVEMENT_TYPES.PRODUCTION_ISSUE)).toBe(-1);
      expect(getMovementDirection(MOVEMENT_TYPES.EXPORT_DISPATCH)).toBe(-1);
      expect(getMovementDirection(MOVEMENT_TYPES.LOCAL_SALE)).toBe(-1);
      expect(getMovementDirection(MOVEMENT_TYPES.DAMAGE_WRITEOFF)).toBe(-1);
    });

    it('returns 0 for reservation types', () => {
      expect(getMovementDirection(MOVEMENT_TYPES.RESERVATION_HOLD)).toBe(0);
      expect(getMovementDirection(MOVEMENT_TYPES.RESERVATION_RELEASE)).toBe(0);
    });

    it('returns 0 for unknown types', () => {
      expect(getMovementDirection('unknown_type')).toBe(0);
    });
  });

  describe('LOT_TRANSACTION_TYPE_MAP', () => {
    it('maps every movement type to a transaction type', () => {
      Object.values(MOVEMENT_TYPES).forEach(type => {
        expect(LOT_TRANSACTION_TYPE_MAP[type]).toBeDefined();
        expect(typeof LOT_TRANSACTION_TYPE_MAP[type]).toBe('string');
      });
    });
  });

  describe('Type sets are mutually exclusive', () => {
    it('no type is in both INBOUND and OUTBOUND', () => {
      for (const type of INBOUND_TYPES) {
        expect(OUTBOUND_TYPES.has(type)).toBe(false);
      }
    });

    it('no type is in both INBOUND and RESERVATION', () => {
      for (const type of INBOUND_TYPES) {
        expect(RESERVATION_TYPES.has(type)).toBe(false);
      }
    });

    it('no type is in both OUTBOUND and RESERVATION', () => {
      for (const type of OUTBOUND_TYPES) {
        expect(RESERVATION_TYPES.has(type)).toBe(false);
      }
    });

    it('every MOVEMENT_TYPE is in exactly one set', () => {
      Object.values(MOVEMENT_TYPES).forEach(type => {
        const inCount = [INBOUND_TYPES.has(type), OUTBOUND_TYPES.has(type), RESERVATION_TYPES.has(type)]
          .filter(Boolean).length;
        expect(inCount).toBe(1);
      });
    });
  });

  describe('resolveReferenceModule', () => {
    it('returns export_order when orderId is provided', () => {
      expect(resolveReferenceModule({ orderId: 1 })).toBe('export_order');
    });

    it('returns milling_batch when batchId is provided', () => {
      expect(resolveReferenceModule({ batchId: 5 })).toBe('milling_batch');
    });

    it('returns internal_transfer when transferId is provided', () => {
      expect(resolveReferenceModule({ transferId: 3 })).toBe('internal_transfer');
    });

    it('falls back to sourceEntity', () => {
      expect(resolveReferenceModule({ sourceEntity: 'mill' })).toBe('mill');
    });

    it('returns null when nothing is provided', () => {
      expect(resolveReferenceModule({})).toBeNull();
    });

    it('prioritizes orderId over batchId', () => {
      expect(resolveReferenceModule({ orderId: 1, batchId: 2 })).toBe('export_order');
    });
  });
});
