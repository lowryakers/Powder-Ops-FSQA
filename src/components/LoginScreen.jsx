import { useState, useEffect, useRef } from 'react';
import { Shield, Fingerprint, User, KeyRound } from 'lucide-react';

export default function LoginScreen({ onLogin, onLoginWithToken }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [setupMode, setSetupMode] = useState(null);
  const [confirmPin, setConfirmPin] = useState('');
  const nameRef = useRef(null);
  const suggestionsRef = useRef(null);
  const pinRef = useRef(null);

  useEffect(() => {
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
        .then(ok => setBiometricAvailable(ok))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (name.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/users/lookup?q=${encodeURIComponent(name)}`)
        .then(r => r.ok ? r.json() : [])
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [name]);

  useEffect(() => {
    const handleClick = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
          nameRef.current && !nameRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectUser = (u) => {
    setName(u.name);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin: pin || undefined }),
      });
      const data = await res.json();

      if (data.needs_pin_setup) {
        setSetupMode({ user_id: data.user_id, user_name: data.user_name });
        setPin('');
        setConfirmPin('');
        setLoading(false);
        setTimeout(() => pinRef.current?.focus(), 100);
        return;
      }

      if (!res.ok) throw new Error(data.error);

      if (onLoginWithToken) {
        onLoginWithToken(data.token, data.user, pin);
      } else {
        await onLogin(name, pin);
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPin = async (e) => {
    e.preventDefault();
    setError('');
    if (pin.length < 4) { setError('PIN must be at least 4 digits'); return; }
    if (pin !== confirmPin) { setError('PINs do not match'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/users/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: setupMode.user_id, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (onLoginWithToken) {
        onLoginWithToken(data.token, data.user, pin);
      } else {
        await onLogin(setupMode.user_name, pin);
      }
    } catch (err) {
      setError(err.message || 'Failed to set PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    const savedName = localStorage.getItem('bio_user_name');
    if (!savedName) {
      setError('Sign in with your PIN first to enable Face ID / fingerprint');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60000,
          userVerification: 'required',
          rpId: window.location.hostname,
          allowCredentials: JSON.parse(localStorage.getItem('bio_cred_ids') || '[]').map(id => ({
            type: 'public-key',
            id: Uint8Array.from(atob(id), c => c.charCodeAt(0)),
          })),
        },
      });
      if (credential) {
        const savedPin = localStorage.getItem('bio_user_pin');
        await onLogin(savedName, savedPin);
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        setError('Biometric sign-in failed. Use your PIN instead.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (setupMode) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="h-14 w-14 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <KeyRound size={28} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Welcome, {setupMode.user_name}!</h1>
            <p className="text-sm text-gray-500 mt-1">Create your PIN to get started</p>
          </div>

          <form onSubmit={handleSetPin} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Create PIN</label>
              <input ref={pinRef} type="password" required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base tracking-widest text-center"
                placeholder="Enter 4+ digit PIN" minLength={4} maxLength={8} inputMode="numeric" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm PIN</label>
              <input type="password" required value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base tracking-widest text-center"
                placeholder="Re-enter PIN" minLength={4} maxLength={8} inputMode="numeric" />
            </div>

            {error && <p className="text-sm text-red-600 text-center">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-xl text-base font-bold hover:bg-green-700 disabled:opacity-50 transition-colors">
              {loading ? 'Setting up...' : 'Set PIN & Sign In'}
            </button>

            <button type="button" onClick={() => { setSetupMode(null); setPin(''); setConfirmPin(''); setError(''); }}
              className="w-full py-2 text-sm text-gray-500 hover:text-gray-700">
              Back to sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="h-14 w-14 bg-powder-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Powder Ops FSQA</h1>
          <p className="text-sm text-gray-500 mt-1">Compliance & Preventive Maintenance</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <div className="relative">
              <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={nameRef}
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={e => { setName(e.target.value); setShowSuggestions(true); }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-base"
                placeholder="Your full name"
              />
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div ref={suggestionsRef} className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                {suggestions.map(u => (
                  <button key={u.id} type="button" onClick={() => selectUser(u)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between border-b border-gray-100 last:border-0">
                    <span className="font-medium text-gray-900">{u.name}</span>
                    <span className="text-xs text-gray-400 capitalize">{u.department}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base tracking-widest text-center" placeholder="••••" maxLength={8} />
            <p className="text-[11px] text-gray-400 mt-1 text-center">First time? Just enter your name and click Sign In.</p>
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-3 bg-powder-600 text-white rounded-xl text-base font-bold hover:bg-powder-700 disabled:opacity-50 transition-colors">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>

          {biometricAvailable && (
            <button type="button" onClick={handleBiometric} disabled={loading}
              className="w-full py-3 border-2 border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              <Fingerprint size={20} />
              Sign in with Face ID / Fingerprint
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
