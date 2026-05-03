/**
 * Round-16 schema refinement.
 *
 * Newly admin-managed tables (mills via round 15, document_templates
 * via round 15) lack a UNIQUE constraint that prevents accidental
 * duplicate entries from the new admin UIs. bag_types was in the same
 * boat from earlier rounds.
 *
 * - document_templates(name, doc_type): two templates with the same
 *   name + doc type makes no sense; the renderer registry would pick
 *   one ambiguously.
 * - mills(name): the small-list dropdowns make duplicate names
 *   actively confusing. Mill names are natural keys in our trade.
 * - bag_types(name): same — duplicates surface as confusing dropdown
 *   entries on order create / inventory / mill stock.
 *
 * Customers, suppliers, bank_accounts, products, warehouses are
 * intentionally NOT covered: same name with a different address /
 * country / size variant is legitimate (multiple buyer offices,
 * supplier branches, product sizes etc).
 *
 * All three verified dupe-free in the live DB before adding.
 * Idempotent.
 */

exports.up = async function (knex) {
  // 1. document_templates(name, doc_type)
  if (await knex.schema.hasTable('document_templates')) {
    const dupe = await knex.raw(`
      SELECT 1 FROM document_templates
       GROUP BY name, doc_type HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_document_templates_name_type
          ON document_templates (name, doc_type)
      `);
    } else {
      console.warn('[088] Skipping document_templates UNIQUE — duplicates present.');
    }
  }

  // 2. mills(name)
  if (await knex.schema.hasTable('mills')) {
    const dupe = await knex.raw(`
      SELECT 1 FROM mills GROUP BY name HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_mills_name ON mills (name)
      `);
    } else {
      console.warn('[088] Skipping mills.name UNIQUE — duplicates present.');
    }
  }

  // 3. bag_types(name)
  if (await knex.schema.hasTable('bag_types')) {
    const dupe = await knex.raw(`
      SELECT 1 FROM bag_types GROUP BY name HAVING COUNT(*) > 1 LIMIT 1
    `);
    if (dupe.rows.length === 0) {
      await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_bag_types_name ON bag_types (name)
      `);
    } else {
      console.warn('[088] Skipping bag_types.name UNIQUE — duplicates present.');
    }
  }
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS uniq_document_templates_name_type`);
  await knex.raw(`DROP INDEX IF EXISTS uniq_mills_name`);
  await knex.raw(`DROP INDEX IF EXISTS uniq_bag_types_name`);
};
