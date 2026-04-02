# Document Generation Plan — AgriCOmm Export Order Workflow

## The 13 Export Documents

Each document maps to a workflow step where all required data is available.

### STEP 2 → Awaiting Advance (Order Created)

**Doc 1: Sales Contract**
- Data needed: buyer details, product, qty, price, payment terms, quality specs, shipment window, required documents list
- Already in system: buyer (customers table), product, qty_mt, price_per_mt, incoterm, payment_terms, bag specs
- Missing: shipment_window_start/end (only have single shipment_eta), quality_specifications text, required_documents list per buyer/country, contract_number (currently uses order_no)

**Doc 2: Proforma Invoice**
- Data needed: buyer + VAT, seller bank details, product, brand, qty, bags, price, total, payment terms, shipment ports, containers count
- Already in system: everything via order + customer + companyProfile.json
- Missing: buyer VAT number (not on customers table), invoice_number sequence separate from order_no, hs_code per order

### STEP 5 → In Milling

**Doc 3: Production Plan**
- Data needed: party name, product + brand, broken %, total qty, packing spec, bag count, container count, lot numbers per container, bag marking details (production date, expiry date, batch numbers), quality/production remarks
- Already in system: buyer, product, qty, bag specs, container count
- Missing: broken_pct_target (order level), production_date, expiry_date, batch_numbers per container, production_remarks, bag_marking_details

### STEP 6 → Docs In Preparation

**Doc 4: Bank FI Request (E-Form)**
- Data needed: company NTN, IBAN, buyer name/address/country, port of discharge, delivery terms, currency, amount, payment terms breakdown (advance/sight/usance), HS code, goods description, qty, unit price
- Already in system: company profile, buyer, order terms, amount
- Missing: company NTN stored only in JSON not DB, fi_number (bank assigns this), payment_terms_breakdown

**Doc 5: Export Undertaking**
- Data needed: bank name/branch, product name, value, client name + country, proforma invoice ref, payment term, HS code, REX number, port of discharge
- Already in system: most fields
- Missing: rex_number (company level), proforma_invoice_number

**Doc 6: Simple Invoice**
- Data needed: buyer, invoice number, contract number, date, shipment port, containers, payment term, mark/brand, bags, qty, product description with HS code
- Already in system: all fields
- Missing: invoice_number sequence, mark_and_nos (brand marking)

**Doc 7: Commercial Invoice (with shipping details)**
- Data needed: everything from Doc 6 PLUS: REX number, vessel name, booking number, FI number, FI date, booking date, unit price, total amount
- Already in system: most fields post-shipment
- Missing: fi_number, fi_date, rex_number

### STEP 8 → Ready to Ship / STEP 9 → Shipped

**Doc 8: Bill of Lading**
- Data needed: shipper, consignee (to order of bank for CAD), notify party (buyer), FI number, place of receipt, vessel/voyage, port of loading/discharge, product description, container-by-container detail with lot numbers, gross/net weight per container, freight terms, originals count
- Already in system: shipper (company), buyer, vessel, containers (shipment_containers table)
- Missing: consignee_type (to_order_of_bank vs direct), fi_number, lot_number per container, freight_terms (collect/prepaid), originals_count, voyage_number

**Doc 9: Final Commercial Invoice (with credit note adjustment)**
- Data needed: everything from Doc 7 PLUS: credit note references, adjusted price, net amount calculation
- Already in system: base invoice data
- Missing: credit_notes table, adjusted_price, compensation_references

**Doc 10: Commercial Invoice — Statement of Origin**
- Data needed: everything from Doc 9 PLUS: REX registration text, GSP origin declaration
- Already in system: same as Doc 9
- Missing: rex_number, origin_declaration_text (standard per EU destination)

