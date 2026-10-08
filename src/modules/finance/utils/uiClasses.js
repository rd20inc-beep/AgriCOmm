// Finance presentation rules, in one place, so every Finance screen, drawer
// and the Payment form look like one product. Built only from the app's
// existing Tailwind palette (blue-600 = --color-accent, gray borders, 0.75rem
// card radius) — no new colours, shadows or animations.
//
//   One primary action per area   → btnPrimary (filled blue)
//   Everything else               → btnSecondary (outlined) / btnQuiet (text)
//   Destructive                   → btnDanger (outlined red)
//   Touch targets                 → 40px tall on phones, 36px from `sm` up
//   Focus                         → visible ring on keyboard focus

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1';
const base = `inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${focus}`;
const size = 'px-3.5 min-h-10 sm:min-h-9';

export const btnPrimary = `${base} ${size} text-white bg-blue-600 hover:bg-blue-700`;
export const btnSecondary = `${base} ${size} text-gray-700 bg-white border border-gray-200 hover:bg-gray-50`;
export const btnDanger = `${base} ${size} text-red-700 bg-white border border-red-200 hover:bg-red-50`;
export const btnQuiet = `${base} px-2.5 min-h-10 sm:min-h-9 text-blue-700 hover:bg-blue-50`;

// Row-level actions inside a table: smaller on desktop, still 40px on phones.
const rowSize = 'px-2.5 min-h-10 md:min-h-8 text-xs';
export const btnRowPrimary = `${base} ${rowSize} text-white bg-blue-600 hover:bg-blue-700`;
export const btnRowSecondary = `${base} ${rowSize} text-gray-700 bg-white border border-gray-200 hover:bg-gray-50`;
export const btnRowDanger = `${base} ${rowSize} text-red-700 bg-white border border-red-200 hover:bg-red-50`;
// An icon-only button (always give it an aria-label).
export const btnIcon = `${base} w-10 h-10 md:w-8 md:h-8 text-gray-500 hover:text-blue-700 hover:bg-blue-50`;

// Cards and sections.
export const card = 'bg-white rounded-xl border border-gray-200';
export const cardPad = 'p-4 sm:p-5';
export const sectionTitle = 'text-sm font-semibold text-gray-900';

// KPI tile: small label · big figure · small sub-line.
export const kpiLabel = 'text-xs font-medium uppercase tracking-wide text-gray-500';
export const kpiValue = 'text-xl sm:text-2xl font-bold text-gray-900 tabular-nums leading-tight';
export const kpiSub = 'text-xs text-gray-500';

// Table header cell (matches the app's .table-container header).
export const th = 'px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 bg-gray-50';
// A money cell: right-aligned, figures line up.
export const tdMoney = 'text-right tabular-nums whitespace-nowrap';

// Sign of a figure: colour plus a word, never colour alone.
export const signTone = (n) => ((Number(n) || 0) < 0 ? 'text-red-700' : 'text-emerald-700');
