// Small pure helpers behind the Lot Inventory / Lot Detail shortcuts (P5-10,
// W14). Kept free of React so the rules are unit-tested on their own.

const TYPES = ['raw', 'finished', 'byproduct'];
const STATUSES = ['Available', 'Reserved', 'Depleted', 'Closed'];

// Whether a lot can be moved Mill -> Export straight from a list row: finished
// or by-product rice, in the mill entity, company-owned (never a service-milling
// client's stock), with free quantity. The server re-validates availability on
// submit (POST /lot-inventory/lots/:id/transfer-to-export), so this only
// decides whether the action is offered.
export function canTransferLotToExport(lot) {
  if (!lot) return false;
  return (lot.type === 'finished' || lot.type === 'byproduct')
    && lot.entity === 'mill'
    && lot.ownership !== 'client'
    && (parseFloat(lot.availableQty) || 0) > 0;
}

// Initial Lot Inventory filters from the URL, so deep links such as the Mill
// dashboard's Raw Stock card (/lot-inventory?type=raw) land filtered instead
// of on the whole list. Unknown values fall back to the page defaults.
export function lotInventoryFiltersFromParams(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null);
  const type = get('type');
  const status = get('status');
  return {
    type: TYPES.includes(type) ? type : 'All',
    status: status === 'All' || STATUSES.includes(status) ? status : 'Available',
  };
}

// The local-sale link from a lot: opens the New Local Sale drawer with the lot
// already searched and picked, so the user doesn't re-find it.
export function sellLocallyHref(lot) {
  const ref = lot?.lotNo || lot?.id;
  return ref ? `/local-sales?new=1&lot=${encodeURIComponent(ref)}` : '/local-sales?new=1';
}
