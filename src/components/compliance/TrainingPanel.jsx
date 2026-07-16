import { useState, useMemo, useEffect } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { GraduationCap, Plus, Upload, Search, X, ExternalLink, Edit2, Paperclip, AlertTriangle, Clock, CheckCircle, Sparkles, Trash2, FileQuestion, Users } from 'lucide-react';

const CATEGORIES = ['GMP', 'Food Safety', 'HACCP', 'Allergen', 'Food Defense', 'Sanitation', 'Safety', 'Onboarding', 'Other'];
const ROLES = ['admin', 'supervisor', 'operator', 'auditor'];
const DEPARTMENTS = ['warehouse', 'qa', 'document_control', 'cleaning', 'production', 'maintenance', 'office'];
const FREQ = [{ v: '', l: 'One-time' }, { v: 12, l: 'Annual' }, { v: 24, l: 'Biennial' }, { v: 6, l: 'Every 6 months' }, { v: 3, l: 'Quarterly' }];
const freqLabel = (m) => FREQ.find(f => String(f.v) === String(m || ''))?.l || (m ? `Every ${m} mo` : 'One-time');

const CELL = {
  current: { bg: 'bg-green-100', text: 'text-green-800', label: 'Current' },
  due_soon: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Due soon' },
  outdated: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Doc updated' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
  missing: { bg: 'bg-gray-100', text: 'text-gray-400', label: 'Not trained' },
  exempt: { bg: 'bg-slate-50', text: 'text-slate-300', label: 'Exempt' },
};

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('files', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  const [u] = await res.json();
  return u?.url;
}

