import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bellBadge, applyBellRead } from '../../utils/notificationBadge';

/**
 * P5-01: the header bell reads the user's own notifications from the server.
 * No DOM library is installed, so markup is checked through server rendering
 * with a seeded query cache, and the read-state logic as pure functions.
 */
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, role: 'Owner' }, hasPermission: () => true }),
}));

const { default: NotificationBell, NotificationPanel } = await import('../NotificationBell');
const { NOTIFICATION_BELL_KEY } = await import('../../../api/queries');

const N = [
  { id: 1, title: 'Store adjustment to approve', message: 'damage of -5 pcs', type: 'approval', isRead: false, link: '/approvals?type=store_adjustment', createdAt: '2026-10-16T10:00:00Z' },
  { id: 2, title: 'Advance Payment Confirmed', message: 'Advance of 1000', type: 'payment', isRead: false, link: '/export/12', createdAt: '2026-10-16T09:00:00Z' },
  { id: 3, title: 'Export balance pending confirmation', message: 'masked', type: 'payment', isRead: true, link: null, createdAt: '2026-10-15T09:00:00Z' },
];

function renderBell(data) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(NOTIFICATION_BELL_KEY, data);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}><MemoryRouter><NotificationBell /></MemoryRouter></QueryClientProvider>,
  );
}

describe('bell badge', () => {
  it('shows the server unread count for this user, capped at 99+', () => {
    expect(bellBadge(0)).toBeNull();
    expect(bellBadge(undefined)).toBeNull();
    expect(bellBadge(3)).toBe('3');
    expect(bellBadge(150)).toBe('99+');
  });

  it('the rendered bell carries the unread count from the notifications query', () => {
    const html = renderBell({ notifications: N, unread: 2 });
    expect(html).toContain('aria-label="Notifications, 2 unread"');
    expect(html).toMatch(/>2<\/span>/);
  });

  it('no badge when everything is read', () => {
    const html = renderBell({ notifications: [N[2]], unread: 0 });
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toMatch(/bg-red-500/);
  });
});

describe('read state', () => {
  it('marking one read drops the badge by one and flips only that row', () => {
    const next = applyBellRead({ notifications: N, unread: 2 }, 1);
    expect(next.unread).toBe(1);
    expect(next.notifications.find((n) => n.id === 1).isRead).toBe(true);
    expect(next.notifications.find((n) => n.id === 2).isRead).toBe(false);
  });

  it('marking an already-read one changes nothing', () => {
    expect(applyBellRead({ notifications: N, unread: 2 }, 3).unread).toBe(2);
  });

  it('mark all read zeroes the badge', () => {
    const next = applyBellRead({ notifications: N, unread: 2 }, null);
    expect(next.unread).toBe(0);
    expect(next.notifications.every((n) => n.isRead)).toBe(true);
  });
});

describe('panel', () => {
  const html = renderToStaticMarkup(<NotificationPanel notifications={N} unread={2} />);

  it('lists every notification with its read state', () => {
    expect((html.match(/data-read="0"/g) || []).length).toBe(2);
    expect((html.match(/data-read="1"/g) || []).length).toBe(1);
  });

  it('offers mark-read only on unread rows, and mark-all when anything is unread', () => {
    expect((html.match(/aria-label="Mark &quot;[^"]*&quot; as read"/g) || []).length).toBe(2);
    expect(html).toContain('Mark all read');
    expect(renderToStaticMarkup(<NotificationPanel notifications={[N[2]]} unread={0} />)).not.toContain('Mark all read');
  });

  it('says when a row opens a record (only rows the server gave a link)', () => {
    expect(html).toContain('Store adjustment to approve (unread) — open');
    expect(html).toContain('aria-label="Export balance pending confirmation"');
  });

  it('empty state', () => {
    expect(renderToStaticMarkup(<NotificationPanel notifications={[]} unread={0} />)).toContain('No notifications');
  });
});
