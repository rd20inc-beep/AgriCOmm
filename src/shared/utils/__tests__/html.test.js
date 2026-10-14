import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeFields } from '../html';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });
  it('null/undefined become empty, numbers become text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(12.5)).toBe('12.5');
  });
});

describe('escapeFields', () => {
  it('escapes nested strings, keeps numbers/booleans/null', () => {
    const out = escapeFields({ workerName: '<b>A</b>', netPay: 100, paid: true, x: null, lines: [{ role: '"r"' }] });
    expect(out).toEqual({ workerName: '&lt;b&gt;A&lt;/b&gt;', netPay: 100, paid: true, x: null, lines: [{ role: '&quot;r&quot;' }] });
  });
  it('leaves *Json keys untouched so they still parse', () => {
    const sj = JSON.stringify([{ name: 'EOBI', amount: 5 }]);
    const out = escapeFields({ statutoryJson: sj, statutory_json: [{ name: '<x>' }] });
    expect(JSON.parse(out.statutoryJson)).toEqual([{ name: 'EOBI', amount: 5 }]);
    expect(out.statutory_json[0].name).toBe('<x>');
  });
  it('does not mutate its input', () => {
    const src = { name: '<a>' };
    escapeFields(src);
    expect(src.name).toBe('<a>');
  });
});
