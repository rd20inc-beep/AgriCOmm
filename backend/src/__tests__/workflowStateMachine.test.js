/**
 * Workflow State Machine Tests
 * Tests all valid/invalid status transitions and allowed actions for every state.
 */

const workflowService = require('../modules/exportOrders/exportOrders.workflow');

const {
  STATUS_TRANSITIONS,
  STATUS_STEP,
  getAllowedTransitions,
  getStepForStatus,
  canTransition,
  getAllowedActions,
  settledAmount,
  MONEY_EPSILON,
} = workflowService;

describe('Workflow State Machine', () => {
  describe('STATUS_TRANSITIONS completeness', () => {
    it('defines transitions for all known statuses', () => {
      const allStatuses = [
        'Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending',
        'In Milling', 'Docs In Preparation', 'Awaiting Balance',
        'Ready to Ship', 'Shipped', 'Arrived', 'Closed', 'Cancelled',
      ];
      allStatuses.forEach(status => {
        expect(STATUS_TRANSITIONS).toHaveProperty(status);
      });
    });

    it('terminal statuses have no transitions', () => {
      expect(getAllowedTransitions('Closed')).toEqual([]);
      expect(getAllowedTransitions('Cancelled')).toEqual([]);
    });

    it('Draft can only go to Awaiting Advance or Advance Received', () => {
      expect(getAllowedTransitions('Draft')).toEqual(['Awaiting Advance', 'Advance Received']);
    });
  });

  describe('canTransition', () => {
    const validTransitions = [
      ['Draft', 'Awaiting Advance'],
      ['Draft', 'Advance Received'],
      ['Awaiting Advance', 'Advance Received'],
      ['Advance Received', 'Procurement Pending'],
      ['Advance Received', 'In Milling'],
      ['Procurement Pending', 'In Milling'],
      ['In Milling', 'Docs In Preparation'],
      ['Docs In Preparation', 'Awaiting Balance'],
      ['Awaiting Balance', 'Ready to Ship'],
      ['Ready to Ship', 'Shipped'],
      ['Shipped', 'Arrived'],
      ['Arrived', 'Closed'],
    ];

    validTransitions.forEach(([from, to]) => {
      it(`allows ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(true);
      });
    });

    const invalidTransitions = [
      ['Draft', 'Shipped'],
      ['Draft', 'Closed'],
      ['Awaiting Advance', 'Shipped'],
      ['In Milling', 'Shipped'],
      ['Shipped', 'Draft'],
      ['Closed', 'Draft'],
      ['Cancelled', 'Draft'],
      ['Ready to Ship', 'In Milling'],
      ['Arrived', 'Shipped'],
    ];

    invalidTransitions.forEach(([from, to]) => {
      it(`rejects ${from} → ${to}`, () => {
        expect(canTransition(from, to)).toBe(false);
      });
    });
  });

  describe('getStepForStatus', () => {
    it('returns sequential step numbers', () => {
      expect(getStepForStatus('Draft')).toBe(1);
      expect(getStepForStatus('Awaiting Advance')).toBe(2);
      expect(getStepForStatus('Advance Received')).toBe(3);
      expect(getStepForStatus('In Milling')).toBe(5);
      expect(getStepForStatus('Closed')).toBe(11);
    });

    it('returns fallback for unknown status', () => {
      expect(getStepForStatus('InvalidStatus', 99)).toBe(99);
    });
  });

  describe('getAllowedActions', () => {
    it('Draft order can confirm advance', () => {
      const actions = getAllowedActions({
        status: 'Draft',
        advance_received: 0,
        advance_expected: 10000,
        balance_received: 0,
        balance_expected: 40000,
      });
      expect(actions.canConfirmAdvance).toBe(true);
      expect(actions.canStartDocs).toBe(false);
      expect(actions.canRequestBalance).toBe(false);
      expect(actions.canUpdateShipment).toBe(false);
      expect(actions.canCloseOrder).toBe(false);
    });

    it('Awaiting Balance can request balance', () => {
      const actions = getAllowedActions({
        status: 'Awaiting Balance',
        advance_received: 10000,
        advance_expected: 10000,
        balance_received: 0,
        balance_expected: 40000,
        milling_order_id: 1,
      });
      expect(actions.canConfirmAdvance).toBe(false);
      expect(actions.canRequestBalance).toBe(true);
      expect(actions.canCreateMilling).toBe(false);
    });

    it('Ready to Ship can update shipment', () => {
      const actions = getAllowedActions({
        status: 'Ready to Ship',
        advance_received: 10000,
        advance_expected: 10000,
        balance_received: 40000,
        balance_expected: 40000,
      });
      expect(actions.canUpdateShipment).toBe(true);
    });

    it('Closed order cannot do anything', () => {
      const actions = getAllowedActions({
        status: 'Closed',
        advance_received: 10000,
        advance_expected: 10000,
        balance_received: 40000,
        balance_expected: 40000,
      });
      expect(actions.canConfirmAdvance).toBe(false);
      expect(actions.canStartDocs).toBe(false);
      expect(actions.canRequestBalance).toBe(false);
      expect(actions.canCreateMilling).toBe(false);
      expect(actions.canUpdateShipment).toBe(false);
      expect(actions.canPutOnHold).toBe(false);
      expect(actions.canCloseOrder).toBe(false);
    });

    it('In Milling can start docs', () => {
      const actions = getAllowedActions({
        status: 'In Milling',
        advance_received: 10000,
        advance_expected: 10000,
      });
      expect(actions.canStartDocs).toBe(true);
    });

    it('Advance Received with no milling can create milling', () => {
      const actions = getAllowedActions({
        status: 'Advance Received',
        advance_received: 10000,
        advance_expected: 10000,
        milling_order_id: null,
      });
      expect(actions.canCreateMilling).toBe(true);
    });

    it('any non-terminal order can be put on hold', () => {
      const activeStatuses = ['Draft', 'Awaiting Advance', 'Advance Received', 'In Milling', 'Ready to Ship'];
      activeStatuses.forEach(status => {
        const actions = getAllowedActions({ status, advance_received: 0, advance_expected: 10000 });
        expect(actions.canPutOnHold).toBe(true);
      });
    });
  });
});
