// KPI contract versions (P4-01). Each KPI the dashboards show has ONE written
// contract — formula, sources, units, currency, statuses, drill-down — in
// docs/AGRIRICE_KPI_CONTRACTS.md, and ONE backend module that computes it.
// Every KPI response names the contract version it was computed under, so a
// screen, a report and an export can be checked against the same definition.
//
// Bump a version when the formula, the statuses or the date rule change, and
// record the change in the contracts document.

const KPI_CONTRACTS = Object.freeze({
  millProfit: 'mill_profit.v1',                // D-13 headline — profitDefinitions "Mill (net)"
  productionValue: 'production_value.v1',      // D-13 secondary — output at the batches' own selling prices
  exportProfit: 'export_profit.v1',            // G-2 Booked / Realised (profitDefinitions; P4-03 owns changes)
  stockValue: 'stock_value.v1',                // D-14 — landed cost/kg × on-hand kg (inventory/stockValue.js)
  workingCapital: 'working_capital.v1',        // mill company stock at the D-14 value
  yield: 'yield.v1',                           // D-14 — Σ finished ÷ Σ raw, completed company batches
  activeOrder: 'active_order.v1',              // D-15 — status not Draft / Cancelled / Closed
  overdue: 'overdue.v1',                       // D-15 — past the effective due date AND outstanding > 0
  exportRevenueDate: 'export_revenue_date.v1', // D-16 — BL date, else the Shipped transition date
  reportingCurrency: 'reporting_currency.v1',  // PKR and USD are never summed
  millCashFlow: 'mill_cash_flow.v1',           // settled money only (the finance status rule)
});

const CONTRACTS_DOC = 'docs/AGRIRICE_KPI_CONTRACTS.md';

module.exports = { KPI_CONTRACTS, CONTRACTS_DOC };
