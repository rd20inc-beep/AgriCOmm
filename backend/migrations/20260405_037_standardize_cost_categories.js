/**
 * Standardize milling cost category names.
 * Migrate all 'rawRice' to 'raw_rice' (snake_case canonical).
 */
exports.up = async function (knex) {
  await knex('milling_costs').where('category', 'rawRice').update({ category: 'raw_rice' });
};

exports.down = async function () {
  // No rollback — both formats were previously accepted
};
