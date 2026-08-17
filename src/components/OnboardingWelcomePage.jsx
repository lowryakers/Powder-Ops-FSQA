import { useState, useEffect } from 'react';

/**
 * The new hire's first screen — /welcome/<token>, public, phone-first.
 * A wizard that saves every step (this is filled in on a couch or a break
 * room, and losing a half-done form to a closed tab means it never gets
 * finished). Job facts render read-only; SSN and bank fields appear only when
 * the server says encrypted collection is on, and are write-only — the server
 * returns last-4 flags, never the values.
 */

const api = async (method, path, body) => {
  const res = await fetch(`/api/onboarding-portal${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
};

const input = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base';
const label = 'block text-xs font-medium text-gray-700 mb-1';

function Field({ l, children }) {
  return <div><span className={label}>{l}</span>{children}</div>;
}

const STEPS = ['welcome', 'personal', 'emergency', 'deposit', 'w4', 'done'];

export default function OnboardingWelcomePage({ token }) {
  const [rec, setRec] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    api('GET', `/${token}`).then(r => {
      setRec(r);
      setForm(Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'string')));
    }).catch(e => setFatal(e.message));
  }, [token]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const saveAnd = async (nextStep, extra = {}) => {
    setBusy(true); setError('');
    try {
      const payload = { ...form, ...extra, progress: { [STEPS[step]]: true } };
      const r = await api('PUT', `/${token}`, payload);
      setRec(r);
      // secrets are write-once-per-save: clear them from local state after
      // the server has them, so they never linger in the page
      setForm(f => ({ ...f, ssn: '', dd_routing: '', dd_account: '' }));
      setStep(nextStep);
      window.scrollTo(0, 0);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true); setError('');
    try {
      await api('PUT', `/${token}`, { ...form, progress: { w4: true } });
      await api('POST', `/${token}/finish`);
      setFinished(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (fatal) return <Shell><p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-4">{fatal}</p></Shell>;
  if (!rec) return <Shell><p className="text-sm text-gray-400 text-center py-10">Loading…</p></Shell>;
  if (finished || rec.status === 'ready') {
    return <Shell>
      <div className="text-center space-y-3 py-8">
        <div className="text-4xl">🎉</div>
        <h2 className="text-xl font-bold text-gray-900">You're all set{rec.first_name ? `, ${rec.preferred_name || rec.first_name}` : ''}.</h2>
        <p className="text-sm text-gray-600 max-w-sm mx-auto">The office has your information. On your first day you'll get your
          ReadyDoc account — Messages is where the team talks, and your tasks and training will be waiting there.</p>
      </div>
    </Shell>;
  }

  const name = STEPS[step];
  return (
    <Shell>
      {/* progress */}
      <div className="flex gap-1 mb-5">
        {STEPS.slice(0, 5).map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-powder-600' : 'bg-gray-200'}`} />
        ))}
      </div>

      {name === 'welcome' && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">Welcome to Powder Ops{form.first_name ? `, ${form.first_name}` : ''} 👋</h2>
          <p className="text-sm text-gray-700">This takes about ten minutes and saves as you go — you can come back to
            this link anytime before your first day.</p>
          <div className="bg-powder-50 border border-powder-200 rounded-xl p-4 text-sm text-gray-800 space-y-2">
            <p className="font-semibold">The plant runs on ReadyDoc — this app.</p>
            <p><b>Messages</b> is how the team talks: your channels, direct messages, and announcements, in English and
              Spanish. Your phone gets notifications the moment someone needs you.</p>
            <p><b>Your work lives here too</b> — the tasks assigned to you, the forms you'll fill in on the floor, and
              your training. Everything you'll need is one app, and you'll get your sign-in on day one.</p>
          </div>
          {rec.position && <p className="text-sm text-gray-600">Starting as <b>{rec.position}</b>{rec.start_date ? <> on <b>{rec.start_date}</b></> : ''}{rec.team ? <> · {rec.team}</> : ''}.</p>}
          <button onClick={() => saveAnd(1)} disabled={busy} className="w-full py-3 bg-powder-600 text-white rounded-xl text-base font-semibold disabled:opacity-50">Let's go</button>
        </div>
      )}

      {name === 'personal' && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">About you</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field l="First name *"><input className={input} value={form.first_name || ''} onChange={set('first_name')} /></Field>
            <Field l="Last name *"><input className={input} value={form.last_name || ''} onChange={set('last_name')} /></Field>
            <Field l="Middle name"><input className={input} value={form.middle_name || ''} onChange={set('middle_name')} /></Field>
            <Field l="Goes by"><input className={input} value={form.preferred_name || ''} onChange={set('preferred_name')} /></Field>
            <Field l="Phone *"><input type="tel" className={input} value={form.phone || ''} onChange={set('phone')} /></Field>
            <Field l="Email"><input type="email" className={input} value={form.email || ''} onChange={set('email')} /></Field>
            <Field l="Date of birth"><input type="date" className={input} value={form.dob || ''} onChange={set('dob')} /></Field>
            {rec.sensitive_collection && (
              <Field l={`Social Security number${rec.has_ssn ? ' (on file ••••)' : ''}`}>
                <input inputMode="numeric" placeholder={rec.has_ssn ? 'Saved — retype to change' : '###-##-####'}
                  className={input} value={form.ssn || ''} onChange={set('ssn')} />
              </Field>
            )}
          </div>
          <Field l="Home address *"><input className={input} value={form.address1 || ''} onChange={set('address1')} /></Field>
          <Field l="Apt / unit"><input className={input} value={form.address2 || ''} onChange={set('address2')} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field l="City *"><input className={input} value={form.city || ''} onChange={set('city')} /></Field>
            <Field l="State *"><input className={input} value={form.state || ''} onChange={set('state')} maxLength={2} placeholder="UT" /></Field>
            <Field l="ZIP *"><input inputMode="numeric" className={input} value={form.zip || ''} onChange={set('zip')} /></Field>
          </div>
          {!rec.sensitive_collection && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              The office will collect your Social Security number and banking details with you directly.
            </p>
          )}
          <Nav onBack={() => setStep(0)} onNext={() => saveAnd(2)} busy={busy} />
        </div>
      )}

      {name === 'emergency' && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Emergency contact</h2>
          <Field l="Name"><input className={input} value={form.emergency_name || ''} onChange={set('emergency_name')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field l="Phone"><input type="tel" className={input} value={form.emergency_phone || ''} onChange={set('emergency_phone')} /></Field>
            <Field l="Relationship"><input className={input} value={form.emergency_relationship || ''} onChange={set('emergency_relationship')} /></Field>
          </div>
          <Nav onBack={() => setStep(1)} onNext={() => saveAnd(3)} busy={busy} />
        </div>
      )}

      {name === 'deposit' && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Direct deposit</h2>
          {rec.sensitive_collection ? (
            <>
              <Field l="Bank name"><input className={input} value={form.dd_bank_name || ''} onChange={set('dd_bank_name')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field l={`Routing number${rec.has_bank ? ' (on file)' : ''}`}>
                  <input inputMode="numeric" className={input} value={form.dd_routing || ''} onChange={set('dd_routing')}
                    placeholder={rec.has_bank ? 'Saved — retype to change' : '9 digits'} /></Field>
                <Field l={`Account number${rec.dd_account_last4 ? ` (••••${rec.dd_account_last4})` : ''}`}>
                  <input inputMode="numeric" className={input} value={form.dd_account || ''} onChange={set('dd_account')}
                    placeholder={rec.dd_account_last4 ? 'Saved — retype to change' : ''} /></Field>
              </div>
              <Field l="Account type">
                <select className={input} value={form.dd_account_type || ''} onChange={set('dd_account_type')}>
                  <option value="">Choose…</option><option value="checking">Checking</option><option value="savings">Savings</option>
                </select>
              </Field>
            </>
          ) : (
            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl p-4">
              The office will set up your direct deposit with you directly — bring a voided check or your bank details
              on your first day.
            </p>
          )}
          <Nav onBack={() => setStep(2)} onNext={() => saveAnd(4)} busy={busy} />
        </div>
      )}

      {name === 'w4' && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Federal tax withholding (W-4)</h2>
          <p className="text-xs text-gray-500">These answers fill in your federal W-4. If you're not sure, the IRS
            estimator at irs.gov/W4App helps — you can also leave the optional lines blank.</p>
          <Field l="Filing status">
            <select className={input} value={form.w4_filing_status || ''} onChange={set('w4_filing_status')}>
              <option value="">Choose…</option>
              <option value="single">Single or married filing separately</option>
              <option value="married_jointly">Married filing jointly / qualifying surviving spouse</option>
              <option value="head_of_household">Head of household</option>
            </select>
          </Field>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={!!form.w4_multiple_jobs}
              onChange={e => setForm(f => ({ ...f, w4_multiple_jobs: e.target.checked }))} />
            <span>Step 2: I hold more than one job, or my spouse also works</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Field l="Dependents amount ($)"><input inputMode="numeric" className={input} value={form.w4_dependents_amount || ''} onChange={set('w4_dependents_amount')} /></Field>
            <Field l="Other income ($)"><input inputMode="numeric" className={input} value={form.w4_other_income || ''} onChange={set('w4_other_income')} /></Field>
            <Field l="Deductions ($)"><input inputMode="numeric" className={input} value={form.w4_deductions || ''} onChange={set('w4_deductions')} /></Field>
            <Field l="Extra withholding ($)"><input inputMode="numeric" className={input} value={form.w4_extra_withholding || ''} onChange={set('w4_extra_withholding')} /></Field>
          </div>
          <p className="text-[11px] text-gray-400">Your signed W-4 and I-9 are completed with the office — this saves
            everyone retyping the numbers.</p>
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="px-4 py-3 border border-gray-300 rounded-xl text-sm font-medium">Back</button>
            <button onClick={finish} disabled={busy} className="flex-1 py-3 bg-green-600 text-white rounded-xl text-base font-semibold disabled:opacity-50">
              {busy ? 'Sending…' : 'Finish — send to the office'}
            </button>
          </div>
        </div>
      )}

      {error && name !== 'w4' && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
    </Shell>
  );

  function Nav({ onBack, onNext, busy: b }) {
    return (
      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="px-4 py-3 border border-gray-300 rounded-xl text-sm font-medium">Back</button>
        <button onClick={onNext} disabled={b} className="flex-1 py-3 bg-powder-600 text-white rounded-xl text-base font-semibold disabled:opacity-50">
          {b ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
    );
  }
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-powder-700 text-white px-4 py-3 text-sm font-bold tracking-wide">POWDER OPS · ReadyDoc</div>
      <div className="max-w-lg mx-auto p-4 pb-16">{children}</div>
    </div>
  );
}
