/**
 * Migration 123 — expense_vendors lookup table.
 *
 * Replaces the hardcoded VENDOR_OPTIONS map in
 * src/modules/milling/pages/MillFinanceDashboard.jsx with a DB-backed
 * lookup so non-technical users can manage providers from the Admin
 * UI without a deploy.
 *
 * Seeds the same 60-odd Pakistani providers that were previously
 * hardcoded — utilities, fuel, insurance, transport, maintenance,
 * packaging, rent, inspection, freight, commission.
 *
 * Idempotent: skips the table create if it already exists, and uses
 * ON CONFLICT DO NOTHING for the seed.
 */

const SEED = [
  // utilities
  ['utilities', 'K-Electric', 1],
  ['utilities', 'WAPDA / LESCO', 2],
  ['utilities', 'IESCO', 3],
  ['utilities', 'PESCO', 4],
  ['utilities', 'GEPCO', 5],
  ['utilities', 'HESCO', 6],
  ['utilities', 'MEPCO', 7],
  ['utilities', 'SSGC (Sui Southern Gas)', 8],
  ['utilities', 'SNGPL (Sui Northern Gas)', 9],
  ['utilities', 'PTCL', 10],
  ['utilities', 'Karachi Water Board', 11],
  ['utilities', 'WASA', 12],

  // fuel
  ['fuel', 'PSO', 1],
  ['fuel', 'Shell', 2],
  ['fuel', 'Hascol', 3],
  ['fuel', 'Total PARCO', 4],
  ['fuel', 'GO Petroleum', 5],
  ['fuel', 'Attock Petroleum', 6],

  // insurance
  ['insurance', 'EFU General', 1],
  ['insurance', 'Adamjee Insurance', 2],
  ['insurance', 'Jubilee Insurance', 3],
  ['insurance', 'TPL Insurance', 4],
  ['insurance', 'UBL Insurers', 5],
  ['insurance', 'State Life', 6],

  // transport
  ['transport', 'NLC', 1],
  ['transport', 'TCS Logistics', 2],
  ['transport', 'Daewoo Logistics', 3],
  ['transport', 'M&P (Muller & Phipps)', 4],
  ['transport', 'Local Transporter', 5],

  // maintenance
  ['maintenance', 'Hexa Engineering', 1],
  ['maintenance', 'Buhler Pakistan', 2],
  ['maintenance', 'Satake (Rice Machinery)', 3],
  ['maintenance', 'AGI Industries', 4],
  ['maintenance', 'Pak Service Center', 5],
  ['maintenance', 'Local Workshop / Mechanic', 6],
  ['maintenance', 'Local Electrician', 7],
  ['maintenance', 'Spare Parts Supplier', 8],

  // packaging
  ['packaging', 'Forsa Bags', 1],
  ['packaging', 'Lucky Plastic', 2],
  ['packaging', 'Treet PP Bags', 3],
  ['packaging', 'Hi-Tech Packaging', 4],
  ['packaging', 'Packages Limited', 5],
  ['packaging', 'Premier Industries', 6],
  ['packaging', 'Jute Bag Supplier', 7],
  ['packaging', 'Master Bag Printer', 8],

  // rent
  ['rent', 'Mill Property Landlord', 1],
  ['rent', 'Warehouse Landlord', 2],
  ['rent', 'Office Landlord', 3],
  ['rent', 'Land Lease', 4],

  // inspection
  ['inspection', 'SGS Pakistan', 1],
  ['inspection', 'Bureau Veritas', 2],
  ['inspection', 'Intertek', 3],
  ['inspection', 'Cotecna', 4],
  ['inspection', 'TUV Austria Pakistan', 5],
  ['inspection', 'PSQCA (Pak Standards & Quality Control)', 6],
  ['inspection', 'DPP (Department of Plant Protection)', 7],
  ['inspection', 'Pakistan Customs', 8],

  // freight
  ['freight', 'Maersk Line', 1],
  ['freight', 'MSC', 2],
  ['freight', 'Hapag-Lloyd', 3],
  ['freight', 'CMA CGM', 4],
  ['freight', 'COSCO Shipping', 5],
  ['freight', 'Evergreen', 6],
  ['freight', 'ONE (Ocean Network Express)', 7],
  ['freight', 'Hyundai Merchant Marine', 8],
  ['freight', 'NLC (National Logistics)', 9],
  ['freight', 'Local Freight Forwarder', 10],

  // commission
  ['commission', 'Sales Agent', 1],
  ['commission', "Buyer's Agent (Foreign)", 2],
  ['commission', 'Export Broker', 3],
  ['commission', 'Customs Clearing Agent', 4],
  ['commission', 'Shipping Agent', 5],
  ['commission', 'Marketing Consultant', 6],
];

exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('expense_vendors');
  if (!exists) {
    await knex.schema.createTable('expense_vendors', (t) => {
      t.increments('id').primary();
      t.string('category', 50).notNullable();
      t.string('name', 200).notNullable();
      t.integer('sort_order').notNullable().defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamps(true, true);
      t.unique(['category', 'name']);
      t.index('category');
    });
  }

  for (const [category, name, sort_order] of SEED) {
    await knex.raw(
      `INSERT INTO expense_vendors (category, name, sort_order, is_active)
       VALUES (?, ?, ?, true)
       ON CONFLICT (category, name) DO NOTHING`,
      [category, name, sort_order]
    );
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('expense_vendors');
};
