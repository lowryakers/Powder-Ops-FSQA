import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, apiPost } from '../../hooks/useApi';
import { Eraser, AlertTriangle, CheckCircle2, Loader2, SquareCheck, Square, ChevronLeft } from 'lucide-react';

// Cleanup Review — closing out the items filed before the plant was really
// using ReadyDoc.
//
// Deliberately two steps: pick a cutoff and see the counts, then work one pile
// at a time with the rows in front of you. A single "clear everything before
// this date" button would be faster and is exactly the thing nobody should be
// able to press by accident on compliance records.
//
// Nothing here deletes. Tasks close as cancelled; production entries are
// waived with the QA signature left empty. The reason goes on every record.

const today = () => new Date().toISOString().slice(0, 10);

function Row({ row, checked, onToggle }) {
  return (
    <label className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onToggle(row.id, e)} className="mt-1 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900 truncate">{row.title}</span>
        {row.detail && <span className="block text-xs text-gray-500 truncate">{row.detail}</span>}
      </span>
      <span className="text-xs text-gray-400 shrink-0 tabular-nums">{row.date}</span>
    </label>
  );
}

export default function CleanupReviewPanel() {
  const [cutoff, setCutoff] = useState('2026-07-20');
  const [summary, setSummary] = useState(null);
  const [active, setActive] = useState(null);   // source key being worked
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [reason, setReason] = useState('Filed before ReadyDoc go-live — never worked; closed on review.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const lastPicked = useRef(null);

  const loadSummary = useCallback(async () => {
    setError(''); setBusy(true);
    try { setSummary(await apiFetch(`/cleanup?before=${cutoff}`)); }
    catch (e) { setError(e.message); setSummary(null); }
    finally { setBusy(false); }
  }, [cutoff]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const openSource = async (key) => {
    setError(''); setBusy(true); setSelected(new Set()); lastPicked.current = null;
    try {
      const data = await apiFetch(`/cleanup?before=${cutoff}&source=${key}`);
      setRows(data.rows || []);
      setActive(key);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  // Shift-click ticks the range from the last box touched, and the span takes
  // the state the clicked row is moving to — same rule as the Time Tracking
  // log, because ticking two hundred boxes one at a time is where people give
  // up and go back to the spreadsheet.
  const toggle = (id, e) => {
    const idx = rows.findIndex(r => r.id === id);
    const next = new Set(selected);
    const turningOn = !next.has(id);
    const span = (e?.nativeEvent?.shiftKey && lastPicked.current != null)
      ? rows.slice(Math.min(lastPicked.current, idx), Math.max(lastPicked.current, idx) + 1).map(r => r.id)
      : [id];
    for (const rid of span) { if (turningOn) next.add(rid); else next.delete(rid); }
    lastPicked.current = idx;
    setSelected(next);
  };
  const allOn = rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(rows.map(r => r.id)));

  const close = async () => {
    if (!selected.size) return;
    setBusy(true); setError('');
    try {
      const out = await apiPost('/cleanup/close', { source: active, ids: [...selected], reason });
      setFlash(`Closed ${out.closed} record${out.closed === 1 ? '' : 's'}${out.failed?.length ? ` · ${out.failed.length} skipped` : ''}`);
      setRows(rows.filter(r => !selected.has(r.id)));
      setSelected(new Set());
      loadSummary();
      setTimeout(() => setFlash(''), 4000);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const src = summary?.sources?.find(s => s.key === active);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Eraser size={18} className="text-powder-600" /> Cleanup Review</h3>
        <p className="text-xs text-gray-500 mt-1 max-w-2xl">
          Close out items filed before the plant was really using ReadyDoc. Nothing is deleted — tasks close as
          cancelled and production entries are <span className="font-medium">waived</span>, with the QA signature left
          empty and your reason recorded on every record. That way the log shows these were reviewed and retired,
          rather than a gap an auditor has to ask about.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Anything due before</label>
          <input type="date" value={cutoff} max={today()} onChange={e => { setCutoff(e.target.value); setActive(null); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <button onClick={loadSummary} disabled={busy}
          className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
      {flash && <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2"><CheckCircle2 size={15} /> {flash}</p>}

      {!active && summary && (
        <div className="grid gap-3 sm:grid-cols-2">
          {summary.sources.map(s => (
            <button key={s.key} onClick={() => s.count && openSource(s.key)} disabled={!s.count}
              className={`text-left rounded-xl border p-4 transition-shadow ${s.count
                ? 'border-gray-200 bg-white hover:shadow-sm' : 'border-gray-100 bg-gray-50 cursor-default'}`}>
              <p className={`text-2xl font-bold ${s.count ? 'text-gray-900' : 'text-gray-300'}`}>{s.count}</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">{s.label}</p>
              <p className="text-[11px] text-gray-500 mt-1.5 leading-snug">{s.note}</p>
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-3">
          <button onClick={() => { setActive(null); setSelected(new Set()); }}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={15} /> All piles</button>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
            <span className="font-semibold">{src?.label}</span> — {src?.note}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason (goes on every record you close) *</label>
            <input value={reason} onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <button onClick={toggleAll} className="flex items-center gap-2 text-xs font-semibold text-gray-700 hover:text-powder-700">
                {allOn ? <SquareCheck size={15} /> : <Square size={15} />}
                {allOn ? 'Clear selection' : `Select all ${rows.length}`}
              </button>
              <span className="text-xs text-gray-500">Shift-click to tick a range</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto divide-y divide-gray-100">
              {rows.length === 0
                ? <p className="text-sm text-gray-500 p-4 text-center">Nothing left in this pile before {cutoff}.</p>
                : rows.map(r => <Row key={r.id} row={r} checked={selected.has(r.id)} onToggle={toggle} />)}
            </div>
          </div>

          {selected.size > 0 && (
            <div className="sticky bottom-0 flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3">
              <span className="text-sm font-medium text-gray-900">{selected.size} selected</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelected(new Set())} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
                <button onClick={close} disabled={busy || reason.trim().length < 3}
                  className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <AlertTriangle size={15} />}
                  Close {selected.size}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
