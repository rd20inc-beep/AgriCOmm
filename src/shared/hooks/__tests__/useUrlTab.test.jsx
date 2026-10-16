import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { useUrlTab, resolveTab, nextTabParams } from '../useUrlTab';
import { goBack, hasInAppHistory } from '../../utils/goBack';
import Breadcrumbs from '../../components/Breadcrumbs';

function Tabs() {
  const [tab] = useUrlTab('overview', ['overview', 'documents', 'shipment']);
  return <p data-tab={tab}>{tab}</p>;
}
const at = (url) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Tabs /></MemoryRouter>);

describe('useUrlTab (P5-08)', () => {
  it('a deep link ?tab= opens that tab', () => {
    expect(at('/export/EX-1?tab=documents')).toContain('data-tab="documents"');
  });

  it('no ?tab= opens the default tab', () => {
    expect(at('/export/EX-1')).toContain('data-tab="overview"');
  });

  it('an unknown or forbidden tab falls back to the default', () => {
    expect(at('/export/EX-1?tab=costing')).toContain('data-tab="overview"');
    expect(resolveTab('costing', 'overview', ['overview'])).toBe('overview');
    expect(resolveTab('anything', 'a')).toBe('anything');
  });

  it('selecting a tab keeps other params; the default tab drops ?tab=', () => {
    const prev = new URLSearchParams('status=Shipped&tab=documents');
    expect(nextTabParams(prev, 'shipment', 'overview').toString()).toBe('status=Shipped&tab=shipment');
    expect(nextTabParams(prev, 'overview', 'overview').toString()).toBe('status=Shipped');
  });
});

describe('goBack (P5-08)', () => {
  it('with no in-app history (QR scan / new tab) goes to the fallback, replacing the entry', () => {
    const navigate = vi.fn();
    goBack(navigate, '/lot-inventory', { idx: 0 });
    expect(navigate).toHaveBeenCalledWith('/lot-inventory', { replace: true });
    navigate.mockClear();
    goBack(navigate, '/export', null);
    expect(navigate).toHaveBeenCalledWith('/export', { replace: true });
  });

  it('with in-app history goes back one entry', () => {
    const navigate = vi.fn();
    goBack(navigate, '/export', { idx: 3 });
    expect(navigate).toHaveBeenCalledWith(-1);
  });

  it('reads window.history.state when none is passed', () => {
    const had = 'window' in globalThis;
    const prev = globalThis.window;
    globalThis.window = { history: { state: { idx: 2 } } };
    try {
      expect(hasInAppHistory()).toBe(true);
      globalThis.window = { history: { state: null } };
      expect(hasInAppHistory()).toBe(false);
    } finally {
      if (had) globalThis.window = prev; else delete globalThis.window;
    }
  });
});

describe('no dead-end Back buttons', () => {
  it('no page calls a bare navigate(-1); they go through goBack(navigate, fallback)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = new URL('../../../', import.meta.url).pathname;
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.jsx?$/.test(e.name) || p.endsWith(path.join('utils', 'goBack.js'))) continue;
        if (fs.readFileSync(p, 'utf8').includes('navigate(-1)')) hits.push(path.relative(root, p));
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  it('the tabbed detail pages keep their tab in the URL', async () => {
    const fs = await import('node:fs');
    const pages = [
      'modules/exportOrders/pages/ExportOrderDetail.jsx',
      'modules/inventory/pages/LotDetail.jsx',
      'modules/milling/pages/MillingBatchDetail.jsx',
      'modules/milling/pages/ServiceMillingBatchDetail.jsx',
    ];
    for (const p of pages) {
      const src = fs.readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
      expect(src, p).toContain('useUrlTab(');
      expect(src, p).toContain('<Breadcrumbs');
    }
  });
});

describe('Breadcrumbs', () => {
  const render = (items) => renderToStaticMarkup(<MemoryRouter><Breadcrumbs items={items} /></MemoryRouter>);
  it('links every crumb but the current page', () => {
    const html = render([{ label: 'Export Orders', to: '/export' }, { label: 'EX-004' }]);
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/export"');
    expect(html).toMatch(/<span aria-current="page"[^>]*>EX-004<\/span>/);
  });
  it('renders nothing until there is a trail (label still loading)', () => {
    expect(render([{ label: 'Export Orders', to: '/export' }, { label: undefined }])).toBe('');
  });
});
