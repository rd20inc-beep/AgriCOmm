// Favorite (starred) master-data rows sort to the top of their list — see
// useBankAccounts and the suppliers/customers admin tabs. A native <select>
// option renders text only, so the ordering alone is easy to miss; prefixing
// the label makes "these are your accounts" visible at a glance.
//
// Accepts either shape: the camelCase transform output (isFavorite) or a raw
// snake_case row (is_favorite), since a few screens read straight from the API.
export const favStar = (row) => (row && (row.isFavorite || row.is_favorite) ? '★ ' : '');

export default favStar;
