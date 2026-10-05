// Shared confidentiality helper: a restricted role sees reference numbers but NOT
// trading-party (customer / supplier) names across the finance dashboard and the
// finance-readable Local Sales list. Mirrors the inline check in
// finance.controller (kept there to avoid churn in that hot file).
//
// Finance Manager and Mill Manager are on this list because they are the people
// who SETTLE mill payables. Masking hid more than a name: it also nulled
// supplier_id, so on Mill Finance ▸ Parties ▸ Suppliers every payable collapsed
// into one generic "Supplier" row with no id — which meant no Pay button, and a
// pay drawer that reported "No open invoices" against a balance the same page was
// showing as outstanding. You cannot be asked to settle a supplier you are not
// allowed to identify.
//
// The Mill Operator joined the list on 2026-10-05 (owner: "see everything
// regarding the mill", then full mill access). Its routes only reach mill
// screens and mill rows, so this unmasks mill suppliers / customers there.
//
// Still masked: Export Manager, QC Analyst, Inventory Officer, Documentation
// Officer, Read-Only Auditor.
const db = require('../config/database');

const PARTY_VISIBLE_ROLES = ['Super Admin', 'Owner', 'Admin', 'Finance Manager', 'Mill Manager', 'Mill Operator'];

async function isPartyMasked(req) {
  let roleName = req.user && req.user._roleName;
  if (!roleName && req.user && req.user.role_id) {
    const rr = await db('roles').where({ id: req.user.role_id }).first('name');
    roleName = rr && rr.name;
  }
  return !PARTY_VISIBLE_ROLES.includes(roleName);
}

module.exports = { isPartyMasked, PARTY_VISIBLE_ROLES };
