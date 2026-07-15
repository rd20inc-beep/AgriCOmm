import { useEffect, useState } from 'react';
import { Smartphone, Check, RotateCcw, Loader2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { adminApi } from '../../api/services';
import { MOBILE_NAV_ITEMS, DEFAULT_MOBILE_NAV } from '../../../../lib/mobileNavItems';

// Configure the phone bottom-bar shortcuts per role. Pick up to 4 destinations
// (in order); a fixed "Menu" button is always the 5th slot. Empty = app default.
export default function MobileNavTab() {
  const { addToast } = useApp();
  const [roles, setRoles] = useState([]);
  const [sel, setSel] = useState({});       // roleId -> [keys]
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminApi.rolesWithPermissions();
      const list = res?.data?.roles ?? res?.roles ?? [];
      setRoles(list);
      setSel(Object.fromEntries(list.map((r) => [r.id, (r.mobile_nav && r.mobile_nav.length) ? r.mobile_nav : [...DEFAULT_MOBILE_NAV]])));
    } catch {
      addToast('Failed to load roles', 'error');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (roleId, key) => {
    setSel((prev) => {
      const cur = prev[roleId] || [];
      if (cur.includes(key)) return { ...prev, [roleId]: cur.filter((k) => k !== key) };
      if (cur.length >= 4) { addToast('Up to 4 shortcuts (plus the Menu button)', 'error'); return prev; }
      return { ...prev, [roleId]: [...cur, key] };
    });
  };

  const save = async (role, items) => {
    setSavingId(role.id);
    try {
      await adminApi.updateRoleMobileNav(role.id, items);
      addToast(`${role.name} bottom bar saved`, 'success');
      setRoles((rs) => rs.map((r) => (r.id === role.id ? { ...r, mobile_nav: items.length ? items : null } : r)));
    } catch (e) {
      addToast(e?.message || 'Save failed', 'error');
    } finally { setSavingId(null); }
  };

  const resetDefault = (role) => {
    setSel((p) => ({ ...p, [role.id]: [...DEFAULT_MOBILE_NAV] }));
    save(role, []); // empty → server stores null → app default
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-gray-500" /> Mobile Menu
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Choose which shortcuts appear on the phone bottom bar for each role (up to 4, in order).
          A “Menu” button is always shown. Users see only shortcuts their role can access.
        </p>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {roles.map((role) => {
            const chosen = sel[role.id] || [];
            const isDefault = !(role.mobile_nav && role.mobile_nav.length);
            return (
              <div key={role.id} className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-medium text-gray-900">
                    {role.name}
                    {isDefault && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">default</span>}
                    <span className="ml-2 text-xs text-gray-400">{chosen.length}/4</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => resetDefault(role)} className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                      <RotateCcw size={13} /> Default
                    </button>
                    <button onClick={() => save(role, chosen)} disabled={savingId === role.id}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1 disabled:opacity-50">
                      {savingId === role.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MOBILE_NAV_ITEMS.map(({ key, icon: Icon, label }) => {
                    const active = chosen.includes(key);
                    const order = chosen.indexOf(key) + 1;
                    return (
                      <button key={key} onClick={() => toggle(role.id, key)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          active ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}>
                        <Icon size={14} /> {label}
                        {active && <span className="ml-0.5 w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center">{order}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
