/**
 * The Documents tab shows the document gate as the server evaluates it
 * (P3-17 / D-17): no 'Confirm Ready' tick, a live upload nobody else has
 * approved says so (with an approve action for an approver), and a document
 * is green only when the gate says it is in place.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const files = [
  { id: 1, doc_type: 'phyto', status: 'Approved', is_latest: true, checked_by: null, file_name: 'phyto.pdf' },
  { id: 2, doc_type: 'fumigation', status: 'Approved', is_latest: true, checked_by: 9, file_name: 'fum.pdf' },
];

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }) => ({ data: queryKey[0] === 'export-order-docs' ? files : [], refetch: () => {} }),
}));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock('../../../../context/AppContext', () => ({ useApp: () => ({ addToast: () => {} }) }));
vi.mock('../../../../hooks/useConfirm', () => ({ default: () => [async () => true, null] }));
vi.mock('../DocumentCenter', () => ({ renderDocument: () => '' }));

const { default: DocumentsTab } = await import('../DocumentsTab.jsx');

const gate = {
  phyto: { key: 'phyto', fulfilled: false, state: 'awaiting_check', required: true },
  fumigation: { key: 'fumigation', fulfilled: true, state: 'fulfilled', required: true },
  blDraft: { key: 'blDraft', fulfilled: false, state: 'missing', required: true },
  invoice: { key: 'invoice', fulfilled: false, state: 'generated_unapproved', required: true },
  packingList: { key: 'packingList', fulfilled: false, state: 'missing', required: true },
  blFinal: { key: 'blFinal', fulfilled: false, state: 'missing', required: true, postShipment: true },
  coo: { key: 'coo', fulfilled: false, state: 'missing', required: true, postShipment: true },
};

// A legacy 'Confirm Ready' tick on the BL Draft: it must not turn it green.
const order = { id: 'EX-9', dbId: 9, documentGate: gate, documents: { blDraft: { status: 'Approved' } } };

describe('Documents tab and the document gate', () => {
  const html = renderToStaticMarkup(<DocumentsTab order={order} onUpload={() => {}} onChanged={() => {}} />);

  it('offers no Confirm Ready tick', () => {
    expect(html).not.toContain('Confirm Ready');
  });

  it('a live file nobody else has approved says so, and an approver can approve it', () => {
    expect(html).toContain('awaiting second-person approval');
    expect(html).toContain('>approve<');
    expect(html).toContain('Awaiting a second person&#x27;s approval');
  });

  it('counts only what the gate says is in place — a legacy tick does not', () => {
    expect(html).toContain('1 of 7 required documents in place');
    expect(html).toContain('Approve it in the Document Center');
  });
});
