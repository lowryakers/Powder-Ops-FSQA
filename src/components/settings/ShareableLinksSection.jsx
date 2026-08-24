import { useState } from 'react';
import { Copy, Check, Shield, Trash2, Plus, Eye, EyeOff } from 'lucide-react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';

// The public and semi-public ways in: the QR-code work order form, the end-of-
// day entry form, and the auditor portal.
//
// window.location.origin is safe here, unlike in server-side link building:
// the launcher host 302s every GET except the bare landing request, so the app
// itself can only ever be running on the ReadyDoc origin. A link built from
// where this page is loaded is therefore already the right host.

const LINKS = [
  {
    path: '/submit',
    title: 'Work Order Submission',
    blurb: 'Public form for anyone to submit a work order. Accessible via QR code — no login required.',
    tone: 'border-gray-200', code: 'text-powder-600',
  },
  {
    path: '/production-entry',
    title: 'End of Day / Production Entry',
    blurb: 'SQF production report form for supervisors. Requires login — tracks who submitted each entry.',
    tone: 'border-green-200', code: 'text-green-600',
    note: null,
  },
  {
    path: '/kiosk/visitor',
    title: 'Visitor Sign-In (lobby tablet)',
    blurb: 'Open on the lobby tablet and add it to the home screen. No login — visitors sign themselves in and out, and sign the NDA.',
    tone: 'border-sky-200', code: 'text-sky-600',
    note: 'Returns to the logo by itself, so the next visitor never sees the last one\'s details.',
  },
  {
    path: '/auditor',
    title: 'Auditor Portal',
    blurb: 'The read-only evidence binder. Anyone opening this link needs a pass — issue one below.',
    tone: 'border-purple-200', code: 'text-purple-600',
    // The old note here said the auditor signs in as an email address. Login
    // matches on username or full name and never on an email, so that
    // instruction returned "User not found" every time it was followed.
    note: null,
  },
];

