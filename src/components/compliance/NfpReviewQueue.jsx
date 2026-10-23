import { useState } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature';
import { AlertTriangle, CheckCircle2, Undo2, FileText, Link2 } from 'lucide-react';
import { FIELD_LABEL } from '../../../shared/panel-reconcile.js';
import { FORMULA_SOURCE_LABEL } from '../../../shared/panel-provenance.js';
import { openFile } from '../../lib/openFile';

/**
 * The nutrition-panel review queue (D-173).
 *
 * ONE SCREEN for what is waiting on a person: every panel a bot or a colleague
 * marked ready for review, grouped by product family then SKU, each row only
 * the fields that changed from the approved panel, the source of its values
 * and its flags. Approve or send back per row; bulk approve takes only the
 * rows with zero flags — the server applies the same rule, so the button
 * cannot offer what the gate refuses.
 *
 * A second bucket names the products with no approved panel at all. The
 * open-draft count says how much is still being worked on and is not yet here.
 */
const fmt = (x) => (x === null || x === undefined || x === '' ? '—' : String(x));

function Flag({ f }) {
  return (
    <li data-queue-flag={f.key} className={`text-[11px] ${f.blocking ? 'text-red-800' : 'text-amber-800'}`}>
      {f.blocking ? '⛔' : '⚠'} {f.label}
    </li>
  );
}

