// GET /api/company-profile — the company's letterhead for print headers (P5-13).
//
// Read-only and open to every signed-in role: until now the only source was
// GET /api/admin/settings (admin.view), so every other role printed the static
// defaults instead of the configured company name. Only the letterhead fields
// leave the server — never other system_settings (WhatsApp keys, SMTP, rates…)
// and never any unknown key that may have been saved inside companyProfile.
const router = require('express').Router();
const db = require('../../config/database');

const PUBLIC_FIELDS = ['name', 'tagline', 'address', 'phone', 'email', 'website', 'ntn', 'logo'];

function pickPublic(profile) {
  const out = {};
  if (!profile || typeof profile !== 'object') return out;
  for (const k of PUBLIC_FIELDS) {
    const v = profile[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    out[k] = String(v);
  }
  return out;
}

async function readCompanyProfile() {
  const row = await db('system_settings').where({ key: 'companyProfile' }).first();
  if (!row || row.value == null) return {};
  let value = row.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return pickPublic(value);
}

router.get('/', async (req, res) => {
  try {
    return res.json({ success: true, data: await readCompanyProfile() });
  } catch (err) {
    console.error('company-profile error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load the company profile.' });
  }
});

module.exports = router;
module.exports.PUBLIC_FIELDS = PUBLIC_FIELDS;
module.exports.pickPublic = pickPublic;
