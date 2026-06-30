/**
 * Seed: Milling Batches (8 batches from mockData)
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex.raw('TRUNCATE TABLE milling_vehicle_arrivals, milling_costs, milling_quality_samples, milling_batches RESTART IDENTITY CASCADE');

  const adminUser = await knex('users').where('email', 'admin@riceflow.com').first();
  const adminId = adminUser ? adminUser.id : null;

  // Look up export order DB ids by order_no so we can link them
  const exportOrders = await knex('export_orders')
    .select('id', 'order_no')
    .whereIn('order_no', ['EX-101', 'EX-103', 'EX-106', 'EX-102', 'EX-105']);
  const eoMap = {};
  for (const eo of exportOrders) {
    eoMap[eo.order_no] = eo.id;
  }

  const batches = [
    {
      batch_no: 'M-201',
      linked_export_order_id: eoMap['EX-101'] || null,
      status: 'Completed',
      raw_qty_kg: 65000,
      planned_finished_kg: 50000,
      actual_finished_kg: 49200,
      broken_kg: 5800,
      bran_kg: 5200,
      husk_kg: 3500,
      wastage_kg: 1300,
      yield_pct: 75.7,
      supplier_id: 1,
      supplier_name: 'A.A Broker P.G Rice',
      created_at: '2026-01-18',
      completed_at: '2026-02-10',
      costs: { rawRice: 3640000, transport: 224000, electricity: 126000, rent: 56000, labor: 168000, maintenance: 42000 },
      sampleAnalysis: { moisture: 13.0, broken: 4.0, chalky: 1.0, foreign_matter: 0.5, discoloration: 0.3, purity: 95.0 },
      arrivalAnalysis: { moisture: 13.2, broken: 4.1, chalky: 1.0, foreign_matter: 0.6, discoloration: 0.3, purity: 94.8 },
    },
    {
      batch_no: 'M-202',
      linked_export_order_id: eoMap['EX-103'] || null,
      status: 'Completed',
      raw_qty_kg: 130000,
      planned_finished_kg: 100000,
      actual_finished_kg: 97500,
      broken_kg: 12500,
      bran_kg: 10400,
      husk_kg: 7200,
      wastage_kg: 2400,
      yield_pct: 75.0,
      supplier_id: 2,
      supplier_name: 'A.A Traders Rice',
      created_at: '2026-01-20',
      completed_at: '2026-02-20',
      costs: { rawRice: 6720000, transport: 420000, electricity: 252000, rent: 112000, labor: 336000, maintenance: 84000 },
      sampleAnalysis: { moisture: 12.8, broken: 5.0, chalky: 1.2, foreign_matter: 0.8, discoloration: 0.2, purity: 94.5 },
      arrivalAnalysis: { moisture: 13.0, broken: 5.2, chalky: 1.3, foreign_matter: 0.9, discoloration: 0.3, purity: 94.2 },
    },
    {
      batch_no: 'M-205',
      linked_export_order_id: eoMap['EX-106'] || null,
      status: 'Completed',
      raw_qty_kg: 98000,
      planned_finished_kg: 75000,
      actual_finished_kg: 73800,
      broken_kg: 9200,
      bran_kg: 7800,
      husk_kg: 5400,
      wastage_kg: 1800,
      yield_pct: 75.3,
      supplier_id: 3,
      supplier_name: 'A.R Traders Rice',
      created_at: '2026-02-10',
      completed_at: '2026-03-05',
      costs: { rawRice: 4620000, transport: 308000, electricity: 182000, rent: 84000, labor: 252000, maintenance: 56000 },
      sampleAnalysis: { moisture: 13.5, broken: 6.0, chalky: 1.5, foreign_matter: 0.7, discoloration: 0.4, purity: 93.5 },
      arrivalAnalysis: { moisture: 13.8, broken: 6.2, chalky: 1.6, foreign_matter: 0.8, discoloration: 0.5, purity: 93.2 },
    },
    {
      batch_no: 'M-209',
      linked_export_order_id: eoMap['EX-102'] || null,
      status: 'In Progress',
      raw_qty_kg: 33000,
      planned_finished_kg: 25000,
      actual_finished_kg: 18500,
      broken_kg: 2100,
      bran_kg: 1800,
      husk_kg: 1200,
      wastage_kg: 400,
      yield_pct: 72.7,
      supplier_id: 1,
      supplier_name: 'A.A Broker P.G Rice',
      created_at: '2026-02-08',
      completed_at: null,
      costs: { rawRice: 1820000, transport: 112000, electricity: 70000, rent: 28000, labor: 98000, maintenance: 22400 },
      sampleAnalysis: { moisture: 12.5, broken: 3.5, chalky: 0.8, foreign_matter: 0.4, discoloration: 0.2, purity: 95.5 },
      arrivalAnalysis: { moisture: 12.7, broken: 3.6, chalky: 0.9, foreign_matter: 0.5, discoloration: 0.2, purity: 95.3 },
    },
    {
      batch_no: 'M-210',
      linked_export_order_id: eoMap['EX-105'] || null,
      status: 'In Progress',
      raw_qty_kg: 52000,
      planned_finished_kg: 40000,
      actual_finished_kg: 12000,
      broken_kg: 1500,
      bran_kg: 1200,
      husk_kg: 800,
      wastage_kg: 300,
      yield_pct: 74.5,
      supplier_id: 2,
      supplier_name: 'A.A Traders Rice',
      created_at: '2026-03-02',
      completed_at: null,
      costs: { rawRice: 2912000, transport: 168000, electricity: 98000, rent: 42000, labor: 140000, maintenance: 28000 },
      sampleAnalysis: { moisture: 13.2, broken: 4.5, chalky: 1.0, foreign_matter: 0.6, discoloration: 0.3, purity: 94.8 },
      arrivalAnalysis: { moisture: 13.5, broken: 4.8, chalky: 1.1, foreign_matter: 0.7, discoloration: 0.3, purity: 94.5 },
    },
    {
      batch_no: 'M-215',
      linked_export_order_id: null,
      status: 'In Progress',
      raw_qty_kg: 40000,
      planned_finished_kg: 30000,
      actual_finished_kg: 8000,
      broken_kg: 1000,
      bran_kg: 800,
      husk_kg: 500,
      wastage_kg: 200,
      yield_pct: 73.5,
      supplier_id: 5,
      supplier_name: 'AKL Traders',
      created_at: '2026-03-08',
      completed_at: null,
      costs: { rawRice: 2016000, transport: 140000, electricity: 56000, rent: 28000, labor: 98000, maintenance: 22400 },
      sampleAnalysis: { moisture: 14.0, broken: 5.5, chalky: 1.5, foreign_matter: 1.0, discoloration: 0.5, purity: 93.0 },
      arrivalAnalysis: { moisture: 14.5, broken: 6.0, chalky: 1.8, foreign_matter: 1.3, discoloration: 0.6, purity: 92.5 },
    },
    {
      batch_no: 'M-220',
      linked_export_order_id: null,
      status: 'Pending Approval',
      raw_qty_kg: 45000,
      planned_finished_kg: 34000,
      actual_finished_kg: 0,
      broken_kg: 0,
      bran_kg: 0,
      husk_kg: 0,
      wastage_kg: 0,
      yield_pct: 0,
      supplier_id: 3,
      supplier_name: 'A.R Traders Rice',
      created_at: '2026-03-12',
      completed_at: null,
      costs: { rawRice: 2268000, transport: 154000, electricity: 0, rent: 0, labor: 0, maintenance: 0 },
      sampleAnalysis: { moisture: 13.0, broken: 4.0, chalky: 1.0, foreign_matter: 0.5, discoloration: 0.3, purity: 95.0 },
      arrivalAnalysis: { moisture: 14.2, broken: 5.3, chalky: 1.1, foreign_matter: 1.2, discoloration: 0.4, purity: 93.8 },
    },
    {
      batch_no: 'M-225',
      linked_export_order_id: null,
      status: 'Queued',
      raw_qty_kg: 55000,
      planned_finished_kg: 42000,
      actual_finished_kg: 0,
      broken_kg: 0,
      bran_kg: 0,
      husk_kg: 0,
      wastage_kg: 0,
      yield_pct: 0,
      supplier_id: 4,
      supplier_name: 'A.Sattar Allahi Bux Rice Trader',
      created_at: '2026-03-15',
      completed_at: null,
      costs: { rawRice: 2772000, transport: 168000, electricity: 0, rent: 0, labor: 0, maintenance: 0 },
      sampleAnalysis: { moisture: 12.8, broken: 3.8, chalky: 0.9, foreign_matter: 0.4, discoloration: 0.2, purity: 95.2 },
      arrivalAnalysis: null,
    },
  ];

  for (const batch of batches) {
    const { costs, sampleAnalysis, arrivalAnalysis, ...batchData } = batch;

    // Insert batch and get id
    const [inserted] = await knex('milling_batches')
      .insert(batchData)
      .returning('id');
    const batchId = typeof inserted === 'object' ? inserted.id : inserted;

    // Insert costs
    const costRows = Object.entries(costs).map(([category, amount]) => ({
      batch_id: batchId,
      category,
      amount,
      currency: 'PKR',
    }));
    if (costRows.length > 0) {
      await knex('milling_costs').insert(costRows);
    }

    // Insert sample quality analysis
    if (sampleAnalysis) {
      await knex('milling_quality_samples').insert({
        batch_id: batchId,
        analysis_type: 'sample',
        moisture: sampleAnalysis.moisture,
        broken: sampleAnalysis.broken,
        chalky: sampleAnalysis.chalky,
        foreign_matter: sampleAnalysis.foreign_matter,
        discoloration: sampleAnalysis.discoloration,
        purity: sampleAnalysis.purity,
      });
    }

    // Insert arrival quality analysis
    if (arrivalAnalysis) {
      await knex('milling_quality_samples').insert({
        batch_id: batchId,
        analysis_type: 'arrival',
        moisture: arrivalAnalysis.moisture,
        broken: arrivalAnalysis.broken,
        chalky: arrivalAnalysis.chalky,
        foreign_matter: arrivalAnalysis.foreign_matter,
        discoloration: arrivalAnalysis.discoloration,
        purity: arrivalAnalysis.purity,
      });
    }
  }
};
