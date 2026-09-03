import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import {
  LifeBuoy, Phone, Users, Plus, Pencil, Trash2, X, ClipboardList, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import ModuleTabs from '../common/ModuleTabs.jsx';
import { useModuleTabs } from '../../lib/useModuleTabs.js';
import { formatDate } from '../../lib/datetime.js';
import { RecordCard, RecordCards } from '../common/RecordCards.jsx';

/**
 * Safety: the three controlled safety forms in one place.
 *
 * - FORM 501-01 V5 Crisis Management Contact List — a REFERENCE, rendered from
 *   the document's own list (never the roster; the police are not an account).
 * - Form 501-02 V1 Headcount Evacuation — one record per drill or evacuation.
 * - FORM 502-01 V1 First Aid Injury/Accident — a log, one row per injury.
 *
 * The definitions come from the server verbatim; changing a form's wording is
 * a Document Change Request, same as every other transcribed form.
 */

const inputCls = 'w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm';
const labelCls = 'text-[11px] font-medium text-gray-600';

function CrisisContacts({ form }) {
  if (!form) return null;
  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-red-50">
          <p className="font-bold text-red-900 flex items-center gap-2"><Phone size={16} /> {form.title}</p>
          <p className="text-xs text-red-800">{form.form_code} {form.revision} — the approved list. A change is a document revision.</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {form.contacts.map(c => (
            <li key={c.name} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-500">{c.title}</p>
              </div>
              {/* tel: so a phone dials it in one tap — this list exists for
                  the moment nobody wants to be typing a number. */}
              <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}
                className="text-sm font-bold text-powder-700 hover:underline shrink-0 tabular-nums">{c.phone}</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EvacuationForm({ form, initial, onClose, onSaved }) {
  const blank = () => (form?.work_areas || []).map(a => ({ area: a, total: '', accounted: '', reasons: [] }));
  const [rec, setRec] = useState(() => initial ? {
    ...initial, areas: initial.areas?.length ? initial.areas.map(a => ({ ...a, total: a.total ?? '', accounted: a.accounted ?? '', reasons: a.reasons || (a.reason ? [a.reason] : []) })) : blank(),
  } : { event_date: new Date().toISOString().slice(0, 10), event_time: '', is_drill: true, areas: blank(), notes: '', completed_by: '' });
  // The form says "circle ANY reason" — one evacuation can be a fire drill and
  // an earthquake drill at once, which is what the plant's April sheets record.
  const toggleReason = (i, code) => setRec(r => ({
    ...r,
    areas: r.areas.map((a, j) => {
      if (j !== i) return a;
      const have = a.reasons || [];
      return { ...a, reasons: have.includes(code) ? have.filter(c => c !== code) : [...have, code] };
    }),
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const setArea = (i, k, v) => setRec(r => ({ ...r, areas: r.areas.map((a, j) => j === i ? { ...a, [k]: v } : a) }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = { ...rec, areas: rec.areas.map(a => ({ ...a, total: a.total === '' ? null : Number(a.total), accounted: a.accounted === '' ? null : Number(a.accounted), reasons: a.reasons || [] })) };
      if (initial?.id) await apiPut(`/safety/evacuations/${initial.id}`, payload);
      else await apiPost('/safety/evacuations', payload);
      onSaved();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white border-2 border-powder-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-gray-900">{initial?.id ? 'Correct evacuation record' : 'File an evacuation headcount'}</p>
          <p className="text-xs text-gray-500">{form?.form_code} {form?.revision}</p>
        </div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      {/* The paper's own instruction, so the sheet reads the same on a phone
          at the evacuation site as it does on the clipboard. */}
      <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2">{form?.instruction}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block"><span className={labelCls}>Date</span>
          <input type="date" value={rec.event_date} onChange={e => setRec(r => ({ ...r, event_date: e.target.value }))} className={inputCls} /></label>
        <label className="block"><span className={labelCls}>Time</span>
          <input type="time" value={rec.event_time || ''} onChange={e => setRec(r => ({ ...r, event_time: e.target.value }))} className={inputCls} /></label>
        <label className="block"><span className={labelCls}>Kind</span>
          <select value={rec.is_drill ? '1' : '0'} onChange={e => setRec(r => ({ ...r, is_drill: e.target.value === '1' }))} className={inputCls}>
            <option value="1">Drill</option>
            <option value="0">Real evacuation</option>
          </select></label>
        <label className="block"><span className={labelCls}>Completed by</span>
          <input value={rec.completed_by || ''} onChange={e => setRec(r => ({ ...r, completed_by: e.target.value }))} className={inputCls} /></label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[540px]">
          <thead>
            <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
              <th className="text-left py-1 pr-2">Work Area</th>
              <th className="text-left py-1 pr-2 w-32">In work area</th>
              <th className="text-left py-1 pr-2 w-32">Accounted for</th>
              <th className="text-left py-1">Evacuation reason</th>
            </tr>
          </thead>
          <tbody>
            {rec.areas.map((a, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="py-1.5 pr-2">
                  <input value={a.area} onChange={e => setArea(i, 'area', e.target.value)} className={inputCls} />
                </td>
                <td className="py-1.5 pr-2">
                  <input type="number" min="0" value={a.total} onChange={e => setArea(i, 'total', e.target.value)} className={inputCls} />
                </td>
                <td className="py-1.5 pr-2">
                  <input type="number" min="0" value={a.accounted} onChange={e => setArea(i, 'accounted', e.target.value)} className={inputCls} />
                </td>
                <td className="py-1.5">
                  {/* The paper's circled letter. */}
                  <div className="flex gap-1">
                    {Object.entries(form?.reasons || {}).map(([code, label]) => (
                      <button key={code} type="button" title={label}
                        onClick={() => toggleReason(i, code)}
                        className={`w-8 h-8 rounded-full border text-xs font-bold ${(a.reasons || []).includes(code)
                          ? 'bg-red-600 text-white border-red-600' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                        {code}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setRec(r => ({ ...r, areas: [...r.areas, { area: '', total: '', accounted: '', reasons: [] }] }))}
        className="text-xs font-medium text-powder-700 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add a row</button>
      <p className="text-[11px] text-gray-500">
        {Object.entries(form?.reasons || {}).map(([c, l]) => `${c}=${l}`).join(' · ')}
      </p>

      <label className="block"><span className={labelCls}>Notes</span>
        <textarea rows={2} value={rec.notes || ''} onChange={e => setRec(r => ({ ...r, notes: e.target.value }))} className={inputCls} /></label>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving}
          className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Save headcount'}
        </button>
        <button type="button" onClick={onClose} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
  );
}

function Evacuations({ form, user }) {
  const { data: rows, refresh } = useApiGet('/safety/evacuations');
  const [editing, setEditing] = useState(null); // null | {} | record
  const isAdmin = user?.role === 'admin';

  const remove = async (id) => {
    if (!window.confirm('Delete this evacuation record?')) return;
    await apiFetch(`/safety/evacuations/${id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-3">
      {!editing && (
        <button type="button" onClick={() => setEditing({})}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium">
          <Plus size={14} /> File an evacuation headcount
        </button>
      )}
      {editing && (
        <EvacuationForm form={form} initial={editing.id ? editing : null}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
      {!rows ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No evacuation records yet. The next drill files the first one.</p>
      ) : rows.map(r => (
        <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-gray-900 flex items-center gap-2">
                {formatDate(r.event_date)}{r.event_time ? ` · ${r.event_time}` : ''}
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${r.is_drill ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                  {r.is_drill ? 'Drill' : 'Real evacuation'}
                </span>
                {r.unaccounted > 0 ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 inline-flex items-center gap-1">
                    <AlertTriangle size={11} /> {r.unaccounted} unaccounted
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-800 inline-flex items-center gap-1">
                    <CheckCircle2 size={11} /> All accounted for
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500">
                {r.total_accounted} of {r.total_in_areas} accounted · completed by {r.completed_by || r.created_by}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button type="button" onClick={() => setEditing(r)} className="p-1.5 text-gray-400 hover:text-powder-700"><Pencil size={15} /></button>
              {isAdmin && <button type="button" onClick={() => remove(r.id)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={15} /></button>}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {(r.areas || []).filter(a => a.total != null || a.accounted != null || (a.reasons || []).length).map((a, i) => (
              <span key={i} className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">{a.area}</span>
                {' '}{a.accounted ?? '—'}/{a.total ?? '—'}
                {(a.reasons || []).length ? (
                  <span className="ml-1 text-red-700 font-semibold">
                    ({(a.reasons || []).map(c => `${c}=${form?.reasons?.[c] || c}`).join(', ')})
                  </span>
                ) : ''}
              </span>
            ))}
          </div>
          {r.notes && <p className="text-xs text-gray-500 mt-1.5 whitespace-pre-line">{r.notes}</p>}
        </div>
      ))}
    </div>
  );
}

function FirstAidLog({ form, user }) {
  const { data: rows, refresh } = useApiGet('/safety/first-aid');
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const isAdmin = user?.role === 'admin';

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (rows || []).filter(r => !s || [r.employee_name, r.injury_description, r.explanation].some(v => v && v.toLowerCase().includes(s)));
  }, [rows, q]);

  const blank = { employee_name: '', injury_date: new Date().toISOString().slice(0, 10), injury_description: '', explanation: '', supervisor_name: '', supervisor_date: '' };

  const save = async (rec) => {
    if (rec.id) await apiPut(`/safety/first-aid/${rec.id}`, rec);
    else await apiPost('/safety/first-aid', rec);
    setEditing(null); refresh();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this injury record?')) return;
    await apiFetch(`/safety/first-aid/${id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {!editing && (
          <button type="button" onClick={() => setEditing({ ...blank })}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium">
            <Plus size={14} /> Record an injury
          </button>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm sm:ml-auto" />
      </div>

      {editing && (
        <FirstAidForm form={form} rec={editing} onChange={setEditing} onSave={save} onClose={() => setEditing(null)} />
      )}

      {!rows ? <p className="text-sm text-gray-400">Loading…</p> : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">{q ? 'Nothing matches.' : 'No injuries recorded.'}</p>
      ) : (
        <>
        <RecordCards>
          {filtered.map(r => {
            const col = (k) => form?.columns?.find(c => c.key === k)?.label || k;
            return (
              <RecordCard key={r.id} title={r.employee_name} subtitle={formatDate(r.injury_date)}
                fields={[
                  { label: col('injury_description'), value: r.injury_description, wide: true },
                  { label: col('explanation'), value: r.explanation, wide: true },
                  { label: col('supervisor_name'), value: r.supervisor_name ? `${r.supervisor_name}${r.supervisor_date ? ` · ${formatDate(r.supervisor_date)}` : ''}` : null, wide: true },
                ]}
                actions={<>
                  <button type="button" onClick={() => setEditing(r)} className="text-xs text-gray-500 hover:text-powder-700 inline-flex items-center gap-1"><Pencil size={13} /> Edit</button>
                  {isAdmin && <button type="button" onClick={() => remove(r.id)} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><Trash2 size={13} /> Delete</button>}
                </>} />
            );
          })}
        </RecordCards>
        <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[11px] text-gray-500 uppercase tracking-wide border-b border-gray-200">
                {form?.columns?.map(c => <th key={c.key} className="text-left px-3 py-2">{c.label}</th>)}
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.employee_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.injury_date)}</td>
                  <td className="px-3 py-2 text-gray-700">{r.injury_description || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{r.explanation || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.supervisor_name || '—'}{r.supervisor_date ? ` · ${formatDate(r.supervisor_date)}` : ''}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(r)} className="p-1 text-gray-400 hover:text-powder-700"><Pencil size={14} /></button>
                      {isAdmin && <button type="button" onClick={() => remove(r.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function FirstAidForm({ form, rec, onChange, onSave, onClose }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => onChange({ ...rec, [k]: v });
  const submit = async () => {
    setSaving(true); setError('');
    try { await onSave(rec); } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  return (
    <div className="bg-white border-2 border-powder-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-gray-900">{rec.id ? 'Correct injury record' : form?.title}</p>
          <p className="text-xs text-gray-500">{form?.form_code} {form?.revision}</p>
        </div>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block"><span className={labelCls}>Name of Employee</span>
          <input value={rec.employee_name || ''} onChange={e => set('employee_name', e.target.value)} className={inputCls} /></label>
        <label className="block"><span className={labelCls}>Date of Injury</span>
          <input type="date" value={rec.injury_date || ''} onChange={e => set('injury_date', e.target.value)} className={inputCls} /></label>
        <label className="block sm:col-span-2"><span className={labelCls}>Location and Description of Injury</span>
          <textarea rows={2} value={rec.injury_description || ''} onChange={e => set('injury_description', e.target.value)} className={inputCls} /></label>
        <label className="block sm:col-span-2"><span className={labelCls}>Explain why and how it happened</span>
          <textarea rows={2} value={rec.explanation || ''} onChange={e => set('explanation', e.target.value)} className={inputCls} /></label>
        <label className="block"><span className={labelCls}>Supervisor Name</span>
          <input value={rec.supervisor_name || ''} onChange={e => set('supervisor_name', e.target.value)} className={inputCls} /></label>
        <label className="block"><span className={labelCls}>Supervisor Date</span>
          <input type="date" value={rec.supervisor_date || ''} onChange={e => set('supervisor_date', e.target.value)} className={inputCls} /></label>
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={saving || !rec.employee_name || !rec.injury_date}
          className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
      </div>
    </div>
  );
}

export default function SafetyPanel({ user }) {
  const { data: forms } = useApiGet('/safety/forms');
  const TABS = useMemo(() => [
    { id: 'contacts', label: 'Crisis Contacts', icon: Phone },
    { id: 'evacuations', label: 'Evacuations', icon: Users },
    { id: 'first-aid', label: 'First Aid Log', icon: ClipboardList },
  ], []);
  const { tabs, tab, setTab } = useModuleTabs({ id: 'safety', tabs: TABS });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <LifeBuoy size={20} className="text-powder-600" />
        <h2 className="text-lg font-bold text-gray-900">Safety</h2>
      </div>
      <ModuleTabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'contacts' && <CrisisContacts form={forms?.crisis} />}
      {tab === 'evacuations' && <Evacuations form={forms?.evacuation} user={user} />}
      {tab === 'first-aid' && <FirstAidLog form={forms?.first_aid} user={user} />}
    </div>
  );
}
