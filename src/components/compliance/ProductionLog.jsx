import { useState, useMemo, Fragment } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { ClipboardList, Plus, CheckCircle, Filter, Package, Hash, Clock, AlertCircle, X, ChevronUp, ChevronDown, Check, Undo2, Pencil } from 'lucide-react';
import { localDateStr, daysAgoStr } from '../../utils/dates';
import { hasExplicitGrant } from '../../utils/permissions';
import { PRODUCTION_LINES, lineLabel, FILLING_TEAM } from '../../constants/productionLines';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore.jsx';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';

const TEAMS = ['Batching', 'Filling', 'Kitting', 'Quality', 'Warehouse', 'Sanitation', 'Other'];
const ROOMS = ['Batching 1', 'Batching 2', ...Array.from({ length: 16 }, (_, i) => String(i)), 'Other'];

function formatDate(d) {
  if (!d) return '';
  // Parse date-only strings as local time; new Date('YYYY-MM-DD') is UTC
  // midnight, which renders as the previous day in US timezones
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (y && m && day) return new Date(y, m - 1, day).toLocaleDateString();
  return new Date(d).toLocaleDateString();
}

function formatTime(t) {
  if (!t) return '';
  // Handle both "HH:mm" and full ISO strings
  if (t.length <= 5) return t;
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function todayStr() {
  return localDateStr();
}

function thirtyDaysAgo() {
  return daysAgoStr(30);
}

const INITIAL_FORM = {
  date: todayStr(),
  team: '',
  line: '',
  room: '',
  product_name: '',
  mo_number: '',
  lot_number: '',
  start_time: '',
  end_time: '',
  quantity_completed: '',
  people_count: '',
  notes: '',
};

/* ── Multi-MO lines (a Batching shift runs several MOs) ──── */

const blankMoLine = () => ({ product_name: '', mo_number: '', lot_number: '', batches: '', batch_weights: '', quantity: '' });
// Which teams record more than one MO in a single shift. Batching blends
// several orders a day; Filling/Kitting stay one MO per entry.
const usesMoLines = (team) => team === 'Batching';

// Repeatable MO editor: one card per manufacturing order worked in the shift.
// Reused by the entry form and the amend modal so both build the same shape.
function MoLinesField({ lines, setLines }) {
  const setLine = (i, patch) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => setLines(ls => [...ls, blankMoLine()]);
  const remove = (i) => setLines(ls => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));
  const cls = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-gray-500">MO {i + 1}</span>
            {lines.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="p-0.5 text-gray-400 hover:text-red-600" title="Remove this MO"><X size={14} /></button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-gray-600 mb-0.5">Product</label>
              <input value={l.product_name} onChange={e => setLine(i, { product_name: e.target.value })} className={cls} placeholder="Product name" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">MO #</label>
              <input value={l.mo_number} onChange={e => setLine(i, { mo_number: e.target.value })} className={cls} placeholder="MO #" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Lot #</label>
              <input value={l.lot_number} onChange={e => setLine(i, { lot_number: e.target.value })} className={cls} placeholder="Lot #" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Batches</label>
              <input type="number" min="0" value={l.batches} onChange={e => setLine(i, { batches: e.target.value })} className={cls} placeholder="0" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-0.5">Quantity (optional)</label>
              <input type="number" min="0" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} className={cls} placeholder="0" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-gray-600 mb-0.5">Batch weights</label>
              <input value={l.batch_weights} onChange={e => setLine(i, { batch_weights: e.target.value })} className={cls} placeholder="No.1=273.4kg, No.2=273.6kg" />
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={add}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
        <Plus size={13} /> Add another MO
      </button>
    </div>
  );
}

// A saved entry's MO lines, read-only, for the log. Falls back to the scalar
// columns for pre-multi-MO entries so old rows still render.
function MoLinesSummary({ lines }) {
  if (!Array.isArray(lines) || !lines.length) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {lines.map((l, i) => (
        <div key={i} className="text-xs text-gray-700">
          <span className="font-medium text-gray-900">{l.mo_number || '—'}</span>
          {l.product_name && <span> · {l.product_name}</span>}
          {l.lot_number && <span className="text-gray-500"> · Lot {l.lot_number}</span>}
          {(l.batches != null && l.batches !== '') && <span className="text-gray-500"> · {l.batches} batch{Number(l.batches) === 1 ? '' : 'es'}</span>}
          {l.batch_weights && <span className="text-gray-500"> · {l.batch_weights}</span>}
          {(l.quantity != null && l.quantity !== '') && <span className="text-gray-500"> · qty {Number(l.quantity).toLocaleString()}</span>}
        </div>
      ))}
    </div>
  );
}

/* ── EOD template fields (per-team structured survey) ────── */

// One input for a template field. Types mirror the server: text / number /
// select / checkbox / textarea. Kept dumb so it's reused by the entry form.
function EodField({ field, value, onChange }) {
  const cls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-1 mt-5">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
        {field.label}{field.required && ' *'}
      </label>
    );
  }
  return (
    <div className={field.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{field.label}{field.required && ' *'}</label>
      {field.type === 'select' ? (
        <select required={field.required} value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls}>
          <option value="">Select…</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea required={field.required} value={value ?? ''} onChange={e => onChange(e.target.value)} rows={2} className={cls} />
      ) : (
        <input type={field.type === 'number' ? 'number' : 'text'} required={field.required}
          value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls} />
      )}
    </div>
  );
}

