// Runs: a run opens when it starts and closes when it ends, and its start asks
// for the Pre-Op clean (D-146, OBL-22).
//
// Protocol 003 V4 PC #1 is "a pre-operational clean at the beginning of every
// run" — a trigger, not a calendar. Starting a run here issues its number and,
// when the room has no passing Pre-Op on record since its last run, raises a
// Pre-Op task for Cleaning. Whether each run's Pre-Op is on record is the
// server's derivation, read off the Sanitation log and rendered as given.
// Reported, never gated: a run starts and closes whatever the record says.
import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { PlayCircle, StopCircle, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { PRODUCTION_ROOMS, PRODUCTION_TEAMS } from '../../constants/productionLines';
import { roomLabel } from '../../../shared/rooms.js';
import { formatDateTime } from '../../lib/datetime.js';

function PreopChip({ preop }) {
  if (preop?.state === 'before') {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full" data-run-preop="before">
      <CheckCircle2 size={12} /> Pre-Op on record{preop.record?.atp_reading != null ? ` · ATP ${preop.record.atp_reading}/${preop.record.atp_limit ?? '—'}` : ''}</span>;
  }
  if (preop?.state === 'after') {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full" data-run-preop="after">
      <Clock size={12} /> Pre-Op filed after the start</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full" data-run-preop="owed">
    <AlertTriangle size={12} /> No Pre-Op on record</span>;
}

// WHEN THE MO STARTS IN MRPEASY, START THE RUN HERE (A-20261124-004, D-387).
// Manual on purpose: no webhook and no poll; a person starts the run. One form,
// rendered by the Runs tab and by the Operator View card, posting to the one
// route (POST /production/runs → startRun → raiseWorkOrder('preop')).
export const START_RUN_HOWTO = 'When the MO starts in MRPEasy, start the run here: the room, the MO number if you have it, and the product. Close it when the run ends. If the room has no Pre-Op on record since its last run, Cleaning is asked for one. Nothing is blocked; the MO in MRPEasy is never held.';
export const START_RUN_HOWTO_ES = 'Cuando la MO empiece en MRPEasy, inicie la corrida aquí: el cuarto, el número de MO si lo tiene, y el producto. Ciérrela cuando termine. Si el cuarto no tiene un Pre-Op registrado desde su última corrida, se le pide uno a Limpieza. Nada se bloquea; la MO en MRPEasy nunca se detiene.';

export function StartRunForm({ onStarted, defaultTeam = '' }) {
  const [form, setForm] = useState({ room: '', team: defaultTeam, mo_number: '', product_name: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const start = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await apiPost('/production/runs', form);
      setMsg(r.prompt_raised
        ? `${r.run.run_no} started in ${r.run.room_label}. No Pre-Op is on record for the room since its last run — a Pre-Op task went to Cleaning, and filing the clean closes it.`
        : `${r.run.run_no} started in ${r.run.room_label}. The room's Pre-Op is on record.`);
      setForm({ room: '', team: form.team, mo_number: '', product_name: '' });
      onStarted?.(r);
    } catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
        <form onSubmit={start} className="bg-white rounded-xl border border-gray-200 p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <label className="text-xs text-gray-600">Room
            <select required value={form.room} onChange={e => set('room', e.target.value)} data-run-room
              className="mt-0.5 w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Choose…</option>
              {PRODUCTION_ROOMS.map(r => <option key={r} value={r}>{roomLabel(r)}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">Team
            <select value={form.team} onChange={e => set('team', e.target.value)}
              className="mt-0.5 w-full px-2 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">—</option>
              {PRODUCTION_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">MO #
            <input value={form.mo_number} onChange={e => set('mo_number', e.target.value)} data-run-mo
              className="mt-0.5 w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>
          <label className="text-xs text-gray-600">Product
            <input value={form.product_name} onChange={e => set('product_name', e.target.value)}
              className="mt-0.5 w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>
          <button type="submit" disabled={busy} data-run-start
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            <PlayCircle size={15} /> Start run
          </button>
        </form>
      {msg && <p className="text-sm text-powder-900 bg-powder-50 border border-powder-200 rounded-lg px-3 py-2" data-run-msg>{msg}</p>}
    </div>
  );
}

/**
 * The door on the Operator View (D-387): the screen the floor already has open.
 * Shown only to people who may start a run (the server's `can_run`); folded to
 * one line until opened, so it is not one more block on a busy screen.
 */
export function StartRunCard({ lang = 'en' }) {
  const { data, refresh } = useApiGet('/production/runs?status=open');
  const [open, setOpen] = useState(false);
  if (!data?.can_run) return null;
  const es = lang === 'es';
  const openRuns = (data.runs || []).length;
  const toRuns = () => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'production-log', view: 'runs' } }));
  return (
    <section className="rounded-xl border border-powder-200 bg-powder-50 px-4 py-3 space-y-2" data-start-run-card>
      <div className="flex flex-wrap items-center gap-2">
        <PlayCircle size={16} className="text-powder-700" />
        <span className="text-sm font-semibold text-gray-900">{es ? '¿Empezando una MO en MRPEasy?' : 'Starting an MO in MRPEasy?'}</span>
        <button type="button" onClick={() => setOpen(o => !o)} data-start-run-open
          className="ml-auto px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-semibold">
          {open ? (es ? 'Cerrar' : 'Close') : (es ? 'Iniciar una corrida' : 'Start a run')}
        </button>
      </div>
      <p className="text-xs text-gray-700">{es ? START_RUN_HOWTO_ES : START_RUN_HOWTO}</p>
      {open && <StartRunForm onStarted={() => refresh()} />}
      <button type="button" onClick={toRuns} className="text-xs text-powder-700 hover:underline" data-start-run-list>
        {es ? `Corridas abiertas: ${openRuns} — ver y cerrar` : `Open runs: ${openRuns} — see and close them`}
      </button>
    </section>
  );
}

export default function ProductionRuns() {
  const { data, refresh } = useApiGet('/production/runs');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const runs = data?.runs || [];
  const canRun = !!data?.can_run;
  const close = async (run) => {
    setBusy(true); setMsg('');
    try { const r = await apiPost(`/production/runs/${run.id}/close`, {}); setMsg(`${r.run.run_no} closed.`); refresh(); }
    catch (err) { setMsg(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-production-runs>
      <p className="text-sm text-gray-600">
        Protocol 003 V4, PC #1: a pre-operational clean at the beginning of every run. {START_RUN_HOWTO}
      </p>
      {canRun && <StartRunForm onStarted={() => refresh()} />}
      {msg && <p className="text-sm text-powder-900 bg-powder-50 border border-powder-200 rounded-lg px-3 py-2" data-run-msg>{msg}</p>}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {!runs.length && <p className="px-4 py-6 text-center text-sm text-gray-400">No runs started yet.</p>}
        {runs.map(r => (
          <div key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1" data-run={r.run_no}>
            <span className="font-semibold text-gray-900">{r.run_no}</span>
            <span className="text-sm text-gray-700">{r.room_label}{r.mo_number ? ` · MO ${r.mo_number}` : ''}{r.product_name ? ` · ${r.product_name}` : ''}</span>
            <PreopChip preop={r.preop} />
            <span className="text-[11px] text-gray-500 w-full sm:w-auto">
              Started {formatDateTime(r.started_at)}{r.started_by ? ` by ${r.started_by}` : ''}
              {r.status === 'closed' ? ` · closed ${formatDateTime(r.ended_at)}${r.ended_by ? ` by ${r.ended_by}` : ''}` : ''}
            </span>
            {r.status === 'open' && canRun && (
              <button type="button" disabled={busy} onClick={() => close(r)} data-run-close={r.run_no}
                className="ml-auto flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium">
                <StopCircle size={13} /> Close run
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
