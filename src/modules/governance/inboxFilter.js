/** Pure: the approvals-inbox items shown for a type filter and a search term. */
export function filterInboxItems(items, { type = 'all', q = '' } = {}) {
  const term = String(q || '').trim().toLowerCase();
  return (items || []).filter((i) => {
    if (type && type !== 'all' && i.type !== type) return false;
    if (!term) return true;
    return [i.title, i.summary, i.ref, i.requestedBy, i.typeLabel]
      .some((v) => String(v || '').toLowerCase().includes(term));
  });
}
