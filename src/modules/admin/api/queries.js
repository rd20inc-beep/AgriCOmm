import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { adminApi } from './services';

/**
 * Count of pending master-data quick-add approvals (Admin → Approvals queue).
 * Shared by the sidebar Admin badge and the dashboard action queue so both stay
 * in sync. Polls every 30s; only runs for users who can see the admin area.
 */
export function useMasterDataApprovalsCount() {
  const { hasPermission } = useAuth();
  return useQuery({
    queryKey: ['admin', 'approvals', 'count'],
    queryFn: async () => {
      const res = await adminApi.approvalsCount();
      return res?.data?.total ?? res?.total ?? 0;
    },
    enabled: hasPermission('admin', 'view'),
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
    placeholderData: (prev) => prev,
  });
}
