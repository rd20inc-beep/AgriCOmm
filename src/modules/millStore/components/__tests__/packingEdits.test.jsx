import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { packingPermissions, packSpecSourceLabel, isSpecLine, COMPLETED_LOCK_REASON } from '../../utils/packingAccess';

/**
 * Packing runs can be corrected / deleted and a batch shows (and can override)
 * the bag it packs into — owner decisions 2026-10-08. The UI mirrors the
 * server's rule: Completed → Owner / Super Admin / Mill Manager only,
 * Cancelled / Rejected → locked.
 */

vi.mock('../../../../components/SlideDrawer', () => ({
  default: ({ open, children, footer }) => (open ? <div>{children}{footer}</div> : null),
}));

let mockHistory = {};
let mockUser = { role: 'Mill Operator' };
let mockPerms = new Set(['mill_store.record_consumption', 'milling.edit']);
const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
vi.mock('../../api/queries', () => ({
  usePackingHistory: () => ({ data: mockHistory, isLoading: false }),
  useBatchKatta: () => ({ data: null }),
  useMillStoreItems: () => ({ data: [] }),
  usePackBatch: mutation,
  useUpdatePackingRun: mutation,
  useDeletePackingRun: mutation,
  useSetBatchPackSpec: mutation,
}));
vi.mock('../../../../api/queries', () => ({ useExportOrder: () => ({ data: null }) }));
vi.mock('../../../../hooks/useCanSeeCost', () => ({ default: () => true }));
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, hasPermission: (m, a) => mockPerms.has(`${m}.${a}`) }),
}));

const { default: PackSpecCard } = await import('../PackSpecCard');
const { default: PackingPanel } = await import('../PackingPanel');

const run = { id: 7, bag_item_id: 2, bag_item_name: 'PP Bag 25kg', bags_count: 100, packed_weight_kg: 2500, tare_weight_kg: 10, gross_weight_kg: 2510, created_at: '2026-10-08' };

describe('packing spec source label', () => {
  it('names where the spec comes from', () => {
    expect(packSpecSourceLabel({ source: 'override', bagSizeKg: 25 })).toBe('Batch override');
    expect(packSpecSourceLabel({ source: 'order_line', label: 'from EX-004 line 2' })).toBe('from EX-004 line 2');
    expect(packSpecSourceLabel({ source: 'order', orderNo: 'EX-004' })).toBe('from EX-004');
    expect(packSpecSourceLabel({ source: 'none' })).toBe('No packing spec');
    expect(packSpecSourceLabel(null)).toBe('No packing spec');
  });

  it('picks out the batch line in the buyer requirement', () => {
    const spec = { source: 'order_line', lineId: 2, lineNo: 2 };
    expect(isSpecLine(spec, { id: 2 })).toBe(true);
    expect(isSpecLine(spec, { id: 1 })).toBe(false);
    expect(isSpecLine({ source: 'order_line', lineNo: 2 }, { lineNo: 2 })).toBe(true);
    expect(isSpecLine({ source: 'override', lineId: 2 }, { id: 2 })).toBe(false);
  });

  it('the card shows the source and the spec', () => {
    const html = renderToStaticMarkup(
      <PackSpecCard spec={{ source: 'order_line', label: 'from EX-004 line 2', bagSizeKg: 5, bagType: 'Jute', masterBagSizeKg: 20 }} access={{ allowed: true }} />,
    );
    expect(html).toContain('from EX-004 line 2');
    expect(html).toContain('Jute');
    expect(html).toContain('5 kg');
    expect(html).toContain('20 kg');
    expect(html).toContain('Override');
    expect(html).not.toContain('Clear override');

    const ov = renderToStaticMarkup(<PackSpecCard spec={{ source: 'override', bagSizeKg: 25, bagType: 'P.P. bag' }} access={{ allowed: true }} />);
    expect(ov).toContain('Batch override');
    expect(ov).toContain('Edit override');
    expect(ov).toContain('Clear override');
  });

  it('a locked card shows why, with no edit buttons', () => {
    const html = renderToStaticMarkup(
      <PackSpecCard spec={{ source: 'override', bagSizeKg: 25 }} access={{ allowed: false, reason: COMPLETED_LOCK_REASON }} />,
    );
    expect(html).toContain(COMPLETED_LOCK_REASON);
    expect(html).not.toContain('Edit override');
    expect(html).not.toContain('Clear override');
  });
});

