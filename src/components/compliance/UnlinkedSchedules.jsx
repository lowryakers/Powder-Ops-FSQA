import { useState } from 'react';
import { useApiGet, apiPost, apiFetch } from '../../hooks/useApi';
import { Link2, Search, Info } from 'lucide-react';
import { TASK_GROUPS } from '../../../shared/task-groups.js';

// RECURRING TASKS WITH NO DOCUMENT LINKED (D-378, the D-328 link).
//
// A recurring task whose steps are written from an SOP or a WI is checked again
// when that document gets a new revision — but only once it is LINKED, and on
// day one none of them were. This is the list to work through: find the task,
// find its document, link it. Nothing is linked for you and nothing is guessed
// from a title; a link is somebody's statement that the steps come from that
// document. Linking is the same act as on the document itself (audited).

const teamLabel = (v) => TASK_GROUPS.find(g => g.value === v)?.label || v || 'No team';
const freqText = (s) => `${s.frequency_value && s.frequency_value > 1 ? `every ${s.frequency_value} ` : ''}${s.frequency_type || ''}`.trim();

export default function UnlinkedSchedules() {
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [applied, setApplied] = useState({ q: '', team: '' });
  const { data, loading, error, refresh } = useApiGet(
    `/doc-review/schedules/unlinked?q=${encodeURIComponent(applied.q)}&team=${encodeURIComponent(applied.team)}`, [applied.q, applied.team]);
  const [picking, setPicking] = useState(null);
  const [docQ, setDocQ] = useState('');
  const [docs, setDocs] = useState(null);
  const [msg, setMsg] = useState(null);

  const findDocs = async (e) => {
    e?.preventDefault();
    try { setDocs(await apiFetch(`/doc-review/documents?q=${encodeURIComponent(docQ)}`)); }
    catch (err) { setMsg({ kind: 'err', text: err.message }); }
  };
  const link = async (schedule, doc) => {
    setMsg(null);
    try {
      await apiPost(`/doc-review/document-tasks/${doc.id}`, { schedule_id: schedule.id });
      setMsg({ kind: 'ok', text: `“${schedule.title}” now follows ${doc.doc_number}. It will be listed for a check when ${doc.doc_number} gets a new revision.` });
      setPicking(null); setDocs(null); setDocQ('');
      refresh();
    } catch (err) { setMsg({ kind: 'err', text: err.message }); }
  };

  return (
    <div className="border border-gray-200 rounded-xl bg-white" data-unlinked-schedules>
      <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/60 space-y-1">
        <p className="text-sm font-semibold text-gray-900">Recurring tasks with no SOP or WI linked</p>
        <p className="text-xs text-gray-500 flex items-start gap-1">
          <Info size={12} className="mt-0.5 shrink-0" />
          A linked task is listed for a check when its document gets a new revision. Link each task to the document its steps
          are written from. Nothing is linked automatically.
        </p>
        {data && (
          <p className="text-xs text-gray-700" data-unlinked-total>
            <span className="font-semibold">{data.total}</span> active task{data.total === 1 ? '' : 's'} not linked · {data.linked} linked
          </p>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setApplied({ q, team }); }} className="px-3 py-2 flex flex-wrap gap-2 items-center border-b border-gray-100">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Task or machine name" data-unlinked-search
          className="flex-1 min-w-[10rem] border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        <select value={team} onChange={e => setTeam(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" data-unlinked-team>
          <option value="">Every team</option>
          {(data?.by_team || []).map(t => <option key={t.team} value={t.team}>{teamLabel(t.team)} ({t.c})</option>)}
        </select>
        <button type="submit" className="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium"><Search size={12} /> Filter</button>
      </form>

      {msg && <p className={`px-3 py-2 text-xs ${msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`} data-unlinked-msg>{msg.text}</p>}
      {loading && <p className="px-3 py-6 text-sm text-gray-500">Loading…</p>}
      {error && <p className="px-3 py-3 text-sm text-red-700">{error}</p>}
      {data && data.rows.length === 0 && <p className="px-3 py-8 text-sm text-gray-500 text-center">Every active recurring task here is linked.</p>}

      {data && data.rows.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {data.rows.map(s => (
            <li key={s.id} className="px-3 py-2 space-y-2" data-unlinked-row={s.id}>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 break-words">{s.title}</p>
                  <p className="text-[11px] text-gray-500">
                    {[teamLabel(s.task_group), freqText(s), s.equipment_name ? `${s.equipment_name}${s.equipment_asset ? ` #${s.equipment_asset}` : ''}` : null,
                      s.equipment_status && s.equipment_status !== 'active' ? s.equipment_status.replace(/_/g, ' ') : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button type="button" onClick={() => { setPicking(picking === s.id ? null : s.id); setDocs(null); setDocQ(''); }} data-unlinked-link={s.id}
                  className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded-md text-xs shrink-0"><Link2 size={12} /> Link a document</button>
              </div>
              {picking === s.id && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 space-y-2">
                  <form onSubmit={findDocs} className="flex gap-2">
                    <input autoFocus value={docQ} onChange={e => setDocQ(e.target.value)} placeholder="SOP or WI number, or title" data-unlinked-doc-search
                      className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                    <button type="submit" className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium">Find</button>
                  </form>
                  {docs && (
                    <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
                      {docs.length === 0 && <li className="px-2 py-2 text-xs text-gray-400">No document matches.</li>}
                      {docs.map(d => (
                        <li key={d.id} className="px-2 py-1.5 flex items-center gap-2 text-xs">
                          <span className="min-w-0 break-words"><span className="font-medium">{d.doc_number}</span> {d.title}{d.revision ? <span className="text-gray-400"> · Rev {d.revision}</span> : null}</span>
                          <button type="button" onClick={() => link(s, d)} data-unlinked-pick={d.id}
                            className="ml-auto px-2 py-0.5 border border-gray-300 rounded-md shrink-0">Link</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.shown < data.total && !applied.q && !applied.team && (
        <p className="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">Showing the first {data.shown}. Filter by team or name to reach the rest.</p>
      )}
    </div>
  );
}