**Doc 11: Packing Certificate**
- Data needed: date, shipper, invoice ref, qty (bags + MT), quality description, lot numbers, buyer, packing description, BL number, vessel, destination, container table (container#, bags, net, gross, tare weight)
- Already in system: most fields
- Missing: tare_weight per container, lot_number per container

**Doc 12: Packing List**
- Data needed: buyer, invoice/contract/date, shipment details, BL#, FI#, container-by-container with lot number, description, packing, qty, gross/net weight
- Already in system: same as packing certificate
- Missing: same gaps

**Doc 13: Certificate of Origin**
- Data needed: exporter + KCCI membership, buyer + VAT, transport details (vessel, BL#), product description + HS code, lot numbers, sales contract ref, bags, net/gross weight, country of origin. Attested by KCCI.
- Already in system: most fields
- Missing: kcci_membership_number, certificate_number (KCCI assigns), buyer_vat_number

## Data Gaps — What Needs to Be Added

### To `export_orders` table:
- `hs_code` VARCHAR(20) — HS tariff code (e.g., 1006.3098)
- `brand_marking` VARCHAR(100) — Brand name on bags (e.g., TIGER)
- `broken_pct_target` DECIMAL(5,2) — Target broken % for production
- `quality_description` TEXT — Full quality text for documents
- `production_date` DATE — Date of production (for bag marking)
- `expiry_date` DATE — Expiry date (for bag marking)
- `freight_terms` VARCHAR(20) — COLLECT or PREPAID
- `fi_number` VARCHAR(100) — Financial Instrument number from bank
- `fi_date` DATE — FI issue date
- `invoice_number` VARCHAR(50) — Separate invoice sequence from order_no
- `contract_number` VARCHAR(50) — Sales contract number (may differ from order_no)
- `consignee_type` VARCHAR(20) — 'direct' or 'to_order_of_bank'

### To `customers` table:
- `vat_number` VARCHAR(100) — EU VAT registration

### To `shipment_containers` table:
- `lot_number` VARCHAR(100) — Lot/batch number per container
- `bags_count` INTEGER — Number of bags in this container
- `tare_weight_kg` DECIMAL(10,2) — Tare weight (bag weight)

### New company settings (system_settings or dedicated table):
- `rex_number` — REX registration for EU GSP
- `kcci_membership` — KCCI membership number
- `port_of_loading` — Default port (Karachi, Pakistan)

### New table: `credit_notes`
- For tracking price adjustments between shipments

## Workflow Step → Data Collection → Document Generation

### Step 2 (Order Created → Awaiting Advance)
- **Collect**: contract_number, invoice_number, hs_code, brand_marking, quality_description, broken_pct_target
- **Generate**: Sales Contract (PDF), Proforma Invoice (PDF)

### Step 3 (Advance Received)
- No new documents. Advance receipt creates payment + journal.

### Step 5 (In Milling)
- **Collect**: production_date, expiry_date, production_remarks
- **Generate**: Production Plan (PDF) — sent to mill floor

### Step 6 (Docs In Preparation)
- **Collect**: fi_number, fi_date (from bank after submitting E-form)
- **Generate**: Bank FI Request (PDF), Export Undertaking (PDF)

### Step 7 (Awaiting Balance)
- **Generate**: Simple Invoice (PDF)

### Step 8 (Ready to Ship) — when shipment details are filled
- **Collect**: vessel_name, booking_no, containers (with lot_numbers, bags, weights), freight_terms, consignee_type
- **Generate**: Bill of Lading draft (PDF), Commercial Invoice (PDF), Packing Certificate (PDF), Packing List (PDF)

### Step 9 (Shipped) — after ATD
- **Collect**: bl_number, bl_date (from shipping line)
- **Generate**: Final Commercial Invoice (PDF), Statement of Origin (PDF), Certificate of Origin (data for KCCI submission)

## Shared Data Map (what's duplicated across documents)

| Field | Docs that use it |
|-------|-----------------|
| Buyer name + address | ALL 13 |
| Product description | ALL except bank FI |
| Quantity (MT + bags) | ALL except bank FI, export undertaking |
| Price per MT | Contract, proforma, commercial invoices, bank FI |
| Total amount | Contract, proforma, commercial invoices, bank FI |
| HS Code | Production plan, invoices, BL, packing, COO |
| Container numbers | Production plan, BL, packing cert, packing list, COO |
| Lot numbers per container | Production plan, BL, packing cert, packing list, COO |
| Vessel name | Commercial invoice, BL, packing cert, packing list, COO |
| BL number | Final invoice, statement of origin, packing cert, packing list, COO |
| Seller bank details | Proforma, bank FI |
| Bag specification | Production plan, BL, packing cert, packing list, COO |
| Net/Gross weight | BL, packing cert, packing list, COO |
| Payment terms | Contract, proforma, invoices, bank FI |
