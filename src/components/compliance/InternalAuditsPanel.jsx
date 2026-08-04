import { useState, useMemo, useEffect } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CustomFields, CustomFieldValues } from '../common/CustomFields';
import {
  ClipboardCheck, Plus, X, ArrowLeft, ArrowRight, Download, CheckCircle2, RotateCcw,
  AlertTriangle, ChevronRight, ListChecks, Compass, Trash2, MinusCircle,
} from 'lucide-react';

// Internal audits — Form 403-01, walked one question at a time.
//
// The form is five pages and ~100 questions; a real audit covers two or three
// areas. So the first thing you do is PICK SECTIONS, and only those become
// questions. On the paper form the auditor drew a diagonal line through the
// sections they didn't cover — this is the same decision, recorded instead of
// drawn, and the record then says what was in scope rather than leaving a
// reader to interpret a pen stroke.
//
// Two ways through the same items:
//   Walkthrough — one question at a time, big buttons, on a phone in the plant.
//   Checklist   — the whole thing, filterable, for reviewing and for the office.
//
// A not-compliant answer offers a CAR straight away, because a finding written
// down and never raised is the failure mode the form's own "CAR Completed Y/N"
// column exists to catch.

const todayStr = () => new Date().toISOString().split('T')[0];

const RESULT_LABEL = { c: 'Compliant', nc: 'Not compliant', na: 'N/A' };
const RESULT_CHIP = {
  c: 'bg-green-100 text-green-800',
  nc: 'bg-red-100 text-red-700',
  na: 'bg-gray-100 text-gray-600',
};

const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

/* ── Section picker (used by both the new-audit modal and mid-audit edits) ── */

