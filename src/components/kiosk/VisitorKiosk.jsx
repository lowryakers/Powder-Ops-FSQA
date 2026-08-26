import { useState, useEffect, useRef, useCallback } from 'react';
import { SignaturePad } from '../common/SignatureCanvas.jsx';
import { ArrowLeft, RotateCcw, Check, LogIn, LogOut, AlertTriangle } from 'lucide-react';
import { kioskHeaders } from '../../lib/kioskToken.js';

// The lobby tablet. Replaces Lobby Track.
//
// This screen is left open on a stand in the front lobby all day, so it is
// built for that and not for a phone browser: big targets, no ReadyDoc chrome,
// nothing to sign in to, and it always returns to the logo by itself. A visitor
// should be able to walk up, tap once, and be led through.
//
// IT RETURNS HOME ON ITS OWN. A kiosk left showing the last person's name and
// email is a privacy problem, not an inconvenience — the next visitor walks up
// to somebody else's details. Every terminal screen bounces back to the logo
// after a few seconds, and any half-finished form is abandoned after a minute
// of no input.

// IT FOLLOWS THE STAND, THE STAND DOES NOT FOLLOW IT.
//
// The lobby tablet sits in a landscape cradle, and every screen here was built
// as a tall column. Two separate things made that a portrait app:
//   * the web manifest declared `orientation: portrait-primary`, so an
//     installed tablet was LOCKED upright however it was physically mounted.
//     That is now `any` — the page follows the device, which is also what
//     someone turning a phone sideways to read a wide table wanted all along.
//   * the layouts themselves. Below, `landscape:` reclaims vertical space
//     everywhere, and `lg:landscape:` splits the tall screens into two columns
//     once there is genuinely width for it (a tablet in a cradle, ~1024px+ —
//     not a phone turned sideways, which is landscape but still narrow).
// Nothing is hard-coded to landscape: a tablet re-mounted upright, and the
// same URL opened on a phone, both still work.

const IDLE_ABANDON_MS = 60_000;   // half-finished form, nobody there
const DONE_RETURN_MS = 6_000;     // after a successful sign-in / sign-out

// 100dvh, not 100vh: on a tablet browser the collapsing address bar makes vh
// taller than what you can actually see, which pushes the button under it.
const FULL = 'min-h-[100dvh]';

