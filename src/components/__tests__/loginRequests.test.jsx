import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * P5-13 — logging in no longer loads the whole database. AppProvider fetches
 * nothing; the shell asks only for its badges. Rendering the signed-in app
 * frame (AppProvider + the shell, no page) registers a small, bounded set of
 * queries, none of them the old master lists / orders / batches / lots /
 * admin settings.
 */

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { full_name: 'Owner', email: 'o@test', role: 'Owner', permissions: [] },
    hasPermission: () => true, // Owner passes every check — the worst case
    token: 'tkn',
    isAuthenticated: true,
    logout: () => {},
  }),
}));
vi.mock('../../api/client', () => ({ default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../ErrorBoundary', () => ({ RouteErrorBoundary: ({ children }) => children }));
vi.mock('../../shared/components/Skeleton', () => ({ SkeletonPage: () => null }));
vi.mock('../ChatWidget', () => ({ default: () => null }));
for (const w of ['OfflineBanner', 'PendingSyncTray', 'OfflineExpiredGate', 'SyncStatusChip', 'SyncConflictsDrawer', 'ScanDrawer']) {
  vi.doMock(`../${w}`, () => ({ default: () => null }));
}

const { AppProvider } = await import('../../context/AppContext');
const { default: Layout } = await import('../Layout');

const OLD_LOGIN_KEYS = ['export-orders', 'milling-batches', 'customers', 'suppliers', 'products', 'warehouses',
  'bag-types', 'bank-accounts', 'inventory', 'settings'];

describe('requests at login', () => {
  it('AppProvider + shell register only the shell badges (bounded), none of the old bulk lists', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/']}>
          <AppProvider>
            <Layout><div>page</div></Layout>
          </AppProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const keys = qc.getQueryCache().getAll().map((q) => q.queryKey);
    for (const k of keys) expect(OLD_LOGIN_KEYS).not.toContain(k[0]);
    expect(keys.length).toBeLessThanOrEqual(5);
  });

  it('AppContext imports no data hooks', () => {
    const text = readFileSync(fileURLToPath(new URL('../../context/AppContext.jsx', import.meta.url)), 'utf8');
    expect(text).not.toMatch(/from '\.\.\/api\/queries'/);
    expect(text).not.toMatch(/use(ExportOrders|MillingBatches|Customers|Suppliers|Products|Warehouses|BagTypes|BankAccounts|Inventory|Settings)\(/);
  });
});
