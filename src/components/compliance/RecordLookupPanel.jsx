import { useEffect, useMemo, useState } from 'react';
import { Search, X, ChevronRight, ChevronDown, Download, ExternalLink, Info } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import SearchSelect from '../common/SearchSelect.jsx';
import PrintRecordButton from '../common/PrintRecordButton.jsx';
import FrozenScroll from '../common/FrozenScroll.jsx';
import TextCell from '../common/TextCell.jsx';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { getParam, consumeParam } from '../../lib/deepLink.js';

// LOOK UP RECORDS (single-spine move 04, D-375).
//
// "Everything about lot L / machine E / person P" on one screen. Not a second
// database: it asks GET /api/records — the record interface's read side — and
// renders what it is told, in the common shape every record type describes
// itself in. A mock recall becomes a lookup instead of a walk through a dozen
// modules.
//
// TWO THINGS THE SCREEN WILL NOT DO:
//   - claim a search covered a record type it could not. A type that does not
//     carry a lot (or a machine) is named under "Not searched", with why;
//     silence there would read as "nothing on file".
//   - decide anything. Permissions, the cap and the matching are the server's.
//     The CSV is built from the rows on screen, so the file cannot disagree
//     with the page.

const blank = { lot: '', machine: '', person: '', from: '', to: '', type: '' };

// Short names for chips and row captions; the server's labels are written for
// the type list, where there is room.
const SHORT = {
  sanitation: 'Cleaning & QA inspections', scale: 'Scale checks', qms: 'Quality forms', production: 'Production',
  emp: 'EMP samples', gmp_walk: 'GMP walks', banned_list_review: 'Banned-list reviews', culture_check: 'Culture checks',
  management_review: 'Management reviews', food_defense_challenge: 'Food Defense challenges', receiving: 'Receiving',
  calibration: 'Calibration', training: 'Training', disposal: 'Disposals', coa: 'COA',
};

