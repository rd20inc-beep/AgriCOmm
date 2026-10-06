import { describe, it, expect } from 'vitest';
import { workflowSteps, workflowStepFor, isBalanceDue } from '../constants';

describe('workflow steps — ship on the advance', () => {
  it('reads Advance → Production → Docs → Ready to Ship → Shipped → Balance → Closed', () => {
    expect(workflowSteps.map((s) => s.label)).toEqual([
      'Order Created', 'Advance', 'Production', 'Docs', 'Ready to Ship', 'Shipped', 'Balance', 'Closed',
    ]);
  });

  it('every order status lands on exactly one step', () => {
    const statuses = ['Draft', 'Awaiting Advance', 'Advance Received', 'Procurement Pending', 'In Milling',
      'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship', 'Shipped', 'Arrived', 'Closed'];
    for (const s of statuses) {
      expect(workflowSteps.filter((st) => st.statuses.includes(s))).toHaveLength(1);
    }
  });

  it('a legacy Awaiting Balance order shows as Ready to Ship, and the balance step comes after Shipped', () => {
    expect(workflowStepFor('Awaiting Balance').label).toBe('Ready to Ship');
    expect(workflowStepFor('Arrived').step).toBeGreaterThan(workflowStepFor('Shipped').step);
    expect(workflowStepFor('Docs In Preparation').step).toBeLessThan(workflowStepFor('Ready to Ship').step);
  });
});

describe('isBalanceDue', () => {
  const o = (over) => ({ status: 'Shipped', balanceExpected: 40000, balanceReceived: 0, ...over });

  it('is due on a sailed order still owed its balance', () => {
    expect(isBalanceDue(o())).toBe(true);
    expect(isBalanceDue(o({ status: 'Arrived', balanceReceived: 10000 }))).toBe(true);
    expect(isBalanceDue(o({ status: 'Awaiting Balance' }))).toBe(true);
  });

  it('is not due before sailing, once received, or when closed', () => {
    expect(isBalanceDue(o({ status: 'Ready to Ship' }))).toBe(false);
    expect(isBalanceDue(o({ status: 'In Milling' }))).toBe(false);
    expect(isBalanceDue(o({ balanceReceived: 40000 }))).toBe(false);
    expect(isBalanceDue(o({ status: 'Closed' }))).toBe(false);
  });
});
