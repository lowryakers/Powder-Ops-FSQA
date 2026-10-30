import { useState } from 'react';
import { useApiGet, apiFetch, apiPost } from '../../hooks/useApi';
import CopyButton from '../common/CopyButton';
import { formatDateTime } from '../../lib/datetime';

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


// The database itself, off the server, every day (D-290): the copy that can
// bring the application back. Its health, a run on demand, and the quarterly
// restore test that proves the copy actually opens.
function DatabaseBackups() {
  const { data, refresh } = useApiGet('/compliance/db-backups');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const act = async (kind) => {
    setBusy(kind); setMsg(null);
    try {
      const r = await apiPost(kind === 'run' ? '/compliance/db-backups/run' : '/compliance/db-backups/restore-test', {});
      setMsg({ ok: true, text: kind === 'run' ? `Backup stored: ${r.key}` : `Restore test passed: ${r.tables} tables, ${r.rows?.toLocaleString()} rows, integrity ${r.integrity}.` });
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(''); refresh(); }
  };
  if (!data) return null;
  const last = data.last; const rt = data.restore_test;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-db-backups>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900">Daily database backup</h3>
          <p className="text-sm text-gray-500 max-w-xl">
            The database itself is copied off the server every night after 1 AM. {data.rules.daily} daily and {data.rules.monthly} monthly
            copies are kept. Restore one into a scratch copy at least once a quarter to prove it opens.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => act('run')} disabled={!!busy} data-db-backup-run
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">{busy === 'run' ? 'Backing up…' : 'Back up now'}</button>
          <button type="button" onClick={() => act('restore')} disabled={!!busy} data-restore-test-run
            className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">{busy === 'restore' ? 'Restoring…' : 'Run restore test'}</button>
        </div>
      </div>
      {!data.storage_on && <p className="text-sm text-red-700" data-db-backup-nostorage>Off-server storage (R2) is not configured, so no backup can leave the server.</p>}
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div data-db-backup-last className={data.stale ? 'text-red-700' : 'text-gray-700'}>
          <dt className="text-xs text-gray-500">Last good backup</dt>
          <dd>{data.last_ok ? `${formatDateTime(data.last_ok.at)} · ${Math.round((data.last_ok.size || 0) / 1048576 * 10) / 10} MB` : 'None yet'}</dd>
          {last && !last.ok && <dd className="text-xs text-red-700">Last attempt failed: {last.error}</dd>}
        </div>
        <div>
          <dt className="text-xs text-gray-500">Copies kept</dt>
          <dd data-db-backup-kept>{data.daily} daily · {data.monthly} monthly</dd>
        </div>
        <div data-restore-test-last className={data.restore_due ? 'text-amber-700' : 'text-gray-700'}>
          <dt className="text-xs text-gray-500">Last restore test</dt>
          <dd>{rt ? `${formatDateTime(rt.at)} · ${rt.ok ? 'passed' : 'FAILED'} · ${rt.by}` : 'Never run'}</dd>
          {rt && !rt.ok && rt.error && <dd className="text-xs text-red-700">{rt.error}</dd>}
          {data.restore_due && <dd className="text-xs">Due — once a quarter.</dd>}
        </div>
      </dl>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`} data-db-backup-msg>{msg.text}</p>}
      {data.list.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-600">Stored copies ({data.list.length})</summary>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {data.list.map(b => (
              <a key={b.key} href={b.url || undefined} data-new-tab className="px-2 py-1 rounded border border-gray-200 text-powder-700">
                {b.kind === 'monthly' ? 'Month ' : ''}{b.period}
              </a>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// A read-only report run on the live database on demand (D-216, D-217). Nothing runs until asked, and
// nothing is written; the text is for reading here and for pasting to whoever asked.
function ReadOnlyReport({ id, path, title, blurb, summary, action = null }) {
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
          {action && action(report, run)}
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

function auditorDupSummary(r) {
  if (!r.ran) return 'The pass has not run on this database yet.';
  const others = r.flagged.length;
  return <>{red(others > 1, `${plural(others, 'account')} marked not a trainee`)} on {String(r.ran_at).slice(0, 10)}
    {r.flagged.length ? ` (${r.flagged.map(f => f.name).join(', ')})` : ''} · the rule would match {r.would_match_now.length} now</>;
}

function sharedSummary(r) {
  return r.flagged_accounts ? red(true, r.verdict) : r.verdict;
}

function sameNameSummary(r) {
  const n = r.groups.length;
  return n ? red(true, `${plural(n, 'name')} with more than one account: ${r.groups.map(g => g.accounts[0]?.name).join(', ')}`) : 'Every account has its own name.';
}

/**
 * Put the edit bug's fails back (D-271). Only the records the report lists as
 * the bug's own; the low-score ones to check are never restored from here. The
 * server re-checks every id against the finder, and a reason is required.
 */
function EditFailRestore({ report, rerun }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const n = report.likely?.length || 0;
  if (result) {
    return (
      <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-2" data-edit-fails-restored>
        Restored {plural(result.restored.length, 'record')}{result.skipped.length ? ` · ${result.skipped.length} skipped (no longer on the list)` : ''}. Each one is completed again and the person reads as trained.
      </p>
    );
  }
  if (!n) return null;
  const go = async () => {
    if (!window.confirm(`Restore ${plural(n, 'training record')} to completed? Each one keeps its date trained, and the restore is logged with your reason.`)) return;
    setBusy(true); setError('');
    try { setResult(await apiPost('/compliance/edit-failed-training/restore', { ids: report.likely.map(x => x.id), reason })); rerun(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2" data-edit-fails-restore>
      <p className="text-sm text-amber-900">
        Put the {plural(n, 'record')} the edit bug failed back to completed. The ones with a low score, listed to check, are left alone — open those and decide.
      </p>
      <div className="flex gap-2 flex-wrap">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (goes on every record)" data-edit-fails-reason
          className="flex-1 min-w-[14rem] px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
        <button type="button" onClick={go} disabled={busy || reason.trim().length < 3} data-edit-fails-restore-go
          className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap">
          {busy ? 'Restoring…' : `Restore ${plural(n, 'record')}`}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function editFailSummary(r) {
  const n = r.likely.length;
  return <>{red(n, n ? `${plural(n, 'training record')} turned into a fail by the edit bug` : 'No record was turned into a fail by an edit')}
    {r.check.length ? ` · ${plural(r.check.length, 'more')} to check (score below the pass mark)` : ''}</>;
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
    <DatabaseBackups />
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
    <ReadOnlyReport id="auditor-dups" path="/compliance/auditor-duplicates" title="Unused auditor accounts marked not a trainee" summary={auditorDupSummary}
      blurb="An auditor account with the same name as a staff member, never signed in, is left out of training (D-273). This lists every account that rule matched here, each change it logged, and what it would match now." />
    <ReadOnlyReport id="shared-accounts" path="/compliance/shared-accounts" title="Shared sign-ins" summary={sharedSummary}
      blurb="Your password is your signature, so it must be yours alone. This lists accounts signed in on several devices at once, or from many devices in 30 days, for you to ask about. It blocks nothing." />
    <ReadOnlyReport id="same-name" path="/compliance/same-name-accounts" title="Accounts that share a name" summary={sameNameSummary}
      blurb="People with more than one account under the same name, side by side: which one signs in, how each was created, and what is filed against each. Nothing is merged." />
    <ReadOnlyReport id="edit-fails" path="/compliance/edit-failed-training" title="Training records an edit turned into a fail" summary={editFailSummary}
      action={(report, rerun) => <EditFailRestore report={report} rerun={rerun} />}
      blurb="From 7 to 29 October, saving a training record through Edit could mark it failed, so the person read as not trained. This lists those records, and edited fails with a low score to check. Restore puts the listed ones back." />
    </div>
  );
}
