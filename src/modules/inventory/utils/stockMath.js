// Stock quantity rules shared by the Stock Summary page and its drill-down.
// Mirrors backend/src/modules/inventory/stockSql.js — keep the two in step.

import { fmtNum } from '../../../shared/utils/format';
const n = (v) => Number(v) || 0;

/** KG physically on hand: net_weight_kg, falling back to qty (KG). */
export function onHandKg(lot) {
  return n(lot.net_weight_kg) > 0 ? n(lot.net_weight_kg) : n(lot.qty);
}

/** Pack size of a lot in kg (0 = unknown, which counts as a 50 kg katta). */
export function packKg(lot) {
  return n(lot.bag_weight_kg) || n(lot.bag_size_kg) || 0;
}

/**
 * Sacks still on hand. total_bags is the INTAKE count and is never
 * decremented, so it is scaled by the weight left; lots with no intake count
 * divide the weight by the pack size (50 kg if unknown).
 * Returns { katta, bags }: 50 kg+ sacks vs sub-50 kg retail bags.
 */
export function unitsOnHand(lot) {
  const kg = onHandKg(lot);
  const intake = n(lot.total_bags);
  const received = n(lot.received_net_weight_kg);
  const pack = packKg(lot);
  const units = intake > 0 && received > 0
    ? Math.min(intake, Math.round(intake * (kg / received)))
    : Math.round(kg / (pack || 50));
  const isKatta = pack === 0 || pack >= 50;
  return isKatta ? { katta: units, bags: 0 } : { katta: 0, bags: units };
}

/** "120 katta · 40 bags" — empty string when there are none. */
export function formatUnits({ katta, bags }) {
  const parts = [];
  if (katta > 0) parts.push(`${fmtNum(katta)} katta`);
  if (bags > 0) parts.push(`${fmtNum(bags)} bags`);
  return parts.join(' · ');
}

/**
 * Split a Stock Summary row's on-hand KG into where it is:
 *   free       — available to sell
 *   committed  — reserved against export orders
 *   milling    — held for a milling batch that has started but not yielded
 * available_qty = qty − reserved_qty − milling_reserved_qty, so the three add
 * back up to on hand. `unexplained` carries any drift between net weight and
 * qty so it is visible rather than silently absorbed.
 */
export function splitOnHand(row) {
  const onHand = n(row.total_kg);
  const free = n(row.available_kg);
  const committed = n(row.reserved_kg);
  const milling = n(row.milling_reserved_kg);
  const unexplained = Math.round((onHand - free - committed - milling) * 1000) / 1000;
  return { onHand, free, committed, milling, unexplained };
}
