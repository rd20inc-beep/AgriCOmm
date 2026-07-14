import { useState } from 'react';
import { Smartphone, Monitor, Globe, ShieldOff, ShieldCheck, RotateCcw } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { useAuth } from '../../../../context/AuthContext';
import { useDevices, useRevokeDevice, useReactivateDevice } from '../../api/queries';

// Only owners can flip a device's active/revoked state (mirrors the server gate).
const MANAGE_ROLES = ['Super Admin', 'Owner'];

const PLATFORM = {
  web: { icon: Globe, label: 'Web browser' },
  tauri: { icon: Monitor, label: 'Windows desktop' },
  capacitor: { icon: Smartphone, label: 'Android app' },
};

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

export default function DevicesTab() {
  const { addToast } = useApp();
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.includes(user?.role);

  const { data, isLoading, isError } = useDevices();
  const revokeMut = useRevokeDevice();
  const reactivateMut = useReactivateDevice();
  const [busyId, setBusyId] = useState(null);

  const devices = data?.devices || [];
  const currentUuid = data?.currentDeviceUuid || null;

  const revoke = async (dev) => {
    if (!window.confirm(`Revoke "${dev.label || dev.platform || 'this device'}"?\n\nIts next action while online will be refused and its offline data wiped. It can reconnect only after you reactivate it.`)) return;
    setBusyId(dev.id);
    try {
      await revokeMut.mutateAsync(dev.id);
      addToast('Device revoked', 'success');
    } catch (e) {
      addToast(e?.message || 'Failed to revoke device', 'error');
    } finally { setBusyId(null); }
  };

  const reactivate = async (dev) => {
    setBusyId(dev.id);
    try {
      await reactivateMut.mutateAsync(dev.id);
      addToast('Device reactivated', 'success');
    } catch (e) {
      addToast(e?.message || 'Failed to reactivate device', 'error');
    } finally { setBusyId(null); }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-gray-500" /> Devices
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Every web, desktop and Android install registered for offline use. Revoke a lost or
          decommissioned device to cut off its access and wipe its local data on next connect.
        </p>
      </div>

      {isLoading ? (
        <div className="p-6 text-sm text-gray-500">Loading devices…</div>
      ) : isError ? (
        <div className="p-6 text-sm text-red-600">Failed to load devices.</div>
      ) : devices.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">No devices registered yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200">
                <th className="px-5 py-3 font-medium">Device</th>
                <th className="px-5 py-3 font-medium">User</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Last seen</th>
                <th className="px-5 py-3 font-medium">Registered</th>
                {canManage && <th className="px-5 py-3 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {devices.map((dev) => {
                const meta = PLATFORM[dev.platform] || { icon: Globe, label: dev.platform || 'Unknown' };
                const PIcon = meta.icon;
                const revoked = dev.status === 'revoked';
                const isCurrent = currentUuid && dev.device_uuid === currentUuid;
                const busy = busyId === dev.id;
                return (
                  <tr key={dev.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                          <PIcon className="w-4 h-4 text-gray-500" />
                        </span>
                        <div>
                          <div className="font-medium text-gray-900 flex items-center gap-2">
                            {dev.label || meta.label}
                            {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold">This device</span>}
                          </div>
                          <div className="text-xs text-gray-400">
                            {meta.label}{dev.app_version ? ` · v${dev.app_version}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-gray-900">{dev.user_name || dev.user_email || `User #${dev.user_id ?? '—'}`}</div>
                      {dev.role_name && <div className="text-xs text-gray-400">{dev.role_name}</div>}
                    </td>
                    <td className="px-5 py-3">
                      {revoked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-red-50 text-red-600">
                          <ShieldOff className="w-3 h-3" /> Revoked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-green-50 text-green-600">
                          <ShieldCheck className="w-3 h-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{fmt(dev.last_seen_at)}</td>
                    <td className="px-5 py-3 text-gray-600">{fmt(dev.registered_at)}</td>
                    {canManage && (
                      <td className="px-5 py-3 text-right">
                        {revoked ? (
                          <button
                            onClick={() => reactivate(dev)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Reactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => revoke(dev)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            <ShieldOff className="w-3.5 h-3.5" /> Revoke
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
