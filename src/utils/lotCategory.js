// Map an inventory lot to a sellable/millable category tag from its type /
// grade / name. Blend grades are stored prefixed (e.g. "M-002-B1"), so match
// with word boundaries. Shared by the Local Sales SaleModal and the Mill
// New-Batch lot picker so both classify identically.
export function lotCategory(lot) {
  const type = lot.type;
  const name = (lot.itemName || '').toLowerCase();
  const s = `${lot.lotNo || ''} ${lot.itemName || ''} ${lot.grade || ''}`.toLowerCase();
  if (type === 'finished') return 'Finished Rice';
  if (type === 'raw') return 'Raw Rice';
  if (type === 'packaging') return 'Packaging';
  if (type === 'byproduct') {
    if (name.includes('bran')) return 'Bran';
    if (name.includes('husk')) return 'Husk';
    if (name.includes('sortex')) return 'Sortex';
    if (name.includes('powder')) return 'Powder';
    if (name.includes('sweeping')) return 'Sweeping';
    if (/\bb1\b/.test(s)) return 'B1';
    if (/\bb2\b/.test(s)) return 'B2';
    if (/\bb3\b/.test(s)) return 'B3';
    if (/\bcsr\b/.test(s)) return 'CSR';
    if (/short[\s-]?grain/.test(s)) return 'Short Grain';
    return 'Broken';
  }
  return 'Other';
}

export const CAT_ORDER = ['Finished Rice', 'B1', 'B2', 'B3', 'CSR', 'Short Grain', 'Broken', 'Powder', 'Sweeping', 'Bran', 'Husk', 'Sortex', 'Raw Rice', 'Packaging', 'Other'];

export const CAT_COLOR = {
  'Finished Rice': 'bg-emerald-100 text-emerald-700', B1: 'bg-amber-100 text-amber-700', B2: 'bg-orange-100 text-orange-700',
  B3: 'bg-yellow-100 text-yellow-700', CSR: 'bg-lime-100 text-lime-700', 'Short Grain': 'bg-amber-100 text-amber-700',
  Broken: 'bg-amber-100 text-amber-700', Powder: 'bg-violet-100 text-violet-700', Sweeping: 'bg-pink-100 text-pink-700',
  Bran: 'bg-stone-100 text-stone-600', Husk: 'bg-stone-100 text-stone-600', Sortex: 'bg-red-100 text-red-700',
  'Raw Rice': 'bg-blue-100 text-blue-700', Packaging: 'bg-gray-100 text-gray-600', Other: 'bg-gray-100 text-gray-600',
};

// Non-rice milling residue — present in inventory but cannot be fed back into a
// milling/blend batch.
export const NON_MILLABLE_CATEGORIES = ['Bran', 'Husk', 'Packaging', 'Other'];