function SendBack({ row, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { await apiFetch(`/nfp/${row.id}/send-back`, { method: 'POST', body: { note } }); onDone(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5" data-queue-sendback={row.id}>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs changing (required)"
        className="border border-gray-300 rounded px-2 py-1 text-xs w-64" data-queue-sendback-note />
      <button type="button" onClick={go} disabled={busy || note.trim().length < 3}
        className="px-2 py-1 border border-red-300 text-red-800 rounded text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1" data-queue-sendback-go>
        <Undo2 size={12} /> {busy ? 'Saving…' : 'Send back'}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function Row({ row, selected, onSelect, onChanged, onOpenSku }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const approve = async () => {
    setBusy('approve'); setError('');
    try {
      await withSignature((extra) => apiFetch(`/nfp/${row.id}/decide`, { method: 'POST', body: { decision: 'approved', ...extra } }),
        { title: 'Approve this nutrition panel', detail: `${row.sku} ${row.version}` });
      onChanged();
    } catch (e) { if (!e?.cancelled) setError(e.data?.error || e.message); }
    setBusy('');
  };
  const prov = row.provenance || {};
  const sourceSystem = prov.source_system && prov.source_system !== 'unknown' ? (FORMULA_SOURCE_LABEL[prov.source_system] || prov.source_system) : null;
  return (
    <div className={`border-t border-gray-100 px-3 py-2 ${row.review_ready ? '' : 'bg-amber-50/40'}`}
      data-queue-row={row.id} data-queue-sku={row.sku} data-queue-ready={row.review_ready ? '1' : '0'}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={selected} disabled={!row.review_ready}
          onChange={(e) => onSelect(row.id, e.target.checked)} data-queue-select={row.id}
          title={row.review_ready ? 'Select for bulk approve' : 'Has flags — review it on its own'} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <button type="button" onClick={() => onOpenSku?.(row.sku)} className="text-xs font-medium text-powder-700 hover:underline">
              <code>{row.sku}</code>
            </button>
            <span className="text-sm text-gray-800 truncate">{row.flavor}</span>
            <span className="text-xs text-gray-500">{row.pack} · panel {row.version}{row.approved_version ? ` (replaces ${row.approved_version})` : ' (first panel)'}</span>
            <span className="text-[11px] text-gray-400">ready by {row.ready_by || '—'}{row.ready_at ? ` · ${row.ready_at.slice(0, 16)}` : ''}</span>
          </div>

          {/* Only what changed. A full panel on every row is forty lines nobody reads. */}
          {row.changes.length === 0 ? (
            <p className="text-[11px] text-gray-500 mt-0.5" data-queue-nochange>No values differ from the approved panel.</p>
          ) : (
            <table className="mt-1 text-xs" data-queue-changes>
              <tbody>
                {row.changes.map((c) => (
                  <tr key={c.field} data-queue-change={c.field}>
                    <td className="pr-3 py-0.5 text-gray-600">{c.label || FIELD_LABEL[c.field] || c.field}</td>
                    <td className="pr-2 py-0.5 text-gray-400 line-through decoration-gray-300">{fmt(c.approved)}</td>
                    <td className="py-0.5 font-medium text-gray-900">→ {fmt(c.draft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-[11px] text-gray-600 mt-1" data-queue-source>
            <span className="font-medium">Values from:</span> {row.source_ref ? `${row.source_ref}${row.source_by ? ` · ${row.source_by}` : ''}` : <span className="italic">not recorded</span>}
            {' · '}
            <span className="font-medium">Formula:</span> {prov.formula_ref ? `${prov.formula_ref}${prov.formula_version ? ` ${prov.formula_version}` : ''}` : <span className="italic">not recorded</span>}
            {prov.bom_fill_weight_g != null && ` @ ${prov.bom_fill_weight_g} g`}
            {prov.fill_per_serving_g != null && ` (${prov.fill_per_serving_g} g / serving)`}
            {sourceSystem && <span className="text-gray-500"> · {sourceSystem}</span>}
            {row.files.length > 0 && row.files.map((f) => (
              <button key={f.id} type="button" onClick={() => apiFetch(`/nfp/files/${f.id}`).then((d) => openFile({ url: d.url, name: f.filename }))}
                className="ml-2 text-powder-700 hover:underline inline-flex items-center gap-0.5"><FileText size={11} /> {f.filename}</button>
            ))}
            {row.drive_url && <a href={row.drive_url} target="_blank" rel="noreferrer" className="ml-2 text-powder-700 hover:underline inline-flex items-center gap-0.5"><Link2 size={11} /> Drive</a>}
          </p>

          {row.flags.length > 0 && <ul className="mt-1 space-y-0.5" data-queue-flags>{row.flags.map((f) => <Flag key={f.key} f={f} />)}</ul>}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={approve} disabled={busy === 'approve' || row.flags.some((f) => f.blocking)}
              className="px-2 py-1 border border-green-300 text-green-800 rounded text-xs font-medium disabled:opacity-40 inline-flex items-center gap-1" data-queue-approve={row.id}>
              <CheckCircle2 size={12} /> {busy === 'approve' ? 'Saving…' : 'Approve'}
            </button>
            <button type="button" onClick={() => setSendingBack((x) => !x)}
              className="px-2 py-1 border border-gray-300 text-gray-700 rounded text-xs" data-queue-sendback-open={row.id}>
              Send back…
            </button>
            {error && <span className="text-xs text-red-700" data-queue-error>{error}</span>}
          </div>
          {sendingBack && <SendBack row={row} onDone={() => { setSendingBack(false); onChanged(); }} />}
        </div>
      </div>
    </div>
  );
}

/** The backfill bucket (D-174): what an approved panel's file says, waiting on a person. */
function ProposedRow({ p, canManage, onDone }) {
  const [note, setNote] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (path, body) => {
    setBusy(true); setError('');
    try { await apiFetch(path, { method: 'POST', body }); onDone(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <li className="px-3 py-2 border-b border-gray-100 last:border-0 space-y-1" data-queue-proposed-row={p.sku}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <code className="font-medium text-gray-900">{p.sku}</code>
        <span className="text-gray-600">{p.version}</span>
        {p.nothing_read ? (
          <span className="text-amber-800" data-queue-proposed-empty>nothing read from the file{p.extract_status && p.extract_status !== 'ok' ? ` (${p.extract_status})` : ''}</span>
        ) : (
          <span className="text-gray-700">
            <span data-queue-proposed-fills>{p.fills.length}</span> blank field{p.fills.length === 1 ? '' : 's'} the file can fill
            {p.conflicts.length > 0 && <> · <span className="text-amber-800" data-queue-proposed-conflicts>{p.conflicts.length} where the file disagrees (left alone)</span></>}
          </span>
        )}
        {canManage && !dismissing && (
          <span className="ml-auto inline-flex gap-1">
            <button type="button" disabled={busy} data-queue-proposed-confirm onClick={() => act(`/nfp/proposed/${p.id}/confirm`, {})}
              className="px-2 py-0.5 rounded bg-powder-600 text-white hover:bg-powder-700 disabled:opacity-50">
              {p.fills.length ? `Confirm — fill ${p.fills.length}` : 'Confirm — nothing to fill'}
            </button>
            <button type="button" disabled={busy} data-queue-proposed-dismiss-open onClick={() => setDismissing(true)}
              className="px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Dismiss…</button>
          </span>
        )}
      </div>
      {p.fills.length > 0 && (
        <ul className="text-[11px] text-gray-600 flex flex-wrap gap-x-3">
          {p.fills.map((f) => <li key={f.field} data-queue-proposed-fill={f.field}>{f.label}: <strong>{String(f.value)}</strong></li>)}
        </ul>
      )}
      {p.conflicts.length > 0 && (
        <ul className="text-[11px] text-amber-800 flex flex-wrap gap-x-3">
          {p.conflicts.map((c) => <li key={c.field} data-queue-proposed-conflict={c.field}>{c.label}: file {String(c.file)} · approved {String(c.stored)}</li>)}
        </ul>
      )}
      {dismissing && (
        <div className="flex gap-1 items-center">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the file's values are not taken"
            data-queue-proposed-note className="text-xs border border-gray-300 rounded px-2 py-1 flex-1" />
          <button type="button" disabled={busy || note.trim().length < 3} data-queue-proposed-dismiss onClick={() => act(`/nfp/proposed/${p.id}/dismiss`, { note })}
            className="text-xs px-2 py-1 rounded bg-gray-800 text-white disabled:opacity-50">Dismiss</button>
          <button type="button" onClick={() => setDismissing(false)} className="text-xs text-gray-500">Cancel</button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </li>
  );
}

export default function NfpReviewQueue({ canManage, isAdmin, onOpenSku, onChanged }) {
  const { data, refresh } = useApiGet('/nfp/review-queue');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [backfill, setBackfill] = useState(null);
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const changed = () => { refresh(); onChanged?.(); };
  const counts = data.counts || {};
  const groups = data.groups || [];
  const readyIds = groups.flatMap((g) => g.rows.filter((r) => r.review_ready).map((r) => r.id));
  const onSelect = (id, on) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const selectAll = () => setSelected(new Set(readyIds));
  const runBackfill = async () => {
    setBusy(true); setError(''); setBackfill(null);
    try { const r = await apiFetch('/nfp/backfill-extract', { method: 'POST', body: { limit: 25 } }); setBackfill(r); changed(); }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  const bulk = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await withSignature((extra) => apiFetch('/nfp/review-queue/approve', { method: 'POST', body: { ids: [...selected], ...extra } }),
        { title: `Approve ${selected.size} nutrition panel${selected.size === 1 ? '' : 's'}` });
      setResult(r); setSelected(new Set()); changed();
    } catch (e) { if (!e?.cancelled) setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="space-y-4" data-nfp-queue>
      <p className="text-sm text-gray-600 max-w-2xl">
        Panels marked ready for review, grouped by product family. Each row shows only what changed from the
        approved panel, where the values came from, and anything a reviewer has to look at. Approving one
        supersedes the previous approved panel. A bot cannot approve.
      </p>

      <div className="flex flex-wrap gap-2 text-xs" data-queue-counts>
        <span className="px-2 py-1 rounded bg-powder-50 text-powder-800" data-queue-count="ready">{counts.ready ?? 0} ready for review</span>
        <span className="px-2 py-1 rounded bg-green-50 text-green-800" data-queue-count="unflagged">{counts.unflagged ?? 0} with no flags</span>
        <span className="px-2 py-1 rounded bg-amber-50 text-amber-800" data-queue-count="flagged">{counts.flagged ?? 0} flagged</span>
        <span className="px-2 py-1 rounded bg-gray-100 text-gray-700" data-queue-count="open_drafts">{counts.open_drafts ?? 0} open drafts still being worked</span>
        <span className="px-2 py-1 rounded bg-red-50 text-red-800" data-queue-count="missing_panel">{counts.missing_panel ?? 0} with no approved panel</span>
        <span className="px-2 py-1 rounded bg-blue-50 text-blue-800" data-queue-count="proposed">{counts.proposed ?? 0} approved panels to confirm from their file</span>
      </div>

      {canManage && readyIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-queue-bulk>
          <button type="button" onClick={selectAll} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" data-queue-select-all>
            Select all unflagged ({readyIds.length})
          </button>
          <button type="button" onClick={bulk} disabled={busy || selected.size === 0}
            className="px-2.5 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium disabled:opacity-40" data-queue-bulk-approve>
            {busy ? 'Approving…' : `Approve ${selected.size} selected`}
          </button>
          <span className="text-[11px] text-gray-500">Only rows with zero flags can be selected; a flagged row is reviewed on its own.</span>
        </div>
      )}
      {error && <p className="text-xs text-red-700 bg-red-50 rounded p-2">{error}</p>}
      {result && (
        <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded p-2" data-queue-bulk-result>
          Approved {result.approved?.length || 0}{result.skipped?.length ? `; skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.sku || s.id} (${s.reason})`).join(', ')}` : ''}.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-gray-500" data-queue-empty>Nothing is waiting for review.</p>
      ) : groups.map((g) => (
        <div key={g.family} className="border border-gray-200 rounded-lg overflow-hidden" data-queue-group={g.family}>
          <div className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-800">{g.family} <span className="font-normal text-gray-500">· {g.rows.length}</span></div>
          {g.rows.map((row) => (
            <Row key={row.id} row={row} selected={selected.has(row.id)} onSelect={onSelect} onChanged={changed} onOpenSku={onOpenSku} />
          ))}
        </div>
      ))}

      <div data-queue-proposed>
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-1">
          <FileText size={15} className="text-blue-600" /> Approved panels to confirm from their file ({data.proposed?.length || 0})
        </h4>
        <p className="text-xs text-gray-600 mb-1.5">
          What the reader found in each approved panel's file. Confirming fills only the fields the approved panel left blank; a
          value already on the panel is never overwritten, and a disagreement is listed, not applied — a correction is the next version.
          {counts.backfill_remaining > 0 && <> <span data-queue-backfill-remaining>{counts.backfill_remaining}</span> approved panel file{counts.backfill_remaining === 1 ? '' : 's'} not read yet.</>}
        </p>
        {isAdmin && counts.backfill_remaining > 0 && (
          <button type="button" disabled={busy} data-queue-backfill onClick={runBackfill}
            className="text-xs px-2.5 py-1 rounded border border-powder-300 text-powder-800 hover:bg-powder-50 mb-2 disabled:opacity-50">
            Read the next {Math.min(25, counts.backfill_remaining)} approved panel files
          </button>
        )}
        {backfill && <p className="text-xs text-gray-700 mb-1.5" data-queue-backfill-result>Read {backfill.read.length}; {backfill.remaining} left to read; {backfill.pending} waiting to confirm.</p>}
        {(data.proposed || []).length === 0 ? (
          <p className="text-sm text-gray-500" data-queue-proposed-empty-list>Nothing waiting to be confirmed.</p>
        ) : (
          <ul className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
            {data.proposed.map((p) => <ProposedRow key={p.id} p={p} canManage={canManage} onDone={changed} />)}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-1">
          <AlertTriangle size={15} className="text-amber-600" /> Missing panel ({data.missing_panel?.length || 0})
        </h4>
        <p className="text-xs text-gray-600 mb-1.5">Products with no approved panel. Artwork for these cannot be released to print.</p>
        {(data.missing_panel || []).length === 0 ? (
          <p className="text-sm text-gray-500">Every active product has an approved panel.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto" data-queue-missing>
            {data.missing_panel.map((p) => (
              <button key={p.sku} type="button" onClick={() => onOpenSku?.(p.sku)} data-queue-missing-row={p.sku}
                className="w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <code className="text-xs font-medium text-gray-900 w-28 shrink-0 truncate">{p.sku}</code>
                <span className="text-sm text-gray-700 flex-1 truncate">{p.flavor}</span>
                <span className="text-xs text-gray-400 shrink-0">{p.family_key}</span>
                <span className="text-[11px] text-gray-500 shrink-0">{p.open_status ? `draft ${p.open_status.replace(/_/g, ' ')}` : 'no draft'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
