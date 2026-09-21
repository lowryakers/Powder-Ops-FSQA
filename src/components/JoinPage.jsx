import { useState, useEffect } from 'react';
import { KeyRound, MessageSquare, AlertTriangle, CheckCircle } from 'lucide-react';
import InstallReadyDoc from './common/InstallReadyDoc.jsx';

/**
 * The page a join link opens — public, no login, because the person holding it
 * has no account they can sign into yet.
 *
 * IT ASKS FOR ONE THING. The token already says who they are, so there is no
 * name to type, no code to copy out of a text, and no company to pick: a
 * password, twice, and they are in. Every extra field here is a person giving
 * up halfway through on a phone.
 *
 * A REFUSAL SAYS WHICH REFUSAL IT IS. Used, withdrawn, expired and "you already
 * have a password" need four different next steps, and one polite "this link is
 * not valid" makes the office guess on the phone. The server sends the sentence;
 * this renders it.
 */
export default function JoinPage({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/join/${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => setInfo(d))
      .catch(() => setInfo({ ok: false, reason: 'We could not reach ReadyDoc. Check your connection and try again.' }));
  }, [token]);

  const min = info?.min_password || 8;
  const tooShort = password.length > 0 && password.length < min;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= min && confirm === password && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/join/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Something went wrong');
      // Signed in on the spot. Being handed a login screen after choosing a
      // password is the moment people close the tab, and the server has just
      // issued a real session — using it is not a shortcut, it is the point.
      localStorage.setItem('auth_token', d.token);
      localStorage.setItem('auth_user', JSON.stringify(d.user));
      setDone(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  if (!info) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  }

  // THE LINK'S JOB IS NOT DONE AT "you're in".
  //
  // It used to drop them at the app after a second and a quarter, which
  // answered the first two thirds of what somebody needs — where to go, how to
  // sign in — and silently skipped the third. On a phone, an app you reach by
  // finding a text message from last week is one you stop opening. The
  // instructions are the same ones the onboarding wizard gives, from the same
  // component, and Open ReadyDoc is still one tap away for anyone who would
  // rather get on with it.
  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-8">
        <div className="max-w-sm w-full space-y-4" data-join-done>
          <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center">
            <CheckCircle size={40} className="text-green-600 mx-auto mb-3" />
            <p className="text-lg font-semibold text-gray-900">You&apos;re in.</p>
            <p className="text-sm text-gray-600 mt-1">
              You&apos;re signed in as <span className="font-medium text-gray-900">{info?.name}</span>.
            </p>
          </div>
          <InstallReadyDoc />
          <button type="button" onClick={() => { window.location.href = '/'; }} data-join-open
            className="w-full py-3 bg-gray-900 text-white rounded-xl text-base font-semibold">
            Open ReadyDoc
          </button>
        </div>
      </div>
    );
  }

  if (!info.ok) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-sm w-full" data-join-refused>
          <AlertTriangle size={32} className="text-amber-500 mb-3" />
          <p className="text-base font-semibold text-gray-900">This link will not open</p>
          <p className="text-sm text-gray-600 mt-2">{info.reason}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="bg-white border border-gray-200 rounded-2xl p-6 max-w-sm w-full" data-join-form>
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={18} className="text-powder-600" />
          <p className="text-xs font-bold uppercase tracking-wide text-powder-700">Powder Ops ReadyDoc</p>
        </div>
        <p className="text-lg font-semibold text-gray-900">Hello {info.name}</p>
        {info.channel
          ? (
            <p className="text-sm text-gray-600 mt-1 flex items-start gap-1.5" data-join-channel>
              <MessageSquare size={14} className="text-gray-400 shrink-0 mt-0.5" />
              <span>Choose a password and you will land in <b>#{info.channel}</b>.</span>
            </p>
          )
          : <p className="text-sm text-gray-600 mt-1">Choose a password to finish setting up your account.</p>}

        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="join-pw">New password</label>
            <input id="join-pw" type="password" value={password} autoComplete="new-password"
              onChange={e => setPassword(e.target.value)} data-join-password
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
            <p className={`text-[11px] mt-1 ${tooShort ? 'text-red-600' : 'text-gray-400'}`}>
              At least {min} characters.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" htmlFor="join-pw2">Type it again</label>
            <input id="join-pw2" type="password" value={confirm} autoComplete="new-password"
              onChange={e => setConfirm(e.target.value)} data-join-confirm
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
            {mismatch && <p className="text-[11px] text-red-600 mt-1">The two do not match.</p>}
          </div>
          {error && <p className="text-sm text-red-700" data-join-error>{error}</p>}
          <button type="submit" disabled={!ready} data-join-submit
            className="w-full px-4 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Setting it…' : 'Set password and continue'}
          </button>
        </form>

        {/* THE SIGN-IN NAME, SAID ONCE, HERE. The link signs them in on the
            spot, so the first time they ever need it is weeks later on a
            different device — by which point there is nothing on screen that
            tells them, and it is not always what they would guess. */}
        <p className="text-[11px] text-gray-500 mt-4 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2" data-join-username>
          Next time you sign in, your name is <b className="text-gray-800">{info.username}</b> and this password.
        </p>
        <p className="text-[11px] text-gray-400 mt-2">
          This link works once. Nobody at Powder Ops can see the password you choose.
        </p>
      </div>
    </div>
  );
}
