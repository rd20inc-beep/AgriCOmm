// Freight Recoverable clearing/asset account (spec item #14, Phase 2b).
// Bridges "front & recover" transport: when the company pays the hauler but the
// cost is borne by the supplier (deduct-from-supplier) or a service-milling
// client, the freight is parked here and cleared by the offsetting deduction /
// client receivable — so no P&L or inventory impact and the books stay balanced.

exports.up = async (knex) => {
  const exists = await knex('chart_of_accounts').where({ code: '1450' }).first();
  if (!exists) {
    await knex('chart_of_accounts').insert({
      code: '1450', name: 'Freight Recoverable', type: 'Asset',
      sub_type: 'Current Asset', entity: null, currency: 'PKR',
      normal_balance: 'debit', is_system: false, is_active: true,
      description: 'Freight paid on behalf of a supplier (deducted from their bill) or a service-milling client (recovered on their invoice).',
    });
  }
};

exports.down = async (knex) => {
  await knex('chart_of_accounts').where({ code: '1450' }).del();
};
