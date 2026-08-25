import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Search, Plus, X, Phone, Mail, UserPlus, Trash2, Pencil, StickyNote } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';
import { CustomFields, CustomFieldValues } from '../common/CustomFields.jsx';

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

function Form({ initial, statuses, areaSuggestions, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({
    name: '', title: '', company: '', phone: '', email: '', referred_by: '',
    interviewed_on: '', last_contacted_on: '', status: 'prospect', notes: '',
    ...(initial || {}),
    areas: (initial?.areas || []).join(', '),
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

function Card({ c, statuses, onEdit, onDelete }) {
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
          {!!c.areas.length && (
            <div className="flex flex-wrap gap-1 mt-1.5">
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
      <CustomFieldValues scope="candidate" data={c.custom_data} />
    </div>
  );
}

export default function CandidatesPanel() {
  const { user } = useAuth() || {};
  const [filters, setFilters] = useState({ q: '', status: '', area: '' });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const { data: list, refresh } = useApiGet(`/candidates${query ? `?${query}` : ''}`, [query]);
  const { data: meta, refresh: refreshMeta } = useApiGet('/candidates/meta');
  const [adding, setAdding] = useState(false);
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
          <button type="button" onClick={() => setAdding(true)}
            className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 sm:ml-auto">
            <Plus size={15} /> Add someone
          </button>
        )}
      </div>

      {(adding || editing) && (
        <Form initial={editing} statuses={statuses} areaSuggestions={meta?.areas || []}
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
        {(filters.q || filters.area || filters.status) && (
          <button type="button" onClick={() => setFilters({ q: '', status: '', area: '' })}
            className="px-2.5 py-2 text-sm text-gray-500 flex items-center gap-1"><X size={14} /> Clear</button>
        )}
        <p className="w-full text-[11px] text-gray-500">{rows.length} {rows.length === 1 ? 'person' : 'people'}</p>
      </div>

      {rows.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
          <UserPlus size={22} className="mx-auto text-gray-300" />
          <p className="text-sm text-gray-500 mt-2">
            {filters.q || filters.area || filters.status
              ? 'Nobody matches that.'
              : 'Nobody on the list yet. Add the next good person you meet.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {rows.map(c => (
          <Card key={c.id} c={c} statuses={statuses} onEdit={setEditing} onDelete={remove} />
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
