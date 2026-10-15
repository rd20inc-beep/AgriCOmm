# Runbook: transport costs and the transporter party (P3-08 / MIL-12, DAT-20)

Owner decision D-25b (a), 2026-10-15: party tables stay separate; **transporters live in `haulers`
only**. The code now:

- keeps a batch's transporter and payer when the costs drawer is re-saved (an absent / blank hauler
  or payer keeps the one on record), and pre-fills them in the drawer;
- voids or moves the transporter payable when the freight drops to 0, the payer is switched away
  from the company, or another hauler is named — the Dr 1210 / Cr 2010 accrual moves by a signed
  delta per hauler, and after yield the cost adjustment re-points the freight to 2110 so finished
  stock is untouched. A payment already made is never orphaned (409);
- refuses a payload that still names the old supplier-based `transport_vendor_id` instead of
  reading that supplier id as a hauler id;
- refuses a second active hauler with the same name (case / spacing ignored) or phone (digits),
  in the app (409) and in the database (migration 393, `uq_haulers_active_name` /
  `uq_haulers_active_phone`).

This runbook cleans up what the old code left behind. Nothing is deleted and no journal is
reversed: corrections are signed-delta journals and in-place payable updates. Scripts print
**counts and IDs only** — never paste names or amounts into chat or tickets.

## 1. Detect (read-only)

```bash
docker exec -it riceflow-backend node scripts/detectTransportParty.js
```

| line | meaning | action |
|---|---|---|
| duplicate active haulers by name / phone | two active rows for one transporter. Migration 393 left the later ids out of the unique index (logged `[393] …` at deploy) | a person decides which row stays; deactivate or rename the other (Admin ▸ Transporters). Parties are **never merged automatically** — the payables / ledger of each row stay where they are |
| index … still excludes earlier duplicates | the index is in its "NOT VALID" state | step 4 once the duplicates are gone |
| lots on the legacy supplier transport vendor | freight party is the pre-haulers `transport_vendor_id` (a supplier) | step 3 with a reviewed mapping, or leave |
| batch transport records that lost their hauler | a costs-drawer re-save wiped `transport_costs.hauler_id` | step 3 restores it from the payable |
| stale batch transporter payables — unpaid | the payable / accrual no longer matches the cost line | step 3 corrects it |
| stale batch transporter payables — paid | money already went out | **Owner review only** — never auto-corrected. Reverse the payment (Finance ▸ Payments, Owner-approved) if it was wrong, then re-run |

## 2. Review + backup

1. Owner / accountant reviews the listed IDs.
2. Backup:

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t haulers -t transport_costs -t payables \
  -t inventory_lots -t journal_entries -t journal_lines -Fc -f /tmp/transport_party_before_$(date +%F).dump
docker cp riceflow-db:/tmp/transport_party_before_$(date +%F).dump ./backups/
```

3. Record the trial balance for 1210, 1220, 2010 and 2110 and the AP ▸ Transporters total.

## 3. Correct

Dry run first (default — writes nothing):

```bash
docker exec -it riceflow-backend node scripts/correctTransportParty.js
```

Apply:

```bash
docker exec -it -e FIX_TRANSPORT_PARTY=1 riceflow-backend node scripts/correctTransportParty.js
```

What it writes:

- **lost hauler** → `transport_costs.hauler_id` restored from the record's own payable. No money moves.
- **stale unpaid** → the same sync the costs drawer now runs: the payable is moved in place or set
  `Reversed` (figure kept), the accrual moves by a signed delta (`Batch Transport`, stamped with the
  hauler); for a yielded batch one `Milling Batch` adjustment (Dr 1210 / Cr 2110, or the reverse).
  Each batch is re-checked under lock and skipped if it was paid meanwhile.
- **legacy supplier transport vendor** → only with `MAPPING_FILE`, a JSON file the Owner reviewed:

  ```json
  { "<supplier id>": <hauler id> }
  ```

  ```bash
  docker cp mapping.json riceflow-backend:/tmp/mapping.json
  docker exec -it -e MAPPING_FILE=/tmp/mapping.json riceflow-backend node scripts/correctTransportParty.js            # dry run
  docker exec -it -e MAPPING_FILE=/tmp/mapping.json -e FIX_TRANSPORT_PARTY=1 riceflow-backend node scripts/correctTransportParty.js
  ```

  Sets `inventory_lots.hauler_id` on lots still on that supplier; `transport_vendor_id` is kept as
  history. **No payable or journal changes** — a legacy freight bill owed to the supplier stays the
  supplier's until Finance decides how to move it (that would be a reviewed party reclass, not part
  of this script).

## 4. Validate the unique indexes

Once step 1 shows no duplicate groups:

```bash
docker exec -it riceflow-backend node scripts/validateHaulerUnique.js                                  # dry run
docker exec -it -e VALIDATE_HAULER_UNIQUE=1 riceflow-backend node scripts/validateHaulerUnique.js
```

It refuses while any duplicate remains, and otherwise rebuilds both indexes with no exclusions.

## 5. Verify

- `detectTransportParty.js` shows 0 for every correctable line.
- Trial balance still balances; AP ▸ Transporters (live bills) equals 2010 for transporter bills.
- No journal was marked Reversed by these steps.

## Rollback

Every change is a new Posted journal or an in-place update with the reason in `notes`. To undo a
correction, post the opposite signed delta — never delete or reverse+repost. The backup in step 2
is for investigation only.
