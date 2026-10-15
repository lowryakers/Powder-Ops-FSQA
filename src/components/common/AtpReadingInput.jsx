// The ATP reading on a cleaning event (D-179) — the box beside "ATP swab" on the
// end-of-day report and the running day log, and the chip the log shows after.
//
// A tick only says a swab was taken. PC #1's critical limit is a NUMBER (35 RLU,
// Protocol 003 V4), so the reading is what makes the swab evidence. Blank is a
// gap, never a fail — the server grades only a number it was given and stamps
// the limit beside it. AtpLimitHint tells the operator as they type; it decides
// nothing.
import AtpLimitHint from './AtpLimitHint.jsx';

export function AtpReadingInput({ value, onChange }) {
  return (
    <div className="w-full sm:w-56" data-atp-reading-field>
      <label className="block text-[11px] text-gray-600 mb-0.5">ATP reading (RLU)</label>
      <input type="number" inputMode="decimal" step="any" min="0" value={value ?? ''}
        onChange={e => onChange(e.target.value)} placeholder="e.g. 12" data-atp-reading-input
        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <AtpLimitHint value={value} />
      {/* ONE SWAB, ONE PLACE (D-182). When QA swabs this area the reading is on
          QA's Sanitation record; typing it here too counts the swab twice. */}
      <p className="text-[11px] text-gray-500 mt-1" data-atp-own-swab-note>
        Only a swab your team took. If QA swabbed it, QA records it on their Sanitation record — don&apos;t copy it here.
      </p>
    </div>
  );
}

/** "ATP 12 / 35 RLU", red when the reading was over the limit it was graded against. */
export function AtpReadingChip({ event }) {
  if (event?.atp_reading == null || event.atp_reading === '') return null;
  const over = event.atp_pass === false;
  return (
    <span data-atp-reading-chip={over ? 'fail' : 'pass'}
      className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${over ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
      ATP {event.atp_reading}{event.atp_limit != null ? ` / ${event.atp_limit}` : ''} RLU{over ? ' · over limit' : ''}
    </span>
  );
}
