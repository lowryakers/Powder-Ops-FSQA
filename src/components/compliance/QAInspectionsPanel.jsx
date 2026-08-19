import { useState, useMemo, Fragment } from 'react';
import { useApiGet, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Search, CheckCircle2, XCircle, Lightbulb, ShieldAlert, Thermometer, FileText } from 'lucide-react';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { useCappedList } from '../../lib/useCappedList';
import { useTableSort } from '../../lib/useTableSort';
import SortHeader from '../common/SortHeader.jsx';
import ShowMore from '../common/ShowMore.jsx';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import { formatDateTime } from '../../lib/datetime.js';

// Columns as data, so the header and the sort cannot disagree. The first entry
// has no key — it is the expand chevron, which is not a value to order by.
// The Verify column is conditional on canEdit and stays outside this list.
const QA_COLUMNS = [
  { label: '', width: '2rem' },
  { key: 'area', label: 'Zone / Area', type: 'text' },
  { key: 'performed_at', label: 'Performed', type: 'date' },
  { key: 'performed_by', label: 'By', type: 'text' },
  { key: 'result', label: 'Result', type: 'text' },
  // Sorted by WHO verified, with unverified rows blank so they sort last —
  // "who is still waiting on QA" is the question this column gets asked.
  { key: 'verified_by', label: 'QA verified', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

// QA-owned facility inspections: Light Inspection (Form 110-01/02), Brittle
// Plastic & Glass (Form 431-02) and Temperature & Humidity Control (Form
// 110-04). They share a table with cleaning records for history's sake, but
// they are QA's records and live on QA's list — a record belongs to exactly one
// of the two lists, so nothing appears in both.
const KINDS = [
  { value: 'all', label: 'All inspections' },
  { value: 'light', label: 'Light Inspection', icon: Lightbulb, match: /^light inspection/i },
  {
    value: 'bpg', label: 'Brittle Plastic & Glass', icon: ShieldAlert, match: /^brittle plastic/i,
    // The controlled diagram the inspection is run against. Served as a static
    // file so it opens with no storage backend configured — it's a reference
    // sheet, not an uploaded record.
    reference: { href: '/forms/FORM-431-01-V5-Brittle-Plastic-and-Glass-Diagram.pdf', label: 'FORM 431-01 V5 — Brittle Plastic & Glass Diagram' },
  },
  { value: 'temp', label: 'Temperature & Humidity', icon: Thermometer, match: /^temp(erature)?\s*[/&]?\s*(and\s*)?humidity/i },
];

// The stored value is UTC (SQLite datetime('now')); printing it raw showed
// the UTC clock as if it were local. formatDateTime does the conversion.
const fmt = (ts) => formatDateTime(ts);

// The compact correction form for an inspection record — the fields that
// actually get mis-tapped on a phone at a zone. The full sanitation form
// stays in the Sanitation module; these records rarely carry chemicals.
function InspectionEdit({ record, onDone }) {
  const [form, setForm] = useState({
    performed_by: record.performed_by || '',
    performed_at: String(record.performed_at || '').slice(0, 10),
    result: record.result || 'pass',
    notes: record.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const initialDate = String(record.performed_at || '').slice(0, 10);

  const save = async () => {
    setSaving(true);
    const payload = { ...form };
    // Unchanged date is not sent — re-sending it would rewrite the stored time.
    if (form.performed_at === initialDate) delete payload.performed_at;
    try { await apiPut(`/sanitation/${record.id}`, payload); onDone(); }
    catch (e) { window.alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-2 p-3 bg-white rounded-lg border border-powder-200 space-y-2" onClick={stopRowClick}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-gray-600">Performed by
          <input value={form.performed_by} onChange={e => setForm({ ...form, performed_by: e.target.value })}
            className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </label>
        <label className="text-xs text-gray-600">Date
          <input type="date" max={new Date().toISOString().slice(0, 10)} value={form.performed_at}
            onChange={e => setForm({ ...form, performed_at: e.target.value })}
            className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
        </label>
        <label className="text-xs text-gray-600">Result
          <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
            className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
          </select>
        </label>
      </div>
      <label className="block text-xs text-gray-600">Notes
        <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="mt-0.5 w-full px-2 py-1.5 border border-gray-300 rounded text-sm" />
      </label>
      <button type="button" onClick={save} disabled={saving || !form.performed_by.trim()}
        className="px-3 py-1.5 bg-powder-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
        {saving ? 'Saving…' : 'Save correction'}
      </button>
    </div>
  );
}

export default function QAInspectionsPanel() {
  const { user } = useAuth();
  const canEdit = canEditModule(user, 'qa-inspections');
  const { data: records, loading, refresh } = useApiGet('/sanitation?group=qa');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [resultFilter, setResultFilter] = useState('all');
  const [verifying, setVerifying] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const expand = useRowExpand();

  const revoke = async (r) => {
    if (!window.confirm(`Revoke ${r.verified_by}'s verification so the record can be corrected?`)) return;
    try {
      await apiFetch(`/sanitation/${r.id}/verify`, { method: 'DELETE' });
      refresh();
    } catch (e) { window.alert(e.message); }
  };

  const rows = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const kindDef = KINDS.find(k => k.value === kind);
    return (records || []).filter(r => {
      if (kindDef?.match && !kindDef.match.test(r.area || '')) return false;
      if (resultFilter !== 'all' && r.result !== resultFilter) return false;
      if (needle && ![r.area, r.performed_by, r.verified_by, r.notes].some(v => v && v.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [records, kind, q, resultFilter]);

  // Newest first: an inspection log is read from today backwards.
  const { sorted, sortCol, sortDir, toggleSort } = useTableSort(rows, QA_COLUMNS, 'performed_at', 'desc');
  // Sorted BEFORE the 100-row cap, or only the visible hundred get ordered.
  const view = useCappedList(sorted);

  const activeKind = KINDS.find(k => k.value === kind);
  const referenceFor = (area) => KINDS.find(k => k.reference && k.match?.test(area || ''))?.reference || null;

  const fails = rows.filter(r => r.result === 'fail').length;
  const unverified = rows.filter(r => !r.verified_by).length;

  const verify = async (r) => {
    setVerifying(r.id);
    try {
      // The server takes the signer from the session; sending a name here
      // would imply the body decides who signed.
      await apiPut(`/sanitation/${r.id}/verify`, {});
      refresh();
    } finally { setVerifying(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">QA Inspections</h2>
        <p className="text-sm text-gray-500">
          Light inspections (Form 110-01 / 110-02), brittle plastic &amp; glass checks (Form 431-02)
          and temperature &amp; humidity control (Form 110-04).
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Inspections', value: rows.length, tone: 'text-gray-900' },
          { label: 'Failures', value: fails, tone: fails ? 'text-red-600' : 'text-gray-900' },
          { label: 'Awaiting QA verify', value: unverified, tone: unverified ? 'text-amber-600' : 'text-gray-900' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map(k => (
          <button key={k.value} onClick={() => setKind(k.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${kind === k.value ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {k.label}
          </button>
        ))}
        <div className="flex gap-1 ml-auto">
          {[{ v: 'all', l: 'All' }, { v: 'pass', l: 'Pass' }, { v: 'fail', l: 'Fail' }].map(r => (
            <button key={r.v} onClick={() => setResultFilter(r.v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${resultFilter === r.v ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {r.l}
            </button>
          ))}
        </div>
        {activeKind?.reference && (
          <a href={activeKind.reference.href} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
            <FileText size={14} /> View diagram
          </a>
        )}
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search zone, inspector, notes…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading inspections…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No inspections match these filters.</div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {view.items.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.area}</p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${r.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {(r.result || '').toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">{fmt(r.performed_at)} · {r.performed_by}</p>
                <p className="text-[11px] text-gray-400">
                  {r.verified_by ? `Verified by ${r.verified_by}` : 'Not verified'}
                </p>
                {r.notes && <p className="text-[11px] text-gray-500 mt-1">{r.notes}</p>}
                {canEdit && !r.verified_by && (
                  <button onClick={() => verify(r)} disabled={verifying === r.id}
                    className="mt-2 px-3 py-1.5 bg-powder-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                    {verifying === r.id ? 'Verifying…' : 'Verify'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="md:hidden"><ShowMore view={view} noun="inspections" /></div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {QA_COLUMNS.map((c, i) => (
                    <SortHeader key={c.key || `x${i}`} col={c} sortCol={sortCol} sortDir={sortDir}
                      onSort={toggleSort} className="px-4 py-2 font-semibold text-gray-500 uppercase tracking-wide" />
                  ))}
                  {canEdit && <th className="px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {view.items.map(r => (
                  <Fragment key={r.id}>
                  <tr {...expand.rowProps(r.id, 'border-t border-gray-100')}>
                    <td className="px-2 py-2"><ExpandCell open={expand.isExpanded(r.id)} /></td>
                    <td className="px-4 py-2 font-medium text-gray-900">{r.area}</td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmt(r.performed_at)}</td>
                    <td className="px-4 py-2 text-gray-600">{r.performed_by}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${r.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {r.result === 'fail' ? <XCircle size={11} /> : <CheckCircle2 size={11} />}
                        {(r.result || '').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{r.verified_by ? `${r.verified_by} · ${fmt(r.verified_at)}` : <span className="text-amber-600">Pending</span>}</td>
                    <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{r.notes || '—'}</td>
                    {canEdit && (
                      <td className="px-4 py-2 text-right" onClick={stopRowClick}>
                        {!r.verified_by && (
                          <button onClick={() => verify(r)} disabled={verifying === r.id}
                            className="px-2.5 py-1 bg-powder-600 text-white text-xs font-semibold rounded-md disabled:opacity-50">
                            {verifying === r.id ? '…' : 'Verify'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {expand.isExpanded(r.id) && (
                    <DetailRow colSpan={canEdit ? 8 : 7}>
                      <DetailFields fields={[
                        { label: 'Zone / area', value: r.area },
                        { label: 'Inspection', value: r.inspection_type || r.title },
                        { label: 'Performed', value: fmt(r.performed_at) },
                        { label: 'Performed by', value: r.performed_by },
                        { label: 'Result', value: (r.result || '').toUpperCase() },
                        { label: 'QA verified', value: r.verified_by ? `${r.verified_by} · ${fmt(r.verified_at)}` : 'Pending' },
                        { label: 'Notes', value: r.notes, wide: true },
                      ]}>
                        {referenceFor(r.area) && (
                          <a href={referenceFor(r.area).href} target="_blank" rel="noreferrer" onClick={stopRowClick}
                            className="inline-flex items-center gap-1 text-xs text-powder-600 hover:underline">
                            <FileText size={12} /> {referenceFor(r.area).label}
                          </a>
                        )}
                        {/* The server said what this user may do; the client
                            renders what it's told — same rule as qms.js. */}
                        <span className="inline-flex items-center gap-2 ml-2" onClick={stopRowClick}>
                          {r.can_edit && (
                            <button onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                              className="text-xs text-powder-600 hover:underline">
                              {editingId === r.id ? 'Cancel correction' : 'Correct this record'}
                            </button>
                          )}
                          {r.can_revoke_verification && (
                            <button onClick={() => revoke(r)} className="text-xs text-amber-700 hover:underline">
                              Revoke verification
                            </button>
                          )}
                          {!r.can_edit && r.edit_block_reason && (
                            <span className="text-[11px] text-gray-400">{r.edit_block_reason}</span>
                          )}
                        </span>
                      </DetailFields>
                      {editingId === r.id && (
                        <InspectionEdit record={r} onDone={() => { setEditingId(null); refresh(); }} />
                      )}
                    </DetailRow>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <ShowMore view={view} noun="inspections" />
          </div>
        </>
      )}
    </div>
  );
}
