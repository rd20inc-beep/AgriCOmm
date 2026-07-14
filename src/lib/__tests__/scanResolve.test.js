// Stage 14 — scan resolution (pure).
import { describe, test, expect } from 'vitest';
import { resolveScan, deepLink } from '../scanResolve';

describe('resolveScan', () => {
  test('agrice:// deep links map to app routes', () => {
    expect(resolveScan('agrice://lot/123')).toMatchObject({ ok: true, path: '/lot-inventory/123' });
    expect(resolveScan('agrice://batch/M-42')).toMatchObject({ ok: true, path: '/milling/M-42' });
    expect(resolveScan('agrice://order/7')).toMatchObject({ ok: true, path: '/export/7' });
    expect(resolveScan('agrice://sale/9')).toMatchObject({ ok: true, path: '/local-sales/9' });
  });

  test('unknown deep-link kind → error', () => {
    expect(resolveScan('agrice://widget/1').ok).toBe(false);
  });

  test('a full app URL uses its path', () => {
    expect(resolveScan('https://agricommodities.online/lot-inventory/55')).toMatchObject({ ok: true, path: '/lot-inventory/55' });
  });

  test('a bare app path passes through', () => {
    expect(resolveScan('/milling/M-9')).toMatchObject({ ok: true, path: '/milling/M-9' });
  });

  test('bare milling batch number resolves', () => {
    expect(resolveScan('M-042')).toMatchObject({ ok: true, path: '/milling/M-042' });
    expect(resolveScan('m-7')).toMatchObject({ ok: true, path: '/milling/M-7' });
  });

  test('empty / unrecognized → error (not a crash)', () => {
    expect(resolveScan('').ok).toBe(false);
    expect(resolveScan('random-string').ok).toBe(false);
  });

  test('deepLink builds a scannable value', () => {
    expect(deepLink('lot', 123)).toBe('agrice://lot/123');
  });
});
