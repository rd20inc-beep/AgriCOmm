// Adjustment-type metadata shared between Stock Adjustments (inventory_lots)
// and Store Adjustments (mill_items). Each type has a stable backend value,
// a human label, an icon component, and a color family that drives chip +
// row tinting.
//
// The two pages have *different* type sets but share the same visual
// vocabulary so an operator switching between them sees one look.

import {
  TrendingDown,
  TrendingUp,
  AlertOctagon,
  AlertTriangle,
  Droplets,
  Package,
  Edit3,
  ClipboardList,
} from 'lucide-react';

const COLOR_THEMES = {
  red:    { chipBg: 'bg-red-50',    chipText: 'text-red-700',    chipBorder: 'border-red-200',    icon: 'text-red-500',    rowTint: 'bg-red-50/30' },
  amber:  { chipBg: 'bg-amber-50',  chipText: 'text-amber-700',  chipBorder: 'border-amber-200',  icon: 'text-amber-500',  rowTint: 'bg-amber-50/30' },
  green:  { chipBg: 'bg-green-50',  chipText: 'text-green-700',  chipBorder: 'border-green-200',  icon: 'text-green-500',  rowTint: 'bg-green-50/20' },
  blue:   { chipBg: 'bg-blue-50',   chipText: 'text-blue-700',   chipBorder: 'border-blue-200',   icon: 'text-blue-500',   rowTint: 'bg-blue-50/20' },
  slate:  { chipBg: 'bg-slate-50',  chipText: 'text-slate-700',  chipBorder: 'border-slate-200',  icon: 'text-slate-500',  rowTint: 'bg-slate-50/30' },
};

// Stock Adjustments (inventory_lots)
export const STOCK_ADJ_TYPES = [
  { value: 'shortage_found',    label: 'Shortage Found',    icon: TrendingDown,  color: 'red',   sign: '-', desc: 'Physical count is less than the system shows.' },
  { value: 'excess_found',      label: 'Excess Found',      icon: TrendingUp,    color: 'green', sign: '+', desc: 'Physical count exceeds the system — extra stock discovered.' },
  { value: 'damaged',           label: 'Damaged',           icon: AlertOctagon,  color: 'red',   sign: '-', desc: 'Stock destroyed or unusable due to damage.' },
  { value: 'spoiled',           label: 'Spoiled',           icon: AlertTriangle, color: 'red',   sign: '-', desc: 'Stock expired or spoiled; not sellable.' },
  { value: 'moisture_loss',     label: 'Moisture Loss',     icon: Droplets,      color: 'amber', sign: '-', desc: 'Natural shrinkage from drying / storage.' },
  { value: 'bag_loss',          label: 'Bag Loss',          icon: Package,       color: 'amber', sign: '-', desc: 'Bag torn / leaked; partial product loss.' },
  { value: 'manual_correction', label: 'Manual Correction', icon: Edit3,         color: 'blue',  sign: '±', desc: 'Operator-entered correction with a reason.' },
];

// Store Adjustments (mill_items consumables)
export const STORE_ADJ_TYPES = [
  { value: 'damage',     label: 'Damage',      icon: AlertOctagon,  color: 'red',   sign: '-', desc: 'Item damaged in storage / handling.' },
  { value: 'wastage',    label: 'Wastage',     icon: TrendingDown,  color: 'amber', sign: '-', desc: 'Material lost / wasted during use.' },
  { value: 'correction', label: 'Correction',  icon: Edit3,         color: 'blue',  sign: '±', desc: 'Operator-entered correction with a reason.' },
  { value: 'count',      label: 'Stock Count', icon: ClipboardList, color: 'slate', sign: '±', desc: 'Reconciliation after a physical stock count.' },
];

// Lookup helpers used by chip / table cells.
export function findStockType(value) {
  return STOCK_ADJ_TYPES.find((t) => t.value === value) || null;
}
export function findStoreType(value) {
  return STORE_ADJ_TYPES.find((t) => t.value === value) || null;
}

// Translate a color family to Tailwind classes.
export function themeFor(color) {
  return COLOR_THEMES[color] || COLOR_THEMES.slate;
}
