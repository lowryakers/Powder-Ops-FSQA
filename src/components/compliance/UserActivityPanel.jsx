import { useState, Fragment } from 'react';
import { Activity, Download } from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';
import { useRowExpand } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow } from '../common/RowDetail';
import { formatDateTime } from '../../lib/datetime.js';
import { downloadFile } from '../../lib/downloadFile';
import FrozenScroll from '../common/FrozenScroll';

// Who was active in ReadyDoc, and when (D-261). Admins only. Each row is one act:
// a sign-in or sign-out, a timeout, a page or record opened, a change (with what
// changed), a file opened or downloaded. Times are stored in UTC and shown in this
// browser's time; the CSV keeps UTC.

const TONE = {
  login: 'bg-green-100 text-green-800',
  logout: 'bg-gray-100 text-gray-700',
  session_timeout: 'bg-amber-100 text-amber-800',
  session_revoked: 'bg-amber-100 text-amber-800',
  page_view: 'bg-sky-50 text-sky-800',
  record_view: 'bg-sky-100 text-sky-800',
  edit: 'bg-purple-100 text-purple-800',
  download: 'bg-teal-100 text-teal-800',
  file_open: 'bg-teal-50 text-teal-800',
};
const PAGE = 200;
const show = (v) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Changes({ details }) {
  if (!details) return <p className="text-xs text-gray-500">No details.</p>;
  const rows = details.changes || details.sent || [];
  return (
    <div className="space-y-2 text-xs">
      {details.audit_action && <div><span className="text-gray-500">Recorded as:</span> {details.audit_action}</div>}
      {details.method && <div><span className="text-gray-500">Request:</span> {details.method} · {details.status}</div>}
      {details.view && <div><span className="text-gray-500">Tab:</span> {details.view}</div>}
      {details.file && <div><span className="text-gray-500">File:</span> {details.file}</div>}
      {details.files && <div><span className="text-gray-500">Files:</span> {details.files.join(', ')}</div>}
      {details.signed_in_at && <div><span className="text-gray-500">Signed in:</span> {formatDateTime(details.signed_in_at)}</div>}
      {rows.length > 0 && (
        <div data-activity-changes>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
            {details.changes ? 'What changed' : 'Fields sent'}
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <tbody>
                {rows.map((c, i) => (
                  <tr key={`${c.field}-${i}`} className="align-top">
                    <td className="pr-3 py-0.5 font-medium text-gray-700 whitespace-nowrap">{c.field}</td>
                    {'from' in c && <td className="pr-2 py-0.5 text-red-700 line-through break-all max-w-[280px]">{show(c.from)}</td>}
                    {'from' in c && <td className="pr-2 py-0.5 text-gray-400">→</td>}
                    <td className="py-0.5 text-green-700 break-all max-w-[280px]">{'to' in c ? show(c.to) : (c.note || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {details.before && <div className="text-gray-500">Previous value: {details.before}</div>}
    </div>
  );
}

function where(r) {
  if (r.record_label) return `${r.record_label}${r.record_type ? ` (${r.record_type})` : ''}`;
  if (r.record_id) return `${r.record_type || 'record'} ${r.record_id}`;
  return r.page || '—';
}

export default function UserActivityPanel() {
  const [f, setF] = useState({ user_id: '', from: '', to: '', action: '' });
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const expand = useRowExpand();
  const { data: people } = useApiGet('/user-activity/people');
  const { data: actions } = useApiGet('/user-activity/actions');
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, loading } = useApiGet(`/user-activity?${qs}${qs ? '&' : ''}limit=${PAGE}&offset=${offset}`, [qs, offset]);
  const set = (k) => (e) => { setOffset(0); setF(prev => ({ ...prev, [k]: e.target.value })); };

  const exportCsv = async () => {
    setExporting(true); setError(null);
    try { await downloadFile(`/user-activity/export.csv${qs ? `?${qs}` : ''}`, `readydoc-activity-${new Date().toISOString().slice(0, 10)}.csv`); }
    catch (e) { setError(e.message); }
    finally { setExporting(false); }
  };

  const rows = data?.rows || [];
  const total = data?.total ?? 0;
  const input = 'px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white';

  return (
    <div className="space-y-4" data-user-activity>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Activity size={20} /> User Activity</h2>
          <p className="text-sm text-gray-500 max-w-2xl">
            Who was signed in and what they did: sign-ins and sign-outs, pages and records opened, changes (with the
            values before and after), and files opened or downloaded. Passwords, tokens and file contents are never
            recorded. Nothing here is ever deleted.
          </p>
        </div>
        <button onClick={exportCsv} disabled={exporting} data-activity-export
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs text-gray-600 flex flex-col gap-1">Person
          <select id="ua-user" data-activity-user value={f.user_id} onChange={set('user_id')} className={input}>
            <option value="">Everyone</option>
            {(people || []).map(p => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">From
          <input id="ua-from" data-activity-from type="date" value={f.from} onChange={set('from')} className={input} />
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">To
          <input id="ua-to" data-activity-to type="date" value={f.to} onChange={set('to')} className={input} />
        </label>
        <label className="text-xs text-gray-600 flex flex-col gap-1">What
          <select id="ua-action" data-activity-action value={f.action} onChange={set('action')} className={input}>
            <option value="">Everything</option>
            {(actions || []).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        {(f.user_id || f.from || f.to || f.action) && (
          <button onClick={() => { setOffset(0); setF({ user_id: '', from: '', to: '', action: '' }); }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">Clear</button>
        )}
      </div>
      <p className="text-xs text-gray-500">Dates are whole days in UTC. Times below are in your own time zone.</p>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-2 text-sm text-gray-600 border-b border-gray-100" data-activity-total={total}>
          {loading && !data ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'entry' : 'entries'}`}
          {total > PAGE && ` · showing ${offset + 1}–${Math.min(offset + PAGE, total)}`}
        </div>
        <FrozenScroll className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
              <tr>
                <th className="w-8" />
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">What</th>
                <th className="px-3 py-2">Page or record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && !loading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Nothing recorded for these filters.</td></tr>
              )}
              {rows.map(r => (
                <Fragment key={r.id}>
                  <tr {...expand.rowProps(r.id)} data-activity-row={r.action}>
                    <ExpandCell open={expand.isExpanded(r.id)} />
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700" title={`${r.occurred_at} UTC`}>{formatDateTime(r.occurred_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.user_name || '—'}{r.via === 'token' && <span className="ml-1 text-[10px] text-gray-500">(bot token)</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs ${TONE[r.action] || 'bg-gray-100'}`}>{r.action_label}</span></td>
                    <td className="px-3 py-2 text-gray-700 break-all">{where(r)}</td>
                  </tr>
                  {expand.isExpanded(r.id) && (
                    <DetailRow colSpan={5}><Changes details={r.details} /></DetailRow>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </FrozenScroll>
        {total > PAGE && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-sm">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="px-3 py-1 rounded border disabled:opacity-40">Newer</button>
            <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="px-3 py-1 rounded border disabled:opacity-40">Older</button>
          </div>
        )}
      </div>
    </div>
  );
}
