import { useState, useMemo, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete, apiUpload } from '../../hooks/useApi';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore.jsx';
import { CustomFields, CustomFieldValues } from '../common/CustomFields';
import ModuleTabs from '../common/ModuleTabs.jsx';
import {
  Archive, Plus, Search, FlaskConical, Trash2, Pencil, X, AlertTriangle,
  Boxes, CalendarClock, Upload, Check,
} from 'lucide-react';

// The Retention Sample log — the plant's physical library of what it made.
//
// Kept out of COA on purpose: a COA request is about a TEST, this is about an
// OBJECT in a box with a destruction date. They meet only where a pull's lab
// portion goes for testing, and that's a link, not a merge. The long version of
// the reasoning is at the top of server/api/retention.js.
//
// Two counts, never one. The paper writes "5 (2 LAB, 3 RETAIN)" in a single
// cell, but those are different objects with different fates — the lab samples
// leave the building, the retains stay until the box is destroyed — and one
// total can't answer "did the lab samples actually go out".

const STAGES = [
  { value: 'raw_material', label: 'Raw material', tone: 'bg-amber-100 text-amber-800' },
  { value: 'blend', label: 'Blend', tone: 'bg-purple-100 text-purple-800' },
  { value: 'intermediate', label: 'Intermediate', tone: 'bg-blue-100 text-blue-800' },
  { value: 'finished_good', label: 'Finished good', tone: 'bg-green-100 text-green-800' },
];
const stageMeta = (v) => STAGES.find(s => s.value === v) || { label: v || '—', tone: 'bg-gray-100 text-gray-700' };

const today = () => new Date().toISOString().slice(0, 10);

