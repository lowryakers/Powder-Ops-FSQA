import { useEffect, useState } from 'react';
import { useApiGet, apiPost, apiFetch } from '../../hooks/useApi';
import { Check, AlertTriangle, Circle, ArrowRight, RefreshCw, HelpCircle, MinusCircle, Undo2 } from 'lucide-react';

/**
 * "What does this machine still need?" — rendered from the server's readiness
 * check, never from anything ticked by hand.
 *
 * The steps are DERIVED, so there is nothing to save and nothing that can go
 * stale: a step is done when its record exists. That also means this works on
 * the hundred pieces of equipment added long before it shipped, which a
 * one-shot "new equipment wizard" never could.
 *
 * Each step LINKS to the module that owns it rather than offering to create it
 * here. A PM schedule written by a checklist is a PM schedule with a guessed
 * frequency and an empty procedure — a record claiming maintenance exists,
 * which is worse than the visible gap.
 */
const TONE = {
  blocking: { ring: 'border-amber-200 bg-amber-50', icon: AlertTriangle, iconClass: 'text-amber-600' },
  optional: { ring: 'border-gray-200 bg-white', icon: Circle, iconClass: 'text-gray-300' },
  done: { ring: 'border-green-200 bg-green-50/60', icon: Check, iconClass: 'text-green-600' },
  unknown: { ring: 'border-gray-200 bg-gray-50', icon: HelpCircle, iconClass: 'text-gray-400' },
  // A waived step stays on the list, greyed rather than gone — the decision is
  // the record, and one that vanished could never be questioned or undone.
  waived: { ring: 'border-gray-200 bg-gray-50', icon: MinusCircle, iconClass: 'text-gray-400' },
};

function toneFor(step) {
  if (step.waived) return 'waived';
  if (step.unknown) return 'unknown';
  if (step.done) return 'done';
  return step.weight === 'required' ? 'blocking' : 'optional';
}

function go(tab) {
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab } }));
}

export default function EquipmentSetupChecklist({ equipmentId, initial, compact = false }) {
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState('');
  const { data: fetched, loading, error, refresh } = useApiGet(
    equipmentId ? `/equipment/${equipmentId}/readiness` : null, [equipmentId],
  );
  // `initial` is the copy that rode along on the create response, so the panel
  // can show the checklist the instant equipment is saved. It is only the FIRST
  // paint — once the fetch lands, the server's answer wins, or the list would
  // keep showing the state at creation forever.
  const data = fetched || initial || null;

  // A checklist read from records goes stale the moment somebody adds the PM
  // schedule in another tab, so re-check when this window is looked at again.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  if (loading && !data) return <p className="text-xs text-gray-400 py-2">Checking setup…</p>;
  if (error && !data) return <p className="text-xs text-red-600 py-2">Could not load the setup checklist: {error}</p>;
  if (!data) return null;

  // Same rule as the server: a waived step is neither done nor outstanding, so
  // a machine whose only gaps were marked N/A does read as fully set up.
  const outstanding = data.steps.filter(s => !s.done && !s.waived);
  const ready = outstanding.length === 0;
  const skip = async (step) => {
    // A reason is required by the server; asking here rather than after a 400
    // means the person is told what's wanted before they type.
    const reason = window.prompt(`Why doesn't "${step.label}" apply to this machine?`, '');
    if (reason === null) return;
    try { await apiPost(`/equipment/${equipmentId}/steps/${step.id}/skip`, { reason }); refresh(); }
    catch (e) { window.alert(e.message); }
  };
  const unskip = async (step) => {
    try { await apiFetch(`/equipment/${equipmentId}/steps/${step.id}/skip`, { method: 'DELETE' }); refresh(); }
    catch (e) { window.alert(e.message); }
  };

  const pmStep = data.steps.find(s => s.id === 'pm_schedule');
  const tasksWithoutSchedule = !!pmStep && !pmStep.done && /written, but nothing generates/.test(pmStep.detail || '');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-800">Setup checklist</h4>
        {ready ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">FULLY SET UP</span>
        ) : (
          <>
            <span className="text-xs text-gray-500">
              {data.done} of {data.applicable ?? data.total} done
              {data.waived > 0 ? ` · ${data.waived} not applicable` : ''}
            </span>
            {data.blocking > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                {data.blocking} still needed
              </span>
            )}
          </>
        )}
        <button type="button" onClick={refresh} title="Re-check"
          className="ml-auto p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {ready && (
        <p className="text-xs text-gray-500">
          PM, training and the documents for this equipment are all in place.
        </p>
      )}

      {/* The tasks are already written under Daily / Weekly / Monthly headings,
          so turning them into recurring schedules is not a guess about
          frequency — it is the frequency the operator chose. Offered as a
          deliberate click rather than done automatically. */}
      {tasksWithoutSchedule && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-amber-900">
              This machine has maintenance tasks written, but nothing generates them.
            </p>
            <p className="text-[11px] text-amber-800">
              Create a recurring schedule for each frequency, using the tasks exactly as written.
            </p>
            {buildNote && <p className="text-[11px] text-amber-900 mt-1">{buildNote}</p>}
          </div>
          <button type="button" disabled={building}
            onClick={async () => {
              setBuilding(true); setBuildNote('');
              try {
                const r = await apiPost(`/equipment/${equipmentId}/schedules-from-tasks`, {});
                setBuildNote(r.created.length
                  ? `Created ${r.created.map(c => c.frequency).join(', ')}.`
                  : 'Nothing to create — no recurring frequencies with tasks.');
                refresh();
              } catch (e) { setBuildNote(e.message); }
              finally { setBuilding(false); }
            }}
            className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 disabled:opacity-50">
            {building ? 'Creating…' : 'Create schedules from these tasks'}
          </button>
        </div>
      )}

      <div className={compact ? 'space-y-1.5' : 'grid grid-cols-1 lg:grid-cols-2 gap-1.5'}>
        {data.steps.map(step => {
          const tone = TONE[toneFor(step)];
          const Icon = tone.icon;
          return (
            <div key={step.id} className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border ${tone.ring}`}>
              <Icon size={14} className={`${tone.iconClass} shrink-0 mt-0.5`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className={`text-xs font-medium ${step.done ? 'text-gray-500' : 'text-gray-900'}`}>{step.label}</span>
                  {!step.done && step.weight === 'recommended' && (
                    <span className="text-[10px] text-gray-400">optional</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-500">{step.detail}</p>
                {step.waived && step.waived_by && (
                  <p className="text-[11px] text-gray-400">Marked by {step.waived_by}</p>
                )}
                {/* The "why" only shows on the steps still owed — on a finished
                    one it is just noise between the reader and the next gap. */}
                {!step.done && !step.waived && <p className="text-[11px] text-gray-400 mt-0.5">{step.why}</p>}
              </div>
              <div className="shrink-0 flex items-center gap-1">
                {!step.done && !step.waived && step.link?.tab && (
                  <button type="button" onClick={() => go(step.link.tab)}
                    className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-600 bg-white hover:bg-gray-50">
                    Set up <ArrowRight size={11} />
                  </button>
                )}
                {!step.done && !step.waived && (
                  <button type="button" title="This step doesn't apply to this machine"
                    onClick={() => skip(step)}
                    className="px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-500 bg-white hover:bg-gray-50">
                    N/A
                  </button>
                )}
                {step.waived && (
                  <button type="button" title="Put this step back on the list"
                    onClick={() => unskip(step)}
                    className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-500 bg-white hover:bg-gray-50">
                    <Undo2 size={11} /> Undo
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
