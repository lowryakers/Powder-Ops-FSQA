import { useState, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';

/**
 * "Who changed this record, and when?"
 *
 * The single most common thing an auditor asks about any individual record,
 * and until now the only answer was: leave the record, open the Audit Log, and
 * reconstruct the filter by hand. `GET /audit/entity/:type/:id` had existed the
 * whole time with nothing calling it — a feature with no door, which looks
 * exactly like a feature that does not exist.
 *
 * Deliberately COLLAPSED by default. History is what you check when something
 * looks wrong; expanding it every time would push the record itself off the
 * screen for the ninety-nine reads out of a hundred that are not questioning
 * anything.
 *
 * It shows WHAT CHANGED, not two JSON blobs. The audit log stores whole
 * snapshots of before and after, and dumping both buries the one value someone
 * came to check — the same reason the Audit Log's own detail row diffs them.
 */
export default function RecordHistory({ type, id, label = 'History' }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open || rows || !type || !id) return;
    let live = true;
    apiFetch(`/audit/entity/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
      .then(r => { if (live) setRows(Array.isArray(r) ? r : []); })
      .catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [open, rows, type, id]);

  if (!type || !id) return null;

  return (
    <div className="border-t border-gray-100 pt-2 mt-2">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <History size={13} /> {label}
      </button>

      {open && (
        <div className="mt-2">
          {err && <p className="text-xs text-red-700">Could not load the history: {err}</p>}
          {!err && !rows && <p className="text-xs text-gray-400">Loading…</p>}
          {rows?.length === 0 && (
            // An empty trail is a real answer, not a broken panel — records
            // filed before auditing covered this type have none.
            <p className="text-xs text-gray-500">
              Nothing recorded against this record. Entries filed before this module was audited have no trail.
            </p>
          )}
          {rows?.length > 0 && (
            <ol className="space-y-1.5">
              {rows.map(e => <Entry key={e.id} entry={e} />)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** Only the fields that actually moved, old → new. */
function changedFields(entry) {
  const before = parse(entry.previous_state);
  const after = parse(entry.new_state);
  if (!before || !after) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter(k => !['updated_at', 'created_at'].includes(k))
    .map(k => ({ k, from: before[k], to: after[k] }))
    .filter(c => JSON.stringify(c.from ?? null) !== JSON.stringify(c.to ?? null));
}

const short = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

function Entry({ entry }) {
  const changes = changedFields(entry);
  return (
    <li className="text-xs">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-medium text-gray-900">{entry.actor || 'system'}</span>
        {entry.actor_role && <span className="text-[10px] text-gray-500">{entry.actor_role}</span>}
        <span className="text-gray-600">{String(entry.action || '').replace(/_/g, ' ')}</span>
        <span className="text-gray-400">{formatDateTime(entry.timestamp)}</span>
      </div>
      {changes.length > 0 && (
        <ul className="mt-0.5 ml-3 space-y-0.5">
          {changes.slice(0, 12).map(c => (
            <li key={c.k} className="text-[11px] text-gray-600">
              <span className="font-mono text-gray-500">{c.k}</span>{' '}
              <span className="text-gray-400">{short(c.from)}</span>
              {' → '}
              <span className="text-gray-800">{short(c.to)}</span>
            </li>
          ))}
          {changes.length > 12 && (
            <li className="text-[11px] text-gray-400">…and {changes.length - 12} more fields</li>
          )}
        </ul>
      )}
    </li>
  );
}
