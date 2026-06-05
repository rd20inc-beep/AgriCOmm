---
name: Export Document Types
description: 15 export document types for rice trading — backend data + frontend renderers both complete as of 2026-04-13
type: project
originSessionId: d3277255-c862-4e53-86a9-3b43f2750521
---
RiceFlow generates 15 export document types from export order data:

1. Sales Contract
2. Proforma Invoice
3. Production Plan
4. Bank FI Request (E-Form)
5. Export Undertaking
6. Invoice (simple)
7. Commercial Invoice
8. Bill of Lading
9. Packing Certificate
10. Packing List
11. Certificate of Origin (KCCI form data)
12. Statement of Origin
13. Bank Covering Letter
14. Buyer Covering Letter
15. Lab Test Request

**Status (2026-04-13):** Both backend data generation (`modules/documents/exportDocument.controller.js`) and frontend renderers (`src/modules/exportOrders/components/DocumentCenter.jsx`) are complete. All 15 doc keys have matching renderers in the `RENDERERS` map. Data gaps closed in migration 053 (credit_notes + company settings) and order/shipment update handlers persist all required fields (lot_number, tare_weight_kg, freight_terms, consignee_type, bl_date, etc.).

**How to apply:** Document generation is feature-complete. If user reports template issues, edit the specific `render<DocName>` function in DocumentCenter.jsx. The duplicate file at `src/pages/exportOrder/DocumentCenter.jsx` is identical — the active one is in `modules/exportOrders/components/`.
