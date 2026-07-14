// Barcode/QR scanner (Stage 14). Uses the browser BarcodeDetector + camera when
// available (Chromium: web, desktop WebView2, Android); always offers a manual
// entry fallback so it works everywhere. The scanned value resolves to an in-app
// route via resolveScan and navigates there — which renders from the local
// replica, so lookups work offline. Opens on 'riceflow:open-scanner'.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Camera, ScanLine } from 'lucide-react';
import { resolveScan } from '../lib/scanResolve';

const canScan = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export default function ScanDrawer() {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const supported = canScan();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('riceflow:open-scanner', onOpen);
    return () => window.removeEventListener('riceflow:open-scanner', onOpen);
  }, []);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  };
  const close = () => { stop(); setOpen(false); setError(''); setManual(''); };

  const go = (raw) => {
    const r = resolveScan(raw);
    if (!r.ok) { setError(r.error || 'Unrecognized code'); return; }
    close();
    navigate(r.path);
  };

  useEffect(() => {
    if (!open || !supported) return undefined;

    const detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const tick = async () => {
          if (!videoRef.current || !streamRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length) { go(codes[0].rawValue); return; }
          } catch { /* frame not ready */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError('Camera unavailable — enter the code manually.');
      }
    })();
    return stop;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={close}>
      <div className="w-full max-w-sm rounded-xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-gray-900"><ScanLine size={18} /> Scan code</h2>
          <button onClick={close} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {supported ? (
          <div className="relative mb-3 aspect-square overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
          </div>
        ) : (
          <p className="mb-3 inline-flex items-center gap-1 text-xs text-gray-500"><Camera size={13} /> Camera scanning isn&rsquo;t available here — enter the code below.</p>
        )}
        <form onSubmit={(e) => { e.preventDefault(); go(manual); }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Enter or paste a code / lot no." className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">Go</button>
        </form>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <p className="mt-2 text-[11px] text-gray-400">Resolves offline from your synced data.</p>
      </div>
    </div>
  );
}
