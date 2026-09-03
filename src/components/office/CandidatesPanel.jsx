import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Search, Plus, X, Phone, Mail, UserPlus, Trash2, Pencil, StickyNote, Upload, Paperclip, FileText, Tag } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';
import { CustomFields, CustomFieldValues } from '../common/CustomFields.jsx';
import ImportPanel from '../common/ImportPanel.jsx';

// People we would like to work with, when the timing is right.
//
// "Who first, then where." This is a list of PEOPLE, not of vacancies — the
// plant hires rarely, so the thing worth keeping is the memory of somebody good
// and who vouched for them, not a pipeline. Deliberately not a CRM: no stages,
// no reminders, no email, nothing that has to be fed to stay useful.
//
// It replaces a Monday board of seven rows, and the shape of those seven rows
// is the whole specification. Five of them have no email. Two are a first name
// and a phone number. The most valuable column is Notes, because it holds
// "Reina's previous coworker" — which is how somebody is actually remembered.

const TONE = {
  prospect:    'bg-blue-100 text-blue-800',
  keep_warm:   'bg-green-100 text-green-800',
  not_a_fit:   'bg-gray-100 text-gray-600',
  hired:       'bg-purple-100 text-purple-800',
  unavailable: 'bg-amber-100 text-amber-800',
};

