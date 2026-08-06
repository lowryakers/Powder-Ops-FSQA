import { useState, useRef } from 'react';
import { useApiGet, apiFetch, apiUpload, apiPost } from '../../hooks/useApi';
import { FileText, Upload, Trash2, Search, Sparkles, ExternalLink, AlertTriangle } from 'lucide-react';

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

export default function EquipmentFiles({ equipmentId, equipmentName, canEdit }) {
  const { data: files, refresh } = useApiGet(equipmentId ? `/equipment/${equipmentId}/files` : null, [equipmentId]);
  const [kind, setKind] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(null);
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
              {f.uploaded_by ? `${f.uploaded_by} · ` : ''}{(f.created_at || '').slice(0, 10)}
            </p>
          </div>
          <a href={f.url} target="_blank" rel="noopener noreferrer"
            className="shrink-0 p-1 text-gray-400 hover:text-powder-600" title="Open"><ExternalLink size={13} /></a>
          {canEdit && (
            <button onClick={() => remove(f)} className="shrink-0 p-1 text-gray-400 hover:text-red-500" title="Remove">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ))}

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
