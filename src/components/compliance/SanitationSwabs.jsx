// The swabs on a Sanitation record, one row each (D-182).
//
// A room visit swabs several surfaces — sifter, table, utensils, the blender —
// each with its own swab number and reading, and sometimes an allergen swab
// with its kit lot. The record held one ATP box, so QA kept a spreadsheet. The
// rows are the record now: each reading is graded by the server against PC #1,
// and the record's single ATP figure is the worst of them. The hint beside each
// reading tells the person filing what is about to happen; it decides nothing.
import { Plus, Trash2 } from 'lucide-react';
import AtpLimitHint from '../common/AtpLimitHint.jsx';
import { blankSwab } from '../../lib/swabRows.js';

// What QA writes in the sheet's AREA column — offered, never required.
const SURFACES = ['Table', 'Sifter', 'Small sifter', 'Utensils', 'Scissors', 'Blender 1', 'Blender 2', 'Bowls', 'Machine'];

export function SwabTable({ rows, onChange }) {
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const input = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';
  return (
    <fieldset className="rounded-xl border border-gray-200 p-3 space-y-2" data-swab-table>
      <legend className="px-1 text-sm font-semibold text-gray-900">Swabs</legend>
      <p className="text-xs text-gray-500">
        One row per swab: the surface, the swab number and the luminometer reading. Tick allergen swab when one was
        taken. Any reading over the limit fails the record; a passing reading never overrides a fail you chose.
      </p>
      <datalist id="swab-surfaces">{SURFACES.map((s) => <option key={s} value={s} />)}</datalist>
      {rows.length === 0 && <p className="text-xs text-gray-500" data-swab-none>No swabs on this record.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 space-y-2" data-swab-row={i + 1}>
          <div className="grid grid-cols-2 sm:grid-cols-[6rem_1fr_9rem_auto] gap-2 items-start">
            <input aria-label={`Swab ${i + 1} — swab number`} placeholder="Swab #" value={r.swab_no}
              onChange={(e) => set(i, { swab_no: e.target.value })} className={input} data-swab-no />
            <input aria-label={`Swab ${i + 1} — surface`} placeholder="Surface (table, sifter…)" list="swab-surfaces"
              value={r.surface} onChange={(e) => set(i, { surface: e.target.value })} className={input} data-swab-surface />
            <div className="col-span-2 sm:col-span-1">
              <input type="text" inputMode="decimal" aria-label={`Swab ${i + 1} — ATP reading (RLU)`} placeholder="ATP (RLU)"
                value={r.atp_reading} onChange={(e) => set(i, { atp_reading: e.target.value })} className={input} data-swab-atp />
              <AtpLimitHint value={r.atp_reading} />
            </div>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="justify-self-end p-1.5 text-gray-400 hover:text-red-600" aria-label={`Remove swab ${i + 1}`} data-swab-remove>
              <Trash2 size={16} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={r.allergen_swab}
                onChange={(e) => set(i, { allergen_swab: e.target.checked })} data-swab-allergen />
              Allergen swab
            </label>
            {r.allergen_swab && (
              <>
                <select aria-label={`Swab ${i + 1} — allergen result`} value={r.allergen_result}
                  onChange={(e) => set(i, { allergen_result: e.target.value })}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-swab-allergen-result>
                  <option value="">Result not read yet</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </select>
                <input aria-label={`Swab ${i + 1} — allergen kit lot`} placeholder="Kit lot #" value={r.allergen_lot}
                  onChange={(e) => set(i, { allergen_lot: e.target.value })}
                  className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-swab-allergen-lot />
              </>
            )}
            {r.allergen_present && <span className="text-xs text-gray-500">In product: {r.allergen_present}</span>}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, blankSwab()])} data-swab-add
        className="inline-flex items-center gap-1 text-sm font-medium text-powder-700 hover:underline">
        <Plus size={15} /> Add a swab
      </button>
    </fieldset>
  );
}

/** The swabs on a filed record. */
export function SwabList({ swabs }) {
  if (!swabs?.length) return null;
  return (
    <div data-swab-list>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Swabs ({swabs.length})</p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="text-left px-2.5 py-1.5 font-medium">Swab #</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Surface</th>
              <th className="text-left px-2.5 py-1.5 font-medium">ATP</th>
              <th className="text-left px-2.5 py-1.5 font-medium">Allergen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {swabs.map((s, i) => (
              <tr key={i} data-swab-line={s.swab_no || i + 1} data-swab-pass={s.atp_pass == null ? '' : s.atp_pass ? 'pass' : 'fail'}>
                <td className="px-2.5 py-1.5 tabular-nums">{s.swab_no || '—'}</td>
                <td className="px-2.5 py-1.5">{s.surface || '—'}{s.note && <span className="block text-[11px] text-gray-400">{s.note}</span>}</td>
                <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums">
                  {s.atp_reading == null ? <span className="text-gray-400">—</span> : (
                    <span className={s.atp_pass === false ? 'text-red-700 font-semibold' : 'text-gray-900'}>
                      {s.atp_reading}{s.atp_limit != null ? ` / ${s.atp_limit}` : ''} RLU{s.atp_pass === false ? ' · over limit' : ''}
                    </span>
                  )}
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  {!s.allergen_swab ? <span className="text-gray-400">—</span> : (
                    <span className={s.allergen_result === 'fail' ? 'text-red-700 font-semibold' : 'text-gray-900'}>
                      {s.allergen_result === 'pass' ? 'Pass' : s.allergen_result === 'fail' ? 'Fail' : 'Result not recorded'}
                      {s.allergen_lot ? ` · lot ${s.allergen_lot}` : ''}
                    </span>
                  )}
                  {s.allergen_present && <span className="block text-[11px] text-gray-400">In product: {s.allergen_present}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
