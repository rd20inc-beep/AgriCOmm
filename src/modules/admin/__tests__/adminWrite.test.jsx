import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { canWriteTab, AdminWriteContext } from '../pages/admin/adminWrite';

/**
 * Admin tabs hide Add / Edit / Delete unless the user holds the permission the
 * tab's write routes check (ADM-18). Admin.jsx provides AdminWriteContext.
 */
const allow = (...p) => (m, a) => p.includes(`${m}.${a}`);

vi.mock('../../../api/queries', () => ({
  useCreateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../../context/AppContext', () => ({
  useApp: () => ({ addToast: vi.fn(), customersList: [{ id: 1, name: 'Buyer One', country: 'UAE', isActive: true }] }),
}));
// P5-13: pages read their lists from the per-page hooks, not AppContext.
vi.mock('../../../shared/hooks/useMasterData', () => ({
  useCustomersList: () => ({ data: [{ id: 1, name: 'Buyer One', country: 'UAE', isActive: true }] }),
  useSuppliersList: () => ({ data: [] }),
  useProductsList: () => ({ data: [] }),
  useWarehousesList: () => ({ data: [] }),
  useBagTypesList: () => ({ data: [] }),
  useBankAccountsList: () => ({ data: [] }),
  useExportOrdersList: () => ({ data: [] }),
  useMillingBatchesList: () => ({ data: [] }),
  useInventoryLots: () => ({ data: [] }),
  useCompanyProfile: () => ({ name: 'AGRI COMMODITIES' }),
  useAppSettings: () => ({ settings: { paymentReminderDays: 7 }, updateSettings: vi.fn() }),
}));
// PartyLink reads the user's finance.view (P5-05).
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => vi.fn() }));
vi.mock('../../../hooks/useConfirm', () => ({ default: () => [vi.fn(), null] }));

describe('canWriteTab', () => {
  it('master-data tabs need admin.manage_master_data', () => {
    expect(canWriteTab('customers', allow('admin.view'))).toBe(false);
    expect(canWriteTab('customers', allow('admin.view', 'admin.manage_master_data'))).toBe(true);
  });
  it('approvals need master_data.approve, settings need admin.manage_settings', () => {
    expect(canWriteTab('approvals', allow('admin.manage_master_data'))).toBe(false);
    expect(canWriteTab('approvals', allow('master_data.approve'))).toBe(true);
    expect(canWriteTab('settings', allow('admin.view'))).toBe(false);
  });
  it('tabs with their own gates stay writable here', () => {
    expect(canWriteTab('haulers', allow())).toBe(true);
  });
});

describe('CustomersTab honours the context', async () => {
  const { default: CustomersTab } = await import('../pages/admin/CustomersTab');
  const render = (canWrite) => renderToStaticMarkup(
    <MemoryRouter><AdminWriteContext.Provider value={canWrite}><CustomersTab /></AdminWriteContext.Provider></MemoryRouter>,
  );
  it('read-only: no Add / Edit / Delete', () => {
    const html = render(false);
    expect(html).not.toMatch(/Add New|aria-label="Edit Buyer One"|aria-label="Delete Buyer One"/);
  });
  it('writer: Add / Edit / Delete shown', () => {
    const html = render(true);
    expect(html).toMatch(/Add New/);
    expect(html).toMatch(/aria-label="Delete Buyer One"/);
  });
});
