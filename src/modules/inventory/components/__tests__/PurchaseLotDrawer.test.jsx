import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Cost visibility on New Rice Purchase (owner decision 2026-10-05): the QC
 * Analyst, Inventory Officer and Documentation Officer record the rice without
 * its money — no price, commission or freight inputs and no value lines. The
 * server ignores any price they send and creates the lot unpriced.
 */
let mockShowCost = true;
vi.mock('../../../../hooks/useCanSeeCost', () => ({ default: () => mockShowCost }));
vi.mock('../../../../api/queries', () => ({ useCreatePurchaseLot: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('../../api/services', () => ({ lotInventoryApi: { previewLotNo: vi.fn() } }));
vi.mock('../../../../components/SlideDrawer', () => ({
  default: ({ children, footer }) => <div>{children}{footer}</div>,
}));
vi.mock('../../../../components/SupplierPicker', () => ({ default: ({ label }) => <div>{label}</div> }));
vi.mock('../../../../components/HaulerPicker', () => ({ default: ({ label }) => <div>{label}</div> }));

const { default: PurchaseLotDrawer } = await import('../PurchaseLotDrawer');

const render = () => renderToStaticMarkup(<PurchaseLotDrawer isOpen onClose={() => {}} />);

describe('PurchaseLotDrawer cost visibility', () => {
  beforeEach(() => { mockShowCost = true; });

  it('shows the price, commission and freight inputs to a user who can see cost', () => {
    const html = render();
    expect(html).toContain('Price per KG');
    expect(html).toContain('Commission per bag/katta');
    expect(html).toContain('Transport cost (PKR)');
    expect(html).toContain('Transport paid by');
  });

  it('hides every money input from a cost-blind user but keeps the transporter', () => {
    mockShowCost = false;
    const html = render();
    expect(html).not.toContain('Price per KG');
    expect(html).not.toContain('Commission per bag/katta');
    expect(html).not.toContain('Transport cost (PKR)');
    expect(html).not.toContain('Transport paid by');
    expect(html).not.toContain('Final Cost per KG');
    expect(html).toContain('Transporter / hauler');
  });
});
