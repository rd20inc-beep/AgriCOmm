import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, CreditCard, Factory, FileText, Ship, AtSign, ListTodo, Info, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotificationBell, useMarkNotificationRead, useMarkAllNotificationsRead } from '../../api/queries';
import { fmtDateTime } from '../utils/format';
import { bellBadge } from '../utils/notificationBadge';

/**
 * The header bell (P5-01) — the user's own notifications from the server
 * (GET /api/communication/notifications), with per-user read state.
 *
 * The badge is the server's unread count for THIS user, from the same query as
 * the list. Clicking an item marks it read and opens its record — `link` is set
 * by the server only when the user may open that page, so the bell never sends
 * anyone to a page that bounces them. Mounted by the shell: <NotificationBell />.
 */

const TYPE_ICON = {
  payment: CreditCard,
  milling: Factory,
  document: FileText,
  shipment: Ship,
  mention: AtSign,
  task: ListTodo,
  approval: ShieldCheck,
  alert: AlertTriangle,
  info: Info,
};

/** Presentational panel (no data fetching) — rendered by the bell and the tests. */
export function NotificationPanel({ notifications = [], unread = 0, isLoading = false, onOpen = () => {}, onMarkRead = () => {}, onMarkAll = () => {} }) {
  return (
    <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-1rem)] bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden"
      role="dialog" aria-label="Notifications">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{unread} unread</span>
          {unread > 0 && (
            <button type="button" onClick={onMarkAll} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
              <CheckCheck size={13} aria-hidden="true" /> Mark all read
            </button>
          )}
        </div>
      </div>
      <ul className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <li className="px-4 py-8 text-center text-sm text-gray-400">Loading…</li>
        ) : notifications.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-gray-400">No notifications</li>
        ) : notifications.map((n) => {
          const Icon = TYPE_ICON[n.type] || Info;
          return (
            <li key={n.id} data-id={n.id} data-read={n.isRead ? '1' : '0'}
              className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 ${n.isRead ? '' : 'bg-blue-50/40'}`}>
              <Icon size={16} className="mt-0.5 text-gray-400 flex-shrink-0" aria-hidden="true" />
              <button type="button" onClick={() => onOpen(n)} className="flex-1 min-w-0 text-left"
                aria-label={`${n.title}${n.isRead ? '' : ' (unread)'}${n.link ? ' — open' : ''}`}>
                <p className={`text-sm truncate ${n.isRead ? 'text-gray-700' : 'font-semibold text-gray-900'}`}>{n.title}</p>
                {n.message && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>}
                <p className="text-[11px] text-gray-400 mt-1">{n.createdAt ? fmtDateTime(n.createdAt) : ''}</p>
              </button>
              {!n.isRead && (
                <button type="button" onClick={() => onMarkRead(n)} title="Mark as read" aria-label={`Mark "${n.title}" as read`}
                  className="mt-1 w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0 hover:ring-4 hover:ring-blue-100" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data, isLoading } = useNotificationBell({ enabled: !!user });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;
  const badge = bellBadge(unread);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user) return null;

  const onOpen = (n) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.link) { setOpen(false); navigate(n.link); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={badge ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell size={18} aria-hidden="true" />
        {badge && (
          <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[9px] font-bold text-white bg-red-500 rounded-full">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <NotificationPanel
          notifications={notifications}
          unread={unread}
          isLoading={isLoading}
          onOpen={onOpen}
          onMarkRead={(n) => markRead.mutate(n.id)}
          onMarkAll={() => markAll.mutate()}
        />
      )}
    </div>
  );
}
