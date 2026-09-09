import { useState, useEffect, useRef } from 'react';

/**
 * FORM 404-1 V2 on a signed link — /supplier-form/<token>, public, phone-first.
 *
 * The supplier's own words are the server's (`form` in the payload; the app
 * never carries a second copy of the questions). Every answer saves as it is
 * given, the "still needed" list is the server's, and submitting means typing
 * the name of the person completing the form under the signature line.
 */
const api = async (method, path, body) => {
  const res = await fetch(`/api/supplier-questionnaire${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error || 'Something went wrong.'); e.missing = j.missing; throw e; }
  return j;
};
const upload = async (path, fd) => {
  const res = await fetch(`/api/supplier-questionnaire${path}`, { method: 'POST', body: fd });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Upload failed.');
  return j;
};

const input = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base bg-white';

function Attach({ token, kind, label, files, disabled, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const mine = files.filter(f => f.kind === kind);
  const add = async (e) => {
    const picked = Array.from(e.target.files || []); e.target.value = '';
    if (!picked.length) return;
    const fd = new FormData(); fd.append('kind', kind);
    for (const f of picked) fd.append('files', f);
    setBusy(true); setErr('');
    try { onChanged(await upload(`/${token}/files`, fd)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const remove = async (f) => {
    try { const res = await fetch(`/api/supplier-questionnaire/${token}/files/${f.id}`, { method: 'DELETE' }); onChanged(await res.json()); } catch { /* shown on next load */ }
  };
  return (
    <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-2.5" data-attach={kind}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        {!disabled && (
          <label className={`text-xs font-semibold px-2.5 py-1.5 rounded-md cursor-pointer ${busy ? 'bg-gray-200 text-gray-500' : 'bg-powder-600 text-white hover:bg-powder-700'}`}>
            {busy ? 'Uploading…' : 'Attach file'}
            <input type="file" multiple accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden" onChange={add} disabled={busy} />
          </label>
        )}
      </div>
      {mine.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-gray-700">
          {mine.map(f => (
            <li key={f.id} className="flex items-center gap-2">
              <span className="truncate">{f.filename}</span>
              {!disabled && <button type="button" onClick={() => remove(f)} className="text-gray-400 hover:text-red-600">remove</button>}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

export default function SupplierQuestionnairePage({ token }) {
  const [data, setData] = useState(null);
  const [gone, setGone] = useState('');
  const [answers, setAnswers] = useState({});
  const [saveState, setSaveState] = useState('');
  const [sig, setSig] = useState({ signed_name: '', signed_title: '', attest: false });
  const [submitErr, setSubmitErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef({});
  const timer = useRef(null);

  useEffect(() => {
    api('GET', `/${token}`).then(d => { setData(d); setAnswers(d.answers || {}); }).catch(e => setGone(e.message));
  }, [token]);

  // Save what changed, a moment after it changed.
  const set = (k, v) => {
    setAnswers(a => ({ ...a, [k]: v }));
    pending.current[k] = v;
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const batch = pending.current; pending.current = {};
      try { const d = await api('PUT', `/${token}`, { answers: batch }); setData(d); setSaveState('saved'); }
      catch (e) { setSaveState('error:' + e.message); }
    }, 600);
  };

  const submit = async () => {
    setSubmitting(true); setSubmitErr('');
    try {
      clearTimeout(timer.current);
      const d = await api('POST', `/${token}/submit`, { answers: { ...pending.current }, ...sig });
      pending.current = {};
      setData(d);
      window.scrollTo({ top: 0 });
    } catch (e) { setSubmitErr(e.message); }
    finally { setSubmitting(false); }
  };

  if (gone) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-base font-semibold text-gray-900">This link is not available</p>
          <p className="mt-2 text-sm text-gray-600">{gone}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>;

  const { form } = data;
  const submitted = data.status === 'submitted';
  const missing = data.missing || [];
  const blank = new Set((missing.find(m => m.key === 'questions') || {}).keys || []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900" data-supplier-form={data.status}>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <header className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-[11px] font-mono uppercase tracking-wide text-gray-500">Powder Ops LLC · {form.code} Rev {form.revision}</p>
          <h1 className="text-xl font-bold mt-1">{form.title}</h1>
          {data.supplier_name && <p className="text-sm text-gray-600 mt-1">Prepared for <b>{data.supplier_name}</b></p>}
          <p className="text-sm text-gray-700 mt-2">{form.instruction}</p>
          {!submitted && <p className="text-xs text-gray-500 mt-2">Your answers save automatically as you go. You can close this page and come back to it with the same link.</p>}
        </header>

        {submitted && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4" data-submitted>
            <p className="text-base font-semibold text-green-900">Thank you — your questionnaire has been submitted.</p>
            <p className="text-sm text-green-800 mt-1">
              Signed by <b>{data.signature?.name}</b>{data.signature?.title ? `, ${data.signature.title}` : ''} on {String(data.submitted_at || '').slice(0, 10)}.
              A copy is filed with Powder Ops Quality. You can keep this page for your records; nothing here can be changed now.
            </p>
          </div>
        )}

        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          {form.header.filter(h => !h.auto).map(h => (
            <div key={h.key}>
              <label className="block text-xs font-medium text-gray-700 mb-1">{h.label}{h.required ? ' *' : ''}</label>
              <input className={input} value={answers[h.key] || ''} disabled={submitted}
                onChange={e => set(h.key, e.target.value)} data-header={h.key} />
            </div>
          ))}
        </section>

        <ol className="space-y-3">
          {form.questions.map((q, i) => {
            const a = answers[q.key] || '';
            return (
              <li key={q.key} className={`bg-white rounded-xl border p-4 ${blank.has(q.key) && !submitted ? 'border-amber-300' : 'border-gray-200'}`} data-question={q.key}>
                <p className="text-sm"><span className="font-mono text-xs text-gray-400 mr-2">{i + 1}</span>{q.text}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {form.answers.map(v => (
                    <button key={v} type="button" disabled={submitted} onClick={() => set(q.key, v)}
                      className={`py-2.5 rounded-lg text-sm font-semibold border ${a === v ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-700 border-gray-300 hover:border-powder-400'} disabled:opacity-70`}
                      data-answer={v} aria-pressed={a === v}>
                      {form.answer_labels[v]}
                    </button>
                  ))}
                </div>
                {q.detail && (
                  <input className={`${input} mt-2 text-sm`} placeholder={q.detail} value={answers[`${q.key}_detail`] || ''} disabled={submitted}
                    onChange={e => set(`${q.key}_detail`, e.target.value)} data-detail={q.key} />
                )}
                {q.attach && (
                  <Attach token={token} kind={q.attach} disabled={submitted || !data.storage_enabled}
                    label={(form.attachment_kinds.find(k => k.key === q.attach) || {}).label || 'Attachment'}
                    files={data.files || []} onChanged={setData} />
                )}
              </li>
            );
          })}
        </ol>

        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-semibold">Other supporting documents</p>
          <Attach token={token} kind="other" disabled={submitted || !data.storage_enabled} label="Anything else you would like to include" files={data.files || []} onChanged={setData} />
          {!data.storage_enabled && !submitted && <p className="text-xs text-amber-700 mt-2">Attachments are not available right now — please email them to jake@powder-ops.com.</p>}
        </section>

        {!submitted && (
          <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-sign>
            <p className="text-sm font-semibold">Sign and submit</p>
            {missing.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900" data-missing>
                <p className="font-semibold">Still needed before you can submit:</p>
                <ul className="list-disc ml-4 mt-1">{missing.map(m => <li key={m.key}>{m.label}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-gray-600">{form.signature.meaning}</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Questionnaire completed by (type your full name) *</label>
                <input className={input} value={sig.signed_name} onChange={e => setSig(s => ({ ...s, signed_name: e.target.value }))} data-sign-name autoComplete="name" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
                <input className={input} value={sig.signed_title} onChange={e => setSig(s => ({ ...s, signed_title: e.target.value }))} data-sign-title autoComplete="organization-title" />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-800">
              <input type="checkbox" className="mt-1" checked={sig.attest} onChange={e => setSig(s => ({ ...s, attest: e.target.checked }))} data-sign-attest />
              <span>I am the person named above and I am signing this questionnaire.</span>
            </label>
            {submitErr && <p className="text-sm text-red-600" data-submit-error>{submitErr}</p>}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] text-gray-400">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All answers saved' : saveState.startsWith('error:') ? saveState.slice(6) : ''}</span>
              <button type="button" onClick={submit} disabled={submitting || missing.length > 0}
                className="px-5 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50" data-submit>
                {submitting ? 'Submitting…' : 'Sign & submit'}
              </button>
            </div>
          </section>
        )}
        <p className="text-center text-[11px] text-gray-400 pb-6">{form.footer}</p>
      </div>
    </div>
  );
}
