import { useEffect } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Check, AlertTriangle, Circle, ArrowRight, RefreshCw, HelpCircle } from 'lucide-react';

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
};

function toneFor(step) {
  if (step.unknown) return 'unknown';
  if (step.done) return 'done';
  return step.weight === 'required' ? 'blocking' : 'optional';
}

function go(tab) {
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab } }));
}

export default function EquipmentSetupChecklist({ equipmentId, initial, compact = false }) {
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

  const outstanding = data.steps.filter(s => !s.done);
  const ready = outstanding.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-800">Setup checklist</h4>
        {ready ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800">FULLY SET UP</span>
        ) : (
          <>
            <span className="text-xs text-gray-500">{data.done} of {data.total} done</span>
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
                {/* The "why" only shows on the steps still owed — on a finished
                    one it is just noise between the reader and the next gap. */}
                {!step.done && <p className="text-[11px] text-gray-400 mt-0.5">{step.why}</p>}
              </div>
              {!step.done && step.link?.tab && (
                <button type="button" onClick={() => go(step.link.tab)}
                  className="shrink-0 inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-200 text-gray-600 bg-white hover:bg-gray-50">
                  Set up <ArrowRight size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
