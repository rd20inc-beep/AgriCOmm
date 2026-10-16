/* global __dirname */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMPTY_SERVICE_LOT, validateServiceLot, buildServiceLotPayload, withKattaWeight } from '../utils/serviceLot';
import { lineNeedsBagKg, paidNowPaymentContext } from '../../millStore/utils/storePurchaseLine';
import { saleIntentFromParams, matchPresetLot } from '../../localSales/utils/saleLot';

const src = (rel) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('New service lot opens in place (NAV-28)', () => {
  it('Service Milling mounts the drawer instead of jumping to /milling?new=service', () => {
    const page = src('../pages/ServiceMilling.jsx');
    expect(page).toContain('<ServiceLotDrawer');
    expect(page).not.toContain("navigate('/milling?new=service')");
  });
  it('requires client, rice type and a received quantity', () => {
    expect(validateServiceLot(EMPTY_SERVICE_LOT())).toMatchObject({ productId: expect.any(String), clientCustomerId: expect.any(String), rawQtyKg: expect.any(String) });
    const truckOnly = { ...EMPTY_SERVICE_LOT(), productId: '2', clientCustomerId: '5', serviceVehicles: [{ vehicle_no: 'T1', weight_kg: '9000' }] };
    expect(validateServiceLot(truckOnly)).toEqual({});
  });
  it('sends the same client-owned service request as before', () => {
    const f = withKattaWeight({ ...EMPTY_SERVICE_LOT(), productId: '2', clientCustomerId: '5', serviceMillingRatePerKg: '3.5' }, '200', '50');
    const p = buildServiceLotPayload(f);
    expect(p).toMatchObject({
      is_service_milling: true, client_customer_id: 5, supplier_id: null, product_id: 2,
      raw_qty_kg: 10000, katta_count: '200', bag_count: null, service_milling_rate_per_kg: '3.5', vehicles: [],
    });
  });
  it('trucks set the quantity; bags go to the bag column', () => {
    const f = { ...EMPTY_SERVICE_LOT(), productId: '2', clientCustomerId: '5', receivedUnit: 'bag', kattaCount: '800', rawQtyKg: '1',
      serviceVehicles: [{ vehicle_no: 'A', weight_kg: '6000' }, { vehicle_no: '', weight_kg: '', total_bags: '' }, { weight_kg: '4000' }] };
    const p = buildServiceLotPayload(f);
    expect(p.raw_qty_kg).toBe(10000);
    expect(p).toMatchObject({ katta_count: null, bag_count: '800' });
    expect(p.vehicles).toHaveLength(2);
  });
});

describe('store purchase drawer (INV-61)', () => {
  it('asks Bag Kg only for bag items', () => {
    expect(lineNeedsBagKg('packaging', { pack_type: 'katta' })).toBe(true);
    expect(lineNeedsBagKg('packaging', { pack_type: 'pp_bag' })).toBe(true);
    expect(lineNeedsBagKg('packaging', { pack_type: 'master_bag' })).toBe(true);
    expect(lineNeedsBagKg('packaging', { pack_type: 'polythene' })).toBe(false);
    expect(lineNeedsBagKg('packaging', { pack_type: 'other' })).toBe(false);
    expect(lineNeedsBagKg('fuel', { pack_type: 'katta' })).toBe(false);
    // Unknown type (just added inline): still asked, as before.
    expect(lineNeedsBagKg('packaging', {})).toBe(true);
  });
  it('"paid now" opens the normal Pay purchase form, nothing auto-posted', () => {
    const ctx = paidNowPaymentContext({ id: 41, purchase_no: 'MP-0041', total_amount: '12500.004', supplier_id: 7 }, { supplierName: 'Bag House' });
    expect(ctx).toEqual({
      variant: 'pay_purchase', source: 'mill_store', sourceId: 41, currency: 'PKR', outstanding: 12500,
      party: { type: 'supplier', id: 7, name: 'Bag House' }, ref: 'MP-0041', notes: 'Paid at purchase MP-0041',
      defaultMethod: 'cash', entity: 'mill',
    });
    expect(paidNowPaymentContext({ id: 1, total_amount: 0 })).toBeNull();
    expect(paidNowPaymentContext(null)).toBeNull();
    const drawer = src('../../../components/NewPurchaseDrawer.jsx');
    expect(drawer).toContain('<PaymentFormDrawer');
    expect(drawer).toContain("canRecordVariant('pay_purchase', hasPermission)");
  });
});

describe('local sale deep link (?new=1&lot=)', () => {
  it('opens the drawer and carries the lot', () => {
    expect(saleIntentFromParams(new URLSearchParams('new=1&lot=FIN-0012'))).toEqual({ open: true, lotRef: 'FIN-0012' });
    expect(saleIntentFromParams(new URLSearchParams('lot=7'))).toEqual({ open: true, lotRef: '7' });
    expect(saleIntentFromParams(new URLSearchParams(''))).toEqual({ open: false, lotRef: null });
  });
  it('picks exactly that lot, never a fuzzy match', () => {
    const lots = [{ id: 3, lotNo: 'FIN-00120' }, { id: 7, lotNo: 'FIN-0012' }];
    expect(matchPresetLot(lots, 'fin-0012').id).toBe(7);
    expect(matchPresetLot(lots, '3').id).toBe(3);
    expect(matchPresetLot(lots, 'FIN-001')).toBeNull();
  });
});
