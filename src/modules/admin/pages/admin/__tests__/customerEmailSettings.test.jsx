// P5-12: the opt-in switches the owner sees are exactly the events the backend
// gates (backend/src/modules/communications/customerEmailPolicy.js), and every
// one renders OFF until switched on.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

vi.mock('../../../../../api/client', () => ({ default: { get: vi.fn(() => new Promise(() => {})), put: vi.fn() } }));

const { default: CustomerEmailSettings } = await import('../CustomerEmailSettings');
const { CUSTOMER_EMAIL_EVENTS } = await import('../customerEmailEvents');

describe('Automatic customer emails settings', () => {
  it('lists the same events the backend policy gates', () => {
    const src = fs.readFileSync(path.resolve(HERE, '../../../../../../backend/src/modules/communications/customerEmailPolicy.js'), 'utf8');
    const block = src.match(/CUSTOMER_EMAIL_EVENTS = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
    const backendKeys = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(CUSTOMER_EMAIL_EVENTS.map((e) => e.key).sort()).toEqual(backendKeys);
  });

  it('says the emails are off by default', () => {
    const html = renderToStaticMarkup(<CustomerEmailSettings addToast={() => {}} />);
    expect(html).toMatch(/Automatic customer emails/);
    expect(html).toMatch(/Off by default/);
  });
});
