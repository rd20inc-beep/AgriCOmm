/**
 * P5-07: the export-order wizard keeps a local draft per user, offers it back
 * when the page is opened again (a "remount"), and restores it into the form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { saveDraft, loadDraft } from '../../../shared/utils/formDraft';
import {
  EXPORT_WIZARD_DRAFT, wizardDraftSnapshot, restoreWizardDraft, wizardDraftHasContent, EMPTY_ITEM,
} from '../utils/createOrderForm';

let mockUser = { id: 42, role: 'Export Manager' };
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, hasPermission: () => true }),
}));
vi.mock('../../../context/AppContext', () => ({
  useApp: () => ({
    addToast: () => {}, customersList: [{ id: 5, name: 'Gulf Foods LLC' }], productsList: [],
    exportCostCategories: [], bagTypesList: [], suppliersList: [], bankAccountsList: [],
  }),
}));
// Per-page master data (P5-13) — the one buyer the drafts name.
vi.mock('../../../shared/hooks/useMasterData', () => ({
  useCustomersList: () => ({ data: [{ id: 5, name: 'Gulf Foods LLC' }], isLoading: false }), useSuppliersList: () => ({ data: [], isLoading: false }),
  useProductsList: () => ({ data: [], isLoading: false }), useWarehousesList: () => ({ data: [], isLoading: false }),
  useBagTypesList: () => ({ data: [], isLoading: false }), useBankAccountsList: () => ({ data: [], isLoading: false }),
  useExportOrdersList: () => ({ data: [], isLoading: false }), useMillingBatchesList: () => ({ data: [], isLoading: false }),
  useInventoryLots: () => ({ data: [], isLoading: false }), useCompanyProfile: () => ({}),
}));
vi.mock('../../../api/queries', () => ({
  useCreateExportOrder: () => ({ mutateAsync: vi.fn() }),
  useFxRates: () => ({ data: null }),
  useExportProfitPreview: () => ({ data: null, isFetching: false }),
  useExportOrder: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock('../../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../api/services', () => ({ exportOrdersApi: { list: vi.fn(() => Promise.resolve({})) } }));

const { default: CreateExportOrder } = await import('../pages/CreateExportOrder');

const render = () => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/export/create']}><CreateExportOrder /></MemoryRouter>
  </QueryClientProvider>,
);

const draftState = {
  form: { customerId: '5', currency: 'USD', incoterm: 'CFR', notes: 'half done' },
  items: [{ ...EMPTY_ITEM, productId: '3', qtyMT: '25', pricePerMT: '610' }],
  packingLines: [],
  printedBags: [],
  step: 2,
};

describe('export wizard local draft', () => {
  beforeEach(() => { localStorage.clear(); mockUser = { id: 42, role: 'Export Manager' }; });

  it('a fresh page offers nothing', () => {
    expect(render()).not.toContain('Restore draft');
  });

  it('after a remount the saved draft is offered back, naming the buyer', () => {
    saveDraft(EXPORT_WIZARD_DRAFT, 42, wizardDraftSnapshot(draftState));
    const html = render();
    expect(html).toContain('Restore draft');
    expect(html).toContain('Gulf Foods LLC');
  });

  it("another user's draft is not offered", () => {
    saveDraft(EXPORT_WIZARD_DRAFT, 42, wizardDraftSnapshot(draftState));
    mockUser = { id: 43, role: 'Export Manager' };
    expect(render()).not.toContain('Restore draft');
  });

  it('restoring brings back the entered values and the step', () => {
    saveDraft(EXPORT_WIZARD_DRAFT, 42, wizardDraftSnapshot(draftState));
    const saved = loadDraft(EXPORT_WIZARD_DRAFT, 42);
    const defaults = { form: { customerId: '', currency: 'USD', incoterm: 'FOB', advancePct: 20 }, items: [{ ...EMPTY_ITEM }], packingLines: [{ bagType: '' }], printedBags: [] };
    const r = restoreWizardDraft(saved.data, defaults);
    expect(r.form).toMatchObject({ customerId: '5', incoterm: 'CFR', notes: 'half done', advancePct: 20 });
    expect(r.items[0]).toMatchObject({ productId: '3', qtyMT: '25', pricePerMT: '610' });
    expect(r.packingLines).toEqual(defaults.packingLines); // empty in the draft → default line
    expect(r.step).toBe(2);
  });

  it('a malformed draft falls back to defaults instead of crashing', () => {
    const defaults = { form: { a: 1 }, items: [{ x: 1 }], packingLines: [], printedBags: [] };
    expect(restoreWizardDraft({ step: 9, items: 'x' }, defaults)).toEqual({ ...defaults, step: 1 });
    expect(wizardDraftHasContent({ form: {}, items: [{ ...EMPTY_ITEM }] })).toBe(false);
    expect(wizardDraftHasContent(draftState)).toBe(true);
  });
});
