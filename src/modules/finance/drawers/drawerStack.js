// The Finance drawer stack. A drawer opened from another stacks on top of it
// (a Payment form from a Document drawer); closing the top one returns to the
// one beneath. `replace` swaps the top one (a picker → the form it picked).
export function drawerStack(state, action) {
  switch (action?.type) {
    case 'open': return [...state, action.drawer];
    case 'replace': return state.length ? [...state.slice(0, -1), action.drawer] : [action.drawer];
    case 'close': return state.slice(0, -1);
    case 'reset': return [];
    default: return state;
  }
}
