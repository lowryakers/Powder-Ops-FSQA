import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
