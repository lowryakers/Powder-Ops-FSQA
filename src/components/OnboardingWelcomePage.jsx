import { useState, useEffect } from 'react';
import PhotoPicker from './common/PhotoPicker.jsx';

/**
 * The new hire's first screen — /welcome/<token>, public, phone-first.
 * A wizard that saves every step (this is filled in on a couch or a break
 * room, and losing a half-done form to a closed tab means it never gets
 * finished). Job facts render read-only; SSN and bank fields appear only when
 * the server says encrypted collection is on, and are write-only — the server
 * returns last-4 flags, never the values.
 *
 * Seven steps: welcome · about you · emergency contact · how you're paid ·
 * W-4 · I-9 · done. The W-4 and I-9 each end in a signature — the person
 * types their legal name under the form's own statement — and the server
 * refuses to finish while anything either form requires is blank. That list
 * comes from the server (`missing`), so this page never has its own idea of
 * what is required.
 */

const api = async (method, path, body) => {
  const res = await fetch(`/api/onboarding-portal${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || 'Something went wrong.'); e.missing = j.missing; throw e; }
  return j;
};
const upload = async (path, fd) => {
  const res = await fetch(`/api/onboarding-portal${path}`, { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Upload failed.');
  return j;
};

const input = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base';
const label = 'block text-xs font-medium text-gray-700 mb-1';

function Field({ l, children, hint }) {
  return <div><span className={label}>{l}</span>{children}{hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}</div>;
}

const STEPS = ['welcome', 'personal', 'emergency', 'deposit', 'w4', 'i9', 'done'];

/** Photos of a kind, with the phone camera one tap away. */
function Photos({ token, rec, kind, title, hint, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const files = (rec.files || []).filter(f => f.kind === kind);
  const add = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const fd = new FormData();
    fd.append('kind', kind);
    for (const f of picked) fd.append('files', f);
    setBusy(true); setError('');
    try { onChanged(await upload(`/${token}/files`, fd)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const remove = async (f) => {
    try {
      const res = await fetch(`/api/onboarding-portal/${token}/files/${f.id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not remove.');
      onChanged(j);
    } catch (err) { setError(err.message); }
  };
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2" data-photos={kind}>
      <p className="text-sm font-semibold text-gray-800">{title}</p>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map(f => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
              <span className="truncate">📷 {f.filename}</span>
              {f.uploaded_by === 'new hire' && (
                <button type="button" onClick={() => remove(f)} className="text-gray-400 hover:text-red-600 shrink-0">Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rec.storage_enabled ? (
        <PhotoPicker name={kind} onChange={add} busy={busy} accept="image/*,application/pdf"
          takeLabel={files.length ? 'Take another photo' : 'Take a photo'} chooseLabel="Choose from photos" />
      ) : (
        <p className="text-xs text-amber-800">Photo upload is not available right now — bring the documents on your first day.</p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** The signature block every form ends in. */
function Signature({ rec, which, attestation, value, onChange, attest, onAttest }) {
  const signed = rec[`${which}_signature`];
  const legal = [rec.first_name, rec.last_name].filter(Boolean).join(' ');
  if (signed) {
    return (
      <div className="bg-green-50 border border-green-300 rounded-xl p-3 text-sm text-green-900" data-signed={which}>
        ✓ Signed <b>{signed.name}</b> on {new Date(signed.at).toLocaleString()}. To change anything above, edit it and sign again.
      </div>
    );
  }
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2" data-signature={which}>
      <p className="text-[11px] text-gray-600 leading-snug">{attestation}</p>
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="mt-1" checked={!!attest} onChange={e => onAttest(e.target.checked)} />
        <span>I have read the statement above and it is true.</span>
      </label>
      <Field l={`Sign by typing your full legal name${legal ? ` (${legal})` : ''}`}>
        <input className={input} value={value || ''} onChange={e => onChange(e.target.value)} autoComplete="off" placeholder={legal} />
      </Field>
    </div>
  );
}

export default function OnboardingWelcomePage({ token }) {
  const [rec, setRec] = useState(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({});
  const [sig, setSig] = useState({ w4: '', i9: '', w4_attest: false, i9_attest: false });
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(null);
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    api('GET', `/${token}`).then(r => {
      setRec(r);
      setForm(Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'string' || typeof v === 'boolean')));
    }).catch(e => setFatal(e.message));
  }, [token]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const adopt = (r) => {
    setRec(r);
    // secrets are write-once-per-save: clear them from local state after
    // the server has them, so they never linger in the page
    setForm(f => ({ ...f, ssn: '', dd_routing: '', dd_account: '' }));
  };

  const saveAnd = async (nextStep, extra = {}) => {
    setBusy(true); setError('');
    try {
      const payload = { ...form, ...extra, progress: { [STEPS[step]]: true } };
      adopt(await api('PUT', `/${token}`, payload));
      setStep(nextStep);
      window.scrollTo(0, 0);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  // Sign the current form, then move on — one request, checked on the server
  // against the record after the fields landed.
  const signAnd = async (which, nextStep) => {
    const extra = rec[`${which}_signature`] ? {} : { [`${which}_sign`]: true, signed_name: sig[which], attest: sig[`${which}_attest`] };
    await saveAnd(nextStep, extra);
  };

  const finish = async () => {
    setBusy(true); setError(''); setMissing(null);
    try {
      await api('POST', `/${token}/finish`);
      setFinished(true);
    } catch (e) {
      setError(e.message);
      if (e.missing) setMissing(e.missing);
    } finally { setBusy(false); }
  };

  if (fatal) return <Shell><p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-4">{fatal}</p></Shell>;
  if (!rec) return <Shell><p className="text-sm text-gray-400 text-center py-10">Loading…</p></Shell>;
  if (finished || rec.status === 'ready') {
    return <Shell>
      <div className="text-center space-y-3 py-8">
        <div className="text-4xl">🎉</div>
        <h2 className="text-xl font-bold text-gray-900">You're all set{rec.first_name ? `, ${rec.preferred_name || rec.first_name}` : ''}.</h2>
        <p className="text-sm text-gray-600 max-w-sm mx-auto">The office has your information and your signed forms. Bring the original ID documents you photographed on your first day — the office has to see them in person. You'll get your ReadyDoc account then; Messages is where the team talks, and your tasks and training will be waiting there.</p>
      </div>
    </Shell>;
  }

  const name = STEPS[step];
  const stepMissing = (s) => (rec.missing || []).filter(m => m.step === s);
  const goTo = (s) => { setStep(STEPS.indexOf(s)); window.scrollTo(0, 0); };

  return (
    <Shell>
      {/* progress */}
      <div className="flex gap-1 mb-5">
        {STEPS.slice(0, 6).map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-powder-600' : 'bg-gray-200'}`} />
        ))}
      </div>

      {name === 'welcome' && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">Welcome to Powder Ops{form.first_name ? `, ${form.first_name}` : ''} 👋</h2>
          <p className="text-sm text-gray-700">This takes about fifteen minutes and saves as you go — you can come back to
            this link anytime before your first day. Have your Social Security number, your bank details or a check, and
            your ID documents (passport, or driver's license plus Social Security card) to hand.</p>
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
            <Field l="Date of birth *"><input type="date" className={input} value={form.dob || ''} onChange={set('dob')} /></Field>
            {rec.sensitive_collection && (
              <Field l={`Social Security number *${rec.has_ssn ? ' (on file ••••)' : ''}`}>
                <input inputMode="numeric" placeholder={rec.has_ssn ? 'Saved — retype to change' : '###-##-####'}
                  className={input} value={form.ssn || ''} onChange={set('ssn')} autoComplete="off" data-ssn />
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
          <h2 className="text-lg font-bold text-gray-900">How you'll be paid</h2>
          <div className="grid grid-cols-2 gap-2">
            {[['direct_deposit', 'Direct deposit', 'Straight into your bank account'], ['check', 'Paper check', 'Handed to you on payday']].map(([v, l, h]) => (
              <button key={v} type="button" onClick={() => setForm(f => ({ ...f, pay_method: v }))} aria-pressed={form.pay_method === v}
                className={`text-left rounded-xl border p-3 ${form.pay_method === v ? 'border-powder-600 bg-powder-50' : 'border-gray-300 bg-white'}`}>
                <span className="block text-sm font-semibold text-gray-900">{l}</span>
                <span className="block text-xs text-gray-500">{h}</span>
              </button>
            ))}
          </div>
          {form.pay_method === 'direct_deposit' && (
            rec.sensitive_collection ? (
              <>
                <Field l="Bank name"><input className={input} value={form.dd_bank_name || ''} onChange={set('dd_bank_name')} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field l={`Routing number *${rec.has_bank ? ' (on file)' : ''}`}>
                    <input inputMode="numeric" className={input} value={form.dd_routing || ''} onChange={set('dd_routing')} autoComplete="off"
                      placeholder={rec.has_bank ? 'Saved — retype to change' : '9 digits'} /></Field>
                  <Field l={`Account number *${rec.dd_account_last4 ? ` (••••${rec.dd_account_last4})` : ''}`}>
                    <input inputMode="numeric" className={input} value={form.dd_account || ''} onChange={set('dd_account')} autoComplete="off"
                      placeholder={rec.dd_account_last4 ? 'Saved — retype to change' : ''} /></Field>
                </div>
                <Field l="Account type *">
                  <select className={input} value={form.dd_account_type || ''} onChange={set('dd_account_type')}>
                    <option value="">Choose…</option><option value="checking">Checking</option><option value="savings">Savings</option>
                  </select>
                </Field>
                <Photos token={token} rec={rec} kind="voided_check" title="A photo of a voided check (recommended)"
                  hint="The office checks the numbers above against it. Write VOID across a blank check and photograph the front." onChanged={adopt} />
              </>
            ) : (
              <Photos token={token} rec={rec} kind="voided_check" title="A photo of a voided check *"
                hint="Your bank details are not typed in here. The office sets up your direct deposit from the check: write VOID across a blank check and photograph the front." onChanged={adopt} />
            )
          )}
          <Nav onBack={() => setStep(2)} onNext={() => saveAnd(4)} busy={busy} />
        </div>
      )}

      {name === 'w4' && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Form W-4 — federal tax withholding</h2>
          <p className="text-xs text-gray-500">The same steps as the paper W-4. If you're not sure, the IRS estimator at
            irs.gov/W4App works it out; the optional lines can stay blank.</p>
          <Field l="Step 1(c) Filing status *">
            <select className={input} value={form.w4_filing_status || ''} onChange={set('w4_filing_status')}>
              <option value="">Choose…</option>
              <option value="single">Single or married filing separately</option>
              <option value="married_jointly">Married filing jointly / qualifying surviving spouse</option>
              <option value="head_of_household">Head of household</option>
            </select>
          </Field>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={!!form.w4_multiple_jobs} onChange={set('w4_multiple_jobs')} />
            <span><b>Step 2</b> — I hold more than one job at the same time, or I'm married filing jointly and my spouse also works</span>
          </label>
          <p className="text-xs font-semibold text-gray-700 pt-1">Step 3 — Dependents (only if your income is under $200,000, or $400,000 filing jointly)</p>
          <div className="grid grid-cols-2 gap-3">
            <Field l="Qualifying children under 17" hint="× $2,000 each"><input inputMode="numeric" className={input} value={form.w4_qualifying_children || ''} onChange={set('w4_qualifying_children')} /></Field>
            <Field l="Other dependents" hint="× $500 each"><input inputMode="numeric" className={input} value={form.w4_other_dependents || ''} onChange={set('w4_other_dependents')} /></Field>
          </div>
          <Field l="Total dependents amount ($)" hint="Children × 2,000 + others × 500, plus any other credits">
            <input inputMode="numeric" className={input} value={form.w4_dependents_amount || ''} onChange={set('w4_dependents_amount')} /></Field>
          <p className="text-xs font-semibold text-gray-700 pt-1">Step 4 — Other adjustments (optional)</p>
          <div className="grid grid-cols-3 gap-3">
            <Field l="(a) Other income ($)"><input inputMode="numeric" className={input} value={form.w4_other_income || ''} onChange={set('w4_other_income')} /></Field>
            <Field l="(b) Deductions ($)"><input inputMode="numeric" className={input} value={form.w4_deductions || ''} onChange={set('w4_deductions')} /></Field>
            <Field l="(c) Extra withholding ($)"><input inputMode="numeric" className={input} value={form.w4_extra_withholding || ''} onChange={set('w4_extra_withholding')} /></Field>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={!!form.w4_exempt} onChange={set('w4_exempt')} />
            <span>I claim <b>exemption</b> from withholding (I owed no federal income tax last year and expect none this year)</span>
          </label>
          <p className="text-xs font-semibold text-gray-700 pt-1">Step 5 — Sign here</p>
          <Signature rec={rec} which="w4" attestation={rec.attestations?.w4} value={sig.w4} onChange={v => setSig(s => ({ ...s, w4: v }))}
            attest={sig.w4_attest} onAttest={v => setSig(s => ({ ...s, w4_attest: v }))} />
          <Nav onBack={() => setStep(3)} onNext={() => signAnd('w4', 5)} busy={busy} label={rec.w4_signature ? 'Save & continue' : 'Sign & continue'} />
        </div>
      )}

      {name === 'i9' && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-gray-900">Form I-9 — Section 1, employment eligibility</h2>
          <p className="text-xs text-gray-500">Your name, address and date of birth from the first page go on this form. Below is the rest of Section 1.</p>
          <Field l="Other last names used (if any)"><input className={input} value={form.i9_other_last_names || ''} onChange={set('i9_other_last_names')} /></Field>
          <Field l="I attest, under penalty of perjury, that I am *">
            <div className="space-y-1.5">
              {[['citizen', 'A citizen of the United States'], ['noncitizen_national', 'A noncitizen national of the United States'],
                ['permanent_resident', 'A lawful permanent resident'], ['authorized_alien', 'A noncitizen (other than the above) authorized to work']].map(([v, l]) => (
                <label key={v} className={`flex items-start gap-2 rounded-xl border p-2.5 text-sm ${form.i9_citizenship === v ? 'border-powder-600 bg-powder-50' : 'border-gray-300 bg-white'}`}>
                  <input type="radio" name="i9_citizenship" className="mt-1" checked={form.i9_citizenship === v} onChange={() => setForm(f => ({ ...f, i9_citizenship: v }))} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </Field>
          {form.i9_citizenship === 'permanent_resident' && (
            <Field l="USCIS A-Number *"><input className={input} value={form.i9_uscis_number || ''} onChange={set('i9_uscis_number')} placeholder="A-123456789" /></Field>
          )}
          {form.i9_citizenship === 'authorized_alien' && (
            <>
              <Field l="Authorized to work until *" hint="The expiration date on your work authorization, or N/A">
                <input className={input} value={form.i9_work_until || ''} onChange={set('i9_work_until')} placeholder="YYYY-MM-DD or N/A" /></Field>
              <p className="text-xs text-gray-600">Provide <b>one</b> of these three:</p>
              <Field l="USCIS A-Number"><input className={input} value={form.i9_uscis_number || ''} onChange={set('i9_uscis_number')} /></Field>
              <Field l="Form I-94 admission number"><input className={input} value={form.i9_i94_number || ''} onChange={set('i9_i94_number')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field l="Foreign passport number"><input className={input} value={form.i9_passport_number || ''} onChange={set('i9_passport_number')} /></Field>
                <Field l="Country of issuance"><input className={input} value={form.i9_passport_country || ''} onChange={set('i9_passport_country')} /></Field>
              </div>
            </>
          )}
          <Field l="Did anyone help you fill in this form (a preparer or translator)?">
            <select className={input} value={form.i9_preparer || 'none'} onChange={set('i9_preparer')}>
              <option value="none">No — I completed it myself</option>
              <option value="used">Yes — a preparer or translator helped me</option>
            </select>
          </Field>
          {form.i9_preparer === 'used' && (
            <Field l="Preparer / translator's full name *"><input className={input} value={form.i9_preparer_name || ''} onChange={set('i9_preparer_name')} /></Field>
          )}
          <Photos token={token} rec={rec} kind="id_document" title="Photos of your ID documents"
            hint="Either one List A document (a U.S. passport, or a permanent resident card), or one List B plus one List C (a driver's license plus your Social Security card or birth certificate). Photograph the front and back. Bring the originals on your first day — the office has to see them in person." onChanged={adopt} />
          <Signature rec={rec} which="i9" attestation={rec.attestations?.i9_s1} value={sig.i9} onChange={v => setSig(s => ({ ...s, i9: v }))}
            attest={sig.i9_attest} onAttest={v => setSig(s => ({ ...s, i9_attest: v }))} />
          {missing && missing.length > 0 && (
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1" data-missing>
              <p className="font-semibold">A few things are still needed:</p>
              <ul className="list-disc pl-5">
                {missing.map(m => (
                  <li key={`${m.step}-${m.field}`}>
                    {m.label}{m.step !== 'i9' && <> — <button type="button" className="underline" onClick={() => goTo(m.step)}>go back to that page</button></>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep(4)} className="px-4 py-3 border border-gray-300 rounded-xl text-sm font-medium">Back</button>
            {rec.i9_signature ? (
              <button onClick={finish} disabled={busy} className="flex-1 py-3 bg-green-600 text-white rounded-xl text-base font-semibold disabled:opacity-50" data-finish>
                {busy ? 'Sending…' : 'Finish — send to the office'}
              </button>
            ) : (
              <button onClick={() => signAnd('i9', 5)} disabled={busy} className="flex-1 py-3 bg-powder-600 text-white rounded-xl text-base font-semibold disabled:opacity-50" data-sign-i9>
                {busy ? 'Saving…' : 'Sign the I-9'}
              </button>
            )}
          </div>
          {stepMissing('i9').length > 0 && !rec.i9_signature && (
            <p className="text-[11px] text-gray-400">Sign first; the Finish button appears once the I-9 is signed.</p>
          )}
        </div>
      )}

      {error && name !== 'i9' && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
    </Shell>
  );

  function Nav({ onBack, onNext, busy: b, label: l }) {
    return (
      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="px-4 py-3 border border-gray-300 rounded-xl text-sm font-medium">Back</button>
        <button onClick={onNext} disabled={b} className="flex-1 py-3 bg-powder-600 text-white rounded-xl text-base font-semibold disabled:opacity-50">
          {b ? 'Saving…' : (l || 'Save & continue')}
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
