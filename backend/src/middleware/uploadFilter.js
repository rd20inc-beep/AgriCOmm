// Upload allowlist + safe serving (P1-09 / PLT-23).
//
// Every multer upload in the app is a business document: a photo or scan, a
// PDF, an Office/OpenDocument file, a CSV/text export — and, in team chat, a
// voice note / short video / zip. Anything else (HTML, SVG, scripts,
// executables) is refused at upload, because a file served from the app's own
// origin with an active content type is a stored-XSS vector.
//
// Serving: raster images may render inline (chat thumbnails); every other
// file is sent as an attachment, with a Content-Type derived from the stored
// file's EXTENSION (never the uploader's claimed type) and `nosniff`.
const path = require('path');

const IMAGE = {
  '.jpg': ['image/jpeg', 'image/pjpeg'], '.jpeg': ['image/jpeg', 'image/pjpeg'], '.png': ['image/png'],
  '.gif': ['image/gif'], '.webp': ['image/webp'], '.bmp': ['image/bmp', 'image/x-ms-bmp'],
  '.tif': ['image/tiff'], '.tiff': ['image/tiff'], '.heic': ['image/heic', 'image/heif'], '.heif': ['image/heif', 'image/heic'],
};
const DOCS = {
  '.pdf': ['application/pdf', 'application/x-pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.odt': ['application/vnd.oasis.opendocument.text'],
  '.ods': ['application/vnd.oasis.opendocument.spreadsheet'],
  '.odp': ['application/vnd.oasis.opendocument.presentation'],
  '.rtf': ['application/rtf', 'text/rtf'],
  '.csv': ['text/csv', 'application/csv', 'text/x-csv', 'application/vnd.ms-excel', 'text/plain'],
  '.txt': ['text/plain'],
};
// Chat only: voice notes, short clips and archives people already share there.
const CHAT_EXTRA = {
  '.mp3': ['audio/mpeg', 'audio/mp3'], '.m4a': ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
  '.ogg': ['audio/ogg', 'application/ogg'], '.opus': ['audio/ogg', 'audio/opus'], '.wav': ['audio/wav', 'audio/x-wav', 'audio/wave'],
  '.aac': ['audio/aac'], '.mp4': ['video/mp4'], '.mov': ['video/quicktime'], '.webm': ['video/webm', 'audio/webm'],
  '.3gp': ['video/3gpp', 'audio/3gpp'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

const PROFILES = {
  documents: { ...IMAGE, ...DOCS },
  chat: { ...IMAGE, ...DOCS, ...CHAT_EXTRA },
};
// Generic types a browser/phone sends when it doesn't know better.
const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

function extOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

/** null if `file` ({ originalname, mimetype }) is allowed under `profile`, else the reason. */
function uploadRejection(file, profile = 'documents') {
  const allowed = PROFILES[profile] || PROFILES.documents;
  const ext = extOf(file && file.originalname);
  const mimes = allowed[ext];
  if (!mimes) return `File type ${ext || '(none)'} is not allowed. Upload an image, PDF, Office document or CSV.`;
  const mime = String((file && file.mimetype) || '').toLowerCase().split(';')[0].trim();
  if (!GENERIC_MIMES.has(mime) && !mimes.includes(mime)) return `File content type ${mime} does not match ${ext}.`;
  return null;
}

/** multer `fileFilter` for a profile; a rejected file fails the request with 400. */
function uploadFileFilter(profile = 'documents') {
  return (req, file, cb) => {
    const why = uploadRejection(file, profile);
    if (!why) return cb(null, true);
    const err = new Error(why);
    err.statusCode = 400;
    return cb(err);
  };
}

const INLINE_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

function contentTypeFor(fileName) {
  const ext = extOf(fileName);
  const all = PROFILES.chat[ext];
  if (!all) return 'application/octet-stream';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return all[0];
}

/**
 * Set safe response headers for serving a stored upload. `storedName` is the
 * file on disk (its extension decides the type); `downloadName` the name the
 * user sees. Returns the Content-Type that was set.
 */
function setSafeFileHeaders(res, storedName, downloadName) {
  const name = downloadName || path.basename(String(storedName || 'file'));
  const type = contentTypeFor(storedName);
  const inline = INLINE_IMAGE_EXT.has(extOf(storedName));
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  return type;
}

module.exports = { uploadRejection, uploadFileFilter, setSafeFileHeaders, contentTypeFor, PROFILES };
