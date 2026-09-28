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

// Column widths read off the live database, not guessed. A value longer than the
// column used to pass Joi and then fail in Postgres, which surfaces as a 500 with
// no indication of which field was at fault.
describe('string limits match the columns they are written to', () => {
  const WIDTHS = {
    createExportOrder: { contract_number: 50, consignee_type: 20, hs_code: 20, destination_port: 255 },
    updateExportShipment: {
      voyage_number: 50, gd_number: 100, fi_number: 100, fi_number_2: 100, fi_number_3: 100,
      freight_terms: 20, consignee_type: 20,
      notify_party_name: 255, notify_party_phone: 50, notify_party_email: 255,
    },
  };
  const base = {
    createExportOrder: {
      customer_id: 1, product_id: 1, qty_mt: 10, price_per_mt: 500,
      contract_value: 5000, incoterm: 'FOB', bank_account_id: 2,
    },
    updateExportShipment: {},
  };

  for (const [schemaName, fields] of Object.entries(WIDTHS)) {
    for (const [field, width] of Object.entries(fields)) {
      test(`${schemaName}.${field} accepts ${width} chars and refuses ${width + 1}`, () => {
        const at = run(schemas[schemaName], { ...base[schemaName], [field]: 'x'.repeat(width) });
        expect(at.error).toBeUndefined();
        const over = run(schemas[schemaName], { ...base[schemaName], [field]: 'x'.repeat(width + 1) });
        expect(over.error).toBeDefined();
        // The refusal has to name the field, or the user cannot tell what to fix.
        expect(over.error.details.some((d) => d.path.includes(field))).toBe(true);
      });
    }
  }

  test('the unbounded text columns stay unbounded', () => {
    const long = 'x'.repeat(5000);
    expect(run(schemas.updateExportShipment, { notify_party_address: long, shipment_remarks: long }).error)
      .toBeUndefined();
    expect(run(schemas.createExportOrder, { ...base.createExportOrder, quality_description: long }).error)
      .toBeUndefined();
  });
});

describe('updateExportShipment — contract_number', () => {
  test('reaches the controller', () => {
    const { error, value } = run(schemas.updateExportShipment, { contract_number: 'AGRI/2026/014' });
    expect(error).toBeUndefined();
    expect(value.contract_number).toBe('AGRI/2026/014');
  });

  test('capped at the column width, refused by name past it', () => {
    expect(run(schemas.updateExportShipment, { contract_number: 'x'.repeat(50) }).error).toBeUndefined();
    const over = run(schemas.updateExportShipment, { contract_number: 'x'.repeat(51) });
    expect(over.error).toBeDefined();
    expect(over.error.details.some((d) => d.path.includes('contract_number'))).toBe(true);
  });

  test('a blank is allowed through — the controller decides what it means', () => {
    expect(run(schemas.updateExportShipment, { contract_number: '' }).error).toBeUndefined();
  });
});

// The Shipment form is the third place the contract number can be set, after
// creation and the Overview specs form. A blank must therefore KEEP what is
// already stored rather than null it — the mistake voyage_number and gd_number
// made, where every save wiped the value.
describe('updateShipment persists contract_number without wiping it', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../modules/exportOrders/exportOrders.controller.js'), 'utf8',
  );
  // Brace-balanced, because slicing to the next `async ` stops at the inner
  // `async (trx)` and cuts the function off before its update statement.
  const updateBlock = (() => {
    const at = src.indexOf('async updateShipment');
    const open = src.indexOf('{', at);
    let d = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') d += 1;
      else if (src[i] === '}') { d -= 1; if (d === 0) return src.slice(at, i + 1); }
    }
    throw new Error('updateShipment not found');
  })();

  test('it is destructured from the body', () => {
    expect(/const \{[\s\S]*?contract_number[\s\S]*?\} = req\.body/.test(updateBlock)).toBe(true);
  });

  test('it is written with a fallback to the stored value', () => {
    expect(updateBlock).toMatch(/contract_number:\s*contract_number\s*\|\|\s*order\.contract_number\s*\|\|\s*null/);
  });

  test('it is not written as a bare `x || null`, which would wipe on blank', () => {
    expect(updateBlock).not.toMatch(/contract_number:\s*contract_number\s*\|\|\s*null/);
  });
});
