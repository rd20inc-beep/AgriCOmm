import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { adminApi, devicesApi } from './services';

/**
 * Count of pending master-data quick-add approvals (Admin → Approvals queue).
 * Shared by the sidebar Admin badge and the dashboard action queue so both stay
 * in sync. Polls every 30s; only runs for users who can see the admin area.
 */
export function useMasterDataApprovalsCount() {
  const { hasPermission } = useAuth();
  return useQuery({
    queryKey: ['admin', 'approvals', 'count'],
    queryFn: async () => {
      const res = await adminApi.approvalsCount();
      return res?.data?.total ?? res?.total ?? 0;
    },
    enabled: hasPermission('admin', 'view'),
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
    placeholderData: (prev) => prev,
  });
}

/**
 * Registered offline devices (web / desktop / Android installs). Manager-gated on
 * the server. Returns { devices, current_device_uuid } so the UI can flag the
 * caller's own device.
 */
export function useDevices() {
  return useQuery({
    queryKey: ['admin', 'devices'],
    queryFn: async () => {
      const res = await devicesApi.list();
      const data = res?.data ?? res ?? {};
      return { devices: data.devices || [], currentDeviceUuid: data.current_device_uuid || null };
    },
    staleTime: 15 * 1000,
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => devicesApi.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  });
}

export function useReactivateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => devicesApi.reactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
  });
}