function SectionPicker({ sections, picked, onChange, disabled }) {
  const toggle = (id) => onChange(picked.includes(id) ? picked.filter(s => s !== id) : [...picked, id]);
  const count = sections.filter(s => picked.includes(s.id)).reduce((n, s) => n + s.items.length, 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium text-gray-700">Sections to audit *</label>
        <span className="text-[11px] text-gray-500">{picked.length} section{picked.length === 1 ? '' : 's'} · {count} questions</span>
      </div>
      <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-50">
        {sections.map(s => (
          <label key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={picked.includes(s.id)} disabled={disabled} onChange={() => toggle(s.id)} />
            <span className="flex-1">{s.title}</span>
            <span className="text-[11px] text-gray-400">{s.items.length}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-3 mt-1.5">
        <button type="button" onClick={() => onChange(sections.map(s => s.id))} className="text-xs text-powder-600 hover:underline">Select all</button>
        <button type="button" onClick={() => onChange([])} className="text-xs text-gray-500 hover:underline">Clear</button>
      </div>
    </div>
  );
}

/* ── New audit ───────────────────────────────────────────────────────────── */

function NewAuditModal({ checklist, onClose, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ audit_date: todayStr(), focus_areas: '', lead_auditor: user?.name || '' });
  const [picked, setPicked] = useState([]);
  const [custom, setCustom] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true); setError('');
    try {
      onCreated(await apiPost('/internal-audits', { ...form, sections: picked, custom_data: custom }));
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">New internal audit</h3>
            <p className="text-[11px] text-gray-500">{checklist?.code} · Revision {checklist?.revision}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Audit date *</label>
              <input type="date" value={form.audit_date} onChange={e => set('audit_date', e.target.value)} className={input} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Lead auditor</label>
              <input value={form.lead_auditor} onChange={e => set('lead_auditor', e.target.value)} className={input} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Focus area(s)</label>
            <input value={form.focus_areas} onChange={e => set('focus_areas', e.target.value)}
              placeholder="e.g. Washroom and production area" className={input} />
          </div>
          <SectionPicker sections={checklist?.sections || []} picked={picked} onChange={setPicked} />
          <CustomFields scope="internal_audit" values={custom} onChange={setCustom} />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={submit} disabled={saving || !picked.length}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Starting…' : 'Start audit'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Raising a CAR from a finding ────────────────────────────────────────── */

function CarModal({ auditId, item, users, onClose, onRaised }) {
  const [form, setForm] = useState({ assigned_to: '', due_date: '', priority: 'normal' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const raise = async () => {
    setBusy(true); setError('');
    try { onRaised(await apiPost(`/internal-audits/${auditId}/items/${item.id}/car`, form)); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Raise a corrective action</h3>
          <p className="text-xs text-gray-500 mt-0.5">{item.prompt}</p>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
            This creates a CAR in the CAPA register, carrying your comment as the finding. It is tracked there,
            not here — this audit shows its live status.
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Assign to</label>
            <input list="audit-people" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} className={input} />
            <datalist id="audit-people">{(users || []).map(u => <option key={u.id} value={u.name} />)}</datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Due date</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} className={input} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={input}>
                {['low', 'normal', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Not now</button>
          <button onClick={raise} disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Raising…' : 'Raise CAR'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── One item, in either view ────────────────────────────────────────────── */

function ResultButtons({ item, editable, onAnswer, size = 'sm' }) {
  const base = size === 'lg'
    ? 'flex-1 px-4 py-3 rounded-xl text-sm font-semibold border-2'
    : 'px-2.5 py-1 rounded-lg text-xs font-medium border';
  const style = (v, on) => {
    if (!on) return `${base} border-gray-200 text-gray-500 hover:bg-gray-50`;
    if (v === 'c') return `${base} border-green-500 bg-green-50 text-green-800`;
    if (v === 'nc') return `${base} border-red-500 bg-red-50 text-red-700`;
    return `${base} border-gray-400 bg-gray-100 text-gray-700`;
  };
  return (
    <div className={`flex gap-1.5 ${size === 'lg' ? 'w-full' : ''}`}>
      {['c', 'nc', 'na'].map(v => (
        <button key={v} disabled={!editable} onClick={() => onAnswer(item.result === v ? null : v)} className={style(v, item.result === v)}>
          {size === 'lg' ? RESULT_LABEL[v] : v.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function CarChip({ item }) {
  if (!item.capa_number) return null;
  const closed = item.capa_status === 'closed';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${closed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
      CAR {item.capa_number} · {item.capa_status}
    </span>
  );
}

/* ── One audit ───────────────────────────────────────────────────────────── */

function AuditDetail({ id, checklist, onBack, onChanged }) {
  const { user } = useAuth();
  const { data: audit, refresh } = useApiGet(`/internal-audits/${id}`, [id]);
  const { data: users } = useApiGet('/users');
  const [view, setView] = useState('walk');
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState(null);
  const [carFor, setCarFor] = useState(null);
  const [error, setError] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [editingSections, setEditingSections] = useState(null);

  const rows = items || audit?.items || [];
  const editable = !!audit?.can_edit;
  const titleOf = (sid) => checklist?.sections.find(s => s.id === sid)?.title || sid;

  // Start the walkthrough on the first unanswered question — coming back to a
  // half-done audit should land where you stopped, not at question one.
  useEffect(() => {
    if (!audit?.items) return;
    const i = audit.items.findIndex(x => !x.result);
    setCursor(i === -1 ? Math.max(0, audit.items.length - 1) : i);
  }, [audit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const inScope = new Set(audit?.sections || []);
  const sectionOrder = (checklist?.sections || []).map(s => s.id).filter(id => inScope.has(id));

  const answered = rows.filter(r => r.result).length;
  const findings = rows.filter(r => r.result === 'nc');
  const openFindings = findings.filter(r => !r.capa_id);

  const answer = async (item, result) => {
    setError('');
    try {
      const out = await apiPut(`/internal-audits/${id}/items/${item.id}`, { result, comments: item.comments });
      setItems(out.items);
      onChanged?.();
      // A finding needs a CAR, and the moment it's marked is the moment the
      // auditor still has the detail in their head.
      if (result === 'nc') setCarFor(out.items.find(x => x.id === item.id));
    } catch (e) { setError(e.message); }
  };

  const comment = async (item, text) => {
    setItems(rows.map(r => (r.id === item.id ? { ...r, comments: text } : r)));
  };
  const saveComment = async (item) => {
    try {
      const out = await apiPut(`/internal-audits/${id}/items/${item.id}`, { result: item.result, comments: item.comments });
      setItems(out.items);
    } catch (e) { setError(e.message); }
  };

  const complete = async () => {
    setError('');
    try { setItems(null); await apiPost(`/internal-audits/${id}/complete`, {}); await refresh(); onChanged?.(); }
    catch (e) { setError(e.message); }
  };
  const revoke = async () => {
    if (!confirm('Revoke the sign-off so the audit can be corrected?')) return;
    try { setItems(null); await apiDelete(`/internal-audits/${id}/complete`); await refresh(); onChanged?.(); }
    catch (e) { setError(e.message); }
  };
  const saveSections = async () => {
    setError('');
    try {
      const out = await apiPost(`/internal-audits/${id}/sections`, { sections: editingSections });
      setItems(out.items); setEditingSections(null); await refresh();
    } catch (e) { setError(e.message); }
  };
  // Straight fetch, not apiFetch — that one parses JSON, and this is a PDF.
  const downloadPdf = async () => {
    const t = localStorage.getItem('auth_token');
    const r = await fetch(`/api/internal-audits/${id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) { setError('Could not build the PDF.'); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `Internal_Audit_${audit.audit_no || id}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (!audit) return <p className="text-sm text-gray-500">Loading…</p>;

  const current = rows[cursor];
  const filtered = rows.filter(r => (!sectionFilter || r.section === sectionFilter) && (!onlyOpen || !r.result));

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-powder-600 hover:underline">
        <ArrowLeft size={15} /> All audits
      </button>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{audit.audit_no} — Internal Audit</h2>
          <p className="text-sm text-gray-500">
            {audit.audit_date} · {audit.checklist_code} Rev {audit.checklist_revision} · lead {audit.lead_auditor || '—'}
          </p>
          {audit.focus_areas && <p className="text-sm text-gray-700 mt-0.5">Focus: {audit.focus_areas}</p>}
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${audit.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
          {audit.status === 'completed' ? `Signed off by ${audit.signed_by}` : 'In progress'}
        </span>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
          <span>{answered} of {rows.length} answered{findings.length > 0 && ` · ${findings.length} finding${findings.length === 1 ? '' : 's'}`}</span>
          <span>{rows.length ? Math.round((answered / rows.length) * 100) : 0}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-powder-500 transition-all" style={{ width: `${rows.length ? (answered / rows.length) * 100 : 0}%` }} />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
      {openFindings.length > 0 && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span><span className="font-semibold">{openFindings.length}</span> not-compliant finding{openFindings.length === 1 ? ' has' : 's have'} no CAR raised yet.</span>
        </p>
      )}

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[['walk', 'Walkthrough', Compass], ['list', 'Full checklist', ListChecks]].map(([v, label, Icon]) => (
          <button key={v} onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === 'walk' && current && (
        <div className="border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {titleOf(current.section)} · question {cursor + 1} of {rows.length}
          </p>
          <p className="text-base text-gray-900">{current.prompt}</p>
          <ResultButtons item={current} editable={editable} size="lg" onAnswer={(v) => answer(current, v)} />
          <textarea rows={2} value={current.comments || ''} disabled={!editable}
            onChange={e => comment(current, e.target.value)} onBlur={() => saveComment(current)}
            placeholder="Comment — what you saw, or how the process is compliant"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <div className="flex items-center gap-2 flex-wrap">
            <CarChip item={current} />
            {current.result === 'nc' && !current.capa_id && editable && (
              <button onClick={() => setCarFor(current)} className="text-xs text-powder-600 hover:underline">Raise a CAR</button>
            )}
            <span className="ml-auto flex gap-2">
              <button onClick={() => setCursor(c => Math.max(0, c - 1))} disabled={cursor === 0}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 disabled:opacity-40 flex items-center gap-1">
                <ArrowLeft size={14} /> Back
              </button>
              <button onClick={() => setCursor(c => Math.min(rows.length - 1, c + 1))} disabled={cursor >= rows.length - 1}
                className="px-3 py-1.5 bg-powder-600 text-white text-sm rounded-lg hover:bg-powder-700 disabled:opacity-40 flex items-center gap-1">
                Next <ArrowRight size={14} />
              </button>
            </span>
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={sectionFilter} onChange={e => setSectionFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All sections in scope</option>
              {sectionOrder.map(s => <option key={s} value={s}>{titleOf(s)}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Only unanswered
            </label>
            <span className="text-xs text-gray-500 ml-auto">{filtered.length} shown</span>
          </div>
          {/* Print order, not the order the sections were ticked — the same
              audit must read the same way here, in the walkthrough and in the
              PDF, or two people comparing them think they're different records. */}
          {sectionOrder.map(sid => {
            const secItems = filtered.filter(r => r.section === sid);
            if (!secItems.length) return null;
            return (
              <div key={sid} className="border border-gray-200 rounded-xl overflow-hidden">
                <p className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-700">{titleOf(sid)}</p>
                <ul className="divide-y divide-gray-50">
                  {secItems.map(it => (
                    <li key={it.id} className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-gray-900 flex-1">{it.prompt}</p>
                        <ResultButtons item={it} editable={editable} onAnswer={(v) => answer(it, v)} />
                      </div>
                      <textarea rows={1} value={it.comments || ''} disabled={!editable}
                        onChange={e => comment(it, e.target.value)} onBlur={() => saveComment(it)}
                        placeholder="Comment" className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                      <div className="flex items-center gap-2">
                        {it.result && <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${RESULT_CHIP[it.result]}`}>{RESULT_LABEL[it.result]}</span>}
                        <CarChip item={it} />
                        {it.result === 'nc' && !it.capa_id && editable && (
                          <button onClick={() => setCarFor(it)} className="text-xs text-powder-600 hover:underline">Raise a CAR</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {editable && (
        editingSections
          ? (
            <div className="border border-gray-200 rounded-xl p-4 space-y-3">
              <SectionPicker sections={checklist?.sections || []} picked={editingSections} onChange={setEditingSections} />
              <p className="text-[11px] text-gray-500">
                Dropping a section only works while nothing in it has been answered — removing answered items would erase evidence.
              </p>
              <div className="flex gap-2">
                <button onClick={saveSections} className="px-3 py-1.5 bg-powder-600 text-white text-sm rounded-lg hover:bg-powder-700">Save scope</button>
                <button onClick={() => setEditingSections(null)} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200">Cancel</button>
              </div>
            </div>
          )
          : (
            <button onClick={() => setEditingSections(audit.sections || [])}
              className="flex items-center gap-1.5 text-xs text-powder-600 hover:underline">
              <MinusCircle size={13} /> Change which sections this audit covers
            </button>
          )
      )}

      <CustomFieldValues scope="internal_audit" data={audit.custom_data} />

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
        {audit.status !== 'completed' && editable && (
          <button onClick={complete} disabled={answered < rows.length}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
            data-tip={answered < rows.length ? 'Answer every question first' : undefined}>
            <CheckCircle2 size={15} /> Sign off audit
          </button>
        )}
        {audit.status === 'completed' && (user?.role === 'admin' || audit.signed_by === user?.name) && (
          <button onClick={revoke} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            <RotateCcw size={15} /> Revoke sign-off
          </button>
        )}
        <button onClick={downloadPdf} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
          <Download size={15} /> Checklist PDF
        </button>
      </div>

      {carFor && (
        <CarModal auditId={id} item={carFor} users={users} onClose={() => setCarFor(null)}
          onRaised={(out) => { setItems(out.items); setCarFor(null); onChanged?.(); }} />
      )}
    </div>
  );
}

/* ── Register ────────────────────────────────────────────────────────────── */

export default function InternalAuditsPanel() {
  const { user } = useAuth();
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const { data: audits, loading, refresh } = useApiGet('/internal-audits');
  // The checklist is static, so one fetch serves the picker, the walkthrough
  // and the section titles in the list.
  const { data: checklist } = useApiGet('/internal-audits/checklist');

  const rows = audits || [];
  const lastCompleted = useMemo(
    () => rows.filter(a => a.status === 'completed').map(a => a.audit_date).sort().pop(),
    [rows],
  );

  const remove = async (a) => {
    if (!confirm(`Delete ${a.audit_no}? Nothing in it has been signed.`)) return;
    await apiDelete(`/internal-audits/${a.id}`);
    refresh();
  };

  if (openId) {
    return <AuditDetail id={openId} checklist={checklist} onBack={() => { setOpenId(null); refresh(); }} onChanged={refresh} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Internal Audits</h2>
          <p className="text-sm text-gray-500">
            {checklist ? `${checklist.code} Rev ${checklist.revision} · ` : ''}
            {rows.length} audit{rows.length === 1 ? '' : 's'}
            {lastCompleted && ` · last completed ${lastCompleted}`}
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
          <Plus size={16} /> New audit
        </button>
      </div>

      <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-2">
        <ClipboardCheck size={14} className="mt-0.5 shrink-0 text-gray-400" />
        <span>
          Pick the sections this audit covers — the rest are simply not part of the record, which is what the
          diagonal line on the paper form meant. Each not-compliant answer raises a CAR in the CAPA register.
          The monthly audit is scheduled under Quality Schedules.
        </span>
      </p>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-8 text-center">
          No internal audits recorded yet.
        </p>
      )}

      <div className="space-y-2">
        {rows.map(a => (
          <div key={a.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:bg-gray-50">
            <button onClick={() => setOpenId(a.id)} className="min-w-0 flex-1 text-left">
              <p className="font-medium text-gray-900 truncate">
                {a.audit_no} <span className="font-normal text-gray-500">· {a.audit_date}</span>
              </p>
              <p className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2.5">
                <span>{a.focus_areas || 'no focus area recorded'}</span>
                <span>{a.sections.length} section{a.sections.length === 1 ? '' : 's'}</span>
                <span>{a.answered_count} of {a.item_count} answered</span>
                {a.finding_count > 0 && (
                  <span className={a.open_car_count > 0 ? 'text-amber-700 font-medium' : 'text-gray-500'}>
                    {a.finding_count} finding{a.finding_count === 1 ? '' : 's'}
                    {a.open_car_count > 0 && ` · ${a.open_car_count} CAR open`}
                  </span>
                )}
              </p>
            </button>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${a.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
              {a.status === 'completed' ? 'Signed off' : 'In progress'}
            </span>
            {user?.role === 'admin' && a.status !== 'completed' && (
              <button onClick={() => remove(a)} className="text-gray-300 hover:text-red-500 shrink-0" data-tip="Delete"><Trash2 size={14} /></button>
            )}
            <ChevronRight size={16} className="text-gray-300 shrink-0" />
          </div>
        ))}
      </div>

      {creating && checklist && (
        <NewAuditModal checklist={checklist} onClose={() => setCreating(false)}
          onCreated={(a) => { setCreating(false); refresh(); setOpenId(a.id); }} />
      )}
    </div>
  );
}
