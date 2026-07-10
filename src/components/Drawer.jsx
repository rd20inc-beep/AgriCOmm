import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Slide-from-right drawer. Used as a modern alternative to centered
 * modals for forms with more than ~3 fields. Closes on ESC and on
 * backdrop click. The body is locked while open to prevent scroll-leak.
 *
 * Props:
 *   isOpen      boolean
 *   onClose     () => void
 *   title       string
 *   subtitle    string (optional)
 *   width       'sm' | 'md' | 'lg' | 'xl'  (default 'md' → 480px)
 *   footer      ReactNode (sticky bottom — action buttons)
 *   children    ReactNode (scrollable body)
 */
const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export default function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  width = 'md',
  footer,
  children,
  closeOnBackdrop = false,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  // Render even when closed so the transition is symmetric — `pointer-events`
  // toggles so the backdrop doesn't block clicks while invisible.
  return (
    <div
      className={`fixed inset-0 z-50 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!isOpen}
    >
      {/* Backdrop — does not close on click by default (avoid losing form data). */}
      <div
        onClick={closeOnBackdrop ? onClose : undefined}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={`absolute top-0 right-0 h-full w-full ${WIDTHS[width] || WIDTHS.md}
          bg-white shadow-2xl flex flex-col
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="drawer-title" className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>
        {/* Footer (sticky) */}
        {footer && (
          <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
