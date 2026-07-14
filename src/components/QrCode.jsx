// Renders a scannable QR (Stage 14). Client-side so it works offline and prints
// cleanly (SVG). Use on lot/document labels: <QrCode value={deepLink('lot', id)} />.
import { useEffect, useState } from 'react';
import { generateQrSvg } from '../lib/qr';

export default function QrCode({ value, size = 160, className = '' }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    generateQrSvg(value, { size }).then((s) => { if (alive) setSvg(s); }).catch(() => {});
    return () => { alive = false; };
  }, [value, size]);

  if (!svg) return null;
  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      aria-label={`QR code for ${value}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
