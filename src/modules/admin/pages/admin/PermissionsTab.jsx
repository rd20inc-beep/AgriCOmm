import { useState, useMemo, useEffect } from 'react';
import {
  Shield, Search, Save, RotateCcw, Lock, Check, AlertCircle, Users,
  Ship, Factory, Package, DollarSign, FileText, Settings, BarChart3, Wrench,
} from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useAuth } from '../../../../context/AuthContext';
import {
  usePermissions, useRolesWithPermissions, useUpdateRolePermissions,
} from '../../../../api/queries';

// ─── Module visual meta ────────────────────────────────────────────────
const MODULE_META = {
  export_orders: { label: 'Export Orders', icon: Ship,        accent: 'blue' },
  milling:       { label: 'Milling',       icon: Factory,     accent: 'amber' },
  inventory:     { label: 'Inventory',     icon: Package,     accent: 'emerald' },
  finance:       { label: 'Finance',       icon: DollarSign,  accent: 'violet' },
  documents:     { label: 'Documents',     icon: FileText,    accent: 'sky' },
  admin:         { label: 'Admin',         icon: Settings,    accent: 'rose' },
  reports:       { label: 'Reports',       icon: BarChart3,   accent: 'indigo' },
  mill_store:    { label: 'Mill Store',    icon: Wrench,      accent: 'orange' },
};

const ACCENT_TONES = {
  blue:    { tile: 'bg-blue-50 text-blue-700 border-blue-100',       active: 'bg-blue-600' },
  amber:   { tile: 'bg-amber-50 text-amber-700 border-amber-100',     active: 'bg-amber-500' },
  emerald: { tile: 'bg-emerald-50 text-emerald-700 border-emerald-100', active: 'bg-emerald-600' },
  violet:  { tile: 'bg-violet-50 text-violet-700 border-violet-100',   active: 'bg-violet-600' },
  sky:     { tile: 'bg-sky-50 text-sky-700 border-sky-100',           active: 'bg-sky-600' },
  rose:    { tile: 'bg-red-50 text-red-700 border-red-100',         active: 'bg-red-600' },
  indigo:  { tile: 'bg-indigo-50 text-indigo-700 border-indigo-100',   active: 'bg-indigo-600' },
  orange:  { tile: 'bg-amber-50 text-amber-700 border-amber-100',   active: 'bg-amber-500' },
  gray:    { tile: 'bg-gray-50 text-gray-700 border-gray-200',         active: 'bg-gray-700' },
};

const ROLE_TONE = {
  'Super Admin':          'bg-red-100 text-red-700',
  'Owner':                'bg-purple-100 text-purple-700',
  'Export Manager':       'bg-blue-100 text-blue-700',
  'Finance Manager':      'bg-violet-100 text-violet-700',
  'Mill Manager':         'bg-amber-100 text-amber-700',
  'QC Analyst':           'bg-cyan-100 text-cyan-700',
  'Inventory Officer':    'bg-emerald-100 text-emerald-700',
  'Documentation Officer':'bg-indigo-100 text-indigo-700',
  'Read-Only Auditor':    'bg-gray-100 text-gray-600',
};

