import { useState, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';
import RuleTip from './RuleTip.jsx';

// "These checks were done and never recorded — file them."
//
// SHARED, AND SCOPED TO ONE LIST. This lived only on QA Inspections, which
// meant a missing CLEANING record — a restroom clean, a breakroom clean, a
// warehouse clean — was reported on a screen the cleaning team never opens,
// while the Sanitation screen where somebody would actually notice showed
// nothing at all. That is the 72-hour re-clean badge failure again: a warning
// only reaches whoever happens to open the page it lives on.
//
// So each screen reports its OWN gap and files only its own records. Filing
// twelve cleaning records must not quietly file QA's forty as well — somebody
// authorising a bulk write to a compliance log should get what the button said.
export default function RecordBackfillStrip({ group, onDone, noun = 'check' }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let live = true;
    apiFetch('/sanitation/qa-backfill/preview')
      .then(p => { if (live) { setPlan(p); setLoadError(null); } })
      // A FAILED LOOK IS NOT AN EMPTY ONE. This used to swallow every error, so
      // "you are not permitted to see this" and "there is nothing outstanding"
      // rendered identically — as silence. A gap has to be visible as a gap.
      .catch(e => { if (live) setLoadError(e?.message || 'Could not check for unrecorded work.'); });
    return () => { live = false; };
  }, [done]);

  useEffect(() => { if (done && onDone) onDone(); }, [done, onDone]);

  if (done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-900">
        Filed {done.created} record{done.created === 1 ? '' : 's'} from work that was completed but never
        recorded. Each carries the date the work was actually done and is marked entered late.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600">
        Could not check whether any completed work is missing its record. {loadError}
      </div>
    );
  }

  if (!plan) return null;
  // Scoped to this list. `by_group` is absent on an older server, in which case
  // fall back to the total rather than hiding a real backlog.
  const count = plan.by_group ? (plan.by_group[group] || 0) : plan.total;
  if (!count) return null;

  const mine = (plan.plan || []).filter(p => !plan.by_group || p.group === group);
  const months = Object.entries(mine.reduce((acc, p) => {
    const m = String(p.performed_at).slice(0, 7);
    acc[m] = (acc[m] || 0) + 1;
    return acc;
  }, {})).sort(([a], [b]) => a.localeCompare(b));

  const run = async () => {
    setBusy(true); setError(null);
    try { setDone(await apiFetch('/sanitation/qa-backfill', { method: 'POST', body: { group } })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <h3 className="font-semibold text-amber-900 text-sm">
        {count} completed {noun}{count === 1 ? '' : 's'} {count === 1 ? 'has' : 'have'} no record on this list
      </h3>
      <p className="text-xs text-amber-800 mt-1">
        This work was completed in ReadyDoc, but at the time completing the task did not file its
        record. <RuleTip id="backfill.invents-nothing" label="What exactly gets filed?" />
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {months.map(([m, n]) => (
          <span key={m} className="text-xs text-amber-900"><span className="font-medium">{m}</span> · {n}</span>
        ))}
      </div>
      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
      <button type="button" onClick={run} disabled={busy}
        className="mt-3 px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-60">
        {busy ? 'Filing…' : `File ${count} record${count === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