// Read-only render of a saved structured EOD answer set, shown on the log entry.
function EodSummary({ template, data }) {
  if (!data || typeof data !== 'object') return null;
  // Start from the template's field order/labels, then append any answer keys
  // the current template no longer defines — a saved record must never lose
  // data on display just because the template was edited afterwards.
  const tplFields = template?.fields || [];
  const known = new Set(tplFields.map(f => f.key));
  const orphanFields = Object.keys(data)
    .filter(k => !known.has(k))
    .map(k => ({ key: k, label: k.replace(/_/g, ' '), type: 'text' }));
  const fields = [...tplFields, ...orphanFields];
  const shown = fields.filter(f => { const v = data[f.key]; return v !== '' && v != null && v !== false; });
  if (!shown.length) return null;
  const fmt = (f) => f.type === 'checkbox' ? (data[f.key] ? 'Yes' : 'No') : String(data[f.key]);
  return (
    <div className="mt-2 rounded-lg border border-powder-100 bg-powder-50/40 px-2.5 py-1.5">
      <p className="text-[11px] font-semibold text-powder-800 mb-1">{template?.title || 'EOD report'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
        {shown.map(f => (
          <div key={f.key} className="text-xs text-gray-700">
            <span className="text-gray-400">{f.label}:</span> {fmt(f)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Entry Form ──────────────────────────────────────────── */

function EntryForm({ user, onSuccess }) {
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // Per-team EOD templates: the extra structured survey a team fills in beyond
  // the shared fields. `structured` holds this entry's answers.
  const { data: templates } = useApiGet('/production/eod-templates');
  const [structured, setStructured] = useState({});
  const template = templates?.[form.team] || null;
  // Multi-MO teams (Batching) record a line per order instead of one MO.
  const multiMo = usesMoLines(form.team);
  const [moLines, setMoLines] = useState([blankMoLine()]);

  const set = (key, val) => setForm(prev => ({
    ...prev,
    [key]: val,
    // A line only means something on a Filling run.
    ...(key === 'team' && val !== FILLING_TEAM ? { line: '' } : {}),
  }));
  // Switching teams starts the survey fresh — a Batching answer shouldn't carry
  // into a Filling report.
  const setTeam = (val) => { set('team', val); setStructured({}); setMoLines([blankMoLine()]); };
  const setField = (k, v) => setStructured(s => ({ ...s, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Multi-MO teams need at least one line with an MO number; the shared
    // scalar MO/product/lot come from that first line server-side.
    if (multiMo && !moLines.some(l => l.mo_number.trim() || l.product_name.trim())) {
      setMessage({ type: 'error', text: 'Add at least one MO (with an MO # or product).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        ...form,
        people_count: Number(form.people_count),
        submitted_by: user.name,
        structured_data: template ? structured : undefined,
      };
      if (multiMo) {
        // Let the server derive product/MO/lot/quantity from the lines.
        payload.mo_lines = moLines;
        delete payload.product_name; delete payload.mo_number;
        delete payload.lot_number; delete payload.quantity_completed;
      } else {
        payload.quantity_completed = Number(form.quantity_completed);
      }
      await apiPost('/production/entries', payload);
      setMessage({ type: 'success', text: 'Entry submitted successfully.' });
      setForm({ ...INITIAL_FORM, date: todayStr() });
      setStructured({});
      onSuccess?.();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to submit entry.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <Plus size={16} /> New Production Entry
      </h3>

      {message && (
        <div className={`px-3 py-2 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Today's Date *</label>
          <input required type="date" value={form.date} onChange={e => set('date', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Team *</label>
          <select required value={form.team} onChange={e => setTeam(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select team...</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Room *</label>
          <select required value={form.room} onChange={e => set('room', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select room...</option>
            {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {/* Filling is one team across several machines, so the run records
            which line it went through. */}
        {form.team === FILLING_TEAM && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Line *</label>
            <select required value={form.line} onChange={e => set('line', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Select line...</option>
              {PRODUCTION_LINES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>
        )}
        {/* Single MO fields — hidden for multi-MO teams, which use the MO-line
            editor below so a shift can carry several orders. */}
        {!multiMo && (<>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Product Name *</label>
            <input required value={form.product_name} onChange={e => set('product_name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Product name" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">MO # *</label>
            <input required value={form.mo_number} onChange={e => set('mo_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Manufacturing order #" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Lot # *</label>
            <input required value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Lot number" />
          </div>
        </>)}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Project Start Time *</label>
          <input required type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Project End Time *</label>
          <input required type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        {!multiMo && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Quantity Completed *</label>
            <input required type="number" min="0" value={form.quantity_completed} onChange={e => set('quantity_completed', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"># of People Working *</label>
          <input required type="number" min="1" value={form.people_count} onChange={e => set('people_count', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="1" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes / Observations</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Optional notes..." />
        </div>
      </div>

      {/* Multi-MO editor — Batching fills the shift once above, then adds a
          line per manufacturing order worked. */}
      {multiMo && (
        <div className="rounded-lg border border-powder-200 bg-powder-50/50 p-3">
          <p className="text-xs font-semibold text-powder-800 mb-2">MOs worked this shift</p>
          <MoLinesField lines={moLines} setLines={setMoLines} />
        </div>
      )}

      {/* Team-specific EOD survey — only appears when the selected team has a
          template. Batching sees blend/yield fields; Filling/Kitting see their
          own (or nothing, until QA builds one). */}
      {template && template.fields?.length > 0 && (
        <div className="rounded-lg border border-powder-200 bg-powder-50/50 p-3">
          <p className="text-xs font-semibold text-powder-800 mb-2">{template.title || `${form.team} EOD Report`}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {template.fields.map(f => (
              <EodField key={f.key} field={f} value={structured[f.key]} onChange={v => setField(f.key, v)} />
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Submitting...' : 'Submit Entry'}
        </button>
      </div>
    </form>
  );
}

/* ── QA Signoff Modal ────────────────────────────────────── */

function QASignoffModal({ entry, user, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  // Most QA notes are just notes. This says the note is a correction request,
  // which puts the entry on the submitter's list and lets them amend it.
  const [needsCorrection, setNeedsCorrection] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (needsCorrection && !notes.trim()) {
      setError('Say what needs correcting in the notes before flagging this entry.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/production/entries/${entry.id}/qa-signoff`, {
        qa_signoff_by: user.name,
        qa_notes: notes,
        qa_action_required: needsCorrection,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Signoff failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">QA Signoff</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600">
          Signing off on <span className="font-medium">{entry.product_name}</span> &mdash; MO #{entry.mo_number}
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">QA Reviewer</label>
          <input readOnly value={user.name} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">QA Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Optional QA notes..." />
        </div>
        <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${needsCorrection ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
          <input type="checkbox" checked={needsCorrection} onChange={e => setNeedsCorrection(e.target.checked)} className="mt-0.5" />
          <span className="text-sm text-gray-800">
            This note needs a correction
            <span className="block text-[11px] text-gray-500 mt-0.5">
              {entry.submitted_by || 'The supervisor who filed it'} is prompted to amend this entry, and can do so without
              a standing edit grant. It returns to Pending QA once corrected.
            </span>
          </span>
        </label>
        {error && <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Signing...' : 'Sign Off'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── QA correction requests ──────────────────────────────── */

// A flagged QA note is useless if the supervisor never sees it, and they have
// no reason to re-open an entry they filed days ago. This sits at the top of
// the log — the page they're already on to file the next report — and lists
// what QA has asked them to fix, with the correction one click away.
function QACorrections({ user, onAmend, refreshKey }) {
  const { data: rows } = useApiGet('/production/entries/qa-actions', [refreshKey]);
  const open = rows || [];
  if (!open.length) return null;
  const mine = open.filter(e => e.submitted_by === user?.name);
  const others = open.filter(e => e.submitted_by !== user?.name);
  const render = (list, heading) => list.length > 0 && (
    <>
      {heading && <p className="text-[11px] font-semibold uppercase text-amber-700/70 mt-2">{heading}</p>}
      <ul className="mt-1 space-y-1.5">
        {list.map(e => (
          <li key={e.id} className="rounded-lg bg-white/70 border border-amber-200 px-3 py-2">
            <div className="text-sm font-medium text-amber-900">
              {formatDate(e.date)} · {e.product_name} · MO #{e.mo_number}
              {e.submitted_by !== user?.name && <span className="font-normal"> — {e.submitted_by}</span>}
            </div>
            <div className="text-xs text-amber-900/90 mt-0.5">
              <span className="font-medium">{e.qa_signoff_by || 'QA'}:</span> {e.qa_notes}
            </div>
            <button type="button" onClick={() => onAmend(e)}
              className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700">
              <Pencil size={12} /> Correct this entry
            </button>
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2">
        <AlertCircle size={16} className="text-amber-700" />
        <h3 className="font-semibold text-amber-900">
          QA asked for {open.length === 1 ? 'a correction' : `${open.length} corrections`}
        </h3>
      </div>
      {render(mine, others.length ? 'Yours' : null)}
      {render(others, 'Other supervisors')}
    </div>
  );
}

/* ── Amendments ──────────────────────────────────────────── */

// The fields a correction may touch, mirroring AMENDABLE on the server. `date`
// is deliberately not here: a report filed against the wrong day is a
// different record, not a typo.
const AMEND_FIELDS = [
  { key: 'product_name', label: 'Product', type: 'text' },
  { key: 'mo_number', label: 'MO #', type: 'text' },
  { key: 'lot_number', label: 'Lot #', type: 'text' },
  { key: 'team', label: 'Team', type: 'select', options: TEAMS },
  { key: 'line', label: 'Line', type: 'select', options: ['', ...PRODUCTION_LINES.map(l => l.value)] },
  { key: 'room', label: 'Room', type: 'select', options: ROOMS },
  { key: 'start_time', label: 'Start time', type: 'time' },
  { key: 'end_time', label: 'End time', type: 'time' },
  { key: 'quantity_completed', label: 'Quantity completed', type: 'number' },
  { key: 'people_count', label: 'People', type: 'number' },
  { key: 'submitted_by', label: 'Submitted by', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const MIN_REASON = 10;

const fmtStamp = (ts) => (ts ? new Date(ts).toLocaleString() : '');
const showVal = (v) => (v === null || v === undefined || v === '' ? '(blank)' : String(v));

// The correction trail, shown on the record itself. An auditor should be able
// to see that an entry was amended, what changed, who changed it and why,
// without leaving the log to go dig through the audit report.
function AmendmentTrail({ amendments }) {
  if (!amendments?.length) return null;
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <p className="text-xs font-semibold text-amber-900">
        Amended {amendments.length === 1 ? '1 time' : `${amendments.length} times`}
      </p>
      <ol className="mt-1 space-y-2">
        {amendments.map((a, i) => (
          <li key={a.id || i} className="text-[11px] text-amber-900/90">
            <div className="font-medium">
              {fmtStamp(a.amended_at)} · {a.amended_by}
              {a.amended_by_role ? ` (${a.amended_by_role})` : ''}
            </div>
            <ul className="ml-3 list-disc">
              {(a.changes || []).map((c, j) => (
                <li key={j}>
                  <span className="font-medium">{c.label || c.field}:</span>{' '}
                  <span className="line-through opacity-70">{showVal(c.from)}</span> → <span className="font-semibold">{showVal(c.to)}</span>
                </li>
              ))}
            </ul>
            <div className="ml-3">Reason: {a.reason}</div>
            {a.resolves_qa_action && (
              <div className="ml-3 italic">Made in response to a QA correction request.</div>
            )}
            {a.retired_qa_signoff && (
              <div className="ml-3 italic">
                Prior QA sign-off by {a.retired_qa_signoff.by} ({fmtStamp(a.retired_qa_signoff.at)}) was retired — the entry returned to Pending QA.
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Correcting a filed report. Deliberately heavier than an edit form: the reason
// is mandatory, the attestation is spelled out, and re-signing is called out
// before you commit rather than discovered afterwards.
function AmendModal({ entry, onClose, onSaved }) {
  // Entries with MO lines edit those instead of the scalar product/MO/lot/qty,
  // which the server derives from line 0.
  const multiMo = Array.isArray(entry.mo_lines) && entry.mo_lines.length > 0;
  const HIDDEN_FOR_MO = new Set(['product_name', 'mo_number', 'lot_number', 'quantity_completed']);
  const amendFields = multiMo ? AMEND_FIELDS.filter(f => !HIDDEN_FOR_MO.has(f.key)) : AMEND_FIELDS;

  const [form, setForm] = useState(() => {
    const f = {};
    for (const { key } of AMEND_FIELDS) f[key] = entry[key] ?? '';
    return f;
  });
  const [moLines, setMoLines] = useState(() =>
    (entry.mo_lines || []).map(l => ({
      product_name: l.product_name || '', mo_number: l.mo_number || '', lot_number: l.lot_number || '',
      batches: l.batches ?? '', batch_weights: l.batch_weights || '', quantity: l.quantity ?? '',
    })));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const changed = amendFields.filter(f => String(entry[f.key] ?? '') !== String(form[f.key] ?? ''));
  // Compare the line list to the saved one (normalized to strings) to know if
  // the MOs were edited.
  const norm = (ls) => JSON.stringify((ls || []).map(l => ({
    product_name: String(l.product_name || '').trim(), mo_number: String(l.mo_number || '').trim(),
    lot_number: String(l.lot_number || '').trim(), batches: l.batches === '' || l.batches == null ? '' : String(l.batches),
    batch_weights: String(l.batch_weights || '').trim(), quantity: l.quantity === '' || l.quantity == null ? '' : String(l.quantity),
  })).filter(l => l.mo_number || l.product_name));
  const moChanged = multiMo && norm(moLines) !== norm(entry.mo_lines);
  const ready = (changed.length > 0 || moChanged) && reason.trim().length >= MIN_REASON;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const patch = { reason: reason.trim() };
      for (const f of changed) patch[f.key] = form[f.key];
      if (moChanged) patch.mo_lines = moLines;
      await apiPut(`/production/entries/${entry.id}`, patch);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the correction.');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto sm:p-4">
      <form onSubmit={submit} className="bg-white w-full max-w-2xl min-h-full sm:min-h-0 sm:rounded-xl sm:my-6 shadow-xl">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-gray-200 sticky top-0 bg-white sm:rounded-t-xl z-10">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">Correct this entry</h3>
            <p className="text-[11px] text-gray-500 truncate">
              {entry.product_name} · MO {entry.mo_number} · {formatDate(entry.date)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">This is a correction, not an edit.</p>
            <p className="mt-0.5">
              The original values are kept and shown on the record along with your name, the time, and your
              reason. Nothing is overwritten or deleted.
            </p>
            {entry.qa_signoff_by && (
              <p className="mt-1 font-medium">
                This entry was signed off by {entry.qa_signoff_by}. Correcting it retires that sign-off and
                returns the entry to Pending QA, because a signature can only attest to what was reviewed.
              </p>
            )}
          </div>

          {multiMo && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">MOs worked this shift</p>
              <MoLinesField lines={moLines} setLines={setMoLines} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {amendFields.map(f => {
              const dirty = String(entry[f.key] ?? '') !== String(form[f.key] ?? '');
              const cls = `w-full px-3 py-2 border rounded-lg text-sm ${dirty ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`;
              const set = (v) => setForm(s => ({ ...s, [f.key]: v }));
              return (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {f.label}
                    {dirty && <span className="ml-1 text-[10px] font-semibold text-amber-700">was {showVal(entry[f.key])}</span>}
                  </label>
                  {f.type === 'select' ? (
                    <select value={form[f.key]} onChange={e => set(e.target.value)} className={cls}>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea value={form[f.key]} onChange={e => set(e.target.value)} rows={2} className={cls} />
                  ) : (
                    <input type={f.type} step={f.type === 'number' ? 'any' : undefined}
                      value={form[f.key]} onChange={e => set(e.target.value)} className={cls} />
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Reason for the correction <span className="text-red-600">*</span>
            </label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="e.g. Samples pulled for QA were not included in the original quantity."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="mt-1 text-[11px] text-gray-500">
              {reason.trim().length < MIN_REASON
                ? `At least ${MIN_REASON} characters — this becomes part of the permanent record.`
                : 'This becomes part of the permanent record.'}
            </p>
          </div>

          {changed.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-700">You are changing {changed.length === 1 ? '1 field' : `${changed.length} fields`}:</p>
              <ul className="mt-1 ml-4 list-disc text-[11px] text-gray-600">
                {changed.map(f => (
                  <li key={f.key}>
                    {f.label}: <span className="line-through">{showVal(entry[f.key])}</span> → <span className="font-semibold">{showVal(form[f.key])}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-gray-500 italic">
            By saving, you certify that this correction is accurate, that the reason above is truthful, and
            that the original entry has been preserved. Recorded under your name.
          </p>

          {error && <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-4 sm:px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white sm:rounded-b-xl">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={!ready || saving}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
            {saving ? 'Recording…' : 'Record correction'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Summary KPI Cards ───────────────────────────────────── */

function SummaryCards({ from, to }) {
  const { data } = useApiGet(`/production/entries/summary?from=${from}&to=${to}`, [from, to]);

  const cards = [
    { label: 'Total Entries', value: data?.total_entries ?? '--', icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'Total Output', value: data?.total_quantity != null ? Number(data.total_quantity).toLocaleString() : '--', icon: Package, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Active MOs', value: data?.unique_mos ?? '--', icon: Hash, color: 'text-purple-600 bg-purple-50' },
    { label: 'Pending QA', value: data?.entries_pending_qa ?? '--', icon: AlertCircle, color: 'text-amber-600 bg-amber-50' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-500">{c.label}</span>
            <div className={`p-2 rounded-lg ${c.color}`}><c.icon size={18} /></div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Production Log Table ────────────────────────────────── */

const SORT_COLUMNS = [
  { label: 'Date', key: 'date', type: 'date' },
  { label: 'Team', key: 'team', type: 'string' },
  { label: 'Room', key: 'room', type: 'string' },
  { label: 'Product', key: 'product_name', type: 'string' },
  { label: 'MO #', key: 'mo_number', type: 'string' },
  { label: 'Lot #', key: 'lot_number', type: 'string' },
  { label: 'Start', key: 'start_time', type: 'string' },
  { label: 'End', key: 'end_time', type: 'string' },
  { label: 'Duration', key: 'duration_hours', type: 'number' },
  { label: 'Qty', key: 'quantity_completed', type: 'number' },
  { label: 'People', key: 'people_count', type: 'number' },
  { label: 'Units/Hr', key: 'units_per_hour', type: 'number' },
  { label: 'Units/Min/Person', key: 'units_per_min_per_person', type: 'number' },
  { label: 'QA Status', key: 'qa_signoff_by', type: 'boolean' },
];

function MissedReports({ from, to, user }) {
  // Start collapsed — it's a compact summary line that QA expands when reviewing.
  const [open, setOpen] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(null); // dismiss_key of the row being reviewed
  const [reason, setReason] = useState('');
  const canManage = user?.role === 'admin' || user?.role === 'supervisor';
  // Managers always load dismissed too, so the review/restore stays reachable
  // even once every active callout has been cleared.
  const { data: missed, refresh } = useApiGet(
    `/production/missed-reports?from=${from}&to=${to}${canManage ? '&include_dismissed=1' : ''}`, [from, to]);
  const rows = missed || [];
  const active = rows.filter(r => !r.dismissed);
  const dismissedRows = rows.filter(r => r.dismissed);
  const activeCount = active.length;
  if (rows.length === 0) return null;
  const displayRows = showDismissed ? rows : active;

  const doDismiss = async (m) => {
    try { await apiPost('/production/missed-reports/dismiss', { date: m.date, room: m.room, mo_number: m.mo_number, team: m.team, reason }); }
    catch (e) { alert(e.message || 'Could not dismiss'); return; }
    setDismissing(null); setReason(''); refresh();
  };
  const doRestore = async (m) => {
    try { await apiPost('/production/missed-reports/restore', { dismiss_key: m.dismiss_key }); } catch { /* ignore */ }
    refresh();
  };
  const colSpan = canManage ? 6 : 5;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <AlertCircle size={16} className="text-amber-600 shrink-0" />
        <span className="text-sm font-medium text-amber-900">
          {activeCount > 0
            ? `${activeCount} scheduled production ${activeCount === 1 ? 'run has' : 'runs have'} no end-of-day report`
            : 'All end-of-day reports accounted for'}
        </span>
        {open ? <ChevronUp size={15} className="ml-auto text-amber-600" /> : <ChevronDown size={15} className="ml-auto text-amber-600" />}
      </button>
      {open && (
        <div className="border-t border-amber-200">
          {canManage && dismissedRows.length > 0 && (
            <div className="px-4 py-2 flex justify-end">
              <label className="flex items-center gap-1.5 text-xs text-amber-800 cursor-pointer select-none">
                <input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)} /> Show dismissed ({dismissedRows.length})
              </label>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-100/50 text-amber-900">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Room</th>
                  <th className="text-left px-4 py-2 font-medium">Team</th>
                  <th className="text-left px-4 py-2 font-medium">MO #</th>
                  <th className="text-left px-4 py-2 font-medium">Product</th>
                  {canManage && <th className="text-right px-4 py-2 font-medium">Review</th>}
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 && (
                  <tr><td colSpan={colSpan} className="px-4 py-3 text-sm text-gray-500 italic">No outstanding reports — {dismissedRows.length} cleared. Toggle above to review.</td></tr>
                )}
                {displayRows.map((m) => (
                  <Fragment key={m.dismiss_key}>
                    <tr className={`border-t border-amber-100 ${m.dismissed ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-2 text-amber-900 whitespace-nowrap">{formatDate(m.date)}{m.days_ago > 0 ? <span className="text-amber-600 text-xs"> · {m.days_ago}d ago</span> : ''}</td>
                      <td className="px-4 py-2 text-gray-700">{m.room}</td>
                      <td className="px-4 py-2 font-medium text-gray-800">{m.team || '—'}</td>
                      <td className="px-4 py-2 text-gray-600">{m.mo_number || '—'}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {m.product_name || '—'}
                        {m.dismissed && <div className="text-[11px] text-gray-500 italic mt-0.5">Dismissed{m.dismissed_by ? ` by ${m.dismissed_by}` : ''}{m.dismiss_reason ? ` — ${m.dismiss_reason}` : ''}</div>}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {m.dismissed ? (
                            <button onClick={() => doRestore(m)} className="text-xs text-amber-700 hover:underline inline-flex items-center gap-1"><Undo2 size={13} /> Restore</button>
                          ) : dismissing !== m.dismiss_key && (
                            <button onClick={() => { setDismissing(m.dismiss_key); setReason(''); }} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><X size={13} /> Dismiss</button>
                          )}
                        </td>
                      )}
                    </tr>
                    {canManage && dismissing === m.dismiss_key && (
                      <tr className="border-t border-amber-100 bg-amber-100/40">
                        <td colSpan={colSpan} className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                              placeholder="Reason / note (e.g. operator notified, run cancelled)…"
                              onKeyDown={e => { if (e.key === 'Enter') doDismiss(m); if (e.key === 'Escape') { setDismissing(null); setReason(''); } }}
                              className="flex-1 px-2 py-1 border border-amber-300 rounded text-sm" />
                            <button onClick={() => doDismiss(m)} className="px-2.5 py-1 bg-amber-600 text-white rounded text-xs font-medium inline-flex items-center gap-1 hover:bg-amber-700"><Check size={13} /> Dismiss</button>
                            <button onClick={() => { setDismissing(null); setReason(''); }} className="px-2 py-1 text-gray-500 text-xs hover:text-gray-700">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LogTable({ user }) {
  const [from, setFrom] = useState(thirtyDaysAgo());
  const [to, setTo] = useState(todayStr());
  const [teamFilter, setTeamFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [moSearch, setMoSearch] = useState('');
  const [signoffEntry, setSignoffEntry] = useState(null);
  const [amendEntry, setAmendEntry] = useState(null);
  // Bumped whenever a sign-off or amendment lands, so the corrections banner
  // re-fetches alongside the log instead of going stale.
  const [dataVersion, setDataVersion] = useState(0);
  const refreshAll = () => { refresh(); setDataVersion(v => v + 1); };
  const expand = useRowExpand();
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  const { data: entries, loading, error, refresh } = useApiGet(
    `/production/entries?from=${from}&to=${to}`, [from, to]
  );
  // Team → template map, so a saved entry's structured answers render with
  // their proper field labels/order instead of raw keys.
  const { data: templates } = useApiGet('/production/eod-templates');
  // Flavor approval decisions keyed by MO #, so a run shows whether its batch
  // was tasted and approved without opening another module.
  const { data: flavorByMo } = useApiGet('/qms/flavor-approvals/by-mo');

  const canSignoff = user.department === 'qa' || user.role === 'admin';
  // Correcting a filed report is a deliberate, separately granted right —
  // filing an EOD report does not carry the right to change one afterwards.
  // Mirrors canEditLog() in server/api/production.js exactly, so the button
  // never appears to someone the server would reject.
  const ma = user?.module_access;
  const canAmendAny = user?.role === 'admin'
    || !!(ma && !Array.isArray(ma) && ma['production-log'] === 'edit');
  // A QA correction request is a one-entry invitation to amend, so the person
  // who filed that entry can fix it without being granted the whole log.
  // Mirrors the `invited` check in the server's PUT /entries/:id.
  const canAmendEntry = (e) => canAmendAny
    || (!!e?.qa_action_required && !e?.qa_action_resolved_at && e?.submitted_by === user?.name);

  const filtered = useMemo(() => {
    if (!entries) return [];
    let rows = Array.isArray(entries) ? entries : entries.data || [];
    if (teamFilter) rows = rows.filter(r => r.team === teamFilter);
    if (roomFilter) rows = rows.filter(r => r.room === roomFilter);
    if (moSearch) {
      const q = moSearch.toLowerCase();
      rows = rows.filter(r => (r.mo_number || '').toLowerCase().includes(q)
        || (Array.isArray(r.mo_lines) && r.mo_lines.some(l => (l.mo_number || '').toLowerCase().includes(q))));
    }

    const col = SORT_COLUMNS.find(c => c.key === sortCol);
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let cmp;
      if (col?.type === 'date') {
        cmp = new Date(a[sortCol]) - new Date(b[sortCol]);
      } else if (col?.type === 'number') {
        cmp = (Number(a[sortCol]) || 0) - (Number(b[sortCol]) || 0);
      } else if (col?.type === 'boolean') {
        cmp = (a[sortCol] ? 1 : 0) - (b[sortCol] ? 1 : 0);
      } else {
        cmp = (a[sortCol] || '').toString().toLowerCase().localeCompare((b[sortCol] || '').toString().toLowerCase());
      }
      return cmp * dir;
    });
    return rows;
  }, [entries, teamFilter, roomFilter, moSearch, sortCol, sortDir]);

  // Cap what's in the DOM; `filtered` decides what's in the list.
  const view = useCappedList(filtered);

  return (
    <div className="space-y-4">
      {/* Corrections QA has asked for, on the page the supervisor already opens
          to file the next report. Everyone sees their own; the endpoint only
          returns other people's to admins and log editors. */}
      <QACorrections user={user} onAmend={setAmendEntry} refreshKey={dataVersion} />
      {/* Missed end-of-day reports are a QA review tool — only QA (and admins) see them. */}
      {(user?.role === 'admin' || user?.department === 'qa') && <MissedReports from={from} to={to} user={user} />}
      <SummaryCards from={from} to={to} />

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Team</label>
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Teams</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Room</label>
            <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Rooms</option>
              {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">MO # Search</label>
            <input value={moSearch} onChange={e => setMoSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Search MO #..." />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading && <div className="text-center py-8 text-gray-500 text-sm">Loading entries...</div>}
      {error && <div className="text-center py-8 text-red-600 text-sm">{error}</div>}

      {/* Mobile: card view */}
      {!loading && !error && (
        <div className="md:hidden space-y-2">
          {filtered.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-500">No entries found.</div>
          )}
          {view.items.map(entry => (
            <div key={entry.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${entry.qa_signoff_by ? 'border-green-400' : 'border-yellow-400'} p-3 shadow-sm`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 break-words">{entry.product_name}</div>
                  <div className="text-xs text-gray-500">{formatDate(entry.date)} · {entry.team} · {entry.room}</div>
                </div>
                {entry.qa_signoff_by ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle size={12} /> Signed</span>
                ) : canSignoff ? (
                  <button type="button" onClick={() => setSignoffEntry(entry)} className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-200"><Clock size={12} /> Pending QA</button>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"><Clock size={12} /> Pending</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                {entry.line && <span className="font-medium text-gray-700">{lineLabel(entry.line)}</span>}
                {entry.mo_lines?.length > 1
                  ? <span className="font-medium text-gray-700">{entry.mo_lines.length} MOs</span>
                  : <>{entry.mo_number && <span>MO {entry.mo_number}</span>}{entry.lot_number && <span>Lot {entry.lot_number}</span>}</>}
                <span>{formatTime(entry.start_time)}–{formatTime(entry.end_time)}</span>
                {entry.duration_hours != null && <span>{Number(entry.duration_hours).toFixed(1)}h</span>}
                <span>Qty {Number(entry.quantity_completed).toLocaleString()}</span>
                <span>{entry.people_count}p</span>
                {entry.units_per_hour != null && <span>{Number(entry.units_per_hour).toLocaleString(undefined, { maximumFractionDigits: 1 })}/h</span>}
              </div>
              {entry.qa_signoff_by && <div className="mt-1 text-xs text-green-600">QA: {entry.qa_signoff_by}</div>}
              {!!entry.qa_action_required && !entry.qa_action_resolved_at && (
                <div className="mt-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-900">
                  <span className="font-semibold">QA asked for a correction:</span> {entry.qa_notes}
                </div>
              )}
              {entry.mo_lines?.length > 1 && <MoLinesSummary lines={entry.mo_lines} />}
              {entry.notes && <div className="mt-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1.5 break-words"><span className="font-medium text-gray-900">Notes:</span> {entry.notes}</div>}
              <EodSummary template={templates?.[entry.team]} data={entry.structured_data} />
              <AmendmentTrail amendments={entry.amendments} />
              {canAmendEntry(entry) && (
                <button type="button" onClick={() => setAmendEntry(entry)}
                  className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  <Pencil size={12} /> Correct entry
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="md:hidden"><ShowMore view={view} noun="entries" /></div>

      {/* Desktop: table view */}
      {!loading && !error && (
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8 px-2 py-3" />
                  {SORT_COLUMNS.map(col => (
                    <th key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-gray-900 hover:bg-gray-100 transition-colors">
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortCol === col.key && (
                          sortDir === 'asc' ? <ChevronUp size={14} className="text-blue-600" /> : <ChevronDown size={14} className="text-blue-600" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.length === 0 && (
                  <tr><td colSpan={15} className="px-3 py-8 text-center text-sm text-gray-500">No entries found.</td></tr>
                )}
                {view.items.map(entry => (
                  <Fragment key={entry.id}>
                  <tr {...expand.rowProps(entry.id)}>
                    <td className="px-2 py-2"><ExpandCell open={expand.isExpanded(entry.id)} /></td>
                    <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{formatDate(entry.date)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">
                      {entry.team}
                      {entry.line && <span className="ml-1.5 text-[10px] font-medium text-gray-500">{lineLabel(entry.line)}</span>}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.room}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 w-full min-w-[160px] relative group">
                      {entry.product_name}
                      {entry.mo_lines?.length > 1 && (
                        <span className="ml-1.5 text-[10px] font-medium text-powder-600">+{entry.mo_lines.length - 1} more MO{entry.mo_lines.length - 1 === 1 ? '' : 's'}</span>
                      )}
                      {entry.amendments?.length > 0 && (
                        <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800"
                          title="This entry was corrected — open the row to see what changed">
                          <AlertCircle size={10} /> AMENDED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.mo_number}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.lot_number}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatTime(entry.start_time)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatTime(entry.end_time)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.duration_hours != null ? Number(entry.duration_hours).toFixed(1) + 'h' : '--'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{Number(entry.quantity_completed).toLocaleString()}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.people_count}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.units_per_hour != null ? Number(entry.units_per_hour).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '--'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.units_per_min_per_person != null ? Number(entry.units_per_min_per_person).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--'}</td>
                    <td className="px-3 py-2 text-sm whitespace-nowrap" onClick={stopRowClick}>
                      {entry.qa_signoff_by ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle size={12} /> Signed Off
                          <span className="text-green-600 font-normal">({entry.qa_signoff_by})</span>
                        </span>
                      ) : canSignoff ? (
                        <button type="button" onClick={() => setSignoffEntry(entry)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-200 cursor-pointer">
                          <Clock size={12} /> Pending QA
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <Clock size={12} /> Pending QA
                        </span>
                      )}
                      {canAmendEntry(entry) && (
                        <button type="button" onClick={() => setAmendEntry(entry)}
                          className="ml-2 text-gray-400 hover:text-amber-600" data-tip="Correct this entry" data-tip-left>
                          <Pencil size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                  {expand.isExpanded(entry.id) && (
                    <DetailRow colSpan={15}>
                      <DetailFields fields={[
                        { label: 'Date', value: formatDate(entry.date) },
                        { label: 'Team', value: [entry.team, entry.line ? lineLabel(entry.line) : null].filter(Boolean).join(' · ') },
                        { label: 'Room', value: entry.room },
                        { label: 'Shift', value: `${formatTime(entry.start_time)}–${formatTime(entry.end_time)}` },
                        { label: 'Duration', value: entry.duration_hours != null ? `${Number(entry.duration_hours).toFixed(1)}h` : '' },
                        { label: 'People', value: entry.people_count },
                        { label: 'Quantity', value: Number(entry.quantity_completed).toLocaleString() },
                        { label: 'Units/hr', value: entry.units_per_hour != null ? Number(entry.units_per_hour).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '' },
                        { label: 'Logged by', value: entry.created_by || entry.operator_name },
                        { label: 'QA sign-off', value: entry.qa_signoff_by ? `${entry.qa_signoff_by}${entry.qa_signoff_at ? ` · ${formatDate(entry.qa_signoff_at)}` : ''}` : 'Pending' },
                        { label: 'QA notes', value: entry.qa_notes, wide: true },
                        { label: 'Notes', value: entry.notes, wide: true },
                        ...(flavorByMo?.[entry.mo_number] ? [
                          { label: 'Flavor approval',
                            value: `${flavorByMo[entry.mo_number].status === 'approved' ? 'Approved' : 'Denied'}`
                              + ` · ${flavorByMo[entry.mo_number].record_number}`
                              + (flavorByMo[entry.mo_number].decided_by ? ` · ${flavorByMo[entry.mo_number].decided_by}` : '') },
                          { label: 'Batch adjustments', value: flavorByMo[entry.mo_number].batch_adjustments, wide: true },
                        ] : []),
                      ]}>
                        {entry.mo_lines?.length > 1 && (
                          <div className="mb-2">
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">MOs this shift</div>
                            <MoLinesSummary lines={entry.mo_lines} />
                          </div>
                        )}
                        <EodSummary template={templates?.[entry.team]} data={entry.structured_data} />
                        {entry.amendments?.length > 0 && <AmendmentTrail amendments={entry.amendments} />}
                      </DetailFields>
                    </DetailRow>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <ShowMore view={view} noun="entries" />
        </div>
      )}

      {signoffEntry && (
        <QASignoffModal entry={signoffEntry} user={user} onClose={() => setSignoffEntry(null)} onSaved={refreshAll} />
      )}
      {amendEntry && (
        <AmendModal entry={amendEntry} onClose={() => setAmendEntry(null)} onSaved={refreshAll} />
      )}
    </div>
  );
}

/* ── EOD Template Editor (admin / log-editor) ────────────── */

const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox (yes/no)' },
  { value: 'textarea', label: 'Long text' },
];

// Turns a saved template into the editable shape (options as a comma string so
// the admin edits dropdown choices inline). blankField() adds a fresh row.
function toEditable(tpl, team) {
  return {
    title: tpl?.title || `${team} EOD Report`,
    fields: (tpl?.fields || []).map(f => ({
      key: f.key, label: f.label || '', type: f.type || 'text',
      options: (f.options || []).join(', '), required: !!f.required,
    })),
  };
}
const blankField = () => ({ key: '', label: '', type: 'text', options: '', required: false });

function TemplateEditor() {
  const { data: templates, refresh } = useApiGet('/production/eod-templates');
  const [team, setTeam] = useState('Batching');
  const [draft, setDraft] = useState(null);
  const [savedTeam, setSavedTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Load the selected team's template into the editable draft once templates
  // arrive or the team changes. `savedTeam` guards against clobbering unsaved
  // edits every render.
  if (templates && savedTeam !== team) {
    setDraft(toEditable(templates[team], team));
    setSavedTeam(team);
  }

  const setField = (i, patch) => setDraft(d => ({ ...d, fields: d.fields.map((f, j) => j === i ? { ...f, ...patch } : f) }));
  const addField = () => setDraft(d => ({ ...d, fields: [...d.fields, blankField()] }));
  const removeField = (i) => setDraft(d => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }));
  const moveField = (i, dir) => setDraft(d => {
    const j = i + dir;
    if (j < 0 || j >= d.fields.length) return d;
    const fields = [...d.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    return { ...d, fields };
  });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const fields = draft.fields
        .filter(f => f.label.trim())
        .map(f => ({
          key: f.key || undefined,
          label: f.label.trim(),
          type: f.type,
          options: f.type === 'select' ? f.options.split(',').map(o => o.trim()).filter(Boolean) : undefined,
          required: f.required || undefined,
        }));
      await apiPut(`/production/eod-templates/${encodeURIComponent(team)}`, { title: draft.title, fields });
      setMessage({ type: 'success', text: 'Template saved.' });
      refresh();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to save template.' });
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return <div className="text-sm text-gray-500 py-8 text-center">Loading templates…</div>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">EOD Report Templates</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Build a team-specific survey that appears on the EOD Entry Form when that team is selected.
          Batching (Blending) ships with a starter set — tune it or build one for any other team.
        </p>
      </div>

      {message && (
        <div className={`px-3 py-2 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Team</label>
          <select value={team} onChange={e => setTeam(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {TEAMS.map(t => <option key={t} value={t}>{t}{templates?.[t] ? ' ✓' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Report title</label>
          <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={`${team} EOD Report`} />
        </div>
      </div>

      <div className="space-y-2">
        {draft.fields.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-3 border border-dashed border-gray-200 rounded-lg">
            No fields yet — add one below. With no fields, this team's EOD form shows only the shared fields.
          </p>
        )}
        {draft.fields.map((f, i) => (
          <div key={i} className="rounded-lg border border-gray-200 p-3 bg-gray-50/60">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Label</label>
                <input value={f.label} onChange={e => setField(i, { label: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Actual yield (kg)" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Type</label>
                <select value={f.type} onChange={e => setField(i, { type: e.target.value })}
                  className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm">
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1 pb-0.5">
                <label className="flex items-center gap-1 text-xs text-gray-600 mr-1">
                  <input type="checkbox" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} />
                  Req
                </label>
                <button type="button" onClick={() => moveField(i, -1)} disabled={i === 0}
                  className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up"><ChevronUp size={15} /></button>
                <button type="button" onClick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1}
                  className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down"><ChevronDown size={15} /></button>
                <button type="button" onClick={() => removeField(i)}
                  className="p-1 text-gray-400 hover:text-red-600" title="Remove field"><X size={15} /></button>
              </div>
            </div>
            {f.type === 'select' && (
              <div className="mt-2">
                <label className="block text-[11px] font-medium text-gray-600 mb-1">Choices (comma-separated)</label>
                <input value={f.options} onChange={e => setField(i, { options: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="Pass, Fail, N/A" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={addField}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <Plus size={14} /> Add field
        </button>
        <button type="button" onClick={save} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : `Save ${team} template`}
        </button>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export default function ProductionLog({ user, directEntry }) {
  const [tab, setTab] = useState('log');
  const [refreshKey, setRefreshKey] = useState(0);

  if (directEntry) {
    return <EntryForm user={user} onSuccess={() => setRefreshKey(k => k + 1)} />;
  }

  // EOD entry form is its own permission: supervisors/admins by default, or
  // an explicit 'production-eod' grant. The log itself stays read-only here —
  // changing existing entries needs an explicit Production Log edit grant
  // (enforced server-side).
  const canEod = user?.role === 'admin' || user?.role === 'supervisor' || hasExplicitGrant(user, 'production-eod');
  // Editing the survey templates is the same right as editing the log itself:
  // admin, or an explicit Production Log edit grant. Mirrors canEditLog() server-side.
  const ma = user?.module_access;
  const canEditTemplates = user?.role === 'admin'
    || !!(ma && !Array.isArray(ma) && ma['production-log'] === 'edit');
  const tabs = [
    { id: 'log', label: 'Production Log', icon: ClipboardList },
    ...(canEod ? [{ id: 'form', label: 'Entry Form', icon: Plus }] : []),
    ...(canEditTemplates ? [{ id: 'templates', label: 'EOD Templates', icon: Pencil }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}>
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'form' && (
        <EntryForm user={user} onSuccess={() => { setRefreshKey(k => k + 1); setTab('log'); }} />
      )}
      {tab === 'log' && (
        <LogTable key={refreshKey} user={user} />
      )}
      {tab === 'templates' && canEditTemplates && (
        <TemplateEditor />
      )}
    </div>
  );
}
