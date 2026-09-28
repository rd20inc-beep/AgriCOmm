/**
 * How a shipment field's new value is decided.
 *
 * Two request shapes mean different things and must not be conflated:
 *
 *   sent as '' or null   the operator cleared the field — clear it
 *   not sent at all      the caller is not talking about this field — leave it
 *
 * `x || null` treats both as "clear", which lets an older cached client, or any
 * caller posting a partial shipment payload, wipe fields it never knew about.
 * That is how voyage_number and gd_number came to be nulled on every save.
 *
 * `x || stored || null` treats both as "keep", which means the field can never be
 * cleared from the form at all.
 *
 * Neither is right; this is.
 */
function resolveShipmentField(sent, stored) {
  if (sent === undefined) return stored === undefined ? null : (stored || null);
  return sent || null;
}

/**
 * Same rule, for a NOT NULL column that carries a default. Clearing it means
 * going back to that default rather than to null, which the constraint forbids.
 */
function resolveRequiredField(sent, stored, fallback) {
  return resolveShipmentField(sent, stored) || fallback;
}

module.exports = { resolveShipmentField, resolveRequiredField };
