import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { setViewAsWriteGuard } from './useApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Admin "View as": the whole app renders with this user's role/department/
  // module access. UI-only — requests still authenticate as the real admin, so
  // useApi blocks writes while active (attribution must stay truthful).
  const [viewAs, setViewAs] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) { setLoading(false); return; }
    fetch('/api/users/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(u => setUser(u))
      .catch(() => localStorage.removeItem('auth_token'))
      .finally(() => setLoading(false));
  }, []);

  const loginWithToken = useCallback((token, userData) => {
    localStorage.setItem('auth_token', token);
    setUser(userData);
  }, []);

  const login = useCallback(async (nameOrEmail, password) => {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameOrEmail, password }),
    });
    const data = await res.json();
    if (data.needs_password_setup) throw new Error('PASSWORD_SETUP_REQUIRED');
    if (!res.ok) throw new Error(data.error);
    loginWithToken(data.token, data.user);
    return data.user;
  }, [loginWithToken]);

  const logout = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      await fetch('/api/users/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    localStorage.removeItem('auth_token');
    setViewAs(null);
    setViewAsWriteGuard(null);
    setUser(null);
  }, []);

  const startViewAs = useCallback((target) => {
    if (!target || user?.role !== 'admin') return;
    // GET /users returns module_access as the raw JSON string from the DB;
    // the permission helpers need it parsed (or null = unrestricted).
    let ma = target.module_access;
    if (typeof ma === 'string') { try { ma = JSON.parse(ma); } catch { ma = null; } }
    const normalized = { ...target, module_access: ma ?? null };
    setViewAs(normalized);
    setViewAsWriteGuard(normalized.name);
  }, [user]);

  const stopViewAs = useCallback(() => {
    setViewAs(null);
    setViewAsWriteGuard(null);
  }, []);

  // The user the app RENDERS as. Impersonation keeps the target's own role,
  // department, and module_access so nav/gating match what they'd really see.
  const effectiveUser = viewAs && user ? {
    ...viewAs,
    role: viewAs.role === 'admin' ? 'operator' : (viewAs.role || 'operator'),
  } : user;

  return (
    <AuthContext.Provider value={{ user: effectiveUser, realUser: user, viewAs, startViewAs, stopViewAs, loading, login, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