function StageChip({ stage }) {
  const m = stageMeta(stage);
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${m.tone}`}>{m.label}</span>;
}

/* ── Sample form ──────────────────────────────────────────────────────────── */

function SampleForm({ initial, boxes, onClose, onSaved }) {
  const [f, setF] = useState(() => initial || {
    stage: 'finished_good', item_number: '', item_name: '', lot_number: '', mo_number: '',
    expiration_date: '', retain_count: 1, lab_count: 0, sample_size: '', batches: '',
    collected_date: today(), box_id: '', comments: '',
  });
  const [custom, setCustom] = useState(() => {
    try { return initial?.custom_data ? JSON.parse(initial.custom_data) : {}; } catch { return {}; }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  // A raw-material retain is a fixed 90 g off an inbound lot, not a count of
  // jars — the log writes "90g" where finished goods write "2". Offering the
  // right field for the stage is the difference between a form people fill in
  // and one they work around.
  const isRaw = f.stage === 'raw_material';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const payload = { ...f, custom_data: custom, box_id: f.box_id || null };
      if (initial?.id) await apiPut(`/retention/${initial.id}`, payload);
      else await apiPost('/retention', payload);
      onSaved();
    } catch (err) { setError(err.message); setSaving(false); }
  };

  const openBoxes = (boxes || []).filter(b => b.status !== 'destroyed');

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <FlaskConical size={16} className="text-powder-600" />
            {initial?.id ? 'Correct retention record' : 'Log a retention pull'}
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Stage *</span>
              <select value={f.stage} onChange={e => set('stage', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Item number</span>
              <input value={f.item_number || ''} onChange={e => set('item_number', e.target.value)}
                placeholder="BD0156 / FG0968 / 202620"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Item name *</span>
            <input required value={f.item_name || ''} onChange={e => set('item_name', e.target.value)}
              placeholder="BLEND — ProDough Protein Pancake (Pumpkin)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Lot #</span>
              <input value={f.lot_number || ''} onChange={e => set('lot_number', e.target.value)}
                placeholder="100813 1-4" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">MO #</span>
              <input value={f.mo_number || ''} onChange={e => set('mo_number', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Expiration</span>
              <input type="date" value={f.expiration_date || ''} onChange={e => set('expiration_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>

          <div className="rounded-lg border border-gray-200 p-3 bg-gray-50/60">
            <p className="text-xs font-medium text-gray-700 mb-2">How many were pulled?</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Retains — kept here</span>
                <input type="number" min="0" value={f.retain_count} onChange={e => set('retain_count', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Lab — sent for testing</span>
                <input type="number" min="0" value={f.lab_count} onChange={e => set('lab_count', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  Sample size {isRaw && <span className="text-amber-700">(90 g)</span>}
                </span>
                <input value={f.sample_size || ''} onChange={e => set('sample_size', e.target.value)}
                  placeholder={isRaw ? '90g' : 'e.g. 100g'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </label>
            </div>
            <p className="text-[11px] text-gray-500 mt-2">
              Counted separately on purpose: the lab samples leave the building and come back as a result,
              the retains stay in the box until it&apos;s destroyed.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Batches</span>
              <input value={f.batches || ''} onChange={e => set('batches', e.target.value)}
                placeholder="1 & 2  ·  1 BEG, 1 MIDDLE, 1 END"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Collected</span>
              <input type="date" value={f.collected_date || ''} onChange={e => set('collected_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Box</span>
              <select value={f.box_id || ''} onChange={e => set('box_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Not boxed yet</option>
                {openBoxes.map(b => <option key={b.id} value={b.id}>Box {b.box_no}{b.destruction_date ? ` · destroy ${b.destruction_date}` : ''}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Comments</span>
            <textarea rows={2} value={f.comments || ''} onChange={e => set('comments', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>

          <CustomFields scope="retention_sample" values={custom} onChange={setCustom} title="Additional fields" />

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : initial?.id ? 'Save correction' : 'File it'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Boxes ────────────────────────────────────────────────────────────────── */

function BoxesTab({ boxes, refresh, canEdit, canDestroy, onOpenBox }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ box_no: '', destruction_date: '', location: '' });
  const [err, setErr] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    setErr(null);
    try { await apiPost('/retention/boxes', form); setAdding(false); setForm({ box_no: '', destruction_date: '', location: '' }); refresh(); }
    catch (e2) { setErr(e2.message); }
  };

  const destroy = async (b) => {
    const notes = window.prompt(`Record the destruction of box ${b.box_no}.\n\nHow and when were the samples disposed of?`);
    if (!notes?.trim()) return;
    try {
      await apiPost(`/retention/boxes/${b.id}/destroy`, { notes });
      refresh();
    } catch (e2) {
      // The server refuses an early destruction once, so the confirmation is a
      // deliberate second act rather than a checkbox nobody reads.
      if (/not due until/i.test(e2.message) && window.confirm(`${e2.message}\n\nDestroy it anyway?`)) {
        try { await apiPost(`/retention/boxes/${b.id}/destroy`, { notes, early: true }); refresh(); }
        catch (e3) { window.alert(e3.message); }
      } else window.alert(e2.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          Samples live in numbered boxes and a box carries one destruction date — that&apos;s how they&apos;re
          actually disposed of, a box at a time.
        </p>
        {canEdit && (
          <button onClick={() => setAdding(a => !a)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 shrink-0">
            <Plus size={13} /> New box
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={add} className="border border-gray-200 rounded-xl p-3 bg-gray-50/60 grid gap-3 sm:grid-cols-4 items-end">
          <label className="block sm:col-span-1">
            <span className="block text-xs font-medium text-gray-600 mb-1">Box #</span>
            <input required value={form.box_no} onChange={e => setForm({ ...form, box_no: e.target.value })}
              placeholder="20" className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Destruction date</span>
            <input type="date" value={form.destruction_date} onChange={e => setForm({ ...form, destruction_date: e.target.value })}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Where it is</span>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
              placeholder="QA Hold shelf 2" className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium">Open box</button>
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs">Cancel</button>
          </div>
          {err && <p className="text-xs text-red-600 sm:col-span-4">{err}</p>}
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(boxes || []).map(b => (
          <div key={b.id} className={`border rounded-xl p-3 ${b.status === 'destroyed' ? 'border-gray-200 bg-gray-50 opacity-75'
            : b.due_for_destruction ? 'border-red-300 bg-red-50/50' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => onOpenBox(b)} className="text-left min-w-0">
                <h4 className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <Boxes size={15} className="text-gray-400 shrink-0" /> Box {b.box_no}
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  {b.sample_count} pull{b.sample_count === 1 ? '' : 's'} · {b.retains} retain{b.retains === 1 ? '' : 's'}
                  {b.labs ? ` · ${b.labs} lab` : ''}
                </p>
              </button>
              {b.status === 'destroyed'
                ? <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200 text-gray-600 shrink-0">Destroyed</span>
                : b.due_for_destruction
                  ? <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700 shrink-0">Due</span>
                  : <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 shrink-0 capitalize">{b.status}</span>}
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-gray-600">
              {b.destruction_date && (
                <p className="flex items-center gap-1"><CalendarClock size={11} className="text-gray-400" /> Destroy after {b.destruction_date}</p>
              )}
              {b.location && <p className="text-gray-500">{b.location}</p>}
              {b.status === 'destroyed' && (
                <p className="text-gray-500 italic">
                  {b.destroyed_by} · {(b.destroyed_at || '').slice(0, 10)}
                  {b.destruction_notes ? ` — ${b.destruction_notes}` : ''}
                </p>
              )}
            </div>
            {canDestroy && b.status !== 'destroyed' && (
              <button onClick={() => destroy(b)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] text-red-600 hover:underline">
                <Trash2 size={11} /> Record destruction
              </button>
            )}
          </div>
        ))}
        {(boxes || []).length === 0 && (
          <p className="text-sm text-gray-400 py-6 col-span-full text-center">No boxes yet.</p>
        )}
      </div>
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

