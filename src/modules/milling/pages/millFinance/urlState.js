// Mill Finance location, all in the URL (P5-09) so refresh, Back and a link
// from anywhere land on the same screen:
//
//   /milling/finance?section=overview|transactions|parties|performance
//                   &view=history|payables|expenses|recurring|lotcosts   (transactions)
//                   &party=suppliers|customers&supplier=ID&customer=ID   (parties)
//                   &cat=utilities                                       (expenses filter)
//                   &focus=efficiency|loss|anomalies                     (performance)
//                   &period=month|quarter|fytd|all
//   /milling/finance?workspace=payroll   — the payroll workspace (not a tab)
//
// The old ?tab=<key> links (Mill Customers / Suppliers pages, bookmarks) still
// work: LEGACY_TABS maps each of the eleven old tabs onto the new place.
import { DEFAULT_PERIOD, PERIOD_OPTIONS } from './constants';

export const SECTION_KEYS = ['overview', 'transactions', 'parties', 'performance'];
export const TX_VIEWS = ['history', 'payables', 'expenses', 'recurring', 'lotcosts'];
export const PARTY_KEYS = ['suppliers', 'customers'];
export const PERIOD_KEYS = PERIOD_OPTIONS.map(([k]) => k);

export const LEGACY_TABS = {
  overview:   { section: 'overview' },
  moneyflow:  { section: 'transactions', view: 'history' },
  suppliers:  { section: 'parties', party: 'suppliers' },
  customers:  { section: 'parties', party: 'customers' },
  expenses:   { section: 'transactions', view: 'expenses' },
  recurring:  { section: 'transactions', view: 'recurring' },
  addcosts:   { section: 'transactions', view: 'lotcosts' },
  utilities:  { section: 'transactions', view: 'expenses', cat: 'utilities' },
  efficiency: { section: 'performance', focus: 'efficiency' },
  loss:       { section: 'performance', focus: 'loss' },
  payroll:    { workspace: 'payroll' },
};

const PERIOD_STORE = 'millFinance.period';

export function rememberedPeriod() {
  try {
    const p = window.sessionStorage.getItem(PERIOD_STORE);
    return PERIOD_KEYS.includes(p) ? p : null;
  } catch { return null; }
}
export function rememberPeriod(p) {
  try { if (PERIOD_KEYS.includes(p)) window.sessionStorage.setItem(PERIOD_STORE, p); } catch { /* private mode */ }
}

/** URLSearchParams → the screen to show. Pure (unit-tested). */
export function resolveLocation(params, { fallbackPeriod = null } = {}) {
  const get = (k) => params.get(k) || null;
  const legacy = LEGACY_TABS[get('tab')] || null;
  const supplier = get('supplier');
  const customer = get('customer');

  const workspace = get('workspace') === 'payroll' || (!get('section') && legacy?.workspace === 'payroll') ? 'payroll' : null;

  let section = SECTION_KEYS.includes(get('section')) ? get('section') : (legacy?.section || null);
  // A party deep link (?customer=ID) means the Parties section.
  if (!section && (supplier || customer)) section = 'parties';
  if (!section) section = 'overview';

  const view = TX_VIEWS.includes(get('view')) ? get('view') : (legacy?.view || 'history');
  let party = PARTY_KEYS.includes(get('party')) ? get('party') : (legacy?.party || null);
  if (!party) party = customer && !supplier ? 'customers' : 'suppliers';
  const cat = get('cat') || legacy?.cat || null;
  const focus = get('focus') || legacy?.focus || null;
  const period = PERIOD_KEYS.includes(get('period')) ? get('period') : (fallbackPeriod || DEFAULT_PERIOD);

  return { workspace, section, view, party, cat, focus, period, supplier, customer };
}

/**
 * Build a Mill Finance href. `period` is carried so a link never resets the
 * period the user picked.
 */
export function mfHref(next = {}, period = null) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v != null && v !== '') p.set(k, v);
  if (period && !p.has('period') && !p.has('workspace')) p.set('period', period);
  const qs = p.toString();
  return `/milling/finance${qs ? `?${qs}` : ''}`;
}
