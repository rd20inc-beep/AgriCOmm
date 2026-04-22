import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

/**
 * Shared hook for current USD/PKR rate — single source of truth.
 * Reads from the finance overview summary (which pulls from system_settings / fx_rates).
 * Use this instead of hardcoding 280.
 */

const FALLBACK_RATE = 280;

export function useFxRate() {
  const { data } = useQuery({
    queryKey: ['fx-rate-current'],
    queryFn: async () => {
      try {
        const res = await api.get('/api/finance/overview-summary');
        const summary = res?.data?.data?.summary || res?.data?.summary || res?.data || {};
        return parseFloat(summary.currentFxRate) || FALLBACK_RATE;
      } catch {
        return FALLBACK_RATE;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  return data || FALLBACK_RATE;
}
