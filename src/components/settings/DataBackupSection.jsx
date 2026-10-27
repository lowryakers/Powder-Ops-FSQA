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


// Which modules people use (D-216). The same read-only report as `npm run report:usage`, run on the
// live database on demand. It writes nothing; the text is for reading and for pasting to whoever asked.
function ModuleUsage() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true); setError('');
    try { setReport(await apiFetch('/compliance/module-usage')); }
    catch (e) { setError(e.message || 'The report did not run'); }
    finally { setBusy(false); }
  };
  const fakeCount = report?.fake?.work_orders || 0;
  const pins = report?.pin_accounts?.length || 0;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-module-usage>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-900">Module usage</h3>
          <p className="text-sm text-gray-500 max-w-xl">
            Which parts of ReadyDoc people actually use, counted from the audit trail since go-live. It also checks
            for invented maintenance history from the demo build and for accounts that still sign in with a PIN.
            Read-only: running it changes nothing.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={run} disabled={busy} data-module-usage-run
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50 whitespace-nowrap">
            {busy ? 'Counting…' : report ? 'Run again' : 'Run the report'}
          </button>
          {report && <CopyButton getText={report.text} label="Copy report" />}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {report && (
        <>
          <p className="text-sm text-gray-700" data-module-usage-summary>
            {report.modules.filter(m => m.verdict === 'in use').length} in use ·{' '}
            {report.modules.filter(m => m.verdict === 'light' || m.verdict === 'dormant').length} light or dormant ·{' '}
            {report.modules.filter(m => m.verdict === 'never used' || m.verdict === 'machine only').length} not used by a person ·{' '}
            <span className={fakeCount ? 'text-red-700 font-medium' : ''}>{fakeCount ? `${fakeCount} invented maintenance record${fakeCount === 1 ? "" : "s"} found` : 'no invented maintenance history'}</span> ·{' '}
            <span className={pins ? 'text-red-700 font-medium' : ''}>{pins ? `${pins} account${pins === 1 ? '' : 's'} still on a PIN` : 'no PIN-only accounts'}</span>
          </p>
          <pre className="text-[11px] leading-snug bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-x-auto max-h-[28rem] whitespace-pre" data-module-usage-text>{report.text}</pre>
        </>
      )}
    </div>
  );
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
    <ModuleUsage />
    </div>
  );
}
