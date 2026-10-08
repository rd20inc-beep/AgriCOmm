import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Tabbable elements inside `root`, in DOM order (skips hidden ones). */
export function getFocusable(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true'
      && (el.offsetParent !== null || el.getClientRects?.().length > 0),
  );
}

/**
 * Focus trap decision for a Tab keypress. Returns the element focus should
 * wrap to, or null to let the browser move focus normally.
 *   - Tab on the last element → first; Shift+Tab on the first → last.
 *   - Focus outside the list (e.g. on the panel itself) → first / last.
 */
export function trapTarget(focusables, active, shiftKey) {
  if (!focusables.length) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const idx = focusables.indexOf(active);
  if (idx === -1) return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

/**
 * Right-side sliding drawer — the canonical container for forms.
 *
 * Accessibility: role="dialog" + aria-modal, labelled by its title; Escape
 * closes; focus moves into the panel on open, Tab/Shift+Tab cycle inside it,
 * and focus returns to whatever opened it on close. A field with `autoFocus`
 * keeps its focus. Click-outside closes only with `closeOnBackdrop`.
 */
export default function SlideDrawer({ open, onClose, title, subtitle, icon: Icon, children, footer, size = 'md', closeOnBackdrop = false }) {
  const titleId = useId();
  const panelRef = useRef(null);
  // Callers often pass an inline onClose; read it through a ref so the open
  // effect below runs once per open, not on every render (re-running it would
  // yank focus out of the field being typed in).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // While any drawer is open, <body data-drawers="n"> lets floating widgets
  // (the chat bubble) step aside so they never cover the drawer's footer buttons.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const body = document.body;
    body.dataset.drawers = String((parseInt(body.dataset.drawers, 10) || 0) + 1);
    return () => {
      const n = (parseInt(body.dataset.drawers, 10) || 1) - 1;
      if (n > 0) body.dataset.drawers = String(n); else delete body.dataset.drawers;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });

    const onKey = (e) => {
      if (e.key === 'Escape') { onCloseRef.current?.(); return; }
      if (e.key !== 'Tab' || !panel) return;
      // Only trap when focus is in this drawer (a nested drawer or a confirm
      // dialog on top handles its own Tab).
      if (!panel.contains(document.activeElement)) return;
      const target = trapTarget(getFocusable(panel), document.activeElement, e.shiftKey);
      if (target) { e.preventDefault(); target.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) return null;

  const widthClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl' }[size] || 'max-w-md';
  const titleText = typeof title === 'string' || typeof title === 'number' ? String(title) : undefined;
  const subtitleText = typeof subtitle === 'string' || typeof subtitle === 'number' ? String(subtitle) : undefined;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-stretch justify-end"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-white w-full ${widthClass} h-full shadow-xl flex flex-col animate-in slide-in-from-right duration-200 outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0" aria-hidden="true">
                <Icon className="w-4 h-4 text-gray-700" />
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-gray-900 truncate" title={titleText}>{title}</h2>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate" title={subtitleText}>{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="-mr-2 inline-flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>

        {/* Pinned under the scrolling body; clears the phone's home indicator. */}
        {footer && (
          <div className="border-t border-gray-100 px-4 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gray-50">{footer}</div>
        )}
      </div>
    </div>
  );
}
