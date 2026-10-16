import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  requestClose, escapeAction, leavesPage, guardNavigator, beforeUnloadHandler, isFormDirty,
  DISCARD_TITLE,
} from '../dirtyGuard';
import { saveDraft, loadDraft, clearDraft, draftKey, DRAFT_MAX_AGE_MS } from '../formDraft';
import SlideDrawer from '../../../components/SlideDrawer';
import Modal from '../../components/Modal';
import DiscardChangesDialog from '../../components/DiscardChangesDialog';

// No DOM library is installed (see SlideDrawer.test.jsx), so the drawer's key
// handling is exercised through the exact functions it calls: Escape →
// escapeAction → requestClose.
function pressEscape({ dirty, asking = false }) {
  const onClose = vi.fn();
  const ask = vi.fn();
  if (escapeAction({ key: 'Escape' }, { asking })) requestClose({ dirty, onClose, ask });
  return { onClose, ask };
}

describe('Escape / close on a drawer or modal', () => {
  it('a dirty form asks before closing and does not close', () => {
    const { onClose, ask } = pressEscape({ dirty: true });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Confirming "Discard" runs the close the prompt was holding.
    ask.mock.calls[0][0]();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a clean form closes straight away', () => {
    const { onClose, ask } = pressEscape({ dirty: false });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it('Escape while the discard prompt is up does not close the form underneath', () => {
    const { onClose, ask } = pressEscape({ dirty: true, asking: true });
    expect(onClose).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('other keys are ignored', () => {
    expect(escapeAction({ key: 'Enter' }, { asking: false })).toBeNull();
  });
});

describe('dirty prop markup', () => {
  it('SlideDrawer and Modal render no prompt until a close is attempted', () => {
    const d = renderToStaticMarkup(<SlideDrawer open dirty onClose={() => {}} title="T"><input /></SlideDrawer>);
    expect(d).not.toContain(DISCARD_TITLE);
    const m = renderToStaticMarkup(<Modal isOpen dirty onClose={() => {}} title="T"><input /></Modal>);
    expect(m).not.toContain(DISCARD_TITLE);
  });

  it('Modal is a labelled dialog', () => {
    const m = renderToStaticMarkup(<Modal isOpen onClose={() => {}} title="Edit lot"><input /></Modal>);
    expect(m).toContain('role="dialog"');
    const id = /aria-labelledby="([^"]+)"/.exec(m)?.[1];
    expect(m).toContain(`id="${id}"`);
  });

  it('the prompt is the in-app dialog, not window.confirm', () => {
    const html = renderToStaticMarkup(<DiscardChangesDialog open onDiscard={() => {}} onKeep={() => {}} />);
    expect(html).toContain(DISCARD_TITLE);
    expect(html).toContain('Keep editing');
    expect(html).toContain('Discard');
  });
});

describe('route guard', () => {
  it('only a pathname change leaves the page (tabs/filters do not)', () => {
    expect(leavesPage('/export/EX-1?tab=documents', '/export/EX-1')).toBe(false);
    expect(leavesPage('?tab=x', '/export/EX-1')).toBe(false);
    expect(leavesPage({ search: '?tab=x' }, '/a')).toBe(false);
    expect(leavesPage('/export', '/export/create')).toBe(true);
    expect(leavesPage({ pathname: '/b' }, '/a')).toBe(true);
    expect(leavesPage(-1, '/a')).toBe(true);
  });

  it('wrapped navigator asks before leaving while dirty, and restores itself', () => {
    const push = vi.fn(); const replace = vi.fn(); const go = vi.fn();
    const nav = { push, replace, go };
    let dirty = true;
    const ask = vi.fn();
    const restore = guardNavigator(nav, { isDirty: () => dirty, ask, currentPathname: () => '/export/create' });

    nav.push('/export');
    expect(push).not.toHaveBeenCalled();
    expect(ask).toHaveBeenCalledTimes(1);
    ask.mock.calls[0][0](); // Discard → navigation proceeds
    expect(push).toHaveBeenCalledWith('/export');

    nav.replace('/export/create?tab=2'); // same page
    expect(replace).toHaveBeenCalledTimes(1);

    nav.go(-1);
    expect(go).not.toHaveBeenCalled();

    dirty = false;
    nav.go(-1);
    expect(go).toHaveBeenCalledWith(-1);

    restore();
    expect(nav.push).toBe(push);
    expect(nav.go).toBe(go);
  });

  it('beforeunload prompts only while dirty', () => {
    let dirty = false;
    const h = beforeUnloadHandler(() => dirty);
    const e = { preventDefault: vi.fn(), returnValue: undefined };
    h(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    dirty = true;
    h(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.returnValue).toBe('');
  });

  it('isFormDirty compares values, not identity', () => {
    expect(isFormDirty({ a: '1', b: [] }, { a: '1', b: [] })).toBe(false);
    expect(isFormDirty({ a: '1' }, { a: '2' })).toBe(true);
  });
});

describe('local form drafts', () => {
  beforeEach(() => localStorage.clear());

  it('are kept per form and per user', () => {
    saveDraft('f', 7, { x: 1 });
    expect(loadDraft('f', 7).data).toEqual({ x: 1 });
    expect(loadDraft('f', 8)).toBeNull();
    expect(draftKey('f', 7)).not.toBe(draftKey('f', 8));
    clearDraft('f', 7);
    expect(loadDraft('f', 7)).toBeNull();
  });

  it('a stale or corrupt draft is dropped, not offered', () => {
    saveDraft('f', 1, { x: 1 }, 1000);
    expect(loadDraft('f', 1, 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    localStorage.setItem(draftKey('f', 1), '{not json');
    expect(loadDraft('f', 1)).toBeNull();
  });
});
