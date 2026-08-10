import { useState, useRef, useMemo } from 'react';
import { useApiGet, apiFetch, apiUpload, apiPost } from '../../hooks/useApi';
import { FileText, Upload, Trash2, Search, Sparkles, ExternalLink, AlertTriangle, Share2, Copy, X } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';
import { shareFile, canNativeShare } from '../../lib/shareFile.js';

/**
 * Manuals, spec sheets and parts lists attached to one machine.
 *
 * The text is pulled out of every upload so a search can find a part number
 * printed INSIDE the PDF — which is the actual question people have ("what
 * filter does this take?"). The extracted text never leaves the server; only
 * whether it worked, and a snippet around a hit.
 *
 * The comparison against the PM tasks SUGGESTS and never applies. A machine's
 * maintenance procedure rewritten by a model that read a PDF is exactly the
 * compliance record that must not change without a person, so the output is a
 * list to read with the manual quoted beside each item.
 */
const KINDS = [
  { value: 'manual', label: 'Manual' },
  { value: 'spec_sheet', label: 'Spec sheet' },
  { value: 'parts_list', label: 'Parts list' },
  { value: 'other', label: 'Other' },
];

const FREQ_TONE = 'bg-gray-100 text-gray-700';

// Attach an uploaded manual to more machines — one vacuum manual covers eleven
// identical vacuums, and re-uploading it per machine is what people were doing.
// Multi-select with a filter and select-all-filtered; the server re-references
// the same stored file (search included), nothing is uploaded twice.
function AttachToModal({ file, currentId, onClose, onDone }) {
  const { data: equipment } = useApiGet('/equipment');
  const [sel, setSel] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const list = useMemo(() => {
    const rows = (equipment || []).filter(e => e.id !== currentId && e.asset_kind !== 'zone');
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(e => [e.name, e.type, e.location, e.asset_id].some(v => v && String(v).toLowerCase().includes(needle)));
  }, [equipment, currentId, q]);

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allFiltered = list.length > 0 && list.every(e => sel.has(e.id));
  const toggleAll = () => setSel(s => {
    const n = new Set(s);
    if (allFiltered) list.forEach(e => n.delete(e.id));
    else list.forEach(e => n.add(e.id));
    return n;
  });

  const attach = async () => {
    setBusy(true); setError('');
    try {
      setResult(await apiPost(`/equipment/files/${file.id}/attach`, { equipment_ids: [...sel] }));
      onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm">Attach to other machines</h3>
            <p className="text-xs text-gray-500 truncate">{file.filename}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {result ? (
          <div className="space-y-2 text-center py-2">
            <Copy size={32} className="mx-auto text-green-600" />
            <p className="text-sm font-semibold text-gray-900">
              Attached to {result.attached} machine{result.attached === 1 ? '' : 's'}
              {result.skipped ? ` · ${result.skipped} already had it` : ''}
            </p>
            {result.machines?.length > 0 && <p className="text-xs text-gray-500">{result.machines.join(', ')}</p>}
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter machines…"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <button onClick={toggleAll} disabled={!list.length}
                className="px-2.5 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                {allFiltered ? 'Clear filtered' : `Select all (${list.length})`}
              </button>
            </div>
            <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-100">
              {list.length === 0 && <p className="text-xs text-gray-400 p-3">No machines match.</p>}
              {list.map(e => (
                <label key={e.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} className="rounded border-gray-300" />
                  <span className="text-gray-800 truncate">{e.name}</span>
                  <span className="text-[11px] text-gray-400 shrink-0 ml-auto">{e.location || e.type || ''}</span>
                </label>
              ))}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button onClick={attach} disabled={busy || sel.size === 0}
              className="w-full px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Attaching…' : `Attach to ${sel.size} machine${sel.size === 1 ? '' : 's'}`}
            </button>
            <p className="text-[11px] text-gray-400">
              The same file (and its searchable text) is referenced on each machine — nothing is uploaded twice.
              Removing it from one machine won't remove it from the others.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function EquipmentFiles({ equipmentId, equipmentName, canEdit }) {
  const { data: files, refresh } = useApiGet(equipmentId ? `/equipment/${equipmentId}/files` : null, [equipmentId]);
  const [kind, setKind] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [attachFor, setAttachFor] = useState(null); // file being attached to other machines
  const inputRef = useRef(null);

  const upload = async (list) => {
    if (!list?.length) return;
    setBusy(true); setError(''); setProgress(0);
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      fd.append('kind', kind);
      await apiUpload(`/equipment/${equipmentId}/files`, fd, 'POST', setProgress);
      refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setProgress(0); if (inputRef.current) inputRef.current.value = ''; }
  };

  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.filename}?`)) return;
    try { await apiFetch(`/equipment/files/${f.id}`, { method: 'DELETE' }); refresh(); }
    catch (e) { setError(e.message); }
  };

  const compare = async () => {
    setComparing(true); setError(''); setComparison(null);
    try { setComparison(await apiPost(`/equipment/${equipmentId}/files/compare-pm`, {})); }
    catch (e) { setError(e.message); }
    finally { setComparing(false); }
  };

  const list = files || [];
  const searchable = list.filter(f => f.searchable).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <FileText size={14} className="text-gray-400" /> Manuals &amp; documents
        </h4>
        {list.length > 0 && (
          <span className="text-xs text-gray-500">
            {list.length} file{list.length === 1 ? '' : 's'}{searchable ? ` · ${searchable} searchable` : ''}
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex items-center gap-1.5">
            <select value={kind} onChange={e => setKind(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white">
              {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input ref={inputRef} type="file" multiple className="hidden"
              onChange={e => upload([...(e.target.files || [])])} />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50">
              <Upload size={12} /> {busy ? `Uploading ${progress}%` : 'Upload'}
            </button>
          </div>
        )}
      </div>

      {list.length === 0 && (
        <p className="text-xs text-gray-400">
          No manual on file. Uploading one makes its text searchable — useful when you need a part number.
        </p>
      )}

      {list.map(f => (
        <div key={f.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-gray-200 bg-white">
          <FileText size={14} className="text-gray-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <a href={f.url} target="_blank" rel="noopener noreferrer"
                className="text-xs font-medium text-powder-700 hover:underline truncate">{f.filename}</a>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${FREQ_TONE}`}>
                {KINDS.find(k => k.value === f.kind)?.label || f.kind}
              </span>
              {/* An un-searchable file is still a manual; saying so beats
                  letting someone assume a search covered it. */}
              {!f.searchable && (
                <span className="text-[10px] text-amber-700">
                  {f.text_status === 'failed' ? 'text could not be read' : 'no searchable text'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400">
              {f.uploaded_by ? `${f.uploaded_by} · ` : ''}{formatDate(f.created_at)}
            </p>
          </div>
          {canNativeShare && (
            <button onClick={() => shareFile(f)} className="shrink-0 p-1 text-gray-400 hover:text-powder-600" title="Share">
              <Share2 size={13} />
            </button>
          )}
          <a href={f.url} target="_blank" rel="noopener noreferrer"
            className="shrink-0 p-1 text-gray-400 hover:text-powder-600" title="Open"><ExternalLink size={13} /></a>
          {canEdit && (
            <button onClick={() => setAttachFor(f)} className="shrink-0 p-1 text-gray-400 hover:text-powder-600"
              title="Attach to other machines">
              <Copy size={13} />
            </button>
          )}
          {canEdit && (
            <button onClick={() => remove(f)} className="shrink-0 p-1 text-gray-400 hover:text-red-500" title="Remove">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}

      {attachFor && (
        <AttachToModal file={attachFor} currentId={equipmentId}
          onClose={() => setAttachFor(null)} onDone={refresh} />
      )}

      {searchable > 0 && canEdit && (
        <div className="pt-1">
          <button type="button" onClick={compare} disabled={comparing}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50">
            <Sparkles size={12} /> {comparing ? 'Reading the manual…' : 'Check the manual against the PM tasks'}
          </button>
          <p className="text-[11px] text-gray-400 mt-1">
            Suggestions only — nothing is added to {equipmentName || 'this machine'}&apos;s tasks.
          </p>
        </div>
      )}

      {comparison && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2">
          <p className="text-xs text-violet-900">{comparison.summary}</p>
          {comparison.suggestions?.length === 0 && (
            <p className="text-xs text-gray-600">Nothing in the manual is missing from the written tasks.</p>
          )}
          {comparison.suggestions?.map((sug, i) => (
            <div key={i} className="rounded border border-violet-200 bg-white p-2">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-900">{sug.task}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-800">
                  {sug.frequency === 'unspecified' ? 'no frequency given' : sug.frequency}
                </span>
              </div>
              {/* The quote is the point — an unsourced suggestion can't be
                  checked, and therefore can't be acted on. */}
              <p className="text-[11px] text-gray-500 mt-1 italic">“{sug.evidence}”</p>
            </div>
          ))}
          <p className="text-[11px] text-gray-500">
            Read from {comparison.compared_files?.join(', ')}. Add anything worth keeping to the maintenance
            tasks yourself — this never edits them.
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{error}</p>
      )}
    </div>
  );
}

/** Search inside every manual at once — "which filter does the auger take?" */
export function ManualSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const query = q.trim();
    if (query.length < 2) return;
    setBusy(true);
    try { setResults(await apiFetch(`/equipment/files/search?q=${encodeURIComponent(query)}`)); }
    catch { setResults({ results: [] }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }}
            placeholder="Search inside the manuals — a part number, a filter size…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <button onClick={run} disabled={busy || q.trim().length < 2}
          className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {results && results.results.length === 0 && (
        <p className="text-xs text-gray-500">Nothing found in the uploaded manuals.</p>
      )}
      {results?.results.map(r => (
        <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{r.equipment_name}</span>
            <span className="text-[11px] text-gray-500">{r.filename}</span>
            <span className="text-[10px] text-gray-400">{r.hits} hit{r.hits === 1 ? '' : 's'}</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{r.snippet}</p>
        </div>
      ))}
    </div>
  );
}
