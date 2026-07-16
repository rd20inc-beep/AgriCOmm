const db = require('../../config/database');
const { maskBank } = require('../../utils/bankMasking');
const { userHasPermission } = require('../../middleware/rbac');
const auditService = require('../admin/audit.service');

// Legacy hardcoded bank — used ONLY as a last resort when no bank account is
// configured, so existing installs keep rendering a bank block until an admin
// sets an export-default account (Admin → Bank Accounts).
const LEGACY_BANK = {
  title: 'AGRI COMMODITIES',
  name: 'Bank Al Habib Limited',
  branch: 'New Challi Branch',
  city: 'Karachi - Pakistan',
  address: '',
  account: '0081 0046 0701',
  swift: 'BAHLPKKAXXX',
  iban: 'PK84 BAHL 1015-0081-0046-0701',
  correspondent: null,
};

// Build the company bank block from a bank_accounts row (Phase A columns).
function bankFromAccount(acct) {
  if (!acct) return { ...LEGACY_BANK };
  const corr = acct.correspondent_bank_name || acct.correspondent_swift || acct.correspondent_account;
  return {
    title: acct.account_title || acct.name || '',
    name: acct.bank_name || '',
    branch: acct.branch || '',
    city: acct.bank_address || '',
    address: acct.bank_address || '',
    account: acct.account_number || '',
    swift: acct.swift_bic || '',
    iban: acct.iban || '',
    currency: acct.currency || '',
    approvedForCustomer: !!acct.approved_for_customer,
    correspondent: corr ? {
      name: acct.correspondent_bank_name || '',
      swift: acct.correspondent_swift || '',
      account: acct.correspondent_account || '',
    } : null,
  };
}

/**
 * Export Document Generator
 *
 * Gathers all data needed for each document type from across the system
 * and returns structured JSON that the frontend renders as formatted documents.
 *
 * Every document shares a common data core (order + buyer + company + product).
 * Each document type adds its specific fields on top.
 */

