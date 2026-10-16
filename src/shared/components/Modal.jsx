import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import DiscardChangesDialog from './DiscardChangesDialog';
import { escapeAction, requestClose } from '../utils/dirtyGuard';

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[calc(100vw-2rem)]',
};

/**
 * `dirty` (P5-07): while the form inside has unsaved changes, Escape, the X
 * button and a backdrop click ask "Discard unsaved changes?" in-app first.
 */
export default function Modal({ isOpen, onClose, title, children, size = 'md', footer, closeOnBackdrop = false, dirty = false, dirtyMessage }) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) { setWasOpen(isOpen); setConfirming(null); }
  const close = () => requestClose({ dirty, onClose, ask: (fn) => setConfirming(() => fn) });
  const latestRef = useRef({ close, asking: false });
  useEffect(() => { latestRef.current = { close, asking: !!confirming }; });

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    function handleEscape(e) {
      if (escapeAction(e, { asking: latestRef.current.asking })) latestRef.current.close();
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const widthClass = sizeClasses[size] || sizeClasses.md;

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Overlay — backdrop click does NOT close by default, so an accidental
          click while filling a form never wipes the entered data (use X/Cancel). */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={closeOnBackdrop ? close : undefined} aria-hidden="true" />

      {/* Modal card - slides up on mobile, centers on desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${widthClass} sm:mx-4 bg-white rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col`}
        style={{ maxHeight: 'min(90vh, 90dvh)' }}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 flex-shrink-0">
          {/* Mobile drag indicator */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-gray-300 sm:hidden" />
          <h2 id={titleId} className="text-base sm:text-lg font-semibold text-gray-900 pr-8">{title}</h2>
          <button
            type="button"
            onClick={close}
            className="absolute top-3.5 right-3.5 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-5 sm:px-6 py-3.5 border-t border-gray-100 flex-shrink-0 bg-gray-50/50 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
    <DiscardChangesDialog
      open={!!confirming}
      consequence={dirtyMessage}
      onDiscard={() => { const fn = confirming; setConfirming(null); fn?.(); }}
      onKeep={() => setConfirming(null)}
    />
    </>
  );
}
