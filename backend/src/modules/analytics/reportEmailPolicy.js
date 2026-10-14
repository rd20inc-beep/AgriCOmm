/**
 * Who a scheduled report email may go to, and what each recipient may see
 * (P1-11 / RPT-19, PLT-13).
 *
 *  - Recipients must be on an INTERNAL domain. The allowlist is the system
 *    setting `report_email_allowed_domains` (comma-separated, e.g.
 *    "agricommodities.online, agri.pk"); when it is not set, it is the set of
 *    domains of active users' emails — i.e. the company's own mailboxes.
 *  - Each email is redacted for its recipient with the same cost / profit rule
 *    the screens use (utils/costVisibility): a recipient who is an active user
 *    gets what their role may see; an address that is not a user gets neither
 *    cost nor profit columns.
 */
const { isCostKey, isProfitKey, moneyVisibility } = require('../../utils/costVisibility');

const SETTING_KEY = 'report_email_allowed_domains';
const EMAIL_RE = /^[^\s@,;<>"]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

const domainOf = (email) => {
  const m = String(email || '').trim().match(EMAIL_RE);
  return m ? m[1].toLowerCase() : null;
};

const normalizeDomains = (value) => String(value || '')
  .split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

async function allowedDomains(db) {
  const row = await db('system_settings').where({ key: SETTING_KEY }).first();
  const configured = normalizeDomains(row && row.value);
  if (configured.length) return configured;
  const users = await db('users').where({ is_active: true }).select('email');
  return [...new Set(users.map((u) => domainOf(u.email)).filter(Boolean))];
}

// Split a recipient list into what may be sent and what may not.
function partitionRecipients(list, domains) {
  const allow = new Set(domains);
  const out = { allowed: [], external: [], invalid: [] };
  for (const raw of list || []) {
    const email = String(raw || '').trim();
    if (!email) continue;
    const d = domainOf(email);
    if (!d) out.invalid.push(email);
    else if (allow.has(d)) out.allowed.push(email);
    else out.external.push(email);
  }
  return out;
}

// Drop the money columns a recipient may not see from a { title, columns, rows,
// footer } report (rows/footer are arrays aligned with columns).
function redactReportColumns(report, { cost, profit }) {
  if (!report || (cost && profit)) return report;
  const keep = report.columns.map((c) => !((!cost && isCostKey(c)) || (!profit && isProfitKey(c))));
  const pick = (arr) => (arr ? arr.filter((_, i) => keep[i]) : arr);
  return { ...report, columns: pick(report.columns), rows: (report.rows || []).map(pick), footer: pick(report.footer) };
}

// What an email address may see: its active user's role, or nothing.
async function recipientVisibility(db, email) {
  const all = await db('users').where({ is_active: true }).select('id', 'role_id', 'email');
  const target = String(email || '').trim().toLowerCase();
  const user = all.find((u) => String(u.email || '').toLowerCase() === target);
  if (!user) return { cost: false, profit: false };
  return moneyVisibility({ user: { id: user.id, role_id: user.role_id } });
}

module.exports = {
  SETTING_KEY, domainOf, normalizeDomains, allowedDomains, partitionRecipients,
  redactReportColumns, recipientVisibility,
};
