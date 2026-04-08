import { useState } from 'react';

/**
 * Hook for filtering by entity type (mill/export/all).
 * Replaces the entityFilter state from AppContext.
 */
export function useEntityFilter(defaultValue = 'All') {
  const [entityFilter, setEntityFilter] = useState(defaultValue);
  return { entityFilter, setEntityFilter };
}
