import { Link } from 'react-router-dom';

// Renders a customer/supplier/buyer name as a link to that party's ledger
// (/finance/statements?type=…&id=…). "buyer" is a customer in this app.
//
// Safe by design: when no id is available it renders plain text, so it can
// be dropped in anywhere a name is shown without risking a broken link.
// stopPropagation keeps it from also triggering a parent row's onClick.
export default function PartyLink({ type, id, name, className = '', fallback = '—' }) {
  const label = name || fallback;
  const t = type === 'supplier' ? 'supplier' : 'customer';
  if (!id || !name) return <span className={className}>{label}</span>;
  return (
    <Link
      to={`/finance/statements?type=${t}&id=${id}`}
      onClick={(e) => e.stopPropagation()}
      title="View ledger"
      className={`text-blue-600 hover:text-blue-800 hover:underline ${className}`}
    >
      {label}
    </Link>
  );
}
