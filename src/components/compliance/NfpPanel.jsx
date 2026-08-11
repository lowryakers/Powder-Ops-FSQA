import { useState } from 'react';
import { useApiGet, apiFetch, apiUpload } from '../../hooks/useApi';
import {
  FileText, Link2, Upload, CheckCircle2, XCircle, Clock, Copy, Check,
  AlertTriangle, Trash2, Plus, Send,
} from 'lucide-react';

/**
 * Nutrition panels: file one, send it for approval, record the decision.
 *
 * Two screens off one module. `<NfpForSku>` is the workflow, mounted in the
 * product drawer where someone is already looking at the product. `<NfpBoard>`
 * is the roll-up — what is waiting on somebody, and which products have no
 * panel at all. The second list is the one that earns its keep: a list of the
 * panels that exist cannot tell you which product is about to go to artwork
 * without one.
 *
 * The product's NFP version and approval date are NOT edited anywhere. They are
 * written by approving a panel, which is why the catalogue's edit form no longer
 * offers them — while they were text boxes, the artwork print gate opened by
 * typing a date into one.
 */

const STATUS = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-700', Icon: FileText },
  sent: { label: 'Waiting on approver', cls: 'bg-amber-100 text-amber-800', Icon: Clock },
  approved: { label: 'Approved', cls: 'bg-green-100 text-green-800', Icon: CheckCircle2 },
  rejected: { label: 'Sent back', cls: 'bg-red-100 text-red-800', Icon: XCircle },
  superseded: { label: 'Superseded', cls: 'bg-gray-100 text-gray-500', Icon: FileText },
};

function StatusChip({ status }) {
  const s = STATUS[status] || STATUS.draft;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
      <s.Icon size={12} /> {s.label}
    </span>
  );
}

/** The issued link, shown once. Copy is the only thing anyone does with it. */
function LinkBox({ link }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <div className="rounded-lg border border-powder-200 bg-powder-50 p-3 space-y-2">
      <p className="text-xs font-medium text-powder-900">
        Text or email this link to the approver. It works once and is shown here only now —
        if it is lost, issue a new one (which turns this one off).
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] bg-white border border-powder-200 rounded px-2 py-1.5 break-all">{link}</code>
        <button onClick={copy}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium">
          {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
    </div>
  );
}

