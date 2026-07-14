// Sync management API (Stage 11) — the manager conflicts review surface, backed by
// the Stage-8 endpoints (RBAC-gated server-side to manager roles).
import api from '../api/client';

export const conflictsApi = {
  list: (status = 'pending') => api.get('/api/sync/conflicts', { status }),
  resolve: (id, resolution) => api.post(`/api/sync/conflicts/${id}/resolve`, { resolution }),
};
