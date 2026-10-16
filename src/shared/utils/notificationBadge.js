/** Pure: the bell badge text for an unread count, or null when nothing is unread. */
export function bellBadge(unread) {
  const n = Number(unread) || 0;
  if (n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

/**
 * Pure: the bell's cached { notifications, unread } after marking one
 * notification (id) — or all of them (id == null) — read. Used for the
 * immediate badge drop on click; the server refetch then confirms it.
 */
export function applyBellRead(old, id) {
  if (!old) return old;
  let dropped = 0;
  const notifications = (old.notifications || []).map((n) => {
    if ((id == null || n.id === id) && !n.isRead) { dropped += 1; return { ...n, isRead: true }; }
    return n;
  });
  return { notifications, unread: id == null ? 0 : Math.max(0, (Number(old.unread) || 0) - dropped) };
}
