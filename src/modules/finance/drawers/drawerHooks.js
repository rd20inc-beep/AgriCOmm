// Data hooks behind the Finance drawers.
import { useQuery } from '@tanstack/react-query';
import api from '../../../api/client';
import { transformKeys } from '../../../api/transforms';
import { useReceivables, usePayables } from '../../../api/queries';
import { transactionKey } from './drawerLogic';

const eq = (a, b) => String(a ?? '') === String(b ?? '');

export function useTransactionDetail(txKind, id) {
  return useQuery({
    queryKey: transactionKey(txKind, id),
    enabled: !!txKind && !!id,
    queryFn: async () => {
      const res = await api.get(`/api/finance/transactions/${txKind}/${id}`);
      return res?.data || null;
    },
    staleTime: 5 * 1000,
  });
}

/**
 * Resolve a document handed over by identity only ({ docKind, id } — from the
 * search, a transaction, the party drawer) against the lists the finance
 * screens already read. A row handed over directly is used as is.
 */
export function useDocumentRow(doc) {
  const kind = doc?.docKind;
  const given = doc?.row || null;
  const needs = !given;
  const { data: receivables = [] } = useReceivables({}, { enabled: needs && (kind === 'receivable' || kind === 'local_sale') });
  const { data: payables = [] } = usePayables({}, { enabled: needs && kind === 'payable' });
  const { data: purchases } = useQuery({
    queryKey: ['purchases-feed', 'lookup'],
    enabled: needs && kind === 'purchase',
    queryFn: async () => { const r = await api.get('/api/finance/purchases', {}); return { purchases: transformKeys(r?.data?.purchases || []) }; },
  });
  const { data: expense } = useQuery({
    queryKey: ['expenses', 'one', doc?.id],
    enabled: needs && kind === 'expense' && !!doc?.id,
    queryFn: async () => { const r = await api.get(`/api/expenses/${doc.id}`); return r?.data?.expense || r?.expense || null; },
  });
  if (given) return given;
  switch (kind) {
    case 'receivable': return receivables.find((r) => eq(r.id, doc.id) && r.kind !== 'local_sale') || null;
    case 'local_sale': return receivables.find((r) => eq(r.id, doc.id) && r.kind === 'local_sale') || null;
    case 'payable': return payables.find((r) => eq(r.id, doc.id)) || null;
    case 'purchase': return (purchases?.purchases || []).find((r) => eq(r.refId, doc.id) && (!doc.source || r.source === doc.source)) || null;
    case 'expense': return expense || null;
    default: return null;
  }
}
