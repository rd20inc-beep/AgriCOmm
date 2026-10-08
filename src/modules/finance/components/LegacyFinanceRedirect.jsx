import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { legacyFinanceTarget, withRange } from '../financeNav';

// An old /finance/<page> URL (bookmark, server-built link, other module) →
// the view that now holds that page, with the query string kept.
export function LegacyFinanceRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={legacyFinanceTarget(pathname, search) || '/finance'} replace />;
}

// Any /finance/<unknown> → Home (keeping the period) instead of a blank body.
export function FinanceCatchAll() {
  const [params] = useSearchParams();
  return <Navigate to={withRange('/finance', params.get('range') || '')} replace />;
}