describe('packing lock state', () => {
  it('falls back to the status rule when the server sends no decision', () => {
    const op = packingPermissions({ batchStatus: 'Completed', role: 'Mill Operator', canRecordPacking: true, canEditBatch: true });
    expect(op.runs.allowed).toBe(false);
    expect(op.runs.reason).toBe(COMPLETED_LOCK_REASON);
    expect(op.packLocked).toBe(false); // packing after yield is normal
    expect(packingPermissions({ batchStatus: 'Completed', role: 'Mill Manager' }).runs.allowed).toBe(true);
    expect(packingPermissions({ batchStatus: 'In Progress', role: 'Mill Operator', canRecordPacking: true }).runs.allowed).toBe(true);
    const cancelled = packingPermissions({ batchStatus: 'Cancelled', role: 'Owner' });
    expect(cancelled.runs.allowed).toBe(false);
    expect(cancelled.spec.allowed).toBe(false);
    expect(cancelled.packLocked).toBe(true);
    // 'Closed' is not a batch status — it never locked anything real.
    expect(packingPermissions({ batchStatus: 'Rejected', role: 'Owner' }).packLocked).toBe(true);
  });

  it('the server decision wins', () => {
    const p = packingPermissions({
      history: { batchStatus: 'Completed', access: { runs: { allowed: true }, spec: { allowed: false, reason: 'x' } } },
      role: 'Mill Operator',
    });
    expect(p.runs.allowed).toBe(true);
    expect(p.spec.allowed).toBe(false);
  });
});

describe('PackingPanel', () => {
  beforeEach(() => {
    mockUser = { role: 'Mill Operator' };
    mockPerms = new Set(['mill_store.record_consumption', 'milling.edit']);
  });

  it('offers Edit / Delete on each run before the batch is Completed', () => {
    mockHistory = { logs: [run], batchStatus: 'In Progress', access: { runs: { allowed: true }, spec: { allowed: true } }, packSpec: { source: 'none' } };
    const html = renderToStaticMarkup(<PackingPanel batchId={10} batchStatus="In Progress" />);
    expect(html).toContain('title="Correct this run"');
    expect(html).toContain('title="Delete this run"');
    expect(html).toContain('No packing spec');
    expect(html).toContain('Pack into bags');
  });

  it('a Completed batch: an operator sees why runs are locked, and can still pack', () => {
    mockHistory = {
      logs: [run], batchStatus: 'Completed', completed: true,
      access: { runs: { allowed: false, reason: COMPLETED_LOCK_REASON }, spec: { allowed: false, reason: COMPLETED_LOCK_REASON } },
      packSpec: { source: 'override', bagSizeKg: 25 },
    };
    const html = renderToStaticMarkup(<PackingPanel batchId={10} batchStatus="Completed" />);
    expect(html).toContain(COMPLETED_LOCK_REASON);
    expect(html).not.toContain('title="Correct this run"');
    expect(html).not.toContain('title="Delete this run"');
    expect(html).toContain('Batch override');
    expect(html).toContain('Pack into bags');
  });

  it('a Cancelled batch locks packing for everyone', () => {
    mockUser = { role: 'Owner' };
    mockHistory = { logs: [run], batchStatus: 'Cancelled' };
    const html = renderToStaticMarkup(<PackingPanel batchId={10} batchStatus="Cancelled" />);
    expect(html).toContain('This batch is Cancelled — packing is locked.');
    expect(html).not.toContain('Pack into bags');
    expect(html).not.toContain('title="Correct this run"');
  });
});
