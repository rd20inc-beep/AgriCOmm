// Service Milling — Phase A2: billing.
//
// After a service (toll) batch is milled we bill the client a SERVICE invoice
// (milling per-kg + rental per-katta + labour per-katta + extras − discount +
// tax) — separate from local/export SALES invoices (this is not a sale of rice).
// The invoice posts revenue to a dedicated Service Milling Revenue account and
// opens a receivable; payments settle it. Finance sees the invoice/receivable
// but not the milling internals.
//
// This migration adds: the invoices table, a receivables link column, COA 4050
// (Service Milling Revenue), the posting rule, and the invoice/payment perms.

const INV_STATUSES = ['Unpaid', 'Partial', 'Paid'];
const CNAME = 'chk_service_milling_invoices_payment_status_valid';

const PERMS = [
  { module: 'service_milling', action: 'view_invoice', description: 'View service-milling invoices and receivables (billing/payment)' },
  { module: 'service_milling', action: 'create_invoice', description: 'Create a service-milling invoice' },
  { module: 'service_milling', action: 'record_payment', description: 'Record a payment against a service-milling invoice' },
];
// Finance handles billing/collection; Owner/Mill Manager may also raise invoices.
// Finance gets ONLY invoice/payment perms — never service_milling.view (milling
// internals). (mig 250 already ran, so these grants persist.)
const GRANTS = {
  'Finance Manager': ['view_invoice', 'create_invoice', 'record_payment'],
  'Owner': ['view_invoice', 'create_invoice', 'record_payment'],
  'Mill Manager': ['view_invoice', 'create_invoice', 'record_payment'],
};

exports.up = async (knex) => {
  // 1. Invoices table (one row = one invoice).
  if (!(await knex.schema.hasTable('service_milling_invoices'))) {
    await knex.schema.createTable('service_milling_invoices', (t) => {
      t.increments('id').primary();
      t.string('invoice_no', 40).notNullable().unique();
      t.integer('service_batch_id').references('id').inTable('milling_batches');
      t.integer('client_customer_id').references('id').inTable('customers');
      t.date('invoice_date').notNullable().defaultTo(knex.fn.now());
      // Line inputs + computed amounts
      t.decimal('milling_qty_kg', 14, 3).defaultTo(0);
      t.decimal('milling_rate_per_kg', 14, 4).defaultTo(0);
      t.decimal('milling_amount', 16, 2).defaultTo(0);
      t.integer('rental_kattas').defaultTo(0);
      t.decimal('rental_rate_per_katta', 14, 4).defaultTo(0);
      t.decimal('rental_amount', 16, 2).defaultTo(0);
      t.integer('labour_kattas').defaultTo(0);
      t.decimal('labour_rate_per_katta', 14, 4).defaultTo(0);
      t.decimal('labour_amount', 16, 2).defaultTo(0);
      t.decimal('extra_charges', 16, 2).defaultTo(0);
      t.decimal('discount', 16, 2).defaultTo(0);
      t.decimal('tax_pct', 8, 4).defaultTo(0);
      t.decimal('tax_amount', 16, 2).defaultTo(0);
      t.decimal('subtotal', 16, 2).defaultTo(0);
      t.decimal('total_amount', 16, 2).defaultTo(0);
      t.decimal('received_amount', 16, 2).notNullable().defaultTo(0);
      t.decimal('balance_amount', 16, 2).notNullable().defaultTo(0);
      t.string('payment_status', 15).notNullable().defaultTo('Unpaid');
      t.text('notes');
      t.integer('created_by');
      t.timestamps(true, true);
      t.index('service_batch_id');
      t.index('client_customer_id');
      t.index('payment_status');
    });
    const list = INV_STATUSES.map((v) => `'${v}'`).join(', ');
    await knex.raw(`ALTER TABLE service_milling_invoices ADD CONSTRAINT ${CNAME} CHECK (payment_status IN (${list}))`);
  }

  // 2. Link receivables + payments → the service invoice (nullable FKs; sales
  //    rows keep them null).
  if (!(await knex.schema.hasColumn('receivables', 'service_invoice_id'))) {
    await knex.schema.alterTable('receivables', (t) => {
      t.integer('service_invoice_id').nullable().references('id').inTable('service_milling_invoices');
    });
  }
  if (!(await knex.schema.hasColumn('payments', 'service_invoice_id'))) {
    await knex.schema.alterTable('payments', (t) => {
      t.integer('service_invoice_id').nullable().references('id').inTable('service_milling_invoices');
    });
  }

  // 3. COA 4050 — Service Milling Revenue (only the SERVICE fee is revenue, never rice).
  const existing4050 = await knex('chart_of_accounts').where({ code: '4050' }).first('id');
  if (!existing4050) {
    const parent = await knex('chart_of_accounts').where({ code: '4000' }).first('id');
    await knex('chart_of_accounts').insert({
      code: '4050', name: 'Service Milling Revenue', type: 'Revenue', sub_type: 'Revenue',
      parent_id: parent ? parent.id : null, entity: 'mill', currency: 'PKR',
      is_system: false, normal_balance: 'credit',
      description: 'Toll/job-work milling service fees (milling + rental + labour).',
    });
  }

  // 4. Posting rule: DR 1120 Local AR / CR 4050 Service Milling Revenue.
  const ruleExists = await knex('posting_rules').where({ trigger_event: 'service_milling_invoice_recorded' }).first();
  if (!ruleExists) {
    const acc = async (code) => (await knex('chart_of_accounts').where({ code }).first('id'))?.id || null;
    const ar = await acc('1120');
    const rev = await acc('4050');
    if (ar && rev) {
      await knex('posting_rules').insert({
        rule_name: 'service_milling_invoice_recorded',
        trigger_event: 'service_milling_invoice_recorded',
        debit_account_id: ar,
        credit_account_id: rev,
        description: 'Service milling invoice (DR Local AR, CR Service Milling Revenue)',
        is_active: true,
      });
    }
  }

  // 5. Invoice/payment permissions + grants.
  for (const p of PERMS) {
    const has = await knex('permissions').where({ module: p.module, action: p.action }).first('id');
    if (!has) await knex('permissions').insert(p);
  }
  for (const [roleName, actions] of Object.entries(GRANTS)) {
    const role = await knex('roles').where('name', roleName).first('id');
    if (!role) continue;
    const permIds = (await knex('permissions').where('module', 'service_milling').whereIn('action', actions).select('id')).map((r) => r.id);
    for (const permId of permIds) {
      const g = await knex('role_permissions').where({ role_id: role.id, permission_id: permId }).first();
      if (!g) await knex('role_permissions').insert({ role_id: role.id, permission_id: permId });
    }
  }
};

exports.down = async (knex) => {
  await knex('posting_rules').where({ trigger_event: 'service_milling_invoice_recorded' }).del();
  const permIds = (await knex('permissions').where('module', 'service_milling').whereIn('action', ['view_invoice', 'create_invoice', 'record_payment']).select('id')).map((r) => r.id);
  if (permIds.length) {
    await knex('role_permissions').whereIn('permission_id', permIds).del();
    await knex('permissions').whereIn('id', permIds).del();
  }
  if (await knex.schema.hasColumn('payments', 'service_invoice_id')) {
    await knex.schema.alterTable('payments', (t) => t.dropColumn('service_invoice_id'));
  }
  if (await knex.schema.hasColumn('receivables', 'service_invoice_id')) {
    await knex.schema.alterTable('receivables', (t) => t.dropColumn('service_invoice_id'));
  }
  await knex.schema.dropTableIfExists('service_milling_invoices');
  await knex('chart_of_accounts').where({ code: '4050' }).del();
};
