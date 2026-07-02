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

  const loginWithToken = useCallback((token, userData, pin) => {
    localStorage.setItem('auth_token', token);
    setUser(userData);
    if (pin) {
      localStorage.setItem('bio_user_name', userData.name);
      localStorage.setItem('bio_user_pin', pin);
      enrollBiometric(userData);
    }
  }, []);

  const login = useCallback(async (nameOrEmail, pin) => {
    const res = await fetch('/api/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameOrEmail, pin }),
    });
    const data = await res.json();
    if (data.needs_pin_setup) throw new Error('PIN_SETUP_REQUIRED');
    if (!res.ok) throw new Error(data.error);
    loginWithToken(data.token, data.user, pin);
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

async function enrollBiometric(user) {
  try {
    if (!window.PublicKeyCredential) return;
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.();
    if (!available) return;

    const existing = localStorage.getItem('bio_cred_ids');
    if (existing) return;

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Powder Ops FSQA', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(user.id),
          name: user.name,
          displayName: user.name,
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
        },
        timeout: 60000,
      },
    });

    if (credential) {
      const rawId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      localStorage.setItem('bio_cred_ids', JSON.stringify([rawId]));
    }
  } catch {
    // Biometric enrollment is optional
  }
}

export function useAuth() {
  return useContext(AuthContext);
}
