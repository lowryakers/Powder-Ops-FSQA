import { useState } from 'react';
import { X, Download, Users } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import { downloadFile } from '../../lib/downloadFile';
import { formatDateTime } from '../../lib/datetime';

// Who was trained on one course (D-351) — the page an auditor asks for
// ("show me QA and Purchasing were trained on SOP 404"). Pick departments to
// list everyone in them, trained or not; Download prints the same list.
const BAD = ['missing', 'overdue', 'outdated'];

export default function CourseRosterModal({ course, onClose }) {
  const [depts, setDepts] = useState([]);
  const q = depts.length ? `?departments=${encodeURIComponent(depts.join(','))}` : '';
  const { data, loading, error } = useApiGet(`/training/courses/${course.id}/roster${q}`, [q]);
  const toggle = (k) => setDepts(d => (d.includes(k) ? d.filter(x => x !== k) : [...d, k]));
  const pdf = () => downloadFile(`/training/courses/${course.id}/roster.pdf${q}`,
    `training-roster-${String(course.code || course.title).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`).catch(e => alert(e.message));

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} data-course-roster
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">Who is trained</h3>
            <p className="text-sm text-gray-600">{course.code ? `${course.code} — ` : ''}{course.title}</p>
            {data?.document && (
              <p className="text-xs text-gray-500">{data.document.doc_number} · revision in force {data.document.revision || '—'}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-700 mb-1">Departments <span className="font-normal text-gray-500">— pick some to list everyone in them, trained or not</span></p>
          <div className="flex flex-wrap gap-1.5">
            {(data?.departments_available || []).map(d => (
              <button key={d.key} type="button" onClick={() => toggle(d.key)} data-roster-dept={d.key}
                className={`px-2.5 py-1 rounded-full text-xs border ${depts.includes(d.key) ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-gray-700" data-roster-count>
                <Users size={14} className="inline mr-1" />{data.counts.trained} of {data.counts.people} trained
              </p>
              <button type="button" onClick={pdf} data-roster-pdf
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-powder-600 text-white rounded-lg hover:bg-powder-700">
                <Download size={14} /> Download PDF
              </button>
            </div>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {data.rows.length === 0 && <p className="p-3 text-sm text-gray-500">Nobody to list yet.</p>}
              {data.rows.map(r => (
                <div key={r.user_id} className="p-3 text-sm flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3" data-roster-row={r.state}>
                  <div className="sm:w-48 shrink-0">
                    <p className="font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-500">{r.department_label}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full self-start sm:self-auto ${BAD.includes(r.state) ? 'bg-red-100 text-red-700' : r.state === 'exempt' ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-800'}`}>
                    {r.state_label}
                  </span>
                  {r.trained_on && (
                    <p className="text-xs text-gray-600 flex-1">
                      {r.trained_on}{r.method ? ` · ${r.method}` : ''}{r.revision ? ` · rev ${r.revision}` : ''}
                      {r.sign_off?.by && <> · signed by {r.sign_off.by}, {formatDateTime(r.sign_off.at)}</>}
                      {r.sign_off?.test && <> · passed test{r.sign_off.score != null ? ` (${r.sign_off.score}%)` : ''}</>}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        {loading && !data && <p className="text-sm text-gray-500">Loading…</p>}
      </div>
    </div>
  );
}
