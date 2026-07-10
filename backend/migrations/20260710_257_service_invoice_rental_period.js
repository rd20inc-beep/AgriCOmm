// Service Milling invoice — optional rental period (date range) for the rental
// service line. Rental is charged per katta/bag on an editable chargeable
// quantity; the client agreement may also scope it to a period, so capture the
// from/to dates on the invoice for the printed document.

exports.up = async (knex) => {
  const has = async (c) => knex.schema.hasColumn('service_milling_invoices', c);
  if (!(await has('rental_from'))) {
    await knex.schema.alterTable('service_milling_invoices', (t) => { t.date('rental_from'); });
  }
  if (!(await has('rental_to'))) {
    await knex.schema.alterTable('service_milling_invoices', (t) => { t.date('rental_to'); });
  }
};

exports.down = async (knex) => {
  const has = async (c) => knex.schema.hasColumn('service_milling_invoices', c);
  if (await has('rental_from')) await knex.schema.alterTable('service_milling_invoices', (t) => { t.dropColumn('rental_from'); });
  if (await has('rental_to')) await knex.schema.alterTable('service_milling_invoices', (t) => { t.dropColumn('rental_to'); });
};
