import { useState, useMemo, useRef, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Check, Languages, Trash2, UserX, Clock, HelpCircle, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { usePageTranslation } from '../../lib/usePageTranslation.js';
import LangToggle from '../LangToggle.jsx';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import HoursTab from './HoursTab.jsx';

const TYPES = [
  { value: 'absent', label: 'Absent', icon: UserX, tone: 'bg-red-100 text-red-700' },
  { value: 'tardy_leave_early', label: 'Tardy / Leave Early', icon: Clock, tone: 'bg-amber-100 text-amber-700' },
  { value: 'other', label: 'Other', icon: HelpCircle, tone: 'bg-gray-100 text-gray-600' },
];
const typeMeta = (v) => TYPES.find(t => t.value === v) || TYPES[2];

// Absence/tardy form — supervisors report for any employee; Spanish is fine
// (the log auto-translates for the admin).
export function AdjustmentForm({ employees, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const blank = { employee_name: '', adjustment_type: 'absent', adjustment_date: today, message: '', details: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      const emp = (employees || []).find(u => u.name === form.employee_name);
      await apiPost('/office/time/adjustments', { ...form, employee_id: emp?.id || null });
      setMsg(`Logged for ${form.employee_name}`);
      setForm({ ...blank, adjustment_date: today });
      onCreated?.();
    } catch (err) { setMsg(err.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">Report an absence / tardy</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Employee *</label>
          <select required value={form.employee_name} onChange={e => setForm({ ...form, employee_name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">Select…</option>
            {(employees || []).map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.adjustment_type} onChange={e => setForm({ ...form, adjustment_type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date it applies to *</label>
          <input type="date" required value={form.adjustment_date} onChange={e => setForm({ ...form, adjustment_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <p className="text-[11px] text-gray-400 mt-0.5">Today if running late, or the future date they'll be out.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Message / reason</label>
          <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="English o español — se traduce automáticamente." />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Submitting…' : 'Submit'}
        </button>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </form>
  );
}

function SortHeader({ label, field, sortField, sortDir, onSort, className = '' }) {
  return (
    <th onClick={() => onSort(field)}
      className={`text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-gray-900 ${className}`}>
      <span className="inline-flex items-center gap-1">{label}{sortField === field && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
    </th>
  );
}

// The message shown in the admin log: auto-translated English first, with the
// original underneath when they differ.
function EntryMessage({ e, compact = false, clamp = false }) {
  const clampCls = clamp ? ' line-clamp-2' : '';
  if (e.message_en && e.message_en !== e.message) {
    return (
      <div className={(compact ? 'text-sm text-gray-800' : 'mt-1.5 text-sm text-gray-800') + clampCls}>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-powder-500 mr-1"><Languages size={10} /> EN</span>
        {e.message_en}
        {e.message && !clamp && <div className="text-xs text-gray-400 mt-0.5 italic">Original: {e.message}</div>}
      </div>
    );
  }
  const txt = [e.message, e.details].filter(Boolean).join(' — ');
  return txt ? <p className={(compact ? 'text-sm text-gray-800' : 'mt-1.5 text-sm text-gray-800') + clampCls}>{txt}</p> : <span className="text-gray-300">—</span>;
}

// Biweekly periods, matching the server's payPeriodFor(): the value is the
// period's start date, shown as "7/19 – 8/1".
const PAY_PERIOD_ANCHOR = Date.parse('2026-07-19T00:00:00Z');
const payPeriodOf = (d) => {
  const day = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const n = Math.floor((Date.parse(`${day}T00:00:00Z`) - PAY_PERIOD_ANCHOR) / (14 * 86400000));
  return new Date(PAY_PERIOD_ANCHOR + n * 14 * 86400000).toISOString().slice(0, 10);
};
const payPeriodLabel = (start) => {
  if (!start) return '';
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(a.getTime() + 13 * 86400000);
  const fmt = (x) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
  return `${fmt(a)} – ${fmt(b)}`;
};
const ADP_STATES = [
  { value: 'pending', label: 'Pending', tone: 'bg-amber-100 text-amber-700' },
  { value: 'entered', label: 'In ADP', tone: 'bg-green-100 text-green-700' },
  { value: 'not_applicable', label: 'N/A', tone: 'bg-gray-100 text-gray-500' },
];

function AdjustmentsLog({ tr = (x) => x }) {
  const [employee, setEmployee] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [adpFilter, setAdpFilter] = useState('');
  const [q, setQ] = useState('');
  const [sortField, setSortField] = useState('adjustment_date');
  const [sortDir, setSortDir] = useState('desc');
  const [picked, setPicked] = useState(() => new Set());
  const expand = useRowExpand();
  const [busy, setBusy] = useState(false);
  const { data: entries, refresh } = useApiGet(`/office/time/adjustments${employee ? `?employee=${encodeURIComponent(employee)}` : ''}`, [employee]);
  const onSort = (f) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir(f === 'adjustment_date' ? 'desc' : 'asc'); } };

  const list = useMemo(() => {
    let l = entries || [];
    if (typeFilter) l = l.filter(e => e.adjustment_type === typeFilter);
    if (statusFilter) l = l.filter(e => e.status === statusFilter);
    if (periodFilter) l = l.filter(e => (e.pay_period || payPeriodOf(e.adjustment_date)) === periodFilter);
    if (adpFilter) l = l.filter(e => (e.adp_status || 'pending') === adpFilter);
    const needle = q.toLowerCase().trim();
    if (needle) l = l.filter(e => [e.employee_name, e.message, e.message_en, e.details, e.submitted_by].filter(Boolean).join(' ').toLowerCase().includes(needle));
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (e) => {
      if (sortField === 'status') return e.status === 'new' ? 0 : 1;
      return String(e[sortField] ?? '').toLowerCase();
    };
    return [...l].sort((a, b) => { const av = val(a), bv = val(b); return av < bv ? -dir : av > bv ? dir : 0; });
  }, [entries, typeFilter, statusFilter, periodFilter, adpFilter, q, sortField, sortDir]);

  // ── Selection ─────────────────────────────────────────────────────────────
  // Filter the log down to what you're working through — a pay period, one
  // person, everything still pending — then act on the whole set at once. The
  // selection only ever covers rows currently visible, so a hidden row can
  // never be changed by accident.
  const visibleIds = useMemo(() => list.map(e => e.id), [list]);
  const selected = useMemo(() => visibleIds.filter(id => picked.has(id)), [visibleIds, picked]);
  const allPicked = visibleIds.length > 0 && selected.length === visibleIds.length;

  // Shift-click ticks everything between the last box you touched and this one.
  // Reconciling a pay period means selecting runs of rows, and clicking twenty
  // boxes one at a time is where people give up and go back to the spreadsheet.
  const lastPickedRef = useRef(null);
  const toggleOne = (id, ev) => {
    const anchor = ev?.nativeEvent?.shiftKey ? lastPickedRef.current : null;
    setPicked(s => {
      const next = new Set(s);
      const a = anchor ? visibleIds.indexOf(anchor) : -1;
      const b = visibleIds.indexOf(id);
      if (a !== -1 && b !== -1 && a !== b) {
        // The span takes the state the clicked row is moving TO, so
        // shift-clicking an unticked row ticks the whole run.
        const on = !next.has(id);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (on) next.add(visibleIds[i]); else next.delete(visibleIds[i]);
        }
        return next;
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastPickedRef.current = id;
  };
  const toggleAll = () => setPicked(s => {
    const next = new Set(s);
    if (allPicked) visibleIds.forEach(id => next.delete(id));
    else visibleIds.forEach(id => next.add(id));
    return next;
  });
  const applyBulk = async (patch) => {
    if (!selected.length) return;
    setBusy(true);
    try {
      await apiPut('/office/time/adjustments/bulk', { ids: selected, ...patch });
      setPicked(new Set());
      refresh();
    } finally { setBusy(false); }
  };
  const deleteBulk = async () => {
    if (!selected.length) return;
    if (!confirm(`Delete ${selected.length} ${selected.length === 1 ? 'entry' : 'entries'}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await apiPost('/office/time/adjustments/bulk-delete', { ids: selected });
      setPicked(new Set());
      refresh();
    } finally { setBusy(false); }
  };

  // ── Row actions ───────────────────────────────────────────────────────────
  // A per-row control acts on the whole selection when that row is part of it.
  // Someone who has just ticked six lines and clicks one row's ADP pill means
  // all six; changing one and silently leaving five is never what they wanted,
  // and from the screen they'd have no way to tell it hadn't taken.
  const rowScope = (e) => (picked.has(e.id) && selected.length > 1 ? selected : [e.id]);
  const scopeNote = (e) => (rowScope(e).length > 1 ? ` — applies to all ${selected.length} selected` : '');

  const markReviewed = async (e) => {
    if (rowScope(e).length > 1) return applyBulk({ status: 'reviewed' });
    await apiPut(`/office/time/adjustments/${e.id}`, { status: 'reviewed' });
    refresh();
  };
  // Payroll's last mile: pending → in ADP → N/A, one click per step.
  const cycleAdp = async (e) => {
    const order = ['pending', 'entered', 'not_applicable'];
    const next = order[(order.indexOf(e.adp_status || 'pending') + 1) % order.length];
    if (rowScope(e).length > 1) return applyBulk({ adp_status: next });
    await apiPut(`/office/time/adjustments/${e.id}`, { adp_status: next });
    refresh();
  };

  // Periods present in the data, newest first — no date maths for the user.
  const periods = useMemo(() => {
    const set = new Set((entries || []).map(e => e.pay_period || payPeriodOf(e.adjustment_date)).filter(Boolean));
    return [...set].sort().reverse();
  }, [entries]);
  const periodSummary = useMemo(() => {
    const done = list.filter(e => (e.adp_status || 'pending') !== 'pending').length;
    return { done, total: list.length };
  }, [list]);
  const del = async (e) => {
    if (rowScope(e).length > 1) return deleteBulk();
    if (!confirm(`Delete entry for ${e.employee_name}?`)) return;
    await apiFetch(`/office/time/adjustments/${e.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {employee && (
          <button onClick={() => setEmployee('')} className="px-2.5 py-1 rounded-lg text-xs font-medium bg-powder-600 text-white">
            {employee} ✕
          </button>
        )}
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
          <option value="">Type: all</option>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
          <option value="">{tr('Status: all')}</option>
          <option value="new">{tr('New')}</option>
          <option value="reviewed">{tr('Reviewed')}</option>
        </select>
        <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
          <option value="">{tr('Pay period: all')}</option>
          {periods.map(p => <option key={p} value={p}>{payPeriodLabel(p)}</option>)}
        </select>
        <select value={adpFilter} onChange={e => setAdpFilter(e.target.value)} className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
          <option value="">{tr('ADP: all')}</option>
          {ADP_STATES.map(a => <option key={a.value} value={a.value}>{tr(a.label)}</option>)}
        </select>
        {periodFilter && (
          <span className="text-[11px] font-medium text-gray-500">
            {periodSummary.done}/{periodSummary.total} {tr('accounted for in ADP')}
          </span>
        )}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, message…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
      </div>

      {/* Bulk bar. Sits above the list rather than floating over it, so it can
          never cover a row you're deciding about. */}
      {selected.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-powder-200 bg-powder-50 px-3 py-2">
          <span className="text-xs font-semibold text-powder-900">
            {selected.length} {selected.length === 1 ? tr('entry selected') : tr('entries selected')}
          </span>
          <span className="hidden lg:inline text-[11px] text-powder-700/70">{tr('Shift-click to select a range')}</span>
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <button onClick={() => applyBulk({ status: 'reviewed' })} disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
              <Check size={12} /> {tr('Mark reviewed')}
            </button>
            <span className="text-[11px] text-gray-500 pl-1">{tr('ADP')}:</span>
            {ADP_STATES.map(a => (
              <button key={a.value} onClick={() => applyBulk({ adp_status: a.value })} disabled={busy}
                className={`px-2 py-1 rounded-lg text-[11px] font-semibold hover:opacity-80 disabled:opacity-50 ${a.tone}`}>
                {tr(a.label)}
              </button>
            ))}
            <button onClick={deleteBulk} disabled={busy}
              className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-50" data-tip="Delete selected"><Trash2 size={14} /></button>
            <button onClick={() => setPicked(new Set())} className="text-[11px] text-gray-500 hover:text-gray-700 pl-1">{tr('Clear')}</button>
          </div>
        </div>
      )}
      {list.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-gray-500 px-1 cursor-pointer w-fit">
          <input type="checkbox" checked={allPicked} onChange={toggleAll} className="rounded border-gray-300" />
          {allPicked ? tr('Deselect all') : `${tr('Select all')} (${list.length})`}
        </label>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {list.map(e => {
          const t = typeMeta(e.adjustment_type);
          return (
            <div key={e.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${e.status === 'new' ? 'border-powder-400' : 'border-gray-200'} p-3 shadow-sm ${picked.has(e.id) ? 'ring-2 ring-powder-300' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <input type="checkbox" checked={picked.has(e.id)} onChange={ev => toggleOne(e.id, ev)}
                  className="mt-1 shrink-0 rounded border-gray-300" aria-label={`Select ${e.employee_name}`} />
                <div className="min-w-0 flex-1">
                  <button onClick={() => setEmployee(e.employee_name)} className="font-medium text-gray-900 hover:text-powder-700">{e.employee_name}</button>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${t.tone}`}>{t.label}</span>
                  <span className="ml-2 text-xs text-gray-400">{e.adjustment_date}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {e.status === 'new'
                    ? <button onClick={() => markReviewed(e)} className="flex items-center gap-1 px-2 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700"><Check size={12} /> Mark reviewed</button>
                    : <span className="text-xs text-gray-400 inline-flex items-center gap-1"><Check size={12} /> Reviewed</span>}
                  <button onClick={() => del(e)} className="p-1.5 text-gray-300 hover:text-red-500" data-tip="Delete" data-tip-left><Trash2 size={13} /></button>
                </div>
              </div>
              <EntryMessage e={e} />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-400">{tr('Reported by')} {e.submitted_by || '—'} · {(e.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                {(() => {
                  const a = ADP_STATES.find(x => x.value === (e.adp_status || 'pending'));
                  return (
                    <button onClick={() => cycleAdp(e)} className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${a.tone}`}>
                      ADP: {tr(a.label)}
                    </button>
                  );
                })()}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">No entries</div>}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2.5 w-8">
                  <input type="checkbox" checked={allPicked} onChange={toggleAll}
                    className="rounded border-gray-300" aria-label="Select all entries" />
                </th>
                <th className="w-8 px-2 py-2.5" />
                <SortHeader label="Employee" field="employee_name" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Type" field="adjustment_type" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Date" field="adjustment_date" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">Message</th>
                <SortHeader label="Reported by" field="submitted_by" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">{tr('ADP')}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {list.map(e => {
                const t = typeMeta(e.adjustment_type);
                return (
                  <Fragment key={e.id}>
                  <tr {...expand.rowProps(e.id, `border-b border-gray-100 ${picked.has(e.id) ? 'bg-powder-50' : e.status === 'new' ? 'bg-powder-50/40' : ''}`)}>
                    <td className="px-3 py-2.5" onClick={stopRowClick}>
                      <input type="checkbox" checked={picked.has(e.id)} onChange={ev => toggleOne(e.id, ev)}
                        className="rounded border-gray-300" aria-label={`Select ${e.employee_name}`} />
                    </td>
                    <td className="px-2 py-2.5"><ExpandCell open={expand.isExpanded(e.id)} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={stopRowClick}>
                      <button onClick={() => setEmployee(e.employee_name)} className="font-medium text-gray-900 hover:text-powder-700">{e.employee_name}</button>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.tone}`}>{t.label}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{e.adjustment_date}</td>
                    {/* Was `min-w-[260px] w-full`, which made this column absorb
                        every spare pixel and push Status / ADP off the right of
                        the table — the two columns you come here to act on. It
                        is capped and clamped now; the full text is one click
                        away in the expanded row, so nothing is lost. */}
                    <td className="px-3 py-2.5 max-w-[22rem]"><EntryMessage e={e} compact clamp /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">{e.submitted_by || '—'}<div className="text-gray-400">{(e.created_at || '').slice(0, 10)}</div></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {e.status === 'new'
                        ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">New</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 inline-flex items-center gap-1"><Check size={11} /> Reviewed</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" onClick={stopRowClick}>
                      {(() => {
                        const a = ADP_STATES.find(x => x.value === (e.adp_status || 'pending'));
                        return (
                          <button onClick={() => cycleAdp(e)} title={(e.adp_entered_by ? `${e.adp_entered_by} · ${(e.adp_entered_at || '').slice(0, 10)}` : 'Click to change') + scopeNote(e)}
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.tone}`}>
                            {tr(a.label)}
                          </button>
                        );
                      })()}
                      <div className="text-[10px] text-gray-400">{payPeriodLabel(e.pay_period || payPeriodOf(e.adjustment_date))}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right" onClick={stopRowClick}>
                      <div className="flex items-center gap-1 justify-end">
                        {e.status === 'new' && (
                          <button onClick={() => markReviewed(e)} title={`Mark reviewed${scopeNote(e)}`}
                            className="px-2 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700">Mark reviewed</button>
                        )}
                        <button onClick={() => del(e)} className="p-1.5 text-gray-400 hover:text-red-500" data-tip="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                  {expand.isExpanded(e.id) && (
                    <DetailRow colSpan={10}>
                      <DetailFields fields={[
                        { label: tr('Employee'), value: e.employee_name },
                        { label: tr('Type'), value: t.label },
                        { label: tr('Date'), value: e.adjustment_date },
                        { label: tr('Hours'), value: e.hours },
                        { label: tr('Reported by'), value: e.submitted_by },
                        { label: tr('Reported'), value: (e.created_at || '').slice(0, 16).replace('T', ' ') },
                        { label: tr('Status'), value: e.status === 'new' ? tr('New') : tr('Reviewed') },
                        { label: tr('Reviewed by'), value: e.reviewed_by },
                        { label: tr('ADP'), value: e.adp_entered_by ? `${e.adp_entered_by} · ${(e.adp_entered_at || '').slice(0, 10)}` : (e.adp_status || 'pending') },
                        { label: tr('Pay period'), value: payPeriodLabel(e.pay_period || payPeriodOf(e.adjustment_date)) },
                      ]}>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{tr('Message')}</div>
                          <EntryMessage e={e} />
                        </div>
                      </DetailFields>
                    </DetailRow>
                  )}
                  </Fragment>
                );
              })}
              {list.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{tr('No entries')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatsTab() {
  const { data: stats } = useApiGet('/office/time/stats');
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              {['Employee', 'Last 30 days', 'Last 90 days', 'Absences (90d)', 'Tardies (90d)', 'Most recent'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(stats || []).map(s => (
              <tr key={s.employee_name} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5 font-medium text-gray-900 w-full">{s.employee_name}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.last_30 >= 3 ? 'bg-red-100 text-red-700' : s.last_30 > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{s.last_30}</span></td>
                <td className="px-3 py-2.5 text-gray-600">{s.last_90}</td>
                <td className="px-3 py-2.5 text-gray-600">{s.absences_90}</td>
                <td className="px-3 py-2.5 text-gray-600">{s.tardies_90}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{s.last_event}</td>
              </tr>
            ))}
            {(stats || []).length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No activity in the last 90 days</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Page labels the EN/ES toggle covers. Row content (names, messages) is added
// on top of this list by the log itself.
const PAGE_STRINGS = [
  'Time Tracking', 'Log', 'New Report', 'Stats', 'Status: all', 'New', 'Reviewed',
  'Pay period: all', 'ADP: all', 'Pending', 'In ADP', 'N/A', 'accounted for in ADP',
  'ADP', 'No entries', 'Reported by', 'Mark reviewed', 'Employee', 'Type', 'Date', 'Message', 'Hours',
  'entry selected', 'entries selected', 'Select all', 'Deselect all', 'Clear',
  'Shift-click to select a range',
];

export default function TimeTrackingPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'log' : 'form');
  const { data: employees } = useApiGet('/users/technicians');
  const { lang, setLang, tr, translating } = usePageTranslation(PAGE_STRINGS);

  const tabs = isAdmin
    ? [['log', 'Log'], ['form', 'New Report'], ['stats', 'Stats'], ['hours', 'Hours']]
    : [['form', 'New Report']];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">{tr('Time Tracking')}</h2>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {tabs.length > 1 && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto max-w-full">
              {tabs.map(([v, l]) => (
                <button key={v} onClick={() => setTab(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{tr(l)}</button>
              ))}
            </div>
          )}
          <LangToggle lang={lang} setLang={setLang} translating={translating} />
        </div>
      </div>
      {tab === 'form' && <AdjustmentForm employees={employees} onCreated={() => {}} />}
      {tab === 'log' && isAdmin && <AdjustmentsLog tr={tr} />}
      {tab === 'stats' && isAdmin && <StatsTab />}
      {tab === 'hours' && isAdmin && <HoursTab />}
    </div>
  );
}
