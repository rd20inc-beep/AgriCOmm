// QR generation (Stage 14) — client-side, so scannable labels render offline.
import QRCode from 'qrcode';

export async function generateQrSvg(value, { size = 160 } = {}) {
  return QRCode.toString(String(value), { type: 'svg', margin: 1, width: size, errorCorrectionLevel: 'M' });
}

export async function generateQrDataUrl(value, { size = 256 } = {}) {
  return QRCode.toDataURL(String(value), { margin: 1, width: size, errorCorrectionLevel: 'M' });
}
