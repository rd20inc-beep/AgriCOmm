import { useState, useCallback } from 'react';
import { useSettings as useSettingsQuery } from '../../api/queries';
import { useAuth } from '../context/AuthContext';

const defaultSettings = {
  qualityThreshold: 1.0,
  defaultAdvancePct: 20,
  defaultCurrency: 'USD',
  millCurrency: 'PKR',
  pkrRate: 280,
  paymentReminderDays: 7,
  lowMarginThreshold: 5,
};

/**
 * Hook for app settings — merges API settings with defaults and local overrides.
 */
export function useAppSettings() {
  const { token } = useAuth();
  const isLoggedIn = !!token && token !== 'mock-prototype-token';
  const { data: apiSettings } = useSettingsQuery({ enabled: isLoggedIn });

  const [localSettings, setLocalSettings] = useState({});
  const settings = { ...defaultSettings, ...(apiSettings || {}), ...localSettings };

  const updateSettings = useCallback((newSettings) => {
    setLocalSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  return { settings, updateSettings };
}
