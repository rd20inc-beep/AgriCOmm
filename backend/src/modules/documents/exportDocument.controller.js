const db = require('../../config/database');

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

  return { order, containers, settings, costs };
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

      const { order, containers, settings, costs } = data;

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
          bank: {
            name: 'Bank Al Habib Limited',
            branch: 'New Challi Branch',
            city: 'Karachi - Pakistan',
            account: '0081 0046 0701',
            swift: 'BAHLPKKAXXX',
            iban: 'PK84 BAHL 1015-0081-0046-0701',
          },
        },

        // Buyer
        buyer: {
          name: order.customer_name || '',
          address: order.customer_address || '',
          country: order.customer_country || order.country || '',
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
          hsCode: order.hs_code || settings.default_hs_code || '1006.3098',
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
          incoterm: order.incoterm || 'FOB',
          paymentTerms: order.customer_payment_terms || `${order.advance_pct}% advance, balance against documents`,
          origin: 'PAKISTAN',
          portOfLoading: settings.port_of_loading || 'Karachi, Pakistan',
          destinationPort: order.destination_port || '',
          brokenPctTarget: order.broken_pct_target || 2,
          qualityDescription: order.quality_description || `Pakistani ${order.product_name || 'Rice'} - ${order.broken_pct_target || 2}% Broken - Double (silky) polished & color sorted, Latest Crop - PACKED IN ${parseFloat(order.bag_size_kg) || 50} KGS ${order.bag_type || 'PP'} BAG - HS CODE: ${order.hs_code || settings.default_hs_code || '1006.3098'} - GMO FREE, FIT FOR HUMAN CONSUMPTION AT ANY STAGE, FREE FROM ALIVE AND DEAD WEEVILS/INSECTS`,
        },

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
          grossWeightMT: containers.reduce((s, c) => s + (parseFloat(c.gross_weight_kg) || 0), 0) / 1000 || parseFloat(order.qty_mt) || 0,
          netWeightMT: containers.reduce((s, c) => s + (parseFloat(c.net_weight_kg) || 0), 0) / 1000 || parseFloat(order.qty_mt) || 0,
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
          };
          break;

        case 'packing-list':
          document = {
            type: 'Packing List',
            ...common,
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
            specific: {
              originDeclaration: `We M/s. ${common.company.name}, "The exporter under Rex reg #${common.company.rexNumber} of the products covered by this document declares that, except where otherwise clearly indicated, these products are of Pakistani preferential origin according to rules of origin of the Generalized System of Preferences of the European Union and that the origin criterion met is P."`,
            },
          };
          break;

        case 'bank-covering-letter':
          document = { type: 'Bank Covering Letter', ...common };
          break;

        case 'buyer-covering-letter':
          document = { type: 'Buyer Covering Letter', ...common };
          break;

        case 'lab-test-request':
          document = { type: 'PCSIR / Lab Test Request', ...common };
          break;

        default:
          return res.status(400).json({ success: false, message: `Unknown document type: ${docType}` });
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

module.exports = exportDocumentController;
