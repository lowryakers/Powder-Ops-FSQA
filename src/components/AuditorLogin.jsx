import { useState, useEffect, useCallback } from 'react';
import { Shield, KeyRound, AlertTriangle } from 'lucide-react';

// The way into the evidence binder for someone who does not work here.
//
// The old instruction was "the auditor signs in as auditor@powder-ops.com and
// sets a password on first sign-in", and it could not work: login matches on
// username or full name, never on an email address. Even corrected, a
// username and password is the wrong credential for a visitor — the account's
// password was never set, the PIN bridge asks for a PIN nobody has, and five
// wrong attempts locks the account for fifteen minutes with the auditor
// waiting. All three of those fail in front of the person being impressed.
//
// A pass is a link. It either works or it has been revoked. The link carries
// the code so the normal path is one tap and nothing is typed at all; the box
// below is for the case where the link came through as plain text and got
// broken across two lines, which is what actually happens when somebody pastes
// a URL into a text message.
export default function AuditorLogin({ onLoginWithToken, onStaffSignIn }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const redeem = useCallback(async (token) => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auditor-pass/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'That pass was not accepted.');
      // Clear the code out of the address bar before the binder renders, so a
      // screen being shared or a browser left open on the plant laptop is not
      // also handing out the credential.
      window.history.replaceState({}, '', '/auditor');
      onLoginWithToken(data.token, data.user);
    } catch (e) {
      setError(e.message || 'That pass was not accepted.');
    } finally {
      setBusy(false);
    }
  }, [onLoginWithToken]);

  // A pass in the URL signs in with nothing typed — the ordinary case.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('pass');
    if (fromUrl) redeem(fromUrl.trim());
  }, [redeem]);

  const submit = (e) => {
    e.preventDefault();
    const t = code.trim();
    if (t) redeem(t);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="h-14 w-14 bg-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Evidence Binder</h1>
          <p className="text-sm text-gray-500 mt-1">Powder Ops LLC · Vineyard, UT · read-only</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Access code</label>
            <div className="relative">
              <KeyRound size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={code} onChange={e => setCode(e.target.value)} autoFocus
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-base font-mono"
                placeholder="Paste the code from your link" />
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5 text-center">
              Normally you just open the link you were sent and this fills itself in.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-start gap-1.5">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>{error}</span>
            </p>
          )}

          <button type="submit" disabled={busy || !code.trim()}
            className="w-full py-3 bg-purple-600 text-white rounded-xl text-base font-bold hover:bg-purple-700 disabled:opacity-50 transition-colors">
            {busy ? 'Opening…' : 'Open the binder'}
          </button>
        </form>

        <button type="button" onClick={onStaffSignIn}
          className="w-full mt-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Powder Ops staff — sign in with your username
        </button>
      </div>
    </div>
  );
}
