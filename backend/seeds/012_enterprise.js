/**
 * Seed: Enterprise Polish & Scale (Phase 10)
 * API Integrations, System Health, User Preferences, Sample Jobs, Sync Logs
 */

exports.seed = async function (knex) {
  // Clear in reverse-dependency order
  await knex('api_sync_log').del();
  await knex('data_imports').del();
  await knex('background_jobs').del();
  await knex('system_health').del();
  await knex('user_preferences').del();
  await knex('api_integrations').del();

  // ============================================================
  // 1. API Integration — AgriCRM
  // ============================================================
  const [crmIntegration] = await knex('api_integrations')
    .insert({
      name: 'agri_crm',
      base_url: 'http://149.102.138.252/api',
      auth_type: 'bearer',
      auth_credentials: JSON.stringify({ token: '' }),
      is_active: true,
      sync_frequency: 'daily',
      config: JSON.stringify({
        entities: ['customers', 'suppliers', 'products', 'bank_accounts'],
        sync_direction: 'inbound',
      }),
    })
    .returning('id');

  const integrationId = crmIntegration.id || crmIntegration;

  // ============================================================
  // 2. System Health Records (3 checks)
  // ============================================================
  await knex('system_health').insert([
    {
      check_type: 'database',
      status: 'Healthy',
      value: '12ms',
      threshold: '<100ms Healthy, <500ms Warning',
      details: JSON.stringify({ responseTimeMs: 12 }),
    },
    {
      check_type: 'disk',
      status: 'Healthy',
      value: '34% used',
      threshold: '<80% Healthy, <90% Warning',
      details: JSON.stringify({ usedPercent: 34 }),
    },
    {
      check_type: 'memory',
      status: 'Healthy',
      value: '45% heap used',
      threshold: '<80% Healthy, <90% Warning',
      details: JSON.stringify({ heapUsedPercent: 45 }),
    },
  ]);

  // ============================================================
  // 3. Default User Preferences for admin (user_id = 1)
  // ============================================================
  await knex('user_preferences').insert({
    user_id: 1,
    language: 'en',
    timezone: 'Asia/Karachi',
    date_format: 'DD/MM/YYYY',
    number_format: 'en-PK',
    currency_display: 'symbol',
    dashboard_layout: JSON.stringify({
      widgets: ['order_pipeline', 'revenue_chart', 'pending_tasks', 'recent_activity'],
      columns: 2,
    }),
    notifications_email: true,
    notifications_push: true,
    notifications_sms: false,
    theme: 'light',
  });

  // ============================================================
  // 4. Sample Background Jobs (2)
  // ============================================================
  const [importJob] = await knex('background_jobs')
    .insert({
      job_type: 'import',
      name: 'Import Customers — Jan 2026',
      status: 'Completed',
      progress: 100,
      total_items: 50,
      processed_items: 48,
      failed_items: 2,
      input_data: JSON.stringify({ import_type: 'customers', file_name: 'customers_jan2026.csv' }),
      result_data: JSON.stringify({ imported: 48, failed: 2, totalErrors: 2 }),
      started_at: new Date('2026-01-15T08:00:00Z'),
      completed_at: new Date('2026-01-15T08:02:30Z'),
      created_by: 1,
    })
    .returning('id');

  await knex('background_jobs').insert({
    job_type: 'sync',
    name: 'CRM Sync — agri_crm',
    status: 'Completed',
    progress: 100,
    total_items: 120,
    processed_items: 118,
    failed_items: 2,
    input_data: JSON.stringify({ integrationId }),
    result_data: JSON.stringify({ totalSynced: 118, totalFailed: 2 }),
    started_at: new Date('2026-02-01T06:00:00Z'),
    completed_at: new Date('2026-02-01T06:05:00Z'),
    created_by: 1,
  });

  // ============================================================
  // 5. Sample Sync Log Entries (2)
  // ============================================================
  await knex('api_sync_log').insert([
    {
      integration_id: integrationId,
      direction: 'inbound',
      entity_type: 'customers',
      records_synced: 45,
      records_failed: 0,
      status: 'Success',
      details: JSON.stringify({ source: 'agri_crm', newRecords: 5, updatedRecords: 40 }),
      started_at: new Date('2026-02-01T06:00:00Z'),
      completed_at: new Date('2026-02-01T06:01:30Z'),
    },
    {
      integration_id: integrationId,
      direction: 'inbound',
      entity_type: 'suppliers',
      records_synced: 30,
      records_failed: 2,
      status: 'Partial',
      details: JSON.stringify({ source: 'agri_crm', newRecords: 2, updatedRecords: 28, errors: ['Duplicate supplier name'] }),
      started_at: new Date('2026-02-01T06:01:30Z'),
      completed_at: new Date('2026-02-01T06:03:00Z'),
    },
  ]);
};