const api = async (path, opts = {}) => {
  const res = await fetch(`/api/visitor-kiosk${path}`, {
    ...opts,
    // The poster's key rides on every kiosk request. Empty while enforcement
    // is off, which is why this is safe to ship before any key is issued.
    headers: { 'Content-Type': 'application/json', ...kioskHeaders('visitor'), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please ask at the front desk.');
  return data;
};

function Shell({ children, onBack, onStartOver }) {
  return (
    <div className={`${FULL} bg-white flex flex-col`}>
      {(onBack || onStartOver) && (
        <div className="flex items-center justify-between px-4 py-2 sm:py-3 border-b border-gray-100">
          {onBack
            ? <button onClick={onBack} className="h-11 w-11 rounded-full bg-gray-100 flex items-center justify-center text-gray-600" aria-label="Back">
              <ArrowLeft size={22} />
            </button>
            : <span />}
          {onStartOver && (
            <button onClick={onStartOver} className="px-4 py-2 rounded-full text-powder-600 font-semibold text-lg">
              Start Over
            </button>
          )}
        </div>
      )}
      <div className="flex-1 flex flex-col px-5 sm:px-8 py-6 landscape:py-4 max-w-2xl lg:landscape:max-w-6xl w-full mx-auto">
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block mb-6">
      <span className="block text-xl font-bold text-gray-900">
        {label}{required && <span className="text-orange-500 ml-1">*</span>}
      </span>
      {hint && <span className="block text-base text-gray-500 mt-0.5">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}

const INPUT = 'w-full px-4 py-4 border border-gray-300 rounded-xl text-xl';

// ── Reading and signing an agreement ────────────────────────────────────────
//
// The whole text is shown and must be SCROLLED TO THE END before the pad
// unlocks. Not friction for its own sake: an NDA is a contract, and a signature
// captured on a screen the person never scrolled is one they can reasonably say
// they were never shown. The tablet cannot make them read it — it can refuse to
// pretend they had no opportunity.
function AgreementStep({ agreement, defaultName, onSigned, onBack, onStartOver }) {
  const [name, setName] = useState(defaultName || '');
  const [image, setImage] = useState(null);
  const [read, setRead] = useState(false);
  const boxRef = useRef(null);

  const check = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setRead(true);
  }, []);

  // A short agreement on a tall screen never scrolls, so it is read on arrival.
  useEffect(() => { check(); }, [check, agreement]);

  return (
    <Shell onBack={onBack} onStartOver={onStartOver}>
      <h1 className="text-4xl landscape:text-3xl lg:landscape:text-4xl font-extrabold text-powder-800">{agreement.title}</h1>
      <p className="text-lg text-gray-500 mt-1">
        Please read and sign. Revision {agreement.revision}.
      </p>

      {/* The two halves sit SIDE BY SIDE on a landscape tablet, which is the
          screen this most needed: stacked, the text box and the signature pad
          fight over the same short height, so the pad is off-screen while you
          are reading and the text is off-screen while you are signing. */}
      <div className="flex-1 flex flex-col lg:landscape:flex-row lg:landscape:gap-8 lg:landscape:items-start min-h-0">
        <div className="flex flex-col min-h-0 lg:landscape:flex-1 lg:landscape:w-1/2">
          <div ref={boxRef} onScroll={check}
            className="mt-4 flex-1 min-h-[14rem] max-h-[42vh] landscape:max-h-[34vh] lg:landscape:max-h-[58vh] lg:landscape:min-h-[58vh] overflow-y-auto border border-gray-200 rounded-xl p-4 bg-gray-50">
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-gray-800">{agreement.body}</p>
          </div>
          {!read && (
            <p className="text-sm text-gray-500 mt-2 text-center">Scroll to the end to continue.</p>
          )}
        </div>

        <div className={`lg:landscape:flex-1 lg:landscape:w-1/2 lg:landscape:mt-4 ${read ? 'mt-5' : 'mt-5 opacity-40 pointer-events-none'}`}>
          <Field label="Your full name" required>
            <input value={name} onChange={e => setName(e.target.value)} className={INPUT}
              autoComplete="off" autoCapitalize="words" />
          </Field>
          <span className="block text-xl font-bold text-gray-900 mb-2">Sign below <span className="text-orange-500">*</span></span>
          {image ? (
            <div className="border border-gray-300 rounded-xl p-3 bg-white">
              <img src={image} alt="Your signature" className="h-28 mx-auto" />
              <button type="button" onClick={() => setImage(null)}
                className="mt-2 mx-auto flex items-center gap-1.5 text-base text-gray-500">
                <RotateCcw size={16} /> Sign again
              </button>
            </div>
          ) : (
            <SignaturePad onSave={(img) => setImage(img)} onCancel={() => setImage(null)} />
          )}
        </div>
      </div>

      <button type="button" disabled={!read || !name.trim() || !image}
        onClick={() => onSigned({ agreement_id: agreement.id, signed_name: name.trim(), signature_image: image })}
        className="mt-6 landscape:mt-4 w-full py-5 landscape:py-4 rounded-2xl bg-powder-600 text-white text-2xl font-bold disabled:opacity-40">
        Agree &amp; continue
      </button>
    </Shell>
  );
}

export default function VisitorKiosk() {
  const [config, setConfig] = useState(null);
  const [screen, setScreen] = useState('home');   // home | visitor | agreement | done | out | outDone
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', company: '', custom_data: {} });
  const [signatures, setSignatures] = useState([]);
  const [agreementIdx, setAgreementIdx] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [outQuery, setOutQuery] = useState('');
  const [outMatches, setOutMatches] = useState([]);
  const [doneName, setDoneName] = useState('');

  const reset = useCallback(() => {
    setForm({ first_name: '', last_name: '', email: '', company: '', custom_data: {} });
    setSignatures([]); setAgreementIdx(0); setError(''); setOutQuery(''); setOutMatches([]);
    setScreen('home');
  }, []);

  useEffect(() => {
    api('/config').then(setConfig).catch(() => setConfig({ agreements: [], fields: [] }));
  }, []);

  // Never leave somebody's details on the screen. A finished screen bounces
  // home; a half-filled form is abandoned after a minute of no input.
  useEffect(() => {
    if (screen === 'home') return undefined;
    const ms = (screen === 'done' || screen === 'outDone') ? DONE_RETURN_MS : IDLE_ABANDON_MS;
    const t = setTimeout(reset, ms);
    const bump = () => { clearTimeout(t); };
    if (screen !== 'done' && screen !== 'outDone') {
      window.addEventListener('pointerdown', bump, { once: true });
      window.addEventListener('keydown', bump, { once: true });
    }
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [screen, reset, form, signatures, outQuery]);

  const agreements = config?.agreements || [];

  const submit = useCallback(async (allSignatures) => {
    setBusy(true); setError('');
    try {
      const r = await api('/sign-in', {
        method: 'POST',
        body: JSON.stringify({ ...form, signatures: allSignatures, location: config?.location_default }),
      });
      setDoneName(r.name);
      setScreen('done');
    } catch (e) { setError(e.message); setScreen('visitor'); } finally { setBusy(false); }
  }, [form, config]);

  // ── Sign-out lookup ──
  useEffect(() => {
    if (screen !== 'out' || outQuery.trim().length < 2) { setOutMatches([]); return undefined; }
    const t = setTimeout(() => {
      api(`/open?q=${encodeURIComponent(outQuery.trim())}`).then(setOutMatches).catch(() => setOutMatches([]));
    }, 250);
    return () => clearTimeout(t);
  }, [outQuery, screen]);

  const signOut = async (visit) => {
    setBusy(true); setError('');
    try {
      const r = await api('/sign-out', { method: 'POST', body: JSON.stringify({ visit_id: visit.id }) });
      setDoneName(r.name || visit.name);
      setScreen('outDone');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // ── Screens ──

  if (screen === 'home') {
    return (
      <div className={`${FULL} bg-white flex flex-col landscape:flex-row items-center justify-center gap-4 landscape:gap-10 px-6 py-8 landscape:py-6`}>
        <div className="flex-1 flex items-center justify-center min-h-0 w-full">
          {/* The real mark, the same bytes the COA prints — see the note in
              LoginScreen. A visitor's first sight of the company should not be
              a redrawing of its logo.
              max-h + object-contain because this is a tall portrait mark: at a
              fixed width it stands 320px high, which overflows a phone turned
              sideways and pushes SIGN IN off the bottom. */}
          <img src="/brand/logo.jpg" alt="Powder Ops"
            className="w-56 sm:w-64 lg:landscape:w-[22rem] max-h-[42vh] landscape:max-h-[70vh] object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <div className="w-full max-w-md landscape:flex-1 landscape:max-w-sm pb-10 landscape:pb-0">
          <button onClick={() => setScreen('visitor')}
            className="w-full py-6 landscape:py-5 rounded-2xl bg-powder-500 text-white text-3xl font-bold shadow-sm flex items-center justify-center gap-3">
            <LogIn size={30} /> SIGN IN
          </button>
          <button onClick={() => setScreen('out')}
            className="mt-6 landscape:mt-4 w-full py-4 text-2xl text-gray-500 font-medium flex items-center justify-center gap-3">
            <LogOut size={24} /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'visitor') {
    const ready = form.first_name.trim() && form.last_name.trim() && form.email.trim();
    return (
      <Shell onBack={reset} onStartOver={reset}>
        <h1 className="text-4xl landscape:text-3xl lg:landscape:text-4xl font-extrabold text-powder-800">Visitor</h1>
        <p className="text-lg text-gray-500 mt-1 mb-6 landscape:mb-4">
          Please complete the form. You will be asked to sign our {agreements[0]?.title || 'agreement'}.
        </p>
        {error && (
          <p className="mb-4 flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 text-base">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />{error}
          </p>
        )}
        {/* Two columns on a landscape tablet. The keyboard takes most of a
            landscape screen's height, so a single column of six fields means
            scrolling a form while typing into it. */}
        <div className="lg:landscape:grid lg:landscape:grid-cols-2 lg:landscape:gap-x-10">
        <Field label="First Name" required>
          <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
            className={INPUT} autoCapitalize="words" autoComplete="off" />
        </Field>
        <Field label="Last Name" hint="Surname / Family Name" required>
          <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
            className={INPUT} autoCapitalize="words" autoComplete="off" />
        </Field>
        <Field label="Email" required>
          <input type="email" inputMode="email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className={INPUT} autoCapitalize="off" autoComplete="off" />
        </Field>
        <Field label="Company" hint="Optional">
          <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
            className={INPUT} autoCapitalize="words" autoComplete="off" />
        </Field>

        {/* Extra questions the plant added in Settings — no deploy needed. */}
        {(config?.fields || []).map(f => (
          <Field key={f.key} label={f.label} hint={f.help_text} required={!!f.required}>
            {f.field_type === 'select' ? (
              <select className={INPUT} value={form.custom_data[f.key] || ''}
                onChange={e => setForm(s => ({ ...s, custom_data: { ...s.custom_data, [f.key]: e.target.value } }))}>
                <option value="">—</option>
                {(f.options || []).map(o => <option key={o.value || o} value={o.value || o}>{o.label || o.value || o}</option>)}
              </select>
            ) : f.field_type === 'checkbox' ? (
              <input type="checkbox" className="h-7 w-7" checked={!!form.custom_data[f.key]}
                onChange={e => setForm(s => ({ ...s, custom_data: { ...s.custom_data, [f.key]: e.target.checked } }))} />
            ) : (
              <input className={INPUT} type={f.field_type === 'number' ? 'number' : 'text'}
                value={form.custom_data[f.key] || ''}
                onChange={e => setForm(s => ({ ...s, custom_data: { ...s.custom_data, [f.key]: e.target.value } }))} />
            )}
          </Field>
        ))}
        </div>

        <button type="button" disabled={!ready || busy}
          onClick={() => { setError(''); setAgreementIdx(0); setScreen(agreements.length ? 'agreement' : 'submitting'); if (!agreements.length) submit([]); }}
          className="mt-2 w-full py-5 landscape:py-4 rounded-2xl bg-powder-500 text-white text-2xl font-bold disabled:opacity-40">
          {busy ? 'Please wait…' : 'NEXT'}
        </button>
      </Shell>
    );
  }

  if (screen === 'agreement' && agreements[agreementIdx]) {
    const a = agreements[agreementIdx];
    return (
      <AgreementStep
        key={a.id}
        agreement={a}
        defaultName={`${form.first_name} ${form.last_name}`.trim()}
        onBack={() => (agreementIdx === 0 ? setScreen('visitor') : setAgreementIdx(i => i - 1))}
        onStartOver={reset}
        onSigned={(sig) => {
          const next = [...signatures.filter(s => s.agreement_id !== sig.agreement_id), sig];
          setSignatures(next);
          if (agreementIdx + 1 < agreements.length) setAgreementIdx(i => i + 1);
          else submit(next);
        }}
      />
    );
  }

  if (screen === 'done') {
    return (
      <div className={`${FULL} bg-white flex flex-col items-center justify-center px-6 py-8 text-center`}>
        <div className="h-24 w-24 rounded-full bg-green-100 flex items-center justify-center mb-6">
          <Check size={52} className="text-green-600" />
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900">Thank you, {doneName.split(' ')[0]}</h1>
        <p className="text-xl text-gray-500 mt-3">You&apos;re signed in. Someone will be with you shortly.</p>
        <p className="text-base text-gray-400 mt-6">Please sign out on this tablet when you leave.</p>
        <button onClick={reset} className="mt-8 px-6 py-3 text-lg text-powder-600 font-semibold">Done</button>
      </div>
    );
  }

  if (screen === 'out') {
    return (
      <Shell onBack={reset} onStartOver={reset}>
        <h1 className="text-4xl font-extrabold text-powder-800">Sign Out</h1>
        <p className="text-lg text-gray-500 mt-1 mb-6">Look up your visit by entering your name.</p>
        {error && <p className="mb-4 text-red-700 text-base">{error}</p>}
        <Field label="Enter your name">
          <input value={outQuery} onChange={e => setOutQuery(e.target.value)} className={INPUT}
            autoCapitalize="words" autoComplete="off" autoFocus />
        </Field>
        <div className="space-y-3">
          {outMatches.map(v => (
            <button key={v.id} onClick={() => signOut(v)} disabled={busy}
              className="w-full text-left px-4 py-4 border border-gray-300 rounded-xl hover:bg-gray-50 disabled:opacity-50">
              <span className="block text-xl font-semibold text-gray-900">{v.name}</span>
              <span className="block text-base text-gray-500">
                Signed in {new Date(String(v.signed_in_at).replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            </button>
          ))}
          {outQuery.trim().length >= 2 && !outMatches.length && (
            <p className="text-base text-gray-500">
              No open visit under that name. If you signed in more than {config?.auto_signout_minutes || 90} minutes
              ago you may already have been signed out — you can leave.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  if (screen === 'outDone') {
    return (
      <div className={`${FULL} bg-white flex flex-col items-center justify-center px-6 py-8 text-center`}>
        <div className="h-24 w-24 rounded-full bg-green-100 flex items-center justify-center mb-6">
          <Check size={52} className="text-green-600" />
        </div>
        <h1 className="text-4xl font-extrabold text-gray-900">Thanks for visiting</h1>
        <p className="text-xl text-gray-500 mt-3">You&apos;re signed out. Safe travels.</p>
        <button onClick={reset} className="mt-8 px-6 py-3 text-lg text-powder-600 font-semibold">Done</button>
      </div>
    );
  }

  return (
    <div className={`${FULL} bg-white flex items-center justify-center`}>
      <p className="text-xl text-gray-400">Please wait…</p>
    </div>
  );
}