function StatusChip({ status, statuses }) {
  const s = statuses.find(x => x.value === status);
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${TONE[status] || TONE.prospect}`}>
      {s?.label || status}
    </span>
  );
}

// A TAG IS A CATEGORY SOMEBODY CAN BE CALLED FROM — a team, or Temp / 1099.
// The suggestions are the plant's own teams plus that pool; anything else is
// typed in and kept as typed. Tags and areas are deliberately two fields:
// "who do we have for Kitting" is a filter, "cleaning/Maintenance, speaks
// Spanish" is a note about a person.
function TagPicker({ value, suggestions, onChange }) {
  const [typed, setTyped] = useState('');
  const has = (t) => value.some(v => v.toLowerCase() === t.toLowerCase());
  const toggle = (t) => onChange(has(t) ? value.filter(v => v.toLowerCase() !== t.toLowerCase()) : [...value, t]);
  const addTyped = () => {
    const t = typed.trim();
    if (t && !has(t)) onChange([...value, t]);
    setTyped('');
  };
  const extras = value.filter(v => !suggestions.some(s => s.toLowerCase() === v.toLowerCase()));
  return (
    <div data-tag-picker>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map(t => (
          <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={has(t)}
            className={`px-2 py-1 rounded-full text-xs font-medium border ${has(t)
              ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-700 border-gray-300 hover:border-powder-400'}`}>
            {t}
          </button>
        ))}
        {extras.map(t => (
          <button key={t} type="button" onClick={() => toggle(t)} aria-pressed
            className="px-2 py-1 rounded-full text-xs font-medium border bg-powder-600 text-white border-powder-600">
            {t} <X size={11} className="inline -mt-0.5" />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <input value={typed} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder="Another tag…" className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm w-44" />
        <button type="button" onClick={addTyped} disabled={!typed.trim()}
          className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium disabled:opacity-40">Add</button>
      </div>
    </div>
  );
}

// A résumé, a certificate, a reference letter. Kept with the person rather
// than in somebody's Downloads folder, and deleted with them.
function Files({ c, storageEnabled, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const files = c.files || [];
  const add = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const fd = new FormData();
    for (const f of picked) fd.append('files', f);
    setBusy(true); setError('');
    try { await apiUpload(`/candidates/${c.id}/files`, fd); onChanged(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const open = async (f) => {
    try {
      const { url } = await apiFetch(`/candidates/files/${f.id}/url`);
      if (url) window.open(url, '_blank');
    } catch (err) { setError(err.message); }
  };
  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.filename}?`)) return;
    try { await apiFetch(`/candidates/files/${f.id}`, { method: 'DELETE' }); onChanged(); }
    catch (err) { setError(err.message); }
  };
  if (!files.length && !storageEnabled) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-candidate-files>
      {files.map(f => (
        <span key={f.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg border border-gray-200 text-xs">
          <button type="button" onClick={() => open(f)} className="text-powder-700 hover:underline flex items-center gap-1 max-w-[14rem]">
            <FileText size={11} className="shrink-0" /><span className="truncate">{f.filename}</span>
          </button>
          <button type="button" onClick={() => remove(f)} title="Remove file" className="text-gray-400 hover:text-red-600 p-0.5">
            <X size={11} />
          </button>
        </span>
      ))}
      {storageEnabled && (
        <label className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed text-xs cursor-pointer ${busy ? 'text-gray-400 border-gray-200' : 'text-gray-600 border-gray-300 hover:border-powder-400'}`}>
          <Paperclip size={11} /> {busy ? 'Uploading…' : files.length ? 'Add file' : 'Attach résumé or file'}
          <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf,image/*" onChange={add} disabled={busy} className="hidden" />
        </label>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function Form({ initial, statuses, areaSuggestions, tagSuggestions, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({
    name: '', title: '', company: '', phone: '', email: '', referred_by: '',
    interviewed_on: '', last_contacted_on: '', status: 'prospect', notes: '',
    ...(initial || {}),
    areas: (initial?.areas || []).join(', '),
    tags: initial?.tags || [],
    custom_data: initial?.custom_data || {},
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) { setError('A name is needed — everything else can come later.'); return; }
    setBusy(true); setError('');
    try {
      const body = { ...f, areas: f.areas };
      const saved = initial?.id ? await apiPut(`/candidates/${initial.id}`, body) : await apiPost('/candidates', body);
      onSaved(saved);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="block text-xs font-medium text-gray-600 mb-1">Name *</span>
          {/* The only required field. Two of the seven rows this replaces are a
              first name and a phone number, and those are real entries. */}
          <input className={input} value={f.name} onChange={set('name')} autoFocus
            placeholder="First name is enough" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">What they do now</span>
          <input className={input} value={f.title || ''} onChange={set('title')} placeholder="QC Tech, Warehouse Lead…" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Where</span>
          <input className={input} value={f.company || ''} onChange={set('company')} placeholder="Nutricost, unemployed…" />
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-xs font-medium text-gray-600 mb-1">Areas they&rsquo;d fit</span>
          <input className={input} value={f.areas} onChange={set('areas')}
            placeholder="QA, Kitting — separate with commas" list="candidate-areas" />
          <datalist id="candidate-areas">
            {areaSuggestions.map(a => <option key={a.name} value={a.name} />)}
          </datalist>
          <span className="block text-[11px] text-gray-400 mt-1">
            Type anything. Somebody who fits Cleaning and Maintenance gets both, so they turn up under either.
          </span>
        </label>
        <div className="block sm:col-span-2">
          <span className="block text-xs font-medium text-gray-600 mb-1">Tags</span>
          <TagPicker value={f.tags} suggestions={tagSuggestions} onChange={(tags) => setF(s => ({ ...s, tags }))} />
          <span className="block text-[11px] text-gray-400 mt-1">
            The team they could be called for, or Temp / 1099 for someone we bring in as needed. Filterable on the board.
          </span>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Phone</span>
          <input className={input} value={f.phone || ''} onChange={set('phone')} inputMode="tel" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Email</span>
          <input className={input} value={f.email || ''} onChange={set('email')} inputMode="email" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Who told us about them</span>
          <input className={input} value={f.referred_by || ''} onChange={set('referred_by')} placeholder="Romina, Reina…" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Status</span>
          <select className={input} value={f.status} onChange={set('status')}>
            {statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span className="block text-[11px] text-gray-400 mt-1">
            {statuses.find(s => s.value === f.status)?.hint}
          </span>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Interviewed on</span>
          <input type="date" className={input} value={f.interviewed_on || ''} onChange={set('interviewed_on')} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Last spoke to them</span>
          <input type="date" className={input} value={f.last_contacted_on || ''} onChange={set('last_contacted_on')} />
        </label>
        <label className="block sm:col-span-2">
          <span className="block text-xs font-medium text-gray-600 mb-1">Notes</span>
          <textarea className={`${input} min-h-[5rem]`} value={f.notes || ''} onChange={set('notes')}
            placeholder="Experience, who they know, how they came to us…" />
        </label>
      </div>

      <CustomFields scope="candidate" values={f.custom_data}
        onChange={(cd) => setF(s => ({ ...s, custom_data: cd }))} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy}
          className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-40">
          {busy ? 'Saving…' : initial?.id ? 'Save changes' : 'Add to the list'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 text-sm font-medium">Cancel</button>
      </div>
    </form>
  );
}

function Card({ c, statuses, storageEnabled, onEdit, onDelete, onChanged }) {
  const [showNotes, setShowNotes] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
            {c.name}
            <StatusChip status={c.status} statuses={statuses} />
          </p>
          <p className="text-sm text-gray-500">
            {[c.title, c.company].filter(Boolean).join(' · ') || <span className="text-gray-400">No title on file</span>}
          </p>
          {(!!c.tags?.length || !!c.areas.length) && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {(c.tags || []).map(t => (
                <span key={`t-${t}`} className="px-1.5 py-0.5 rounded-full bg-powder-100 text-[11px] font-medium text-powder-800 inline-flex items-center gap-1" data-tag={t}>
                  <Tag size={10} /> {t}
                </span>
              ))}
              {c.areas.map(a => (
                <span key={a} className="px-1.5 py-0.5 rounded bg-gray-100 text-[11px] text-gray-600">{a}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" onClick={() => onEdit(c)} title="Edit"
            className="p-1.5 text-gray-400 hover:text-gray-700"><Pencil size={15} /></button>
          <button type="button" onClick={() => onDelete(c)} title="Remove from the list"
            className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>
        </div>
      </div>

      {/* Tappable, because this list exists to be acted on from a phone. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
        {c.phone && (
          <a href={`tel:${c.phone_digits}`} className="text-powder-700 flex items-center gap-1.5">
            <Phone size={13} />{c.phone_display}
          </a>
        )}
        {c.email && (
          <a href={`mailto:${c.email}`} className="text-powder-700 flex items-center gap-1.5 min-w-0">
            <Mail size={13} /><span className="truncate">{c.email}</span>
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-[11px] text-gray-500">
        {c.referred_by && <span>Referred by <span className="text-gray-700">{c.referred_by}</span></span>}
        {c.interviewed_on && <span>Interviewed {formatDate(c.interviewed_on)}</span>}
        {c.last_contacted_on && <span>Last spoke {formatDate(c.last_contacted_on)}</span>}
      </div>

      {c.notes && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowNotes(v => !v)}
            className="text-[11px] text-powder-600 font-medium flex items-center gap-1">
            <StickyNote size={12} /> {showNotes ? 'Hide notes' : 'Notes'}
          </button>
          {showNotes && <p className="text-sm text-gray-700 whitespace-pre-line mt-1.5">{c.notes}</p>}
        </div>
      )}
      <Files c={c} storageEnabled={storageEnabled} onChanged={onChanged} />
      <CustomFieldValues scope="candidate" data={c.custom_data} />
    </div>
  );
}

export default function CandidatesPanel() {
  const { user } = useAuth() || {};
  const [filters, setFilters] = useState({ q: '', status: '', area: '', tag: '' });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data: list, refresh } = useApiGet(`/candidates${query ? `?${query}` : ''}`, [query]);
  const { data: meta, refresh: refreshMeta } = useApiGet('/candidates/meta');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null);
  const rows = list || [];
  const statuses = meta?.statuses || [];

  const done = () => { setAdding(false); setEditing(null); refresh(); refreshMeta(); };

  const remove = async (c) => {
    if (!window.confirm(`Remove ${c.name} from the list? This deletes the entry — it is a contact, not a record we have to keep.`)) return;
    await apiFetch(`/candidates/${c.id}`, { method: 'DELETE' });
    done();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">People</h2>
          <p className="text-sm text-gray-500">
            Good people to remember for when the timing is right. Who first, then where.
          </p>
        </div>
        {!adding && !editing && (
          <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
            {/* The board lives in Monday until it does not. Re-importing the
                same export updates in place rather than doubling anybody, so
                this stays useful after the move, not just during it. */}
            {user?.role === 'admin' && (
              <button type="button" onClick={() => setImporting(v => !v)}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium flex items-center gap-1.5 hover:bg-gray-200">
                <Upload size={15} /> Import a list
              </button>
            )}
            <button type="button" onClick={() => setAdding(true)}
              className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
              <Plus size={15} /> Add someone
            </button>
          </div>
        )}
      </div>

      {importing && (
        <ImportPanel target="candidates" targetLabel="People"
          onDone={() => { setImporting(false); done(); }} />
      )}

      {(adding || editing) && (
        <Form initial={editing} statuses={statuses} areaSuggestions={meta?.areas || []}
          tagSuggestions={(meta?.tags || []).filter(t => t.suggested).map(t => t.name)}
          onSaved={done} onCancel={() => { setAdding(false); setEditing(null); }} />
      )}

      {/* Status counts double as the filter — the question is almost always
          "who are we keeping warm", and that should be one tap. */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setFilters(f => ({ ...f, status: '' }))}
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${!filters.status ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
          Everyone {meta?.total ? `· ${meta.total}` : ''}
        </button>
        {statuses.map(s => (
          <button key={s.value} type="button"
            onClick={() => setFilters(f => ({ ...f, status: f.status === s.value ? '' : s.value }))}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${filters.status === s.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
            {s.label} · {meta?.counts?.[s.value] ?? 0}
          </button>
        ))}
      </div>

      {/* Tags are the second filter row: "who do we have for Warehouse", "who
          can we call in as a temp". Every suggested tag is offered even at
          zero, so a team nobody is tagged for yet is still visibly a category. */}
      <div className="flex flex-wrap gap-1.5" data-tag-filters>
        {(meta?.tags || []).map(t => (
          <button key={t.name} type="button"
            onClick={() => setFilters(f => ({ ...f, tag: f.tag === t.name ? '' : t.name }))}
            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border inline-flex items-center gap-1 ${filters.tag === t.name
              ? 'bg-powder-600 text-white border-powder-600' : t.count ? 'bg-white text-gray-700 border-gray-300' : 'bg-white text-gray-400 border-gray-200'}`}>
            <Tag size={10} /> {t.name} · {t.count}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[13rem] flex-1">
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Search</label>
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="search" value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              placeholder="Name, company, phone, or anything in the notes…"
              className="w-full pl-8 pr-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-0.5">Area</label>
          <select value={filters.area} onChange={e => setFilters(f => ({ ...f, area: e.target.value }))}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Any</option>
            {(meta?.areas || []).map(a => <option key={a.name} value={a.name}>{a.name} ({a.count})</option>)}
          </select>
        </div>
        {(filters.q || filters.area || filters.status || filters.tag) && (
          <button type="button" onClick={() => setFilters({ q: '', status: '', area: '', tag: '' })}
            className="px-2.5 py-2 text-sm text-gray-500 flex items-center gap-1"><X size={14} /> Clear</button>
        )}
        <p className="w-full text-[11px] text-gray-500">{rows.length} {rows.length === 1 ? 'person' : 'people'}</p>
      </div>

      {rows.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
          <UserPlus size={22} className="mx-auto text-gray-300" />
          <p className="text-sm text-gray-500 mt-2">
            {filters.q || filters.area || filters.status || filters.tag
              ? 'Nobody matches that.'
              : 'Nobody on the list yet. Add the next good person you meet.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {rows.map(c => (
          <Card key={c.id} c={c} statuses={statuses} storageEnabled={!!meta?.storage_enabled}
            onEdit={setEditing} onDelete={remove} onChanged={() => { refresh(); refreshMeta(); }} />
        ))}
      </div>

      <p className="text-[11px] text-gray-400">
        Kept by the office. These are people&rsquo;s personal contact details — they are not a compliance
        record, and an entry can be removed outright when somebody asks.
        {user?.role === 'admin' ? ' Removals are recorded in the audit log.' : ''}
      </p>
    </div>
  );
}
