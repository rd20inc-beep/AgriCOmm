// Who may change a batch's packing — mirrors backend/src/modules/milling/packingGate.js.
// The server sends its own decision for the viewing user on the packing history
// (`access.runs` / `access.spec`); this reads it, and falls back to the status
// rule alone when talking to a server that doesn't send it yet.
//
//   Cancelled / Rejected        → locked for everyone
//   Completed (yield recorded)  → Owner, Super Admin, Mill Manager only
//   before that                 → whoever can record packing

export const LOCKED_STATUSES = ['Cancelled', 'Rejected'];
export const PACKING_ADMIN_ROLES = ['Owner', 'Super Admin', 'Mill Manager'];
export const COMPLETED_LOCK_REASON = 'This batch is Completed — only an Owner or Mill Manager can change its packing.';

function fallback({ batchStatus, completed, role, hasPermission }) {
  if (LOCKED_STATUSES.includes(batchStatus)) {
    return { allowed: false, locked: true, reason: `This batch is ${batchStatus} — its packing is locked.` };
  }
  const admin = PACKING_ADMIN_ROLES.includes(role);
  const done = completed || batchStatus === 'Completed';
  if (done && !admin) return { allowed: false, locked: false, reason: COMPLETED_LOCK_REASON };
  if (admin || hasPermission) return { allowed: true, locked: false, reason: null };
  return { allowed: false, locked: false, reason: 'You do not have permission to change this batch\'s packing.' };
}

/**
 * history  — GET /batches/:id/packing payload ({ access, completed, batchStatus })
 * batchStatus, role, canRecordPacking, canEditBatch — client-side fallback inputs
 */
export function packingPermissions({ history = {}, batchStatus, role, canRecordPacking = false, canEditBatch = false } = {}) {
  const status = history.batchStatus || batchStatus;
  const completed = !!history.completed;
  const runs = history.access?.runs || fallback({ batchStatus: status, completed, role, hasPermission: canRecordPacking });
  const spec = history.access?.spec || fallback({ batchStatus: status, completed, role, hasPermission: canEditBatch });
  const packLocked = LOCKED_STATUSES.includes(status);
  return {
    runs,
    spec,
    // New runs are refused only on a cancelled / rejected batch — packing after
    // the yield is the normal order of work.
    packLocked,
    packLockedReason: packLocked ? `This batch is ${status} — packing is locked.` : null,
  };
}

// "Batch override" / "from EX-004 line 2" / "No packing spec".
export function packSpecSourceLabel(spec) {
  if (!spec || spec.source === 'none' || !spec.source) return 'No packing spec';
  if (spec.source === 'override') return 'Batch override';
  return spec.label || (spec.orderNo ? `from ${spec.orderNo}` : 'from the export order');
}

// Does a buyer-requirement line belong to this batch's spec?
export function isSpecLine(spec, line) {
  if (!spec || !line || (spec.source !== 'order_line')) return false;
  if (spec.lineId != null && line.id != null) return String(spec.lineId) === String(line.id);
  const no = line.lineNo ?? line.line_no;
  return spec.lineNo != null && no != null && Number(no) === Number(spec.lineNo);
}
