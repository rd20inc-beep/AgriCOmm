import { useQuery } from '@tanstack/react-query';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/**
 * The approvals inbox (P5-02, owner decision D-20 (a)): every approval the
 * signed-in user can act on, from GET /api/approvals-inbox — the server
 * filters each type by the guard of that type's approve route.
 *
 * ONE query key feeds the inbox page, the sidebar/mobile badge and the Admin
 * tab badge, so the badge always equals the length of the list the user opens
 * (NAV-11, NAV-29). The key sits under ['approvals'], so every existing
 * mutation that invalidates ['approvals'] refreshes it too.
 */
export const APPROVALS_INBOX_KEY = ['approvals', 'inbox'];
const POLL_MS = 60 * 1000;

export async function fetchApprovalsInbox() {
  const res = await api.get('/api/approvals-inbox');
  const data = res?.data ?? res ?? {};
  return {
    items: Array.isArray(data.items) ? data.items : [],
    types: Array.isArray(data.types) ? data.types : [],
  };
}

function useInboxQuery(select) {
  const { user } = useAuth();
  return useQuery({
    queryKey: APPROVALS_INBOX_KEY,
    queryFn: fetchApprovalsInbox,
    enabled: !!user,
    select,
    staleTime: 15 * 1000,
    refetchInterval: POLL_MS,
  });
}

/** The full inbox: { data: { items, types }, isLoading, error, refetch }. */
export function useApprovalsInbox() {
  return useInboxQuery();
}

const countAll = (d) => d.items.length;

/** Badge: how many items the user can act on (0 while loading). */
export function useApprovalsInboxCount() {
  const { data } = useInboxQuery(countAll);
  return data ?? 0;
}

/** Badge for one type (e.g. 'master_data' on the Admin ▸ Approvals tab). */
export function useApprovalsInboxTypeCount(type) {
  const { data } = useInboxQuery((d) => d.items.filter((i) => i.type === type).length);
  return data ?? 0;
}

export default useApprovalsInbox;
