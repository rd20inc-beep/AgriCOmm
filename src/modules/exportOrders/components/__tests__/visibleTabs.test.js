import { describe, it, expect } from 'vitest';
import { getVisibleTabs } from '../constants';

const keys = (status) => getVisibleTabs(status).map(t => t.key);

describe('getVisibleTabs — Documents before the advance', () => {
  // The proforma invoice is the document you send in order to OBTAIN the
  // advance, so hiding the Documents tab until milling made the export
  // manager wait on the very payment the document exists to request.
  it('shows Documents on a brand-new Draft order', () => {
    expect(keys('Draft')).toContain('documents');
  });

  it('shows Documents while the advance is still awaited', () => {
    expect(keys('Awaiting Advance')).toContain('documents');
  });

  it('still shows Documents at every later stage', () => {
    for (const s of ['Advance Received', 'Procurement Pending', 'In Milling',
      'Docs In Preparation', 'Awaiting Balance', 'Ready to Ship',
      'Shipped', 'Arrived', 'Closed']) {
      expect(keys(s), s).toContain('documents');
    }
  });

  it('leaves the other stage gates alone', () => {
    // Financials and Shipment stay staged — only Documents was decoupled.
    expect(keys('Draft')).not.toContain('financials');
    expect(keys('Draft')).not.toContain('shipment');
    expect(keys('Awaiting Advance')).toContain('financials');
    expect(keys('In Milling')).not.toContain('shipment');
    expect(keys('Ready to Ship')).toContain('shipment');
  });

  it('keeps the tab order from tabList', () => {
    const k = keys('Closed');
    expect(k.indexOf('documents')).toBeGreaterThan(k.indexOf('packing'));
    expect(k.indexOf('documents')).toBeLessThan(k.indexOf('shipment'));
  });
});