const when = (v) => {
  const s = String(v || '');
  if (!s) return '—';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : formatDateTime(s);
};
const lotsOf = (r) => (Array.isArray(r.lots) && r.lots.length ? r.lots : (r.lot ? [r.lot] : []));

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The fields every row is listed with; anything else a type describes shows in
// the opened row.
const SHOWN = new Set(['type', 'id', 'form', 'title', 'lots', 'lot', 'place', 'performed_by', 'performed_at', 'result', 'signed_by', 'signed_at', 'signatures', 'link', 'group', 'equipment_id', 'approvals_pending']);
const prettyKey = (k) => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const prettyVal = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export default function RecordLookupPanel() {
  // A deep link (?tab=records&rec_lot=…) opens on that search. Its own names,
  // because `lot` is already COA's deep-link parameter.
  const [form, setForm] = useState(() => ({
    ...blank,
    lot: getParam('rec_lot') || '',
    person: getParam('rec_person') || '',
    machine: getParam('rec_machine') || '',
  }));
  const [query, setQuery] = useState(() => {
    const q = new URLSearchParams();
    if (getParam('rec_lot')) q.set('lot', getParam('rec_lot'));
    if (getParam('rec_person')) q.set('person', getParam('rec_person'));
    if (getParam('rec_machine')) q.set('equipment', getParam('rec_machine'));
    return q.toString();
  });
  useEffect(() => { ['rec_lot', 'rec_person', 'rec_machine'].forEach(consumeParam); }, []);

  const types = useApiGet('/records/types');
  const machines = useApiGet('/records/machines');
  const people = useApiGet('/users/technicians');
  const result = useApiGet(query ? `/records?${query}` : null, [query]);

  const typeLabel = useMemo(() => Object.fromEntries((types.data || []).map(t => [t.type, SHORT[t.type] || t.label])), [types.data]);

  // Machines are picked by name; the id is what the server filters on.
  const machineOptions = useMemo(() => {
    const seen = new Map();
    for (const m of machines.data || []) {
      let label = `${m.name}${m.asset_number ? ` (#${m.asset_number})` : ''}${m.kind === 'instrument' ? ' — calibration instrument' : m.kind === 'area' ? ' — area' : ''}${m.status && m.status !== 'active' ? ` · ${m.status.replace(/_/g, ' ')}` : ''}`;
      if (seen.has(label)) label = `${label} [${m.id.slice(0, 6)}]`;
      seen.set(label, m.id);
    }
    return seen;
  }, [machines.data]);
  const machineLabel = useMemo(() => {
    for (const [label, id] of machineOptions) if (id === form.machine) return label;
    return '';
  }, [machineOptions, form.machine]);
  const peopleOptions = useMemo(() => (people.data || []).map(p => p.name), [people.data]);

  const [chip, setChip] = useState(null);
  const [open, setOpen] = useState(null);
  const [hint, setHint] = useState('');

  const run = (e) => {
    e?.preventDefault?.();
    const q = new URLSearchParams();
    if (form.lot.trim()) q.set('lot', form.lot.trim());
    if (form.machine) q.set('equipment', form.machine);
    if (form.person.trim()) q.set('person', form.person.trim());
    if (form.from) q.set('from', form.from);
    if (form.to) q.set('to', form.to);
    if (form.type) q.set('type', form.type);
    if (![...q.keys()].some(k => ['lot', 'equipment', 'person', 'from', 'to'].includes(k))) {
      setHint('Enter a lot, a machine, a person or a date to look up.');
      return;
    }
    setHint(''); setChip(null); setOpen(null);
    setQuery(q.toString());
  };
  const clear = () => { setForm(blank); setQuery(''); setHint(''); setChip(null); setOpen(null); };

  const data = result.data;
  const rows = useMemo(() => (data?.records || []).filter(r => !chip || r.type === chip), [data, chip]);
  const counts = useMemo(() => {
    const c = {};
    for (const r of data?.records || []) c[r.type] = (c[r.type] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const asked = useMemo(() => {
    const q = new URLSearchParams(query);
    const bits = [];
    if (q.get('lot')) bits.push(`lot ${q.get('lot')}`);
    if (q.get('equipment')) bits.push(machineLabel || 'the machine');
    if (q.get('person')) bits.push(q.get('person'));
    if (q.get('from') || q.get('to')) bits.push(`${q.get('from') ? formatDate(q.get('from')) : '…'} to ${q.get('to') ? formatDate(q.get('to')) : '…'}`);
    return bits.join(' · ');
  }, [query, machineLabel]);

  const downloadCsv = () => {
    const head = ['When', 'Record type', 'Form', 'Record', 'Lots', 'Where', 'By', 'Result', 'Signed by', 'Signed at', 'Id'];
    const lines = rows.map(r => [r.performed_at, typeLabel[r.type] || r.type, r.form, r.title, lotsOf(r).join(' | '), r.place, r.performed_by, r.result, r.signed_by, r.signed_at, r.id].map(csvCell).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `record-lookup-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const openModule = (r) => {
    if (!r.link?.tab) return;
    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: r.link.tab, ...(r.link.view ? { view: r.link.view } : {}) } }));
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
  const label = 'block text-xs font-medium text-gray-600 mb-1';

  return (
    <div className="space-y-4" data-record-lookup>
      <div>
        <h2 className="text-xl font-bold text-gray-900">Look up records</h2>
        <p className="text-sm text-gray-600 max-w-3xl">
          Everything on file about one lot, one machine or one person, across every kind of record you can open:
          production, receiving, cleaning, scale checks, calibration, training, disposals, COA and the quality forms.
        </p>
      </div>

      <form onSubmit={run} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3" data-lookup-form>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label htmlFor="lookup-lot" className={label}>Lot</label>
            <input id="lookup-lot" className={input} value={form.lot} placeholder="e.g. 101692"
              onChange={e => setForm(f => ({ ...f, lot: e.target.value }))} data-lookup-lot />
          </div>
          <div data-lookup-machine>
            <span className={label}>Machine or instrument</span>
            <SearchSelect value={machineLabel} options={[...machineOptions.keys()]} placeholder="Type a name or asset number…"
              onChange={(v) => setForm(f => ({ ...f, machine: machineOptions.get(v) || '' }))} />
          </div>
          <div data-lookup-person>
            <span className={label}>Person (did the work or signed it)</span>
            <SearchSelect value={form.person} options={peopleOptions} allowFree placeholder="A name, as it is written on the record"
              onChange={(v) => setForm(f => ({ ...f, person: v || '' }))} />
          </div>
          <div>
            <label htmlFor="lookup-from" className={label}>From</label>
            <input id="lookup-from" type="date" className={input} value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="lookup-to" className={label}>To</label>
            <input id="lookup-to" type="date" className={input} value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="lookup-type" className={label}>Kind of record</label>
            <select id="lookup-type" className={input} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} data-lookup-type>
              <option value="">Every kind I can open</option>
              {(types.data || []).map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700" data-lookup-run>
            <Search size={15} /> Look up
          </button>
          <button type="button" onClick={clear} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
            <X size={15} /> Clear
          </button>
          {hint && <span className="text-sm text-amber-700" data-lookup-hint>{hint}</span>}
        </div>
      </form>

      {query && result.loading && <div className="text-sm text-gray-500 py-6 text-center">Looking up…</div>}
      {query && result.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{result.error}</div>}

      {query && data && (
        <div className="space-y-3" data-lookup-results>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-gray-800">
              <span className="font-semibold" data-lookup-total>{data.total}</span> record{data.total === 1 ? '' : 's'}
              {asked ? <> for <span className="font-medium">{asked}</span></> : null}
              {data.capped === false && <span className="text-gray-500"> · every matching record is listed</span>}
            </p>
            {rows.length > 0 && (
              <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50" data-lookup-csv>
                <Download size={13} /> Download CSV
              </button>
            )}
          </div>

          {data.truncated && (
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3" data-lookup-truncated>
              Only the newest 500 of each kind are shown{data.truncated_types?.length ? ` (${data.truncated_types.map(t => typeLabel[t] || t).join(', ')} had more)` : ''}.
              Add a lot, a machine or a person to see every match.
            </div>
          )}

          {data.not_searched?.length > 0 && (
            <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg p-3" data-lookup-not-searched>
              <div className="flex items-center gap-1.5 font-medium text-slate-800"><Info size={14} /> Not searched for this lookup</div>
              {/* One line per reason, naming every kind it applies to. */}
              <ul className="mt-1 space-y-1 text-slate-700">
                {Object.entries(data.not_searched.reduce((m, n) => ({ ...m, [n.why]: [...(m[n.why] || []), n] }), {})).map(([why, list]) => (
                  <li key={why}>
                    {why}{' '}
                    {list.map((n, i) => (
                      <span key={n.type} data-not-searched={n.type} title={n.label}>
                        <span className="font-medium">{SHORT[n.type] || n.label}</span>{i < list.length - 1 ? ', ' : '.'}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {counts.length > 1 && (
            <div className="flex flex-wrap gap-1.5" data-lookup-chips>
              <button type="button" onClick={() => setChip(null)}
                className={`px-2.5 py-1 rounded-full text-xs border ${!chip ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                All {data.total}
              </button>
              {counts.map(([t, n]) => (
                <button key={t} type="button" onClick={() => setChip(chip === t ? null : t)} data-lookup-chip={t}
                  className={`px-2.5 py-1 rounded-full text-xs border ${chip === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                  {typeLabel[t] || t} {n}
                </button>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg p-6 text-center" data-lookup-empty>
              Nothing on file that you can open matches this lookup.
            </div>
          ) : (
            <>
              {/* Desktop: one table. */}
              <div className="hidden md:block bg-white border border-gray-200 rounded-xl">
                <FrozenScroll className="rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="w-8" />
                        <th className="text-left px-3 py-2">When</th>
                        <th className="text-left px-3 py-2">Record</th>
                        <th className="text-left px-3 py-2">Lots</th>
                        <th className="text-left px-3 py-2">Where</th>
                        <th className="text-left px-3 py-2">By</th>
                        <th className="text-left px-3 py-2">Result</th>
                        <th className="text-left px-3 py-2">Signed</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map(r => {
                        const key = `${r.type}:${r.id}`;
                        const isOpen = open === key;
                        return (
                          <RowPair key={key} r={r} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : key)}
                            typeLabel={typeLabel} onModule={() => openModule(r)} />
                        );
                      })}
                    </tbody>
                  </table>
                </FrozenScroll>
              </div>

              {/* Phone: cards. */}
              <div className="md:hidden space-y-2">
                {rows.map(r => {
                  const key = `${r.type}:${r.id}`;
                  const isOpen = open === key;
                  return (
                    <div key={key} className="bg-white border border-gray-200 rounded-lg p-3" data-lookup-card={key}>
                      <button type="button" className="w-full text-left" onClick={() => setOpen(isOpen ? null : key)}>
                        <div className="text-[11px] text-gray-500">{typeLabel[r.type] || r.type} · {when(r.performed_at)}</div>
                        <div className="font-medium text-gray-900">{r.title || r.form}</div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          {[r.form, lotsOf(r).length ? `Lot ${lotsOf(r).join(', ')}` : null, r.performed_by, r.result].filter(Boolean).join(' · ')}
                        </div>
                        {r.signed_by && <div className="text-xs text-green-700 mt-0.5">Signed by {r.signed_by}</div>}
                      </button>
                      {isOpen && <Detail r={r} onModule={() => openModule(r)} />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RowPair({ r, isOpen, onToggle, typeLabel, onModule }) {
  const lots = lotsOf(r);
  return (
    <>
      <tr className="hover:bg-gray-50 cursor-pointer align-top" onClick={onToggle} data-lookup-row={`${r.type}:${r.id}`}>
        <td className="pl-3 py-2 text-gray-400">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
        <td className="px-3 py-2 whitespace-nowrap text-gray-700">{when(r.performed_at)}</td>
        <td className="px-3 py-2">
          <div className="text-[11px] text-gray-500">{typeLabel[r.type] || r.type}{r.form ? ` · ${r.form}` : ''}</div>
          <TextCell value={r.title} width="22rem" />
        </td>
        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{lots.length ? lots.map(l => <div key={l}>{l}</div>) : '—'}</td>
        <td className="px-3 py-2 text-gray-700"><TextCell value={r.place || '—'} width="10rem" /></td>
        <td className="px-3 py-2 text-gray-700">{r.performed_by || '—'}</td>
        <td className="px-3 py-2 text-gray-700">{r.result || '—'}</td>
        <td className="px-3 py-2 text-gray-700">{r.signed_by ? <><div>{r.signed_by}</div><div className="text-[11px] text-gray-500">{when(r.signed_at)}</div></> : '—'}</td>
        <td className="px-3 py-2 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
          <PrintRecordButton type={r.type} id={r.id} />
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-gray-50/60">
          <td />
          <td colSpan={8} className="px-3 py-3"><Detail r={r} onModule={onModule} /></td>
        </tr>
      )}
    </>
  );
}

// Everything the type described, beyond the columns: the signatures with what
// each one means, what is still owed, and the type's own fields.
function Detail({ r, onModule }) {
  const extra = Object.entries(r).filter(([k]) => !SHOWN.has(k)).map(([k, v]) => [k, prettyVal(v)]).filter(([, v]) => v != null);
  return (
    <div className="space-y-2 text-sm" data-lookup-detail>
      {r.signatures?.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-600">Signatures</div>
          <ul className="text-gray-800">
            {r.signatures.map((s, i) => <li key={i}>{s.label ? `${s.label}: ` : ''}{s.name} · {when(s.at)}</li>)}
          </ul>
        </div>
      )}
      {r.approvals_pending?.length > 0 && (
        <div className="text-amber-800 text-xs">Still to sign: {r.approvals_pending.map(prettyKey).join(', ')}</div>
      )}
      {extra.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {extra.map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <dt className="text-gray-500 shrink-0">{prettyKey(k)}</dt>
              <dd className="text-gray-900 break-words min-w-0">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <PrintRecordButton type={r.type} id={r.id} />
        {r.link?.tab && (
          <button type="button" onClick={onModule} className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 rounded-md hover:bg-gray-50" data-lookup-open-module>
            <ExternalLink size={12} /> Open its module
          </button>
        )}
      </div>
    </div>
  );
}
