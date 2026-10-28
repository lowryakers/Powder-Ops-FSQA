import { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Trash2, X } from 'lucide-react';
import { apiPost } from '../../hooks/useApi';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore.jsx';
import { withSignature } from '../../lib/signature';
import { downloadFile } from '../../lib/downloadFile.js';

// The COA corrections pile in QA Review (D-236, D-256).
//
// The server sends it most dangerous first: wrong signed certificates, then
// the gluten correction, then deletions, then possible duplicates. The chips
// work one kind at a time; empty copies of the same kept request are one card;
// and every empty duplicate can be deleted in one act, each checked by the
// server exactly as a single delete is.

const openRequest = (id) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'coa', request: id } }));

function Steps({ steps }) {
  return (
    <ul className="mt-1.5 space-y-0.5">
      {steps.map((s, i) => (
        <li key={s.key} className={`text-xs flex items-center gap-1.5 ${s.done ? 'text-green-700' : 'text-gray-600'}`}
          data-step={s.key} data-done={s.done ? '1' : '0'}>
          {s.done ? <CheckCircle2 size={13} /> : <span className="w-[13px] h-[13px] rounded-full border border-gray-300 inline-block" />}
          {i + 1}. {s.label}
        </li>
      ))}
    </ul>
  );
}

function Evidence({ evidence }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {(evidence || []).map((e, i) => e.kind === 'request' ? (
        <button key={i} type="button" onClick={() => openRequest(e.request_id)} className="text-powder-600 hover:underline">{e.label}</button>
      ) : e.kind === 'file' ? (
        <button key={i} type="button" data-evidence-file={e.file_id}
          onClick={() => downloadFile(`/coa/files/${e.file_id}/download`, e.label).catch(() => {})}
          className="text-powder-600 hover:underline">Lab report: {e.label}</button>
      ) : (
        <span key={i} className="text-gray-500">{e.label}</span>
      ))}
    </div>
  );
}

