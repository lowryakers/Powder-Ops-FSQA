// The Forms Master Index, maintained in the app.
//
// Document Control issues revisions, retires numbers and holds the finalised
// paper. All of that is editable here. What is NOT editable is how a form is
// matched to a task or a record — that decides which number is printed on a
// compliance record, and it stays in code where a typo cannot silently
// mis-number every brittle-plastic inspection.
//
// The gaps come first on the screen, above the list. A register that opens on a
// tidy table and buries the unmapped work underneath reads as "all good", which
// is the opposite of what it knows.

import { useState, useMemo } from 'react';
import { FileText, AlertTriangle, Search, CheckCircle2, Plus, Pencil, Paperclip, Trash2, Archive, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { useApiGet, apiPost, apiPut, apiDelete, apiFetch, apiUpload } from '../../hooks/useApi';
import { useTableSort } from '../../lib/useTableSort';
import SortHeader from '../common/SortHeader.jsx';
import RuleTip from '../common/RuleTip.jsx';

const WHERE = {
  readydoc: { label: 'In ReadyDoc', cls: 'bg-green-100 text-green-800' },
  keychain: { label: 'Keychain', cls: 'bg-blue-100 text-blue-800' },
  paper: { label: 'On paper', cls: 'bg-amber-100 text-amber-800' },
  retired: { label: 'Retired', cls: 'bg-gray-100 text-gray-500' },
};

const FILTERS = [
  { id: 'all', label: 'All forms' },
  { id: 'readydoc', label: 'In ReadyDoc' },
  { id: 'keychain', label: 'Keychain' },
  { id: 'paper', label: 'On paper' },
  { id: 'retired', label: 'Retired' },
];

const COLUMNS = [
  { key: 'code', label: 'Form', type: 'text' },
  { key: 'revision', label: 'Rev', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'where', label: 'Where', type: 'text' },
  { key: 'filename', label: 'Paper copy', type: 'text' },
  { label: '' },
];

function FormModal({ form, onClose, onSaved }) {
  const isNew = !form?.id;
  const [f, setF] = useState({
    code: form?.code || '', revision: form?.revision || '', title: form?.title || '',
    where: form?.where || 'readydoc', note: form?.note || '', owner: form?.owner || '',
    effective_date: form?.effective_date || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = isNew ? await apiPost('/forms', f) : await apiPut(`/forms/${form.id}`, f);
      onSaved(r?.warning || null);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-3">
        <h3 className="font-semibold text-gray-900">{isNew ? 'Issue a form number' : `Edit ${form.code}`}</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Form number</label>
            <input required value={f.code} onChange={e => setF({ ...f, code: e.target.value })}
              disabled={!isNew} placeholder="FORM 431-02"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-500" />
            {!isNew && (
              // Renaming the identity would orphan every record filed under the
              // old number. Document Control issues the new one and retires this.
              <p className="text-[11px] text-gray-400 mt-1">
                A number can&rsquo;t be changed. <RuleTip id="form.number-immutable" label="Why?" />
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Revision</label>
            <input value={f.revision} onChange={e => setF({ ...f, revision: e.target.value })}
              disabled={form?.revision_locked} placeholder="V4"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 disabled:text-gray-500" />
            {form?.revision_locked && (
              <p className="text-[11px] text-gray-400 mt-1">
                Set by this scale&rsquo;s weights. <RuleTip id="form.scale-revision-locked" label="Why?" />
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
          <input required value={f.title} onChange={e => setF({ ...f, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Where it&rsquo;s worked</label>
            <select value={f.where} onChange={e => setF({ ...f, where: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {FILTERS.slice(1).map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Effective date</label>
            <input type="date" value={f.effective_date} onChange={e => setF({ ...f, effective_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Owner</label>
          <input value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })}
            placeholder="Document Control" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Note</label>
          <textarea rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-60">
            {busy ? 'Saving…' : isNew ? 'Issue form' : 'Save'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function FileCell({ form, canEdit, storageOn, onChanged }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    try {
      const { url } = await apiFetch(`/forms/${form.id}/file`);
      if (url) window.open(url, '_blank');
    } catch (e) { window.alert(e.message); }
  };
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('files', file);
      await apiUpload(`/forms/${form.id}/file`, fd);
      onChanged();
    } catch (err) { window.alert(err.message); }
    finally { setBusy(false); e.target.value = ''; }
  };

  if (form.has_file) {
    return (
      <span className="flex items-center gap-1.5">
        <button type="button" onClick={open} className="inline-flex items-center gap-1 text-xs text-powder-600 hover:underline max-w-[12rem] truncate">
          <ExternalLink size={11} className="shrink-0" /> {form.filename}
        </button>
        {canEdit && (
          <button type="button" title="Remove the file"
            onClick={async () => {
              if (!window.confirm(`Remove ${form.filename} from ${form.code}?`)) return;
              try { await apiDelete(`/forms/${form.id}/file`); onChanged(); } catch (err) { window.alert(err.message); }
            }}
            className="p-1 text-gray-300 hover:text-red-600"><Trash2 size={12} /></button>
        )}
      </span>
    );
  }
  if (!canEdit) return <span className="text-xs text-gray-400">—</span>;
  if (!storageOn) return <span className="text-xs text-gray-400" title="File storage is not configured">—</span>;
  return (
    <label className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-powder-600 cursor-pointer">
      <Paperclip size={11} /> {busy ? 'Uploading…' : 'Attach'}
      <input type="file" className="hidden" onChange={upload} disabled={busy} />
    </label>
  );
}

// The coverage gaps, as something you can work rather than read.
//
// It listed ninety-seven lines and offered nothing to do about them, which is
// how a useful report becomes wallpaper. Most of those are equipment PMs —
// servicing a scale answers to no controlled form — so the list starts
// COLLAPSED with a count, groups by what the items are, and every row can be
// marked as needing no number (with a reason) or handed a form number.
function GapsPanel({ schedules, areas, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(null);

  const items = [
    ...schedules.map(s => ({ kind: 'schedule', subject: s.title, label: s.title, meta: s.task_group, ...s })),
    ...areas.map(a => ({ kind: 'record_area', subject: a.area, label: a.area, meta: `${a.count} filed`, ...a })),
  ];
  const live = items.filter(i => !i.dismissed);
  const done = items.filter(i => i.dismissed);

  // Equipment PMs are the bulk of it and are one decision, not ninety — so they
  // are grouped and can be cleared together.
  const isPM = (i) => i.kind === 'schedule' && /\bPM\b/i.test(i.label);
  const pms = live.filter(isPM);
  const rest = live.filter(i => !isPM(i));

  const act = async (path, body) => {
    setBusy(body.subject || 'bulk');
    try { await apiPost(path, body); onChanged(); }
    catch (e) { window.alert(e.message); }
    finally { setBusy(null); }
  };

  const dismiss = async (item) => {
    const reason = window.prompt(`Why does "${item.label}" need no form number?`,
      isPM(item) ? 'Equipment servicing — not a numbered controlled form.' : '');
    if (!reason?.trim()) return;
    await act('/forms/gaps/dismiss', { kind: item.kind, subject: item.subject, reason: reason.trim() });
  };

  const dismissAllPms = async () => {
    const reason = window.prompt(
      `Mark all ${pms.length} equipment PM schedules as needing no form number?\n\nWhy:`,
      'Equipment servicing — not a numbered controlled form.');
    if (!reason?.trim()) return;
    setBusy('bulk');
    try {
      // Sequential rather than parallel: this writes a decision per row and a
      // half-applied burst is worse than a slightly slower one.
      for (const p of pms) await apiPost('/forms/gaps/dismiss', { kind: p.kind, subject: p.subject, reason: reason.trim() });
      onChanged();
    } catch (e) { window.alert(e.message); }
    finally { setBusy(null); }
  };

  const Row = ({ i }) => (
    <li className="flex items-start justify-between gap-3 py-1.5 border-b border-amber-100 last:border-0">
      <span className="text-xs text-amber-900 min-w-0">
        <span className="font-medium">{i.kind === 'schedule' ? 'Schedule' : 'Records'}</span> · {i.label}
        <span className="text-amber-700"> ({i.meta})</span>
        {i.dismissed && <span className="block text-[11px] text-gray-500 mt-0.5">No form needed — {i.reason} · {i.dismissed_by}</span>}
      </span>
      {canEdit && (
        i.dismissed ? (
          <button type="button" disabled={busy === i.subject}
            onClick={() => act('/forms/gaps/restore', { kind: i.kind, subject: i.subject })}
            className="shrink-0 text-[11px] text-gray-500 hover:text-powder-600">Put back</button>
        ) : (
          <button type="button" disabled={busy === i.subject} onClick={() => dismiss(i)}
            className="shrink-0 text-[11px] text-amber-700 hover:text-amber-900 underline">Needs no form</button>
        )
      )}
    </li>
  );

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <AlertTriangle size={16} className="text-amber-600 shrink-0" />
        <span className="font-semibold text-amber-900 text-sm flex-1">
          {live.length
            ? `${live.length} live ${live.length === 1 ? 'item carries' : 'items carry'} no form number`
            : 'Every live item is either numbered or marked as needing no number'}
        </span>
        {open ? <ChevronUp size={16} className="text-amber-600" /> : <ChevronDown size={16} className="text-amber-600" />}
      </button>

      {open && (
        <div className="mt-2">
          <p className="text-xs text-amber-800">
            Running in ReadyDoc but mapping to nothing in the index, so their records show no form number.
            {' '}<RuleTip id="form.no-guess" label="Why no number?" />
          </p>

          {pms.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-semibold text-amber-900">
                  Equipment PM schedules ({pms.length})
                </p>
                {canEdit && (
                  <button type="button" onClick={dismissAllPms} disabled={busy === 'bulk'}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-60">
                    {busy === 'bulk' ? 'Clearing…' : `Mark all ${pms.length} as needing no form`}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Servicing a machine is maintenance, not a numbered inspection — these usually answer to no form.
              </p>
              <ul className="mt-1.5 max-h-56 overflow-y-auto">{pms.map(i => <Row key={i.subject} i={i} />)}</ul>
            </div>
          )}

          {rest.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-amber-900">Everything else ({rest.length})</p>
              <ul className="mt-1.5">{rest.map(i => <Row key={i.subject} i={i} />)}</ul>
            </div>
          )}

          {done.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowDone(v => !v)} className="text-[11px] text-gray-600 hover:text-gray-800 underline">
                {showDone ? 'Hide' : 'Show'} {done.length} marked as needing no form
              </button>
              {showDone && <ul className="mt-1.5">{done.map(i => <Row key={i.subject} i={i} />)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FormRegistryPanel() {
  const { data, loading, error, refresh } = useApiGet('/forms');
  const [where, setWhere] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  const forms = useMemo(() => data?.forms || [], [data]);
  const canEdit = !!data?.can_edit;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return forms.filter(f => {
      if (where !== 'all' && f.where !== where) return false;
      if (!needle) return true;
      return [f.code, f.title, f.revision, f.note, f.owner, f.filename]
        .some(v => v && String(v).toLowerCase().includes(needle));
    });
  }, [forms, where, q]);

  const { sorted, sortCol, sortDir, toggleSort } = useTableSort(filtered, COLUMNS, 'code');

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading the form register…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Could not load the form register: {String(error.message || error)}</div>;

  const unmappedSchedules = data?.unmapped?.schedules || [];
  const unmappedAreas = data?.unmapped?.record_areas || [];
  const disagreements = data?.disagreements || [];
  // Dismissed gaps are not "outstanding" — they are decided. Counting them
  // would keep the header shouting about work somebody has already dealt with.
  const live = (rows) => rows.filter(r => !r.dismissed);
  const gaps = live(unmappedSchedules).length + live(unmappedAreas).length;
  const dismissedCount = (unmappedSchedules.length + unmappedAreas.length) - gaps;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText size={20} className="text-powder-600" /> Form Registry
          </h2>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            The Forms Master Index. Revisions, where each form is worked and the finalised paper copy are
            maintained here. <RuleTip id="form.matching-in-code" label="Where do form numbers come from?" />
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing({})}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 sm:shrink-0">
            <Plus size={15} /> Issue a form
          </button>
        )}
      </div>

      {notice && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-start justify-between gap-2">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-700 shrink-0">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FILTERS.slice(1).map(f => (
          <button key={f.id} type="button" onClick={() => setWhere(f.id)}
            className={`text-left bg-white rounded-xl border p-3 ${where === f.id ? 'border-powder-500 ring-1 ring-powder-200' : 'border-gray-200'}`}>
            <p className="text-2xl font-bold text-gray-900">{data?.counts?.[f.id] || 0}</p>
            <p className="text-xs text-gray-500">{f.label}</p>
          </button>
        ))}
      </div>

      {(gaps > 0 || dismissedCount > 0) && (
        <GapsPanel schedules={unmappedSchedules} areas={unmappedAreas} canEdit={canEdit} onChanged={refresh} />
      )}

      {disagreements.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-900 flex items-center gap-2 text-sm">
            <AlertTriangle size={16} /> {disagreements.length} form {disagreements.length === 1 ? 'number differs' : 'numbers differ'} between the app and this index
          </h3>
          <ul className="mt-2 space-y-1">
            {disagreements.map(d => (
              <li key={d.record_type} className="text-xs text-red-900">
                <span className="font-medium">{d.label}</span> — the record form says
                <span className="font-mono"> {d.in_app}</span>, the index says<span className="font-mono"> {d.in_registry}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-red-800 mt-2">
            The number on a record form is a controlled change, so neither has been altered.
          </p>
        </div>
      )}

      {gaps === 0 && disagreements.length === 0 && data?.mapped && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-700" />
          <p className="text-sm text-green-900">Every active schedule and record area maps to a form in the index.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number, title, owner, file…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button key={f.id} type="button" onClick={() => setWhere(f.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${where === f.id ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards below md, table above — the same rule the roster and Partner
          Reconciliation follow, so a seven-column table never has to be
          dragged sideways on a phone. */}
      <div className="md:hidden space-y-2">
        {sorted.map(f => (
          <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-gray-900">{f.code} {f.revision || ''}</p>
                <p className="text-sm text-gray-800 mt-0.5">{f.title}</p>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium ${WHERE[f.where]?.cls}`}>
                {WHERE[f.where]?.label || f.where}
              </span>
            </div>
            {f.note && <p className="text-xs text-gray-500 mt-1">{f.note}</p>}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <FileCell form={f} canEdit={canEdit} storageOn={data?.storage_enabled} onChanged={refresh} />
              {canEdit && (
                <button onClick={() => setEditing(f)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-powder-600">
                  <Pencil size={11} /> Edit
                </button>
              )}
            </div>
          </div>
        ))}
        {!sorted.length && <p className="bg-white rounded-xl border border-gray-200 px-3 py-8 text-center text-sm text-gray-500">No forms match.</p>}
      </div>

      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                {COLUMNS.map((c, i) => (
                  <SortHeader key={c.key || `x${i}`} col={c} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(f => (
                <tr key={f.id} className="align-top">
                  <td className="px-4 py-2 font-mono text-xs font-medium text-gray-900 whitespace-nowrap">{f.code}</td>
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{f.revision || '—'}</td>
                  <td className="px-4 py-2">
                    <p className="text-gray-900">{f.title}</p>
                    {f.note && <p className="text-xs text-gray-500 mt-0.5">{f.note}</p>}
                    {f.owner && <p className="text-[11px] text-gray-400 mt-0.5">Owner: {f.owner}</p>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${WHERE[f.where]?.cls}`}>
                      {WHERE[f.where]?.label || f.where}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <FileCell form={f} canEdit={canEdit} storageOn={data?.storage_enabled} onChanged={refresh} />
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-right">
                    {canEdit && (
                      <>
                        <button onClick={() => setEditing(f)} className="p-1 text-gray-400 hover:text-powder-600" title="Edit"><Pencil size={13} /></button>
                        {f.where !== 'retired' && (
                          <button title="Retire this form"
                            onClick={async () => {
                              if (!window.confirm(`Retire ${f.code}?\n\nIt stays in the index and its number is never reissued, so records filed under it still resolve. It drops out of the active list.`)) return;
                              try { await apiDelete(`/forms/${f.id}`); refresh(); } catch (e) { window.alert(e.message); }
                            }}
                            className="ml-1 p-1 text-gray-300 hover:text-amber-600"><Archive size={13} /></button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr><td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-sm text-gray-500">No forms match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">Showing {sorted.length} of {forms.length}.</p>

      {editing && (
        <FormModal form={editing} onClose={() => setEditing(null)}
          onSaved={(warning) => { setEditing(null); setNotice(warning); refresh(); }} />
      )}
    </div>
  );
}
