// Stage 11 — sync status chip logic (pure).
import { describe, test, expect } from 'vitest';
import { computeSyncStatus } from '../status';

describe('computeSyncStatus', () => {
  test('synced when online with nothing queued', () => {
    expect(computeSyncStatus({ online: true })).toMatchObject({ key: 'synced', tone: 'green' });
  });
  test('syncing when online with pending items', () => {
    expect(computeSyncStatus({ online: true, pending: 3 })).toMatchObject({ key: 'syncing', label: 'Syncing 3' });
  });
  test('offline shows queued count', () => {
    expect(computeSyncStatus({ online: false, pending: 2 })).toMatchObject({ key: 'offline', label: 'Offline · 2 queued' });
    expect(computeSyncStatus({ online: false })).toMatchObject({ key: 'offline', label: 'Offline' });
  });
  test('needs-attention takes priority over everything', () => {
    expect(computeSyncStatus({ online: true, pending: 5, rejected: 2 })).toMatchObject({ key: 'attention', tone: 'red' });
    expect(computeSyncStatus({ online: false, rejected: 1 })).toMatchObject({ key: 'attention', label: '1 needs attention' });
  });
});
