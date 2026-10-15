import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

// The dashboard module pulls in the app's API layer; the tile needs none of it.
vi.mock('../../../../api/queries', () => ({}));
vi.mock('../../../../context/AppContext', () => ({ useApp: () => ({}) }));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));

import { RawStockTile } from '../MillingDashboard';
import { stockKgByType } from '../../../inventory/utils/stockMath';

/**
 * RPT-11: lot quantities are KG, the Raw Stock tile multiplied them by 1000
 * again. Seeded with 12,500 kg + 7,500 kg of raw rice it must read 20,000 kg.
 */
const inventory = [
  { id: 1, type: 'raw', qty: '12500', netWeightKg: '12500' },
  { id: 2, type: 'raw', qty: '7500' }, // older lot: no net weight, qty is KG
  { id: 3, type: 'finished', qty: '9999', netWeightKg: '9999' },
  { id: 4, type: 'raw', qty: '0', netWeightKg: '0' },
];

describe('Milling dashboard — Raw Stock tile', () => {
  it('shows seeded KG as KG, not ×1000', () => {
    const html = renderToStaticMarkup(<MemoryRouter><RawStockTile inventory={inventory} /></MemoryRouter>);
    expect(html).toContain('20,000');
    expect(html).not.toContain('20,000,000');
    expect(html.toLowerCase()).toContain('kg');
  });

  it('sums on-hand KG per type from camel or snake rows', () => {
    expect(stockKgByType(inventory, 'raw')).toBe(20000);
    expect(stockKgByType([{ type: 'raw', net_weight_kg: 300, qty: 999 }], 'raw')).toBe(300);
    expect(stockKgByType(null, 'raw')).toBe(0);
  });
});
