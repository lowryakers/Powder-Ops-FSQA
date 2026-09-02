import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { UserPlus, Link2, Copy, CheckCircle2, XCircle, Send, RefreshCw } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';

/**
 * Office side of new-hire onboarding: start one, hand out the magic link,
 * watch progress, and land the finished packet in ADP — through the API when
 * connected, keyed into RUN from this screen until then. Sensitive values
 * never reach this page: the server sends last-4 and has/hasn't flags only.
 */

const STATUS = {
  invited: ['Invited', 'bg-gray-100 text-gray-700'],
  in_progress: ['In progress', 'bg-blue-100 text-blue-800'],
  ready: ['Ready for review', 'bg-amber-100 text-amber-900'],
  submitted_to_adp: ['Submitted to ADP', 'bg-purple-100 text-purple-800'],
  completed: ['Completed', 'bg-green-100 text-green-800'],
  cancelled: ['Cancelled', 'bg-gray-100 text-gray-400'],
};

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

function Row({ r, onAction }) {
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
  const steps = ['welcome', 'personal', 'emergency', 'deposit', 'w4'].filter(k => prog[k]).length;
  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-3.5 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{r.first_name} {r.last_name}
            {r.position && <span className="font-normal text-gray-500"> · {r.position}</span>}
            {r.start_date && <span className="font-normal text-gray-500"> · starts {r.start_date}</span>}</p>
          <p className="text-xs text-gray-500">{steps}/5 steps · invited {formatDateTime(r.invited_at || r.created_at)}</p>
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
            <span><b>Bank:</b> {r.has_bank ? `${r.dd_bank_name || ''} ••••${r.dd_account_last4 || ''} (${r.dd_account_type || '?'})` : 'not provided'}</span>
            <span><b>W-4:</b> {r.w4_filing_status ? `${r.w4_filing_status}${r.w4_multiple_jobs ? ' · 2 jobs' : ''}` : '—'}</span>
            <span><b>Emergency:</b> {r.emergency_name ? `${r.emergency_name} (${r.emergency_relationship || '?'}) ${r.emergency_phone || ''}` : '—'}</span>
            {r.adp_submitted_at && <span><b>ADP:</b> submitted {formatDateTime(r.adp_submitted_at)}</span>}
          </div>
          {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
          {!['completed', 'cancelled'].includes(r.status) && (
            <div className="flex items-center gap-2 flex-wrap">
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
            </div>
          )}
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
        <p className="text-sm text-gray-500">Start a new hire, send them their link, review the packet, land it in ADP.
          {data && !data.adp_ready && ' ADP is not connected yet — packets are keyed into RUN from here (docs/adp-run-onboarding.md).'}</p>
      </div>
      {link && <LinkStrip link={link} onDismiss={() => setLink('')} />}
      <StartForm onSaved={(r) => { setLink(r.link); refresh(); }} />
      <div className="space-y-2">
        {records.map(r => <Row key={r.id} r={{ ...r, adp_ready: data?.adp_ready }} onAction={onAction} />)}
        {records.length === 0 && <p className="text-sm text-gray-400 bg-white border border-gray-200 rounded-xl px-4 py-8 text-center">No onboardings yet.</p>}
      </div>
    </div>
  );
}
