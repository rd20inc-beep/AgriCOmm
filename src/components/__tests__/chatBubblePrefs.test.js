import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isChatHidden, setChatHidden, getChatPos, setChatPos, clampToViewport, onChatPrefsChange,
} from '../chatBubblePrefs';

// The node test environment has no window/localStorage; give it the minimum.
beforeEach(() => {
  const store = new Map();
  global.window = global.window || {};
  window.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  window.innerWidth = 1280;
  window.innerHeight = 800;
  window.addEventListener = window.addEventListener || (() => {});
  window.removeEventListener = window.removeEventListener || (() => {});
  window.dispatchEvent = window.dispatchEvent || (() => true);
  global.CustomEvent = global.CustomEvent || class { constructor(t) { this.type = t; } };
});

describe('chat bubble preferences', () => {
  it('defaults to visible in its normal corner', () => {
    expect(isChatHidden()).toBe(false);
    expect(getChatPos()).toBeNull();      // null = the default corner, not 0,0
  });

  it('remembers being hidden, and being brought back', () => {
    setChatHidden(true);
    expect(isChatHidden()).toBe(true);
    setChatHidden(false);
    expect(isChatHidden()).toBe(false);
  });

  it('round-trips a position, rounding to whole pixels', () => {
    setChatPos({ x: 120.6, y: 40.2 });
    expect(getChatPos()).toEqual({ x: 121, y: 40 });
  });

  it('a corrupt stored position falls back to the default corner', () => {
    window.localStorage.setItem('riceflow_chat_pos', 'not json');
    expect(getChatPos()).toBeNull();
    window.localStorage.setItem('riceflow_chat_pos', '{"x":"left"}');
    expect(getChatPos()).toBeNull();
  });

  it('clamps to the viewport so a resize cannot strand the bubble', () => {
    expect(clampToViewport({ x: 99999, y: 99999 })).toEqual({ x: 1280 - 56 - 4, y: 800 - 56 - 4 });
    expect(clampToViewport({ x: -500, y: -500 })).toEqual({ x: 4, y: 4 });
    expect(clampToViewport({ x: 300, y: 200 })).toEqual({ x: 300, y: 200 });
  });

  it('survives storage being unavailable (private window) without throwing', () => {
    window.localStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(() => setChatHidden(true)).not.toThrow();
    expect(isChatHidden()).toBe(false);   // falls back to visible, never invisible-by-accident
    expect(getChatPos()).toBeNull();
  });

  it('subscribing returns an unsubscribe function', () => {
    window.addEventListener = vi.fn();
    window.removeEventListener = vi.fn();
    const off = onChatPrefsChange(() => {});
    expect(window.addEventListener).toHaveBeenCalledTimes(2);   // custom event + cross-tab storage
    off();
    expect(window.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
