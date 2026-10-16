/**
 * Keyboard support for things that are clicked but are not buttons or links
 * (P5-14) — mainly table rows that open a record. A row keeps its table
 * semantics; it becomes focusable (Tab) and Enter / Space activate it, exactly
 * like a click.
 *
 *   <tr {...clickableProps(() => navigate(`/milling/${b.id}`))} className="cursor-pointer">
 *
 * Keys pressed on a control INSIDE the row (a button, an input) are left to
 * that control, so Enter on a row's own "Pay" button doesn't also open the row.
 */
export function activateOnKey(handler) {
  return (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    handler(e);
  };
}

export function clickableProps(handler, { label, expanded } = {}) {
  return {
    onClick: handler,
    onKeyDown: activateOnKey(handler),
    tabIndex: 0,
    ...(label ? { 'aria-label': label } : {}),
    ...(expanded !== undefined ? { 'aria-expanded': !!expanded } : {}),
  };
}
