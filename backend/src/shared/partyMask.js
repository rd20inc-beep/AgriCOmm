// Shared confidentiality helper: every role EXCEPT Super Admin / Owner / Admin
// sees reference numbers but NOT trading-party (customer / supplier) names across
// the finance dashboard and the finance-readable Local Sales list. Mirrors the
// inline check in finance.controller (kept there to avoid churn in that hot file).
const db = require('../config/database');

const PARTY_VISIBLE_ROLES = ['Super Admin', 'Owner', 'Admin'];

async function isPartyMasked(req) {
  let roleName = req.user && req.user._roleName;
  if (!roleName && req.user && req.user.role_id) {
    const rr = await db('roles').where({ id: req.user.role_id }).first('name');
    roleName = rr && rr.name;
  }
  return !PARTY_VISIBLE_ROLES.includes(roleName);
}

module.exports = { isPartyMasked, PARTY_VISIBLE_ROLES };
