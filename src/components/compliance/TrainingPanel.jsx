import { useState, useMemo, useEffect, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload, apiDelete } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { GraduationCap, Plus, Upload, Search, X, ExternalLink, Edit2, Paperclip, AlertTriangle, Clock, CheckCircle, Sparkles, Trash2, FileQuestion, Users, Video, FileText, Loader2 } from 'lucide-react';
import { DEPARTMENT_VALUES } from '../../constants/departments';
import ModuleTabs from '../common/ModuleTabs.jsx';
import { useModuleTabs } from '../../lib/useModuleTabs.js';
import { useTableSort } from '../../lib/useTableSort';
import SortHeader from '../common/SortHeader.jsx';
import FilePreview from '../FilePreview.jsx';
import { pdfViewerUrl } from '../../lib/pdfUrl';
import { RecordCard, RecordCards } from '../common/RecordCards.jsx';

// Columns as data for the Records tab. Evidence and the actions cell have no
// key — a link is not a value to order by.
const TRAINING_RECORD_COLUMNS = [
  { key: 'employee_name', label: 'Employee', type: 'text' },
  // The cell falls back to training_topic for imported rows that never matched
  // a course, so the sort has to fall back the same way or those file under
  // blank and bury themselves at the end.
  { key: 'course_title', label: 'Course', type: 'text', sortValue: r => r.course_title || r.training_topic },
  { key: 'completion_date', label: 'Completed', type: 'date' },
  { key: 'score', label: 'Score', type: 'number' },
  { label: 'Evidence' },
  { label: '' },
];

const CATEGORIES = ['GMP', 'Food Safety', 'HACCP', 'Allergen', 'Food Defense', 'Sanitation', 'Safety', 'Onboarding', 'Other'];
const ROLES = ['admin', 'supervisor', 'operator', 'auditor'];
const DEPARTMENTS = DEPARTMENT_VALUES;
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

