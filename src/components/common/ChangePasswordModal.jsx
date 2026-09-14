import { useState } from 'react';
import { KeyRound } from 'lucide-react';

// Change your own password.
//
// LIVES IN `common/` BECAUSE THREE SURFACES NEED IT and one of them has no
// sidebar at all: the expired-password gate, the account menu in ReadyDoc, and
// the account menu inside Messages — which is the ONLY screen a client account
// ever sees, so a password control that exists only beside the module list is
// a control they cannot reach.
export default function ChangePasswordModal({ onClose, forced = false }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (nw.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    if (nw !== confirm) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: cur, new_password: nw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error || 'Could not change password.'); return; }
      setDone(true);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center px-4" onClick={forced ? undefined : onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={18} className="text-powder-600" />
          <h3 className="text-base font-bold text-gray-900">{forced ? 'Time to change your password' : 'Change your password'}</h3>
        </div>
        {forced && (
          <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-2">
            Passwords are changed at least once a year. Set a new one to carry on — you'll need your current password.
          </p>
        )}
        {done ? (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">Password changed. Use your new password next time you sign in.</p>
            <button onClick={forced ? () => window.location.reload() : onClose} className="w-full py-2.5 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-3">
            <p className="text-xs text-gray-500">Enter your current password, then choose a new one (at least 8 characters).</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Current password</label>
              <input type="password" autoFocus value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Current password" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
              <input type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="At least 8 characters" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirm new password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Re-enter new password" />
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={busy} className="flex-1 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Change password'}
              </button>
              {!forced && <button type="button" onClick={onClose} className="px-4 py-2.5 text-gray-500 text-sm font-medium rounded-lg hover:bg-gray-100">Cancel</button>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
