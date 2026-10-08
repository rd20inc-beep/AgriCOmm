import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SlideDrawer, { trapTarget } from '../SlideDrawer';

// No DOM library (jsdom / testing-library) is installed, so the markup is
// checked through server rendering and the focus-trap decision as a pure
// function. Escape / focus-return run in a browser effect.
const render = (props) => renderToStaticMarkup(
  <SlideDrawer open onClose={() => {}} {...props}><input name="qty" /></SlideDrawer>,
);

describe('SlideDrawer markup', () => {
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<SlideDrawer open={false} onClose={() => {}} title="X" />)).toBe('');
  });

  it('is a modal dialog labelled by its title', () => {
    const html = render({ title: 'Record payment' });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain('tabindex="-1"');
  });

  it('has a labelled, non-submitting close button', () => {
    const html = render({ title: 'T' });
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Close"/);
  });

  it('puts the full title / subtitle on hover since they truncate', () => {
    const long = 'Pay Al-Hafiz Rice Traders against PL-0042 and PL-0043';
    const html = render({ title: long, subtitle: 'Balance Rs 1,234,567' });
    expect(html).toContain(`title="${long}"`);
    expect(html).toContain('title="Balance Rs 1,234,567"');
  });

  it('omits the hover title when the title is not plain text', () => {
    const html = render({ title: <span>Node</span> });
    expect(html).not.toMatch(/<h2[^>]*title=/);
    expect(html).toContain('<span>Node</span>');
  });

  it('keeps the size prop', () => {
    expect(render({ title: 'T', size: '3xl' })).toContain('max-w-3xl');
    expect(render({ title: 'T', size: 'bogus' })).toContain('max-w-md');
  });
});

describe('trapTarget (Tab focus trap)', () => {
  const a = { n: 'a' }, b = { n: 'b' }, c = { n: 'c' };
  const list = [a, b, c];
  it('wraps Tab on the last element to the first', () => expect(trapTarget(list, c, false)).toBe(a));
  it('wraps Shift+Tab on the first element to the last', () => expect(trapTarget(list, a, true)).toBe(c));
  it('lets the browser move focus in the middle', () => {
    expect(trapTarget(list, b, false)).toBeNull();
    expect(trapTarget(list, b, true)).toBeNull();
    expect(trapTarget(list, a, false)).toBeNull();
  });
  it('pulls focus from the panel itself to the first / last element', () => {
    expect(trapTarget(list, { n: 'panel' }, false)).toBe(a);
    expect(trapTarget(list, { n: 'panel' }, true)).toBe(c);
  });
  it('does nothing when the drawer has nothing focusable', () => expect(trapTarget([], a, false)).toBeNull());
});

describe('SlideDrawer keeps the chat bubble off its buttons', () => {
  it('the chat launcher is hidden while body[data-drawers] is set', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/body\[data-drawers\]\s+\.chat-launcher\s*\{\s*display:\s*none;/);
    const chat = fs.readFileSync(new URL('../ChatWidget.jsx', import.meta.url), 'utf8');
    expect(chat).toContain('chat-launcher fixed');
    const drawer = fs.readFileSync(new URL('../SlideDrawer.jsx', import.meta.url), 'utf8');
    expect(drawer).toContain('body.dataset.drawers');
  });
});
