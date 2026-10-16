// STUB (P5 SHELL agent) — the INBOX agent owns the real bell (bound to
// /api/notifications) and replaces this file at integration. The shell
// mounts it as <NotificationBell /> in the header for every role.
import { useState } from 'react';
import { Bell } from 'lucide-react';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell size={18} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 px-4 py-6 text-center text-sm text-gray-400">
          No notifications
        </div>
      )}
    </div>
  );
}
