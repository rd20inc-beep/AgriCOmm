/**
 * Attendance gains an 'off' status (weekly off / public holiday) so a supervisor
 * can mark Sundays and Pakistan federal holidays as non-working days distinctly
 * from absence. Widens the mill_attendance status whitelist CHECK (see
 * migration 140) to include 'off'.
 */
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE mill_attendance DROP CONSTRAINT IF EXISTS mill_attendance_status_check');
  await knex.raw(
    "ALTER TABLE mill_attendance ADD CONSTRAINT mill_attendance_status_check CHECK (status IS NULL OR status IN ('present', 'absent', 'half_day', 'leave', 'off'))"
  );
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE mill_attendance DROP CONSTRAINT IF EXISTS mill_attendance_status_check');
  await knex.raw(
    "ALTER TABLE mill_attendance ADD CONSTRAINT mill_attendance_status_check CHECK (status IS NULL OR status IN ('present', 'absent', 'half_day', 'leave'))"
  );
};
