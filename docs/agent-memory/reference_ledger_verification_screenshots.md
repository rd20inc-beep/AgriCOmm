---
name: reference_ledger_verification_screenshots
description: Where the saved screenshots from the party-ledger feature verification live + what each shows
metadata: 
  node_type: memory
  type: reference
  originSessionId: 34d7a7cc-16b2-4b8a-bbed-f8d062bf75ea
---

Verification screenshots from building the customer/supplier **party ledger** feature (Finance → Statements) are saved at:
`/home/aly/.claude/projects/-home-aly-Downloads-AgriCOmm/memory/verification-screenshots/`
(copied out of ephemeral `/tmp/ledger-verify/`). All are from real runs (puppeteer + Chrome), most against production `https://agricommodities.online`.

Key frames:
- `live-6-supplier-link.png`, `live-7-customer-link.png` — clicking a party name → that party's ledger ([[project_party_ledger]] click-through).
- `live-5-searchable-supplier.png` — the searchable party picker.
- `live-4-supplier-populated.png` — supplier ledger with running balance (A.A Traders Rice).
- `live-8-usd-customer.png` — first USD-display fix (customer 51 in $).
- `live-9-both-currency.png`, `live-usdsub-51.png`, `live-usdsub-5.png` — native + PKR / PKR + USD sub-line iterations.
- `live-cust5-exact.png`, `live-10-cust51-pkr.png` — final state: **PKR primary + exact USD sub-line** (cust 5 = −$8,000 exact after the journal-currency normalization, cust 51 = −$5,950).
- `1-…` through `7-…` — earlier local-dev verification of the same flows.

These document the end state: every party ledger shows PKR primary with an exact USD sub-line, backed by the PKR-normalized GL. See [[project_party_ledger]] for the feature/PR history.
