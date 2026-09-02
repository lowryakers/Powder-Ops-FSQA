import { useEffect, useRef, useState } from 'react';
import { PenLine, X } from 'lucide-react';
import { SIGNATURE_EVENT } from '../../lib/signature';

/**
 * "Confirm your password to sign."
 *
 * Mounted ONCE, at the top of the app. A QA signature is the plant's statement
 * that a named person reviewed a record and accepted it, and until now the only
 * thing behind that name was a session opened at some point earlier — on a
 * shared floor tablet that can be hours ago and two people back.
 *
 * THE PASSWORD IS HELD ONLY UNTIL THE REQUEST RETURNS. It is not kept between
 * signatures, not remembered for the session, and cleared the moment this
 * closes: somebody who walks away mid-signature leaves nothing behind. That is
 * the whole point of asking at the moment of signing rather than at login.
 */
export default function SignaturePrompt() {
  const [req, setReq] = useState(null);
  const [password, setPassword] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const onAsk = (e) => { setPassword(''); setReq(e.detail); };
    window.addEventListener(SIGNATURE_EVENT, onAsk);
    return () => window.removeEventListener(SIGNATURE_EVENT, onAsk);
  }, []);

  useEffect(() => { if (req) setTimeout(() => inputRef.current?.focus(), 30); }, [req]);

  if (!req) return null;

  const finish = (value) => {
    const { resolve } = req;
    setReq(null);
    setPassword('');
    resolve(value);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4"
      onClick={() => finish(null)}>
      <form onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (password) finish(password); }}
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
              <PenLine size={16} className="text-powder-600" /> {req.title || 'Confirm your signature'}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {req.detail || 'Enter your password to sign this record.'}
            </p>
          </div>
          <button type="button" onClick={() => finish(null)} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-gray-600">Your password</span>
          <input ref={inputRef} type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </label>

        {/* The server's own words on a wrong password, including when it stops
            accepting attempts — a client-side count would be a second opinion
            about a limit it does not enforce. */}
        {req.message && <p className="text-sm text-red-700">{req.message}</p>}

        <p className="text-[11px] text-gray-400">
          Signing records who you are and when. Your password is not stored.
        </p>

        <div className="flex gap-2">
          <button type="submit" disabled={!password}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            Sign
          </button>
          <button type="button" onClick={() => finish(null)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}
