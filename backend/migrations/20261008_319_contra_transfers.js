/**
 * Contra transfers — money moved between the company's OWN accounts (owner
 * decision 2026-10-08). Built on fund_transfers, no parallel table:
 *
 *   direction 'internal'  both accounts belong to the same entity. Settles at
 *                         once (status 'completed', no accept step) and posts
 *                         NO journal for the transfer itself: every cash/bank
 *                         account sits on GL 1000, so Dr 1000 / Cr 1000 is noise.
 *   ho_to_mill/mill_to_ho unchanged (send → accept, inter-company 1130 journals).
 *
 * fund_transfers gains:
 *   to_amount, to_currency       what the DESTINATION account received, in its
 *                                own currency (= amount/currency when the two
 *                                accounts share a currency)
 *   fx_rate, rate_basis,         PKR per 1 unit of the foreign side, the
 *   rate_date                    human-readable basis and the rate's date
 *   amount_pkr                   PKR equivalent of the transfer
 *   bank_charges                 fee taken from the SOURCE account, in the
 *                                source currency (Dr 6200 / Cr 1000)
 *   fx_unbooked                  true for a cross-currency transfer: no FX
 *                                gain/loss journal is posted — flagged for review
 *   attachment_url/_name         supporting document
 *   client_ref (uuid, unique)    duplicate-submission guard
 *   replaces_id / replaced_by_id an edit = reverse the original + create the
 *                                corrected transfer; the two are linked
 *   reversed_by/_at, reversal_reason, updated_by   audit
 *
 * bank_transactions gains fund_transfer_id → fund_transfers(id), so both legs
 * (and any bank-charge row) link to their transfer by id rather than by the
 * reference string. Existing fund-transfer rows are backfilled by
 * (source 'fund_transfer', reference = transfer_no).
 *
 * direction gets a CHECK {ho_to_mill, mill_to_ho, internal} — the only values
 * the code has ever written. up() refuses (with the offending values) rather
 * than fail obscurely if anything else is present.
 *
 * Idempotent.
 */

const FT = 'fund_transfers';
const BT = 'bank_transactions';
const DIRECTION_CHECK = 'chk_fund_transfers_direction_valid';
const DIRECTIONS = ['ho_to_mill', 'mill_to_ho', 'internal'];

const FT_COLS = [
  ['to_amount', (t) => t.decimal('to_amount', 18, 2).nullable()],
  ['to_currency', (t) => t.string('to_currency', 3).nullable()],
  ['fx_rate', (t) => t.decimal('fx_rate', 18, 6).nullable()],
  ['rate_basis', (t) => t.string('rate_basis', 255).nullable()],
  ['rate_date', (t) => t.date('rate_date').nullable()],
  ['amount_pkr', (t) => t.decimal('amount_pkr', 18, 2).nullable()],
  ['bank_charges', (t) => t.decimal('bank_charges', 18, 2).notNullable().defaultTo(0)],
  ['fx_unbooked', (t) => t.boolean('fx_unbooked').notNullable().defaultTo(false)],
  ['attachment_url', (t) => t.text('attachment_url').nullable()],
  ['attachment_name', (t) => t.text('attachment_name').nullable()],
  ['client_ref', (t) => t.uuid('client_ref').nullable().unique()],
  ['replaces_id', (t) => t.integer('replaces_id').unsigned().nullable().references('id').inTable(FT).onDelete('SET NULL').index()],
  ['replaced_by_id', (t) => t.integer('replaced_by_id').unsigned().nullable().references('id').inTable(FT).onDelete('SET NULL').index()],
  ['reversed_by', (t) => t.integer('reversed_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL').index()],
  ['reversed_at', (t) => t.timestamp('reversed_at', { useTz: true }).nullable()],
  ['reversal_reason', (t) => t.text('reversal_reason').nullable()],
  ['updated_by', (t) => t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL').index()],
];

exports.DIRECTIONS = DIRECTIONS;

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(FT))) return;

  for (const [name, add] of FT_COLS) {
    if (!(await knex.schema.hasColumn(FT, name))) {
      await knex.schema.alterTable(FT, (t) => add(t));
    }
  }

  // Backfill the destination side of every existing transfer: they were all
  // PKR → PKR, so the receiver got exactly what was sent.
  await knex.raw(`UPDATE "${FT}" SET to_amount = amount, to_currency = COALESCE(currency, 'PKR'), amount_pkr = amount WHERE to_amount IS NULL`);

  if (await knex.schema.hasTable(BT) && !(await knex.schema.hasColumn(BT, 'fund_transfer_id'))) {
    await knex.schema.alterTable(BT, (t) => {
      t.integer('fund_transfer_id').unsigned().nullable().references('id').inTable(FT).onDelete('SET NULL').index();
    });
    await knex.raw(`
      UPDATE "${BT}" bt SET fund_transfer_id = ft.id
        FROM "${FT}" ft
       WHERE bt.source = 'fund_transfer' AND bt.reference = ft.transfer_no AND bt.fund_transfer_id IS NULL`);
  }

  const bad = await knex(FT).whereNotIn('direction', DIRECTIONS).distinct('direction').pluck('direction');
  if (bad.length) {
    throw new Error(`Migration 319: fund_transfers has unexpected direction value(s) ${bad.join(', ')} — normalise them before adding the direction CHECK.`);
  }
  await knex.raw(`ALTER TABLE "${FT}" DROP CONSTRAINT IF EXISTS "${DIRECTION_CHECK}"`);
  const list = DIRECTIONS.map((v) => `'${v}'`).join(', ');
  await knex.raw(`ALTER TABLE "${FT}" ADD CONSTRAINT "${DIRECTION_CHECK}" CHECK ("direction" IN (${list}))`);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable(FT))) return;
  const row = await knex(FT).where({ direction: 'internal' }).count('* as n').first();
  const n = Number(row && row.n) || 0;
  if (n > 0) {
    throw new Error(`Cannot roll back migration 319: ${n} internal (contra) transfer(s) exist. Their bank rows are real history; resolve them first.`);
  }
  await knex.raw(`ALTER TABLE "${FT}" DROP CONSTRAINT IF EXISTS "${DIRECTION_CHECK}"`);
  if (await knex.schema.hasColumn(BT, 'fund_transfer_id')) {
    await knex.schema.alterTable(BT, (t) => t.dropColumn('fund_transfer_id'));
  }
  for (const [name] of [...FT_COLS].reverse()) {
    if (await knex.schema.hasColumn(FT, name)) {
      await knex.schema.alterTable(FT, (t) => t.dropColumn(name));
    }
  }
};
