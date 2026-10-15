// The swab log (D-186): QA's swabs written down as they are taken, filed later.
//
// One line per swab, saved the moment Enter is pressed. The room, the date and
// the kit lot stay put for the next swab, and the swab number counts up, so a
// round of a dozen swabs is a dozen short lines. Lines stay editable until
// filed (an allergen kit read later is entered then). "File" turns them into
// Sanitation records, one per room visit, through the same writer as the form —
// the server grades every reading; the chip here only says what it will decide.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Trash2, Send, Clock } from 'lucide-react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import { areaLabel } from '../../../shared/rooms.js';

const SURFACES = ['Table', 'Sifter', 'Small sifter', 'Utensils', 'Scissors', 'Blender 1', 'Blender 2', 'Bowls', 'Machine'];
const cell = 'w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white';
const nextNo = (no) => (/^\d+$/.test(String(no || '')) ? String(Number(no) + 1) : '');

function GradeChip({ line }) {
  if (line.grade == null) return <span className="text-xs text-gray-400">—</span>;
  return line.grade.pass
    ? <span className="text-xs text-green-700" data-swab-grade="pass">✓ under {line.grade.limit}</span>
    : <span className="text-xs font-semibold text-red-700" data-swab-grade="fail">Over {line.grade.limit}</span>;
}

