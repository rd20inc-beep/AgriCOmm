const path = require('path');

/**
 * Where uploaded files live.
 *
 * docker-compose mounts the persistent volume at /app/uploads. Each module used
 * to build its own path with `path.join(__dirname, '../../uploads/...')`, and
 * the depth depends on how deep that file sits: from src/modules/<mod>/ two
 * levels up is /app/src/uploads — INSIDE the image, not the volume. Documents,
 * payment proofs and mobile uploads all landed there and were destroyed by the
 * next deploy, which happens several times a day. Chat got it right with three
 * levels, which is why chat files survived.
 *
 * Resolving once, from a file whose own depth is fixed, removes the guesswork:
 * src/config → ../../uploads → /app/uploads. UPLOADS_DIR overrides it for
 * deployments that keep uploads elsewhere.
 */
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.resolve(__dirname, '../../uploads');

/** A sub-directory of the uploads volume, e.g. uploadPath('documents'). */
function uploadPath(...segments) {
  return path.join(UPLOADS_ROOT, ...segments);
}

/** Create the directory if it does not exist, and return it. */
function ensureUploadDir(...segments) {
  const dir = uploadPath(...segments);
  const fs = require('fs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { UPLOADS_ROOT, uploadPath, ensureUploadDir };
