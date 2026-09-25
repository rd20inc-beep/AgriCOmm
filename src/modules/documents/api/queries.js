import { useQuery } from '@tanstack/react-query';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext';

// Documents waiting on an approver, for the sidebar badge. Only approvers can
// act on them, so only approvers are asked for the count.
export function usePendingDocumentApprovalsCount() {
  const { hasPermission } = useAuth();
  return useQuery({
    queryKey: ['documents', 'pending-approvals', 'count'],
    queryFn: async () => {
      const res = await api.get('/api/documents/pending-approvals/count');
      return res?.data?.pending ?? res?.pending ?? 0;
    },
    enabled: hasPermission('documents', 'approve'),
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
    placeholderData: (prev) => prev,
  });
}