export default function SwabLog({ onFiled }) {
  const { data, refresh } = useApiGet('/sanitation/swab-log');
  const { data: areas } = useApiGet('/structure/lists/sanitation_areas');
  const rooms = useMemo(() => (areas?.options || []).map((o) => ({ value: o.value, label: o.label || areaLabel(o.value) })), [areas]);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const atpRef = useRef(null);
  const surfaceRef = useRef(null);

  // The first line of the day starts at the plant's date and time; after that
  // each new line inherits the last one's date, time, room and lot.
  useEffect(() => {
    if (!draft && data?.now) {
      setDraft({ swabbed_on: data.now.date, swabbed_time: data.now.time, room: '', surface: '', swab_no: '', atp_reading: '', allergen_swab: false, allergen_lot: '' });
    }
  }, [data, draft]);

  const entries = data?.entries || [];
  const visits = data?.visits || [];
  const notReady = entries.filter((e) => e.not_ready);

  const add = async (e) => {
    e?.preventDefault();
    if (!draft) return;
    setError('');
    try {
      await apiPost('/sanitation/swab-log', draft);
      setDraft((d) => ({ ...d, surface: '', swab_no: nextNo(d.swab_no), atp_reading: '', allergen_swab: false }));
      refresh();
      (surfaceRef.current || atpRef.current)?.focus();
    } catch (err) { setError(err.message); }
  };

  const patch = async (id, body) => {
    setError('');
    try { await apiPut(`/sanitation/swab-log/${id}`, body); refresh(); } catch (err) { setError(err.message); refresh(); }
  };
  const remove = async (id) => { try { await apiDelete(`/sanitation/swab-log/${id}`); refresh(); } catch (err) { setError(err.message); } };
  const file = async () => {
    setSaving(true); setError('');
    try {
      const out = await apiPost('/sanitation/swab-log/file', {});
      setResult(out); refresh(); onFiled?.();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  const now = () => data?.now && setDraft((d) => ({ ...d, swabbed_on: data.now.date, swabbed_time: data.now.time }));

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-3 space-y-3" data-swab-log>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-1.5"><ClipboardList size={17} /> Swab log</h3>
        <p className="text-xs text-gray-500">Write each swab as you take it. File when you have a minute — each room becomes a Sanitation record.</p>
      </div>

      {draft && (
        <form onSubmit={add} className="grid grid-cols-2 sm:grid-cols-[8.5rem_6rem_minmax(8rem,1fr)_minmax(7rem,1fr)_5.5rem_6rem_auto] gap-2 items-end" data-swab-entry>
          <label className="text-[11px] text-gray-500">Date
            <input type="date" value={draft.swabbed_on} onChange={(e) => setDraft({ ...draft, swabbed_on: e.target.value })} className={cell} data-swab-date />
          </label>
          <label className="text-[11px] text-gray-500">Time
            <span className="flex gap-1">
              <input type="time" value={draft.swabbed_time} onChange={(e) => setDraft({ ...draft, swabbed_time: e.target.value })} className={cell} data-swab-time required />
              <button type="button" onClick={now} title="Set to now" className="px-1.5 text-gray-400 hover:text-gray-700" aria-label="Set to now"><Clock size={15} /></button>
            </span>
          </label>
          <label className="text-[11px] text-gray-500">Room
            <select value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })} className={cell} data-swab-room>
              <option value="">Pick…</option>
              {rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-gray-500">Surface
            <input ref={surfaceRef} list="swab-log-surfaces" value={draft.surface} onChange={(e) => setDraft({ ...draft, surface: e.target.value })} className={cell} data-swab-surface-in />
          </label>
          <label className="text-[11px] text-gray-500">Swab #
            <input value={draft.swab_no} onChange={(e) => setDraft({ ...draft, swab_no: e.target.value })} className={cell} inputMode="numeric" data-swab-no-in />
          </label>
          <label className="text-[11px] text-gray-500">ATP (RLU)
            <input ref={atpRef} value={draft.atp_reading} onChange={(e) => setDraft({ ...draft, atp_reading: e.target.value })} className={cell} inputMode="decimal" data-swab-atp-in />
          </label>
          <button type="submit" className="col-span-2 sm:col-span-1 px-3 py-1.5 bg-powder-600 text-white rounded-md text-sm font-medium hover:bg-powder-700" data-swab-add-line>
            Add
          </button>
          <div className="col-span-2 sm:col-span-7 flex flex-wrap items-center gap-2 text-sm text-gray-700">
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={draft.allergen_swab} onChange={(e) => setDraft({ ...draft, allergen_swab: e.target.checked })} data-swab-allergen-in />
              Allergen swab
            </label>
            {draft.allergen_swab && (
              <input placeholder="Kit lot #" value={draft.allergen_lot} onChange={(e) => setDraft({ ...draft, allergen_lot: e.target.value })}
                className="w-28 px-2 py-1 border border-gray-300 rounded-md text-sm" data-swab-lot-in />
            )}
            <span className="text-[11px] text-gray-400">Enter adds the line. Room, date, time and lot carry to the next one.</span>
          </div>
          <datalist id="swab-log-surfaces">{SURFACES.map((s) => <option key={s} value={s} />)}</datalist>
        </form>
      )}

      {error && <p className="text-sm text-red-700" data-swab-log-error>{error}</p>}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[46rem] w-full text-sm" data-swab-lines>
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium">Time</th>
                <th className="text-left px-2 py-1.5 font-medium">Room</th>
                <th className="text-left px-2 py-1.5 font-medium">Surface</th>
                <th className="text-left px-2 py-1.5 font-medium">Swab #</th>
                <th className="text-left px-2 py-1.5 font-medium">ATP</th>
                <th className="text-left px-2 py-1.5 font-medium">Allergen</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <tr key={`${e.id}|${e.updated_at}`} data-swab-line-row={e.swab_no || e.id} className={e.not_ready ? 'bg-amber-50' : ''}>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <input type="time" defaultValue={e.swabbed_time} onBlur={(ev) => ev.target.value !== e.swabbed_time && patch(e.id, { swabbed_time: ev.target.value })} className={`${cell} w-[6.5rem]`} />
                    {e.swabbed_on !== data?.now?.date && <span className="block text-[10px] text-gray-400">{e.swabbed_on}</span>}
                  </td>
                  <td className="px-2 py-1">
                    <select defaultValue={e.room || ''} onChange={(ev) => patch(e.id, { room: ev.target.value })} className={cell} data-swab-line-room>
                      <option value="">Pick…</option>
                      {rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1"><input list="swab-log-surfaces" defaultValue={e.surface || ''} onBlur={(ev) => ev.target.value !== (e.surface || '') && patch(e.id, { surface: ev.target.value })} className={cell} /></td>
                  <td className="px-2 py-1"><input defaultValue={e.swab_no || ''} onBlur={(ev) => ev.target.value !== (e.swab_no || '') && patch(e.id, { swab_no: ev.target.value })} className={`${cell} w-20`} /></td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <input defaultValue={e.atp_reading ?? ''} inputMode="decimal" onBlur={(ev) => ev.target.value !== String(e.atp_reading ?? '') && patch(e.id, { atp_reading: ev.target.value })} className={`${cell} w-20`} data-swab-line-atp />
                    <span className="ml-1"><GradeChip line={e} /></span>
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <label className="inline-flex items-center gap-1 mr-1.5">
                      <input type="checkbox" className="h-4 w-4 shrink-0" defaultChecked={e.allergen_swab} onChange={(ev) => patch(e.id, { allergen_swab: ev.target.checked })} />
                    </label>
                    {e.allergen_swab && (
                      <>
                        <select defaultValue={e.allergen_result || ''} onChange={(ev) => patch(e.id, { allergen_result: ev.target.value })}
                          className="px-1.5 py-1 border border-gray-300 rounded-md text-sm" data-swab-line-allergen>
                          <option value="">Not read yet</option>
                          <option value="pass">Pass</option>
                          <option value="fail">Fail</option>
                        </select>
                        <input defaultValue={e.allergen_lot || ''} placeholder="Lot" onBlur={(ev) => ev.target.value !== (e.allergen_lot || '') && patch(e.id, { allergen_lot: ev.target.value })}
                          className="ml-1 w-16 px-1.5 py-1 border border-gray-300 rounded-md text-sm" />
                      </>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    {e.not_ready && <span className="text-[11px] text-amber-800 mr-1" data-swab-not-ready>{e.not_ready}</span>}
                    <button type="button" onClick={() => remove(e.id)} className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove this swab"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={file} disabled={saving || visits.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50" data-swab-file>
            <Send size={15} /> {saving ? 'Filing…' : `File ${entries.length - notReady.length} swab${entries.length - notReady.length === 1 ? '' : 's'}`}
          </button>
          <span className="text-xs text-gray-500" data-swab-visits>
            {visits.length} record{visits.length === 1 ? '' : 's'}: {visits.map((v) => `${areaLabel(v.room)} ${v.time} (${v.swabs})`).join(' · ')}
            {notReady.length ? ` — ${notReady.length} line${notReady.length === 1 ? '' : 's'} waiting for a room or a reading` : ''}
          </span>
        </div>
      )}

      {result && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-2.5 text-sm text-green-900" data-swab-filed>
          Filed {result.filed.length} record{result.filed.length === 1 ? '' : 's'}
          {result.filed.length > 0 && ': '}
          {result.filed.map((f) => `${areaLabel(f.room)} ${f.time} · ${f.swabs} swab${f.swabs === 1 ? '' : 's'} · ${f.result === 'fail' ? 'FAIL' : 'pass'}`).join(' — ')}
          {result.filed.filter((f) => f.atp_message).map((f) => <p key={f.record_id} className="mt-1 text-red-800">{f.atp_message}</p>)}
          {result.refused.map((r) => <p key={`${r.room}${r.time}`} className="mt-1 text-red-800">{areaLabel(r.room)} {r.time}: {r.error}</p>)}
        </div>
      )}

      {entries.length === 0 && !result && (data?.recent || []).length > 0 && (
        <p className="text-xs text-gray-500" data-swab-recent>
          Filed this week: {(data.recent || []).slice(0, 6).map((r) => `${areaLabel(r.area)} ${r.swabbed_on.slice(5)} ${r.swabbed_time} (${r.swabs})`).join(' · ')}
        </p>
      )}
    </section>
  );
}
