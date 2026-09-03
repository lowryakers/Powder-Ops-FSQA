import { useState } from 'react';
import { useApiGet, apiPost, apiFetch, apiUpload } from '../../hooks/useApi';
import {
  UserPlus, Link2, Copy, CheckCircle2, XCircle, Send, RefreshCw, FileText, Paperclip, Download, ShieldCheck, AlertTriangle, X,
} from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';
import { withSignature } from '../../lib/signature.js';
import { downloadFile } from '../../lib/downloadFile.js';

/**
 * Office side of new-hire onboarding: start one, hand out the magic link,
 * watch progress, read the finished packet — the W-4, the I-9 the employee
 * signed, the pictures — complete I-9 Section 2 under the password gate, and
 * land the packet in ADP (through the API when connected, keyed into RUN from
 * this screen until then). Sensitive values never reach this page: the server
 * sends last-4 and has/hasn't flags only.
 */

const STATUS = {
  invited: ['Invited', 'bg-gray-100 text-gray-700'],
  in_progress: ['In progress', 'bg-blue-100 text-blue-800'],
  ready: ['Ready for review', 'bg-amber-100 text-amber-900'],
  submitted_to_adp: ['Submitted to ADP', 'bg-purple-100 text-purple-800'],
  completed: ['Completed', 'bg-green-100 text-green-800'],
  cancelled: ['Cancelled', 'bg-gray-100 text-gray-400'],
};
const FILING = { single: 'Single / married filing separately', married_jointly: 'Married filing jointly', head_of_household: 'Head of household' };
const CITIZEN = { citizen: 'U.S. citizen', noncitizen_national: 'Noncitizen national', permanent_resident: 'Lawful permanent resident', authorized_alien: 'Noncitizen authorized to work' };
const KIND = { id_document: 'ID document', voided_check: 'Voided check', other: 'File' };

const input = 'w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm';

function StartForm({ onSaved }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF(v => ({ ...v, [k]: e.target.value }));
  const go = async () => {
    setBusy(true); setError('');
    try { onSaved(await apiPost('/onboarding', f)); setF({}); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><UserPlus size={15} /> Start an onboarding</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input className={input} placeholder="First name *" value={f.first_name || ''} onChange={set('first_name')} />
        <input className={input} placeholder="Last name *" value={f.last_name || ''} onChange={set('last_name')} />
        <input className={input} placeholder="Phone" value={f.phone || ''} onChange={set('phone')} />
        <input className={input} placeholder="Email" value={f.email || ''} onChange={set('email')} />
        <input className={input} placeholder="Position" value={f.position || ''} onChange={set('position')} />
        <input className={input} placeholder="Team (e.g. Batching)" value={f.team || ''} onChange={set('team')} />
        <input className={input} type="date" title="Start date" value={f.start_date || ''} onChange={set('start_date')} />
        <input className={input} placeholder="Pay rate (optional)" value={f.pay_rate || ''} onChange={set('pay_rate')} />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button onClick={go} disabled={busy} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
        {busy ? 'Creating…' : 'Create & get the link'}
      </button>
    </div>
  );
}

function LinkStrip({ link, onDismiss }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-green-50 border border-green-300 rounded-xl p-3.5 space-y-1.5">
      <p className="text-sm font-semibold text-green-900 flex items-center gap-1.5"><Link2 size={14} /> Send this link to the new hire — it shows once.</p>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-xs bg-white border border-green-200 rounded-lg px-2 py-1.5 break-all flex-1 min-w-[220px]">{link}</code>
        <button onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold">
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={onDismiss} className="text-xs text-green-800 hover:underline">Done</button>
      </div>
      <p className="text-[11px] text-green-800">Text or email it. Lost link ⇒ Reissue on the row (which kills this one).</p>
    </div>
  );
}

