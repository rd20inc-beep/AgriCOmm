import { useQuery } from '@tanstack/react-query';
import { purchaseRequirementsApi } from './services';
import { useAuth } from '../../../context/AuthContext';

// Pending purchase requests, for the sidebar badge. The endpoint existed from
// the start and nothing ever called it, so a request raised against an export
// order sat unseen inside the Mill group with nothing pointing at it.
export function usePurchaseRequirementsCount() {
  const { hasPermission } = useAuth();
  return useQuery({
    queryKey: ['purchase-requirements', 'count'],
    queryFn: async () => {
      const res = await purchaseRequirementsApi.count();
      return res?.data?.pending ?? res?.pending ?? 0;
    },
    enabled: hasPermission('inventory', 'view'),
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
    placeholderData: (prev) => prev,
  });
}
