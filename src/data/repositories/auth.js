// Auth repository — the only place staff-auth network calls live. Returns
// { ok, status, data } and THROWS only on a genuine network failure, so callers
// (AuthContext) keep their exact branching: ok → set session; 401/403 → log out;
// other status → keep cached session; network throw → offline/mock fallback.
import platform from '../../platform';
import { getDeviceId } from '../../sync/deviceId';

function deviceHeader() {
  try { return { 'X-Device-Id': getDeviceId() }; } catch { return {}; }
}

export const authRepo = {
  async me(token) {
    const res = await platform.net.fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  },

  async login(email, password) {
    const res = await platform.net.fetch('/api/auth/login', {
      method: 'POST',
      // The device id lets the server refuse sign-in from a revoked device.
      headers: { 'Content-Type': 'application/json', ...deviceHeader() },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  },

  // Public password-reset endpoints (no session). Same { ok, status, data } shape.
  async forgotPassword(email) {
    const res = await platform.net.fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  },

  async resetPassword(token, newPassword) {
    const res = await platform.net.fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  },
};

export default authRepo;
