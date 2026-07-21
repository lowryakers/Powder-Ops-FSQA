import { useState, useEffect, useRef } from 'react';
import { Shield, User, KeyRound, Lock } from 'lucide-react';

export default function LoginScreen({ onLogin, onLoginWithToken }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [setupMode, setSetupMode] = useState(null); // { user_id, user_name, has_pin }
  const [currentPin, setCurrentPin] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const nameRef = useRef(null);
  const suggestionsRef = useRef(null);
  const setupRef = useRef(null);

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

  const selectUser = (u) => { setName(u.name); setShowSuggestions(false); setSuggestions([]); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, password: password || undefined }),
      });
      const data = await res.json();

      if (data.needs_password_setup) {
        setSetupMode({ user_id: data.user_id, user_name: data.user_name, has_pin: data.has_pin });
        setPassword(''); setConfirmPassword(''); setCurrentPin('');
        setLoading(false);
        setTimeout(() => setupRef.current?.focus(), 100);
        return;
      }
      if (!res.ok) throw new Error(data.error);

      if (onLoginWithToken) onLoginWithToken(data.token, data.user);
      else await onLogin(name, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (setupMode.has_pin && !currentPin) { setError('Enter your current PIN to continue'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/users/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: setupMode.user_id, password, current_pin: currentPin || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (onLoginWithToken) onLoginWithToken(data.token, data.user);
      else await onLogin(setupMode.user_name, password);
    } catch (err) {
      setError(err.message || 'Failed to set password');
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
            <p className="text-sm text-gray-500 mt-1">Create your password to get started</p>
          </div>

          <form onSubmit={handleSetPassword} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
            {setupMode.has_pin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current PIN</label>
                <input ref={setupRef} type="password" required value={currentPin} onChange={e => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base tracking-widest text-center"
                  placeholder="Your existing PIN" inputMode="numeric" maxLength={8} />
                <p className="text-[11px] text-gray-400 mt-1 text-center">Confirm your identity with your old PIN. We'll switch you to a password.</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input ref={setupMode.has_pin ? undefined : setupRef} type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="At least 8 characters" minLength={8} autoComplete="new-password" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Re-enter password" minLength={8} autoComplete="new-password" />
            </div>

            {error && <p className="text-sm text-red-600 text-center">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-green-600 text-white rounded-xl text-base font-bold hover:bg-green-700 disabled:opacity-50 transition-colors">
              {loading ? 'Setting up…' : 'Set password & Sign In'}
            </button>
            <button type="button" onClick={() => { setSetupMode(null); setPassword(''); setConfirmPassword(''); setCurrentPin(''); setError(''); }}
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
          <h1 className="text-2xl font-bold text-gray-900">ReadyDoc</h1>
          <p className="text-sm text-gray-500 mt-1">Powder Ops · FSQA & Compliance</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <div className="relative">
              <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input ref={nameRef} type="text" required autoComplete="name" value={name}
                onChange={e => { setName(e.target.value); setShowSuggestions(true); }}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Your full name" />
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Your password" />
            </div>
            <p className="text-[11px] text-gray-400 mt-1 text-center">First time here, or an admin reset your password? Leave this blank and click Sign In to create your password.</p>
          </div>

          {error && <p className="text-sm text-red-600 text-center">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-3 bg-powder-600 text-white rounded-xl text-base font-bold hover:bg-powder-700 disabled:opacity-50 transition-colors">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
