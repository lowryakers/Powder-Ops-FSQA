import { useState } from 'react';
import { apiPost } from '../../hooks/useApi';
import { OVERRIDE_REASON_MIN } from '../../../shared/sell-sheet-shelf-life.js';

// THE SELL SHEET'S SHELF LIFE, READ OFF THE STABILITY BASIS (D-374).
// Read only. The server derives it (shared/sell-sheet-shelf-life.js); this
// screen renders what it is told and offers the one thing a person may do:
// promise LESS than the basis, with a reason. With no basis there is nothing to
// type and nothing to lower — the line says so.
export default function SellSheetShelfLife({ sku, s, canEdit, onChanged }) {
  const [mode, setMode] = useState(null); // 'set' | 'clear'
  const [months, setMonths] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const noBasis = s.basis_months === null;

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await apiPost(`/products/${encodeURIComponent(sku)}/shelf-life-override`,
        mode === 'clear' ? { clear: true, reason } : { months: Number(months), reason });
      setMode(null); setMonths(''); setReason('');
      onChanged?.();
    } catch (e) { setError(e.message || 'Could not save.'); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 text-sm" data-sell-sheet-shelf-life data-source={s.source} data-months={s.months ?? ''}>
      <div className="text-xs text-gray-500">Shelf life (months, sell sheet)</div>
      {noBasis ? (
        <div data-no-stability-basis>
          <span className="font-medium text-amber-800">No stability basis</span>
          <span className="block text-xs text-amber-700">Nothing can be typed here. Record the basis, with its months, on Retention Samples → Stability.</span>
        </div>
      ) : (
        <div>
          <span className="font-medium text-gray-900">{s.months} months</span>
          {s.source === 'override'
            ? <span className="text-xs text-gray-600"> — override, lower than the basis of {s.basis_months} months</span>
            : <span className="text-xs text-gray-600"> — from the stability basis</span>}
        </div>
      )}
      {s.override && (
        <p className="text-xs text-gray-600 mt-1" data-override-line>
          Override {s.override.months} months by {s.override.by || 'unknown'}{s.override.at ? ` on ${String(s.override.at).slice(0, 10)}` : ''}: “{s.override.reason}”
          {s.override.superseded && <span className="block text-amber-700">No longer lower than the basis, so the basis applies.</span>}
        </p>
      )}
      {s.legacy_months !== null && s.legacy_months !== s.months && (
        <p className="text-xs text-gray-500 mt-1" data-legacy-months>Typed before this was derived: {s.legacy_months} months (no longer used).</p>
      )}
      {canEdit && !noBasis && !mode && (
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" className="text-blue-700 hover:underline" onClick={() => setMode('set')} data-override-open>
            {s.override ? 'Change override' : 'Promise less than the basis…'}
          </button>
          {s.override && <button type="button" className="text-gray-600 hover:underline" onClick={() => setMode('clear')} data-override-clear>Remove override</button>}
        </div>
      )}
      {mode && (
        <div className="mt-2 space-y-2 border border-gray-200 rounded-lg p-2" data-override-form>
          {mode === 'set' && (
            <label className="block text-xs text-gray-600">Months (fewer than {s.basis_months})
              <input data-override-months type="number" min="1" max={s.basis_months - 1} step="1" value={months} onChange={(e) => setMonths(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
            </label>
          )}
          <label className="block text-xs text-gray-600">Why (at least {OVERRIDE_REASON_MIN} characters)
            <textarea data-override-reason value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
          </label>
          {error && <p className="text-xs text-red-700" data-override-error>{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={submit} data-override-save
              className="px-3 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50">{busy ? 'Saving…' : mode === 'clear' ? 'Remove override' : 'Save override'}</button>
            <button type="button" onClick={() => { setMode(null); setError(''); }} className="px-3 py-1 text-xs rounded border border-gray-300">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
