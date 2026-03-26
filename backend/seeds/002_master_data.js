/**
 * Seed: Master Data (customers, suppliers, products, bag_types, warehouses, bank_accounts)
 */
const path = require('path');

exports.seed = async function (knex) {
  // Clear with cascade to handle foreign key dependencies
  await knex.raw('TRUNCATE TABLE bank_accounts, warehouses, bag_types, products, suppliers, customers RESTART IDENTITY CASCADE');

  // ---------- CUSTOMERS (first 50 from CRM) ----------
  const crmCustomers = require(path.resolve(__dirname, '../data/crmCustomers.json'));
  const customers50 = crmCustomers.slice(0, 50).map((c) => ({
    name: c.name,
    contact_person: c.contact || null,
    email: c.email || null,
    phone: c.phone || null,
    country: c.country || null,
    address: c.address || null,
  }));
  await knex('customers').insert(customers50);

  // ---------- SUPPLIERS (all 168) ----------
  const crmSuppliers = require(path.resolve(__dirname, '../data/crmSuppliers.json'));
  const suppliers = crmSuppliers.map((s) => ({
    name: s.name,
    contact_person: s.contact || null,
    email: s.email || null,
    phone: s.phone || null,
    country: s.country || null,
    address: s.address || null,
    type: s.type || 'Paddy Supplier',
  }));
  // Insert in batches to avoid parameter limit
  const BATCH = 50;
  for (let i = 0; i < suppliers.length; i += BATCH) {
    await knex('suppliers').insert(suppliers.slice(i, i + BATCH));
  }

  // ---------- PRODUCTS (all 35) ----------
  const crmProducts = require(path.resolve(__dirname, '../data/crmProducts.json'));
  const products = crmProducts.map((p) => ({
    name: p.name,
    code: p.code || null,
    grade: p.grade || null,
    category: p.category || 'Rice',
    description: p.description || null,
    is_byproduct: !!p.isByproduct,
  }));
  await knex('products').insert(products);

  // ---------- BAG TYPES (all 18) ----------
  const crmBagTypes = require(path.resolve(__dirname, '../data/crmBagTypes.json'));
  const bagTypes = crmBagTypes.map((b) => ({
    name: b.name,
    category: b.category || null,
    size_kg: b.sizeKg != null ? b.sizeKg : null,
    material: b.material || null,
    description: b.description || null,
    unit: b.unit || 'pcs',
    reorder_level: b.reorderLevel || 0,
  }));
  await knex('bag_types').insert(bagTypes);

  // ---------- WAREHOUSES ----------
  await knex('warehouses').insert([
    { name: 'Mill Raw Stock', entity: 'mill', type: 'raw' },
    { name: 'Mill Finished Goods', entity: 'mill', type: 'finished' },
    { name: 'Mill By-Products', entity: 'mill', type: 'byproduct' },
    { name: 'Export Dispatch', entity: 'export', type: 'finished' },
    { name: 'Port Staging', entity: 'export', type: 'transit' },
  ]);

  // ---------- BANK ACCOUNTS (all 15) ----------
  const crmBankAccounts = require(path.resolve(__dirname, '../data/crmBankAccounts.json'));
  const bankAccounts = crmBankAccounts.map((a) => ({
    uid: a.uid,
    name: a.name,
    type: a.type || 'bank',
    account_number: a.accountNumber || null,
    bank_name: a.bankName || null,
    branch: a.branch || null,
    currency: a.currency || 'PKR',
    current_balance: a.currentBalance != null ? a.currentBalance : 0,
  }));
  await knex('bank_accounts').insert(bankAccounts);
};
