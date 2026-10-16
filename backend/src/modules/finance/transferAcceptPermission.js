// Accepting a fund transfer is authorised by the RECEIVING side, with no Owner
// step (owner decision 2026-10-06): Head Office (to_entity 'general') accepts
// with finance.confirm_payment, the Mill with milling.edit. Shared by the
// accept route (finance.routes.js) and the approvals inbox, so the inbox lists
// exactly the transfers the route would let this user accept.
const ACCEPT_PERMISSION = {
  general: ['finance', 'confirm_payment'],
  mill: ['milling', 'edit'],
};

module.exports = { ACCEPT_PERMISSION };
