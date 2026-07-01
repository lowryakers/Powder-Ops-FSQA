import { useState, useEffect, useRef } from 'react';
import { Shield, Fingerprint, User, ChevronDown } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const nameRef = useRef(null);
  const suggestionsRef = useRef(null);

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
      await onLogin(name, pin);
    } catch (err) {
      setError(err.message || 'Login failed');
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
                placeholder="Your name"
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
            <input type="password" required value={pin} onChange={e => setPin(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base tracking-widest text-center" placeholder="••••" maxLength={8} />
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