async function gatherOrderData(orderId) {
  const order = await db('export_orders as eo')
    .leftJoin('customers as c', 'eo.customer_id', 'c.id')
    .leftJoin('products as p', 'eo.product_id', 'p.id')
    .select('eo.*', 'c.name as customer_name', 'c.address as customer_address',
      'c.port as customer_port',
      'c.country as customer_country', 'c.contact_person', 'c.email as customer_email',
      'c.phone as customer_phone', 'c.vat_number as customer_vat',
      'c.bank_name as customer_bank', 'c.bank_account as customer_account',
      'c.bank_swift as customer_swift', 'c.bank_iban as customer_iban',
      'c.payment_terms as customer_payment_terms',
      'p.name as product_full_name')
    .where('eo.id', orderId)
    .first();

  if (!order) return null;

  // Containers
  const containers = await db('shipment_containers')
    .where({ order_id: orderId })
    .orderBy('sequence_no', 'asc');

  // Company profile from system_settings
  const settingsRows = await db('system_settings').select('key', 'value');
  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });

  // Costs
  const costs = await db('export_order_costs').where({ order_id: orderId });

  // P.I. line items (multi-product). Each row carries its own HS code,
  // packing, qty, and price — used by document renderers that should show
  // every line rather than a single rolled-up product.
  const items = await db('export_order_items as i')
    .leftJoin('products as p', 'i.product_id', 'p.id')
    .select('i.*', 'p.name as product_name_lookup', 'p.hs_code as product_hs_code')
    .where({ order_id: orderId })
    .orderBy('line_no', 'asc');

  // Packed net/gross weight fallback when containers aren't captured yet.
  const packingWeight = await db('export_packing_weights').where({ order_id: orderId }).first();

  // Which company bank account this order's documents draw from: the order's
  // explicit selection, else the single is_export_default account, else none
  // (renderer falls back to LEGACY_BANK).
  let bankAccount = null;
  if (order.bank_account_id) {
    bankAccount = await db('bank_accounts').where({ id: order.bank_account_id }).first();
  }
  if (!bankAccount) {
    bankAccount = await db('bank_accounts').where({ is_export_default: true }).first();
  }

  return { order, containers, settings, costs, items, packingWeight, bankAccount };
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatMoney(amount, currency = 'USD') {
  const num = parseFloat(amount) || 0;
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The SBP / bank compliance documents (Export Undertaking, Appendix V-10A, ITRS,
// Indemnity) use the DHA export-office letterhead, not the Uni Plaza head office.
const DHA_OFFICE = {
  address: 'Suite # 302, 3rd Floor, Building # 35C, Main Badar Commercial, Phase 5, DHA, Karachi-75500',
  phone: '+92 300 8234924 & +92 300 8997323',
  fax: '',
  email: 'export@agririce.com',
  website: 'www.agririce.com',
};
function withDhaOffice(company) {
  return { ...company, ...DHA_OFFICE };
}

// Incoterm-aware delivery / freight & insurance terms — used so the compliance
// documents state the correct responsibilities for the order's incoterm.
function incotermTerms(incotermRaw, portOfLoading, destinationPort) {
  const inc = String(incotermRaw || 'FOB').toUpperCase().trim();
  const POL = portOfLoading || 'the port of loading';
  const POD = destinationPort || 'the port of discharge';
  const map = {
    EXW: `EXW — Ex Works. The buyer bears all costs and risks of taking the goods from the seller's premises, including export clearance, inland carriage, ocean freight and marine insurance.`,
    FCA: `FCA ${POL} — Free Carrier. The seller delivers the goods, cleared for export, to the carrier nominated by the buyer at ${POL}. Ocean freight and marine insurance are to the buyer's account.`,
    FOB: `FOB ${POL} — Free On Board. The seller delivers the goods on board the vessel at ${POL} and clears them for export. Ocean freight and marine insurance are arranged and borne by the buyer.`,
    CFR: `CFR ${POD} — Cost and Freight. The seller pays the cost and ocean freight to bring the goods to ${POD}. Marine insurance is to the buyer's account; risk passes on shipment.`,
    CNF: `CFR ${POD} — Cost and Freight (C&F/CNF). The seller pays the cost and ocean freight to ${POD}. Marine insurance is to the buyer's account; risk passes on shipment.`,
    'C&F': `CFR ${POD} — Cost and Freight. The seller pays the cost and ocean freight to ${POD}. Marine insurance is to the buyer's account; risk passes on shipment.`,
    CIF: `CIF ${POD} — Cost, Insurance and Freight. The seller pays the cost, ocean freight and minimum marine insurance to bring the goods to ${POD}; risk passes on shipment.`,
    CPT: `CPT ${POD} — Carriage Paid To. The seller pays carriage to ${POD}. Insurance is to the buyer's account; risk passes on handover to the first carrier.`,
    CIP: `CIP ${POD} — Carriage and Insurance Paid To. The seller pays carriage and insurance to ${POD}; risk passes on handover to the first carrier.`,
    DAP: `DAP ${POD} — Delivered At Place. The seller bears all costs and risks to deliver the goods, ready for unloading, at ${POD}.`,
    DPU: `DPU ${POD} — Delivered at Place Unloaded. The seller bears all costs and risks to deliver and unload the goods at ${POD}.`,
    DDP: `DDP ${POD} — Delivered Duty Paid. The seller bears all costs and risks, including import duties, to deliver the goods at ${POD}.`,
  };
  const sellerPaysFreight = ['CFR', 'CNF', 'C&F', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].includes(inc);
  const sellerPaysInsurance = ['CIF', 'CIP', 'DAP', 'DPU', 'DDP'].includes(inc);
  return {
    incoterm: inc,
    text: map[inc] || `${inc}. Delivery, freight and insurance responsibilities are as per the agreed Incoterms® 2020 rule ${inc}.`,
    sellerPaysFreight,
    sellerPaysInsurance,
    portOfLoading: POL,
    portOfDischarge: POD,
  };
}

const exportDocumentController = {
  /**
   * GET /api/export-orders/:id/documents/generate/:docType
   * Returns structured data for rendering a specific document
   */
  async generate(req, res) {
    try {
      const { id, docType } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const orderId = isNumeric ? parseInt(id) : (await db('export_orders').where({ order_no: id }).select('id').first())?.id;

      if (!orderId) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      const data = await gatherOrderData(orderId);
      if (!data) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      const { order, containers, settings, costs, items, packingWeight, bankAccount } = data;

      // Single source of truth for HS code: first item → order (legacy) →
      // settings default. Item-level wins because that's where the user
      // enters HS code in the multi-line P.I. flow; the order-level field is
      // only a fallback for legacy single-product orders.
      // No hardcoded fallback — if none of these are set, the document shows
      // blank so the user can spot it rather than seeing a wrong number.
      const firstItem = items && items[0] ? items[0] : null;
      const orderHsCode = (firstItem && (firstItem.hs_code || firstItem.product_hs_code)) || order.hs_code || settings.default_hs_code || '';
      const orderQualityDescription = (firstItem && firstItem.quality_description) || order.quality_description || '';

      // Distinct HS codes across the line items (item → product master), falling
      // back to the order-level code. Drives the "single vs Multiple HS Codes"
      // summary on the Commercial Invoice.
      const hsList = [];
      (items || []).forEach((it) => {
        const code = it.hs_code || it.product_hs_code || '';
        if (code && !hsList.includes(code)) hsList.push(code);
      });
      if (!hsList.length && orderHsCode) hsList.push(orderHsCode);
      const hsCodes = { list: hsList, multiple: hsList.length > 1, single: hsList.length === 1 ? hsList[0] : '' };

      // Weights & packages: prefer captured container weights, fall back to the
      // packing-weight record, then to the ordered quantity. Engine stores KG.
      const containerNetKg = containers.reduce((s, c) => s + (parseFloat(c.net_weight_kg) || 0), 0);
      const containerGrossKg = containers.reduce((s, c) => s + (parseFloat(c.gross_weight_kg) || 0), 0);
      const netWeightKg = containerNetKg
        || (packingWeight && parseFloat(packingWeight.packed_net_rice_kg))
        || (parseFloat(order.qty_mt) || 0) * 1000;
      const grossWeightKg = containerGrossKg
        || (packingWeight && parseFloat(packingWeight.gross_weight_kg))
        || netWeightKg;
      const totalPackages = containers.reduce((s, c) => s + (c.bags_count || 0), 0)
        || order.total_bags
        || (items || []).reduce((s, it) => s + (parseInt(it.bag_count) || 0), 0)
        || 0;

      // Company bank block from the resolved account — UNMASKED here. Masking
      // is applied per-viewer at response time (below) so a stored draft
      // snapshot keeps the full data and each reader is masked on their own
      // permission rather than baking one viewer's access into the document.
      const companyBank = bankFromAccount(bankAccount);

      // Common data shared across ALL documents
      const common = {
        // Company
        company: {
          name: 'AGRI COMMODITIES',
          tagline: 'Serving Natural Nutrition',
          address: 'Suite No. 1012, 10th Floor, Uni Plaza, I.I. Chundrigar Road, Karachi-74000, Pakistan',
          phone: '+92 21 32426534',
          fax: '+92 2132427990',
          email: 'export@agririce.com',
          website: 'www.agririce.com',
          ntn: '1251720-8',
          proprietor: 'AKMAL AMIN PARACHA',
          rexNumber: settings.rex_number || 'PKREXPK12517208',
          kcciMembership: settings.kcci_membership || '29463',
          // Real, selectable bank account (Phase A/B) — masked per viewer.
          bank: companyBank,
        },

        // Buyer
        buyer: {
          name: order.customer_name || '',
          // Which buyer location lines print is set per-order by doc_address_mode:
          // country | port | full (address+country) | country_port (country+port).
          address: order.doc_address_mode === 'full' ? (order.customer_address || '') : '',
          country: ['country', 'full', 'country_port'].includes(order.doc_address_mode || 'country')
            ? (order.customer_country || order.country || '') : '',
          port: ['port', 'country_port'].includes(order.doc_address_mode)
            ? (order.customer_port || '') : '',
          contact: order.contact_person || '',
          email: order.customer_email || '',
          phone: order.customer_phone || '',
          vatNumber: order.customer_vat || '',
        },

        // Order
        order: {
          orderNo: order.order_no,
          contractNumber: order.contract_number || order.order_no,
          invoiceNumber: order.invoice_number || order.order_no.replace('EX-', '155'),
          date: formatDate(order.created_at),
          hsCode: orderHsCode,
          product: order.product_name || '',
          brandMarking: order.brand_marking || '',
          qtyMT: parseFloat(order.qty_mt) || 0,
          totalBags: order.total_bags || Math.round((parseFloat(order.qty_mt) || 0) * 1000 / (parseFloat(order.bag_size_kg) || 50)),
          bagSizeKg: parseFloat(order.bag_size_kg) || 50,
          bagType: order.bag_type || 'PP',
          bagQuality: order.bag_quality || '',
          pricePerMT: parseFloat(order.price_per_mt) || 0,
          currency: order.currency || 'USD',
          contractValue: parseFloat(order.contract_value) || 0,
          // Advance — exposed to every renderer so the Commercial Invoice /
          // Statement of Origin can show the conditional "ADVANCE PAID" +
          // "SUB TOTAL" rows only when the order carries an advance.
          advancePct: parseFloat(order.advance_pct) || 0,
          advanceAmount: parseFloat(order.advance_expected) || 0,
          incoterm: order.incoterm || 'FOB',
          // Precedence: per-order override → customer default → auto-generated.
          paymentTerms: order.payment_terms
            || order.customer_payment_terms
            || `${order.advance_pct}% advance, balance against documents`,
          origin: 'PAKISTAN',
          portOfLoading: order.port_of_loading || settings.port_of_loading || 'Karachi, Pakistan',
          destinationPort: order.destination_port || '',
          // Expected balance-payment date (credit / against-documents terms).
          paymentDueDate: formatDate(order.balance_date),
          // HS codes: single value + full distinct list + multiple flag.
          hsCodes: hsCodes,
          brokenPctTarget: order.broken_pct_target || 2,
          qualityDescription: orderQualityDescription || (orderHsCode
            ? `Pakistani ${order.product_name || 'Rice'} - ${order.broken_pct_target || 2}% Broken - Double (silky) polished & color sorted, Latest Crop - PACKED IN ${parseFloat(order.bag_size_kg) || 50} KGS ${order.bag_type || 'PP'} BAG - HS CODE: ${orderHsCode} - GMO FREE, FIT FOR HUMAN CONSUMPTION AT ANY STAGE, FREE FROM ALIVE AND DEAD WEEVILS/INSECTS`
            : `Pakistani ${order.product_name || 'Rice'} - ${order.broken_pct_target || 2}% Broken - Double (silky) polished & color sorted, Latest Crop - PACKED IN ${parseFloat(order.bag_size_kg) || 50} KGS ${order.bag_type || 'PP'} BAG - GMO FREE, FIT FOR HUMAN CONSUMPTION AT ANY STAGE, FREE FROM ALIVE AND DEAD WEEVILS/INSECTS`),
        },

        // Incoterm-aware delivery/freight terms — available to every document
        // (proforma/commercial terms & conditions, undertaking, etc.).
        incotermInfo: incotermTerms(order.incoterm, settings.port_of_loading || 'Karachi, Pakistan', order.destination_port),

        // Notify Party
        notifyParty: {
          name: order.notify_party_name || '',
          address: order.notify_party_address || '',
          phone: order.notify_party_phone || '',
          email: order.notify_party_email || '',
        },

        // Shipment
        shipment: {
          vesselName: order.vessel_name || '',
          voyageNumber: order.voyage_number || '',
          bookingNo: order.booking_no || '',
          blNumber: order.bl_number || '',
          blDate: formatDate(order.bl_date),
          shippingLine: order.shipping_line || '',
          etd: formatDate(order.etd),
          atd: formatDate(order.atd),
          eta: formatDate(order.eta),
          ata: formatDate(order.ata),
          fiNumber: order.fi_number || '',
          fiNumber2: order.fi_number_2 || '',
          fiNumber3: order.fi_number_3 || '',
          fiDate: formatDate(order.fi_date),
          gdNumber: order.gd_number || '',
          gdDate: formatDate(order.gd_date),
          freightTerms: order.freight_terms || 'COLLECT',
          consigneeType: order.consignee_type || 'to_order_of_bank',
          containerCount: containers.length || 1,
          containerType: containers[0]?.container_type || '20ft',
          shipmentRemarks: order.shipment_remarks || '',
        },

        // Containers
        containers: containers.map((c, i) => ({
          sequenceNo: c.sequence_no || i + 1,
          containerNo: c.container_no || '',
          sealNo: c.seal_no || '',
          lotNumber: c.lot_number || '',
          bagsCount: c.bags_count || 0,
          grossWeightKg: parseFloat(c.gross_weight_kg) || 0,
          netWeightKg: parseFloat(c.net_weight_kg) || 0,
          tareWeightKg: parseFloat(c.tare_weight_kg) || 0,
        })),

        // Totals
        totals: {
          totalBags: containers.reduce((s, c) => s + (c.bags_count || 0), 0) || order.total_bags || 0,
          totalPackages,
          netWeightKg,
          grossWeightKg,
          grossWeightMT: grossWeightKg / 1000,
          netWeightMT: netWeightKg / 1000,
        },

        // Packing
        packing: {
          productionDate: order.production_date || '',
          expiryDate: order.expiry_date || '',
          productionRemarks: order.production_remarks || '',
          bagMarking: {
            product: order.product_name || 'BASMATI WHITE RICE',
            weight: `${parseFloat(order.bag_size_kg) || 50}KG`,
            origin: 'PAKISTAN',
            brand: order.brand_marking || '',
          },
        },

        // P.I. line items (multi-product). When the order has multiple lines
        // each entry carries its own HS code, packing, qty, and price so
        // document renderers can list every line.
        items: (items || []).map((it) => ({
          lineNo: it.line_no,
          productId: it.product_id,
          productName: it.product_name || it.product_name_lookup || '',
          qtyMT: parseFloat(it.qty_mt) || 0,
          pricePerMT: parseFloat(it.price_per_mt) || 0,
          lineTotal: parseFloat(it.line_total) || 0,
          hsCode: it.hs_code || '',
          packing: it.packing || '',
          bagSizeKg: it.bag_size_kg != null ? parseFloat(it.bag_size_kg) : null,
          bagCount: it.bag_count != null ? parseInt(it.bag_count) : null,
          bagType: it.bag_type || '',
          bagBrand: it.bag_brand || '',
          bagColor: it.bag_color || '',
          bagPrinting: it.bag_printing || '',
          masterBagSizeKg: it.master_bag_size_kg != null ? parseFloat(it.master_bag_size_kg) : null,
          masterBagType: it.master_bag_type || '',
          qualityDescription: it.quality_description || '',
          brokenPctTarget: it.broken_pct_target != null ? parseFloat(it.broken_pct_target) : null,
          notes: it.notes || '',
        })),
      };

      // Generate document-specific structure
      let document;

      switch (docType) {
        case 'sales-contract':
          document = {
            type: 'Sales Contract',
            ...common,
            specific: {
              shipmentWindow: {
                start: order.shipment_window_start || '',
                end: order.shipment_window_end || '',
              },
              advancePct: order.advance_pct,
              advanceAmount: parseFloat(order.advance_expected) || 0,
              balanceAmount: parseFloat(order.balance_expected) || 0,
            },
          };
          break;

        case 'proforma-invoice':
          document = {
            type: 'Proforma Invoice',
            ...common,
          };
          break;

        case 'production-plan':
          document = {
            type: 'Production Plan',
            ...common,
          };
          break;

        case 'bank-fi-request':
          document = {
            type: 'Bank FI Request',
            ...common,
            specific: {
              modeOfPayment: 'Contract/Collection',
              paymentBreakdown: {
                advance: order.advance_pct ? `${order.advance_pct}%` : '',
                sight: order.advance_pct ? `${100 - order.advance_pct}%` : '100%',
                usance: '',
              },
            },
          };
          break;

        case 'export-undertaking':
          document = {
            type: 'Export Undertaking',
            ...common,
            company: withDhaOffice(common.company),
            specific: {
              incotermTerms: incotermTerms(common.order.incoterm, common.order.portOfLoading, common.order.destinationPort),
            },
          };
          break;

        case 'appendix-v-10a':
          document = {
            type: 'Appendix V-10A',
            ...common,
            company: withDhaOffice(common.company),
          };
          break;

        case 'itrs':
          document = {
            type: 'ITRS',
            ...common,
            company: withDhaOffice(common.company),
            specific: {
              incotermTerms: incotermTerms(common.order.incoterm, common.order.portOfLoading, common.order.destinationPort),
            },
          };
          break;

        case 'indemnity':
          document = {
            type: 'Indemnity',
            ...common,
            company: withDhaOffice(common.company),
            specific: {
              // Related-party indemnity is between us and the order's buyer (importer).
              counterParty: common.buyer.name || '',
            },
          };
          break;

        case 'invoice':
          document = {
            type: 'Invoice',
            ...common,
          };
          break;

        case 'commercial-invoice':
          document = {
            type: 'Commercial Invoice',
            ...common,
            company: withDhaOffice(common.company),
          };
          break;

        case 'bill-of-lading':
          document = {
            type: 'Bill of Lading',
            ...common,
            specific: {
              consigneeLine: common.shipment.consigneeType === 'to_order_of_bank'
                ? `TO THE ORDER OF\n${common.company.bank.name}\n${common.company.bank.branch}\n${common.company.bank.city}`
                : `${common.buyer.name}\n${common.buyer.address}`,
              originalsCount: 3,
              freeDaysAtPort: 14,
            },
          };
          break;

        case 'packing-certificate':
          document = {
            type: 'Packing Certificate',
            ...common,
            company: withDhaOffice(common.company),
          };
          break;

        case 'packing-list':
          document = {
            type: 'Packing List',
            ...common,
            company: withDhaOffice(common.company),
          };
          break;

        case 'certificate-of-origin':
          document = {
            type: 'Certificate of Origin',
            ...common,
          };
          break;

        case 'statement-of-origin':
          document = {
            type: 'Statement of Origin',
            ...common,
            company: withDhaOffice(common.company),
            specific: {
              originDeclaration: `We M/s. ${common.company.name}, "The exporter under Rex reg #${common.company.rexNumber} of the products covered by this document declares that, except where otherwise clearly indicated, these products are of Pakistani preferential origin according to rules of origin of the Generalized System of Preferences of the European Union and that the origin criterion met is P."`,
            },
          };
          break;

        case 'bank-covering-letter':
          document = { type: 'Bank Covering Letter', ...common };
          break;

        case 'buyer-covering-letter':
          document = { type: 'Buyer Covering Letter', ...common, company: withDhaOffice(common.company) };
          break;

        case 'lab-test-request':
          document = { type: 'PCSIR / Lab Test Request', ...common };
          break;

        default: {
          // Upload-only documents — issued by external authorities (DPP for
          // phyto, licensed fumigators for fumigation, shipping line for the
          // signed BL). These can't be system-generated; the user uploads the
          // received PDF on the Documents tab.
          const UPLOAD_ONLY = new Set(['phyto', 'fumigation', 'bl_draft', 'bl_final']);
          if (UPLOAD_ONLY.has(docType)) {
            return res.status(400).json({
              success: false,
              code: 'UPLOAD_ONLY_DOCUMENT',
              message: 'This document is issued by an external authority and cannot be generated. Please upload the received certificate on the Documents tab.',
            });
          }
          return res.status(400).json({ success: false, message: `Unknown document type: ${docType}` });
        }
      }

      // Per-viewer masking of the banking block. Skipped when the controller is
      // invoked internally (req._skipMask) to build an unmasked draft snapshot.
      let bankMasked = false;
      if (!req._skipMask && document.company && document.company.bank) {
        const canSeeFull = await userHasPermission(req, 'finance', 'view_bank_details');
        bankMasked = !canSeeFull;
        document.company.bank = maskBank(document.company.bank, {
          canSeeFull,
          audience: req._audience || 'internal',
          approvedForCustomer: document.company.bank.approvedForCustomer,
        });
      }

      // Audit the document view/generate — lightweight, and only for real
      // (non-internal) requests.
      if (!req._skipMask) {
        auditService.log({
          userId: req.user ? req.user.id : null,
          action: 'view_document',
          entityType: 'export_document',
          entityId: `${order.order_no}:${docType}`,
          details: { docType, orderNo: order.order_no, bankMasked },
          ipAddress: req.ip,
        }).catch((e) => console.error('Doc audit log error:', e.message));
      }

      return res.json({ success: true, data: { document } });
    } catch (err) {
      console.error('Document generation error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  /**
   * GET /api/export-orders/:id/documents/available
   * Returns which documents can be generated at the current workflow step
   */
  async available(req, res) {
    try {
      const { id } = req.params;
      const isNumeric = /^\d+$/.test(id);
      const order = isNumeric
        ? await db('export_orders').where({ id: parseInt(id) }).first()
        : await db('export_orders').where({ order_no: id }).first();

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      const step = order.current_step || 1;
      const hasBasicData = !!(order.customer_id && order.qty_mt > 0);
      const hasVessel = !!order.vessel_name;
      const hasContainers = await db('shipment_containers').where({ order_id: order.id }).count('id as c').first();
      const containerCount = parseInt(hasContainers?.c) || 0;
      const hasBL = !!order.bl_number;

      // All 15 documents always ready — generate with whatever data is available,
      // missing fields show as blanks. User fills in shipment details as they become known.
      const docs = [
        { key: 'sales-contract', label: 'Sales Contract', availableFrom: 2, ready: true },
        { key: 'proforma-invoice', label: 'Proforma Invoice', availableFrom: 2, ready: true },
        { key: 'production-plan', label: 'Production Plan', availableFrom: 5, ready: true },
        { key: 'bank-fi-request', label: 'Bank FI Request (E-Form)', availableFrom: 6, ready: true },
        { key: 'export-undertaking', label: 'Export Undertaking', availableFrom: 6, ready: true },
        { key: 'appendix-v-10a', label: 'Appendix V-10A (Exporter Declaration)', availableFrom: 6, ready: true },
        { key: 'itrs', label: 'ITRS Reporting Form (SBP C-ITRS)', availableFrom: 6, ready: true },
        { key: 'indemnity', label: 'Indemnity — Related Party (Annexure IV)', availableFrom: 6, ready: true },
        { key: 'invoice', label: 'Invoice', availableFrom: 7, ready: true },
        { key: 'commercial-invoice', label: 'Commercial Invoice', availableFrom: 8, ready: true },
        { key: 'bill-of-lading', label: 'Bill of Lading (Draft)', availableFrom: 8, ready: true },
        { key: 'packing-certificate', label: 'Packing Certificate', availableFrom: 8, ready: true },
        { key: 'packing-list', label: 'Packing List', availableFrom: 8, ready: true },
        { key: 'statement-of-origin', label: 'Statement of Origin', availableFrom: 9, ready: true },
        { key: 'certificate-of-origin', label: 'Certificate of Origin', availableFrom: 9, ready: true },
        { key: 'bank-covering-letter', label: 'Bank Covering Letter', availableFrom: 9, ready: true },
        { key: 'buyer-covering-letter', label: 'Buyer Covering Letter', availableFrom: 9, ready: true },
        { key: 'lab-test-request', label: 'PCSIR / Lab Test Request', availableFrom: 5, ready: true },
      ];

      return res.json({
        success: true,
        data: {
          orderNo: order.order_no,
          status: order.status,
          currentStep: order.current_step,
          documents: docs,
        },
      });
    } catch (err) {
      console.error('Available documents error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

// Assemble the FULL (unmasked) document object for an order + docType, reusing
// the exact HTTP generate logic. Used by the generated-document service to
// freeze a draft snapshot. Returns the document object, or throws { status }.
async function assembleDocument(orderId, docType) {
  let captured = null;
  let status = 200;
  const fakeRes = {
    status(c) { status = c; return this; },
    json(payload) { captured = payload; return this; },
  };
  await exportDocumentController.generate({ params: { id: String(orderId), docType }, _skipMask: true }, fakeRes);
  if (!captured || captured.success !== true) {
    const err = new Error((captured && captured.message) || 'Failed to assemble document');
    err.status = status >= 400 ? status : 400;
    err.code = captured && captured.code;
    throw err;
  }
  return captured.data.document;
}

// Apply per-viewer bank masking to an already-assembled / stored snapshot.
function maskDocumentForViewer(document, { canSeeFull = false, audience = 'internal' } = {}) {
  if (document && document.company && document.company.bank) {
    document.company.bank = maskBank(document.company.bank, {
      canSeeFull, audience, approvedForCustomer: document.company.bank.approvedForCustomer,
    });
  }
  return document;
}

module.exports = exportDocumentController;
module.exports.assembleDocument = assembleDocument;
module.exports.maskDocumentForViewer = maskDocumentForViewer;
module.exports.gatherOrderData = gatherOrderData;
module.exports.bankFromAccount = bankFromAccount;
