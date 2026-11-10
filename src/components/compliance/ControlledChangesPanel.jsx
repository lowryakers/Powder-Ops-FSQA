import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { withSignature } from '../../lib/signature';
import { ShieldCheck, Clock, Check, X, AlertTriangle, FileText, Pencil, UserCheck } from 'lucide-react';

const isDc = (u) => u?.role === 'admin' || (u?.department || '').toLowerCase() === 'document_control';
const isQaSup = (u) => !!u && ['qa', 'quality'].includes((u.department || '').toLowerCase()) && ['supervisor', 'admin'].includes(u.role);

// D-328: Document Control types the new value here. It is a proposal until a QA
// supervisor reviews it and it is approved with a password — the same steps as an
// SOP revision. The server owns every rule; this form only collects the values.
function ProposeForm({ row, onDone, onCancel }) {
  const { data, loading, error: loadError } = useApiGet(`/controlled/${row.id}/edit`);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (loading && !data) return <p className="text-xs text-gray-400">Loading…</p>;
  if (loadError) return <p className="text-xs text-red-700">{loadError.message || String(loadError)}</p>;
  const fields = data?.fields || [];
  const start = Object.fromEntries((data?.proposed || fields).map(f => [f.path, f.value ?? '']));
  const val = (f) => (Object.prototype.hasOwnProperty.call(values, f.path) ? values[f.path] : (start[f.path] ?? ''));
  const groups = [];
  for (const f of fields) {
    const g = f.group || '';
    let bucket = groups.find(x => x.name === g);
    if (!bucket) { bucket = { name: g, fields: [] }; groups.push(bucket); }
    bucket.fields.push(f);
  }
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const all = Object.fromEntries(fields.map(f => [f.path, val(f)]));
      await apiPost(`/controlled/${row.id}/propose`, { values: all, reason });
      onDone();
    } catch (e) { setError(e.message || 'Could not save the change.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 bg-white rounded-lg border border-gray-200 p-3" data-propose-form={row.key}>
      {groups.map(g => (
        <fieldset key={g.name} className="space-y-2">
          {g.name && <legend className="text-xs font-semibold text-gray-700">{g.name}</legend>}
          <div className="grid gap-2 sm:grid-cols-2">
            {g.fields.map(f => (
              <label key={f.path} className="block text-xs text-gray-600">
                {f.label}{f.unit ? ` (${f.unit})` : ''}{f.optional ? ' — optional' : ''}
                <input value={val(f) ?? ''} inputMode={f.type === 'number' ? 'decimal' : undefined}
                  data-field={f.path}
                  onChange={e => setValues(v => ({ ...v, [f.path]: e.target.value }))}
                  className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="block text-xs text-gray-600">Why is it changing? (for example, the DCR number)
        <input value={reason} onChange={e => setReason(e.target.value)} data-propose-reason
          className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <p className="text-[11px] text-gray-500">Nothing changes on the floor yet. A QA supervisor reviews it, then it is approved with a password and goes into use.</p>
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} data-propose-submit
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
          Send for QA review
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">Cancel</button>
      </div>
    </div>
  );
}

// Controlled Changes — what Document Control has approved the app to serve.
//
// Most of these ship in the code, so a change is already deployed by the time
// anyone sees it here. What this screen decides is whether it TAKES EFFECT: the
// app keeps serving the last approved version until it's approved, and says so
// plainly rather than leaving Daniela to infer it.

const SCOPE_LABEL = {
  qms_form: 'Form definition',
  acceptance: 'Acceptance criteria',
  procedure: 'Procedure wording',
  checklist: 'Checklist questions',
};

const KIND_TONE = {
  added: 'bg-emerald-100 text-emerald-700',
  removed: 'bg-red-100 text-red-700',
  changed: 'bg-amber-100 text-amber-700',
};

function valueText(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    if (v.label) return `${v.label}${v.type ? ` (${v.type})` : ''}`;
    return JSON.stringify(v);
  }
  return String(v);
}

function ChangeRow({ c }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={`px-1.5 py-0.5 rounded-full font-bold shrink-0 ${KIND_TONE[c.kind] || 'bg-gray-100 text-gray-600'}`}>{c.kind}</span>
      <span className="min-w-0">
        <span className="font-medium text-gray-800">{c.what}</span>
        {c.kind === 'changed' && (
          <span className="text-gray-500"> · {valueText(c.from)} → {valueText(c.to)}</span>
        )}
        {c.kind === 'added' && <span className="text-gray-500"> · {valueText(c.to)}</span>}
        {c.kind === 'removed' && <span className="text-gray-500"> · {valueText(c.from)}</span>}
      </span>
    </li>
  );
}

export default function ControlledChangesPanel() {
  const { user } = useAuth();
  const { data, loading, refresh } = useApiGet('/controlled');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [denying, setDenying] = useState(null); // row id
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(null); // row id
  const dc = isDc(user);
  const qa = isQaSup(user);

  const rows = data || [];
  const waiting = rows.filter(r => r.status === 'pending');
  const settled = rows.filter(r => r.status !== 'pending');

  const act = async (row, kind) => {
    setBusy(row.id); setError('');
    try {
      if (kind === 'reject') await apiPost(`/controlled/${row.id}/reject`, { reason });
      else if (kind === 'qa-review' || (kind === 'approve' && row.pending_source === 'app')) {
        await withSignature((extra) => apiPost(`/controlled/${row.id}/${kind}`, extra),
          { title: kind === 'approve' ? `Approve: ${row.label}` : `QA review: ${row.label}`, detail: row.proposed_reason || '' });
      } else await apiPost(`/controlled/${row.id}/${kind}`, {});
      setDenying(null); setReason('');
      refresh();
    } catch (e) { if (!e.cancelled) setError(e.message || 'Could not record that.'); }
    finally { setBusy(''); }
  };

  if (loading && !data) return <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck size={16} /> Controlled Changes</h3>
        <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
          Form definitions and acceptance criteria only take effect once Document Control approves them.
          A change is <span className="font-medium">not in use</span> until it is approved here — the app keeps serving
          the approved version. Limits and the dilution checks marked <span className="font-medium">Change</span> are changed
          right here: Document Control types the new value, a QA supervisor reviews it, and it is approved with a password.
          Dropdown lists and custom fields are not controlled and stay self-serve.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {waiting.length === 0 && (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-6 text-center">
          Nothing is waiting. The app is serving the approved version of every controlled definition.
        </p>
      )}

      {waiting.map(r => (
        <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2.5">
          <div className="flex items-start gap-2 flex-wrap">
            <Clock size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 text-sm">{r.label}</p>
              <p className="text-[11px] text-gray-500">
                {SCOPE_LABEL[r.scope] || r.scope} · in use: v{r.version}
                {r.approved_by ? ` approved by ${r.approved_by}` : ''}
                {r.pending_seen_at ? ` · deployed ${r.pending_seen_at.slice(0, 10)}` : ''}
              </p>
            </div>
            {r.pending_dcr_id && (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 shrink-0">
                <FileText size={11} /> change request raised
              </span>
            )}
          </div>

          {r.pending_source === 'app' && (
            <p className="text-xs text-gray-700" data-proposal={r.key}>
              Changed in the app by <span className="font-medium">{r.proposed_by}</span>
              {r.proposed_at ? ` on ${r.proposed_at.slice(0, 10)}` : ''} — {r.proposed_reason}.{' '}
              {r.qa_reviewed_at
                ? <span className="text-emerald-700 font-medium inline-flex items-center gap-1"><UserCheck size={12} /> QA reviewed by {r.qa_reviewed_by}</span>
                : <span className="text-amber-800 font-medium">Waiting for QA review.</span>}
            </p>
          )}

          {r.changes.length > 0 && (
            <ul className="space-y-1 bg-white/70 rounded-lg px-3 py-2">
              {r.changes.map((c, i) => <ChangeRow key={i} c={c} />)}
            </ul>
          )}

          {denying === r.id ? (
            <div className="space-y-2">
              <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                placeholder="Why is this not approved? (recorded on the change)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div className="flex items-center gap-2">
                <button onClick={() => act(r, 'reject')} disabled={busy === r.id}
                  className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                  Confirm deny
                </button>
                <button onClick={() => { setDenying(null); setReason(''); }}
                  className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {r.pending_source === 'app' && !r.qa_reviewed_at && qa && r.proposed_by_id !== user?.id && (
                <button onClick={() => act(r, 'qa-review')} disabled={busy === r.id} data-qa-review={r.key}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                  <UserCheck size={13} /> Give QA review
                </button>
              )}
              {r.pending_source === 'app' && dc && (
                <button onClick={() => setEditing(editing === r.id ? null : r.id)} disabled={busy === r.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
                  <Pencil size={13} /> Edit the change
                </button>
              )}
              {dc && (r.pending_source !== 'app' || r.qa_reviewed_at) && <>
              <button onClick={() => act(r, 'approve')} disabled={busy === r.id} data-approve={r.key}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
                <Check size={13} /> Approve — put in use
              </button>
              <button onClick={() => setDenying(r.id)} disabled={busy === r.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-50">
                <X size={13} /> Deny
              </button>
              </>}
            </div>
          )}
          {editing === r.id && <ProposeForm row={r} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
        </div>
      ))}

      {settled.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <p className="px-4 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">
            In use ({settled.length})
          </p>
          <ul className="divide-y divide-gray-100">
            {settled.map(r => (
              <li key={r.id} className="px-4 py-2 flex items-center gap-2 text-sm">
                <span className="min-w-0 truncate text-gray-800">{r.label}</span>
                <span className="text-[11px] text-gray-400 shrink-0">{SCOPE_LABEL[r.scope] || r.scope}</span>
                <span className="ml-auto text-[11px] text-gray-500 shrink-0">
                  v{r.version} · {r.approved_by === 'baseline' ? 'baseline' : r.approved_by}
                </span>
                {r.editable && dc && (
                  <button onClick={() => setEditing(editing === r.id ? null : r.id)} data-change={r.key}
                    className="inline-flex items-center gap-1 px-2 py-0.5 border border-gray-300 rounded-md text-[11px] text-gray-700 hover:bg-gray-50 shrink-0">
                    <Pencil size={11} /> Change
                  </button>
                )}
                {r.status === 'rejected' && (
                  <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold shrink-0" title={r.rejected_reason || ''}>
                    denied
                  </span>
                )}
              </li>
            )).flatMap((li, i) => (editing === settled[i].id
              ? [li, <li key={`${settled[i].id}-edit`} className="px-4 py-3"><ProposeForm row={settled[i]} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} /></li>]
              : [li]))}
          </ul>
        </div>
      )}
    </div>
  );
}
