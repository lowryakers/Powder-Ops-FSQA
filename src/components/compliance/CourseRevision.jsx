import { useState } from 'react';
import { apiPost } from '../../hooks/useApi';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * Which revision of its document a course teaches, and the one door that moves
 * it (D-277). When the document's approved revision is newer the course NEEDS
 * UPDATE. Marking it "updated for rev N" — or "no course change needed", with a
 * reason — is the only thing that assigns retraining for that revision.
 */
export default function CourseRevision({ course, canEdit, onChanged }) {
  const [open, setOpen] = useState(null);   // 'updated' | 'no_change'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  if (!course.sop_id) return null;

  const mark = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiPost(`/training/courses/${course.id}/revision`, { kind: open, note });
      setResult(r); setOpen(null); setNote('');
      onChanged?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-1.5 space-y-1" data-course-rev={course.code || course.title}>
      <p className="text-[11px] text-gray-500">
        Built on rev {course.built_on_revision || 'not recorded'}
        {course.doc_revision ? ` · document in force: rev ${course.doc_revision}` : ''}
      </p>
      {course.needs_update && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-800 bg-orange-100 px-2 py-0.5 rounded-full" data-course-needs-update>
          <AlertTriangle size={11} /> Needs update for rev {course.doc_revision} — no retraining assigned yet
        </span>
      )}
      {course.needs_update && canEdit && !open && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setOpen('updated')} data-course-mark="updated"
            className="px-2 py-1 text-[11px] font-semibold rounded-md bg-powder-600 text-white hover:bg-powder-700">
            Mark course updated for rev {course.doc_revision}
          </button>
          <button type="button" onClick={() => setOpen('no_change')} data-course-mark="no_change"
            className="px-2 py-1 text-[11px] font-semibold rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            No course change needed
          </button>
        </div>
      )}
      {open && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-1.5" data-course-mark-form>
          <p className="text-[11px] text-gray-700">
            {open === 'updated'
              ? `The course now teaches revision ${course.doc_revision}.`
              : `Revision ${course.doc_revision} changes nothing this course teaches.`}
            {course.retrain_on_doc_change ? ' Everyone trained on an earlier revision is assigned retraining.' : ' This course does not retrain on a document change.'}
          </p>
          <input value={note} onChange={e => setNote(e.target.value)} data-course-mark-note
            placeholder={open === 'no_change' ? 'Why no change is needed (required)' : 'What changed in the course (optional)'}
            className="w-full px-2 py-1 border border-gray-300 rounded text-xs" />
          <div className="flex gap-1.5">
            <button type="button" onClick={mark} disabled={busy} data-course-mark-confirm
              className="px-2 py-1 text-[11px] font-semibold rounded-md bg-powder-600 text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => { setOpen(null); setError(''); }} className="px-2 py-1 text-[11px] text-gray-600">Cancel</button>
          </div>
        </div>
      )}
      {result && (
        <p className="text-[11px] text-green-800 flex items-center gap-1" data-course-mark-result>
          <CheckCircle2 size={11} /> Marked for rev {result.revision}. Retraining assigned to {result.created.length}
          {result.skipped.length ? ` · ${result.skipped.length} already had it open` : ''}.
        </p>
      )}
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
