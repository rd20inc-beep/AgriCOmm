/**
 * Migration: Smart Features — Competitive Intelligence Engine (Phase 13)
 * Tables: cost_predictions, scenarios, country_doc_requirements, mobile_uploads, predictive_alerts
 */

exports.up = async function (knex) {
  // 1. Cost Predictions
  await knex.schema.createTable('cost_predictions', (t) => {
    t.increments('id').primary();
    t.integer('product_id').unsigned().references('id').inTable('products');
    t.string('product_name', 255);
    t.date('prediction_date').defaultTo(knex.fn.now());
    t.decimal('predicted_raw_cost_per_mt', 15, 2); // PKR
    t.decimal('predicted_milling_cost_per_mt', 15, 2);
    t.decimal('predicted_bags_per_mt', 15, 2); // USD
    t.decimal('predicted_freight_per_mt', 15, 2);
    t.decimal('predicted_clearing_per_mt', 15, 2);
    t.decimal('predicted_total_cost_per_mt', 15, 2);
    t.decimal('predicted_min_sell_price', 15, 2); // USD
    t.decimal('confidence_pct', 5, 2); // 0-100
    t.integer('data_points_used');
    t.string('methodology', 50); // 'weighted_average', 'trend_extrapolation', 'historical_median'
    t.jsonb('factors'); // what influenced the prediction
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 2. Scenarios
  await knex.schema.createTable('scenarios', (t) => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.string('scenario_type', 50).notNullable(); // 'fob_vs_cif', 'supplier_comparison', 'yield_scenario', 'fx_scenario', 'full_order'
    t.jsonb('parameters').notNullable(); // input parameters
    t.jsonb('results'); // calculated results
    t.jsonb('comparison_data'); // side-by-side comparison if applicable
    t.text('recommendation');
    t.integer('created_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // 3. Country Document Requirements
  await knex.schema.createTable('country_doc_requirements', (t) => {
    t.increments('id').primary();
    t.string('country', 100).notNullable();
    t.string('incoterm', 10); // null means all incoterms
    t.string('doc_type', 50).notNullable();
    t.boolean('is_required').defaultTo(true);
    t.jsonb('validation_rules'); // e.g. {maxAgeDays: 30, requiresNotarization: true}
    t.text('notes');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['country', 'incoterm', 'doc_type']);
  });

  // 4. Mobile Uploads
  await knex.schema.createTable('mobile_uploads', (t) => {
    t.increments('id').primary();
    t.string('upload_type', 50).notNullable(); // 'qc_photo', 'weighbridge_slip', 'vehicle_photo', 'damage_report', 'document_scan'
    t.string('linked_type', 30); // 'milling_batch', 'grn', 'inventory_lot', 'export_order'
    t.integer('linked_id');
    t.string('linked_ref', 50);
    t.string('file_name', 255);
    t.text('file_path');
    t.integer('file_size');
    t.string('mime_type', 100);
    t.decimal('location_lat', 10, 7);
    t.decimal('location_lng', 10, 7);
    t.string('device_info', 255);
    t.integer('uploaded_by').unsigned().references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // 5. Predictive Alerts
  await knex.schema.createTable('predictive_alerts', (t) => {
    t.increments('id').primary();
    t.string('alert_type', 50).notNullable(); // 'margin_risk', 'yield_anomaly', 'payment_risk', 'cost_spike', 'demand_shift', 'fx_exposure'
    t.string('severity', 10).defaultTo('warning');
    t.string('entity_type', 30);
    t.integer('entity_id');
    t.string('entity_ref', 50);
    t.text('prediction'); // what the system predicts
    t.decimal('confidence_pct', 5, 2);
    t.text('recommended_action');
    t.jsonb('supporting_data'); // evidence
    t.string('status', 20).defaultTo('Active'); // Active, Acknowledged, Dismissed, Expired
    t.timestamp('expires_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Seed country_doc_requirements for top 10 export countries
  const countries = [
    { country: 'UAE', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation'] },
    { country: 'Saudi Arabia', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation', 'saso_certificate'] },
    { country: 'Nigeria', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'nafdac_clearance'] },
    { country: 'Germany', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'eur1_certificate'] },
    { country: 'Singapore', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo'] },
    { country: 'Senegal', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation'] },
    { country: 'Oman', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'fumigation'] },
    { country: 'Kenya', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'kebs_clearance'] },
    { country: 'UK', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo'] },
    { country: 'Canada', docs: ['phyto', 'bl', 'invoice', 'packing_list', 'coo', 'cfia_clearance'] },
  ];

  const validationRulesMap = {
    phyto: JSON.stringify({ maxAgeDays: 14, requiresNotarization: false }),
    bl: JSON.stringify({ requiresOriginal: true }),
    invoice: JSON.stringify({ requiresSignature: true }),
    packing_list: JSON.stringify({ requiresSignature: true }),
    coo: JSON.stringify({ maxAgeDays: 30, requiresNotarization: true }),
    fumigation: JSON.stringify({ maxAgeDays: 21, requiresCertifiedOperator: true }),
    saso_certificate: JSON.stringify({ maxAgeDays: 60, requiresSASOApproval: true }),
    nafdac_clearance: JSON.stringify({ maxAgeDays: 90, requiresNAFDACNumber: true }),
    eur1_certificate: JSON.stringify({ maxAgeDays: 120, requiresEUAuthorization: true }),
    kebs_clearance: JSON.stringify({ maxAgeDays: 60, requiresKEBSInspection: true }),
    cfia_clearance: JSON.stringify({ maxAgeDays: 60, requiresCFIAInspection: true }),
  };

  const notesMap = {
    phyto: 'Phytosanitary certificate issued by Pakistan DPP',
    bl: 'Original bill of lading — 3/3 originals required',
    invoice: 'Commercial invoice with HS code and full product description',
    packing_list: 'Detailed packing list matching BL and invoice',
    coo: 'Certificate of Origin from Chamber of Commerce',
    fumigation: 'Fumigation certificate — methyl bromide or phosphine treatment',
    saso_certificate: 'Saudi Standards, Metrology and Quality Organization certificate',
    nafdac_clearance: 'National Agency for Food and Drug Administration and Control clearance',
    eur1_certificate: 'EUR.1 movement certificate for EU preferential tariff',
    kebs_clearance: 'Kenya Bureau of Standards pre-export verification of conformity',
    cfia_clearance: 'Canadian Food Inspection Agency import clearance',
  };

  const rows = [];
  for (const c of countries) {
    for (const doc of c.docs) {
      rows.push({
        country: c.country,
        incoterm: null,
        doc_type: doc,
        is_required: true,
        validation_rules: validationRulesMap[doc] || null,
        notes: notesMap[doc] || null,
      });
    }
  }

  // Insert in batches to avoid hitting parameter limits
  for (let i = 0; i < rows.length; i += 20) {
    await knex('country_doc_requirements').insert(rows.slice(i, i + 20));
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('predictive_alerts');
  await knex.schema.dropTableIfExists('mobile_uploads');
  await knex.schema.dropTableIfExists('country_doc_requirements');
  await knex.schema.dropTableIfExists('scenarios');
  await knex.schema.dropTableIfExists('cost_predictions');
};
