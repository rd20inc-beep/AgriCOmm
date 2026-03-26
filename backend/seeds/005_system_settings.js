/**
 * Seed: System Settings
 */

exports.seed = async function (knex) {
  await knex('system_settings').del();

  await knex('system_settings').insert([
    { key: 'quality_threshold', value: '1.0', category: 'quality' },
    { key: 'default_advance_pct', value: '20', category: 'finance' },
    { key: 'default_currency', value: 'USD', category: 'finance' },
    { key: 'mill_currency', value: 'PKR', category: 'finance' },
    { key: 'pkr_rate', value: '280', category: 'finance' },
    { key: 'payment_reminder_days', value: '7', category: 'finance' },
    { key: 'low_margin_threshold', value: '5', category: 'finance' },
    { key: 'smtp_host', value: 'smtp.gmail.com', category: 'email' },
    { key: 'smtp_port', value: '587', category: 'email' },
    { key: 'smtp_user', value: 'info@agririce.com', category: 'email' },
    { key: 'smtp_sender_name', value: 'AGRI COMMODITIES', category: 'email' },
    { key: 'smtp_sender_email', value: 'info@agririce.com', category: 'email' },
  ]);
};