/* ── Importing a box from the paper log ───────────────────────────────────── */

// One sheet per box, and the preview is the point: it reads the file, says what
// it would create and what it could not read, and writes nothing until someone
// presses the button. Filing a retention log from a spreadsheet nobody checked
// is how the log stops being worth having.
function BoxImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const send = async (step) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiUpload(`/retention/import/${step}`, fd);
      if (step === 'preview') setPreview(r); else { setResult(r); onDone(); }
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Upload size={17} className="text-powder-600" /> Import a box from the log
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {result ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4">
              <p className="font-semibold text-green-900 flex items-center gap-1.5">
                <Check size={16} /> Box {result.box_no} imported
              </p>
              <p className="text-sm text-green-800 mt-1">
                {result.created} filed{result.updated ? `, ${result.updated} updated` : ''} ·{' '}
                {result.counts.retains} retains and {result.counts.lab} lab samples.
              </p>
              {result.problems > 0 && (
                <p className="text-xs text-green-800 mt-1">
                  {result.problems} row{result.problems === 1 ? '' : 's'} had something that couldn&apos;t be
                  read cleanly — they were filed with what was legible and are listed in the audit log.
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <span className="block text-xs font-medium text-gray-700 mb-1">The box&apos;s sheet</span>
                <input type="file" accept=".csv,text/csv" className="w-full text-sm"
                  onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setErr(null); }} />
                <p className="text-[11px] text-gray-500 mt-1">
                  One file per box, exactly as the log is kept — the BOX # banner, the destruction date, and
                  the BLEND / IM / FINISH GOOD sections.
                </p>
              </div>

              {preview && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="font-semibold text-gray-900">
                      Box {preview.box.box_no}
                      {preview.box.destruction_date && (
                        <span className="ml-2 font-normal text-sm text-gray-500">
                          destroy by {preview.box.destruction_date}
                        </span>
                      )}
                      {preview.box_exists && <span className="ml-2 text-xs text-amber-700">already in ReadyDoc</span>}
                    </p>
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="font-medium text-gray-900">{preview.summary.create}</span> to file
                      {preview.summary.update > 0 && <>, <span className="font-medium text-gray-900">{preview.summary.update}</span> to update</>}
                      {' '}· {preview.counts.retains} retains, {preview.counts.lab} lab
                    </p>
                    <p className="text-xs text-gray-500">
                      {Object.entries(preview.counts.by_stage || {}).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(' · ')}
                    </p>
                  </div>

                  {preview.box_destroyed && (
                    <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                      This box has already been destroyed. Its contents are the record of what was held and
                      won&apos;t be rewritten.
                    </p>
                  )}

                  {preview.problems?.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-amber-900">
                        {preview.problems.length} thing{preview.problems.length === 1 ? '' : 's'} to look at
                      </p>
                      <p className="text-[11px] text-amber-800 mb-1">
                        These rows still import — this is what the sheet itself is unclear about.
                      </p>
                      <ul className="text-xs text-amber-900 space-y-0.5 max-h-40 overflow-y-auto">
                        {preview.problems.map((p, i) => (
                          <li key={i}>
                            <span className="font-medium">Row {p.row}</span>
                            {p.item ? ` · ${p.item}` : ''} — {p.value}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Item</th>
                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Lot</th>
                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">Retain</th>
                            <th className="text-right px-2 py-1.5 font-medium text-gray-600">Lab</th>
                            <th className="text-left px-2 py-1.5 font-medium text-gray-600">Collected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(preview.samples || []).map((s, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-2 py-1 text-gray-800">
                                {s.item_name}
                                <span className="block text-[10px] text-gray-400">
                                  {s.stage.replace('_', ' ')}{s.action === 'update' ? ' · updates an existing row' : ''}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-gray-600">{s.lot_number || '—'}</td>
                              <td className="px-2 py-1 text-right font-medium">{s.retain_count}</td>
                              <td className="px-2 py-1 text-right text-gray-600">{s.lab_count || ''}</td>
                              <td className="px-2 py-1 text-gray-600 whitespace-nowrap">
                                {s.collected_date || <span className="text-amber-600">no date</span>}
                                {s.collected_by ? ` ${s.collected_by}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
              {err && <p className="text-sm text-red-600">{err}</p>}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && !preview && (
            <button onClick={() => send('preview')} disabled={!file || busy}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50">
              {busy ? 'Reading…' : 'Read it'}
            </button>
          )}
          {!result && preview && !preview.box_destroyed && (
            <button onClick={() => send('commit')} disabled={busy}
              className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Filing…' : `File ${preview.summary.create + preview.summary.update} record${preview.summary.create + preview.summary.update === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RetentionSamplesPanel({ user }) {
  const [tab, setTab] = useState('samples');
  const [stage, setStage] = useState('');
  const [boxFilter, setBoxFilter] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const expand = useRowExpand();

  const params = new URLSearchParams();
  if (stage) params.set('stage', stage);
  if (boxFilter) params.set('box_id', boxFilter);
  if (q.trim()) params.set('q', q.trim());
  const { data, refresh } = useApiGet(`/retention?${params.toString()}`, [stage, boxFilter, q]);
  const { data: boxes, refresh: refreshBoxes } = useApiGet('/retention/boxes');
  const { data: stats, refresh: refreshStats } = useApiGet('/retention/stats');

  const canEdit = ['admin', 'supervisor'].includes(user?.role)
    || ['qa', 'quality'].includes((user?.department || '').toLowerCase());
  const canDestroy = user?.role === 'admin'
    || (user?.role === 'supervisor' && ['qa', 'quality'].includes((user?.department || '').toLowerCase()));

  const samples = useMemo(() => data?.samples || [], [data]);
  const view = useCappedList(samples);

  const reloadAll = () => { refresh(); refreshBoxes(); refreshStats(); setEditing(null); };

  const remove = async (s) => {
    if (!window.confirm(`Delete the retention record for ${s.item_name}?`)) return;
    try { await apiDelete(`/retention/${s.id}`); reloadAll(); } catch (e) { window.alert(e.message); }
  };

  const due = stats?.due_for_destruction || 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Archive size={20} className="text-powder-600" /> Retention Samples
          </h2>
          <p className="text-sm text-gray-500 max-w-2xl">
            What was pulled and kept from each job — retains and lab samples counted separately, from raw
            material through to finished good, with the box each one lives in.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && (
            <button onClick={() => setImporting(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              <Upload size={15} /> Import a box
            </button>
          )}
          <button onClick={() => setEditing({})}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={15} /> Log a pull
          </button>
        </div>
      </div>

      {importing && <BoxImportModal onClose={() => setImporting(false)} onDone={reloadAll} />}

      {due > 0 && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{due}</span> box{due === 1 ? '' : 'es'} past the destruction date.
            <button onClick={() => setTab('boxes')} className="ml-1 underline">Review them</button>
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAGES.map(s => {
          const st = stats?.by_stage?.[s.value];
          return (
            <button key={s.value} onClick={() => { setTab('samples'); setStage(stage === s.value ? '' : s.value); }}
              className={`text-left border rounded-xl p-3 transition-colors ${stage === s.value ? 'border-powder-400 bg-powder-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
              <p className="text-lg font-bold text-gray-900">{st?.pulls || 0}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {st?.retains || 0} retain{(st?.retains || 0) === 1 ? '' : 's'}{st?.labs ? ` · ${st.labs} lab` : ''}
              </p>
            </button>
          );
        })}
      </div>

      <ModuleTabs value={tab} onChange={setTab} tabs={[
        { id: 'samples', label: 'Samples' },
        { id: 'boxes', label: 'Boxes', badge: boxes?.length },
      ]} />

      {tab === 'boxes' ? (
        <BoxesTab boxes={boxes} refresh={() => { refreshBoxes(); refreshStats(); }}
          canEdit={canEdit} canDestroy={canDestroy}
          onOpenBox={(b) => { setBoxFilter(b.id); setTab('samples'); }} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="Item, lot, MO, comment…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <select value={stage} onChange={e => setStage(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All stages</option>
              {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={boxFilter} onChange={e => setBoxFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All boxes</option>
              {(boxes || []).map(b => <option key={b.id} value={b.id}>Box {b.box_no}</option>)}
            </select>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {view.items.map(s => (
              <div key={s.id} className="bg-white border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm break-words">{s.item_name}</p>
                    <p className="text-xs text-gray-500">{s.item_number}{s.lot_number ? ` · Lot ${s.lot_number}` : ''}</p>
                  </div>
                  <StageChip stage={s.stage} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                  <span><span className="font-semibold text-gray-900">{s.retain_count}</span> retain</span>
                  {s.lab_count > 0 && <span><span className="font-semibold text-gray-900">{s.lab_count}</span> lab</span>}
                  {s.sample_size && <span>{s.sample_size}</span>}
                  {s.box_no && <span className="text-gray-500">Box {s.box_no}</span>}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  {s.collected_date}{s.collected_by ? ` · ${s.collected_by}` : ''}
                  {s.batches ? ` · batches ${s.batches}` : ''}
                </p>
                {s.comments && <p className="mt-1 text-xs text-gray-600">{s.comments}</p>}
                {canEdit && (
                  <button onClick={() => setEditing(s)} className="mt-2 text-xs text-powder-600 inline-flex items-center gap-1">
                    <Pencil size={11} /> Correct
                  </button>
                )}
              </div>
            ))}
            {samples.length === 0 && <p className="text-center text-sm text-gray-400 py-8">No retention records yet.</p>}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="w-8 px-2 py-2.5" />
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600">Item</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600">Stage</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Lot #</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Retain</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Lab</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Collected</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Box</th>
                    <th className="px-3 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {view.items.map(s => (
                    <Fragment key={s.id}>
                      <tr {...expand.rowProps(s.id)}>
                        <td className="px-2 py-2.5"><ExpandCell open={expand.isExpanded(s.id)} /></td>
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-gray-900">{s.item_name}</span>
                          {s.item_number && <span className="block text-xs text-gray-400">{s.item_number}</span>}
                        </td>
                        <td className="px-3 py-2.5"><StageChip stage={s.stage} /></td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{s.lot_number || '—'}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{s.retain_count}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600">{s.lab_count || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                          {s.collected_date || '—'}
                          {s.collected_by && <span className="block text-xs text-gray-400">{s.collected_by}</span>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                          {s.box_no ? `Box ${s.box_no}` : <span className="text-gray-300">unboxed</span>}
                          {s.box_status === 'destroyed' && <span className="block text-[10px] text-gray-400">destroyed</span>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap" onClick={stopRowClick}>
                          {canEdit && (
                            <button onClick={() => setEditing(s)} className="p-1 text-gray-400 hover:text-powder-600" data-tip="Correct">
                              <Pencil size={13} />
                            </button>
                          )}
                          {user?.role === 'admin' && (
                            <button onClick={() => remove(s)} className="p-1 text-gray-300 hover:text-red-600" data-tip="Delete">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {expand.isExpanded(s.id) && (
                        <DetailRow colSpan={9}>
                          <DetailFields fields={[
                            { label: 'MO #', value: s.mo_number },
                            { label: 'Expiration', value: s.expiration_date },
                            { label: 'Sample size', value: s.sample_size },
                            { label: 'Batches', value: s.batches },
                            { label: 'Box destruction date', value: s.destruction_date },
                            { label: 'Comments', value: s.comments },
                            { label: 'Filed by', value: s.created_by },
                          ]} />
                          <CustomFieldValues scope="retention_sample" data={s.custom_data} className="mt-2" />
                        </DetailRow>
                      )}
                    </Fragment>
                  ))}
                  {samples.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-400">No retention records yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <ShowMore view={view} noun="records" />
          {data?.truncated && (
            <p className="text-xs text-amber-700">
              Showing the most recent {samples.length} of {data.total}. Narrow it with a filter or a search.
            </p>
          )}
        </>
      )}

      {editing && (
        <SampleForm initial={editing.id ? editing : null} boxes={boxes}
          onClose={() => setEditing(null)} onSaved={reloadAll} />
      )}
    </div>
  );
}