function StatCard({ label, value, tone, active, onClick }) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-700', amber: 'border-amber-200 bg-amber-50 text-amber-700',
    gray: 'border-gray-200 bg-gray-50 text-gray-600', green: 'border-green-200 bg-green-50 text-green-700',
  };
  return (
    <button onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-shadow hover:shadow-sm ${tones[tone]} ${active ? 'ring-2 ring-offset-1 ring-powder-400' : ''}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5">{label}</p>
    </button>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────
function ImportModal({ onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const handle = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try { const csv = await file.text(); setResult(await apiPost('/training/import', { csv })); onDone(); }
    catch (err) { setError(err.message || 'Import failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Import training records (CSV)</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">Columns matched automatically: <span className="font-medium">Employee, Course, Date, Score, Trainer, Notes</span>. Course names are linked to the catalog where they match; unmatched ones import as free-text and can be linked later.</p>
        {result ? (
          <div className="text-sm bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
            Imported {result.imported} record{result.imported === 1 ? '' : 's'} — {result.linked} linked to a course, {result.unlinked} unlinked.
          </div>
        ) : (
          <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-8 cursor-pointer hover:bg-gray-50">
            <Upload size={22} className="text-gray-400" />
            <span className="text-sm text-gray-600 font-medium">{busy ? 'Importing…' : 'Choose a .csv file'}</span>
            <input type="file" accept=".csv" className="hidden" onChange={handle} disabled={busy} />
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end"><button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Close</button></div>
      </div>
    </div>
  );
}

// ── Completion modal ──────────────────────────────────────────────────────────
function CompletionModal({ initial, courses, users, onClose, onSaved }) {
  const [form, setForm] = useState(initial || {
    employee_name: '', course_id: '', training_date: new Date().toISOString().slice(0, 10),
    completion_date: new Date().toISOString().slice(0, 10), method: 'in_person', score: '', trainer: '', notes: '', document_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const match = (users || []).find(u => u.name.toLowerCase() === form.employee_name.trim().toLowerCase());
      const payload = { ...form, employee_user_id: match?.id || null, status: 'completed' };
      if (initial?.id) await apiPut(`/training/${initial.id}`, payload);
      else await apiPost('/training', payload);
      onSaved();
    } finally { setSaving(false); }
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(true);
    try { set('document_url', await uploadFile(file)); } finally { setUploading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit' : 'Log'} training completion</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Employee *</label>
            <input required list="tr-users" value={form.employee_name} onChange={e => set('employee_name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Start typing a name…" />
            <datalist id="tr-users">{(users || []).map(u => <option key={u.id} value={u.name} />)}</datalist>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Course *</label>
            <select required value={form.course_id} onChange={e => set('course_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">— Select course —</option>
              {(courses || []).filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ''}{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Completed *</label>
            <input type="date" required value={form.completion_date} onChange={e => set('completion_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
            <select value={form.method || ''} onChange={e => set('method', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {['in_person', 'read_and_sign', 'online_test', 'external'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Score (%)</label>
            <input type="number" min="0" max="100" value={form.score || ''} onChange={e => set('score', e.target.value ? parseFloat(e.target.value) : '')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Trainer</label>
            <input value={form.trainer || ''} onChange={e => set('trainer', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Scanned form / certificate</label>
            {form.document_url ? (
              <div className="flex items-center gap-2 text-sm">
                <a href={form.document_url} target="_blank" rel="noreferrer" className="text-powder-600 hover:underline flex items-center gap-1"><ExternalLink size={13} /> View attached</a>
                <button type="button" onClick={() => set('document_url', '')} className="text-gray-400 hover:text-red-500 text-xs">remove</button>
              </div>
            ) : (
              <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-600 cursor-pointer hover:bg-gray-200">
                <Paperclip size={14} /> {uploading ? 'Uploading…' : 'Attach file'}
                <input type="file" className="hidden" onChange={onFile} disabled={uploading} />
              </label>
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save completion'}</button>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ── Group training modal ──────────────────────────────────────────────────────
function GroupTrainingModal({ courses, users, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState(today);
  const [trainer, setTrainer] = useState('');
  const [method, setMethod] = useState('in_person');
  const [sel, setSel] = useState({}); // userId -> { checked, name, score }
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const list = useMemo(() => (users || []).filter(u => u.is_active !== 0 && (!search || u.name.toLowerCase().includes(search.toLowerCase()))), [users, search]);
  const toggle = (u) => setSel(s => ({ ...s, [u.id]: s[u.id]?.checked ? { ...s[u.id], checked: false } : { checked: true, name: u.name, score: '' } }));
  const setScore = (id, v) => setSel(s => ({ ...s, [id]: { ...s[id], score: v } }));
  const chosen = Object.entries(sel).filter(([, v]) => v.checked);

  const save = async () => {
    if (!courseId) { setError('Pick a course.'); return; }
    if (chosen.length === 0) { setError('Select at least one attendee.'); return; }
    setSaving(true); setError('');
    try {
      const res = await apiPost('/training/bulk-complete', {
        course_id: courseId, completion_date: date, training_date: date, trainer, method,
        attendees: chosen.map(([id, v]) => ({ employee_user_id: id, employee_name: v.name, score: v.score })),
      });
      onSaved(res.created);
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900">Record group training</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Course *</label>
              <select value={courseId} onChange={e => setCourseId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">— Select course —</option>
                {(courses || []).filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ''}{c.title}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {['in_person', 'read_and_sign', 'online_test', 'external'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Trainer</label>
              <input value={trainer} onChange={e => setTrainer(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-700">Attendees ({chosen.length} selected)</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="px-2 py-1 border border-gray-300 rounded-lg text-xs w-32" />
            </div>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {list.map(u => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-1.5">
                  <input type="checkbox" checked={!!sel[u.id]?.checked} onChange={() => toggle(u)} />
                  <span className="flex-1 text-sm text-gray-800">{u.name} <span className="text-[11px] text-gray-400 capitalize">{(u.department || '').replace(/_/g, ' ')}</span></span>
                  {sel[u.id]?.checked && (
                    <input type="number" min="0" max="100" value={sel[u.id].score} onChange={e => setScore(u.id, e.target.value)} placeholder="score" className="w-16 px-2 py-1 border border-gray-300 rounded text-xs" />
                  )}
                </div>
              ))}
              {list.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No matching people.</p>}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Leave score blank for attendance-only; a score is marked pass/fail against the course threshold.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex items-center gap-2 p-4 border-t">
          <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : `Record ${chosen.length || ''} completion${chosen.length === 1 ? '' : 's'}`}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Course modal ──────────────────────────────────────────────────────────────
function CourseModal({ initial, onClose, onSaved }) {
  const { data: allDocs } = useApiGet('/documents');
  const docs = useMemo(() => (allDocs || []).filter(d => d.doc_type === 'sop' || d.doc_type === 'work_instruction'), [allDocs]);
  const [form, setForm] = useState(initial || {
    code: '', title: '', category: 'GMP', description: '', retrain_months: 12,
    required_roles: [], required_departments: [], passing_score: 80, active: true,
    sop_id: '', retrain_on_doc_change: true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (k, v) => set(k, form[k].includes(v) ? form[k].filter(x => x !== v) : [...form[k], v]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, retrain_months: form.retrain_months || null };
      if (initial?.id) await apiPut(`/training/courses/${initial.id}`, payload);
      else await apiPost('/training/courses', payload);
      onSaved();
    } finally { setSaving(false); }
  };
  const allStaff = form.required_roles.length === 0 && form.required_departments.length === 0;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit' : 'New'} course</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
            <input value={form.code || ''} onChange={e => set('code', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="GMP-101" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input required value={form.title} onChange={e => set('title', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Retrain</label>
            <select value={form.retrain_months || ''} onChange={e => set('retrain_months', e.target.value ? parseInt(e.target.value) : '')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {FREQ.map(f => <option key={f.l} value={f.v}>{f.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Pass score (%)</label>
            <input type="number" min="0" max="100" value={form.passing_score} onChange={e => set('passing_score', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="col-span-3">
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Required for {allStaff && <span className="text-powder-600 font-normal">(all staff — no roles/departments selected)</span>}</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {ROLES.map(r => <button type="button" key={r} onClick={() => toggle('required_roles', r)} className={`px-2 py-1 rounded-lg text-xs border capitalize ${form.required_roles.includes(r) ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300'}`}>{r}</button>)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DEPARTMENTS.map(d => <button type="button" key={d} onClick={() => toggle('required_departments', d)} className={`px-2 py-1 rounded-lg text-xs border capitalize ${form.required_departments.includes(d) ? 'bg-powder-700 text-white border-powder-700' : 'bg-white text-gray-600 border-gray-300'}`}>{d.replace(/_/g, ' ')}</button>)}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Linked document (SOP / WI)</label>
          <select value={form.sop_id || ''} onChange={e => set('sop_id', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">— None —</option>
            {docs.map(d => <option key={d.id} value={d.id}>{d.doc_number ? `${d.doc_number} — ` : ''}{d.title}</option>)}
          </select>
          {form.sop_id && (
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-2">
              <input type="checkbox" checked={!!form.retrain_on_doc_change} onChange={e => set('retrain_on_doc_change', e.target.checked)} />
              Flag completions for retraining when this document is materially updated
            </label>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} /> Active</label>
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save course'}</button>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

// ── Test editor ───────────────────────────────────────────────────────────────
const blankQuestion = () => ({ type: 'multiple_choice', prompt: '', options: ['', ''], correct_answer: '0', points: 1 });

function QuestionEditor({ q, onChange, onRemove, index, lang = 'en' }) {
  const es = lang === 'es';
  const set = (patch) => onChange({ ...q, ...patch });
  const setType = (type) => {
    if (type === 'true_false') set({ type, options: ['True', 'False'], correct_answer: 'true' });
    else if (type === 'short_answer') set({ type, options: [], correct_answer: '' });
    else set({ type, options: q.options.length >= 2 ? q.options : ['', ''], correct_answer: '0' });
  };
  const setOption = (i, v) => {
    if (es) { const oe = [...(q.options_es || [])]; oe[i] = v; set({ options_es: oe }); }
    else set({ options: q.options.map((o, j) => j === i ? v : o) });
  };
  const addOption = () => set({ options: [...q.options, ''] });
  const removeOption = (i) => {
    const options = q.options.filter((_, j) => j !== i);
    const options_es = (q.options_es || []).filter((_, j) => j !== i);
    let correct = parseInt(q.correct_answer, 10);
    if (correct === i) correct = 0; else if (correct > i) correct -= 1;
    set({ options, options_es, correct_answer: String(correct) });
  };

  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2 bg-gray-50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400">Q{index + 1}</span>
        <select value={q.type} disabled={es} onChange={e => setType(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white disabled:opacity-60">
          <option value="multiple_choice">Multiple choice</option>
          <option value="true_false">True / False</option>
          <option value="short_answer">Short answer</option>
        </select>
        {es && <span className="text-[11px] text-violet-600 font-medium">Español</span>}
        <button type="button" onClick={onRemove} disabled={es} className="ml-auto p-1 text-gray-400 hover:text-red-500 rounded disabled:opacity-40"><Trash2 size={14} /></button>
      </div>
      <textarea value={es ? (q.prompt_es || '') : q.prompt} onChange={e => set(es ? { prompt_es: e.target.value } : { prompt: e.target.value })} rows={2}
        placeholder={es ? 'Traducción al español…' : 'Question prompt…'}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />

      {q.type === 'multiple_choice' && (
        <div className="space-y-1.5">
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${q._k}`} checked={String(q.correct_answer) === String(i)} onChange={() => set({ correct_answer: String(i) })} disabled={es} title="Mark correct" />
              <input value={es ? (q.options_es?.[i] || '') : o} onChange={e => setOption(i, e.target.value)} placeholder={es ? `Opción ${i + 1}` : `Option ${i + 1}`} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white" />
              {!es && q.options.length > 2 && <button type="button" onClick={() => removeOption(i)} className="p-1 text-gray-300 hover:text-red-500"><X size={14} /></button>}
            </div>
          ))}
          {!es && <button type="button" onClick={addOption} className="text-xs text-powder-600 hover:underline">+ Add option</button>}
        </div>
      )}
      {q.type === 'true_false' && (
        <div className="flex gap-2">
          {['true', 'false'].map(v => (
            <button type="button" key={v} onClick={() => set({ correct_answer: v })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border capitalize ${q.correct_answer === v ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300'}`}>{v}</button>
          ))}
          <span className="text-xs text-gray-400 self-center">← correct answer</span>
        </div>
      )}
      {q.type === 'short_answer' && (
        <input value={q.correct_answer} onChange={e => set({ correct_answer: e.target.value })} placeholder="Expected answer / keyword (auto-graded by match)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
      )}
    </div>
  );
}

function TestEditor({ course, aiEnabled, onClose, onSaved }) {
  const [title, setTitle] = useState(`${course.title} Test`);
  const [passing, setPassing] = useState(course.passing_score || 80);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [testLang, setTestLang] = useState('en');
  const [error, setError] = useState('');
  const [changes, setChanges] = useState([]);
  const withKeys = (arr) => arr.map((q, i) => ({ ...q, _k: q._k || `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}` }));

  const translateEs = async () => {
    setTranslating(true); setError('');
    try {
      const strings = []; const map = [];
      questions.forEach((q, qi) => {
        strings.push(q.prompt || ''); map.push([qi, 'prompt']);
        if (q.type === 'multiple_choice') (q.options || []).forEach((o, oi) => { strings.push(o || ''); map.push([qi, 'opt', oi]); });
      });
      const r = await apiPost('/ai/translate', { items: strings });
      const out = r.items || [];
      setQuestions(qs => {
        const nq = qs.map(q => ({ ...q, options_es: [...(q.options_es || [])] }));
        map.forEach(([qi, kind, oi], idx) => { if (kind === 'prompt') nq[qi].prompt_es = out[idx]; else nq[qi].options_es[oi] = out[idx]; });
        return nq;
      });
      setTestLang('es');
    } catch (e) { setError(e.message || 'Translation failed'); }
    finally { setTranslating(false); }
  };

  useEffect(() => {
    if (!course.sop_id) return;
    const since = course.test_sop_revision ? `?since=${encodeURIComponent(course.test_sop_revision)}` : '';
    apiFetch(`/training/courses/${course.id}/changes${since}`).then(r => setChanges((r.changes || []).filter(c => !c.minor))).catch(() => {});
  }, [course.id, course.sop_id, course.test_sop_revision]);

  useEffect(() => {
    let stale = false;
    apiFetch(`/training/courses/${course.id}/test?authoring=1`)
      .then(t => { if (!stale) { setTitle(t.title || `${course.title} Test`); setPassing(t.passing_score || 80); setQuestions(withKeys(t.questions || [])); } })
      .catch(() => { /* no test yet */ })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  const setQ = (i, q) => setQuestions(qs => qs.map((x, j) => j === i ? q : x));
  const addQ = () => setQuestions(qs => withKeys([...qs, blankQuestion()]));
  const removeQ = (i) => setQuestions(qs => qs.filter((_, j) => j !== i));

  const generate = async () => {
    setGenerating(true); setError('');
    try {
      const res = await apiPost(`/training/courses/${course.id}/test/generate`, { count: 5 });
      setQuestions(qs => withKeys([...qs, ...(res.questions || [])]));
    } catch (e) { setError(e.message || 'Generation failed'); }
    finally { setGenerating(false); }
  };

  const save = async () => {
    const clean = questions.filter(q => q.prompt.trim() && (q.type === 'short_answer' || q.options.filter(Boolean).length >= 2));
    if (!clean.length) { setError('Add at least one complete question.'); return; }
    setSaving(true); setError('');
    try {
      await apiPut(`/training/courses/${course.id}/test`, {
        title, passing_score: passing,
        questions: clean.map(({ _k, ...q }) => q), // eslint-disable-line no-unused-vars
      });
      onSaved();
    } catch (e) { setError(e.message || 'Save failed'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <FileQuestion size={18} className="text-powder-600" />
            <h3 className="font-semibold text-gray-900">Test — {course.code ? `${course.code} · ` : ''}{course.title}</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Test title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-700 mb-1">Pass score (%)</label>
              <input type="number" min="0" max="100" value={passing} onChange={e => setPassing(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            {aiEnabled && (
              <button type="button" onClick={generate} disabled={generating}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50">
                <Sparkles size={15} /> {generating ? 'Generating…' : 'Generate with AI'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
              <button type="button" onClick={() => setTestLang('en')} className={`px-2.5 py-1 text-xs font-bold ${testLang === 'en' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>EN</button>
              <button type="button" onClick={() => setTestLang('es')} className={`px-2.5 py-1 text-xs font-bold ${testLang === 'es' ? 'bg-powder-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>ES</button>
            </div>
            {aiEnabled && questions.length > 0 && (
              <button type="button" onClick={translateEs} disabled={translating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100 disabled:opacity-50">
                <Sparkles size={13} /> {translating ? 'Translating…' : 'Translate questions to Spanish'}
              </button>
            )}
            {testLang === 'es' && <span className="text-[11px] text-gray-400">Editing the Spanish version — review AI drafts.</span>}
          </div>
          {aiEnabled && <p className="text-xs text-gray-400 -mt-1">AI drafts questions from the course{course.sop_id ? ' and its linked document' : ''} — review and edit before saving.</p>}

          {course.sop_test_stale && changes.length > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
              <div className="flex items-center gap-2 font-medium text-orange-800 text-sm mb-1"><AlertTriangle size={15} /> Linked document updated since this test was written</div>
              <ul className="text-xs text-orange-900/80 space-y-0.5 list-disc pl-5">
                {changes.slice(0, 6).map((c, i) => <li key={i}><span className="font-medium">rev {c.revision}</span>{c.summary ? ` — ${c.summary}` : ''}</li>)}
              </ul>
              <p className="text-xs text-gray-500 mt-1.5">Review the questions{aiEnabled ? ' (or use Generate with AI to draft updates)' : ''}, then save — the test re-anchors to the current revision.</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-500 text-sm">Loading…</div>
          ) : (
            <div className="space-y-2">
              {questions.map((q, i) => (
                <QuestionEditor key={q._k} q={q} index={i} lang={testLang} onChange={nq => setQ(i, nq)} onRemove={() => removeQ(i)} />
              ))}
              {questions.length === 0 && <p className="text-sm text-gray-500 text-center py-6">No questions yet. Add one, or generate a draft with AI.</p>}
              <button type="button" onClick={addQ} className="inline-flex items-center gap-1.5 text-sm text-powder-600 hover:underline"><Plus size={14} /> Add question</button>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center gap-2 p-4 border-t">
          <button onClick={save} disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save test'}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export default function TrainingPanel() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'training');
  const { data: matrix, refresh: refreshMatrix } = useApiGet('/training/matrix');
  const { data: courses, refresh: refreshCourses } = useApiGet('/training/courses');
  const { data: due } = useApiGet('/training/due');
  const { data: records, refresh: refreshRecords } = useApiGet('/training');
  const { data: users } = useApiGet('/users');
  const { data: aiStatus } = useApiGet('/ai/status');
  const aiOn = !!aiStatus?.enabled;
  const [view, setView] = useState('matrix');
  const [importing, setImporting] = useState(false);
  const [completion, setCompletion] = useState(null); // {} = new
  const [groupTraining, setGroupTraining] = useState(false);
  const [course, setCourse] = useState(null);
  const [testCourse, setTestCourse] = useState(null);
  const [search, setSearch] = useState('');
  const [flash, setFlash] = useState('');

  const refreshAll = () => { refreshMatrix(); refreshCourses(); refreshRecords(); };
  const counts = matrix?.counts || { missing: 0, overdue: 0, due_soon: 0, current: 0 };

  const filteredRecords = useMemo(() => {
    const s = search.toLowerCase().trim();
    return (records || []).filter(r => !s || r.employee_name?.toLowerCase().includes(s) || (r.course_title || r.training_topic || '').toLowerCase().includes(s));
  }, [records, search]);

  const TABS = [['matrix', 'Compliance Matrix'], ['due', 'Retraining Due'], ['courses', 'Courses'], ['records', 'Records']];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap size={22} className="text-powder-600" />
          <h2 className="text-xl font-bold text-gray-900">Training</h2>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setImporting(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Upload size={15} /> Import</button>
            <button onClick={() => setCourse({})} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Plus size={15} /> Course</button>
            <button onClick={() => setGroupTraining(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Users size={15} /> Group Training</button>
            <button onClick={() => setCompletion({})} className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700"><Plus size={16} /> Log Completion</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Overdue" value={counts.overdue} tone="red" active={view === 'due'} onClick={() => setView('due')} />
        <StatCard label="Due soon" value={counts.due_soon} tone="amber" active={view === 'due'} onClick={() => setView('due')} />
        <StatCard label="Not yet trained" value={counts.missing} tone="gray" active={view === 'matrix'} onClick={() => setView('matrix')} />
        <StatCard label="Current" value={counts.current} tone="green" active={view === 'matrix'} onClick={() => setView('matrix')} />
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setView(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${view === id ? 'border-powder-600 text-powder-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{label}</button>
        ))}
      </div>

      {/* Matrix */}
      {view === 'matrix' && matrix && (
        <div className="space-y-3">
          {counts.outdated > 0 && (
            <div className="flex items-center gap-2 text-sm bg-orange-50 border border-orange-200 text-orange-800 rounded-xl p-3">
              <AlertTriangle size={16} />
              {counts.outdated} completed training{counts.outdated === 1 ? '' : 's'} need{counts.outdated === 1 ? 's' : ''} refreshing — a linked document changed since it was completed.
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {Object.entries(CELL).filter(([k]) => k !== 'exempt').map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5"><span className={`inline-block w-3 h-3 rounded-sm ${v.bg}`} /> {v.label}</span>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-white z-10 min-w-[160px]">Employee</th>
                  {matrix.courses.map(c => (
                    <th key={c.id} className="px-2 py-2 font-medium text-gray-500 text-center min-w-[52px]" title={`${c.title} · ${freqLabel(c.retrain_months)}`}>
                      <span className="text-[11px]">{c.code || c.title.slice(0, 6)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.users.map(u => (
                  <tr key={u.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-1.5 sticky left-0 bg-white z-10">
                      <span className="font-medium text-gray-800">{u.name}</span>
                      <span className="block text-[11px] text-gray-400 capitalize">{u.department}</span>
                    </td>
                    {matrix.courses.map(c => {
                      const cell = matrix.matrix[u.id]?.cells[c.id];
                      if (!cell) return <td key={c.id} className="px-2 py-1.5 text-center text-gray-200">·</td>;
                      const s = CELL[cell.state] || CELL.missing;
                      return (
                        <td key={c.id} className="px-2 py-1.5 text-center" title={`${u.name} — ${c.title}: ${s.label}${cell.next_due_date ? ` (due ${cell.next_due_date})` : ''}`}>
                          <span className={`inline-block w-6 h-6 rounded ${s.bg}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Due */}
      {view === 'due' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {(due || []).length === 0 ? (
            <div className="text-center py-10 text-gray-500 flex flex-col items-center gap-2"><CheckCircle size={28} className="text-green-500" /> No retraining due in the next 30 days.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b"><tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Course</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Due</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
              </tr></thead>
              <tbody>
                {(due || []).map(d => (
                  <tr key={d.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-gray-800">{d.employee_name}</td>
                    <td className="px-4 py-2 text-gray-600">{d.course_code ? `${d.course_code} — ` : ''}{d.course_title}</td>
                    <td className="px-4 py-2 text-gray-600">{d.next_due_date}</td>
                    <td className="px-4 py-2">
                      {d.overdue
                        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><AlertTriangle size={12} /> Overdue</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full"><Clock size={12} /> Due soon</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Courses */}
      {view === 'courses' && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(courses || []).map(c => (
            <div key={c.id} className={`rounded-xl border p-4 ${c.active ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{c.code ? `${c.code} — ` : ''}{c.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{c.category} · {freqLabel(c.retrain_months)}{c.has_current_test ? ' · has test' : ''}</p>
                  {c.sop_title && <p className="text-[11px] text-gray-400 mt-0.5">📄 {c.sop_number ? `${c.sop_number} — ` : ''}{c.sop_title}{c.sop_training_revision ? ` (rev ${c.sop_training_revision})` : ''}</p>}
                  {c.sop_test_stale && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium text-orange-800 bg-orange-100 px-2 py-0.5 rounded-full"><AlertTriangle size={11} /> SOP updated — test needs review</span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setTestCourse(c)} title="Manage test" className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-powder-600 hover:bg-gray-50 rounded-lg"><FileQuestion size={13} /> Test</button>
                    <button onClick={() => setCourse(c)} title="Edit course" className="p-1.5 text-gray-400 hover:text-powder-600 hover:bg-gray-50 rounded-lg"><Edit2 size={14} /></button>
                  </div>
                )}
              </div>
              {c.description && <p className="text-xs text-gray-600 mt-2 line-clamp-2">{c.description}</p>}
              <p className="text-[11px] text-gray-400 mt-2">
                Required: {c.required_roles.length === 0 && c.required_departments.length === 0 ? 'all staff' : [...c.required_roles, ...c.required_departments].join(', ')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Records */}
      {view === 'records' && (
        <div className="space-y-3">
          <div className="relative max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee or course…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b"><tr>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Course</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Completed</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Score</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Evidence</th>
                <th className="px-4 py-2"></th>
              </tr></thead>
              <tbody>
                {filteredRecords.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-gray-800">{r.employee_name}</td>
                    <td className="px-4 py-2 text-gray-600">{r.course_title || r.training_topic || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.completion_date || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.score != null ? `${r.score}%` : '—'}</td>
                    <td className="px-4 py-2">
                      {r.document_url
                        ? <a href={r.document_url} target="_blank" rel="noreferrer" className="text-powder-600 hover:underline inline-flex items-center gap-1 text-xs"><ExternalLink size={12} /> View</a>
                        : r.gdrive_url
                          ? <a href={r.gdrive_url} target="_blank" rel="noreferrer" className="text-powder-600 hover:underline inline-flex items-center gap-1 text-xs"><ExternalLink size={12} /> Drive</a>
                          : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {canEdit && <button onClick={() => setCompletion(r)} className="p-1.5 text-gray-400 hover:text-powder-600 rounded-lg"><Edit2 size={14} /></button>}
                    </td>
                  </tr>
                ))}
                {filteredRecords.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No training records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {importing && <ImportModal onClose={() => setImporting(false)} onDone={refreshAll} />}
      {completion && <CompletionModal initial={completion.id ? completion : null} courses={courses} users={users} onClose={() => setCompletion(null)} onSaved={() => { setCompletion(null); refreshAll(); }} />}
      {course && <CourseModal initial={course.id ? course : null} onClose={() => setCourse(null)} onSaved={() => { setCourse(null); refreshCourses(); refreshMatrix(); }} />}
      {testCourse && <TestEditor course={testCourse} aiEnabled={aiOn} onClose={() => setTestCourse(null)} onSaved={() => { setTestCourse(null); refreshCourses(); }} />}
      {groupTraining && <GroupTrainingModal courses={courses} users={users} onClose={() => setGroupTraining(false)} onSaved={(n) => { setGroupTraining(false); refreshAll(); setFlash(`Recorded ${n} completion${n === 1 ? '' : 's'}.`); setTimeout(() => setFlash(''), 5000); }} />}
      {flash && <div className="fixed bottom-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{flash}</div>}
    </div>
  );
}