// One correction. Not a signature: the work is done on the request itself, so
// the row says what to do, why, what proves it, and ticks its own steps.
export function ActionRow({ r }) {
  const openLink = () => window.dispatchEvent(new CustomEvent('app-navigate', { detail: r.link }));
  const done = r.steps.filter(s => s.done).length;
  return (
    <li className="px-3 py-3" data-review-row={r.id} data-action-row={r.action_kind}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800" data-action-chip>{r.subtitle}</span>
            <p className="text-[15px] font-medium text-gray-900 leading-snug">{r.title}</p>
          </div>
          <p className="text-sm text-gray-800 mt-1" data-recommended>{r.recommended_action}</p>
          <p className="text-xs text-gray-500 mt-0.5">{r.reason}</p>
          {r.note && <p className="text-xs text-blue-700 mt-1" data-action-note>{r.note}</p>}
          <Steps steps={r.steps} />
          {r.blocked_by && <p className="text-xs text-amber-700 mt-1">{r.blocked_by}</p>}
          <Evidence evidence={r.evidence} />
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {r.steps.length > 0 && <span className="text-[10px] text-gray-400">{done} of {r.steps.length} done</span>}
          {r.link && !r.request_id ? (
            <button onClick={openLink} data-open-link={r.link.view}
              className="px-2.5 py-1 bg-powder-600 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1">
              Open COA <ExternalLink size={11} />
            </button>
          ) : (
            <button onClick={() => openRequest(r.request_id)} data-open-request={r.request_id}
              className="px-2.5 py-1 bg-powder-600 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1">
              Open request <ExternalLink size={11} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// Several empty copies of the same lab report: one card, one button.
function DuplicateGroup({ rows, onDelete }) {
  const first = rows[0];
  return (
    <li className="px-3 py-3" data-dup-group={first.group_key} data-dup-count={rows.length}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">{first.subtitle}</span>
            <p className="text-[15px] font-medium text-gray-900 leading-snug">{rows.length} empty copies of the same lab report</p>
          </div>
          <p className="text-sm text-gray-800 mt-1">
            The lab report is kept on <button type="button" onClick={() => openRequest(first.group_key.slice(6))}
              className="text-powder-600 hover:underline">{first.group_label}</button>. These copies have no results, no file and no signature.
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {rows.map(r => (
              <li key={r.id} className="text-xs text-gray-600 flex items-center gap-1.5" data-review-row={r.id}>
                <span className="w-[13px] h-[13px] rounded-full border border-gray-300 inline-block shrink-0" />
                <button type="button" onClick={() => openRequest(r.request_id)} className="hover:underline text-left">{r.request_label || r.title}</button>
              </li>
            ))}
          </ul>
        </div>
        <button onClick={() => onDelete(rows.map(r => r.request_id))} data-dup-delete-group={first.group_key}
          className="shrink-0 px-2.5 py-1 bg-red-600 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1">
          <Trash2 size={11} /> Delete these {rows.length}
        </button>
      </div>
    </li>
  );
}

// Empty copies of one kept request sit next to each other (the server sorts
// them that way); two or more become one card.
function toBlocks(rows) {
  const blocks = [];
  for (const r of rows) {
    const last = blocks[blocks.length - 1];
    if (r.group_key && last?.group_key === r.group_key) last.rows.push(r);
    else blocks.push({ key: r.group_key || r.id, group_key: r.group_key, rows: [r] });
  }
  return blocks;
}

const DEFAULT_REASON = 'Empty duplicates imported twice from one lab report; the report is kept on another request (decision A-20261027-001).';

function DeleteDialog({ plan, onClose, onDone }) {
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const n = plan.ready.length;
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const res = await withSignature((extra) => apiPost('/coa/corrections/duplicates/delete',
        { request_ids: plan.ready.map(r => r.request_id), reason, ...extra }),
      { title: `Delete ${n} empty duplicate${n === 1 ? '' : 's'}`, detail: 'COA corrections' });
      onDone(res);
    } catch (e) {
      if (!e?.cancelled) setError(e?.message || 'Could not delete them.');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" data-dup-dialog>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="font-semibold text-gray-900">Delete {n} empty duplicate{n === 1 ? '' : 's'}</p>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-4 py-3 space-y-3 text-sm">
          <p className="text-gray-700">Each one was checked just now: no results, no file, not signed, and its lab report is kept on another request.
            They are deleted together and each deletion is recorded with your name and this reason.</p>
          {plan.refused.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2" data-dup-refused={plan.refused.length}>
              <p className="text-xs font-semibold text-amber-800">{plan.refused.length} will be left alone:</p>
              <ul className="mt-1 text-xs text-amber-800 list-disc list-inside">
                {plan.refused.map(r => <li key={r.request_id}>{r.label}: {r.reason}</li>)}
              </ul>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Reason</span>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} id="dup-delete-reason"
              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300">Cancel</button>
          <button onClick={go} disabled={busy || !n || reason.trim().length < 3} data-dup-confirm
            className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white font-semibold disabled:opacity-50">
            {busy ? 'Deleting…' : `Delete ${n}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CoaCorrectionsList({ current, refresh }) {
  const items = useMemo(() => current?.items || [], [current]);
  const [kind, setKind] = useState('all');
  const [plan, setPlan] = useState(null);
  const [message, setMessage] = useState(null);

  // One chip per kind, in the order the server sorted them (most dangerous first).
  const chips = useMemo(() => {
    const m = new Map();
    for (const r of items) {
      const c = m.get(r.action_kind) || { kind: r.action_kind, label: r.subtitle, count: 0, risk: r.risk ?? 99 };
      c.count++; m.set(r.action_kind, c);
    }
    return [...m.values()].sort((a, b) => a.risk - b.risk);
  }, [items]);
  const shown = useMemo(() => (kind === 'all' ? items : items.filter(r => r.action_kind === kind)), [items, kind]);
  const blocks = useMemo(() => toBlocks(shown), [shown]);
  const view = useCappedList(blocks);
  const dupCount = items.filter(r => r.action_kind === 'DELETE_DUPLICATE').length;

  const askDelete = async (requestIds) => {
    setMessage(null);
    try {
      const p = await apiPost('/coa/corrections/duplicates/delete', { preview: true, ...(requestIds ? { request_ids: requestIds } : {}) });
      if (!p.ready.length) { setMessage({ tone: 'warn', text: p.refused.length ? `None can be deleted: ${p.refused[0].reason}` : 'There is nothing to delete.' }); return; }
      setPlan(p);
    } catch (e) { setMessage({ tone: 'warn', text: e?.message || 'Could not check the duplicates.' }); }
  };

  const done = (res) => {
    setPlan(null);
    const left = res?.refused?.length || 0;
    setMessage({ tone: 'ok', text: `Deleted ${res?.deleted || 0} empty duplicate${res?.deleted === 1 ? '' : 's'}.${left ? ` ${left} left alone.` : ''}` });
    refresh();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-action-source={current.key}>
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 space-y-2">
        <p className="text-xs text-gray-500">
          {current.count} corrections to make, most urgent first. Each is done on the request itself, and its steps tick themselves when the request changes.
        </p>
        <div className="flex flex-wrap gap-1.5" data-coa-chips>
          <Chip active={kind === 'all'} onClick={() => setKind('all')} label="All" count={items.length} />
          {chips.map(c => <Chip key={c.kind} active={kind === c.kind} onClick={() => setKind(c.kind)} label={c.label} count={c.count} dataKind={c.kind} />)}
        </div>
        {dupCount > 0 && (kind === 'all' || kind === 'DELETE_DUPLICATE') && (
          <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg bg-white border border-gray-200 px-3 py-2">
            <p className="text-xs text-gray-700">{dupCount} empty duplicate{dupCount === 1 ? '' : 's'} can be deleted in one step, with your password.</p>
            <button onClick={() => askDelete(null)} data-dup-delete-all
              className="px-2.5 py-1 bg-red-600 text-white text-xs font-semibold rounded-md inline-flex items-center gap-1">
              <Trash2 size={11} /> Delete all empty duplicates
            </button>
          </div>
        )}
        {message && <p className={`text-xs ${message.tone === 'ok' ? 'text-green-700' : 'text-amber-700'}`} data-dup-message>{message.text}</p>}
      </div>
      {blocks.length === 0 ? (
        <p className="text-center py-10 text-sm text-gray-400">Nothing pending here.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {view.items.map(b => (b.rows.length > 1
            ? <DuplicateGroup key={b.key} rows={b.rows} onDelete={askDelete} />
            : <ActionRow key={b.key} r={b.rows[0]} />))}
        </ul>
      )}
      <ShowMore view={view} noun="corrections" />
      {plan && <DeleteDialog plan={plan} onClose={() => setPlan(null)} onDone={done} />}
    </div>
  );
}

function Chip({ active, onClick, label, count, dataKind }) {
  return (
    <button type="button" onClick={onClick} data-coa-chip={dataKind || 'all'}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
        active ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
      {label} <span className={`tabular-nums ${active ? 'text-white/80' : 'text-gray-400'}`}>{count}</span>
    </button>
  );
}
