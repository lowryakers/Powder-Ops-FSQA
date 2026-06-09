import { useState } from 'react';
import { Shield } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(email, pin);
    } catch (err) {
      setError(err.message || 'Login failed');
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="you@powder-ops.com" />
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
        </form>
      </div>
    </div>
  );
}
