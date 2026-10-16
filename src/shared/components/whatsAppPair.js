import { useAuth } from '../../context/AuthContext';

// Pairing your OWN WhatsApp (P5-12 / PLT-18) has its own permission, held by
// every role that may send over WhatsApp (backend mig 440).
export const WA_PAIR_PERMISSION = ['communications', 'whatsapp_pair'];

export function useCanPairWhatsApp() {
  const { hasPermission } = useAuth();
  return hasPermission(...WA_PAIR_PERMISSION);
}
