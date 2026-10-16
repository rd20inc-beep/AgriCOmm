import { useState } from 'react';
import { Printer, Receipt, Pencil, Trash2, FileText, Landmark } from 'lucide-react';
import { useStatutoryDeductions, useCreateStatutoryDeduction, useUpdateStatutoryDeduction, useDeleteStatutoryDeduction, useStatutoryLiabilities, useStatutoryRemittances, useCreateStatutoryRemittance, useDeleteStatutoryRemittance, useTaxStatement } from '../../../../../api/queries';
import SlideDrawer from '../../../../../components/SlideDrawer';
import { favStar } from '../../../../../shared/utils/favorites';
import { accountsForCurrency } from '../../../../../shared/utils/accountCurrency';
import { todayLocalISO, fmtPKR, fmtDate } from '../../../../../shared/utils/format';
import { printTaxCertificate, printAllTaxCertificates, printStatutoryRemittance } from './payrollPrint';

const PKR = (v) => fmtPKR(v || 0, { decimals: 2 });

// Schedule monthly payroll auto-prepare. The scheduler PREPARES a run on the
// chosen day each month into the approval queue — it never auto-approves/pays.
// Manage org-level statutory deduction RULES (income tax, EOBI, …) that apply
// automatically to every eligible employee at payroll time.
export function StatutoryDeductionsDrawer({ canPay, entity = 'mill', bankAccounts = [], company, onClose, addToast }) {
  const [tab, setTab] = useState('rules');
  const { data: rules = [], isLoading } = useStatutoryDeductions();
  const createMut = useCreateStatutoryDeduction();
  const updateMut = useUpdateStatutoryDeduction();
  const deleteMut = useDeleteStatutoryDeduction();
  const blank = { name: '', calc_method: 'percent', rate: '', fixed_amount: '', base: 'gross', min_gross: '', applies_to: 'all', liability_account_code: '2050', slabs: [] };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  // Slab editor helpers (progressive annual brackets: threshold/rate/base).
  const slabs = Array.isArray(form.slabs) ? form.slabs : [];
  const setSlab = (i, patch) => set({ slabs: slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const addSlab = () => set({ slabs: [...slabs, { threshold: '', rate: '', base: '' }] });
  const rmSlab = (i) => set({ slabs: slabs.filter((_, j) => j !== i) });

  const startEdit = (r) => {
    setEditId(r.id);
    setForm({ name: r.name, calc_method: r.calcMethod, rate: r.rate || '', fixed_amount: r.fixedAmount || '', base: r.base, min_gross: r.minGross || '', applies_to: r.appliesTo, liability_account_code: r.liabilityAccountCode || '2050', slabs: Array.isArray(r.slabs) ? r.slabs : [] });
  };
  const reset = () => { setEditId(null); setForm(blank); };

  async function save() {
    if (!String(form.name).trim()) { addToast('Name is required', 'error'); return; }
    if (form.calc_method === 'percent' && !(parseFloat(form.rate) > 0)) { addToast('Enter a rate %', 'error'); return; }
    if (form.calc_method === 'fixed' && !(parseFloat(form.fixed_amount) > 0)) { addToast('Enter a fixed amount', 'error'); return; }
    if (form.calc_method === 'slab' && !slabs.some((s) => parseFloat(s.threshold) >= 0 && (parseFloat(s.rate) > 0 || parseFloat(s.base) > 0))) { addToast('Add at least one tax slab', 'error'); return; }
    const payload = {
      ...form, rate: parseFloat(form.rate) || 0, fixed_amount: parseFloat(form.fixed_amount) || 0, min_gross: parseFloat(form.min_gross) || 0,
      slabs: form.calc_method === 'slab'
        ? slabs.filter((s) => s.threshold !== '' || s.rate !== '' || s.base !== '')
          .map((s) => ({ threshold: parseFloat(s.threshold) || 0, rate: parseFloat(s.rate) || 0, base: parseFloat(s.base) || 0 }))
          .sort((a, b) => a.threshold - b.threshold)
        : undefined,
    };
    try {
      if (editId) { await updateMut.mutateAsync({ id: editId, data: payload }); addToast('Rule updated', 'success'); }
      else { await createMut.mutateAsync(payload); addToast('Rule added', 'success'); }
      reset();
    } catch (e) { addToast(e.message, 'error'); }
  }
  async function toggleActive(r) {
    try { await updateMut.mutateAsync({ id: r.id, data: { is_active: !r.isActive, calc_method: r.calcMethod, rate: r.rate, fixed_amount: r.fixedAmount } }); } catch (e) { addToast(e.message, 'error'); }
  }
  async function remove(r) {
    try { await deleteMut.mutateAsync(r.id); addToast('Rule removed', 'success'); } catch (e) { addToast(e.message, 'error'); }
  }
  const describe = (r) => r.calcMethod === 'percent' ? `${parseFloat(r.rate)}% of ${r.base}` : r.calcMethod === 'fixed' ? `${PKR(r.fixedAmount)} fixed` : `Income tax slabs (${Array.isArray(r.slabs) ? r.slabs.length : 0} bracket${(Array.isArray(r.slabs) ? r.slabs.length : 0) === 1 ? '' : 's'}) on ${r.base}`;

  return (
    <SlideDrawer open onClose={onClose} title="Statutory deductions" subtitle="Tax / EOBI rules + remit withheld liabilities to the authority" icon={Landmark} size="lg">
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        <button onClick={() => setTab('rules')} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === 'rules' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Deduction rules</button>
        <button onClick={() => setTab('remit')} className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === 'remit' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Remit liabilities</button>
      </div>
      {tab === 'remit' ? (
        <StatutoryRemittancePanel canPay={canPay} entity={entity} bankAccounts={bankAccounts} company={company} addToast={addToast} />
      ) : (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-600">{editId ? 'Edit rule' : 'Add a deduction rule'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] text-gray-500 mb-1">Name</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Income Tax, EOBI" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Method</label>
              <select value={form.calc_method} onChange={(e) => set({ calc_method: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="percent">Percent of pay</option>
                <option value="fixed">Fixed amount</option>
                <option value="slab">Income tax slabs (annual)</option>
              </select>
            </div>
            {form.calc_method === 'percent' ? (
              <>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Rate %</label>
                  <input type="number" step="0.01" value={form.rate} onChange={(e) => set({ rate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-500 mb-1">Applied to</label>
                  <select value={form.base} onChange={(e) => set({ base: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="gross">Gross pay</option>
                    <option value="basic">Basic pay</option>
                  </select>
                </div>
              </>
            ) : form.calc_method === 'fixed' ? (
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Fixed amount (Rs)</label>
                <input type="number" value={form.fixed_amount} onChange={(e) => set({ fixed_amount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            ) : (
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Applied to (annualised)</label>
                <select value={form.base} onChange={(e) => set({ base: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="gross">Gross pay</option>
                  <option value="basic">Basic pay</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Only when gross ≥</label>
              <input type="number" value={form.min_gross} onChange={(e) => set({ min_gross: e.target.value })} placeholder="0 = always" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Employees</label>
              <select value={form.applies_to} onChange={(e) => set({ applies_to: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="all">All staff</option>
                <option value="monthly">Salaried only</option>
                <option value="daily">Daily-wage only</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Liability account</label>
              <select value={form.liability_account_code} onChange={(e) => set({ liability_account_code: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="2050">2050 Tax Payable</option>
                <option value="2055">2055 EOBI Payable</option>
              </select>
            </div>
          </div>
          {form.calc_method === 'slab' && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-600">Annual income-tax slabs (FBR)</span>
                <button onClick={addSlab} className="text-[11px] text-blue-700 font-medium hover:underline">+ Add bracket</button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 text-[9px] uppercase text-gray-400 px-1">
                <span>Annual income over (Rs)</span><span>Rate % above</span><span>Fixed tax at this point (Rs)</span><span></span>
              </div>
              {!slabs.length ? <p className="text-[11px] text-gray-400 px-1">No brackets yet — add the FBR salary slabs (lowest first).</p> : slabs.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5 items-center">
                  <input type="number" value={s.threshold} onChange={(e) => setSlab(i, { threshold: e.target.value })} placeholder="0" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs" />
                  <input type="number" step="0.01" value={s.rate} onChange={(e) => setSlab(i, { rate: e.target.value })} placeholder="0" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs" />
                  <input type="number" value={s.base} onChange={(e) => setSlab(i, { base: e.target.value })} placeholder="0" className="border border-gray-200 rounded-md px-2 py-1.5 text-xs" />
                  <button aria-label="Remove slab" onClick={() => rmSlab(i)} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <p className="text-[10px] text-gray-400">Tax = <em>fixed tax at the bracket</em> + <em>rate%</em> × (annual income − <em>bracket threshold</em>), then ÷12 for the month. Income is the chosen base × 12. Enter brackets lowest-threshold first.</p>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            {editId && <button onClick={reset} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>}
            <button onClick={save} disabled={createMut.isPending || updateMut.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{editId ? 'Save rule' : 'Add rule'}</button>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Active &amp; inactive rules</div>
          {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !rules.length ? (
            <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">No statutory deductions configured yet. Withholding is off until you add a rule.</p>
          ) : (
            <div className="space-y-2">
              {rules.map((r) => (
                <div key={r.id} className={`rounded-lg border p-3 flex items-center justify-between ${r.isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{r.name} <span className="text-[10px] font-normal text-gray-400">{r.code}</span></div>
                    <div className="text-xs text-gray-500">{describe(r)}{parseFloat(r.minGross) > 0 ? ` · only if gross ≥ ${PKR(r.minGross)}` : ''} · {r.appliesTo === 'all' ? 'all staff' : r.appliesTo === 'monthly' ? 'salaried' : 'daily-wage'} · → {r.liabilityAccountCode}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toggleActive(r)} className={`px-2 py-1 text-[11px] rounded-md ${r.isActive ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 bg-gray-100 hover:bg-gray-200'}`}>{r.isActive ? 'Active' : 'Inactive'}</button>
                    <button aria-label="Edit rule" onClick={() => startEdit(r)} className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Pencil className="w-3.5 h-3.5" /></button>
                    <button aria-label="Remove rule" onClick={() => remove(r)} className="p-1.5 rounded-md text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[11px] text-gray-400">Statutory amounts are withheld from each employee's net pay and booked to the chosen liability account (payable to the authority). They appear on payslips and reduce the cash paid out — the salary expense still reflects the full gross.</p>
      </div>
      )}
    </SlideDrawer>
  );
}

// Year-end tax statements — per-employee annual salary + tax-withheld summary
// for a Pakistani tax year, with printable salary/tax certificates (u/s 149).
export function TaxStatementDrawer({ company, entity = 'mill', onClose, addToast }) {
  // Build a few recent tax-year options (current FY first).
  const now = new Date();
  const curStart = (now.getUTCMonth() + 1) >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const years = [0, 1, 2].map((d) => { const y = curStart - d; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; });
  const [taxYear, setTaxYear] = useState(years[0]);
  const { data, isLoading } = useTaxStatement({ tax_year: taxYear, entity });
  const meta = { taxYear: data?.taxYear || taxYear, periodFrom: data?.periodFrom, periodTo: data?.periodTo };
  const employees = data?.employees || [];
  const grand = data?.grand || { gross: 0, statutory: 0, net: 0 };

  return (
    <SlideDrawer open onClose={onClose} title="Year-end tax statements" subtitle="Annual salary & tax-deduction certificates (u/s 149)" icon={FileText} size="lg"
      footer={employees.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">{employees.length} employee(s) · gross {PKR(grand.gross)} · tax/statutory {PKR(grand.statutory)}</span>
          <button onClick={() => printAllTaxCertificates(employees, meta, company)} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
            <Printer className="w-3.5 h-3.5" /> Print all certificates ({employees.length})
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Tax year</label>
          <select value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
            {years.map((y) => <option key={y} value={y}>{y} (Jul {y.slice(0, 4)} – Jun {parseInt(y.slice(0, 4), 10) + 1})</option>)}
          </select>
        </div>
        {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : !employees.length ? (
          <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-lg">No paid salaries in this tax year.</p>
        ) : (
          <div className="space-y-2">
            {employees.map((e) => (
              <div key={e.workerId} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{e.name}{e.cnic ? <span className="text-[10px] font-normal text-gray-400"> · {e.cnic}</span> : ''}</div>
                    <div className="text-xs text-gray-500">{e.totals.monthsPaid} month(s) · gross {PKR(e.totals.gross)} · <span className="text-violet-700">tax/statutory {PKR(e.totals.statutory)}</span> · net {PKR(e.totals.net)}</div>
                    {Object.keys(e.totals.byStatutory || {}).length > 0 && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{Object.entries(e.totals.byStatutory).map(([k, v]) => `${k} ${PKR(v)}`).join(' · ')}</div>
                    )}
                  </div>
                  <button onClick={() => printTaxCertificate(e, meta, company)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                    <Printer className="w-3.5 h-3.5" /> Certificate
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400">Built from paid payroll runs in the tax year (1 July – 30 June). Each certificate states the salary paid and tax/statutory withheld under section 149 of the Income Tax Ordinance, 2001.</p>
      </div>
    </SlideDrawer>
  );
}

// Remit accrued statutory liabilities (2050 Tax Payable / 2055 EOBI Payable) to
// the authority — shows each account's outstanding GL balance, records a payment
// (DR liability / CR Cash & Bank), and lists remittance history.
export function StatutoryRemittancePanel({ canPay, entity = 'mill', bankAccounts = [], company, addToast }) {
  const { data: liabilities = [], isLoading: loadingLiab } = useStatutoryLiabilities({ entity });
  const { data: history = [], isLoading: loadingHist } = useStatutoryRemittances({ entity });
  const createMut = useCreateStatutoryRemittance();
  const deleteMut = useDeleteStatutoryRemittance();
  // Mill payments are PKR — a non-PKR (e.g. USD) account cannot carry them.
  const payBanks = accountsForCurrency((bankAccounts || []).filter((a) => a.type !== 'cash'), 'PKR');
  const owed = liabilities.filter((l) => parseFloat(l.outstanding) > 0);
  const blank = { liability_account_code: '', amount: '', pay_method: 'cash', bank_account_id: '', remit_date: todayLocalISO(), reference: '', authority: '', period_from: '', period_to: '', notes: '' };
  const [form, setForm] = useState(blank);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const pickAccount = (code) => {
    const l = liabilities.find((x) => x.code === code);
    const authority = code === '2055' ? 'EOBI' : code === '2050' ? 'FBR' : '';
    set({ liability_account_code: code, amount: l ? Math.round(parseFloat(l.outstanding) || 0) : '', authority });
  };

  async function remit() {
    if (!form.liability_account_code) { addToast('Pick a liability to remit', 'error'); return; }
    if (!(parseFloat(form.amount) > 0)) { addToast('Enter an amount', 'error'); return; }
    if (form.pay_method === 'bank' && !form.bank_account_id) { addToast('Select a bank account', 'error'); return; }
    try {
      await createMut.mutateAsync({ ...form, entity, amount: parseFloat(form.amount), bank_account_id: form.pay_method === 'bank' ? Number(form.bank_account_id) : null });
      addToast(`Remitted ${PKR(form.amount)}`, 'success');
      setForm(blank);
    } catch (e) { addToast(e.message, 'error'); }
  }
  async function reverse(r) {
    try { await deleteMut.mutateAsync(r.id); addToast('Remittance reversed', 'success'); } catch (e) { addToast(e.message, 'error'); }
  }

  return (
    <div className="space-y-4">
      {/* Outstanding balances */}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">Outstanding statutory liabilities</div>
        {loadingLiab ? <p className="text-sm text-gray-400">Loading…</p> : !liabilities.length ? (
          <p className="text-sm text-gray-400">No statutory liability accounts.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {liabilities.map((l) => (
              <div key={l.code} className={`rounded-lg border p-3 ${parseFloat(l.outstanding) > 0 ? 'border-violet-200 bg-violet-50' : 'border-gray-200'}`}>
                <div className="text-[10px] uppercase text-gray-400">{l.code} {l.name}</div>
                <div className={`text-sm font-semibold tabular-nums ${parseFloat(l.outstanding) > 0 ? 'text-violet-700' : 'text-gray-500'}`}>{PKR(l.outstanding)}</div>
                {parseFloat(l.outstanding) > 0 && canPay && (
                  <button onClick={() => pickAccount(l.code)} className="mt-1 text-[11px] text-violet-700 font-medium hover:underline">Remit →</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Record remittance */}
      {canPay ? (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs font-semibold text-gray-600">Record a remittance</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Liability</label>
              <select value={form.liability_account_code} onChange={(e) => pickAccount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Select…</option>
                {(owed.length ? owed : liabilities).map((l) => <option key={l.code} value={l.code}>{l.code} {l.name} ({PKR(l.outstanding)})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Amount (Rs)</label>
              <input type="number" value={form.amount} onChange={(e) => set({ amount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Pay via</label>
              <select value={form.pay_method === 'bank' ? `bank:${form.bank_account_id}` : 'cash'} onChange={(e) => { const v = e.target.value; if (v === 'cash') set({ pay_method: 'cash', bank_account_id: '' }); else set({ pay_method: 'bank', bank_account_id: v.replace('bank:', '') }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="cash">Mill Cash</option>
                {payBanks.map((a) => <option key={a.id} value={`bank:${a.id}`}>{favStar(a)}{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Date</label>
              <input type="date" value={form.remit_date} onChange={(e) => set({ remit_date: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Authority</label>
              <input value={form.authority} onChange={(e) => set({ authority: e.target.value })} placeholder="FBR / EOBI" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Challan / CPR ref</label>
              <input value={form.reference} onChange={(e) => set({ reference: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={remit} disabled={createMut.isPending} className="px-4 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50">Record remittance</button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-gray-400">You don't have permission to record remittances (needs payroll Pay).</p>
      )}

      {/* History */}
      <div>
        <div className="text-xs font-semibold text-gray-600 mb-1">Remittance history</div>
        {loadingHist ? <p className="text-sm text-gray-400">Loading…</p> : !history.length ? (
          <p className="text-sm text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">No remittances recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{r.remittanceNo} · {PKR(r.amount)} <span className="text-[10px] font-normal text-gray-400">{r.accountName}</span>{r.status === 'Reversed' && <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600" title={r.reversalReason || undefined}>Reversed</span>}</div>
                  <div className="text-xs text-gray-500">{fmtDate(r.remitDate)} · {r.payMethod === 'bank' ? (r.bankName || 'bank') : 'cash'}{r.authority ? ` · ${r.authority}` : ''}{r.reference ? ` · ${r.reference}` : ''}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => printStatutoryRemittance(r, company)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100" title="Print remittance voucher"><Receipt className="w-3.5 h-3.5" /> Voucher</button>
                  {canPay && r.status !== 'Reversed' && <button aria-label="Reverse remittance" onClick={() => reverse(r)} disabled={deleteMut.isPending} className="p-1.5 rounded-md text-red-500 hover:bg-red-50" title="Reverse remittance"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
