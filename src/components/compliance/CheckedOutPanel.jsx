import { useState, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Search, RefreshCw, PackageSearch } from 'lucide-react';

// "Out now" — what is signed out across every sign-out form, right now.
//
// One big thumb-friendly row per open item: qty × item, who has it, when it
// went out. Built for the floor check, not for record admin — that lives on the
// per-form tabs beside this one.
//
// It spans BOTH controlled sign-out forms. It used to read only Form 703-01
// (equipment/tools/chemicals), so a knife signed out on Form 440-02 never
// appeared here — the one question this screen exists to answer, answered
// wrong. The forms stay separate records; the question "what's out" does not.

const SOURCES = [
  { type: 'maintenance_sign_out', label: 'Equipment · Tools · Chemicals', form: '703-01' },
  { type: 'knife_sign_out', label: 'Knives · Blades', form: '440-02' },
];

// Each form names the person and the item differently. Normalize once here so
// the list stays one list.
function normalize(rec, source) {
  return {
    id: rec.id,
    item: rec.item_description || rec.tool_id || rec.item_name || 'Item',
    qty: Number(rec.qty) > 1 ? Number(rec.qty) : null,
    person: rec.employee_name || rec.issued_to || rec.signed_by || '',
    box: rec.tool_box || null,
    date: rec.record_date || '',
    source: source.label,
    form: source.form,
  };
}

export default function CheckedOutPanel() {
  const maintenance = useApiGet('/qms/maintenance_sign_out');
  const knives = useApiGet('/qms/knife_sign_out');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all');

  const loading = maintenance.loading || knives.loading;
  const refresh = () => { maintenance.refresh(); knives.refresh(); };

  const out = useMemo(() => {
    const rows = [
      ...(maintenance.data || []).filter(r => r.status === 'out').map(r => normalize(r, SOURCES[0])),
      ...(knives.data || []).filter(r => r.status === 'out').map(r => normalize(r, SOURCES[1])),
    ];
    const needle = q.trim().toLowerCase();
    return rows
      .filter(r => only === 'all' || r.form === only)
      .filter(r => !needle || [r.item, r.person, r.box, r.source].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [maintenance.data, knives.data, q, only]);

  const counts = useMemo(() => {
    const c = { all: 0 };
    for (const s of SOURCES) c[s.form] = 0;
    for (const r of [
      ...(maintenance.data || []).filter(r => r.status === 'out').map(r => normalize(r, SOURCES[0])),
      ...(knives.data || []).filter(r => r.status === 'out').map(r => normalize(r, SOURCES[1])),
    ]) { c.all++; c[r.form]++; }
    return c;
  }, [maintenance.data, knives.data]);

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Out now</h2>
          <p className="text-sm text-gray-500">{counts.all} item{counts.all === 1 ? '' : 's'} currently signed out</p>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600" data-tip="Refresh" data-tip-left>
          <RefreshCw size={17} />
        </button>
      </div>

      {/* Only worth showing once both forms have something out. */}
      {counts.all > 0 && SOURCES.every(s => counts[s.form] > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {[{ form: 'all', label: 'Everything' }, ...SOURCES].map(s => (
            <button key={s.form} onClick={() => setOnly(s.form)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${only === s.form ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s.label} <span className="opacity-70">{counts[s.form]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, name, tool box…"
          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white" />
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
      ) : out.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <PackageSearch size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium">
            {q || only !== 'all' ? 'Nothing matches that.' : 'Nothing is checked out right now.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {out.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-gray-900 leading-snug">
                  {r.qty ? `${r.qty}× ` : ''}{r.item}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {[r.person, r.box ? `Box ${r.box}` : null, `Form ${r.form}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="shrink-0 text-sm text-gray-500 tabular-nums">{r.date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
