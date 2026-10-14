/**
 * Scheduler reliability + recurring-expense series end (P2-27).
 *
 * scheduled_tasks
 *   failure_count  consecutive failed attempts at the current slot; the task is
 *                  retried on the next tick until MAX_ATTEMPTS, then reported
 *                  and moved to its next calendar slot
 *   last_error     the last failure's message (shown with the task)
 *   last_status    + 'Skipped' (a task that has nothing to do — e.g. the report
 *                  placeholder — used to be marked 'Success')
 *
 * business_expenses.recurrence_end_date — the last date a recurring series may
 *   post an occurrence. Stopping a series sets it on every row of the series;
 *   nothing past it is ever materialized.
 */

const STATUSES = ['Running', 'Success', 'Failed'];
const list = (vals) => vals.map((v) => `'${v}'`).join(', ');

async function setCheck(knex, vals) {
  await knex.raw('ALTER TABLE scheduled_tasks DROP CONSTRAINT IF EXISTS scheduled_tasks_last_status_check');
  await knex.raw(`ALTER TABLE scheduled_tasks ADD CONSTRAINT scheduled_tasks_last_status_check CHECK ((last_status IS NULL) OR (last_status IN (${list(vals)})))`);
}

exports.up = async (knex) => {
  if (!(await knex.schema.hasColumn('scheduled_tasks', 'failure_count'))) {
    await knex.schema.alterTable('scheduled_tasks', (t) => t.integer('failure_count').notNullable().defaultTo(0));
  }
  if (!(await knex.schema.hasColumn('scheduled_tasks', 'last_error'))) {
    await knex.schema.alterTable('scheduled_tasks', (t) => t.text('last_error').nullable());
  }
  await setCheck(knex, [...STATUSES, 'Skipped']);
  if (!(await knex.schema.hasColumn('business_expenses', 'recurrence_end_date'))) {
    await knex.schema.alterTable('business_expenses', (t) => t.date('recurrence_end_date').nullable());
  }
};

exports.down = async (knex) => {
  await knex('scheduled_tasks').where('last_status', 'Skipped').update({ last_status: 'Success' });
  await setCheck(knex, STATUSES);
  for (const name of ['failure_count', 'last_error']) {
    if (await knex.schema.hasColumn('scheduled_tasks', name)) {
      await knex.schema.alterTable('scheduled_tasks', (t) => t.dropColumn(name));
    }
  }
  if (await knex.schema.hasColumn('business_expenses', 'recurrence_end_date')) {
    await knex.schema.alterTable('business_expenses', (t) => t.dropColumn('recurrence_end_date'));
  }
};
