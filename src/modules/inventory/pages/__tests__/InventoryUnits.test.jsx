import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

/**
 * D2: mill-side screens show KG. The Inventory hero used to print MT whatever
 * the unit toggle said; it now follows the toggle, which defaults to KG.
 * Add Purchase (Rs/kg rates) shows its stock figures in kg too.
 */
vi.mock('../../../../hooks/useCanSeeCost', () => ({ default: () => false }));
vi.mock('../../../../api/queries', () => ({
  useLotInventory: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
  useStockReport: () => ({ data: { report: [
    { groupName: 'raw', totalKg: '12082.5', totalValue: 0 },
    { groupName: 'finished', totalKg: 24350, totalValue: 0 },
  ] } }),
  useAddPurchaseToLot: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn() }) }));
vi.mock('../../../../components/SlideDrawer', () => ({
  default: ({ children, footer }) => <div>{children}{footer}</div>,
}));

const { default: Inventory } = await import('../Inventory');
const { default: AddPurchaseModal } = await import('../../components/AddPurchaseModal');

describe('Inventory headline units', () => {
  it('shows the stock-on-hand headline in KG by default, not MT', () => {
    const html = renderToStaticMarkup(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(html).toContain('36,432.5 KG');
    expect(html).toContain('Raw 12,082.5 KG');
    expect(html).toContain('Finished 24,350 KG');
    expect(html).not.toMatch(/\d MT/);
  });
});

describe('Add Purchase units', () => {
  it('shows current and new lot stock in kg alongside the Rs/kg rate', () => {
    const lot = { id: 1, lotNo: 'L-001', netWeightKg: 24350, landedCostTotal: 4200375, landedCostPerKg: 172.5 };
    const html = renderToStaticMarkup(<MemoryRouter><AddPurchaseModal isOpen lot={lot} onClose={() => {}} /></MemoryRouter>);
    expect(html).toContain('24,350 kg @ Rs 172.50/kg');
    expect(html).not.toMatch(/\d MT/);
  });
});
