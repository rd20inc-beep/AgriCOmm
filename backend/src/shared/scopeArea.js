// Per-user module allow-lists (#9-scoping) name broad areas — inventory,
// milling, finance, … (SCOPE_MODULES in routes/users.js). A permission module
// split out of an area keeps that area's scope (mig 470): a user scoped to
// Inventory still reaches Local Sales, which used to be inventory-gated.
const SCOPE_AREA = {
  local_sales: 'inventory',
  mill_customers: 'inventory',
  mill_finance: 'milling',
};

/** The scope area a permission module falls under. */
function scopeAreaOf(module) {
  return SCOPE_AREA[module] || module;
}

module.exports = { scopeAreaOf, SCOPE_AREA };
