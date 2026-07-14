// Stage 14 — QR generation.
import { describe, test, expect } from 'vitest';
import { generateQrSvg, generateQrDataUrl } from '../qr';

describe('qr', () => {
  test('generateQrSvg returns an <svg> string', async () => {
    const svg = await generateQrSvg('agrice://lot/123', { size: 120 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  test('generateQrDataUrl returns a PNG data URL', async () => {
    const url = await generateQrDataUrl('agrice://lot/123');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });
});
