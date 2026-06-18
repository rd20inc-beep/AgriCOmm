import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '../api/client';

const AuthContext = createContext(null);

// Fallback for prototype mode (no backend)
const MOCK_USER = {
  id: 1,
  email: 'admin@riceflow.com',
  full_name: 'Admin User',
  role: 'Super Admin',
  permissions: [
    'export_orders.*',
    'milling.*',
    'finance.*',
    'inventory.*',
    'documents.*',
    'admin.*',
    'reports.*',
  ],
};

const MOCK_TOKEN = 'mock-prototype-token';

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  // Restore the cached user optimistically so a page reload doesn't flash a
  // logout while /api/auth/me re-validates. A genuinely-bad token is still caught
  // by the API client's 401 handler (clears token + redirects to /login).
  const [user, setUser] = useState(() => {
    try { const c = localStorage.getItem('riceflow_user'); return c ? JSON.parse(c) : null; } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('riceflow_token'));
  const [isLoading, setIsLoading] = useState(true);

  // Persist the user alongside the token so reloads can restore the session.
  const cacheUser = useCallback((u) => {
    try {
      if (u) localStorage.setItem('riceflow_user', JSON.stringify(u));
      else localStorage.removeItem('riceflow_user');
    } catch { /* storage full / disabled — non-fatal */ }
  }, []);

  const isAuthenticated = !!user && !!token;

  // Refresh user + permissions from /api/auth/me. Called on mount,
  // when the tab regains focus, and when admin migrations grant a new
  // permission while the user is mid-session — without this, a stale
  // `user.permissions` array can hide nav items the backend now allows
  // (e.g. mill_manager couldn't see Local Sales after migration 113
  // until they logged out and back in).
  const refreshAuth = useCallback(async ({ silent = false } = {}) => {
    const storedToken = localStorage.getItem('riceflow_token');
    if (!storedToken) {
      if (!silent) setIsLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (res.ok) {
        const json = await res.json();
        const payload = json.data || json;
        const userData = payload.user || payload;
        // Always overwrite permissions with the freshly-fetched list
        // (don't preserve stale cached perms on refresh).
        if (payload.permissions) userData.permissions = payload.permissions;
        setUser(userData);
        setToken(storedToken);
        cacheUser(userData);
      } else if (res.status === 401 || res.status === 403) {
        // Token genuinely rejected → log out.
        localStorage.removeItem('riceflow_token');
        setToken(null);
        setUser(null);
        cacheUser(null);
      }
      // Any other status (5xx / transient) → KEEP the cached session; the token is
      // still valid, the server just hiccuped. A real bad token is caught later by
      // the API client's 401 handler.
    } catch {
      // Network error — DON'T log out (a reload offline/slow shouldn't end the
      // session). Keep the cached user/token; dev mock fallback retained.
      if (import.meta.env.DEV && storedToken === MOCK_TOKEN) {
        setUser(MOCK_USER);
        setToken(MOCK_TOKEN);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  // Initial token validation on mount
  useEffect(() => { refreshAuth(); }, [refreshAuth]);

  // Re-fetch permissions whenever the tab regains focus. Keeps the
  // cached perm list in sync with backend changes (RBAC edits, new
  // role grants) without requiring the user to log out.
  useEffect(() => {
    function onFocus() { refreshAuth({ silent: true }); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshAuth({ silent: true });
    });
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshAuth]);

  const login = useCallback(async (email, password) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        const json = await res.json();
        // Backend returns { success, data: { token, user, permissions } }
        const payload = json.data || json;
        const newToken = payload.token;
        const userData = payload.user;
        // Merge permissions into user object so hasPermission() works immediately
        if (payload.permissions && userData) {
          userData.permissions = payload.permissions;
        }
        if (newToken) {
          localStorage.setItem('riceflow_token', newToken);
          setToken(newToken);
          setUser(userData);
          cacheUser(userData);
          // Force all queries to re-evaluate enabled & refetch
          qc.invalidateQueries();
          return { success: true };
        }
        return { success: false, error: 'No token received' };
      } else {
        const json = await res.json().catch(() => ({}));
        return { success: false, error: json.message || 'Invalid credentials' };
      }
    } catch {
      // Network error — prototype mode fallback (dev only)
      if (import.meta.env.DEV) {
        console.warn('Mock auth fallback activated — API unreachable, using prototype mock login (dev mode)');
        localStorage.setItem('riceflow_token', MOCK_TOKEN);
        setToken(MOCK_TOKEN);
        setUser(MOCK_USER);
        return { success: true };
      }
      return { success: false, error: 'Server is unreachable. Please try again later.' };
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('riceflow_token');
    localStorage.removeItem('riceflow_user');
    setToken(null);
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (module, action) => {
      if (!user) return false;
      if (user.role === 'Super Admin') return true;
      if (!user.permissions) return false;
      return user.permissions.some((perm) => {
        if (perm === `${module}.*`) return true;
        if (perm === `${module}.${action}`) return true;
        if (perm === '*.*') return true;
        return false;
      });
    },
    [user]
  );

  const isRole = useCallback(
    (roleName) => {
      return user?.role === roleName;
    },
    [user]
  );

  const value = {
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
    hasPermission,
    isRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
