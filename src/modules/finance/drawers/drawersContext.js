// The Finance drawers' context: which drawer API (if any) is in reach.
import { createContext, useContext } from 'react';

export const DrawersContext = createContext(null);

/** The drawer API, or null outside a FinanceDrawersProvider. */
export function useFinanceDrawers() {
  return useContext(DrawersContext);
}
