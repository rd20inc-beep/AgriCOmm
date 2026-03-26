/**
 * Seed: Advanced Milling Operations (Phase 5)
 * Mills, recovery benchmarks, production plans, machine downtime,
 * utility consumption, and post-milling quality records.
 * Uses realistic Pakistan rice milling data.
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('reprocessing_batches').del();
  await knex('batch_source_lots').del();
  await knex('milling_quality_post').del();
  await knex('utility_consumption').del();
  await knex('machine_downtime').del();
  await knex('production_plans').del();
  await knex('recovery_benchmarks').del();
  await knex('mills').del();

  // Look up referenced entities
  const users = await knex('users').select('id', 'full_name').limit(3);
  const products = await knex('products').select('id', 'name').limit(5);
  const batches = await knex('milling_batches').select('id', 'batch_no').limit(5);

  const userId1 = users[0] ? users[0].id : 1;
  const userId2 = users[1] ? users[1].id : userId1;
  const productId1 = products[0] ? products[0].id : null;
  const productId2 = products[1] ? products[1].id : null;
  const batchId1 = batches[0] ? batches[0].id : null;
  const batchId2 = batches[1] ? batches[1].id : null;
  const batchId3 = batches[2] ? batches[2].id : null;

  // =========================================================================
  // Mills
  // =========================================================================

  const [mill1] = await knex('mills')
    .insert({
      name: 'Agri Rice Mill - Karachi',
      location: 'SITE Area, Karachi, Sindh',
      capacity_mt_per_day: 50.00,
      status: 'Active',
      contact_person: 'Muhammad Arif',
      phone: '021-32567890',
      notes: 'Main processing facility. 3 milling lines with sortex and polishing.',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    })
    .returning('id');
  const millId1 = typeof mill1 === 'object' ? mill1.id : mill1;

  const [mill2] = await knex('mills')
    .insert({
      name: 'ARC Processing Unit - Hyderabad',
      location: 'Hyderabad Industrial Estate, Sindh',
      capacity_mt_per_day: 30.00,
      status: 'Active',
      contact_person: 'Abdul Rashid',
      phone: '022-2785432',
      notes: 'Secondary mill. 2 milling lines, specializes in Basmati processing.',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    })
    .returning('id');
  const millId2 = typeof mill2 === 'object' ? mill2.id : mill2;

  const [mill3] = await knex('mills')
    .insert({
      name: 'Sindh Rice Processors - Sukkur',
      location: 'Sukkur Barrage Road, Sukkur, Sindh',
      capacity_mt_per_day: 20.00,
      status: 'Maintenance',
      contact_person: 'Ghulam Nabi',
      phone: '071-5612345',
      notes: 'Under maintenance — boiler replacement scheduled for completion March 2026.',
      created_at: '2026-01-15',
      updated_at: '2026-03-01',
    })
    .returning('id');
  const millId3 = typeof mill3 === 'object' ? mill3.id : mill3;

  // =========================================================================
  // Recovery Benchmarks — 5 common varieties
  // =========================================================================

  await knex('recovery_benchmarks').insert([
    {
      product_id: productId1,
      variety: 'IRRI-6',
      season: 'Kharif',
      expected_yield_pct: 67.00,
      expected_broken_pct: 8.50,
      expected_bran_pct: 6.50,
      expected_husk_pct: 20.00,
      expected_wastage_pct: 2.00,
      moisture_range_min: 12.00,
      moisture_range_max: 14.00,
      notes: 'Standard IRRI-6 recovery from Sindh region. Kharif crop typically yields higher.',
    },
    {
      product_id: productId2,
      variety: 'Super Basmati',
      season: 'Kharif',
      expected_yield_pct: 65.00,
      expected_broken_pct: 10.00,
      expected_bran_pct: 7.00,
      expected_husk_pct: 21.00,
      expected_wastage_pct: 2.00,
      moisture_range_min: 11.50,
      moisture_range_max: 13.50,
      notes: 'Super Basmati from Punjab. Longer grain means slightly higher breakage.',
    },
    {
      product_id: productId1,
      variety: 'PK-386',
      season: 'Kharif',
      expected_yield_pct: 66.00,
      expected_broken_pct: 9.00,
      expected_bran_pct: 7.00,
      expected_husk_pct: 20.50,
      expected_wastage_pct: 1.50,
      moisture_range_min: 12.00,
      moisture_range_max: 14.00,
      notes: 'PK-386 is a popular non-basmati export variety from lower Sindh.',
    },
    {
      product_id: productId2,
      variety: '1121 Basmati',
      season: 'Kharif',
      expected_yield_pct: 63.00,
      expected_broken_pct: 12.00,
      expected_bran_pct: 7.50,
      expected_husk_pct: 22.00,
      expected_wastage_pct: 1.50,
      moisture_range_min: 11.00,
      moisture_range_max: 13.00,
      notes: '1121 extra-long grain has higher breakage due to grain length. Premium pricing offsets lower yield.',
    },
    {
      product_id: productId1,
      variety: 'C9',
      season: 'Kharif',
      expected_yield_pct: 68.00,
      expected_broken_pct: 8.00,
      expected_bran_pct: 6.00,
      expected_husk_pct: 19.00,
      expected_wastage_pct: 2.00,
      moisture_range_min: 12.50,
      moisture_range_max: 14.50,
      notes: 'C9 (Chand-9) is a short-grain variety with good milling recovery from Sindh.',
    },
  ]);

  // =========================================================================
  // Production Plans — 3 plans
  // =========================================================================

  await knex('production_plans').insert({
    plan_no: 'PP-001',
    batch_id: batchId1,
    mill_id: millId1,
    planned_date: '2026-02-01',
    shift: 'Morning',
    machine_line: 'Line A',
    planned_qty_mt: 32.50,
    actual_qty_mt: 33.00,
    status: 'Completed',
    operator_name: 'Saleem Ahmed',
    start_time: '2026-02-01 06:00:00',
    end_time: '2026-02-01 14:30:00',
    notes: 'First shift for batch M-201. Smooth run, slight overproduction.',
    created_by: userId1,
    created_at: '2026-01-30',
    updated_at: '2026-02-01',
  });

  await knex('production_plans').insert({
    plan_no: 'PP-002',
    batch_id: batchId2,
    mill_id: millId1,
    planned_date: '2026-02-15',
    shift: 'Afternoon',
    machine_line: 'Line B',
    planned_qty_mt: 45.00,
    actual_qty_mt: 38.50,
    status: 'In Progress',
    operator_name: 'Faisal Khan',
    start_time: '2026-02-15 14:00:00',
    end_time: null,
    notes: 'Large batch run for M-202. In progress — power fluctuation caused delay.',
    created_by: userId1,
    created_at: '2026-02-12',
    updated_at: '2026-02-15',
  });

  await knex('production_plans').insert({
    plan_no: 'PP-003',
    batch_id: batchId3,
    mill_id: millId2,
    planned_date: '2026-03-20',
    shift: 'Morning',
    machine_line: 'Line A',
    planned_qty_mt: 28.00,
    actual_qty_mt: 0,
    status: 'Planned',
    operator_name: 'Imran Soomro',
    start_time: null,
    end_time: null,
    notes: 'Scheduled for Hyderabad facility. Awaiting raw material arrival.',
    created_by: userId2,
    created_at: '2026-03-15',
    updated_at: '2026-03-15',
  });

  // =========================================================================
  // Machine Downtime — 2 records
  // =========================================================================

  await knex('machine_downtime').insert({
    mill_id: millId1,
    machine_line: 'Line B',
    batch_id: batchId2,
    start_time: '2026-02-15 16:30:00',
    end_time: '2026-02-15 18:15:00',
    duration_minutes: 105,
    reason: 'Power Outage',
    description: 'KESC power failure affected Line B during afternoon shift. Generator backup took 15 minutes to engage.',
    impact_mt: 3.20,
    resolved: true,
    reported_by: userId1,
    created_at: '2026-02-15',
    updated_at: '2026-02-15',
  });

  await knex('machine_downtime').insert({
    mill_id: millId1,
    machine_line: 'Line A',
    batch_id: null,
    start_time: '2026-03-18 09:00:00',
    end_time: null,
    duration_minutes: null,
    reason: 'Breakdown',
    description: 'Sortex machine color sorter malfunction on Line A. Technician called, awaiting parts from Lahore.',
    impact_mt: 0,
    resolved: false,
    reported_by: userId2,
    created_at: '2026-03-18',
    updated_at: '2026-03-18',
  });

  // =========================================================================
  // Utility Consumption — 4 records (electricity for different batches)
  // =========================================================================

  await knex('utility_consumption').insert([
    {
      batch_id: batchId1,
      mill_id: millId1,
      utility_type: 'Electricity',
      reading_start: 45200.00,
      reading_end: 45680.00,
      consumption: 480.00,
      unit: 'kWh',
      rate_per_unit: 38.50,
      total_cost: 18480.00,
      currency: 'PKR',
      period_start: '2026-02-01',
      period_end: '2026-02-03',
      notes: 'Electricity for batch M-201 milling, Line A. 2-day run.',
      recorded_by: userId1,
      created_at: '2026-02-03',
    },
    {
      batch_id: batchId2,
      mill_id: millId1,
      utility_type: 'Electricity',
      reading_start: 45680.00,
      reading_end: 46520.00,
      consumption: 840.00,
      unit: 'kWh',
      rate_per_unit: 38.50,
      total_cost: 32340.00,
      currency: 'PKR',
      period_start: '2026-02-15',
      period_end: '2026-02-18',
      notes: 'Electricity for batch M-202 milling, Line B. Larger batch = higher consumption.',
      recorded_by: userId1,
      created_at: '2026-02-18',
    },
    {
      batch_id: batchId1,
      mill_id: millId1,
      utility_type: 'Water',
      reading_start: 1200.00,
      reading_end: 1245.00,
      consumption: 45.00,
      unit: 'm3',
      rate_per_unit: 120.00,
      total_cost: 5400.00,
      currency: 'PKR',
      period_start: '2026-02-01',
      period_end: '2026-02-03',
      notes: 'Water consumption for paddy soaking and cleaning, batch M-201.',
      recorded_by: userId1,
      created_at: '2026-02-03',
    },
    {
      batch_id: null,
      mill_id: millId2,
      utility_type: 'Electricity',
      reading_start: 22100.00,
      reading_end: 22350.00,
      consumption: 250.00,
      unit: 'kWh',
      rate_per_unit: 36.00,
      total_cost: 9000.00,
      currency: 'PKR',
      period_start: '2026-03-01',
      period_end: '2026-03-07',
      notes: 'General facility electricity for Hyderabad unit — idle week, minimal load.',
      recorded_by: userId2,
      created_at: '2026-03-07',
    },
  ]);

  // =========================================================================
  // Post-Milling Quality — 2 records
  // =========================================================================

  await knex('milling_quality_post').insert([
    {
      batch_id: batchId1,
      product_type: 'finished',
      moisture: 11.80,
      broken_pct: 3.50,
      chalky_pct: 0.80,
      whiteness: 42.50,
      grain_length: 6.80,
      foreign_matter: 0.10,
      grade_assigned: 'Premium Grade A',
      inspector: 'Qasim Ali',
      inspected_at: '2026-02-04 10:00:00',
      notes: 'Excellent finish quality. Whiteness and grain length within export spec.',
      created_at: '2026-02-04',
    },
    {
      batch_id: batchId2,
      product_type: 'finished',
      moisture: 12.10,
      broken_pct: 4.80,
      chalky_pct: 1.10,
      whiteness: 41.00,
      grain_length: 7.20,
      foreign_matter: 0.20,
      grade_assigned: 'Grade A',
      inspector: 'Qasim Ali',
      inspected_at: '2026-02-20 14:30:00',
      notes: 'Good quality. Slight chalky presence, within acceptable limits for export.',
      created_at: '2026-02-20',
    },
  ]);

  // Update milling_batches with mill_id references for the seeded batches
  if (batchId1) {
    await knex('milling_batches').where({ id: batchId1 }).update({
      mill_id: millId1,
      machine_line: 'Line A',
      shift: 'Morning',
      moisture_loss_pct: 1.40,
      processing_hours: 8.50,
      operator_name: 'Saleem Ahmed',
      post_milling_grade: 'Premium Grade A',
    });
  }

  if (batchId2) {
    await knex('milling_batches').where({ id: batchId2 }).update({
      mill_id: millId1,
      machine_line: 'Line B',
      shift: 'Afternoon',
      moisture_loss_pct: 0.90,
      processing_hours: 12.00,
      operator_name: 'Faisal Khan',
      post_milling_grade: 'Grade A',
    });
  }
};
