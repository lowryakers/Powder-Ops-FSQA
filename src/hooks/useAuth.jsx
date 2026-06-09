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

  const login = useCallback(async (email, pin) => {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pin }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    const data = await res.json();
    localStorage.setItem('auth_token', data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      await fetch('/api/users/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    localStorage.removeItem('auth_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
