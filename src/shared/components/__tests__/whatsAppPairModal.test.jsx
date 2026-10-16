// P5-12 / PLT-18 + D-19 (UI side).
//  - Pairing your OWN WhatsApp opens from the send button for a holder of
//    communications.whatsapp_pair, instead of pointing at an admin page.
//  - Document Center says WHY Email / WhatsApp are off for an unapproved
//    document (the Proforma Invoice excepted); the backend refuses it too.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let mockPerms = () => true;
vi.mock('../../../api/client', () => ({ default: { get: vi.fn(async () => ({})), post: vi.fn(async () => ({})) } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: (m, a) => mockPerms(m, a) }) }));
vi.mock('../../../context/AppContext', () => ({ useApp: () => ({ addToast: vi.fn(), customersList: [] }) }));

const { default: WhatsAppPairModal } = await import('../WhatsAppPairModal');
const { useCanPairWhatsApp, WA_PAIR_PERMISSION } = await import('../whatsAppPair');
const { default: TransactionDocument } = await import('../../../components/TransactionDocument');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => { mockPerms = () => true; });

describe('WhatsAppPairModal', () => {
  it('explains per-user pairing and offers a QR', () => {
    const t = text(renderToStaticMarkup(<WhatsAppPairModal isOpen onClose={() => {}} />));
    expect(t).toMatch(/Pair my WhatsApp/);
    expect(t).toMatch(/your own/i);
    expect(t).toMatch(/Other users are unaffected/);
    expect(t).toMatch(/Generate QR code/);
  });

  it('renders nothing while closed', () => {
    expect(renderToStaticMarkup(<WhatsAppPairModal isOpen={false} onClose={() => {}} />)).toBe('');
  });

  it('is gated on its own permission, communications.whatsapp_pair', () => {
    expect(WA_PAIR_PERMISSION).toEqual(['communications', 'whatsapp_pair']);
    const Probe = () => <span>{String(useCanPairWhatsApp())}</span>;
    mockPerms = (m, a) => m === 'communications' && a === 'whatsapp_pair';
    expect(text(renderToStaticMarkup(<Probe />))).toMatch(/true/);
    mockPerms = (m, a) => m === 'admin' && a === 'manage_settings';
    expect(text(renderToStaticMarkup(<Probe />))).toMatch(/false/);
  });
});

describe('send buttons no longer point at Admin → WhatsApp', () => {
  const read = (p) => fs.readFileSync(path.resolve(HERE, p), 'utf8');
  const TX = read('../../../components/TransactionDocument.jsx');
  const DC = read('../../../modules/exportOrders/components/DocumentCenter.jsx');

  it.each([['TransactionDocument', TX], ['DocumentCenter', DC]])('%s opens the pair modal, or asks for the permission', (_n, src) => {
    expect(src).not.toMatch(/Pair your own account in Admin → WhatsApp/);
    expect(src).toMatch(/if \(canPairWhatsApp\) setWaPairOpen\(true\)/);
    expect(src).toMatch(/<WhatsAppPairModal/);
  });

  it('TransactionDocument still renders its WhatsApp button (pair modal closed)', () => {
    const html = renderToStaticMarkup(<TransactionDocument kind="invoice" data={{ id: 7, saleNo: 'LS-7', items: [] }} />);
    expect(html).toMatch(/Send this document to the customer on WhatsApp/);
    expect(text(html)).not.toMatch(/Pair my WhatsApp/);
  });
});

describe('D-19: Document Center tells the user why sending is off', () => {
  const DC = fs.readFileSync(path.resolve(HERE, '../../../modules/exportOrders/components/DocumentCenter.jsx'), 'utf8');

  it('Email and WhatsApp are disabled unless the version is sendable', () => {
    expect(DC).toMatch(/onClick=\{openEmail\} disabled=\{emailSending \|\| !sendable\}/);
    expect(DC).toMatch(/onClick=\{openWhatsApp\} disabled=\{waSending \|\| !sendable\}/);
  });

  it('a visible reason is shown (not only a hover title) while not sendable', () => {
    expect(DC).toMatch(/\{!sendable && \(\s*<p role="note" data-testid="doc-send-blocked-reason"/);
    expect(DC).toMatch(/only the Proforma Invoice can be sent before approval/);
  });

  it('the Proforma Invoice stays sendable before approval', () => {
    expect(DC).toMatch(/if \(docType === 'proforma-invoice'\) return true;/);
  });
});