const fmtBytes = (n) => {
  if (!n && n !== 0) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(mb >= 10 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
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
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 max-h-[92vh] overflow-y-auto">
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

// ── Training Log import (the matrix spreadsheet) ──────────────────────────────
// Four steps on purpose, and the third is the only one that needs a person:
// the log's headings drifted over three years ("Food Defense", "Food Defense
// (WI)", "Food Defense SOP" are one training) and only someone who was there
// can say so. That's ~30 decisions instead of 3,600. Nothing is written until
// the preview has been seen.
// A zip of the plant's scanned tests. Everything the log needs is in the
// FILENAME — "06-01-2026 (LIGHT METER TEST) Bernardo Encisos" — so this reads
// names, not documents, and the scan itself is kept as the record's evidence.
//
// The mapping step is the point: the scans spell names the roster doesn't
// ("Encisos" / "Enciso"), and only a person can say those are the same man.
// Nothing is written until every person and topic has been confirmed, and
// anything left blank is skipped and can be mapped on a later run.
function ScannedTestsImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [step, setStep] = useState('pick'); // pick | map | done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [people, setPeople] = useState({});   // personKey → user id ('' = skip)
  const [topics, setTopics] = useState({});   // normalized topic → course id
  const [result, setResult] = useState(null);
  const [showProblems, setShowProblems] = useState(false);

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const analyze = async (f) => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', f);
      const a = await apiUpload('/training/import/scans/analyze', fd);
      setAnalysis(a);
      setPeople(Object.fromEntries(a.people.map(p => [p.key, p.suggested_user_id || ''])));
      setTopics(Object.fromEntries(a.topics.map(t => [norm(t.topic), t.suggested_course_id || ''])));
      setStep('map');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('people', JSON.stringify(people));
      fd.append('topics', JSON.stringify(topics));
      setResult(await apiUpload('/training/import/scans/commit', fd));
      setStep('done');
      onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const mappedPeople = Object.values(people).filter(Boolean).length;
  const mappedTopics = Object.values(topics).filter(Boolean).length;
  const willImport = (analysis?.people || []).reduce((n, p) => n + (people[p.key] ? p.count : 0), 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-900">Import scanned tests</h3>
            <p className="text-xs text-gray-500">
              A .zip of the scanned test PDFs. The person, topic and date are read from each filename.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {step === 'pick' && (
          <div className="space-y-2">
            <input type="file" accept=".zip,application/zip" onChange={e => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-gray-300 rounded-lg p-2" />
            <p className="text-[11px] text-gray-500">
              In Drive: select the folder → Download, which gives you a .zip. Filenames like
              &ldquo;06-01-2026 (LIGHT METER TEST) Bernardo Enciso.pdf&rdquo; are what this reads.
            </p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button onClick={() => file && analyze(file)} disabled={!file || busy}
              className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Reading…' : 'Read the zip'}
            </button>
          </div>
        )}

        {step === 'map' && analysis && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-700">{analysis.file_count} files</span>
              <span className="px-2 py-1 rounded-lg bg-green-100 text-green-800">{analysis.readable} readable</span>
              {analysis.problem_count > 0 && (
                <button onClick={() => setShowProblems(s => !s)} className="px-2 py-1 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200">
                  {analysis.problem_count} couldn&apos;t be read — {showProblems ? 'hide' : 'show'}
                </button>
              )}
              {!analysis.storage_ready && (
                <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-900">
                  File storage is off — records will import without the scan attached.
                </span>
              )}
            </div>

            {showProblems && (
              <div className="border border-amber-200 rounded-lg bg-amber-50 p-2 max-h-40 overflow-y-auto">
                {analysis.problems.map((p, i) => (
                  <p key={i} className="text-[11px] text-amber-900">
                    <span className="font-medium">{p.filename}</span> — {{
                      no_topic: 'no (topic) in the filename — probably a group form, not one person\'s test',
                      no_person: 'no name left after the date and topic',
                      no_date: 'no date in the filename',
                      partial_name: 'only one word of a name',
                    }[p.reason] || p.reason}
                  </p>
                ))}
              </div>
            )}

            <div>
              <p className="text-sm font-semibold text-gray-900 mb-1">People ({mappedPeople}/{analysis.people.length} matched)</p>
              <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto divide-y divide-gray-100">
                {analysis.people.map(p => (
                  <div key={p.key} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="text-sm text-gray-800 w-44 shrink-0 truncate" title={p.name}>{p.name}</span>
                    <span className="text-[11px] text-gray-400 w-12 shrink-0">{p.count}×</span>
                    <select value={people[p.key] ?? ''} onChange={e => setPeople(m => ({ ...m, [p.key]: e.target.value }))}
                      className={`flex-1 px-2 py-1 border rounded text-sm ${people[p.key] ? 'border-gray-300' : 'border-amber-300 bg-amber-50'}`}>
                      <option value="">Skip — don&apos;t import these</option>
                      {p.matched_user_id && <option value={p.matched_user_id}>{p.matched_user_name} (exact match)</option>}
                      {p.candidates.filter(c => c.id !== p.matched_user_id).map(c => (
                        <option key={c.id} value={c.id}>{c.name} — {c.score}% similar</option>
                      ))}
                      {/* The rest of the roster, so a name with no close match
                          can still be mapped rather than only skipped. */}
                      {(analysis.all_users || [])
                        .filter(u => u.id !== p.matched_user_id && !p.candidates.some(c => c.id === u.id))
                        .map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                The scans spell some names differently from the roster. Anything left on &ldquo;Skip&rdquo; is
                not imported and can be mapped on a later run.
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-900 mb-1">Topics → courses ({mappedTopics}/{analysis.topics.length})</p>
              <div className="border border-gray-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-gray-100">
                {analysis.topics.map(t => (
                  <div key={t.topic} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="text-sm text-gray-800 w-44 shrink-0 truncate" title={t.topic}>{t.topic}</span>
                    <span className="text-[11px] text-gray-400 w-12 shrink-0">{t.count}×</span>
                    <select value={topics[norm(t.topic)] ?? ''} onChange={e => setTopics(m => ({ ...m, [norm(t.topic)]: e.target.value }))}
                      className={`flex-1 px-2 py-1 border rounded text-sm ${topics[norm(t.topic)] ? 'border-gray-300' : 'border-amber-300 bg-amber-50'}`}>
                      <option value="">Skip this topic</option>
                      {analysis.courses.map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ''}{c.title}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex items-center gap-2">
              <button onClick={commit} disabled={busy || willImport === 0}
                className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Importing…' : `Import ${willImport} test${willImport === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => setStep('pick')} className="px-3 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">Back</button>
              <span className="text-[11px] text-gray-500">Re-running this is safe — anything already on file is recognised, not doubled.</span>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-green-700">{result.created} training records created.</p>
            <ul className="text-xs text-gray-600 space-y-0.5">
              {result.already_in_readydoc > 0 && <li>{result.already_in_readydoc} were already in ReadyDoc.</li>}
              {result.repeated_in_file > 0 && <li>{result.repeated_in_file} were the same test scanned twice in the zip.</li>}
              {result.skipped_unmapped_person > 0 && <li>{result.skipped_unmapped_person} skipped — person left unmapped.</li>}
              {result.skipped_unmapped_course > 0 && <li>{result.skipped_unmapped_course} skipped — topic left unmapped.</li>}
              {result.unreadable > 0 && <li>{result.unreadable} filenames couldn&apos;t be read.</li>}
              <li>{result.evidence_stored} scans attached as evidence{result.evidence_failed ? `, ${result.evidence_failed} failed to store` : ''}.</li>
              {result.evidence_backfilled > 0 && <li>{result.evidence_backfilled} scans attached to records that already existed without their file.</li>}
            </ul>
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TrainingLogImportModal({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [step, setStep] = useState('file'); // file → map → preview → done
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [skipUnknown, setSkipUnknown] = useState(false);

  const send = async (endpoint, extra) => {
    const fd = new FormData();
    fd.append('file', file);
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return apiUpload(`/training/import-log/${endpoint}`, fd);
  };

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message || 'Something went wrong'); }
    finally { setBusy(false); }
  };

  const chooseFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setBusy(true); setError('');
    const fd = new FormData();
    fd.append('file', f);
    apiUpload('/training/import-log/analyze', fd)
      .then(a => {
        setAnalysis(a);
        // Start from the server's suggestions so the reviewer is correcting a
        // draft, not filling in thirty empty dropdowns.
        const m = {};
        for (const h of a.headings) m[h.heading] = h.admin ? 'ignore' : (h.suggested_course_id || '');
        setMapping(m);
        setStep('map');
      })
      .catch(e => setError(e.message || 'Could not read that spreadsheet'))
      .finally(() => setBusy(false));
  };

  const doPreview = () => run(async () => {
    setPreview(await send('preview', { mapping: JSON.stringify(mapping), skip_unknown_people: String(skipUnknown) }));
    setStep('preview');
  });

  const doCommit = () => run(async () => {
    setResult(await send('commit', { mapping: JSON.stringify(mapping), skip_unknown_people: String(skipUnknown) }));
    setStep('done');
    onDone();
  });

  const mappedCount = Object.values(mapping).filter(v => v && v !== 'ignore').length;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Import the Training Log</h3>
            <p className="text-xs text-gray-500 mt-0.5">The historical spreadsheet — one sheet per period, people down the side, trainings across the top.</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

          {step === 'file' && (
            <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:bg-gray-50">
              <Upload size={22} className="text-gray-400" />
              <span className="text-sm text-gray-600 font-medium">{busy ? 'Reading…' : 'Choose the Training Log (.xlsx)'}</span>
              <span className="text-xs text-gray-400">Nothing is saved until you approve the preview.</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={chooseFile} disabled={busy} />
            </label>
          )}

          {step === 'map' && analysis && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[['Sheets', analysis.sheets.length], ['Completions', analysis.total], ['People', analysis.people.length], ['Headings', analysis.headings.length]].map(([l, v]) => (
                  <div key={l} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                    <p className="text-lg font-bold text-gray-900">{v}</p>
                    <p className="text-[11px] text-gray-500">{l}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm text-gray-600">
                Match each column in the log to a course. Anything left blank is skipped — you can re-run this later once the
                course exists, and already-imported records are never duplicated.
              </p>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {analysis.headings.map(h => (
                  <div key={h.heading} className="flex items-center gap-3 p-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{h.heading}</p>
                      <p className="text-[11px] text-gray-500">{h.count} completion{h.count === 1 ? '' : 's'}</p>
                    </div>
                    <select value={mapping[h.heading] || ''} onChange={e => setMapping({ ...mapping, [h.heading]: e.target.value })}
                      className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-56 shrink-0">
                      <option value="">— skip —</option>
                      <option value="ignore">Not a training (ignore)</option>
                      {analysis.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={skipUnknown} onChange={e => setSkipUnknown(e.target.checked)} className="mt-0.5" />
                <span>
                  Skip people who aren't in Settings
                  <span className="block text-xs text-gray-500">
                    Off by default: a former employee's training is still real history. Leave it off to keep their records under the name as written.
                  </span>
                </span>
              </label>
            </>
          )}

          {step === 'preview' && preview && (
            <>
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-sm font-semibold text-green-900">{preview.will_create} record{preview.will_create === 1 ? '' : 's'} will be created</p>
                {preview.approximate_dates > 0 && (
                  <p className="text-xs text-green-800 mt-1">
                    {preview.approximate_dates} of them take the date from the sheet's period because the cell had none — they're
                    marked as approximate in the record's notes.
                  </p>
                )}
              </div>
              <div className="text-sm text-gray-700 space-y-1">
                <p className="font-medium">Skipped</p>
                {[
                  ['Columns marked "not a training"', preview.skipped.ignored],
                  ['Columns not matched to a course', preview.skipped.unmapped],
                  ['Already in ReadyDoc', preview.skipped.already_in_readydoc],
                  ['Same training twice in the file', preview.skipped.repeated_in_file],
                  ['No matching person', preview.skipped.no_person],
                  ['No date could be determined', preview.skipped.no_date],
                ].filter(([, n]) => n > 0).map(([l, n]) => (
                  <p key={l} className="text-xs text-gray-600 flex justify-between border-b border-gray-100 py-1"><span>{l}</span><span className="font-medium">{n}</span></p>
                ))}
              </div>
              {preview.undated_sheets?.length > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  These sheets have no readable period, so their undated cells were skipped rather than guessed:
                  <span className="font-medium"> {preview.undated_sheets.join(', ')}</span>. Fix the tab name and re-run to pick them up.
                </p>
              )}
              {preview.unmatched_people?.length > 0 && (
                <details className="text-xs text-gray-600">
                  <summary className="cursor-pointer font-medium text-gray-700">{preview.unmatched_people.length} people with no Settings account</summary>
                  <p className="mt-1.5 text-gray-500">{preview.unmatched_people.join(' · ')}</p>
                </details>
              )}
              {preview.sample?.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">First few records</p>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-xs">
                    {preview.sample.map((s, i) => (
                      <div key={i} className="flex justify-between gap-3 p-2">
                        <span className="font-medium text-gray-900 truncate">{s.employee_name}</span>
                        <span className="text-gray-600 truncate flex-1">{s.training_topic}</span>
                        <span className="text-gray-500 shrink-0">{s.training_date}{s.approximate ? ' ~' : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'done' && result && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">Imported {result.created} training record{result.created === 1 ? '' : 's'}.</p>
              <p className="text-xs text-green-800 mt-1">
                Re-running this import is safe — records already filed are recognised and skipped, so you can map more
                columns later and import again.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 p-5 pt-3 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            {step === 'map' && `${mappedCount} of ${analysis?.headings.length || 0} columns matched to a course`}
          </span>
          <div className="flex gap-2">
            {step === 'preview' && <button onClick={() => setStep('map')} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Back</button>}
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">{step === 'done' ? 'Close' : 'Cancel'}</button>
            {step === 'map' && <button onClick={doPreview} disabled={busy || !mappedCount} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{busy ? 'Checking…' : 'Preview'}</button>}
            {step === 'preview' && <button onClick={doCommit} disabled={busy || !preview.will_create} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{busy ? 'Importing…' : `Import ${preview.will_create}`}</button>}
          </div>
        </div>
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
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto">
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
              {/* Imported rows have no method; without a blank option the browser picks in_person and the edit fabricates one. */}
              <option value="">Not recorded</option>
              {['in_person', 'read_and_sign', 'online_test', 'external'].map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Score (%)</label>
            <input type="number" step="any" min="0" max="100" value={form.score || ''} onChange={e => set('score', e.target.value ? parseFloat(e.target.value) : '')}
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
/**
 * The whole Drive folder of group sign-in sheets, worked as a queue: pick all
 * ~50 files once, then one screen per sheet — the scan on the left, the header
 * prefilled from the filename on the right, tick the signers, file, next.
 * Reading handwriting stays a human act; AI can READ the printed names off the
 * sheet as suggestions (exact roster matches tick themselves, near-misses are
 * offered as chips), but nothing files until a person confirms. Each filed
 * sheet stores the scan once and references it from every attendee's record.
 */
function GroupSheetBulkModal({ courses, users, onClose, onDone }) {
  const [queue, setQueue] = useState(null); // null until files are picked
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const activeCourses = useMemo(() => (courses || []).filter(c => c.active), [courses]);

  const pick = async (files) => {
    if (!files?.length) return;
    const q = files.map(f => ({
      file: f, name: f.name, url: URL.createObjectURL(f), isImage: /^image\//.test(f.type),
      date: '', courseIds: [], trainer: '', sel: {}, status: 'pending', readResult: null,
    }));
    setQueue(q); setIdx(0); setError('');
    try {
      const res = await apiPost('/training/sheets/analyze', { filenames: files.map(f => f.name) });
      setQueue(cur => cur.map((item) => {
        const a = res.files.find(x => x.filename === item.name);
        return a ? { ...item, date: a.date || '', courseIds: a.suggested_course_ids || [] } : item;
      }));
    } catch { /* prefill is a convenience — the queue still works typed by hand */ }
  };

  const cur = queue?.[idx];
  const patch = (p) => setQueue(q => q.map((item, i) => (i === idx ? { ...item, ...p } : item)));
  const toggleUser = (u) => patch({ sel: { ...cur.sel, [u.id]: cur.sel[u.id] ? undefined : { name: u.name } } });
  const chosen = cur ? Object.entries(cur.sel).filter(([, v]) => v) : [];
  const advance = () => { setError(''); setSearch(''); setIdx(i => i + 1); };

  const readNames = async () => {
    setReading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', cur.file);
      const res = await apiUpload('/training/sheets/read-names', fd);
      const sel = { ...cur.sel };
      for (const n of res.names || []) if (n.user_id && !sel[n.user_id]) sel[n.user_id] = { name: n.user_name };
      patch({ readResult: res.names || [], sel });
    } catch (e) { setError(e.message); }
    finally { setReading(false); }
  };

  const fileSheet = async () => {
    if (!cur.courseIds.length) { setError('Pick at least one course.'); return; }
    if (!cur.date) { setError('The sheet needs its training date.'); return; }
    if (!chosen.length) { setError('Tick who signed the sheet.'); return; }
    setBusy(true); setError('');
    try {
      const ids = [];
      for (const courseId of cur.courseIds) {
        const res = await apiPost('/training/bulk-complete', {
          course_id: courseId, completion_date: cur.date, training_date: cur.date,
          trainer: cur.trainer, method: 'read_and_sign',
          attendees: chosen.map(([id, v]) => ({ employee_user_id: id, employee_name: v.name })),
        });
        ids.push(...(res.ids || []));
      }
      if (ids.length) {
        const fd = new FormData();
        fd.append('file', cur.file);
        fd.append('record_ids', JSON.stringify(ids));
        await apiUpload('/training/evidence/bulk', fd);
      }
      patch({ status: 'filed', created: ids.length });
      advance();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const filed = (queue || []).filter(s => s.status === 'filed');
  const list = useMemo(() => (users || []).filter(u => u.is_active !== 0 && (!search || u.name.toLowerCase().includes(search.toLowerCase()))), [users, search]);
  const courseName = (id) => { const c = activeCourses.find(x => x.id === id); return c ? `${c.code ? `${c.code} — ` : ''}${c.title}` : id; };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[94vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">File group sign-in sheets</h3>
            {queue && <p className="text-xs text-gray-500">{filed.length} of {queue.length} filed · {(queue || []).filter(s => s.status === 'skipped').length} skipped</p>}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        {!queue && (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-gray-600 max-w-lg mx-auto">
              Select every sheet at once — PDFs and photos both work. Each file becomes one screen:
              the date and course come off the filename, you tick who signed, and the scan attaches
              to every record it creates. Files that turn out not to be group sheets can be skipped.
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-powder-700">
              <Upload size={15} /> Choose files
              <input type="file" multiple accept=".pdf,image/*" className="hidden"
                onChange={e => pick(Array.from(e.target.files || []))} />
            </label>
          </div>
        )}

        {queue && !cur && (
          <div className="p-8 text-center space-y-3">
            <CheckCircle size={32} className="mx-auto text-green-600" />
            <p className="text-sm text-gray-700 font-medium">
              Done — {filed.length} sheet{filed.length === 1 ? '' : 's'} filed,
              {' '}{filed.reduce((n, s) => n + (s.created || 0), 0)} training records created with the paper attached.
            </p>
            {(queue.filter(s => s.status === 'skipped').length > 0) && (
              <p className="text-xs text-gray-500">Skipped: {queue.filter(s => s.status === 'skipped').map(s => s.name).join(' · ')}</p>
            )}
            <button onClick={() => { onDone(filed.reduce((n, s) => n + (s.created || 0), 0)); }}
              className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Close</button>
          </div>
        )}

        {cur && (
          <div className="flex-1 min-h-0 grid md:grid-cols-2 gap-0">
            {/* the scan — reading it is the job, so it gets half the screen */}
            <div className="bg-gray-100 min-h-[260px] md:min-h-0 overflow-hidden flex flex-col">
              <p className="px-3 py-1.5 text-[11px] text-gray-600 bg-gray-200/70 truncate shrink-0">{cur.name}</p>
              {cur.isImage
                ? <div className="flex-1 overflow-auto p-2"><img src={cur.url} alt={cur.name} className="max-w-full" /></div>
                : <iframe src={pdfViewerUrl(cur.url)} title={cur.name} className="flex-1 w-full bg-white" />}
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500">Sheet {idx + 1} of {queue.length}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Training date *</label>
                  <input type="date" value={cur.date} onChange={e => patch({ date: e.target.value })}
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Trainer</label>
                  <input value={cur.trainer} onChange={e => patch({ trainer: e.target.value })}
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Course(s) * <span className="font-normal text-gray-400">— a sheet naming several SOPs files one record per course per signer</span></label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {cur.courseIds.map(id => (
                    <span key={id} className="inline-flex items-center gap-1 bg-powder-50 text-powder-800 border border-powder-200 rounded-full px-2.5 py-1 text-xs">
                      {courseName(id)}
                      <button type="button" onClick={() => patch({ courseIds: cur.courseIds.filter(x => x !== id) })} className="text-powder-400 hover:text-red-500"><X size={11} /></button>
                    </span>
                  ))}
                  {cur.courseIds.length === 0 && <span className="text-xs text-gray-400">None picked yet.</span>}
                </div>
                <select value="" onChange={e => { if (e.target.value && !cur.courseIds.includes(e.target.value)) patch({ courseIds: [...cur.courseIds, e.target.value] }); }}
                  className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="">+ Add a course…</option>
                  {activeCourses.map(c => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ''}{c.title}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <label className="text-xs font-medium text-gray-700">Signed ({chosen.length})</label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={readNames} disabled={reading}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-[11px] font-medium hover:bg-purple-100 disabled:opacity-50">
                      <Sparkles size={11} /> {reading ? 'Reading…' : 'Read names from the sheet'}
                    </button>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                      className="px-2 py-1 border border-gray-300 rounded-lg text-xs w-28" />
                  </div>
                </div>
                {cur.readResult && (
                  <div className="text-[11px] text-gray-600 bg-purple-50/60 border border-purple-100 rounded-lg px-2 py-1.5 mb-1.5 space-y-0.5">
                    {cur.readResult.length === 0 && 'No names could be read — tick them by hand.'}
                    {cur.readResult.map((n, i) => (
                      <div key={i}>
                        “{n.read}” {n.user_id
                          ? <span className="text-green-700">→ {n.user_name} ✓</span>
                          : (n.candidates?.length
                            ? <>→ {n.candidates.map(c => (
                              <button key={c.id} type="button" onClick={() => patch({ sel: { ...cur.sel, [c.id]: { name: c.name } } })}
                                className={`underline mr-1.5 ${cur.sel[c.id] ? 'text-green-700 no-underline' : 'text-powder-700'}`}>{c.name}{cur.sel[c.id] ? ' ✓' : '?'}</button>
                            ))}</>
                            : <span className="text-gray-400">— no roster match</span>)}
                      </div>
                    ))}
                  </div>
                )}
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
                  {list.map(u => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={!!cur.sel[u.id]} onChange={() => toggleUser(u)} />
                      <span className="flex-1 text-sm text-gray-800">{u.name} <span className="text-[11px] text-gray-400 capitalize">{(u.department || '').replace(/_/g, ' ')}</span></span>
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={fileSheet} disabled={busy}
                  className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
                  {busy ? 'Filing…' : `File sheet & next`}
                </button>
                <button type="button" onClick={() => { patch({ status: 'skipped' }); advance(); }} disabled={busy}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                  Skip — not a group sheet
                </button>
                {idx > 0 && (
                  <button type="button" onClick={() => setIdx(i => i - 1)} disabled={busy}
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50">Back</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupTrainingModal({ courses, users, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState(today);
  const [trainer, setTrainer] = useState('');
  const [method, setMethod] = useState('in_person');
  const [sel, setSel] = useState({}); // userId -> { checked, name, score }
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState(null); // the signed sign-in sheet (Form 409-02)
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
      // One sheet, everyone's record: the scan is stored once and referenced
      // by every completion this just created. Best-effort — the completions
      // are already filed, and a storage failure must not look like they
      // weren't; the sheet can be re-attached from the Edit modal.
      let attached = false;
      if (sheet && res.ids?.length) {
        try {
          const fd = new FormData();
          fd.append('file', sheet);
          fd.append('record_ids', JSON.stringify(res.ids));
          await apiUpload('/training/evidence/bulk', fd);
          attached = true;
        } catch (e) { alert(`The completions are saved, but the sheet did not attach: ${e.message}`); }
      }
      onSaved(res.created, attached);
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
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Signed sign-in sheet (photo or PDF)</label>
              <input type="file" accept=".pdf,image/*" onChange={e => setSheet(e.target.files?.[0] || null)}
                className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:border-0 file:rounded-lg file:bg-powder-50 file:text-powder-700 file:text-xs file:font-medium" />
              <p className="text-[11px] text-gray-400 mt-0.5">One sheet, everyone&apos;s record — it attaches as the evidence on every attendee selected below.</p>
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
                    <input type="number" step="any" min="0" max="100" value={sel[u.id].score} onChange={e => setScore(u.id, e.target.value)} placeholder="score" className="w-16 px-2 py-1 border border-gray-300 rounded text-xs" />
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

// ── Course material (videos / handouts) ──────────────────────────────────────
// Lives on the course, so everyone taking it sees the same thing. Videos play
// in place — a QA issue is far easier to show than to write up. Only available
// once a course exists (a material needs a course to hang off), and only when
// object storage is configured, matching how attachments behave in Messages.
function CourseMaterials({ courseId }) {
  const { data: materials, refresh } = useApiGet(courseId ? `/training/courses/${courseId}/materials` : null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const upload = async (files) => {
    if (!files.length) return;
    setUploading(true); setProgress(0); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      await apiUpload(`/training/courses/${courseId}/materials`, fd, 'POST', setProgress);
      refresh();
    } catch (e) { setError(e.message || 'Upload failed'); }
    finally { setUploading(false); setProgress(0); }
  };

  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.filename} from this course?`)) return;
    await apiDelete(`/training/materials/${m.id}`);
    refresh();
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">Training material</label>
      <div className="space-y-2">
        {(materials || []).map(m => (
          <div key={m.id} className="rounded-lg border border-gray-200 p-2">
            {m.is_video && m.url ? (
              <video src={m.url} controls playsInline preload="metadata" className="w-full max-h-56 rounded bg-black" />
            ) : null}
            <div className="flex items-center gap-2 mt-1">
              {m.is_video ? <Video size={14} className="text-powder-600 shrink-0" /> : <FileText size={14} className="text-powder-600 shrink-0" />}
              <a href={m.url || undefined} target="_blank" rel="noreferrer" className="text-sm text-gray-800 truncate hover:underline flex-1">{m.filename}</a>
              <span className="text-[10px] text-gray-400 shrink-0">{fmtBytes(m.size)}</span>
              <button type="button" onClick={() => remove(m)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {uploading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 size={13} className="animate-spin" />
            {progress >= 100 ? 'Processing…' : `Uploading ${progress}%`}
            {progress < 100 && (
              <span className="flex-1 h-1 rounded-full bg-gray-200 overflow-hidden">
                <span className="block h-full bg-powder-500 transition-[width] duration-150" style={{ width: `${progress}%` }} />
              </span>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-powder-700 bg-powder-50 rounded-lg hover:bg-powder-100">
            <Upload size={13} /> Add video or handout
          </button>
        )}
        <input ref={inputRef} type="file" multiple className="hidden"
          onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; upload(files); }} />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-[11px] text-gray-400">Video up to 200 MB, other files up to 25 MB.</p>
      </div>
    </div>
  );
}

// ── Course modal ──────────────────────────────────────────────────────────────
function CourseModal({ initial, onClose, onSaved }) {
  const { data: allDocs } = useApiGet('/documents');
  const { data: equipment } = useApiGet('/equipment');
  const docs = useMemo(() => (allDocs || []).filter(d => d.doc_type === 'sop' || d.doc_type === 'work_instruction'), [allDocs]);
  const [form, setForm] = useState(initial || {
    code: '', title: '', category: 'GMP', description: '', retrain_months: 12,
    required_roles: [], required_departments: [], passing_score: 80, active: true,
    sop_id: '', equipment_id: '', retrain_on_doc_change: true,
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
            <input type="number" step="any" min="0" max="100" value={form.passing_score} onChange={e => set('passing_score', parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
        <div>
          {/* A course can be ABOUT a machine — WI021 is literally "Hexagon
              Tumbler Mixer Operation". Naming it here is what lets the
              equipment setup checklist answer "is anyone trained to run this". */}
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment this course covers</label>
          <select value={form.equipment_id || ''} onChange={e => set('equipment_id', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">— Not about one machine —</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name}{eq.asset_id ? ` (#${eq.asset_id})` : ''}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} /> Active</label>
        {initial?.id
          ? <CourseMaterials courseId={initial.id} />
          : <p className="text-[11px] text-gray-400">Save the course first, then reopen it to attach a training video or handout.</p>}
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
        placeholder={es ? 'Traducción al español…' : 'Question prompt…'} spellCheck="true" lang={es ? 'es' : 'en'}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />

      {q.type === 'multiple_choice' && (
        <div className="space-y-1.5">
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${q._k}`} checked={String(q.correct_answer) === String(i)} onChange={() => set({ correct_answer: String(i) })} disabled={es} title="Mark correct" />
              <input value={es ? (q.options_es?.[i] || '') : o} onChange={e => setOption(i, e.target.value)} placeholder={es ? `Opción ${i + 1}` : `Option ${i + 1}`} spellCheck="true" lang={es ? 'es' : 'en'} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white" />
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
        questions: clean.map(({ _k, ...q }) => q),  
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
              <input type="number" step="any" min="0" max="100" value={passing} onChange={e => setPassing(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
  // The record list is bounded to the newest 500, so the search term goes to
  // the SERVER — sifting only the fetched page made a two-year-old record
  // unfindable from the very tab that exists to prove it is on file.
  const [recQ, setRecQ] = useState('');
  const { data: records, refresh: refreshRecords } = useApiGet(`/training${recQ ? `?q=${encodeURIComponent(recQ)}` : ''}`, [recQ]);
  const { data: users } = useApiGet('/users');
  const { data: aiStatus } = useApiGet('/ai/status');
  const aiOn = !!aiStatus?.enabled;
  const TABS = useMemo(() => [
    { id: 'matrix', label: 'Compliance Matrix' },
    { id: 'due', label: 'Retraining Due' },
    { id: 'courses', label: 'Courses' },
    { id: 'records', label: 'Records' },
  ], []);

  // useModuleTabs, not plain useState: this module had neither ?view=
  // deep-linking nor the remembered-last-tab every other module has, so a link
  // to the Records tab always landed on the matrix.
  const { tabs: trainingTabs, tab: view, setTab: setView } = useModuleTabs({ id: 'training', tabs: TABS });
  // One definition each, rendered by the table row AND the phone card, so the
  // two layouts cannot disagree about a record's state or where its paper is.
  const duePill = (d) => d.overdue
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><AlertTriangle size={12} /> Overdue</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full"><Clock size={12} /> Due soon</span>;
  const evidenceLink = (r) => r.evidence_key
    ? <button type="button" onClick={() => openEvidence(r)} className="text-powder-600 hover:underline inline-flex items-center gap-1 text-xs"><Paperclip size={12} /> View scan</button>
    : r.document_url
      ? <a href={r.document_url} target="_blank" rel="noreferrer" className="text-powder-600 hover:underline inline-flex items-center gap-1 text-xs"><ExternalLink size={12} /> View</a>
      : r.gdrive_url
        ? <a href={r.gdrive_url} target="_blank" rel="noreferrer" className="text-powder-600 hover:underline inline-flex items-center gap-1 text-xs"><ExternalLink size={12} /> Drive</a>
        : null;
  const [importing, setImporting] = useState(false);
  const [importingLog, setImportingLog] = useState(false);
  const [importingScans, setImportingScans] = useState(false);
  const [completion, setCompletion] = useState(null); // {} = new
  const [preview, setPreview] = useState(null); // { url, name } — the stored scan behind a record
  const [bulkSheets, setBulkSheets] = useState(false);
  const openEvidence = async (r) => {
    try {
      const { url, filename } = await apiFetch(`/training/${r.id}/evidence`);
      setPreview({ url, name: filename });
    } catch (e) { alert(e.message); }
  };
  const [groupTraining, setGroupTraining] = useState(false);
  const [course, setCourse] = useState(null);
  const [testCourse, setTestCourse] = useState(null);
  const [search, setSearch] = useState('');
  const [flash, setFlash] = useState('');

  // Debounced — a keystroke should not be a query, but the settled term must
  // reach the server (see the note on the records fetch above).
  useEffect(() => {
    const t = setTimeout(() => setRecQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const refreshAll = () => { refreshMatrix(); refreshCourses(); refreshRecords(); };
  const counts = matrix?.counts || { missing: 0, overdue: 0, due_soon: 0, current: 0 };

  const filteredRecords = useMemo(() => {
    const s = search.toLowerCase().trim();
    return (records || []).filter(r => !s || r.employee_name?.toLowerCase().includes(s) || (r.course_title || r.training_topic || '').toLowerCase().includes(s));
  }, [records, search]);

  // Most-recent completions first — this is the tab somebody opens to check
  // that what they just imported actually landed.
  const recSort = useTableSort(filteredRecords, TRAINING_RECORD_COLUMNS, 'completion_date', 'desc');

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
            {user?.role === 'admin' && (
              <button onClick={() => setImportingLog(true)} title="Import the historical Training Log spreadsheet"
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><FileText size={15} /> Training Log</button>
            )}
            {user?.role === 'admin' && (
              <button onClick={() => setImportingScans(true)} title="Import a zip of scanned tests from Drive"
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Upload size={15} /> Scanned Tests</button>
            )}
            <button onClick={() => setCourse({})} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Plus size={15} /> Course</button>
            <button onClick={() => setGroupTraining(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Users size={15} /> Group Training</button>
            <button onClick={() => setBulkSheets(true)} title="Work a folder of signed group sheets as a queue"
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Paperclip size={15} /> Group Sheets</button>
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

      <ModuleTabs tabs={trainingTabs} value={view} onChange={setView} />

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
            <>
            <RecordCards className="p-2">
              {(due || []).map(d => (
                <RecordCard key={d.id} title={d.employee_name}
                  subtitle={`${d.course_code ? `${d.course_code} — ` : ''}${d.course_title}`}
                  badge={duePill(d)}
                  fields={[{ label: 'Due', value: d.next_due_date }]} />
              ))}
            </RecordCards>
            <table className="hidden md:table w-full text-sm">
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
                    <td className="px-4 py-2">{duePill(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
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
          <RecordCards count={recSort.sorted.length} empty="No training records yet.">
            {recSort.sorted.map(r => (
              <RecordCard key={r.id} title={r.employee_name} subtitle={r.course_title || r.training_topic || '—'}
                fields={[
                  { label: 'Completed', value: r.completion_date },
                  { label: 'Score', value: r.score != null ? `${r.score}%` : null },
                ]}
                actions={(evidenceLink(r) || canEdit) ? <>
                  {evidenceLink(r)}
                  {canEdit && <button onClick={() => setCompletion(r)} className="text-xs text-gray-500 hover:text-powder-600 inline-flex items-center gap-1"><Edit2 size={12} /> Edit</button>}
                </> : null} />
            ))}
          </RecordCards>
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b"><tr>
                {TRAINING_RECORD_COLUMNS.map((c, i) => (
                  <SortHeader key={c.key || `x${i}`} col={c} sortCol={recSort.sortCol}
                    sortDir={recSort.sortDir} onSort={recSort.toggleSort} className="px-4 py-2" />
                ))}
              </tr></thead>
              <tbody>
                {recSort.sorted.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 font-medium text-gray-800">{r.employee_name}</td>
                    <td className="px-4 py-2 text-gray-600">{r.course_title || r.training_topic || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.completion_date || '—'}</td>
                    <td className="px-4 py-2 text-gray-600">{r.score != null ? `${r.score}%` : '—'}</td>
                    <td className="px-4 py-2">
                      {/* Imported scans live in storage under evidence_key — a
                          different field from the hand-attached document_url,
                          and the reason this column used to read "—" on rows
                          whose paper was stored all along. */}
                      {evidenceLink(r) || <span className="text-gray-300 text-xs">—</span>}
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
      {importingLog && <TrainingLogImportModal onClose={() => setImportingLog(false)} onDone={refreshAll} />}
      {importingScans && <ScannedTestsImportModal onClose={() => setImportingScans(false)} onDone={refreshAll} />}
      {completion && <CompletionModal initial={completion.id ? completion : null} courses={courses} users={users} onClose={() => setCompletion(null)} onSaved={() => { setCompletion(null); refreshAll(); }} />}
      {course && <CourseModal initial={course.id ? course : null} onClose={() => setCourse(null)} onSaved={() => { setCourse(null); refreshCourses(); refreshMatrix(); }} />}
      {testCourse && <TestEditor course={testCourse} aiEnabled={aiOn} onClose={() => setTestCourse(null)} onSaved={() => { setTestCourse(null); refreshCourses(); }} />}
      {groupTraining && <GroupTrainingModal courses={courses} users={users} onClose={() => setGroupTraining(false)} onSaved={(n, sheet) => { setGroupTraining(false); refreshAll(); setFlash(`Recorded ${n} completion${n === 1 ? '' : 's'}${sheet ? ' with the sign-in sheet attached' : ''}.`); setTimeout(() => setFlash(''), 5000); }} />}
      {preview && <FilePreview items={[preview]} index={0} onClose={() => setPreview(null)} />}
      {bulkSheets && <GroupSheetBulkModal courses={courses} users={users} onClose={() => setBulkSheets(false)}
        onDone={(n) => { setBulkSheets(false); refreshAll(); setFlash(`Filed ${n} training record${n === 1 ? '' : 's'} from the sign-in sheets.`); setTimeout(() => setFlash(''), 6000); }} />}
      {flash && <div className="fixed bottom-4 right-4 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">{flash}</div>}
    </div>
  );
}
