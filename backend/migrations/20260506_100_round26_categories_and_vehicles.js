/**
 * Round-26 schema refinement.
 *
 * After round 25 added product_categories + the kg-canonical raw paddy
 * entry, two new shapes need locking:
 *
 *   1. product_categories: is_active was nullable, no UNIQUE on
 *      (parent_id, name) so duplicate siblings are possible, no guard
 *      against self-referential parent_id.
 *
 *   2. milling_vehicle_arrivals: batch_id was nullable (a vehicle
 *      arrival without a batch is meaningless) and there's no sanity
 *      check on weight_mt / total_bags / bag_size_kg being negative.
 *
 * Idempotent — every NOT NULL re-checks zero NULLs after backfill,
 * every UNIQUE / CHECK guards on existence.
 */

async function constraintExists(knex, name) {
  const r = await knex.raw(
    "SELECT 1 FROM pg_constraint WHERE conname = ?",
    [name]
  );
  return r.rowCount > 0;
}

async function indexExists(knex, name) {
  const r = await knex.raw(
    "SELECT 1 FROM pg_indexes WHERE indexname = ?",
    [name]
  );
  return r.rowCount > 0;
}

exports.up = async function (knex) {
  // ── product_categories ───────────────────────────────────
  if (await knex.schema.hasTable('product_categories')) {
    // is_active default + NOT NULL
    await knex.raw(`UPDATE product_categories SET is_active = true WHERE is_active IS NULL`);
    await knex.raw(`ALTER TABLE product_categories ALTER COLUMN is_active SET DEFAULT true`);
    const nul = await knex('product_categories').whereNull('is_active').count('* as n');
    if (parseInt(nul[0].n, 10) === 0) {
      await knex.raw(`ALTER TABLE product_categories ALTER COLUMN is_active SET NOT NULL`);
    }

    // Unique (parent_id, name) — siblings (or top-level peers) can't share a name.
    // Use a partial unique index so multiple top-level rows with NULL parent_id
    // still work in Postgres (NULL is not equal to NULL by default; we want them
    // unique by name even at top level).
    if (!(await indexExists(knex, 'product_categories_parent_name_uidx'))) {
      // Detect duplicates first; if any exist, log and skip the unique index
      const dupes = await knex.raw(`
        SELECT COALESCE(parent_id::text, '__root__') AS scope, name, COUNT(*) AS c
        FROM product_categories
        GROUP BY 1, 2
        HAVING COUNT(*) > 1
      `);
      if (dupes.rows.length === 0) {
        await knex.raw(`
          CREATE UNIQUE INDEX product_categories_parent_name_uidx
          ON product_categories (COALESCE(parent_id, 0), LOWER(name))
        `);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[round26] product_categories has ${dupes.rows.length} duplicate name groups — skipping unique index. Resolve manually then re-run.`);
      }
    }

    // Self-reference guard
    if (!(await constraintExists(knex, 'product_categories_no_self_parent_chk'))) {
      // Backfill: any rows where parent_id = id get parent set to NULL
      await knex.raw(`UPDATE product_categories SET parent_id = NULL WHERE parent_id = id`);
      await knex.raw(`
        ALTER TABLE product_categories
        ADD CONSTRAINT product_categories_no_self_parent_chk
        CHECK (parent_id IS NULL OR parent_id <> id)
      `);
    }
  }

  // ── milling_vehicle_arrivals ─────────────────────────────
  if (await knex.schema.hasTable('milling_vehicle_arrivals')) {
    // batch_id NOT NULL — orphan rows can't be reasoned about
    const orphans = await knex('milling_vehicle_arrivals').whereNull('batch_id').count('* as n');
    if (parseInt(orphans[0].n, 10) === 0) {
      await knex.raw(`ALTER TABLE milling_vehicle_arrivals ALTER COLUMN batch_id SET NOT NULL`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[round26] ${orphans[0].n} orphan milling_vehicle_arrivals rows; skip NOT NULL on batch_id.`);
    }

    // Sanity CHECKs — weight_mt, total_bags, bag_size_kg cannot be negative
    if (!(await constraintExists(knex, 'milling_vehicle_arrivals_weight_nonneg_chk'))) {
      await knex.raw(`UPDATE milling_vehicle_arrivals SET weight_mt = 0 WHERE weight_mt < 0`);
      await knex.raw(`
        ALTER TABLE milling_vehicle_arrivals
        ADD CONSTRAINT milling_vehicle_arrivals_weight_nonneg_chk
        CHECK (weight_mt IS NULL OR weight_mt >= 0)
      `);
    }
    if (!(await constraintExists(knex, 'milling_vehicle_arrivals_bags_nonneg_chk'))) {
      await knex.raw(`UPDATE milling_vehicle_arrivals SET total_bags = 0 WHERE total_bags < 0`);
      await knex.raw(`
        ALTER TABLE milling_vehicle_arrivals
        ADD CONSTRAINT milling_vehicle_arrivals_bags_nonneg_chk
        CHECK (total_bags IS NULL OR total_bags >= 0)
      `);
    }
    if (!(await constraintExists(knex, 'milling_vehicle_arrivals_bagsize_pos_chk'))) {
      // bag_size_kg = 0 doesn't make sense (would imply infinity bags)
      await knex.raw(`UPDATE milling_vehicle_arrivals SET bag_size_kg = NULL WHERE bag_size_kg <= 0`);
      await knex.raw(`
        ALTER TABLE milling_vehicle_arrivals
        ADD CONSTRAINT milling_vehicle_arrivals_bagsize_pos_chk
        CHECK (bag_size_kg IS NULL OR bag_size_kg > 0)
      `);
    }
  }

  // ── products.category_id index already created in 099 ────
  // (no-op here; left as a comment marker)
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('product_categories')) {
    await knex.raw(`ALTER TABLE product_categories DROP CONSTRAINT IF EXISTS product_categories_no_self_parent_chk`);
    await knex.raw(`DROP INDEX IF EXISTS product_categories_parent_name_uidx`);
    await knex.raw(`ALTER TABLE product_categories ALTER COLUMN is_active DROP NOT NULL`);
    await knex.raw(`ALTER TABLE product_categories ALTER COLUMN is_active DROP DEFAULT`);
  }
  if (await knex.schema.hasTable('milling_vehicle_arrivals')) {
    await knex.raw(`ALTER TABLE milling_vehicle_arrivals DROP CONSTRAINT IF EXISTS milling_vehicle_arrivals_bagsize_pos_chk`);
    await knex.raw(`ALTER TABLE milling_vehicle_arrivals DROP CONSTRAINT IF EXISTS milling_vehicle_arrivals_bags_nonneg_chk`);
    await knex.raw(`ALTER TABLE milling_vehicle_arrivals DROP CONSTRAINT IF EXISTS milling_vehicle_arrivals_weight_nonneg_chk`);
    await knex.raw(`ALTER TABLE milling_vehicle_arrivals ALTER COLUMN batch_id DROP NOT NULL`);
  }
};
