/* global __dirname */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportOrdersIntent, duplicateOrderHref, CREATE_ORDER_PATH } from '../utils/exportDeepLinks';
import { duplicateStateFromOrder } from '../utils/createOrderForm';

const P = (q) => new URLSearchParams(q);
const src = (rel) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('export deep links (NAV-09)', () => {
  it('/export?new=1 opens the create form, not the list', () => {
    expect(exportOrdersIntent(P('new=1'))).toEqual({ create: true, to: CREATE_ORDER_PATH });
  });
  it('/export?status=… stays on the list', () => {
    expect(exportOrdersIntent(P('status=Awaiting+Advance'))).toEqual({ create: false, to: null });
  });
  it('a duplicate link goes to the create form carrying the source order', () => {
    expect(exportOrdersIntent(P('duplicate=EX-004'))).toEqual({ create: true, to: '/export/create?duplicate=EX-004' });
    expect(duplicateOrderHref('EX 9/1')).toBe('/export/create?duplicate=EX%209%2F1');
  });
  it('the Dashboard quick action links straight to /export/create', () => {
    const dash = src('../../dashboard/pages/Dashboard.jsx');
    expect(dash).toContain('navigate(CREATE_ORDER_PATH)');
    expect(dash).not.toContain('/export?new=1');
  });
});

describe('duplicate order (W04/W05)', () => {
  const order = {
    id: 'EX-004', customerId: 3, currency: 'EUR', incoterm: 'CIF', advancePct: 30, bankAccountId: 2,
    contractNumber: 'C-77', shipmentWindowStart: '2026-11-01', etd: '2026-11-03', blNo: 'BL-1',
    advanceReceived: 5000, balanceReceived: 1000, documents: [{ id: 1 }], payments: [{ id: 9 }],
    items: [{ productId: 20, productName: 'Super Kernel', qtyMT: 50, pricePerMT: 900 }],
  };
  it('copies terms and lines', () => {
    const dup = duplicateStateFromOrder(order);
    expect(dup.sourceOrderNo).toBe('EX-004');
    expect(dup.form).toMatchObject({ customerId: '3', currency: 'EUR', incoterm: 'CIF', advancePct: 30, bankAccountId: '2' });
    expect(dup.items[0]).toMatchObject({ productId: '20', qtyMT: '50', pricePerMT: '900' });
  });
  it('never copies payments, documents, shipment dates or the contract number', () => {
    const flat = JSON.stringify(duplicateStateFromOrder(order));
    for (const k of ['advanceReceived', 'balanceReceived', 'documents', 'payments', 'contractNumber', 'shipmentWindowStart', 'etd', 'blNo', 'C-77', 'BL-1']) {
      expect(flat).not.toContain(k);
    }
  });
  it('the list row offers Duplicate to users who may create, and the create form has one Create button', () => {
    const list = src('../pages/ExportOrders.jsx');
    expect(list).toMatch(/canCreate && \(/);
    expect(list).toContain('duplicateOrderHref(order.id)');
    const create = src('../pages/CreateExportOrder.jsx');
    expect(create).not.toContain('Create & Request Advance');
    expect(create).toContain("searchParams.get('duplicate')");
  });
});
