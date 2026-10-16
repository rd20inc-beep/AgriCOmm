// W01: the New Rice Purchase form starts on the supplier, broker and
// transporter of the last purchase this browser recorded — shown as such and
// editable, never hidden. Pure apart from the localStorage read/write.

const KEY = 'riceflow_last_rice_purchase_parties';
const FIELDS = ['supplier_id', 'broker_id', 'hauler_id'];

const clean = (v) => (v == null || v === '' ? '' : String(v));

function store() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readLastPurchaseParties(storage = store()) {
  try {
    const raw = storage?.getItem(KEY);
    const v = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(FIELDS.map((f) => [f, clean(v?.[f])]));
  } catch {
    return { supplier_id: '', broker_id: '', hauler_id: '' };
  }
}

export function rememberPurchaseParties(form, storage = store()) {
  try {
    const v = Object.fromEntries(FIELDS.map((f) => [f, clean(form?.[f])]));
    if (!v.supplier_id) return;
    storage?.setItem(KEY, JSON.stringify(v));
  } catch { /* storage unavailable — nothing remembered */ }
}

export function forgetPurchaseParties(storage = store()) {
  try { storage?.removeItem(KEY); } catch { /* nothing to forget */ }
}

// Fill a blank form with the remembered parties. The supplier is used only
// when it is still in the supplier list (an archived or rejected supplier is
// not silently reused); the broker only when it is too. `brokerDiffers` tells
// the form the broker was chosen separately, so changing the supplier does not
// overwrite it.
export function applyRememberedParties(form, remembered, supplierIds = []) {
  const known = new Set((supplierIds || []).map(String));
  const ok = (id) => !!id && (known.size === 0 ? false : known.has(String(id)));
  const supplier = ok(remembered?.supplier_id) ? remembered.supplier_id : '';
  if (!supplier) return { form, applied: false, brokerDiffers: false };
  const broker = ok(remembered?.broker_id) ? remembered.broker_id : supplier;
  return {
    form: { ...form, supplier_id: supplier, broker_id: broker, hauler_id: remembered?.hauler_id || form.hauler_id || '' },
    applied: true,
    brokerDiffers: broker !== supplier,
  };
}
