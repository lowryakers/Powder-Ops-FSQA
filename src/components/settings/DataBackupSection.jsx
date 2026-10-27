import { useState } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import CopyButton from '../common/CopyButton';

// Full data export, plus the automatic Friday copies. Moved out of the Settings
// mega-render unchanged when Settings became a section list.

function BackupDownloadButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/compliance/export-all', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `readydoc-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="text-right">
      <button onClick={download} disabled={busy}
        className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50 whitespace-nowrap">
        {busy ? 'Preparing…' : 'Download backup (ZIP)'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

// Weekly automatic backups stored in R2 by the Friday job.
function AutoBackupList() {
  const { data } = useApiGet('/compliance/backups');
  const backups = data?.backups || [];
  if (!backups.length) {
    return <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-2.5">Automatic Friday backups appear here once the first one runs (requires R2 file storage, already used for chat uploads).</p>;
  }
  return (
    <div className="border-t border-gray-100 pt-2.5">
      <p className="text-xs font-medium text-gray-700 mb-1.5">Automatic weekly backups (Fridays, last {backups.length} kept)</p>
      <div className="flex flex-wrap gap-1.5">
        {backups.map(b => (
          <a key={b.key} href={b.url || undefined} className={`px-2.5 py-1 rounded-lg border text-xs ${b.url ? 'border-gray-200 text-powder-700 hover:bg-powder-50' : 'border-gray-100 text-gray-400'}`}>
            {b.name.replace('readydoc-backup-', '').replace('.zip', '')} · {Math.round((b.size || 0) / 1024)} KB
          </a>
        ))}
      </div>
    </div>
  );
}


// A read-only report run on the live database on demand (D-216, D-217). Nothing runs until asked, and
// nothing is written; the text is for reading here and for pasting to whoever asked.
function ReadOnlyReport({ id, path, title, blurb, summary }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try { setReport(await apiFetch(path)); }
    catch (e) { setError(e.message || 'The report did not run'); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" {...{ [`data-${id}`]: true }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500 max-w-xl">{blurb} Read-only: running it changes nothing.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={run} disabled={busy} {...{ [`data-${id}-run`]: true }}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50 whitespace-nowrap">
            {busy ? 'Counting…' : report ? 'Run again' : 'Run the report'}
          </button>
          {report && <CopyButton getText={report.text} label="Copy report" />}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {report && (
        <>
          <p className="text-sm text-gray-700" {...{ [`data-${id}-summary`]: true }}>{summary(report)}</p>
          <pre className="text-[11px] leading-snug bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-x-auto max-h-[28rem] whitespace-pre" {...{ [`data-${id}-text`]: true }}>{report.text}</pre>
        </>
      )}
    </div>
  );
}

const red = (on, text) => <span className={on ? 'text-red-700 font-medium' : ''}>{text}</span>;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function usageSummary(r) {
  const fake = r.fake?.work_orders || 0;
  const pins = r.pin_accounts?.length || 0;
  const count = (...v) => r.modules.filter(m => v.includes(m.verdict)).length;
  return <>
    {count('in use')} in use · {count('light', 'dormant')} light or dormant · {count('never used', 'machine only')} not used by a person ·{' '}
    {red(fake, fake ? `${plural(fake, 'invented maintenance record')} found` : 'no invented maintenance history')} ·{' '}
    {red(pins, pins ? `${plural(pins, 'account')} still on a PIN` : 'no PIN-only accounts')}
  </>;
}

function routingSummary(r) {
  if (!r.findings) return 'No task tables.';
  const n = r.findings.reduce((s, f) => s + f.rows.length, 0);
  const noDept = r.people.filter(p => /^NO DEPARTMENT|is not a team/.test(p.note)).length;
  return <>
    {r.active_schedules} active schedules · {red(n, n ? `${plural(n, 'item')} to look at in ${plural(r.findings.length, 'group')}` : 'nothing routed oddly')} ·{' '}
    {red(noDept, noDept ? `${plural(noDept, 'person', 'people')} whose department routes wrong` : 'every department routes')}
  </>;
}

export default function DataBackupSection() {
  return (
    <div className="space-y-4">
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900">Full data export</h3>
          <p className="text-sm text-gray-500 max-w-xl">
            Every form, log, and check as a ZIP of spreadsheets (CSV) — includes all comms channels and
            messages. Excludes passwords and notification internals. A copy is also saved automatically
            every Friday (below).
          </p>
        </div>
        <BackupDownloadButton />
      </div>
      <AutoBackupList />
    </div>
    <ReadOnlyReport id="module-usage" path="/compliance/module-usage" title="Module usage" summary={usageSummary}
      blurb="Which parts of ReadyDoc people actually use, counted from the audit trail since go-live. It also checks for invented maintenance history from the demo build and for accounts that still sign in with a PIN." />
    <ReadOnlyReport id="task-routing" path="/compliance/task-routing" title="Who sees which tasks" summary={routingSummary}
      blurb="What lands on each team's task list, and every schedule or card that is probably on the wrong one — machine PMs on QA, old room checklists, cards left behind — with where each is changed. Also each person's card count." />
    </div>
  );
}
