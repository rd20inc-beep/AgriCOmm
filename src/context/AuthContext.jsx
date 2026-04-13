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
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('riceflow_token'));
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      const storedToken = localStorage.getItem('riceflow_token');
      if (!storedToken) {
        setIsLoading(false);
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
          // Merge permissions into user object
          if (payload.permissions && !userData.permissions) {
            userData.permissions = payload.permissions;
          }
          setUser(userData);
          setToken(storedToken);
        } else {
          // Token invalid
          localStorage.removeItem('riceflow_token');
          setToken(null);
          setUser(null);
        }
      } catch {
        // Network error — prototype mode fallback (dev only)
        if (import.meta.env.DEV && storedToken === MOCK_TOKEN) {
          console.warn('Mock auth fallback activated — backend unreachable (dev mode)');
          setUser(MOCK_USER);
          setToken(MOCK_TOKEN);
        } else {
          localStorage.removeItem('riceflow_token');
          setToken(null);
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    }

    validateToken();
  }, []);

  const login = useCallback(async (email, password, captchaToken) => {
    try {
      const body = { email, password };
      if (captchaToken) body.captchaToken = captchaToken;

      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const captchaRequired = res.headers.get('X-Captcha-Required') === '1';

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
          // Force all queries to re-evaluate enabled & refetch
          qc.invalidateQueries();
          return { success: true };
        }
        return { success: false, error: 'No token received', captchaRequired };
      } else {
        const json = await res.json().catch(() => ({}));
        return {
          success: false,
          error: json.message || 'Invalid credentials',
          captchaRequired: captchaRequired || !!json.captchaRequired,
        };
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
