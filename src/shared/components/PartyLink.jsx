import { Link } from 'react-router-dom';
import { useFinanceDrawers } from '../../modules/finance/drawers/drawersContext';

// Renders a customer/supplier/buyer name as a link to that party. Inside the
// app shell it opens the Party drawer (balance per currency, open items,
// recent ledger lines, Receive / Pay, full statement); where no drawer is in
// reach — or the user lacks finance.view, which the drawer reads — it links
// to the party's ledger (/finance/accounting/statements?type=…&id=…) as
// before. "buyer" is a customer in this app.
//
// Safe by design: when no id is available it renders plain text, so it can
// be dropped in anywhere a name is shown without risking a broken link.
// stopPropagation keeps it from also triggering a parent row's onClick.
export default function PartyLink({ type, id, name, className = '', fallback = '—' }) {
  const drawers = useFinanceDrawers();
  const label = name || fallback;
  const t = type === 'supplier' ? 'supplier' : 'customer';
  if (!id || !name) return <span className={className}>{label}</span>;
  if (drawers?.openParty) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); drawers.openParty({ type: t, id, name }); }}
        title="Open party"
        data-party={`${t}-${id}`}
        className={`text-blue-600 hover:text-blue-800 hover:underline text-left ${className}`}
      >
        {label}
      </button>
    );
  }
  return (
    <Link
      to={`/finance/accounting/statements?type=${t}&id=${id}`}
      onClick={(e) => e.stopPropagation()}
      title="View ledger"
      className={`text-blue-600 hover:text-blue-800 hover:underline ${className}`}
    >
      {label}
    </Link>
  );
}
