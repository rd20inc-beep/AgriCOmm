import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';

/**
 * "More actions" overflow: the uncommon things, one click away but out of the
 * way. items: [{ key, label, icon, to } | { key, label, icon, onClick }].
 * Keyboard: Enter/Space opens, Escape closes and returns focus, arrows move.
 */
export default function MoreActionsMenu({ items = [], label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus();
    const onDoc = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!items.length) return null;

  const close = () => { setOpen(false); btnRef.current?.focus(); };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    const i = els.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
    els[next]?.focus();
  };
  const cls = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none';

  return (
    <div className="relative">
      <button ref={btnRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)} data-testid="more-actions"
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
        <MoreHorizontal size={14} aria-hidden="true" /> {label}
      </button>
      {open && (
        <div ref={menuRef} id={id} role="menu" aria-label={label} onKeyDown={onKeyDown}
          className="absolute right-0 top-full mt-1 z-30 min-w-[230px] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {items.map((it) => {
            const Icon = it.icon;
            const content = <>{Icon && <Icon size={14} className="text-gray-400 shrink-0" aria-hidden="true" />}<span>{it.label}</span></>;
            return it.to
              ? <Link key={it.key} to={it.to} role="menuitem" className={cls} onClick={() => setOpen(false)} data-testid={`more-${it.key}`}>{content}</Link>
              : <button key={it.key} type="button" role="menuitem" className={cls} data-testid={`more-${it.key}`} onClick={() => { setOpen(false); it.onClick?.(); }}>{content}</button>;
          })}
        </div>
      )}
    </div>
  );
}
