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

describe('submitApproval — the before-snapshot must reach the service', () => {
  const minimal = {
    approval_type: 'cost_edit', entity_type: 'lot', entity_id: 5,
    proposed_data: { cost: 120 },
  };

  test('current_data survives Joi', () => {
    // control.service writes `current_data: currentData ? JSON.stringify(...) : null`,
    // so stripping it meant the column was always null and the approver could not
    // see what the change was FROM.
    const { error, value } = run(schemas.submitApproval, { ...minimal, current_data: { cost: 100 } });
    expect(error).toBeUndefined();
    expect(value.current_data).toEqual({ cost: 100 });
  });

  test('it stays optional — a first-time request has no before state', () => {
    expect(run(schemas.submitApproval, minimal).error).toBeUndefined();
    expect(run(schemas.submitApproval, { ...minimal, current_data: null }).error).toBeUndefined();
  });
});

describe('createExportOrder — order-level item fields reach create()', () => {
  const minimal = {
    customer_id: 1, product_id: 1, qty_mt: 10, price_per_mt: 500,
    contract_value: 5000, incoterm: 'FOB', bank_account_id: 2,
  };

  test('hs_code, quality_description and broken_pct_target come through', () => {
    // create() reads these as req.body.x (not via its destructure, which is why
    // reading the destructure alone missed them) to build a single item row when
    // no items are sent. Stripped, that row was written with nulls.
    const { error, value } = run(schemas.createExportOrder, {
      ...minimal,
      hs_code: '1006.30.90',
      quality_description: '2% broken, double polished',
      broken_pct_target: 2,
    });
    expect(error).toBeUndefined();
    expect(value.hs_code).toBe('1006.30.90');
    expect(value.quality_description).toBe('2% broken, double polished');
    expect(value.broken_pct_target).toBe(2);
  });
});

describe('createExportOrder — contract fields the form always sent but nothing saved', () => {
  const minimal = {
    customer_id: 1, product_id: 1, qty_mt: 10, price_per_mt: 500,
    contract_value: 5000, incoterm: 'FOB', bank_account_id: 2,
  };

  test('all four reach the controller', () => {
    const { error, value } = run(schemas.createExportOrder, {
      ...minimal,
      contract_number: 'AGRI/2026/014',
      consignee_type: 'direct',
      shipment_window_start: '2026-10-01',
      shipment_window_end: '2026-10-31',
    });
    expect(error).toBeUndefined();
    expect(value.contract_number).toBe('AGRI/2026/014');
    expect(value.consignee_type).toBe('direct');
    expect(value.shipment_window_start).toBeInstanceOf(Date);
    expect(value.shipment_window_end).toBeInstanceOf(Date);
  });

  test('consignee_type is not a closed list', () => {
    // The create form offers 'direct', updateExportShipment accepts any string,
    // and the BL renderer treats anything but 'to_order_of_bank' as direct — so a
    // strict enum here would reject values the rest of the system handles.
    for (const v of ['to_order_of_bank', 'direct', '']) {
      expect(run(schemas.createExportOrder, { ...minimal, consignee_type: v }).error).toBeUndefined();
    }
  });

  test('omitting them is still fine, and blanks do not 400', () => {
    expect(run(schemas.createExportOrder, minimal).error).toBeUndefined();
    expect(run(schemas.createExportOrder, {
      ...minimal, contract_number: '', shipment_window_start: '', shipment_window_end: null,
    }).error).toBeUndefined();
  });
});
