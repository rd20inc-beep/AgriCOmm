/**
 * 4070 Freight & Insurance Recovered.
 *
 * When freight is charged beside an FOB price (freight_display = 'separate',
 * migration 302) the buyer owes it, so it has to be recognised — but it is not
 * a rice sale and must not land in 4010 Export Sales. Netting it there would
 * hide the only number that matters while freight is volatile: whether what is
 * charged to buyers is covering what is paid to carriers (6010 Freight &
 * Shipping). Side by side in the P&L, the gap is visible.
 *
 * Nothing posts here for a CFR/CIF order priced 'in_price' — that freight is
 * inside the contract value and is already in 4010, as it should be.
 */
exports.up = async (knex) => {
  const existing = await knex('chart_of_accounts').where({ code: '4070' }).first();
  if (existing) return;
  await knex('chart_of_accounts').insert({
    code: '4070',
    name: 'Freight & Insurance Recovered',
    type: 'Revenue',
    sub_type: 'Revenue',
    // normal_balance defaults to 'debit' on this table, which is wrong for a
    // revenue account and would invert it everywhere the sign is read.
    normal_balance: 'credit',
    entity: 'export',
    // Matches 4010 Export Sales — the GL itself is kept in PKR (journals post in
    // PKR at the booked rate); this is the account's denomination, for display.
    currency: 'USD',
    is_active: true,
    is_system: false,
    description: 'Ocean freight and marine insurance charged to the buyer beside an FOB price. Its counterpart cost is 6010 Freight & Shipping.',
  });
};

exports.down = async (knex) => {
  // Only drop it if nothing was ever posted to it — an account with history
  // cannot be removed without orphaning journal lines.
  const acc = await knex('chart_of_accounts').where({ code: '4070' }).first();
  if (!acc) return;
  const used = await knex('journal_lines').where({ account_id: acc.id }).first();
  if (used) return;
  await knex('chart_of_accounts').where({ id: acc.id }).del();
};
