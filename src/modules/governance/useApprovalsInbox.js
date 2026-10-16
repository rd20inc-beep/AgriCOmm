// STUB (P5 SHELL agent) — the INBOX agent owns this hook and replaces this
// file at integration. Contract: useApprovalsInboxCount() → a plain number,
// the count of items the user can act on. Until then the badge is the two
// queues the old sidebar badge counted. (The shell also accepts a
// react-query-style { data } result.)
import { useMasterDataApprovalsCount } from '../admin/api/queries';
import { usePendingDocumentApprovalsCount } from '../documents/api/queries';

export function useApprovalsInboxCount() {
  const { data: masterData = 0 } = useMasterDataApprovalsCount();
  const { data: documents = 0 } = usePendingDocumentApprovalsCount();
  return (Number(masterData) || 0) + (Number(documents) || 0);
}
