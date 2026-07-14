// Stage 8 — conflict classification (pure).
import { describe, test, expect } from 'vitest';
import { classifyConflict, CONFLICT_LABELS } from '../conflicts';

describe('classifyConflict', () => {
  test('prefers a server-provided code', () => {
    expect(classifyConflict(403, { code: 'device_revoked', message: 'x' })).toBe('device_revoked');
  });
  test('insufficient stock', () => {
    expect(classifyConflict(422, { message: 'Insufficient stock in lot LOT-1' })).toBe('insufficient_stock');
  });
  test('duplicate', () => {
    expect(classifyConflict(409, { message: 'This GRN is already invoiced' })).toBe('duplicate');
  });
  test('version conflict', () => {
    expect(classifyConflict(409, { message: 'Record was modified by another user' })).toBe('version_conflict');
  });
  test('not permitted', () => {
    expect(classifyConflict(403, { message: 'Owner approval required' })).toBe('not_permitted');
  });
  test('generic 422 → invalid', () => {
    expect(classifyConflict(422, { message: 'validation failed for field' })).toBe('invalid');
  });
  test('fallback → rejected', () => {
    expect(classifyConflict(400, { message: 'nope' })).toBe('rejected');
  });
  test('every code has a friendly label', () => {
    for (const c of ['insufficient_stock', 'duplicate', 'version_conflict', 'not_permitted', 'invalid', 'rejected']) {
      expect(CONFLICT_LABELS[c]).toBeTruthy();
    }
  });
});
