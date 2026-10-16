import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * Simple breadcrumb trail for detail pages, so a page opened from a QR scan or
 * a pasted link still shows where it sits and has a way up.
 *
 *   <Breadcrumbs items={[{ label: 'Export Orders', to: '/export' }, { label: order.id }]} />
 *
 * The last item is the current page (not a link, aria-current="page").
 * Items without a label are skipped, so a crumb can be passed while data loads.
 */
export default function Breadcrumbs({ items = [], className = '' }) {
  const crumbs = items.filter((c) => c && c.label !== undefined && c.label !== null && c.label !== '');
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className={`text-xs text-gray-500 ${className}`}>
      <ol className="flex items-center flex-wrap gap-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="inline-flex items-center gap-1 min-w-0">
              {last || !c.to ? (
                <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'text-gray-700 font-medium' : ''}`}>{c.label}</span>
              ) : (
                <Link to={c.to} className="hover:text-gray-900 hover:underline truncate">{c.label}</Link>
              )}
              {!last && <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
