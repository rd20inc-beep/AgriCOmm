import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Right-side sliding drawer. Pattern adapted from PayPurchaseDrawer in
 * src/modules/finance/pages/Purchases.jsx so behavior matches existing
 * drawers (Escape closes, click-outside closes, max-w-md panel).
 */
export default function SlideDrawer({ open, onClose, title, subtitle, icon: Icon, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = size === 'lg' ? 'max-w-lg' : size === 'xl' ? 'max-w-xl' : 'max-w-md';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-stretch justify-end"
      onClick={onClose}
    >
      <div
        className={`bg-white w-full ${widthClass} h-full shadow-xl flex flex-col animate-in slide-in-from-right duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-gray-700" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 truncate">{title}</h2>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">{footer}</div>
        )}
      </div>
    </div>
  );
}