export default function ShareableLinksSection() {
  const [copied, setCopied] = useState(null);
  const origin = window.location.origin;

  const copy = async (url) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        // A plant tablet on plain http has no secure context and therefore no
        // clipboard API — fall back rather than failing silently.
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(url);
      setTimeout(() => setCopied(c => (c === url ? null : c)), 2000);
    } catch { /* nothing useful to say */ }
  };

  return (
    <div className="space-y-3">
      {LINKS.map(l => {
        const url = `${origin}${l.path}`;
        return (
          <div key={l.path} className={`bg-white rounded-xl border p-4 ${l.tone}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">{l.title}</h3>
                <p className="text-sm text-gray-500">{l.blurb}</p>
                <code className={`text-xs mt-1 block break-all ${l.code}`}>{url}</code>
                {l.note && <p className="text-xs text-gray-400 mt-1">{l.note}</p>}
              </div>
              <button onClick={() => copy(url)}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1 shrink-0">
                {copied === url ? <><Check size={14} className="text-green-600" /> Copied!</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
          </div>
        );
      })}

      <AuditorPasses copy={copy} copied={copied} origin={origin} />
      <BinderSections />
    </div>
  );
}

// ── Auditor passes ───────────────────────────────────────────────────────────
//
// A pass is how the auditor (or Carol walking them through it) gets in. The
// clear text comes back exactly once, so it is shown until the page is left
// and then it is gone — there is nowhere to look it up again, which is what
// makes storing only the hash worth anything.
function AuditorPasses({ copy, copied, origin }) {
  const { data: passes, refresh } = useApiGet('/auditor-passes');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(14);
  const [issued, setIssued] = useState(null);   // shown once, never fetched again
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const issue = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await apiPost('/auditor-passes', { visitor_name: name.trim(), note: note.trim(), days });
      setIssued(res);
      setName(''); setNote('');
      refresh();
    } catch (err) {
      setError(err.message || 'Could not issue the pass.');
    } finally { setBusy(false); }
  };

  const revoke = async (p) => {
    if (!window.confirm(`Revoke ${p.visitor_name}'s pass? The link stops working immediately.`)) return;
    try { await apiDelete(`/auditor-passes/${p.id}`); refresh(); }
    catch (err) { setError(err.message || 'Could not revoke that pass.'); }
  };

  const passUrl = issued ? `${origin}/auditor?pass=${issued.token}` : '';
  const rows = passes || [];

  return (
    <div className="bg-white rounded-xl border border-purple-200 p-4 space-y-4">
      <div className="flex items-start gap-2.5">
        <Shield size={18} className="text-purple-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-gray-900">Auditor passes</h3>
          <p className="text-sm text-gray-500">
            A link that opens the binder with nothing to type. No password, nothing to forget,
            and no lockout after a few wrong attempts. The visitor's name goes on every record
            they open, so the audit trail says who was looking.
          </p>
        </div>
      </div>

      {issued && (
        <div className="rounded-xl border border-green-300 bg-green-50 p-3.5 space-y-2">
          <p className="text-sm font-semibold text-green-900">
            Pass for {issued.visitor_name} — copy it now
          </p>
          <p className="text-[11px] text-green-800">
            This is the only time the link is shown. If it is lost, revoke this pass and issue another.
          </p>
          <code className="block text-xs break-all bg-white border border-green-200 rounded-lg p-2 text-gray-800">{passUrl}</code>
          <button type="button" onClick={() => copy(passUrl)}
            className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-1.5">
            {copied === passUrl ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy the link</>}
          </button>
        </div>
      )}

      <form onSubmit={issue} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Who is it for?</label>
          <input value={name} onChange={e => setName(e.target.value)} required minLength={2}
            placeholder="Carol Pierce"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="min-w-[10rem] flex-1">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Note (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="SQF audit, consultant"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="w-24">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Valid for</label>
          <select value={days} onChange={e => setDays(parseInt(e.target.value, 10))}
            className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <button type="submit" disabled={busy || name.trim().length < 2}
          className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1.5 shrink-0">
          <Plus size={14} /> {busy ? 'Issuing…' : 'Issue pass'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {rows.length > 0 && (
        <div className="divide-y divide-gray-100 border-t border-gray-100 pt-1">
          {rows.map(p => (
            <div key={p.id} className="py-2 flex items-center gap-3 flex-wrap">
              <span className="font-medium text-gray-900 text-sm">{p.visitor_name}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                p.status === 'active' ? 'bg-green-100 text-green-700'
                  : p.status === 'expired' ? 'bg-gray-100 text-gray-500' : 'bg-red-100 text-red-700'}`}>
                {p.status.toUpperCase()}
              </span>
              <span className="text-xs text-gray-400 flex-1 min-w-0 truncate">
                {p.note ? `${p.note} · ` : ''}
                expires {String(p.expires_at).slice(0, 10)}
                {p.use_count > 0 ? ` · opened ${p.use_count}×` : ' · never opened'}
              </span>
              {p.status === 'active' && (
                <button type="button" onClick={() => revoke(p)}
                  className="text-gray-400 hover:text-red-600 shrink-0" title="Revoke this pass">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── What the binder shows ────────────────────────────────────────────────────
//
// Hiding a section is a SETTING and not a code change, because "temporarily"
// means whoever decided it has to be able to put it back without a deploy.
// Nothing is deleted and no log is filtered — the registry is still there in
// the operating app for everyone who could see it before.
const BINDER_LABELS = {
  documents: {
    label: 'Controlled Document Registry',
    blurb: 'SOPs, work instructions and policies with their revisions.',
  },
  dcr: {
    label: 'Document Change Requests',
    blurb: 'The change-request log.',
  },
  'job-descriptions': {
    label: 'Job Descriptions',
    blurb: 'Listed under Personnel, not the registry — an auditor asks for a JD beside that person\'s training.',
  },
  'process-maps': {
    label: 'Process Maps',
    blurb: 'How records move and who owns each step.',
  },
};

function BinderSections() {
  const { data, refresh } = useApiGet('/compliance/binder');
  const [error, setError] = useState('');
  const hidden = data?.hidden || [];
  const sections = data?.sections || [];

  const toggle = async (id) => {
    const next = hidden.includes(id) ? hidden.filter(h => h !== id) : [...hidden, id];
    setError('');
    try { await apiPut('/compliance/binder', { hidden: next }); refresh(); }
    catch (err) { setError(err.message || 'Could not save that.'); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-gray-900">What the binder shows</h3>
        <p className="text-sm text-gray-500">
          Turn a chapter off while the plant is presenting that evidence on paper. Nothing is
          deleted and nothing changes anywhere else in ReadyDoc — this only decides what an
          auditor sees in the binder. A chapter left with no sections is dropped entirely.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {sections.map(id => {
          const meta = BINDER_LABELS[id] || { label: id, blurb: '' };
          const off = hidden.includes(id);
          return (
            <div key={id} className="py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${off ? 'text-gray-400' : 'text-gray-900'}`}>{meta.label}</p>
                <p className="text-xs text-gray-400">{meta.blurb}</p>
              </div>
              <button type="button" onClick={() => toggle(id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 ${
                  off ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {off ? <><EyeOff size={13} /> Hidden</> : <><Eye size={13} /> Showing</>}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
