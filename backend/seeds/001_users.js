/**
 * Seed: Users
 */
const bcrypt = require('bcryptjs');

exports.seed = async function (knex) {
  // Clear users (roles are seeded in migration, don't touch them)
  await knex('users').del();

  const commonHash = bcrypt.hashSync('Agri@8234924', 10);

  await knex('users').insert([
    {
      email: 'admin@riceflow.com',
      password_hash: commonHash,
      full_name: 'Admin User',
      role_id: 1, // Super Admin
      is_active: true,
    },
    {
      email: 'akmal@agririce.com',
      password_hash: commonHash,
      full_name: 'Akmal Amin',
      role_id: 2, // Export Manager
      is_active: true,
    },
    {
      email: 'finance@agririce.com',
      password_hash: commonHash,
      full_name: 'Finance Team',
      role_id: 3, // Finance Manager
      is_active: true,
    },
    {
      email: 'mill@agririce.com',
      password_hash: commonHash,
      full_name: 'Mill Manager',
      role_id: 4, // Mill Manager
      is_active: true,
    },
    {
      email: 'qc@agririce.com',
      password_hash: commonHash,
      full_name: 'QC Analyst',
      role_id: 5, // QC Analyst
      is_active: true,
    },
    {
      email: 'docs@agririce.com',
      password_hash: commonHash,
      full_name: 'Doc Officer',
      role_id: 7, // Documentation Officer
      is_active: true,
    },
  ]);
};
