// The Forms Master Index, in the app — and what it does and does not cover.
//
// Document Control keeps this index in a spreadsheet, and the consultant's ask
// was that it live with the controlled documents. But re-typing a spreadsheet
// into a screen adds nothing: they already have the spreadsheet. What the app
// can say that the spreadsheet cannot is WHERE EACH FORM IS WORKED and WHICH
// LIVE WORK ANSWERS TO NO FORM AT ALL — the second one being exactly what an
// auditor finds by pointing at a task.
//
// Read-only, deliberately and completely. A form number is issued by Document
// Control through a change request; a screen that let someone retype one would
// be a second register competing with the controlled one.

import { useState } from 'react';
import { FileText, AlertTriangle, Search, CheckCircle2 } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

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

export default function FormRegistryPanel() {
  const { data, loading, error } = useApiGet('/forms');
  const [where, setWhere] = useState('all');
  const [q, setQ] = useState('');

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading the form registry…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Could not load the form registry: {String(error.message || error)}</div>;

  const forms = data?.forms || [];
  const needle = q.trim().toLowerCase();
  const shown = forms.filter(f => {
    if (where !== 'all' && f.where !== where) return false;
    if (!needle) return true;
    return [f.code, f.title, f.revision].some(v => v && String(v).toLowerCase().includes(needle));
  });

  const unmappedSchedules = data?.unmapped?.schedules || [];
  const unmappedAreas = data?.unmapped?.record_areas || [];
  const disagreements = data?.disagreements || [];
  const gaps = unmappedSchedules.length + unmappedAreas.length;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FileText size={20} className="text-powder-600" /> Form Registry
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          The Forms Master Index, and where each form is worked today. Numbers are issued by
          Document Control through a change request — this screen reports, it never edits.
        </p>
      </div>

      {/* The counts by where, as the first thing on the screen: "how much of
          the index is actually in the app" is the question this answers. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FILTERS.slice(1).map(f => (
          <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-2xl font-bold text-gray-900">{data?.counts?.[f.id] || 0}</p>
            <p className="text-xs text-gray-500">{f.label}</p>
          </div>
        ))}
      </div>

      {/* GAPS FIRST, above the list. A registry screen that opens on a tidy
          list of forms and buries the unmapped work below it is a screen that
          reads as "all good" — which is the opposite of what it knows. */}
      {gaps > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-semibold text-amber-900 flex items-center gap-2 text-sm">
            <AlertTriangle size={16} /> {gaps} live {gaps === 1 ? 'item carries' : 'items carry'} no form number
          </h3>
          <p className="text-xs text-amber-800 mt-1">
            These are running in ReadyDoc but map to nothing in the index, so their records show no
            form number. Either the index has a number for them that we could not read, or they are
            genuinely unnumbered — both are Document Control's call.
          </p>
          <ul className="mt-2 space-y-1">
            {unmappedSchedules.map(s => (
              <li key={`s-${s.title}`} className="text-xs text-amber-900">
                <span className="font-medium">Schedule</span> · {s.title}
                <span className="text-amber-700"> ({s.task_group})</span>
              </li>
            ))}
            {unmappedAreas.map(a => (
              <li key={`a-${a.area}`} className="text-xs text-amber-900">
                <span className="font-medium">Records</span> · {a.area}
                <span className="text-amber-700"> ({a.count} filed)</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Neither side is silently rewritten to match the other: the in-app
          value is gated by Controlled Changes, and only Document Control can
          say which number is right. */}
      {disagreements.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <h3 className="font-semibold text-red-900 flex items-center gap-2 text-sm">
            <AlertTriangle size={16} /> {disagreements.length} form {disagreements.length === 1 ? 'number differs' : 'numbers differ'} between the app and this index
          </h3>
          <ul className="mt-2 space-y-1">
            {disagreements.map(d => (
              <li key={d.record_type} className="text-xs text-red-900">
                <span className="font-medium">{d.label}</span> — the record form says
                <span className="font-mono"> {d.in_app}</span>, the index says
                <span className="font-mono"> {d.in_registry}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-red-800 mt-2">
            Changing the number on a record form is a controlled change, so neither has been altered.
          </p>
        </div>
      )}

      {gaps === 0 && disagreements.length === 0 && data?.mapped && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-700" />
          <p className="text-sm text-green-900">
            Every active schedule and record area maps to a form in the index.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number or title…"
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

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Form</th>
                <th className="text-left px-4 py-2">Rev</th>
                <th className="text-left px-4 py-2">Title</th>
                <th className="text-left px-4 py-2">Where</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map(f => (
                <tr key={f.code} className="align-top">
                  <td className="px-4 py-2 font-mono text-xs font-medium text-gray-900 whitespace-nowrap">{f.code}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{f.revision || '—'}</td>
                  <td className="px-4 py-2">
                    <p className="text-gray-900">{f.title}</p>
                    {f.note && <p className="text-xs text-gray-500 mt-0.5">{f.note}</p>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${WHERE[f.where]?.cls || 'bg-gray-100 text-gray-600'}`}>
                      {WHERE[f.where]?.label || f.where}
                    </span>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">No forms match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Showing {shown.length} of {forms.length}. Rows the Master Index carries that are not listed
        here could not be read from the copies supplied — send the index as a file and they can be added.
      </p>
    </div>
  );
}
