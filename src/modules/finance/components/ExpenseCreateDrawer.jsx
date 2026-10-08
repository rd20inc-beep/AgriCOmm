import { btnPrimary, btnSecondary } from '../utils/uiClasses';
import { useMemo, useState } from 'react';
import { DollarSign, Loader2, Receipt, Calendar } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import SlideDrawer from '../../../components/SlideDrawer';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../api/client';
import { useExpenseVendors } from '../../../api/queries';
import { favStar } from '../../../shared/utils/favorites';
import { accountsForCurrency } from '../../../shared/utils/accountCurrency';
import { CHEQUE_DATE_LABEL } from '../../../components/payments/paymentPayload';
import { ChequeHint } from '../../../components/payments/PaymentFields';
import { todayLocalISO } from '../../../shared/utils/format';
import FieldError from '../../../shared/components/FieldError';
import SupplierPicker from '../../../components/SupplierPicker';
import { TYPES, CATEGORIES, UTILITY_VENDORS, expenseCreatePayload } from '../utils/expenseCatalogue';

// The new-expense form. It used to be a card that opened inline above the
// Expenses table; it is a drawer now, opened from that view's New Expense and
// from the Finance header's + Expense, so the form is the same wherever it is
// started.


// ─── New expense, as a drawer ─────────────────────────────────────────
// POST /api/expenses is finance.allocate_cost (expenses.routes.js); the
// buttons that open this ask the same.
function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/api/expenses', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['payables'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
  });
}

const INIT_FORM = () => ({
  expense_type: 'general', category: 'utility_bill',
  amount: '', currency: 'PKR', vendor_name: '', supplier_id: '',
  expense_date: todayLocalISO(), due_date: '',
  invoice_reference: '', description: '',
  batch_id: '', order_id: '', owner_name: '',
  pay_now: false, bank_account_id: '', payment_method: 'bank_transfer',
});

export default function ExpenseCreateDrawer({ open = true, onClose, onCreated }) {
  const { addToast, suppliersList, bankAccountsList, millingBatches, exportOrders } = useApp() || {};
  const createMut = useCreateExpense();
  const [form, setForm] = useState(INIT_FORM);
  const [errors, setErrors] = useState({});

  // Payments-only roles (Finance Manager) can't load /milling|/export, so the
  // AppContext batch/order lists are empty for them. Fall back to the finance
  // reference-only feed (batch/order numbers, no party names) so the link
  // pickers still populate.
  const { data: linkOpts } = useQuery({
    queryKey: ['finance', 'expense-link-options'],
    queryFn: async () => {
      const res = await api.get('/api/finance/expense-link-options');
      return res?.data || res || { batches: [], orders: [] };
    },
    staleTime: 60 * 1000,
    enabled: open,
  });
  const ctxBatches = Array.isArray(millingBatches) ? millingBatches : [];
  const ctxOrders = Array.isArray(exportOrders) ? exportOrders : [];
  const safeBatches = ctxBatches.length ? ctxBatches : (linkOpts?.batches || []);
  const safeOrders = ctxOrders.length ? ctxOrders : (linkOpts?.orders || []);

  const setF = (k, v) => setForm((p) => {
    const u = { ...p, [k]: v };
    if (k === 'expense_type') {
      u.category = (CATEGORIES[v] || CATEGORIES.general)[0].value;
      u.batch_id = ''; u.order_id = ''; u.owner_name = ''; u.supplier_id = ''; u.vendor_name = '';
    }
    if (k === 'category') {
      // The vendor kind likely changed too — clear a stale supplier so a rice
      // supplier is not carried into a utility bill.
      u.supplier_id = ''; u.vendor_name = '';
    }
    return u;
  });

  const cats = CATEGORIES[form.expense_type] || CATEGORIES.general;
  const currentCat = cats.find((c) => c.value === form.category) || cats[0];
  const vendorKind = currentCat.vendorKind;
  const { data: vendorData } = useExpenseVendors();
  const apiCategory = currentCat.apiCategory;
  const apiVendors = useMemo(() => {
    if (!apiCategory) return null;
    return (vendorData?.byCategory?.[apiCategory] || []).map((v) => v.name);
  }, [apiCategory, vendorData]);

  async function handleCreate(e) {
    e.preventDefault();
    if (createMut.isPending) return;
    const errs = {};
    if (!form.amount) errs.amount = 'Amount is required';
    if (!form.category) errs.category = 'Category is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const res = await createMut.mutateAsync(expenseCreatePayload(form, vendorKind));
      addToast?.('Expense recorded', 'success');
      setForm(INIT_FORM());
      onCreated?.(res);
      onClose?.();
    } catch (err) { addToast?.(err?.data?.message || err?.response?.data?.message || err.message, 'error'); }
  }

  return (
    <SlideDrawer open={open} onClose={onClose} title="New expense" subtitle="Recorded as a bill — pay now or later" icon={Receipt} size="2xl"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" form="expense-create-form" disabled={createMut.isPending} className={btnPrimary}>
            {createMut.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <DollarSign size={16} aria-hidden="true" />} Record expense
          </button>
        </div>
      )}>
      <ExpenseForm
        form={form} setF={setF} cats={cats} currentCat={currentCat} vendorKind={vendorKind}
        apiVendors={apiVendors} apiCategory={apiCategory}
        suppliersList={suppliersList || []} bankAccountsList={bankAccountsList || []}
        safeBatches={safeBatches} safeOrders={safeOrders}
        showBatchPicker={form.expense_type === 'mill'} showOrderPicker={form.expense_type === 'export'}
        showOwnerField={form.expense_type === 'personal'}
        handleCreate={handleCreate} errors={errors} addToast={addToast}
      />
    </SlideDrawer>
  );
}

