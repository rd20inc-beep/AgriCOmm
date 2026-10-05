import { useAuth } from '../context/AuthContext';

/**
 * Who may see what rice cost and what it is worth (owner decision 2026-10-05).
 *
 * Purchase rates, landed cost, stock value and profit are hidden from the Mill
 * Operator and the QC Analyst. Everyone holding reports.view_cost — or finance
 * access — keeps them. This is the SAME rule the backend enforces in
 * backend/src/utils/costVisibility.js; the server nulls the figures anyway, the
 * UI just doesn't leave an empty column behind.
 */
export function canSeeCost(hasPermission) {
  if (typeof hasPermission !== 'function') return false;
  return !!(hasPermission('reports', 'view_cost') || hasPermission('finance', 'view'));
}

export function canSeeProfit(hasPermission) {
  if (typeof hasPermission !== 'function') return false;
  return !!(hasPermission('reports', 'view_profit') || hasPermission('finance', 'view'));
}

/** Drop the columns marked `cost: true` (or `profit: true`) the viewer may not see. */
export function visibleColumns(columns, { cost, profit = cost }) {
  return (columns || []).filter((c) => (!c.cost || cost) && (!c.profit || profit));
}

export default function useCanSeeCost() {
  const { hasPermission } = useAuth();
  return canSeeCost(hasPermission);
}

export function useCanSeeProfit() {
  const { hasPermission } = useAuth();
  return canSeeProfit(hasPermission);
}
