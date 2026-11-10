import { useState } from 'react';
import { useApiGet, apiPost, apiDelete, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { ListChecks, Link2, X, AlertTriangle } from 'lucide-react';

const isDocController = (u) => u?.role === 'admin'
  || (u?.department || '').toLowerCase() === 'document_control'
  || (u?.role === 'supervisor' && ['qa', 'document_control'].includes((u?.department || '').toLowerCase()));

// D-328: the recurring tasks whose steps are written from this document. When a
// newer revision is approved they are listed on Doc Control Review ("Recurring
// tasks to check after a revision") until somebody checks them.
export default function DocumentTasks({ doc }) {
  const { user } = useAuth();
  const allowed = isDocController(user);
  const { data, refresh } = useApiGet(allowed ? `/doc-review/document-tasks/${doc.id}` : null, [doc.id, allowed]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  if (!allowed) return null;
  const rows = data || [];
  const search = async (e) => {
    e?.preventDefault(); setError('');
    try {
      setFound(await apiFetch(`/doc-review/schedules?q=${encodeURIComponent(q)}`));
    } catch (err) { setError(err.message); }
  };
  const link = async (id) => {
    setError('');
    try { await apiPost(`/doc-review/document-tasks/${doc.id}`, { schedule_id: id }); setFound(null); setQ(''); refresh(); }
    catch (err) { setError(err.message); }
  };
  const unlink = async (id) => {
    setError('');
    try { await apiDelete(`/doc-review/document-tasks/${doc.id}/${id}`); refresh(); }
    catch (err) { setError(err.message); }
  };
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2" data-document-tasks>
      <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><ListChecks size={14} /> Recurring tasks that follow this document</p>
      <p className="text-[11px] text-gray-500">When a new revision is approved, these are listed on Doc Control Review to check against it.</p>
      {rows.length === 0 && <p className="text-xs text-gray-400">None linked yet.</p>}
      <ul className="divide-y divide-gray-100">
        {rows.map(s => (
          <li key={s.id} className="py-1.5 flex items-center gap-2 text-sm" data-linked-task={s.id}>
            <span className={`min-w-0 truncate ${s.is_active ? 'text-gray-800' : 'text-gray-400'}`}>{s.title}</span>
            {s.needs_check && <span className="text-[11px] text-amber-700 inline-flex items-center gap-1 shrink-0"><AlertTriangle size={11} /> check against this revision</span>}
            <button type="button" onClick={() => unlink(s.id)} title="Unlink" className="ml-auto text-gray-400 hover:text-red-600 shrink-0"><X size={14} /></button>
          </li>
        ))}
      </ul>
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a recurring task to link" data-task-search
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        <button type="submit" className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium">Find</button>
      </form>
      {found && (
        <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {found.length === 0 && <li className="px-2 py-2 text-xs text-gray-400">No recurring task matches.</li>}
          {found.map(s => (
            <li key={s.id} className="px-2 py-1.5 flex items-center gap-2 text-xs">
              <span className="min-w-0 truncate">{s.title}</span>
              {s.linked_to && <span className="text-gray-400 shrink-0">follows {s.linked_to}</span>}
              <button type="button" onClick={() => link(s.id)} data-link-task={s.id}
                className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 border border-gray-300 rounded-md shrink-0"><Link2 size={11} /> Link</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
