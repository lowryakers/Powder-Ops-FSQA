// Which controlled documents people are trained on, and which have nothing
// training on them at all.
//
// A course has carried `sop_id` since the training module was built and NOT
// ONE of this plant's courses used it — including the seven whose code IS a
// work-instruction number. So "retrain everyone when WI007 changes" was wired,
// tested and pointing at nothing, and nobody could see that from any screen.
//
// A JOB DESCRIPTION IS THE CASE NEITHER ROLE NOR DEPARTMENT CAN EXPRESS: it
// applies to whoever holds one org-chart position and to nobody else. So a
// course made from one takes its audience from the positions that cite it —
// offered, never applied, because who a document is for is a decision.

import { useState, useMemo } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { Search, Link2, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';

function CourseFromDocument({ doc, positions, onDone, onCancel }) {
  const [depts, setDepts] = useState([]);
  const [pos, setPos] = useState(() => (doc.suggested_positions || []).map(p => p.id));
  const [months, setMonths] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const DEPTS = useMemo(() => ['production', 'warehouse', 'qa', 'cleaning', 'maintenance', 'office', 'document_control'], []);
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await apiFetch(`/training/documents/${doc.id}/course`, {
        method: 'POST',
        body: JSON.stringify({
          required_departments: depts,
          required_positions: pos,
          retrain_months: months ? Number(months) : null,
        }),
      });
      onDone();
    } catch (e) { setErr(e.message || 'Could not create the course.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-2 border border-powder-200 rounded-lg p-3 bg-powder-50/40 space-y-2" data-doc-course-form>
      <p className="text-xs text-gray-600">
        A course trained against <span className="font-semibold">{doc.doc_number}</span> — {doc.title}.
        Leave every audience unticked and it applies to <span className="font-semibold">everyone</span>.
      </p>

      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Departments</p>
        <div className="flex flex-wrap gap-1">
          {DEPTS.map(d => (
            <button type="button" key={d} onClick={() => toggle(depts, setDepts, d)}
              className={`px-2 py-1 rounded-lg text-xs border capitalize ${depts.includes(d) ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300'}`}>
              {d.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
          Positions {doc.doc_type === 'job_description' ? '(pre-filled from the org chart)' : ''}
        </p>
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
          {(positions || []).map(p => (
            <button type="button" key={p.id} onClick={() => toggle(pos, setPos, p.id)}
              data-doc-position={p.title}
              title={p.held ? `Held by ${p.holder}` : 'Nobody holds this position'}
              className={`px-2 py-1 rounded-lg text-xs border ${pos.includes(p.id) ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300'} ${p.held ? '' : 'opacity-60'}`}>
              {p.title}{p.held ? '' : ' · vacant'}
            </button>
          ))}
        </div>
      </div>

      <label className="block text-xs text-gray-600">Retrain every (months) — blank means once, plus whenever the document changes
        <input value={months} onChange={e => setMonths(e.target.value.replace(/[^0-9]/g, ''))}
          className="mt-0.5 w-24 px-2 py-1 border border-gray-300 rounded text-sm" placeholder="—" />
      </label>

      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} data-doc-course-save
          className="px-3 py-1.5 bg-powder-600 text-white rounded text-xs font-bold hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Creating…' : 'Create the course'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-white text-gray-600 rounded text-xs border border-gray-200">Cancel</button>
      </div>
    </div>
  );
}

export default function TrainingDocumentsPanel({ onCoursesChanged }) {
  const { data, loading, refresh } = useApiGet('/training/documents');
  const { data: positions } = useApiGet('/training/positions');
  const [q, setQ] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [linking, setLinking] = useState(false);

  const rows = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return (data?.documents || []).filter(d => {
      if (onlyGaps && d.covered) return false;
      if (!needle) return true;
      return [d.doc_number, d.title, d.type_label].some(v => v && v.toLowerCase().includes(needle));
    });
  }, [data, q, onlyGaps]);

  const link = async () => {
    setLinking(true);
    try { await apiFetch('/training/documents/link', { method: 'POST', body: JSON.stringify({}) }); refresh(); onCoursesChanged?.(); }
    catch (e) { window.alert(e.message); }
    finally { setLinking(false); }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading documents…</div>;

  const linkable = data?.linkable || [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        The SOPs, Work Instructions, Job Descriptions and Policies in the register, and what trains on each.
        A course linked to a document retrains its people when that document is revised.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Documents', value: data?.total ?? 0, tone: 'text-gray-900' },
          { label: 'With a course', value: data?.covered ?? 0, tone: 'text-green-700' },
          { label: 'Nothing trains on it', value: data?.uncovered ?? 0, tone: (data?.uncovered ? 'text-amber-600' : 'text-gray-900') },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold ${c.tone}`} data-doc-card={c.label}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Derived on every read, so acting on it clears it — and it renders
          nothing once every course that names a document number is linked. */}
      {linkable.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3" data-doc-link-strip>
          <p className="text-sm font-semibold text-amber-900">
            {linkable.length} course{linkable.length === 1 ? '' : 's'} name a document number that is in the register
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5">
            {linkable.slice(0, 6).map(l => `${l.code} → ${l.doc_number}`).join(' · ')}
            {linkable.length > 6 ? ` · and ${linkable.length - 6} more` : ''}
          </p>
          <p className="text-[11px] text-amber-700 mt-1">
            Linking does not change anybody&rsquo;s training record — completions already on file keep the
            revision they were taken against, so nobody is declared outdated by this.
          </p>
          <button type="button" onClick={link} disabled={linking} data-doc-link
            className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 disabled:opacity-50">
            <Link2 size={12} /> {linking ? 'Linking…' : 'Link them'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOnlyGaps(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${onlyGaps ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Only documents with no course
        </button>
        <div className="relative w-full sm:w-64 sm:ml-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search number or title…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {rows.map(d => (
          <div key={d.id} className="px-3 py-2" data-doc-row={d.doc_number}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-gray-900">
                  <span className="font-semibold">{d.doc_number}</span> · {d.title}
                </p>
                <p className="text-[11px] text-gray-500">
                  {d.type_label}{d.revision ? ` · ${d.revision}` : ''}
                  {d.courses.length ? ` · trained by ${d.courses.map(c => c.code || c.title).join(', ')}` : ''}
                </p>
                {d.doc_type === 'job_description' && d.suggested_positions.length > 0 && (
                  <p className="text-[11px] text-gray-500">
                    Held by {d.suggested_positions.map(p => p.title + (p.user_id ? '' : ' (vacant)')).join(', ')}
                  </p>
                )}
                {d.unheld && (
                  <p className="text-[11px] text-amber-700">
                    Nobody holds the position this describes — a gap in the org chart, not in training.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {d.covered ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                    <CheckCircle2 size={11} /> Course on file
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                      <AlertTriangle size={11} /> No course
                    </span>
                    <button type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)}
                      data-doc-add-course
                      className="inline-flex items-center gap-1 text-xs text-powder-700 hover:text-powder-900 font-medium">
                      <Plus size={12} /> Add a course
                    </button>
                  </>
                )}
              </div>
            </div>
            {openId === d.id && (
              <CourseFromDocument doc={d} positions={positions}
                onCancel={() => setOpenId(null)}
                onDone={() => { setOpenId(null); refresh(); onCoursesChanged?.(); }} />
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="px-3 py-6 text-center text-gray-500 text-sm">No documents match.</p>}
      </div>
    </div>
  );
}
