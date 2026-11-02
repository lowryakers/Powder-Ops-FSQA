import { useState } from 'react';
import { Eye, Check } from 'lucide-react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/datetime';

// "I've seen this week's schedule" (D-298). One button everybody can press, and
// who has pressed it. A Seen is against a PUBLISH of the week, so when the
// schedule is published again the button comes back and says it was updated.
export default function ScheduleSeen({ weekStart }) {
  const { data, refresh } = useApiGet(weekStart ? `/production/schedule/seen?week_start=${weekStart}` : null, [weekStart]);
  const [busy, setBusy] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [err, setErr] = useState('');
  if (!data) return null;
  const seen = data.seen || [];
  const mark = async () => {
    setBusy(true); setErr('');
    try { await apiPost('/production/schedule/acknowledge', { week_start: weekStart }); refresh(); window.dispatchEvent(new CustomEvent('schedule-notice-changed')); }
    catch (e) { setErr(e.message || 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-schedule-seen>
      {data.my_seen_at ? (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-emerald-800" data-seen-mine>
          <Check size={14} /> You saw this week's schedule · {formatDateTime(data.my_seen_at)}
        </span>
      ) : (
        <button onClick={mark} disabled={busy} data-seen-button
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          <Eye size={14} /> {busy ? 'Saving…' : "I've seen this week's schedule"}
        </button>
      )}
      {!data.my_seen_at && data.updated_since_seen && (
        <span className="text-amber-700 text-xs" data-seen-updated>Updated since you last saw it.</span>
      )}
      <button onClick={() => setShowNames(v => !v)} className="text-xs text-gray-500 hover:underline" data-seen-count>
        Seen by {seen.length}{seen.length ? (showNames ? ' ▴' : ' ▾') : ''}
      </button>
      {showNames && seen.length > 0 && (
        <div className="w-full text-xs text-gray-600" data-seen-names>
          {seen.map(s => `${s.name} (${formatDateTime(s.seen_at)})`).join(' · ')}
        </div>
      )}
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
