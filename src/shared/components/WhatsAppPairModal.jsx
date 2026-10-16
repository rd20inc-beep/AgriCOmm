import { useCallback, useEffect, useState } from 'react';
import { Loader2, QrCode, Check, X } from 'lucide-react';
import api from '../../api/client';
import Modal from './Modal';

// "Pair my WhatsApp" (P5-12 / PLT-18). WhatsApp-QR sessions are per user: each
// person links their OWN number by scanning a QR. This used to live only in
// Admin → WhatsApp (admin.manage_settings), so a Mill or Finance Manager who may
// send a document could never pair. It now opens from every WhatsApp send
// button for anyone holding communications.whatsapp_pair.

// The gate (communications.whatsapp_pair) and its hook live in whatsAppPair.js.
const STATUS_URL = '/api/communication/whatsapp/qr/status';

export default function WhatsAppPairModal({ isOpen, onClose, onConnected }) {
  const [st, setSt] = useState({ status: 'disconnected', qrDataUrl: null, phone: null, error: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const poll = useCallback(async () => {
    try {
      const res = await api.get(STATUS_URL);
      const next = res?.data || res;
      if (next && next.status) setSt(next);
    } catch { /* keep the current state */ }
  }, []);

  useEffect(() => { if (isOpen) poll(); }, [isOpen, poll]);

  // While a QR is on screen, poll so it refreshes and we see "connected".
  useEffect(() => {
    if (!isOpen || st.status === 'connected' || st.status === 'disconnected') return undefined;
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [isOpen, st.status, poll]);

  useEffect(() => {
    if (isOpen && st.status === 'connected') onConnected?.(st);
  }, [isOpen, st.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.post('/api/communication/whatsapp/qr/start', {});
      const next = res?.data || res;
      if (next?.status) setSt(next);
    } catch (e) {
      setErr(e?.message || 'Could not start WhatsApp pairing');
    } finally { setBusy(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pair my WhatsApp" size="sm">
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Documents are sent from <b>your own</b> WhatsApp. Link it once: generate a QR code, then on your
          phone open WhatsApp → Linked devices → Link a device, and scan it. Other users are unaffected.
        </p>
        {st.status === 'connected' ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-800">
            <Check className="w-4 h-4" /> Connected{st.phone ? ` · +${st.phone}` : ''}. You can send now.
          </div>
        ) : st.status === 'qr' && st.qrDataUrl ? (
          <div className="flex flex-col items-center gap-2">
            <img src={st.qrDataUrl} alt="WhatsApp pairing QR code" className="w-48 h-48 rounded-lg border border-gray-200" />
            <span className="text-xs text-gray-500">Waiting for you to scan…</span>
          </div>
        ) : (
          <button type="button" onClick={start} disabled={busy || st.status === 'connecting'}
            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50">
            {busy || st.status === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            {st.status === 'connecting' ? 'Starting…' : 'Generate QR code'}
          </button>
        )}
        {(err || st.error) && (
          <p className="text-xs text-red-600 flex items-center gap-1"><X className="w-3 h-3" /> {err || st.error}</p>
        )}
      </div>
    </Modal>
  );
}
