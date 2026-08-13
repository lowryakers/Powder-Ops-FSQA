import { useState, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, CheckCircle, Eye, X, Check, XCircle, AlertTriangle, ClipboardList, Settings2 } from 'lucide-react';
import { useCappedList } from '../../lib/useCappedList';
import { useTableSort } from '../../lib/useTableSort';
import SortHeader from '../common/SortHeader.jsx';
import ShowMore from '../common/ShowMore.jsx';
import { formatDateTime } from '../../lib/datetime.js';
import { areaLabel } from '../../../shared/rooms.js';

// Reason dialog for dismiss / N-A / not-in-use on a 72h re-clean flag.
const RECLEAN_ACTION_META = {
  dismissed: { title: 'Dismiss re-clean flag', hint: 'Why is no re-clean needed? (required — this is recorded for the audit trail)', requireReason: true },
  na: { title: 'Mark N/A', hint: 'Optional note (e.g. room repurposed, rule not applicable this cycle).', requireReason: false },
  not_in_use: { title: 'Mark not in use', hint: 'Optional note. The flag re-arms automatically if the room is used again.', requireReason: false },
};
function RecleanActionModal({ room, action, onDone, onClose }) {
  const meta = RECLEAN_ACTION_META[action];
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await apiPost('/sanitation/reclean-actions', { room, action, reason }); onDone(); onClose(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
        <h3 className="font-semibold text-gray-900">{meta.title} — {room}</h3>
        <p className="text-xs text-gray-500">{meta.hint}</p>
        <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Reason…" />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button onClick={go} disabled={busy || (meta.requireReason && !reason.trim())}
            className="flex-1 px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Confirm'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// SQF/NSF 72-hour idle rule: rooms whose last passed clean is 72h+ old (unused
// since) need a re-clean before use; rooms used after their last clean are
// dirty. Flags can be assigned to Cleaning, dismissed with a reason, or marked
// N/A / not in use — and which rooms the rule applies to is manageable.
function RecleanSection() {
  const { user } = useAuth() || {};
  const canManage = user?.role === 'admin' || user?.role === 'supervisor' || user?.department === 'qa';
  const { data, refresh } = useApiGet('/sanitation/reclean-status');
  const [modal, setModal] = useState(null); // { room, action }
  const [manage, setManage] = useState(false);
  const [busyRoom, setBusyRoom] = useState(null);

  const rooms = data?.rooms || [];
  const open = rooms.filter(r => r.needs_attention);
  const handled = rooms.filter(r => (r.status === 'expired_72h' || r.status === 'dirty') && r.applicable && r.action);

  const assign = async (room) => {
    setBusyRoom(room);
    try { await apiPost('/sanitation/reclean-assign', { room }); refresh(); }
    catch (e) { alert(e.message); }
    finally { setBusyRoom(null); }
  };
  const undo = async (r) => {
    await apiFetch(`/sanitation/reclean-actions/${r.action.id}`, { method: 'DELETE' });
    refresh();
  };
  const setApplicable = async (room, applicable) => {
    await apiPut('/sanitation/reclean-rooms', { room, applicable });
    refresh();
  };

  if (!open.length && !handled.length && !manage) {
    // Nothing flagged — just offer the room-list manager to those who can use it.
    return canManage ? (
      <div className="flex justify-end">
        <button onClick={() => setManage(true)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600">
          <Settings2 size={12} /> Manage 72h re-clean rooms
        </button>
      </div>
    ) : null;
  }

  const ACTION_LABEL = { dismissed: 'Dismissed', na: 'N/A', not_in_use: 'Not in use', assigned: 'Assigned to Cleaning' };

  return (
    <div className="space-y-2">
      {(open.length > 0 || handled.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle size={15} /> Re-clean required before next use{open.length > 0 && ` (${open.length})`}
            </div>
            {canManage && (
              <button onClick={() => setManage(m => !m)} className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900">
                <Settings2 size={12} /> Manage rooms
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {open.map(r => (
              <div key={r.room} className="bg-white border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap">
                <div className="min-w-[140px] flex-1">
                  <span className="text-sm font-medium text-gray-800">{areaLabel(r.room)}</span>
                  <span className="block text-[11px] text-gray-500">
                    {r.status === 'expired_72h' ? `idle ${r.hours_since_clean}h since clean (72h rule)` : 'used after last clean'}
                  </span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1.5 flex-wrap ml-auto">
                    <button onClick={() => assign(r.room)} disabled={busyRoom === r.room}
                      className="flex items-center gap-1 px-2.5 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
                      <ClipboardList size={12} /> {busyRoom === r.room ? 'Assigning…' : 'Assign to Cleaning'}
                    </button>
                    <button onClick={() => setModal({ room: r.room, action: 'dismissed' })}
                      className="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">Dismiss…</button>
                    <button onClick={() => setModal({ room: r.room, action: 'na' })}
                      className="px-2 py-1 text-gray-400 hover:text-gray-600 rounded-lg text-xs">N/A</button>
                    <button onClick={() => setModal({ room: r.room, action: 'not_in_use' })}
                      className="px-2 py-1 text-gray-400 hover:text-gray-600 rounded-lg text-xs whitespace-nowrap">Not in use</button>
                  </div>
                )}
              </div>
            ))}
            {handled.map(r => (
              <div key={r.room} className="bg-white/60 border border-gray-200 rounded-lg px-3 py-1.5 flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
                <span className="font-medium text-gray-600">{areaLabel(r.room)}</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{ACTION_LABEL[r.action.action]}</span>
                {r.action.reason && <span className="italic truncate max-w-[260px]">“{r.action.reason}”</span>}
                <span className="text-gray-400">{r.action.by}</span>
                {canManage && <button onClick={() => undo(r)} className="ml-auto text-gray-400 hover:text-red-500">undo</button>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-amber-700">SQF/NSF 72-hour rule: a cleaned room or line that sits idle 72+ hours requires a fresh clean before production. Dismissals and N/As are recorded in the audit trail.</p>
        </div>
      )}

      {manage && canManage && (
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">Rooms the 72-hour rule applies to</p>
            <button onClick={() => setManage(false)} className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
          </div>
          <p className="text-[11px] text-gray-400 mb-2">Only SQF/NSF-relevant production rooms should be checked. Non-food areas (restrooms, breakroom, offices…) are off by default.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {rooms.map(r => (
              <label key={r.room} className="flex items-center gap-2 text-sm text-gray-700 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={r.applicable} onChange={e => setApplicable(r.room, e.target.checked)}
                  className="rounded border-gray-300 text-powder-600" />
                <span className="truncate">{areaLabel(r.room)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {modal && <RecleanActionModal room={modal.room} action={modal.action} onDone={refresh} onClose={() => setModal(null)} />}
    </div>
  );
}

const TYPE_LABELS = { pre_op: 'Pre-Op', post_op: 'Post-Op', mid_shift: 'Mid-Shift', deep_clean: 'Deep Clean', emergency: 'Emergency' };
const TYPE_COLORS = { pre_op: 'bg-blue-100 text-blue-800', post_op: 'bg-purple-100 text-purple-800', mid_shift: 'bg-yellow-100 text-yellow-800', deep_clean: 'bg-teal-100 text-teal-800', emergency: 'bg-red-100 text-red-800' };
const RESULT_COLORS = { pass: 'bg-green-100 text-green-800', fail: 'bg-red-100 text-red-800', reclean: 'bg-yellow-100 text-yellow-800' };

function SanitationDetail({ record, onClose }) {
  return (
    <tr>
      <td colSpan={10} className="p-0">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 m-2 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-gray-900 text-base">{areaLabel(record.area)}</h4>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[record.type]}`}>{TYPE_LABELS[record.type]}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RESULT_COLORS[record.result]}`}>{record.result.toUpperCase()}</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Area</p>
              <p className="text-sm font-semibold text-gray-900">{areaLabel(record.area)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Type</p>
              <p className="text-sm font-semibold text-gray-900">
                <span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_COLORS[record.type]}`}>{TYPE_LABELS[record.type]}</span>
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Equipment</p>
              <p className="text-sm font-semibold text-gray-900">{record.equipment_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Performed By</p>
              <p className="text-sm font-semibold text-gray-900">{record.performed_by}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date / Time</p>
              <p className="text-sm font-semibold text-gray-900">{formatDateTime(record.performed_at)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Chemical Used</p>
              <p className="text-sm font-semibold text-gray-900">{record.chemicals_used || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Concentration</p>
              <p className="text-sm font-semibold text-gray-900">{record.concentration || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contact Time (min)</p>
              <p className="text-sm font-semibold text-gray-900">{record.contact_time_minutes != null ? record.contact_time_minutes : '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">ATP Reading (RLU)</p>
              <p className="text-sm font-semibold text-gray-900">{record.atp_reading != null ? record.atp_reading : '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Result</p>
              <p className="text-sm font-semibold">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RESULT_COLORS[record.result]}`}>{record.result.toUpperCase()}</span>
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Rinse Verified</p>
              <p className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                {record.rinse_verified ? (
                  <><Check size={14} className="text-green-600" /> Yes</>
                ) : (
                  <><XCircle size={14} className="text-red-500" /> No</>
                )}
              </p>
            </div>
            {record.verified_by && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Verified By</p>
                <p className="text-sm font-semibold text-green-700 flex items-center gap-1">
                  <CheckCircle size={12} /> {record.verified_by}
                </p>
              </div>
            )}
            {record.verified_at && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Verified At</p>
                <p className="text-sm font-semibold text-gray-900">{formatDateTime(record.verified_at)}</p>
              </div>
            )}
          </div>

          {record.notes && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-gray-700 bg-white rounded-lg p-3 border border-gray-200">{record.notes}</p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// A record entered after the day it happened says so, everywhere it appears.
// Both dates plus the reason is what makes it a true late entry rather than a
// back-dated one, and an auditor should never have to open a record to find out.
function LateChip({ record }) {
  if (!record?.entered_late) return null;
  const entered = String(record.entered_at || '').slice(0, 10);
  return (
    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-medium whitespace-nowrap"
      data-tip={`Entered ${entered}${record.late_entry_reason ? ` — ${record.late_entry_reason}` : ''}`}>
      entered late
    </span>
  );
}

function RecordForm({ equipment, chemicals, onSave, onCancel }) {
  const { data: areas } = useApiGet('/structure/lists/sanitation_areas');
  const [form, setForm] = useState({
    area: '', type: 'pre_op', equipment_id: '', performed_by: '',
    chemical_id: '', chemicals_used: '', concentration: '', contact_time_minutes: '',
    rinse_verified: false, result: 'pass', atp_reading: '', notes: '',
    // Blank = today. Set it to record work that was actually done earlier —
    // the server keeps both dates and asks why.
    performed_at: '', late_entry_reason: '',
  });
  const todayStr = new Date().toISOString().split('T')[0];
  // "Earlier" starts the day before, because same-day is just filing at the
  // end of a shift and needs no explanation.
  const isBackdated = !!form.performed_at && form.performed_at < todayStr;

  const handleChemicalSelect = (chemId) => {
    const chem = (chemicals || []).find(c => String(c.id) === String(chemId));
    setForm({
      ...form,
      chemical_id: chemId,
      chemicals_used: chem ? chem.name : '',
      concentration: chem?.max_concentration || form.concentration,
      contact_time_minutes: chem?.required_contact_time_minutes || form.contact_time_minutes,
    });
  };
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, contact_time_minutes: form.contact_time_minutes ? parseInt(form.contact_time_minutes) : null, atp_reading: form.atp_reading ? parseFloat(form.atp_reading) : null }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">New Sanitation Record</h3>
      {isBackdated && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <label className="block text-xs font-medium text-amber-900 mb-1">
            Why is this being entered now? *
          </label>
          <input required value={form.late_entry_reason}
            onChange={e => setForm({ ...form, late_entry_reason: e.target.value })}
            placeholder="e.g. account locked out — cleans done on the day, logged when access was restored"
            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-white" />
          <p className="text-[11px] text-amber-800 mt-1">
            The record will show both dates — cleaned {form.performed_at}, entered today — and this reason.
            That is what makes a late entry a true record rather than a back-dated one.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Area *</label>
          {/* A managed list, not a text box. This was free text, which is how
              one room came to be filed under four spellings — and, worse, how
              the 72-hour rule stopped joining to the Production Log, which
              stores the bare room token. The value sent is that token; the
              label is what a person reads. Adding an area is a Settings task. */}
          <select required value={form.area} onChange={e => setForm({ ...form, area: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">Select an area…</option>
            {(areas?.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {areas && !(areas.options || []).length && (
            <p className="text-[11px] text-amber-700 mt-1">
              No areas configured yet — an admin adds them in Settings → Log Structure → Dropdown Lists.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Performed By *</label>
          <input required value={form.performed_by} onChange={e => setForm({ ...form, performed_by: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Date cleaned <span className="font-normal text-gray-400">— leave blank for today</span>
          </label>
          <input type="date" max={todayStr} value={form.performed_at}
            onChange={e => setForm({ ...form, performed_at: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment</label>
          <select value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">N/A</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Chemical Used</label>
          <select value={form.chemical_id} onChange={e => handleChemicalSelect(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select chemical...</option>
            {(chemicals || []).filter(c => ['sanitizer', 'cleaner', 'degreaser'].includes(c.category)).map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.is_food_grade ? ' (Food Grade)' : ''}</option>
            ))}
            <option value="__other">Other (type manually)</option>
          </select>
          {form.chemical_id === '__other' && (
            <input value={form.chemicals_used} onChange={e => setForm({ ...form, chemicals_used: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" placeholder="Chemical name" />
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Concentration</label>
          <input value={form.concentration} onChange={e => setForm({ ...form, concentration: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 200 ppm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contact Time (min)</label>
          <input type="number" value={form.contact_time_minutes} onChange={e => setForm({ ...form, contact_time_minutes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ATP Reading (RLU)</label>
          <input type="number" step="0.1" value={form.atp_reading} onChange={e => setForm({ ...form, atp_reading: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Result *</label>
          <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="reclean">Re-clean Required</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={form.rinse_verified} onChange={e => setForm({ ...form, rinse_verified: e.target.checked })} />
        <span className="text-sm text-gray-700">Rinse Verified</span>
      </label>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Record'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

// Folding the free-text history onto the canonical areas.
//
// An amber strip, shown only while there is something to fold and only to
// people who can do it — the same shape as the draft-specs review. Nothing is
// rewritten until somebody reads the counts and presses the button: this edits
// filed compliance records, and a bulk rewrite nobody checked is exactly how a
// log stops being trustworthy. What the rule does NOT recognise is listed
// alongside, because "we left these alone" is the half of the report that says
// whether the mapping was right.
function AreaNormalizeStrip({ onDone }) {
  const { user } = useAuth() || {};
  const canManage = user?.role === 'admin' || user?.role === 'supervisor' || user?.department === 'qa';
  const { data, refresh } = useApiGet(canManage ? '/sanitation/areas/preview' : null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const changes = data?.changes || [];
  if (!canManage || !changes.length) return null;

  const go = async () => {
    setBusy(true); setErr(null);
    try { await apiPost('/sanitation/areas/normalize', {}); refresh(); onDone?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold text-amber-900">
          {data.records} record{data.records === 1 ? '' : 's'} filed under {changes.length} spelling{changes.length === 1 ? '' : 's'} of an area that already has a name
        </div>
        <button onClick={() => setOpen(o => !o)} className="text-[11px] text-amber-700 hover:text-amber-900 underline">
          {open ? 'Hide' : 'Review'}
        </button>
      </div>
      <p className="text-[11px] text-amber-800">
        The 72-hour rule matches a clean against the room the Production Log recorded a run in, so a clean
        filed as “Room 7” never meets a run in room 7. Folding these onto one name is what makes that rule work.
      </p>
      {open && (
        <div className="space-y-2">
          <ul className="text-xs text-gray-700 space-y-0.5 max-h-56 overflow-y-auto">
            {changes.map(c => (
              <li key={c.from} className="flex items-baseline gap-2">
                <span className="text-gray-400 tabular-nums w-10 shrink-0 text-right">{c.records}</span>
                <span className="line-through text-gray-500 break-words">{c.from}</span>
                <span className="text-gray-400">→</span>
                <span className="font-medium break-words">{c.label}</span>
              </li>
            ))}
          </ul>
          {!!(data.unmatched || []).length && (
            <div className="text-[11px] text-gray-500">
              <span className="font-medium text-gray-600">Left exactly as filed ({data.unmatched.length}):</span>{' '}
              {data.unmatched.map(u => `${u.area} (${u.records})`).join(', ')}
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button onClick={go} disabled={busy}
            className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
            {busy ? 'Applying…' : `Apply to ${data.records} record${data.records === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The columns, as DATA — one array drives both the header and the sort, so a
 * column cannot be sortable in one place and not the other. An entry with no
 * `key` (the Verify cell, the eye) renders as a plain header and is not
 * clickable, which is right: those are not values to order by.
 *
 * `sortValue` is here because several cells render something other than the
 * raw column — Area shows a label derived from a room token, Type shows a
 * chip. Sorting must follow WHAT IS ON SCREEN, or clicking "Area" appears to
 * scramble the list.
 */
const SANITATION_COLUMNS = [
  { key: 'area', label: 'Area', type: 'text', sortValue: r => areaLabel(r.area) },
  { key: 'type', label: 'Type', type: 'text', sortValue: r => TYPE_LABELS[r.type] || r.type },
  { key: 'equipment_name', label: 'Equipment', type: 'text' },
  { key: 'performed_by', label: 'Performed By', type: 'text' },
  { key: 'performed_at', label: 'Date', type: 'date' },
  { key: 'chemicals_used', label: 'Chemical', type: 'text' },
  { key: 'atp_reading', label: 'ATP', type: 'number' },
  { key: 'result', label: 'Result', type: 'text' },
  { key: 'verified_by', label: 'Verified', type: 'text' },
  { label: '', width: '2.5rem' },
];

export default function SanitationPanel() {
  const { user } = useAuth() || {};
  const { data: records, loading, refresh } = useApiGet('/sanitation');
  // Newest first by default — a cleaning log is read from today backwards.
  const { sorted, sortCol, sortDir, toggleSort } = useTableSort(records, SANITATION_COLUMNS, 'performed_at', 'desc');
  // SORT BEFORE THE CAP. useCappedList renders the first 100; sorting after it
  // would only order the hundred rows that happened to be on screen.
  const view = useCappedList(sorted);
  const { data: equipment } = useApiGet('/equipment');
  const { data: chemicals } = useApiGet('/chemicals');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const handleCreate = async (form) => {
    await apiPost('/sanitation', form);
    setShowForm(false);
    refresh();
  };

  // A counter-signature is a statement about WHO reviewed the record, so it is
  // the signed-in user — never a name typed into a prompt. This asked for the
  // verifier's name and sent it, which made the signature a free-text field
  // with a person's name in it; the server takes it from the session now and
  // ignores the body, so asking here would only be theatre.
  const handleVerify = async (id) => {
    if (!user?.name) return;
    if (!window.confirm(`Verify this cleaning record as ${user.name}?`)) return;
    try {
      await apiPut(`/sanitation/${id}/verify`, {});
      refresh();
    } catch (e) { window.alert(e.message); }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading sanitation records...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Sanitation Records</h2>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Record
        </button>
      </div>

      <AreaNormalizeStrip onDone={refresh} />

      <RecleanSection />

      {showForm && <RecordForm equipment={equipment} chemicals={chemicals} onSave={handleCreate} onCancel={() => setShowForm(false)} />}

      {/* Mobile: card view */}
      <div className="md:hidden space-y-2">
        {view.items.map(r => {
          const isExpanded = expandedId === r.id;
          const stripe = r.result === 'pass' ? 'border-green-400' : r.result === 'fail' ? 'border-red-400' : 'border-gray-300';
          return (
            <div key={r.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${stripe} shadow-sm overflow-hidden`}>
              <div onClick={() => setExpandedId(isExpanded ? null : r.id)} className="p-3 active:bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 font-medium text-gray-900 break-words">{areaLabel(r.area)}</div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${RESULT_COLORS[r.result]}`}>{r.result}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                  <span className={`px-2 py-0.5 rounded-full ${TYPE_COLORS[r.type]}`}>{TYPE_LABELS[r.type]}</span>
                  {r.equipment_name && <span className="break-words">{r.equipment_name}</span>}
                  <span>{r.performed_by}</span>
                  <span className="text-gray-400">{formatDateTime(r.performed_at)}</span>
                  <LateChip record={r} />
                  {r.atp_reading != null && <span>ATP: {r.atp_reading}</span>}
                </div>
                <div className="mt-1.5">
                  {r.verified_by ? (
                    <span className="text-green-600 text-xs"><CheckCircle size={12} className="inline mr-1" />Verified by {r.verified_by}</span>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); handleVerify(r.id); }} className="text-xs text-powder-600 hover:underline">Verify</button>
                  )}
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-gray-100">
                  <table className="w-full"><tbody><SanitationDetail record={r} onClose={() => setExpandedId(null)} /></tbody></table>
                </div>
              )}
            </div>
          );
        })}
        {(!records || records.length === 0) && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-gray-500 text-sm">No sanitation records yet</div>
        )}
      </div>

      <div className="md:hidden"><ShowMore view={view} noun="records" /></div>

      {/* Desktop: table view */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {SANITATION_COLUMNS.map((c, i) => (
                  <SortHeader key={c.key || `x${i}`} col={c} sortCol={sortCol} sortDir={sortDir}
                    onSort={toggleSort} className="px-4 py-3" />
                ))}
              </tr>
            </thead>
            <tbody>
              {view.items.map(r => {
                const isExpanded = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      className={`border-b border-gray-100 cursor-pointer transition-colors hover:bg-powder-50 ${isExpanded ? 'bg-powder-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium w-full">{areaLabel(r.area)}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs ${TYPE_COLORS[r.type]}`}>{TYPE_LABELS[r.type]}</span></td>
                      <td className="px-4 py-3 text-gray-600">{r.equipment_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.performed_by}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {formatDateTime(r.performed_at)} <LateChip record={r} />
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.chemicals_used || '—'}{r.concentration ? ` (${r.concentration})` : ''}</td>
                      <td className="px-4 py-3 text-gray-600">{r.atp_reading ?? '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RESULT_COLORS[r.result]}`}>{r.result}</span></td>
                      <td className="px-4 py-3">
                        {r.verified_by ? (
                          <span className="text-green-600 text-xs"><CheckCircle size={12} className="inline mr-1" />{r.verified_by}</span>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); handleVerify(r.id); }} className="text-xs text-powder-600 hover:underline">Verify</button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <Eye size={16} className={isExpanded ? 'text-powder-600' : ''} />
                      </td>
                    </tr>
                    {isExpanded && <SanitationDetail record={r} onClose={() => setExpandedId(null)} />}
                  </Fragment>
                );
              })}
              {(!records || records.length === 0) && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No sanitation records yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <ShowMore view={view} noun="records" />
      </div>
    </div>
  );
}
