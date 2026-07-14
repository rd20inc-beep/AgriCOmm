// Auth repository — the only place staff-auth network calls live. Returns
// { ok, status, data } and THROWS only on a genuine network failure, so callers
// (AuthContext) keep their exact branching: ok → set session; 401/403 → log out;
// other status → keep cached session; network throw → offline/mock fallback.
import platform from '../../platform';

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  },
};

export default authRepo;
