// Deep links into the export-order pages (P5-10, NAV-09). Pure so the routing
// rules are unit-tested.

// The create form's path. Quick actions link here directly.
export const CREATE_ORDER_PATH = '/export/create';

// /export?new=1 (the old Dashboard quick action) and /export?duplicate=EX-001
// both mean "open the create form", not the list. The duplicate id is carried
// through so the form can load and copy that order.
export function exportOrdersIntent(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null);
  const dup = get('duplicate');
  if (dup) return { create: true, to: `${CREATE_ORDER_PATH}?duplicate=${encodeURIComponent(dup)}` };
  const n = get('new');
  if (n === '1' || n === 'true') return { create: true, to: CREATE_ORDER_PATH };
  return { create: false, to: null };
}

// "Duplicate" from any order: a link to the create form that copies it.
export function duplicateOrderHref(orderNo) {
  return `${CREATE_ORDER_PATH}?duplicate=${encodeURIComponent(orderNo)}`;
}
