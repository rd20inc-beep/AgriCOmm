/**
 * Mill payroll: workers and attendance tracking
 */
exports.up = function (knex) {
  return knex.schema
    .createTable('mill_workers', (table) => {
      table.increments('id').primary();
      table.integer('mill_id').unsigned().nullable().references('id').inTable('mills');
      table.string('name', 255).notNullable();
      table.string('role', 50).defaultTo('laborer'); // operator, laborer, supervisor, driver, guard
      table.decimal('daily_wage', 10, 2).notNullable();
      table.string('phone', 50).nullable();
      table.string('cnic', 20).nullable();
      table.date('joined_date').nullable();
      table.boolean('is_active').defaultTo(true);
      table.text('notes').nullable();
      table.timestamps(true, true);
    })
    .createTable('mill_attendance', (table) => {
      table.increments('id').primary();
      table.integer('worker_id').unsigned().notNullable().references('id').inTable('mill_workers').onDelete('CASCADE');
      table.date('date').notNullable();
      table.string('status', 20).defaultTo('present'); // present, absent, half_day, leave
      table.decimal('hours_worked', 5, 2).nullable();
      table.decimal('overtime_hours', 5, 2).nullable().defaultTo(0);
      table.decimal('overtime_rate', 10, 2).nullable();
      table.text('notes').nullable();
      table.timestamps(true, true);
      table.unique(['worker_id', 'date']);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('mill_attendance')
    .dropTableIfExists('mill_workers');
};
