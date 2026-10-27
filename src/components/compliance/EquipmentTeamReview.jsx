import { useState } from 'react';
import { Users, X } from 'lucide-react';
import { apiPut } from '../../hooks/useApi';
import { taskGroupLabel } from '../../../shared/task-groups.js';

// The machines whose team sends their PMs to a list that probably should not carry them (D-218).
// The server derives the list (`equipmentTeamReview`); this renders it and offers the one change the
// review points at — the machine's own Team. Shown only when there is something to look at.
export default function EquipmentTeamReview({ review, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const rows = review?.rows || [];
  if (!rows.length) return null;
  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 flex-wrap" data-team-review>
        <Users size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-amber-900">
            {rows.length} machine{rows.length === 1 ? '' : 's'} may be on the wrong team
          </h3>
          <p className="text-xs text-amber-800">
            A machine&apos;s PM cards go to its team&apos;s task list. These send their weekly and longer PMs to a production,
            QA or cleaning list, or their cards reach nobody. Changing the Team moves the machine&apos;s schedules and open cards.
          </p>
        </div>
        <button onClick={() => setOpen(true)} data-team-review-open
          className="shrink-0 px-3 py-2 bg-white border border-amber-300 text-amber-900 rounded-lg text-sm font-medium hover:bg-amber-100">
          Review
        </button>
      </div>
      {open && <ReviewModal rows={rows} canEdit={canEdit} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function ReviewModal({ rows, canEdit, onClose, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});
  const [error, setError] = useState('');
  const move = async (r) => {
    setBusy(r.id); setError('');
    try {
      await apiPut(`/equipment/${r.id}`, { task_group: r.suggested });
      setDone(d => ({ ...d, [r.id]: r.suggested }));
      onChanged?.();
    } catch (e) { setError(e.message || 'Could not change the team'); }
    finally { setBusy(null); }
  };
  const groups = rows.reduce((m, r) => { const k = r.team || ''; (m[k] ||= []).push(r); return m; }, {});
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-team-review-modal>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Machines to review — team</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-5">
          <p className="text-sm text-gray-600">
            The suggestion is Maintenance: weekly and longer machine PMs are maintenance work. Changing the team moves every
            schedule on the machine, its daily check included. If the line should keep a machine&apos;s daily check, set that
            one schedule back to the line in Recurring Schedules afterwards.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {Object.entries(groups).map(([team, list]) => (
            <section key={team}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                {team ? taskGroupLabel(team) : 'No team'} · {list.length}
              </h3>
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {list.map(r => (
                  <li key={r.id} className="px-3 py-2.5 flex items-start gap-3 flex-wrap" data-team-review-row>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{r.name}{r.asset_id ? ` #${r.asset_id}` : ''}</p>
                      <p className="text-xs text-gray-600">{r.reason} {r.open_cards} open card{r.open_cards === 1 ? '' : 's'}.</p>
                    </div>
                    {done[r.id]
                      ? <span className="text-xs font-medium text-emerald-700 shrink-0">Moved to {taskGroupLabel(done[r.id])}</span>
                      : canEdit && r.suggested && (
                        <button disabled={busy === r.id} onClick={() => move(r)} data-team-review-move
                          className="shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-powder-600 text-white hover:bg-powder-700 disabled:opacity-50">
                          {busy === r.id ? 'Moving…' : `Move to ${taskGroupLabel(r.suggested)}`}
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