function NewPanelForm({ sku, formulaRev, onDone, onCancel }) {
  const [f, setF] = useState({
    version: '', serving_size: '', servings_per_container: '',
    formula_rev: formulaRev || '', drive_url: '', change_summary: '',
    source: 'upload', approved_by: '', approved_at: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const created = await apiFetch('/nfp', { method: 'POST', body: JSON.stringify({ ...f, sku }) });
      onDone(created);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2.5">
      {error && <p className="text-sm text-red-700 bg-red-50 rounded p-2">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        {[['version', 'Panel version *'], ['formula_rev', 'Formula revision'],
          ['serving_size', 'Serving size'], ['servings_per_container', 'Servings / container']].map(([k, label]) => (
          <label key={k} className="block">
            <span className="text-xs font-medium text-gray-600">{label}</span>
            <input value={f[k]} onChange={set(k)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-medium text-gray-600">Drive link (if the panel lives there)</span>
        <input value={f.drive_url} onChange={set('drive_url')}
          className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-gray-600">What changed</span>
        <textarea value={f.change_summary} onChange={set('change_summary')} rows={2}
          className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </label>

      {/* A panel approved before ReadyDoc existed. It asks for the two facts a
          typed approval date never carried — who approved it, and when. */}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={f.source === 'paper'}
          onChange={(e) => setF((p) => ({ ...p, source: e.target.checked ? 'paper' : 'upload' }))} />
        Already approved on paper — record the existing approval
      </label>
      {f.source === 'paper' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Approved by *</span>
            <input value={f.approved_by} onChange={set('approved_by')}
              className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Approved on *</span>
            <input type="date" value={f.approved_at} onChange={set('approved_at')}
              className="mt-1 w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </label>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !f.version.trim()}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {busy ? 'Saving…' : 'File panel'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
  );
}

function VersionCard({ v, canEdit, onChanged }) {
  const [link, setLink] = useState('');
  const [sentTo, setSentTo] = useState(v.sent_to || '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState(null);
  const [by, setBy] = useState('');
  const [comments, setComments] = useState('');
  const [stranded, setStranded] = useState([]);

  const open = ['draft', 'sent', 'rejected'].includes(v.status);

  const act = async (what, fn) => {
    setBusy(what); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy('');
  };

  const upload = (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('kind', 'panel');
    act('upload', async () => { await apiUpload(`/nfp/${v.id}/files`, fd); onChanged(); });
    e.target.value = '';
  };

  const send = () => act('send', async () => {
    const r = await apiFetch(`/nfp/${v.id}/send`, { method: 'POST', body: JSON.stringify({ sent_to: sentTo }) });
    setLink(r.link);
    onChanged();
  });

  const submitDecision = () => act('decide', async () => {
    const r = await apiFetch(`/nfp/${v.id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision: deciding, approved_by: by, comments }),
    });
    setStranded(r.stranded_artwork || []);
    setDeciding(null); setBy(''); setComments('');
    onChanged();
  });

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${v.status === 'approved' ? 'border-green-200 bg-green-50/40' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <p className="font-semibold text-gray-900 text-sm">
            Panel {v.version}
            {v.source === 'paper' && <span className="ml-1.5 text-xs font-normal text-gray-500">(on paper)</span>}
          </p>
          <p className="text-xs text-gray-500">
            {[v.serving_size && `Serving ${v.serving_size}`, v.formula_rev && `Formula ${v.formula_rev}`]
              .filter(Boolean).join(' · ') || 'No serving details recorded'}
          </p>
        </div>
        <StatusChip status={v.status} />
      </div>

      {v.change_summary && <p className="text-xs text-gray-600">{v.change_summary}</p>}

      {v.approved_at && (
        <p className="text-xs text-gray-700">
          {v.status === 'rejected' ? 'Sent back by' : 'Approved by'} <strong>{v.approved_by}</strong>
          {v.status !== 'rejected' && ` on ${v.approved_at}`}
          {v.decided_via === 'link' && ' via the approval link'}
          {v.decided_via === 'paper' && ' (recorded from paper)'}
        </p>
      )}
      {v.rejected_reason && (
        <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded p-2">{v.rejected_reason}</p>
      )}

      {v.files?.length > 0 && (
        <ul className="space-y-1">
          {v.files.map((f) => (
            <li key={f.id}>
              <button onClick={() => apiFetch(`/nfp/files/${f.id}`).then((d) => window.open(d.url, '_blank'))}
                className="text-xs text-powder-700 hover:underline inline-flex items-center gap-1">
                <FileText size={12} /> {f.filename}
              </button>
            </li>
          ))}
        </ul>
      )}
      {v.drive_url && (
        <a href={v.drive_url} target="_blank" rel="noreferrer"
          className="text-xs text-powder-700 hover:underline inline-flex items-center gap-1">
          <Link2 size={12} /> Panel in Drive
        </a>
      )}

      {!v.has_panel && open && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Attach the panel or add a Drive link — a link cannot be sent until there is something to look at.
        </p>
      )}

      {error && <p className="text-xs text-red-700 bg-red-50 rounded p-2">{error}</p>}
      {link && <LinkBox link={link} />}

      {/* Artwork already at the printer against an older panel. Reported, never
          changed: the film on the shelf is still what was printed. */}
      {stranded.length > 0 && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">
          <p className="font-medium">
            {stranded.length} print-ready artwork version{stranded.length === 1 ? ' was' : 's were'} drawn against an
            older panel:
          </p>
          <ul className="mt-1 space-y-0.5">
            {stranded.map((a) => (
              <li key={a.id}>{a.component} v{a.artwork_version} — NFP {a.nfp_version}</li>
            ))}
          </ul>
          <p className="mt-1">Nothing has been changed. Decide whether those packs need a revision.</p>
        </div>
      )}

      {canEdit && open && (
        <div className="pt-1 space-y-2 border-t border-gray-100">
          {deciding ? (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-gray-700">
                {deciding === 'approved' ? 'Record the approval' : 'Send the panel back'}
              </p>
              <input value={by} onChange={(e) => setBy(e.target.value)}
                placeholder="Who decided (leave blank for yourself)"
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2}
                placeholder={deciding === 'approved' ? 'Comments (optional)' : 'What is wrong with it (required)'}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
              <div className="flex gap-2">
                <button onClick={submitDecision} disabled={busy === 'decide'}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50 ${deciding === 'approved' ? 'bg-green-600' : 'bg-red-600'}`}>
                  {busy === 'decide' ? 'Saving…' : 'Confirm'}
                </button>
                <button onClick={() => setDeciding(null)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-gray-50">
                <Upload size={13} /> {busy === 'upload' ? 'Uploading…' : 'Attach panel'}
                <input type="file" className="hidden" multiple onChange={upload} />
              </label>
              <input value={sentTo} onChange={(e) => setSentTo(e.target.value)} placeholder="Send to (name)"
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs w-40" />
              <button onClick={send} disabled={busy === 'send' || !v.has_panel}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-40">
                <Send size={13} /> {busy === 'send' ? 'Issuing…' : v.link_live ? 'New link' : 'Get approval link'}
              </button>
              {v.link_live && (
                <button onClick={() => act('revoke', async () => { await apiFetch(`/nfp/${v.id}/revoke`, { method: 'POST' }); onChanged(); })}
                  className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs">Turn link off</button>
              )}
              <button onClick={() => setDeciding('approved')}
                className="px-2.5 py-1.5 border border-green-300 text-green-800 rounded-lg text-xs font-medium">
                Approve here
              </button>
              <button onClick={() => setDeciding('rejected')}
                className="px-2.5 py-1.5 border border-red-300 text-red-800 rounded-lg text-xs font-medium">
                Send back
              </button>
              <button onClick={() => act('delete', async () => { await apiFetch(`/nfp/${v.id}`, { method: 'DELETE' }); onChanged(); })}
                className="ml-auto text-gray-400 hover:text-red-600" title="Delete this draft">
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The workflow, mounted in the product drawer. */
export function NfpForSku({ sku, formulaRev, canEdit, onChanged }) {
  const { data, refresh } = useApiGet(`/nfp/sku/${encodeURIComponent(sku)}`, [sku]);
  const [adding, setAdding] = useState(false);
  const versions = data?.versions || [];

  const changed = () => { refresh(); onChanged?.(); };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
          <FileText size={15} className="text-powder-600" /> Nutrition panel
        </h4>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
            <Plus size={13} /> File a panel
          </button>
        )}
      </div>

      {adding && (
        <NewPanelForm sku={sku} formulaRev={formulaRev}
          onDone={() => { setAdding(false); changed(); }} onCancel={() => setAdding(false)} />
      )}

      {versions.length === 0 && !adding && (
        <p className="text-xs text-gray-500">
          No panel on file. Artwork cannot be released to print until one is approved.
        </p>
      )}

      {versions.map((v) => (
        <VersionCard key={v.id} v={v} canEdit={canEdit} onChanged={changed} />
      ))}
    </div>
  );
}

// `data` comes from the panel above, which fetches it so the tab can carry the
// count. One fetch, one number — the badge and this board cannot disagree.
/** The roll-up: what is waiting, and what has nothing on file. */
export default function NfpBoard({ data, onOpenSku }) {
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const versions = data.versions || [];
  const open = versions.filter((v) => ['draft', 'sent', 'rejected'].includes(v.status));
  const approved = versions.filter((v) => v.status === 'approved');
  const missing = data.missing || [];

  const Row = ({ v }) => (
    <button onClick={() => onOpenSku?.(v.sku)}
      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0">
      <code className="text-xs font-medium text-gray-900 w-28 shrink-0 truncate">{v.sku}</code>
      <span className="text-sm text-gray-700 flex-1 truncate">{v.flavor}</span>
      <span className="text-xs text-gray-500 shrink-0">{v.version}</span>
      <StatusChip status={v.status} />
    </button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 max-w-2xl">
        The nutrition panel is approved by whoever signs off nutrition, usually on a texted link with no login.
        Approving one here is what lets artwork be released to print against it — those two facts on the product
        are written by the approval, not typed.
      </p>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-1.5">
          Waiting on someone ({open.length})
        </h4>
        {open.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing outstanding.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {open.map((v) => <Row key={v.id} v={v} />)}
          </div>
        )}
      </div>

      {/* The list that earns its keep. A catalogue of the panels that exist
          cannot tell you which product is about to go to artwork without one. */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-1">
          <AlertTriangle size={15} className="text-amber-600" /> No panel on file ({missing.length})
        </h4>
        <p className="text-xs text-gray-600 mb-1.5">
          Artwork for these cannot be released to print. Discontinued products are not listed.
        </p>
        {missing.length === 0 ? (
          <p className="text-sm text-gray-500">Every active product has a panel.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
            {missing.map((p) => (
              <button key={p.sku} onClick={() => onOpenSku?.(p.sku)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <code className="text-xs font-medium text-gray-900 w-28 shrink-0 truncate">{p.sku}</code>
                <span className="text-sm text-gray-700 flex-1 truncate">{p.flavor}</span>
                <span className="text-xs text-gray-400 shrink-0">{p.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-1.5">Approved ({approved.length})</h4>
        {approved.length === 0 ? (
          <p className="text-sm text-gray-500">No panel has been approved yet.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
            {approved.map((v) => <Row key={v.id} v={v} />)}
          </div>
        )}
      </div>
    </div>
  );
}
