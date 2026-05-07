/**
 * Round-27 schema refinement.
 *
 * Audit found:
 *   1. Boolean flags (is_active, archived, is_byproduct) on every
 *      master-data table still nullable despite having defaults — a
 *      future insert that forgets the column produces NULL, which
 *      breaks "WHERE is_active = true" filtering silently.
 *
 *   2. inventory_lots.unit and inventory_lots.net_weight_kg are
 *      nullable. Every lot has a unit (defaults to MT) and a weight,
 *      so lock both NOT NULL.
 *
 *   3. inventory_lots quantity columns (qty, available_qty,
 *      reserved_qty, net_weight_kg) had no CHECK against negatives —
 *      postMovement enforces it in code, but the DB should refuse
 *      garbage on direct writes.
 *
 *   4. inventory_movements.qty had no CHECK > 0; a zero-qty movement
 *      is meaningless and should be rejected at the row level.
 *
 *   5. inventory_lots.status was free-form text. Lock it to the known
 *      set so a typo doesn't silently hide stock.
 *
 * Idempotent — every NOT NULL re-checks zero NULLs after backfill,
 * every CHECK guards on existence.
 */

async function constraintExists(knex, name) {
  const r = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ?`, [name]);
  return r.rowCount > 0;
}

async function lockBooleanNotNull(knex, table, column, fallback = true) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  // DDL doesn't accept knex `?` bindings; identifiers/literals are interpolated.
  // table/column come from this file's own arguments — no SQLi surface.
  await knex(table).whereNull(column).update({ [column]: fallback });
  await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ${fallback ? 'true' : 'false'}`);
  const nul = await knex(table).whereNull(column).count('* as n');
  if (parseInt(nul[0].n, 10) === 0) {
    await knex.raw(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL`);
  }
}

exports.up = async function (knex) {
  // ── Master-data boolean flags ────────────────────────────
  await lockBooleanNotNull(knex, 'bag_types', 'is_active', true);
  await lockBooleanNotNull(knex, 'customers', 'is_active', true);
  await lockBooleanNotNull(knex, 'customers', 'archived', false);
  await lockBooleanNotNull(knex, 'document_templates', 'is_active', true);
  await lockBooleanNotNull(knex, 'products', 'is_active', true);
  await lockBooleanNotNull(knex, 'products', 'is_byproduct', false);
  await lockBooleanNotNull(knex, 'suppliers', 'is_active', true);
  await lockBooleanNotNull(knex, 'suppliers', 'archived', false);
  await lockBooleanNotNull(knex, 'users', 'is_active', true);
  await lockBooleanNotNull(knex, 'warehouses', 'is_active', true);

  // ── inventory_lots tightening ────────────────────────────
  if (await knex.schema.hasTable('inventory_lots')) {
    // unit: backfill 'MT' for nulls, default + NOT NULL
    if (await knex.schema.hasColumn('inventory_lots', 'unit')) {
      await knex.raw(`UPDATE inventory_lots SET unit = 'MT' WHERE unit IS NULL`);
      await knex.raw(`ALTER TABLE inventory_lots ALTER COLUMN unit SET DEFAULT 'MT'`);
      const nul = await knex('inventory_lots').whereNull('unit').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE inventory_lots ALTER COLUMN unit SET NOT NULL`);
      }
    }
    // net_weight_kg: backfill from qty * 1000 if null, then NOT NULL
    if (await knex.schema.hasColumn('inventory_lots', 'net_weight_kg')) {
      await knex.raw(`UPDATE inventory_lots SET net_weight_kg = COALESCE(qty, 0) * 1000 WHERE net_weight_kg IS NULL`);
      const nul = await knex('inventory_lots').whereNull('net_weight_kg').count('* as n');
      if (parseInt(nul[0].n, 10) === 0) {
        await knex.raw(`ALTER TABLE inventory_lots ALTER COLUMN net_weight_kg SET NOT NULL`);
      }
    }

    // CHECKs: qty / available / reserved / net weight ≥ 0
    if (!(await constraintExists(knex, 'inventory_lots_qty_nonneg_chk'))) {
      // Floor any negatives first; should be zero in healthy data
      await knex.raw(`UPDATE inventory_lots SET qty = 0 WHERE qty < 0`);
      await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_qty_nonneg_chk CHECK (qty >= 0)`);
    }
    if (!(await constraintExists(knex, 'inventory_lots_available_nonneg_chk'))) {
      await knex.raw(`UPDATE inventory_lots SET available_qty = 0 WHERE available_qty < 0`);
      await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_available_nonneg_chk CHECK (available_qty >= 0)`);
    }
    if (!(await constraintExists(knex, 'inventory_lots_reserved_nonneg_chk'))) {
      await knex.raw(`UPDATE inventory_lots SET reserved_qty = 0 WHERE reserved_qty < 0`);
      await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_reserved_nonneg_chk CHECK (reserved_qty >= 0)`);
    }
    if (!(await constraintExists(knex, 'inventory_lots_netweight_nonneg_chk'))) {
      await knex.raw(`UPDATE inventory_lots SET net_weight_kg = 0 WHERE net_weight_kg < 0`);
      await knex.raw(`ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_netweight_nonneg_chk CHECK (net_weight_kg >= 0)`);
    }

    // status whitelist — only add if all existing rows are in the allowed set
    if (!(await constraintExists(knex, 'inventory_lots_status_chk'))) {
      const allowed = ['Available', 'Reserved', 'Closed', 'Sold', 'Damaged', 'OnHold', 'On Hold'];
      const offenders = await knex('inventory_lots').whereNotIn('status', allowed).count('* as n');
      if (parseInt(offenders[0].n, 10) === 0) {
        await knex.raw(
          `ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_status_chk
           CHECK (status IN ('Available','Reserved','Closed','Sold','Damaged','OnHold','On Hold'))`
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[round27] inventory_lots has ${offenders[0].n} rows with unknown status; skipping status CHECK.`);
      }
    }
  }

  // ── inventory_movements.qty > 0 ──────────────────────────
  if (await knex.schema.hasTable('inventory_movements')) {
    if (!(await constraintExists(knex, 'inventory_movements_qty_pos_chk'))) {
      // Drop any zero/negative movements (they're noise)
      const bad = await knex('inventory_movements').where('qty', '<=', 0).count('* as n').first();
      if (parseInt(bad.n, 10) === 0) {
        await knex.raw(
          `ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_qty_pos_chk CHECK (qty > 0)`
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[round27] inventory_movements has ${bad.n} rows with qty <= 0; skipping CHECK.`);
      }
    }
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('inventory_movements')) {
    await knex.raw(`ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_qty_pos_chk`);
  }
  if (await knex.schema.hasTable('inventory_lots')) {
    for (const c of [
      'inventory_lots_status_chk',
      'inventory_lots_netweight_nonneg_chk',
      'inventory_lots_reserved_nonneg_chk',
      'inventory_lots_available_nonneg_chk',
      'inventory_lots_qty_nonneg_chk',
    ]) {
      await knex.raw(`ALTER TABLE inventory_lots DROP CONSTRAINT IF EXISTS ${c}`);
    }
    await knex.raw(`ALTER TABLE inventory_lots ALTER COLUMN net_weight_kg DROP NOT NULL`);
    await knex.raw(`ALTER TABLE inventory_lots ALTER COLUMN unit DROP NOT NULL`);
  }
  // Boolean flags — drop NOT NULL only (defaults stay so old code keeps working)
  for (const [tbl, col] of [
    ['bag_types', 'is_active'],
    ['customers', 'is_active'],
    ['customers', 'archived'],
    ['document_templates', 'is_active'],
    ['products', 'is_active'],
    ['products', 'is_byproduct'],
    ['suppliers', 'is_active'],
    ['suppliers', 'archived'],
    ['users', 'is_active'],
    ['warehouses', 'is_active'],
  ]) {
    if (await knex.schema.hasTable(tbl) && await knex.schema.hasColumn(tbl, col)) {
      await knex.raw(`ALTER TABLE "${tbl}" ALTER COLUMN "${col}" DROP NOT NULL`);
    }
  }
};
