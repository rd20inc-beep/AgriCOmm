const schemas = require('../middleware/schemas');

// Same options as middleware/validate.js — stripUnknown deletes any field the
// schema does not declare, so a body field the controller reads but the schema
// omits is silently gone. Two live cases found by sweeping every validated route:
//
//   updateExportShipment — 17 fields the Shipment form sends were dropped, and
//     voyage_number / gd_number / gd_date had no fallback in the controller, so
//     every save wrote NULL over whatever was there.
//   createExportOrder — destination_port was dropped, so it was null on every
//     order ever created.
const run = (schema, body) => schema.validate(body, { abortEarly: false, stripUnknown: true });

describe('updateExportShipment — the whole Shipment form must survive Joi', () => {
  // Exactly what exportOrders.controller.updateShipment destructures.
  const READS = [
    'vessel_name', 'booking_no', 'container_no', 'containers',
    'bl_number', 'bl_date', 'shipping_line', 'etd', 'atd', 'eta', 'ata',
    'destination_port', 'notes', 'gate_pass_no',
    'voyage_number', 'gd_number', 'gd_date',
    'fi_number', 'fi_number_2', 'fi_number_3', 'fi_date',
    'freight_terms', 'consignee_type',
    'shipment_window_start', 'shipment_window_end',
    'notify_party_name', 'notify_party_address', 'notify_party_phone', 'notify_party_email',
    'shipment_remarks', 'bank_account_id',
  ];

  test('every field the controller reads is declared', () => {
    const body = {};
    for (const k of READS) {
      body[k] = k === 'containers' ? [] : k === 'bank_account_id' ? 3
        : /_date$|^etd$|^atd$|^eta$|^ata$|_start$|_end$/.test(k) ? '2026-09-27' : `v-${k}`;
    }
    const { error, value } = run(schemas.updateExportShipment, body);
    expect(error).toBeUndefined();
    const dropped = READS.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
    expect(dropped).toEqual([]);
  });

  test('the three fields a save used to wipe now come through', () => {
    // No `|| order.x` fallback in the controller, so being stripped meant NULL.
    const { value } = run(schemas.updateExportShipment, {
      voyage_number: 'V-42', gd_number: 'GD-9', gd_date: '2026-09-27',
    });
    expect(value.voyage_number).toBe('V-42');
    expect(value.gd_number).toBe('GD-9');
    expect(value.gd_date).toBeInstanceOf(Date);
  });

  test('the document fields come through', () => {
    const { value } = run(schemas.updateExportShipment, {
      fi_number: 'FI-1', fi_number_2: 'FI-2', fi_number_3: 'FI-3',
      freight_terms: 'COLLECT', consignee_type: 'to_order_of_bank',
      notify_party_name: 'Acme', notify_party_email: 'a@b.c',
      shipment_remarks: 'handle with care',
    });
    expect(value.fi_number).toBe('FI-1');
    expect(value.fi_number_3).toBe('FI-3');
    expect(value.freight_terms).toBe('COLLECT');
    expect(value.consignee_type).toBe('to_order_of_bank');
    expect(value.notify_party_name).toBe('Acme');
    expect(value.shipment_remarks).toBe('handle with care');
  });

  test('blanks are still allowed — clearing a field must not 400', () => {
    const { error } = run(schemas.updateExportShipment, {
      voyage_number: '', gd_date: '', fi_number: '', notify_party_email: '', bl_date: null,
    });
    expect(error).toBeUndefined();
  });

  test('an unrelated field is still stripped', () => {
    expect(run(schemas.updateExportShipment, { nonsense: 1 }).value.nonsense).toBeUndefined();
  });
});

describe('createExportOrder — destination_port must reach the controller', () => {
  const minimal = {
    customer_id: 1, product_id: 1, qty_mt: 10, price_per_mt: 500,
    contract_value: 5000, incoterm: 'FOB', bank_account_id: 2,
  };

  test('the port set at creation is kept', () => {
    const { error, value } = run(schemas.createExportOrder, { ...minimal, destination_port: 'Jebel Ali' });
    expect(error).toBeUndefined();
    expect(value.destination_port).toBe('Jebel Ali');
  });

  test('omitting it is still fine', () => {
    expect(run(schemas.createExportOrder, minimal).error).toBeUndefined();
  });
});
