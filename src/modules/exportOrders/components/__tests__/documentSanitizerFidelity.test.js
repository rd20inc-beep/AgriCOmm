/**
 * P1-08 — the server stores and renders the document body through an allowlist
 * sanitizer (backend/src/modules/documents/htmlSanitizer.js). It must not change
 * what any REAL document prints: every renderer's output keeps its text, its
 * tables and its styles after sanitizing. The only intended differences are the
 * logo's onerror handler and its absolute URL (made relative; the server inlines
 * it), so those are normalised before comparing.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { renderDocument } from '../DocumentCenter.jsx';

const require = createRequire(import.meta.url);
const { sanitizeDocumentHtml } = require('../../../../../backend/src/modules/documents/htmlSanitizer.js');

const DOC_TYPES = [
  'proforma-invoice', 'commercial-invoice', 'packing-list', 'sales-contract', 'production-plan',
  'bank-fi-request', 'export-undertaking', 'appendix-v-10a', 'itrs', 'indemnity', 'invoice',
  'bill-of-lading', 'packing-certificate', 'statement-of-origin', 'certificate-of-origin',
  'bank-covering-letter', 'buyer-covering-letter', 'lab-test-request',
];

function payload() {
  return {
    company: {
      name: 'Agri Commodities', address: 'Karachi', proprietor: 'A. Shah', rexNumber: 'PK-REX-1',
      bank: { title: 'Agri Commodities', name: 'Test Bank', account: '0123456789', iban: 'PK00TEST0000000123456789', swift: 'TESTPKKA' },
    },
    buyer: { name: 'Nordic Foods GmbH', address: '1 Hafenstrasse', country: 'Germany', port: 'Hamburg' },
    order: {
      orderNo: 'EX-010', contractNumber: 'CN-010', invoiceNumber: 'INV-010', date: '2026-09-29',
      product: 'IRRI-6', productName: 'IRRI-6', qtyMT: 24, pricePerMT: 822.5, currency: 'USD',
      contractValue: 24 * 822.5, incoterm: 'CIF', advancePct: 20, advanceAmount: 3948,
      bagSizeKg: 50, bagType: 'PP', totalBags: 480, hsCode: '1006.3010',
      destinationPort: 'Hamburg', portOfLoading: 'Karachi, Pakistan', paymentTerms: 'CAD',
      qualityDescription: 'Pakistani IRRI-6', docWeightUnit: 'kg',
    },
    shipment: { containerCount: 1, containerType: '40ft', vesselName: 'MV Test', blNumber: 'BL-1' },
    containers: [{ containerNo: 'ABCU1234567', sealNo: 'S1', bags: 480, netWeightKg: 24000, grossWeightKg: 24320 }],
    totals: { netWeightKg: 24000, grossWeightKg: 24320, netWeightMT: 24, grossWeightMT: 24.32, totalPackages: 480, totalBags: 480, masterBagCount: 0 },
    items: [],
    packing: {},
    incotermInfo: { incoterm: 'CIF', sellerPaysFreight: true, portOfLoading: 'Karachi, Pakistan', portOfDischarge: 'Hamburg' },
  };
}

// The two intended changes, applied to the original so the rest must match.
const normalise = (html) => html
  .replace(/\sonerror="[^"]*"/g, '')
  .replace(/src="https?:\/\/[^/"]+(\/logo\.jpg)"/g, 'src="$1"');
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const count = (html, tag) => (html.match(new RegExp(`<${tag}[\\s>/]`, 'g')) || []).length;

describe('the sanitizer keeps every real document intact', () => {
  for (const type of DOC_TYPES) {
    it(type, () => {
      const html = normalise(renderDocument({ ...payload(), _docType: type, type }, { fontFamily: 'Arial', fontScale: 1.1 }));
      expect(html.length).toBeGreaterThan(200);
      const clean = sanitizeDocumentHtml(html);
      expect(text(clean)).toBe(text(html));
      const styles = (h) => h.match(/<style[\s\S]*?<\/style>/g) || [];
      expect(styles(clean)).toEqual(styles(html));
      for (const tag of ['table', 'tr', 'td', 'th', 'style', 'img', 'div', 'span', 'p', 'colgroup', 'col', 'strong', 'b', 'br']) {
        expect(count(clean, tag), `${type} <${tag}>`).toBe(count(html, tag));
      }
      expect(clean).not.toMatch(/<script|onerror|javascript:/i);
    });
  }
});
