import { useState } from 'react';
import { useApiGet, apiPost, apiFetch, apiUpload } from '../../hooks/useApi';
import { ShieldCheck, AlertTriangle, Link2, FileText, Trash2, Search } from 'lucide-react';
import PhotoPicker from '../common/PhotoPicker.jsx';
import { openFile } from '../../lib/openFile.js';
import { formatDateTime } from '../../lib/datetime.js';

/**
 * Certificates of Compliance on one receipt (D-275).
 *
 * QA keeps the list of part numbers that need a CoC (packaging, gloves, poly
 * bags). A receiving line for one of them makes the certificate REQUIRED here,
 * and sign-off waits until each listed part has proof: the certificate that
 * came with this delivery (a photo or PDF), or the supplier's current one on
 * file in Supplier Qualification. The server decides; this renders what it says.
 */
export default function CocProofs({ inspectionNo, coc, locked, onChanged }) {
  const required = coc?.required || [];
  if (!required.length && !coc?.unchecked_lines) return null;
  const base = `/receiving/checklist/${encodeURIComponent(inspectionNo)}`;
  return (
    <div className="p-3 space-y-2 border-t border-gray-100" data-coc-section>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
        <ShieldCheck size={13} /> Certificates of Compliance
      </p>
      {required.length > 0 && (
        <p className="text-xs text-gray-600">
          QA lists {required.length === 1 ? 'this item' : 'these items'} as needing a CoC on every delivery.
          Sign-off waits until each one has proof.
        </p>
      )}
      {required.map(r => (
        <CocPart key={r.part_number} req={r} base={base} locked={locked}
          storage={coc?.storage_enabled} onChanged={onChanged} />
      ))}
      {coc?.unchecked_lines > 0 && (
        <p className="text-[11px] text-amber-800" data-coc-unchecked>
          {coc.unchecked_lines} line{coc.unchecked_lines === 1 ? '' : 's'} on this receipt {coc.unchecked_lines === 1 ? 'has' : 'have'} no
          part # — {coc.unchecked_lines === 1 ? 'it' : 'they'} cannot be checked against QA's CoC list.
        </p>
      )}
    </div>
  );
}

function CocPart({ req, base, locked, storage, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(false);
  const proved = req.status === 'proved';

  const attach = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('part_number', req.part_number);
      for (const f of files) fd.append('files', f);
      await apiUpload(`${base}/coc`, fd);
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const view = async (p) => {
    setError('');
    try {
      const { url } = await apiFetch(`/receiving/coc-proofs/${p.id}/url`);
      openFile({ url, name: p.filename });
    } catch (err) { setError(err.message); }
  };

  const remove = async (p) => {
    const reason = window.prompt('Why is this certificate being removed? It stays on the record.');
    if (reason == null) return;
    setError('');
    try {
      await apiFetch(`/receiving/coc-proofs/${p.id}`, { method: 'DELETE', body: { reason } });
      onChanged?.();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${proved ? 'border-green-200 bg-green-50/50' : 'border-amber-300 bg-amber-50'}`}
      data-coc-part={req.part_number} data-coc-status={req.status}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {req.part_number}{req.description ? <span className="font-normal text-gray-600"> — {req.description}</span> : ''}
          </p>
          <p className="text-[11px] text-gray-500">
            {req.lines.length} line{req.lines.length === 1 ? '' : 's'}
            {req.lines.some(l => l.vendor_lot) ? ` · Lot ${req.lines.map(l => l.vendor_lot).filter(Boolean).join(', ')}` : ''}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${proved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
          {proved ? <><ShieldCheck size={11} /> CoC on record</> : <><AlertTriangle size={11} /> CoC needed</>}
        </span>
      </div>

      {req.proofs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {req.proofs.map(p => (
            <li key={p.id} className="flex items-center gap-2 text-xs text-gray-700" data-coc-proof={p.source}>
              <FileText size={12} className="shrink-0 text-gray-400" />
              <button type="button" onClick={() => view(p)} className="text-powder-700 hover:underline truncate text-left">
                {p.filename || 'Certificate'}
              </button>
              <span className="text-gray-500 shrink-0">
                {p.source === 'on_file' ? `on file${p.expires_on ? `, expires ${p.expires_on}` : ', no expiry recorded'}` : 'with this delivery'}
                {' · '}{p.recorded_by}, {formatDateTime(p.created_at)}
              </span>
              {!locked && (
                <button type="button" onClick={() => remove(p)} title="Remove (needs a reason)"
                  className="ml-auto text-gray-400 hover:text-red-600 shrink-0" data-coc-remove>
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {storage ? (
              <PhotoPicker name="coc" accept="image/*,application/pdf" busy={busy} onChange={attach}
                takeLabel="Photograph the CoC" chooseLabel="Choose a photo or PDF" />
            ) : (
              <span className="text-[11px] text-gray-500">File storage is off — link the one on file instead.</span>
            )}
            <button type="button" onClick={() => setLinking(v => !v)} data-coc-link-open
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border border-gray-300 bg-white text-gray-700 hover:border-powder-400">
              <Link2 size={13} /> Link the one on file
            </button>
          </div>
          {linking && <OnFilePicker base={base} part={req.part_number} onLinked={() => { setLinking(false); onChanged?.(); }} />}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function OnFilePicker({ base, part, onLinked }) {
  const [q, setQ] = useState('');
  const { data: files } = useApiGet(`${base}/coc/on-file?q=${encodeURIComponent(q)}`, [q]);
  const [error, setError] = useState('');
  const link = async (f) => {
    setError('');
    try { await apiPost(`${base}/coc/on-file`, { part_number: part, supplier_file_id: f.id }); onLinked(); }
    catch (err) { setError(err.message); }
  };
  return (
    <div className="rounded-md border border-gray-200 bg-white p-2 space-y-1.5" data-coc-onfile>
      <label className="flex items-center gap-1.5 px-2 py-1 border border-gray-300 rounded-md">
        <Search size={13} className="text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Supplier or file name"
          className="flex-1 text-sm outline-none" data-coc-onfile-search />
      </label>
      {!files ? <p className="text-xs text-gray-400">Loading…</p> : files.length === 0 ? (
        <p className="text-xs text-gray-500">No certificate found in Supplier Qualification. Attach the one that came with the truck.</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto divide-y divide-gray-100">
          {files.map(f => (
            <li key={f.id} className="py-1.5 flex items-center gap-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="text-gray-900 truncate">{f.supplier_name} — {f.filename}</p>
                <p className={f.current ? 'text-gray-500' : 'text-red-700'}>
                  {f.expires_on ? `${f.current ? 'Expires' : 'Expired'} ${f.expires_on}` : 'No expiry recorded'}
                </p>
              </div>
              <button type="button" disabled={!f.current} onClick={() => link(f)} data-coc-onfile-link={f.id}
                className="px-2 py-1 rounded-md bg-powder-600 text-white font-semibold disabled:opacity-40 shrink-0">
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
