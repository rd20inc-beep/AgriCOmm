// Deep link into a Finance drawer: /finance/<view>?open=<kind>:<id>.
//
// The header global search (P5-03) links a receivable, payable, payment, bank
// transaction or expense here; the Finance shell opens the matching drawer on
// arrival and drops the parameter (replace, so Back does not reopen it). The
// drawers read /api/finance (finance.view): without it nothing opens and the
// view underneath shows as usual.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFinanceDrawers } from './drawersContext';

const TRANSACTIONS = new Set(['payment', 'bank']);
const DOCUMENTS = new Set(['receivable', 'payable', 'expense', 'local_sale']);

/** 'payment:42' → { kind: 'transaction', txKind: 'payment', id: 42 }; junk → null. */
export function parseOpenParam(value) {
  const m = /^([a-z_]+):(\d+)$/.exec(String(value || ''));
  if (!m) return null;
  const id = Number(m[2]);
  if (!id) return null;
  if (TRANSACTIONS.has(m[1])) return { kind: 'transaction', txKind: m[1], id };
  if (DOCUMENTS.has(m[1])) return { kind: 'document', doc: { docKind: m[1], id } };
  return null;
}

/** Open the drawer named by ?open= once, then remove the parameter. */
export function useOpenDrawerFromUrl() {
  const drawers = useFinanceDrawers();
  const [params, setParams] = useSearchParams();
  const value = params.get('open');
  useEffect(() => {
    if (!value) return;
    const target = parseOpenParam(value);
    if (target && drawers?.canView) {
      if (target.kind === 'transaction') drawers.openTransaction(target.txKind, target.id);
      else drawers.openDocument(target.doc);
    }
    setParams((prev) => { const next = new URLSearchParams(prev); next.delete('open'); return next; }, { replace: true });
  }, [value, drawers, setParams]);
}
