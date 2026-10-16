import { describe, it, expect } from 'vitest';
import { canTransferLotToExport, lotInventoryFiltersFromParams, sellLocallyHref } from '../lotActions';
import { bulkCountLines, bigVarianceLines } from '../stockCountBulk';
import { readLastPurchaseParties, rememberPurchaseParties, forgetPurchaseParties, applyRememberedParties } from '../lastPurchaseParties';

// P5-10 / W01 / W14 pure rules behind the click-reduction shortcuts.

const P = (q) => new URLSearchParams(q);

describe('Lot Inventory deep links (?type= / ?status=)', () => {
  it('honours ?type=raw from the Mill dashboard Raw Stock card', () => {
    expect(lotInventoryFiltersFromParams(P('type=raw'))).toEqual({ type: 'raw', status: 'Available' });
  });
  it('honours a valid ?status=', () => {
    expect(lotInventoryFiltersFromParams(P('type=finished&status=All'))).toEqual({ type: 'finished', status: 'All' });
  });
  it('falls back to the defaults on unknown values', () => {
    expect(lotInventoryFiltersFromParams(P('type=bogus&status=nope'))).toEqual({ type: 'All', status: 'Available' });
    expect(lotInventoryFiltersFromParams(null)).toEqual({ type: 'All', status: 'Available' });
  });
});

describe('Sell Locally from a lot carries the lot (NAV-20)', () => {
  it('links to the new-sale drawer with the lot number', () => {
    expect(sellLocallyHref({ id: 7, lotNo: 'FIN-0012' })).toBe('/local-sales?new=1&lot=FIN-0012');
    expect(sellLocallyHref({ id: 7 })).toBe('/local-sales?new=1&lot=7');
    expect(sellLocallyHref(null)).toBe('/local-sales?new=1');
  });
});

describe('row Transfer to Export (W14)', () => {
  const base = { type: 'finished', entity: 'mill', ownership: 'company', availableQty: '1200' };
  it('is offered for finished / by-product company mill stock with free qty', () => {
    expect(canTransferLotToExport(base)).toBe(true);
    expect(canTransferLotToExport({ ...base, type: 'byproduct' })).toBe(true);
  });
  it('is not offered for raw, export, client-owned or empty lots', () => {
    expect(canTransferLotToExport({ ...base, type: 'raw' })).toBe(false);
    expect(canTransferLotToExport({ ...base, entity: 'export' })).toBe(false);
    expect(canTransferLotToExport({ ...base, ownership: 'client' })).toBe(false);
    expect(canTransferLotToExport({ ...base, availableQty: 0 })).toBe(false);
    expect(canTransferLotToExport(null)).toBe(false);
  });
});

describe('bulk stock take (INV-34)', () => {
  const items = [
    { id: 1, system_qty: 1000, counted_qty: null, status: 'Pending' },
    { id: 2, system_qty: 500, counted_qty: 500, status: 'Counted' },
    { id: 3, system_qty: 200, counted_qty: null, status: 'Pending' },
    { id: 4, system_qty: 100, counted_qty: null, status: 'Pending' },
  ];
  it('sends every typed line once, skipping untouched and unchanged ones', () => {
    const lines = bulkCountLines(items, { 1: '990', 2: '500', 3: '', 4: '30' });
    expect(lines).toEqual([{ item_id: 1, counted_qty: 990 }, { item_id: 4, counted_qty: 30 }]);
  });
  it('a changed saved line is sent again', () => {
    expect(bulkCountLines(items, { 2: '480' })).toEqual([{ item_id: 2, counted_qty: 480 }]);
  });
  it('ignores non-numbers', () => {
    expect(bulkCountLines(items, { 1: 'abc' })).toEqual([]);
  });
  it('flags the lines more than half off the record for one confirmation', () => {
    const lines = bulkCountLines(items, { 1: '990', 4: '30' });
    const big = bigVarianceLines(items, lines);
    expect(big.map((b) => b.item_id)).toEqual([4]);
    expect(big[0].variance).toBe(-70);
  });
});

describe('remembered purchase parties (W01)', () => {
  const mem = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  };
  it('remembers supplier, broker and transporter of the last save', () => {
    const s = mem();
    rememberPurchaseParties({ supplier_id: 4, broker_id: 9, hauler_id: 2, weight_kg: 100 }, s);
    expect(readLastPurchaseParties(s)).toEqual({ supplier_id: '4', broker_id: '9', hauler_id: '2' });
    forgetPurchaseParties(s);
    expect(readLastPurchaseParties(s)).toEqual({ supplier_id: '', broker_id: '', hauler_id: '' });
  });
  it('prefills only a supplier still in the list, broker separately chosen', () => {
    const r = applyRememberedParties({ supplier_id: '', broker_id: '', hauler_id: '' }, { supplier_id: '4', broker_id: '9', hauler_id: '2' }, [4, 9]);
    expect(r.applied).toBe(true);
    expect(r.brokerDiffers).toBe(true);
    expect(r.form).toMatchObject({ supplier_id: '4', broker_id: '9', hauler_id: '2' });
  });
  it('an archived supplier is not reused; a gone broker falls back to the supplier', () => {
    expect(applyRememberedParties({ supplier_id: '' }, { supplier_id: '4' }, [5]).applied).toBe(false);
    const r = applyRememberedParties({ supplier_id: '', broker_id: '', hauler_id: '' }, { supplier_id: '4', broker_id: '9', hauler_id: '' }, [4]);
    expect(r.form.broker_id).toBe('4');
    expect(r.brokerDiffers).toBe(false);
  });
  it('a corrupt stored value reads as nothing remembered', () => {
    const s = mem();
    s.setItem('riceflow_last_rice_purchase_parties', '{not json');
    expect(readLastPurchaseParties(s)).toEqual({ supplier_id: '', broker_id: '', hauler_id: '' });
  });
});