/** The pictures on the packet: open, add, remove. */
function Files({ r, storageEnabled, onChanged }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async (f) => {
    try { const { url } = await apiFetch(`/onboarding/files/${f.id}/url`); if (url) window.open(url, '_blank'); }
    catch (e) { setError(e.message); }
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.filename}?`)) return;
    try { await apiFetch(`/onboarding/files/${f.id}`, { method: 'DELETE' }); onChanged(); }
    catch (e) { setError(e.message); }
  };
  const add = (kind) => async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const fd = new FormData();
    fd.append('kind', kind);
    for (const f of picked) fd.append('files', f);
    setBusy(true); setError('');
    try { await apiUpload(`/onboarding/${r.id}/files`, fd); onChanged(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5" data-onboarding-files>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1"><Paperclip size={11} /> Documents ({r.files.length})</p>
      {r.files.length === 0 && <p className="text-xs text-gray-400">Nothing attached yet.</p>}
      <ul className="flex flex-wrap gap-1.5">
        {r.files.map(f => (
          <li key={f.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg border border-gray-200 text-xs bg-white">
            <span className="text-[10px] font-semibold uppercase text-gray-500">{KIND[f.kind] || f.kind}</span>
            <button type="button" onClick={() => open(f)} className="text-powder-700 hover:underline flex items-center gap-1 max-w-[14rem]">
              <FileText size={11} className="shrink-0" /><span className="truncate">{f.filename}</span>
            </button>
            <span className="text-[10px] text-gray-400">· {f.uploaded_by}</span>
            {!['completed', 'cancelled'].includes(r.status) && (
              <button type="button" onClick={() => remove(f)} title="Remove" className="text-gray-400 hover:text-red-600 p-0.5"><X size={11} /></button>
            )}
          </li>
        ))}
      </ul>
      {storageEnabled && !['completed', 'cancelled'].includes(r.status) && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(KIND).map(([k, l]) => (
            <label key={k} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed text-xs cursor-pointer ${busy ? 'text-gray-400 border-gray-200' : 'text-gray-600 border-gray-300 hover:border-powder-400'}`}>
              <Paperclip size={11} /> Add {l.toLowerCase()}
              <input type="file" multiple accept="image/*,application/pdf" onChange={add(k)} disabled={busy} className="hidden" />
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** I-9 Section 2: what the employer examined, signed under the password gate. */
function Section2({ r, attestation, onChanged }) {
  const [docs, setDocs] = useState([{ list: 'A', title: '', issuing_authority: '', number: '', expires: '' }]);
  const [firstDay, setFirstDay] = useState(r.start_date || '');
  const [title, setTitle] = useState('');
  const [info, setInfo] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s2 = r.i9_section2;
  if (s2) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-900 space-y-1" data-section2-signed>
        <p className="font-semibold flex items-center gap-1"><ShieldCheck size={13} /> I-9 Section 2 completed by {s2.signed_by}{s2.employer_title ? `, ${s2.employer_title}` : ''} · {formatDateTime(s2.signed_at)} · password-verified</p>
        <ul className="list-disc pl-5">
          {s2.documents.map((d, i) => <li key={i}>List {d.list}: {d.title} · {d.issuing_authority} · #{d.number}{d.expires ? ` · expires ${d.expires}` : ''}</li>)}
        </ul>
        <p>First day of employment: {s2.first_day}{s2.additional_info ? ` · ${s2.additional_info}` : ''}</p>
      </div>
    );
  }
  if (!r.i9_signature) {
    return <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-2.5">I-9 Section 2 opens once the employee has signed Section 1.</p>;
  }
  const setDoc = (i, k, v) => setDocs(ds => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const sign = async () => {
    setBusy(true); setError('');
    try {
      await withSignature(
        (extra) => apiPost(`/onboarding/${r.id}/i9-section2`, { documents: docs, first_day: firstDay, employer_title: title, additional_info: info, attest, ...extra }),
        { title: 'Sign I-9 Section 2', detail: `${r.first_name} ${r.last_name} — you are attesting that you examined the documents listed.` },
      );
      onChanged();
    } catch (e) { if (!e.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2" data-section2>
      <p className="text-xs font-bold uppercase tracking-wider text-gray-600">I-9 Section 2 — employer review and verification</p>
      <p className="text-[11px] text-gray-500">Examine the ORIGINAL documents in person (the photos above are for reference), then record them: one List A document, or one List B and one List C. Within three business days of the first day.</p>
      {docs.map((d, i) => (
        <div key={i} className="grid grid-cols-[4.5rem_1fr_1fr_1fr_7rem_auto] gap-1.5 items-center">
          <select className={input} value={d.list} onChange={e => setDoc(i, 'list', e.target.value)}>
            <option value="A">List A</option><option value="B">List B</option><option value="C">List C</option>
          </select>
          <input className={input} placeholder="Document title" value={d.title} onChange={e => setDoc(i, 'title', e.target.value)} />
          <input className={input} placeholder="Issuing authority" value={d.issuing_authority} onChange={e => setDoc(i, 'issuing_authority', e.target.value)} />
          <input className={input} placeholder="Document #" value={d.number} onChange={e => setDoc(i, 'number', e.target.value)} />
          <input className={input} type="date" title="Expiration" value={d.expires} onChange={e => setDoc(i, 'expires', e.target.value)} />
          <button type="button" onClick={() => setDocs(ds => ds.filter((_, j) => j !== i))} disabled={docs.length === 1} className="text-gray-400 hover:text-red-600 disabled:opacity-30 px-1"><X size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={() => setDocs(ds => [...ds, { list: 'C', title: '', issuing_authority: '', number: '', expires: '' }])}
        className="text-xs font-medium text-powder-700 hover:underline">+ Add a document</button>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block"><span className="text-[11px] text-gray-600">Employee's first day *</span>
          <input className={input} type="date" value={firstDay} onChange={e => setFirstDay(e.target.value)} /></label>
        <label className="block"><span className="text-[11px] text-gray-600">Your title</span>
          <input className={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Office Manager" /></label>
        <label className="block"><span className="text-[11px] text-gray-600">Additional information</span>
          <input className={input} value={info} onChange={e => setInfo(e.target.value)} /></label>
      </div>
      <p className="text-[11px] text-gray-600 leading-snug">{attestation}</p>
      <label className="flex items-start gap-2 text-xs text-gray-800">
        <input type="checkbox" className="mt-0.5" checked={attest} onChange={e => setAttest(e.target.checked)} />
        <span>I examined the documents in person and the statement above is true.</span>
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="button" onClick={sign} disabled={busy || !attest} data-sign-section2
        className="inline-flex items-center gap-1 px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
        <ShieldCheck size={12} /> {busy ? 'Signing…' : 'Sign Section 2 (asks for your password)'}
      </button>
    </div>
  );
}

function Row({ r, attestations, storageEnabled, onAction }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [makeAccount, setMakeAccount] = useState(true);
  const [s, cls] = STATUS[r.status] || [r.status, 'bg-gray-100 text-gray-600'];
  const act = async (name, fn) => {
    setBusy(name); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  const prog = r.progress || {};
  const steps = ['welcome', 'personal', 'emergency', 'deposit', 'w4', 'i9'].filter(k => prog[k]).length;
  const sigLine = (sig) => (sig ? `signed ${sig.name} · ${formatDateTime(sig.at)}` : 'NOT SIGNED');
  return (
    <div className="bg-white border border-gray-200 rounded-xl" data-onboarding={r.id}>
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-3.5 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{r.first_name} {r.last_name}
            {r.position && <span className="font-normal text-gray-500"> · {r.position}</span>}
            {r.start_date && <span className="font-normal text-gray-500"> · starts {r.start_date}</span>}</p>
          <p className="text-xs text-gray-500">{steps}/6 steps · invited {formatDateTime(r.invited_at || r.created_at)}
            {r.missing?.length > 0 && !['completed', 'cancelled'].includes(r.status) && <span className="text-amber-700"> · {r.missing.length} still missing</span>}</p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${cls}`}>{s}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-3.5 py-3 space-y-3 text-sm">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-700">
            <span><b>Phone:</b> {r.phone || '—'}</span><span><b>Email:</b> {r.email || '—'}</span>
            <span><b>Address:</b> {[r.address1, r.city, r.state].filter(Boolean).join(', ') || '—'}</span>
            <span><b>DOB:</b> {r.dob || '—'}</span>
            <span><b>SSN:</b> {r.has_ssn ? `••••${r.ssn_last4 || ''}` : 'not provided'}</span>
            <span><b>Pay:</b> {r.pay_method === 'check' ? 'Paper check' : r.pay_method === 'direct_deposit'
              ? (r.has_bank ? `Direct deposit · ${r.dd_bank_name || ''} ••••${r.dd_account_last4 || ''} (${r.dd_account_type || '?'})` : 'Direct deposit · from the voided check') : '—'}</span>
            <span><b>Emergency:</b> {r.emergency_name ? `${r.emergency_name} (${r.emergency_relationship || '?'}) ${r.emergency_phone || ''}` : '—'}</span>
            {r.adp_submitted_at && <span><b>ADP:</b> submitted {formatDateTime(r.adp_submitted_at)}</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-xs text-gray-700 space-y-0.5" data-w4>
              <p className="font-bold uppercase tracking-wider text-[10px] text-gray-500">Form W-4</p>
              <p><b>Filing status:</b> {FILING[r.w4_filing_status] || '—'}{r.w4_multiple_jobs ? ' · Step 2 checked' : ''}{r.w4_exempt ? ' · EXEMPT' : ''}</p>
              <p><b>Dependents:</b> {r.w4_qualifying_children || 0} under 17 · {r.w4_other_dependents || 0} other · ${r.w4_dependents_amount || 0}</p>
              <p><b>Step 4:</b> other income ${r.w4_other_income || 0} · deductions ${r.w4_deductions || 0} · extra withholding ${r.w4_extra_withholding || 0}</p>
              <p className={r.w4_signature ? 'text-green-800' : 'text-amber-800'}><b>Step 5:</b> {sigLine(r.w4_signature)}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-xs text-gray-700 space-y-0.5" data-i9>
              <p className="font-bold uppercase tracking-wider text-[10px] text-gray-500">Form I-9 · Section 1</p>
              <p><b>Attests:</b> {CITIZEN[r.i9_citizenship] || '—'}</p>
              {(r.i9_uscis_number || r.i9_i94_number || r.i9_passport_number) && (
                <p>{r.i9_uscis_number ? `A-Number ${r.i9_uscis_number} ` : ''}{r.i9_i94_number ? `I-94 ${r.i9_i94_number} ` : ''}{r.i9_passport_number ? `Passport ${r.i9_passport_number} (${r.i9_passport_country || '?'})` : ''}</p>
              )}
              {r.i9_work_until && <p><b>Authorized until:</b> {r.i9_work_until}</p>}
              {r.i9_other_last_names && <p><b>Other last names:</b> {r.i9_other_last_names}</p>}
              <p><b>Preparer:</b> {r.i9_preparer === 'used' ? r.i9_preparer_name : 'none'}</p>
              <p className={r.i9_signature ? 'text-green-800' : 'text-amber-800'}><b>Signature:</b> {sigLine(r.i9_signature)}</p>
            </div>
          </div>

          {r.missing?.length > 0 && !['completed', 'cancelled'].includes(r.status) && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5" data-missing>
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>Still missing before they can finish: {r.missing.map(m => m.label).join(', ')}.</span>
            </p>
          )}

          <Files r={r} storageEnabled={storageEnabled} onChanged={() => onAction('refresh')} />
          <Section2 key={r.i9_section2 ? 'signed' : 'open'} r={r} attestation={attestations?.i9_s2} onChanged={() => onAction('refresh')} />

          {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={!!busy} onClick={() => act('pdf', () => downloadFile(`/onboarding/${r.id}/packet.pdf`, `onboarding-${r.last_name || 'packet'}.pdf`))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
              <Download size={12} /> Packet PDF</button>
            {!['completed', 'cancelled'].includes(r.status) && (
              <>
                <button disabled={!!busy} onClick={() => act('reissue', async () => onAction('link', (await apiPost(`/onboarding/${r.id}/reissue`)).link))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
                  <RefreshCw size={12} /> Reissue link</button>
                <button disabled={!!busy} title={r.adp_ready ? 'Push the packet into RUN onboarding' : 'ADP is not connected yet — the packet above is ready to key into RUN'}
                  onClick={() => act('adp', async () => onAction('refresh', await apiPost(`/onboarding/${r.id}/submit-adp`)))}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${r.adp_ready ? 'bg-purple-600 text-white hover:bg-purple-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                  <Send size={12} /> {busy === 'adp' ? 'Submitting…' : 'Submit to ADP'}</button>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-1">
                  <input type="checkbox" checked={makeAccount} onChange={e => setMakeAccount(e.target.checked)} />
                  create their ReadyDoc account
                </label>
                <button disabled={!!busy} onClick={() => act('complete', async () => onAction('refresh', await apiPost(`/onboarding/${r.id}/complete`, { create_account: makeAccount })))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700">
                  <CheckCircle2 size={12} /> Complete</button>
                <button disabled={!!busy} onClick={() => { if (confirm('Cancel this onboarding? The link stops working.')) act('cancel', async () => onAction('refresh', await apiPost(`/onboarding/${r.id}/cancel`))); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:text-red-600 ml-auto">
                  <XCircle size={12} /> Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OnboardingPanel() {
  const { data, refresh } = useApiGet('/onboarding');
  const [link, setLink] = useState('');
  const records = data?.records || [];
  const onAction = (kind, payload) => {
    if (kind === 'link') setLink(payload);
    refresh();
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Onboarding</h2>
        <p className="text-sm text-gray-500">Start a new hire, send them their link, review the signed W-4 and I-9, complete Section 2, land it in ADP.
          {data && !data.adp_ready && ' ADP is not connected yet — packets are keyed into RUN from here (Settings → Integrations).'}
          {data && !data.sensitive_collection && ' The encryption key is not set, so the wizard is not asking for SSN or bank details.'}
        </p>
      </div>
      {link && <LinkStrip link={link} onDismiss={() => setLink('')} />}
      <StartForm onSaved={(r) => { setLink(r.link); refresh(); }} />
      <div className="space-y-2">
        {records.map(r => (
          <Row key={r.id} r={{ ...r, adp_ready: data?.adp_ready }} attestations={data?.attestations}
            storageEnabled={!!data?.storage_enabled} onAction={onAction} />
        ))}
        {records.length === 0 && <p className="text-sm text-gray-400 bg-white border border-gray-200 rounded-xl px-4 py-8 text-center">No onboardings yet.</p>}
      </div>
      <p className="text-[11px] text-gray-400">
        The packet PDF records what was entered, what was signed and when, and the documents examined. Whether that PDF is
        the retained Form I-9 or the office also completes the official form in ADP is a decision for HR — see docs/adp-run-onboarding.md.
      </p>
    </div>
  );
}
