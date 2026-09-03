// Favorites (starred master data) — bank accounts, customers and suppliers.
// A starred row sorts to the top of its list and is marked in the UI so the
// ordering is visible rather than merely felt: a native <select> option renders
// text only, so its label gets a ★ prefix; custom pickers draw a real icon.
//
// Both helpers accept either shape — the camelCase transform output
// (isFavorite) or a raw snake_case row (is_favorite) — since a few screens read
// straight from the API instead of going through a transform.

export const isFavorite = (row) => !!(row && (row.isFavorite || row.is_favorite));

export const favStar = (row) => (isFavorite(row) ? '★ ' : '');

// Comparator: favorites first, then alphabetical by name. Used by the list
// hooks (useBankAccounts / useCustomers / useSuppliers) and by pickers that
// merge in locally-added rows after the fetch.
export const byFavoriteThenName = (a, b) => {
  if (isFavorite(a) !== isFavorite(b)) return isFavorite(a) ? -1 : 1;
  return (a?.name || '').localeCompare(b?.name || '');
};

export default favStar;
