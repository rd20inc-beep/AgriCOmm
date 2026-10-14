# Runbook: service-milling invoice controls (P2-16)

## Before deploying migration 353 (read-only check)

Migration `20261016_353_service_invoice_void_and_unique` adds a unique index: one **live**
(`status = 'Active'`) invoice per service batch. If any batch already has two invoices the
migration **stops** (it never deletes) and names the batch ids. Check first:

```bash
docker exec -it riceflow-backend node scripts/checkServiceInvoiceDuplicates.js
```

Expected: `batches with more than one live service invoice: 0` — the old create path already
checked for an existing invoice, so a duplicate can only come from two simultaneous saves.
If any are listed, **do not deploy**: the Owner/Finance decide which invoice per batch is real and
the developer adds a one-off pre-step that stamps the other one `Void` (keeping its journals,
receivable and payments, and offsetting its GL with a signed delta). Never delete either invoice.

## Behaviour (what users see)

- **Create**: validated (Joi); refused before the batch has a yield; refused when the discount is
  larger than the service charges; a second invoice for the same batch is refused (also under two
  simultaneous saves).
- **Void** (Billing tab ▸ Void): needs a written reason and the **Owner's** authorization
  (Owner password on the requester's screen). It:
  - refuses while the invoice has a receipt that Finance recorded — reverse it first in
    Finance ▸ Payments (that needs `finance.reverse_payment` and its own reason);
  - reverses old receipts recorded before receipts posted journals (they cannot be reversed in
    Finance) — only for a user holding `finance.reverse_payment`: reversing bank row, payment stamped
    `Reversed` with the reason;
  - voids the unpaid client-freight hauler payable (`Reversed`) and cancels its transport cost;
    refuses if the hauler has been paid;
  - posts the signed delta of the invoice's journals (`Service Milling Invoice Void`), keeps the
    invoice (`status = Void`, reason, who, which Owner), and closes the receivable (`Written Off`).
  The batch can then be invoiced again.

## Deferred

**Tax**: invoices still credit their tax to 4050 Service Milling Revenue. Moving it to a liability
needs a decided sales-tax account (2050 *Tax Payable* is used by payroll withholding) — not
invented here. Until decided, prefer issuing service invoices with tax 0.
