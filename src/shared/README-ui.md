# UI primitives — use these, don't re-roll them

One page. If a screen needs something listed here, import it; if it needs
something close to it, extend the primitive rather than copying it locally.

| Need | Use | Import |
|---|---|---|
| A form (more than ~3 fields), detail panel, payment entry | `SlideDrawer` (right side, accessible modal) | `src/components/SlideDrawer.jsx` |
| "Are you sure?" | `useConfirm()` → `const ok = await confirm({ title, consequence, reason })` and render `{confirmDialog}` | `src/hooks/useConfirm.jsx` |
| Feedback after an action | `addToast(message, 'success' \| 'error' \| 'warning' \| 'info')` | `const { addToast } = useApp()` |
| A status chip (any case; `partially_paid` shows as "Partially Paid") — add new words to `statusStyle.js`, never a local colour map | `StatusBadge status="Paid"` | `src/shared/components/StatusBadge.jsx`, `src/shared/utils/statusStyle.js` |
| Pick from a long list (with search, favourites first, inline +Add) | `SupplierPicker`, `CustomerPicker`, `ItemPicker`, `RiceTypePicker`, `HaulerPicker`, `BagTypePicker` | `src/components/*Picker.jsx` |
| Inline validation message under a field | `FieldError error={errors.qty}` | `src/shared/components/FieldError.jsx` |
| Any number, money, weight or date shown to a user | `format.js` (below) | `src/shared/utils/format.js` |
| Favourite star / favourites-first sort | `favStar`, `isFavorite`, `byFavoriteThenName` | `src/shared/utils/favorites.js` |

Never: `window.confirm` / `window.alert`, a centred modal for a form, a
hand-written `<span className="bg-green-100 …">Paid</span>`, a plain `<select>`
over hundreds of suppliers.

## SlideDrawer

```jsx
<SlideDrawer open={open} onClose={close} title="Record payment" subtitle={party.name}
  icon={Wallet} size="lg" footer={<Buttons />}>
  …fields…
</SlideDrawer>
```

`size`: sm | md (default) | lg | xl | 2xl | 3xl | 4xl. `closeOnBackdrop` is off by
default so a stray click doesn't lose a half-filled form. It is a
`role="dialog"`: Escape closes, Tab stays inside, focus returns to the button
that opened it. Give a field `autoFocus` if it should take focus on open.

## format.js — numbers and dates

Fixed `en-PK` locale (never the browser's), exact figures (never "Cr"/"L"/"M"),
and `—` for null / undefined / NaN / junk. Numeric strings are fine.

| Call | Output |
|---|---|
| `fmtPKR(1234567)` / `fmtPKR(x, { decimals: 2 })` | `Rs 1,234,567` / `Rs 1,234,567.00`; negative `-Rs 1,234` |
| `fmtUSD(12345.67)` | `$12,345.67` |
| `fmtMoney(x, currency)` | PKR → fmtPKR, USD → fmtUSD, else `AED 1,234.50` |
| `fmtKg(12082)` | `12,082 kg` (kg is the storage unit) |
| `fmtMT(12.0825)` | `12.083 MT` — only where MT is genuinely the unit (export docs/contracts) |
| `fmtNum(x)` / `fmtNum(x, 2)` | `1,234.5` (≤2 dp) / `1,234.50` (exactly 2) |
| `fmtPct(12.345)` | `12.3%` — input is already a percentage |
| `fmtDate(d)` | `05 Oct 2026` — the house date format |
| `fmtDateTime(d)` | `05 Oct 2026, 03:07 PM` |
| `todayLocalISO()` | today as `YYYY-MM-DD` in local time — **the default for every date input** |
| `toLocalISODate(d)` | any Date → local `YYYY-MM-DD` (date-range boundaries, payloads) |

Don't default a date with `new Date().toISOString().slice(0, 10)`: that is the
UTC day, which in Pakistan is still yesterday until 05:00 — the whole night
shift. A bare `'YYYY-MM-DD'` passed to `fmtDate` is shown as that calendar day,
never shifted by the time zone.