export function ExpenseForm({
  form, setF, cats, currentCat, vendorKind, apiVendors, apiCategory,
  suppliersList, bankAccountsList, safeBatches, safeOrders,
  showBatchPicker, showOrderPicker, showOwnerField,
  handleCreate, errors = {}, addToast,
}) {
  // Only Super Admin / Owner see the batch's supplier / order's customer in the
  // link pickers — restricted roles pick by reference number (batch/order) only.
  const { user } = useAuth();
  const canSeeNames = user?.role === 'Owner' || user?.role === 'Super Admin';
  return (
    <form id="expense-create-form" onSubmit={handleCreate} className="space-y-5">

      {/* Type tiles */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-2 tracking-wider">What kind of expense?</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TYPES.map(t => {
            const Icon = t.icon;
            const active = form.expense_type === t.value;
            return (
              <button key={t.value} type="button" onClick={() => setF('expense_type', t.value)}
                className={`p-3 rounded-lg border-2 text-left transition-all flex items-center gap-2 ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <Icon size={16} className={active ? 'text-blue-500' : 'text-gray-400'} />
                <span className="text-sm font-semibold">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category grid (icon cards instead of select) */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-2 tracking-wider">Category <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {cats.map(c => {
            const Icon = c.icon;
            const active = form.category === c.value;
            return (
              <button key={c.value} type="button" onClick={() => setF('category', c.value)}
                className={`p-2.5 rounded-lg border text-left flex items-center gap-2 transition-all ${
                  active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <span className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${active ? 'bg-blue-100 text-blue-600' : 'bg-gray-50 text-gray-500'}`}>
                  <Icon size={14} />
                </span>
                <span className={`text-xs font-medium leading-tight ${active ? 'text-blue-900' : 'text-gray-700'}`}>{c.label}</span>
              </button>
            );
          })}
        </div>
        <FieldError error={errors.category} />
      </div>

      {/* Amount + Date row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Amount <span className="text-red-500">*</span></label>
          <div className="flex">
            <select value={form.currency} onChange={e => setF('currency', e.target.value)}
              className="border border-r-0 border-gray-300 rounded-l-lg px-2 py-2.5 text-sm bg-gray-50 outline-none w-20">
              <option>PKR</option><option>USD</option><option>EUR</option><option>GBP</option>
            </select>
            <input
              type="number" min="0" step="any"
              value={form.amount}
              onChange={e => setF('amount', e.target.value)}
              placeholder="0.00"
              className="flex-1 border border-gray-300 rounded-r-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
              required
              autoFocus
            />
          </div>
          <FieldError error={errors.amount} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Date <span className="text-red-500">*</span></label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="date" value={form.expense_date} onChange={e => setF('expense_date', e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
        </div>
      </div>

      {/* Vendor — kind-aware */}
      {!showOwnerField && (
        <VendorSection
          vendorKind={vendorKind}
          apiVendors={apiVendors}
          apiCategory={apiCategory}
          form={form}
          setF={setF}
          suppliersList={suppliersList}
          bankAccountsList={bankAccountsList}
          addToast={addToast}
        />
      )}

      {/* Owner selector for personal expenses */}
      {showOwnerField && (
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Owner <span className="text-red-500">*</span></label>
          <select value={form.owner_name} onChange={e => setF('owner_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">Select owner</option>
            <option value="Akmal Amin">Akmal Amin</option>
            <option value="Anzal Amin">Anzal Amin</option>
            <option value="Afnan Amin">Afnan Amin</option>
          </select>
        </div>
      )}

      {/* Reference + Description */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Invoice / Reference</label>
          <input type="text" value={form.invoice_reference} onChange={e => setF('invoice_reference', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Bill / receipt number" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">Description</label>
          <input type="text" value={form.description} onChange={e => setF('description', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="What is this expense for?" />
        </div>
      </div>

      {/* Linkage */}
      {showBatchPicker && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <label className="block text-[11px] font-semibold text-blue-800 uppercase mb-1 tracking-wider">Link to Milling Batch</label>
          <select value={form.batch_id} onChange={e => setF('batch_id', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">No specific batch — general mill expense</option>
            {safeBatches.filter(b => !['Closed', 'Cancelled', 'Rejected'].includes(b.status)).map(b =>
              <option key={b.id} value={b.dbId || b.id}>
                {b.id}{canSeeNames ? ` — ${b.supplierName || 'Unknown'}` : ''} ({Number(b.rawQtyMT || 0).toFixed(1)} MT) [{b.status}]
              </option>
            )}
          </select>
          <p className="text-[11px] text-blue-600 mt-1">If linked, this cost appears on the batch's Costs tab automatically.</p>
        </div>
      )}

      {showOrderPicker && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          <label className="block text-[11px] font-semibold text-emerald-800 uppercase mb-1 tracking-wider">Link to Export Order</label>
          <select value={form.order_id} onChange={e => setF('order_id', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">No specific order — general export expense</option>
            {safeOrders.filter(o => !['Closed', 'Cancelled'].includes(o.status)).map(o =>
              <option key={o.id} value={o.dbId || o.id}>
                {o.id}{canSeeNames ? ` — ${o.customerName}` : ''} ({Number(o.qtyMT || 0).toFixed(1)} MT, {o.country}) [{o.status}]
              </option>
            )}
          </select>
          <p className="text-[11px] text-emerald-700 mt-1">If linked, this cost appears on the order's Financials tab.</p>
        </div>
      )}

      {/* Payment */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.pay_now} onChange={e => setF('pay_now', e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600" />
          <span className="text-sm font-medium text-gray-700">Pay now (debit bank account)</span>
        </label>
        {form.pay_now && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Bank Account <span className="text-red-500">*</span></label>
              <select value={form.bank_account_id} onChange={e => setF('bank_account_id', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">Select bank</option>
                {accountsForCurrency(bankAccountsList, 'PKR').map(b => <option key={b.id} value={b.id}>{favStar(b)}{b.name} ({b.currency})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Method</label>
              <select value={form.payment_method} onChange={e => setF('payment_method', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="online">Online</option>
              </select>
            </div>
            {form.payment_method === 'cheque' && (
              <p className="sm:col-span-2 text-[11px] text-amber-700">
                Cheques settle when you clear them in Due Dates — this expense stays unpaid until then. The due date above is when the cheque clears.
              </p>
            )}
          </div>
        )}
        {!form.pay_now && <p className="text-[11px] text-gray-400 mt-1">Will be saved as unpaid — mark it paid later.</p>}
      </div>

    </form>
  );
}


function VendorSection({ vendorKind, apiVendors, apiCategory, form, setF, suppliersList, bankAccountsList, addToast }) {
  // DB-backed apiVendors wins when the current category is mapped to
  // an expense_vendors row (Admin → Expense Vendors). Falls back to
  // the legacy vendorKind suggestions when no mapping exists.
  const useApi = Array.isArray(apiVendors) && apiVendors.length > 0;

  // Build the suggestion list and helper text per vendorKind.
  const config = useMemo(() => {
    // A SUPPLIER-kind category must offer the supplier master, not only a list of
    // provider names — a typed name cannot reach a ledger, and this check used to
    // sit BELOW the useApi branch. Both supplier-kind categories (transport and
    // bags) are mapped to expense_vendors presets, so useApi always won and the
    // supplier picker never rendered anywhere in the app: every expense was
    // written with supplier_id NULL and none of them appeared on any supplier's
    // statement. The presets are still offered, as suggestions on the one-off
    // payee field below the picker.
    if (vendorKind === 'supplier') {
      return {
        title: 'Supplier',
        help: 'Pick a supplier and this expense appears on their ledger. Leave it blank and type a one-off payee instead.',
        options: useApi ? apiVendors : [],
        listId: useApi ? `expense-api-${apiCategory}` : null,
        placeholder: 'One-off payee (not on a ledger)',
        supplierDropdown: true,
      };
    }
    if (useApi) {
      return {
        title: 'Provider',
        help: `Pick from ${apiCategory} providers (manage in Admin → Expense Vendors), or type a custom one.`,
        listId: `expense-api-${apiCategory}`,
        options: apiVendors,
        placeholder: `Select a ${apiCategory} provider…`,
      };
    }
    switch (vendorKind) {
      case 'utility':
        return {
          title: 'Billing Company',
          help: 'Pick the utility / telco company billing this expense, or type a custom one.',
          listId: 'expense-utility-vendors',
          options: UTILITY_VENDORS,
          placeholder: 'e.g. K-Electric, SSGC, WAPDA',
        };
      case 'bank':
        return {
          title: 'Bank',
          help: 'Bank issuing the charges — pick from your bank accounts or type one.',
          listId: 'expense-bank-vendors',
          options: bankAccountsList.map(b => b.bankName || b.name).filter(Boolean),
          placeholder: 'e.g. Habib Bank Limited',
        };
      case 'landlord':
        return {
          title: 'Landlord / Property Owner',
          help: 'Person or company you pay rent to.',
          listId: null,
          options: [],
          placeholder: 'e.g. Mr. Akhtar Hussain',
        };
      case 'agent':
        return {
          title: 'Agent / Service Provider',
          help: 'Clearing agent, freight forwarder, surveyor, etc.',
          listId: null,
          options: [],
          placeholder: 'e.g. Karachi Clearing Agency',
        };
      case 'staff':
        return {
          title: 'Staff / Worker',
          help: 'Employee or daily-wage worker.',
          listId: null,
          options: [],
          placeholder: 'e.g. Shift A — 12 workers',
        };
      case 'free':
      default:
        return {
          title: 'Vendor',
          help: 'Free text — the company or person paid.',
          listId: null,
          options: [],
          placeholder: 'Vendor name',
        };
    }
  }, [vendorKind, bankAccountsList, useApi, apiVendors, apiCategory]);

  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1 tracking-wider">{config.title}</label>
      {config.supplierDropdown ? (
        <div className="space-y-2">
          <SupplierPicker
            value={form.supplier_id}
            suppliers={suppliersList}
            addToast={addToast}
            clearable
            placeholder="— Pick a supplier —"
            onChange={(id) => {
              setF('supplier_id', id);
              const s = suppliersList.find(x => String(x.id) === String(id));
              if (s) setF('vendor_name', s.name);
            }}
            onCreated={(s) => { if (s?.name) setF('vendor_name', s.name); }}
          />
          {!form.supplier_id && (
            <>
              <input type="text" value={form.vendor_name} onChange={e => setF('vendor_name', e.target.value)}
                list={config.listId || undefined}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={config.placeholder} />
              {config.listId && config.options.length > 0 && (
                <datalist id={config.listId}>
                  {config.options.map(o => <option key={o} value={o} />)}
                </datalist>
              )}
              {/* Said plainly, because it is the difference between an expense
                  that shows on a ledger and one that does not. */}
              <p className="text-[11px] text-amber-700 leading-snug">
                A one-off payee is recorded on the expense only — it will not appear on any
                supplier&rsquo;s ledger or statement.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <input
            type="text"
            list={config.listId || undefined}
            value={form.vendor_name}
            onChange={e => setF('vendor_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={config.placeholder}
          />
          {config.listId && (
            <datalist id={config.listId}>
              {config.options.map(opt => <option key={opt} value={opt} />)}
            </datalist>
          )}
        </>
      )}
      <p className="text-[11px] text-gray-500 mt-1">{config.help}</p>
    </div>
  );
}