function humaniseAction(action) {
  // 'manage_master_data' → 'Manage master data'
  const s = String(action || '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function PermissionsTab() {
  const { addToast } = useApp();
  const { user, isRole } = useAuth();
  const isSuperAdmin = isRole?.('Super Admin') ?? (user?.role === 'Super Admin');

  const { data: permissions = [], isLoading: permsLoading } = usePermissions();
  const { data: roles = [], isLoading: rolesLoading } = useRolesWithPermissions();
  const updateMut = useUpdateRolePermissions();

  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [draft, setDraft] = useState(new Set()); // current edit state — permission ids
  const [search, setSearch] = useState('');

  // Default-select first non-Super-Admin role once data lands
  useEffect(() => {
    if (selectedRoleId == null && roles.length > 0) {
      const firstEditable = roles.find(r => r.name !== 'Super Admin') || roles[0];
      setSelectedRoleId(firstEditable.id);
    }
  }, [roles, selectedRoleId]);

  const selectedRole = useMemo(
    () => roles.find(r => r.id === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  // Reset draft when switching role
  useEffect(() => {
    if (selectedRole) setDraft(new Set(selectedRole.permissionIds || []));
  }, [selectedRoleId, selectedRole?.id]); // eslint-disable-line

  const grouped = useMemo(() => {
    const byModule = new Map();
    for (const p of permissions) {
      if (search && !p.action.toLowerCase().includes(search.toLowerCase())
        && !p.module.toLowerCase().includes(search.toLowerCase())
        && !(p.description || '').toLowerCase().includes(search.toLowerCase())) continue;
      if (!byModule.has(p.module)) byModule.set(p.module, []);
      byModule.get(p.module).push(p);
    }
    const ordered = Array.from(byModule.entries()).sort(([a], [b]) => {
      const oa = Object.keys(MODULE_META).indexOf(a);
      const ob = Object.keys(MODULE_META).indexOf(b);
      return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    });
    return ordered;
  }, [permissions, search]);

  const dirty = useMemo(() => {
    if (!selectedRole) return false;
    const original = new Set(selectedRole.permissionIds || []);
    if (original.size !== draft.size) return true;
    for (const id of draft) if (!original.has(id)) return true;
    return false;
  }, [selectedRole, draft]);

  const isReadOnly = !isSuperAdmin || (selectedRole && selectedRole.name === 'Super Admin');

  function toggle(permId) {
    if (isReadOnly) return;
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  }

  function toggleModule(modulePerms, allOn) {
    if (isReadOnly) return;
    setDraft(prev => {
      const next = new Set(prev);
      for (const p of modulePerms) {
        if (allOn) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  }

  function reset() {
    if (selectedRole) setDraft(new Set(selectedRole.permissionIds || []));
  }

  async function save() {
    if (!selectedRole || isReadOnly) return;
    try {
      await updateMut.mutateAsync({
        roleId: selectedRole.id,
        permissionIds: Array.from(draft),
      });
      addToast(`Permissions for ${selectedRole.name} saved`, 'success');
    } catch (err) {
      addToast(err?.response?.data?.message || err.message || 'Failed to save permissions', 'error');
    }
  }

  if (permsLoading || rolesLoading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Loading roles & permissions…</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-5">
      {/* ─── Role list (left) ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Shield size={14} className="text-gray-500" />
            Roles
          </h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Pick a role to edit its permissions.</p>
        </div>
        <div className="divide-y divide-gray-100 max-h-[640px] overflow-y-auto">
          {roles.map(r => {
            const isActive = r.id === selectedRoleId;
            const isLocked = r.name === 'Super Admin';
            return (
              <button
                key={r.id}
                onClick={() => setSelectedRoleId(r.id)}
                className={`w-full text-left px-4 py-3 transition-colors ${isActive ? 'bg-gray-900 text-white' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-gray-900'}`}>{r.name}</span>
                      {isLocked && <Lock size={11} className={isActive ? 'text-white/60' : 'text-gray-400'} />}
                    </div>
                    {r.description && (
                      <p className={`text-[11px] mt-0.5 truncate ${isActive ? 'text-white/70' : 'text-gray-500'}`}>{r.description}</p>
                    )}
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/15 text-white' : (ROLE_TONE[r.name] || 'bg-gray-100 text-gray-600')
                  }`}>
                    <Users size={9} /> {r.userCount}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className={`text-[10px] font-medium uppercase tracking-wide ${isActive ? 'text-white/60' : 'text-gray-400'}`}>
                    {(r.permissionIds || []).length} of {permissions.length} permissions
                  </span>
                  <div className="flex-1 ml-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${isActive ? 'bg-white/80' : 'bg-emerald-500'}`}
                      style={{ width: `${permissions.length > 0 ? ((r.permissionIds || []).length / permissions.length * 100) : 0}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Matrix (right) ───────────────────────────── */}
      <div className="space-y-4">
        {selectedRole && (
          <>
            {/* Header bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-gray-900">{selectedRole.name}</h2>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${ROLE_TONE[selectedRole.name] || 'bg-gray-100 text-gray-700'}`}>
                    {selectedRole.userCount} user{selectedRole.userCount === 1 ? '' : 's'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500">
                    <Check size={11} className="text-emerald-600" /> {draft.size} of {permissions.length} granted
                  </span>
                </div>
                {selectedRole.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{selectedRole.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search permissions…"
                    className="pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-900 w-48"
                  />
                </div>
                {dirty && !isReadOnly && (
                  <button
                    onClick={reset}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={!dirty || isReadOnly || updateMut.isPending}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    !dirty || isReadOnly
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                >
                  <Save size={14} />
                  {updateMut.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Read-only banner */}
            {isReadOnly && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-start gap-2.5 text-sm">
                <AlertCircle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-amber-800">
                  {selectedRole.name === 'Super Admin'
                    ? 'Super Admin is the irreducible all-access role and cannot be edited from this UI.'
                    : 'Only Super Admin users can edit role permissions.'}
                </p>
              </div>
            )}

            {/* Module cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {grouped.length === 0 ? (
                <div className="md:col-span-2 text-center text-sm text-gray-400 py-12 bg-white rounded-xl border border-gray-200">
                  No permissions match the search.
                </div>
              ) : grouped.map(([moduleName, perms]) => {
                const meta = MODULE_META[moduleName] || { label: moduleName, icon: Shield, accent: 'gray' };
                const Icon = meta.icon;
                const tones = ACCENT_TONES[meta.accent] || ACCENT_TONES.gray;
                const grantedCount = perms.filter(p => draft.has(p.id)).length;
                const allGranted = grantedCount === perms.length;
                const noneGranted = grantedCount === 0;
                return (
                  <div key={moduleName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {/* Module header */}
                    <div className={`flex items-center justify-between px-4 py-2.5 border-b border-gray-100 ${tones.tile}`}>
                      <div className="flex items-center gap-2">
                        <Icon size={15} />
                        <span className="text-sm font-semibold">{meta.label}</span>
                        <span className="text-[10px] font-medium opacity-70">{grantedCount}/{perms.length}</span>
                      </div>
                      {!isReadOnly && (
                        <button
                          onClick={() => toggleModule(perms, allGranted)}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors ${
                            allGranted ? 'bg-white/60 hover:bg-white' : 'bg-white hover:bg-white/80'
                          }`}
                        >
                          {allGranted ? 'Revoke all' : noneGranted ? 'Grant all' : 'Grant all'}
                        </button>
                      )}
                    </div>
                    {/* Permission rows */}
                    <div className="divide-y divide-gray-100">
                      {perms.map(p => {
                        const isOn = draft.has(p.id);
                        return (
                          <label
                            key={p.id}
                            className={`flex items-start gap-3 px-4 py-2.5 ${
                              isReadOnly ? 'cursor-default' : 'cursor-pointer hover:bg-gray-50'
                            } transition-colors`}
                          >
                            <input
                              type="checkbox"
                              checked={isOn}
                              disabled={isReadOnly}
                              onChange={() => toggle(p.id)}
                              className="mt-0.5 w-4 h-4 accent-gray-900 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                {humaniseAction(p.action)}
                                <code className="text-[10px] text-gray-400 font-mono">{p.module}.{p.action}</code>
                              </div>
                              {p.description && (
                                <p className="text-[11px] text-gray-500 mt-0.5">{p.description}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
