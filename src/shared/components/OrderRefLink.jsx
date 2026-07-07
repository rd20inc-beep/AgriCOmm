import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

// An export/milling order (or batch) reference that links to its detail page ONLY
// when the user can open that module; otherwise it renders as plain text. This
// keeps payments-only roles (Finance) off the Access-Denied route while still
// giving Owner/Admin/Export the clickable link.
//   module: 'export_orders' (default) or 'milling'
export default function OrderRefLink({
  to,
  module = 'export_orders',
  className = 'text-blue-600 hover:text-blue-800 font-medium hover:underline',
  plainClassName = 'font-medium text-gray-700',
  onClick,
  children,
}) {
  const { hasPermission } = useAuth();
  if (to && hasPermission(module, 'view')) {
    return <Link to={to} className={className} onClick={onClick}>{children}</Link>;
  }
  return <span className={plainClassName}>{children}</span>;
}
