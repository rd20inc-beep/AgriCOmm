/**
 * Cloudflare Turnstile captcha guard for login.
 *
 * Tracks failed login attempts per IP and requires a Turnstile token
 * once the IP has accumulated >= FAIL_THRESHOLD failures within the window.
 *
 * This sits in front of the route's password check; the regular rate limiter
 * remains in place as a final ceiling.
 */

const FAIL_THRESHOLD = 3;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes — moderate window

const failureCache = new Map(); // ip -> { count, firstAt }

function getRealIP(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-real-ip']
    || req.ip
    || 'unknown';
}

function pruneIfExpired(ip) {
  const entry = failureCache.get(ip);
  if (!entry) return null;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failureCache.delete(ip);
    return null;
  }
  return entry;
}

function recordFailure(ip) {
  if (!ip) return;
  const entry = pruneIfExpired(ip);
  if (entry) {
    entry.count += 1;
  } else {
    failureCache.set(ip, { count: 1, firstAt: Date.now() });
  }
}

function clearFailures(ip) {
  if (!ip) return;
  failureCache.delete(ip);
}

function getFailureCount(ip) {
  const entry = pruneIfExpired(ip);
  return entry ? entry.count : 0;
}

async function verifyTurnstileToken(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    // No secret configured — treat as pass to avoid hard-locking dev/staging.
    // Production must set TURNSTILE_SECRET.
    console.warn('[captchaGuard] TURNSTILE_SECRET not set — skipping verification');
    return true;
  }

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (ip) params.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
    });
    const json = await res.json();
    return !!json.success;
  } catch (err) {
    console.error('[captchaGuard] Turnstile verify failed:', err.message);
    return false;
  }
}

async function requireCaptchaIfFlagged(req, res, next) {
  const ip = getRealIP(req);
  const count = getFailureCount(ip);

  // Tell the client whether captcha is required (header read by the SPA)
  res.set('X-Captcha-Required', count >= FAIL_THRESHOLD ? '1' : '0');

  if (count < FAIL_THRESHOLD) {
    return next();
  }

  const token = req.body && req.body.captchaToken;
  if (!token) {
    return res.status(400).json({
      success: false,
      message: 'Captcha required. Please complete the verification.',
      captchaRequired: true,
    });
  }

  const valid = await verifyTurnstileToken(token, ip);
  if (!valid) {
    return res.status(400).json({
      success: false,
      message: 'Captcha verification failed. Please try again.',
      captchaRequired: true,
    });
  }

  next();
}

module.exports = {
  requireCaptchaIfFlagged,
  recordFailure,
  clearFailures,
  getFailureCount,
  FAIL_THRESHOLD,
};
