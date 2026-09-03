import { Fragment, useState, useMemo, useEffect } from 'react';
import { useApiGet, apiFetch, apiUpload } from '../../hooks/useApi';
import ProductFileImport from './ProductFileImport.jsx';
import { useAuth } from '../../hooks/useAuth';
import {
  Image as ImageIcon, Search, X, AlertTriangle, CheckCircle2, XCircle,
  FileText, Upload, ExternalLink, ShieldAlert,
} from 'lucide-react';

/**
 * Artwork — what is on the pack, which revision it is, and whether it checks out.
 *
 * A grid rather than a table: the whole point of this screen is seeing the
 * actual pack. A row of filenames is what the Drive folder already gives you.
 */

const STATUS = {
  draft: { label: 'Draft', style: 'bg-gray-100 text-gray-700' },
  in_review: { label: 'In review', style: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Approved', style: 'bg-teal-100 text-teal-800' },
  print_ready: { label: 'Print ready', style: 'bg-green-100 text-green-800' },
  superseded: { label: 'Superseded', style: 'bg-gray-100 text-gray-500' },
  rejected: { label: 'Rejected', style: 'bg-red-100 text-red-800' },
};

const NEXT_LABEL = {
  in_review: 'Send for review', approved: 'Approve', print_ready: 'Release to print',
  rejected: 'Reject', draft: 'Back to draft', superseded: 'Supersede',
};

/** Presigned URLs are short-lived, so they are fetched per file, on render. */
function useFileUrl(fileId) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!fileId) return undefined;
    let dead = false;
    apiFetch(`/artwork/files/${fileId}`)
      .then((r) => { if (!dead) setUrl(r.url); })
      .catch(() => {});
    return () => { dead = true; };
  }, [fileId]);
  return url;
}

function Thumb({ version }) {
  const preview = version.files?.find((f) => f.kind === 'preview');
  const url = useFileUrl(preview?.id);
  if (!preview) {
    return (
      <div className="aspect-[3/4] bg-gray-50 border-b border-gray-200 grid place-items-center text-gray-300">
        <ImageIcon size={28} />
      </div>
    );
  }
  return (
    <div className="aspect-[3/4] bg-gray-50 border-b border-gray-200 overflow-hidden">
      {url
        ? <img src={url} alt="" className="w-full h-full object-contain" loading="lazy" />
        : <div className="w-full h-full animate-pulse bg-gray-100" />}
    </div>
  );
}

function SnapshotDetails({ versionId }) {
  const [snap, setSnap] = useState(null);
  const [open, setOpen] = useState(false);
  const load = async () => {
    setOpen((o) => !o);
    if (snap) return;
    try { const v = await apiFetch(`/artwork/versions/${versionId}`); setSnap(v.snapshot || {}); } catch { setSnap({}); }
  };
  const rows = snap ? Object.entries(snap) : [];
  return (
    <div className="text-xs" data-artwork-snapshot>
      <button type="button" onClick={load} className="text-powder-700 underline">
        {open ? 'Hide' : 'Show'} label content as proofed
      </button>
      {open && snap && (
        <dl className="mt-1.5 grid sm:grid-cols-[9rem_1fr] gap-x-3 gap-y-1 border border-gray-200 rounded-lg p-2 bg-gray-50">
          {rows.length === 0 && <dd className="text-gray-500 sm:col-span-2">Nothing recorded on this snapshot.</dd>}
          {rows.map(([k, val]) => (
            <Fragment key={k}>
              <dt className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</dt>
              <dd className="text-gray-800 whitespace-pre-line break-words">{Array.isArray(val) ? val.join(', ') : typeof val === 'object' && val ? JSON.stringify(val) : String(val ?? '')}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

function CheckRow({ check, canEdit, onChanged }) {
  const [busy, setBusy] = useState(false);
  const icon = {
    pass: <CheckCircle2 size={14} className="text-green-600 shrink-0" />,
    fail: <XCircle size={14} className="text-red-600 shrink-0" />,
    warn: <AlertTriangle size={14} className="text-amber-500 shrink-0" />,
    dismissed: <CheckCircle2 size={14} className="text-gray-400 shrink-0" />,
  }[check.result];

  const dismiss = async () => {
    const reason = window.prompt(`Why is "${check.check_name}" acceptable?\n\nThis note stays on the record.`);
    if (!reason?.trim()) return;
    setBusy(true);
    try { await apiFetch(`/artwork/checks/${check.id}/dismiss`, { method: 'POST', body: { reason } }); onChanged(); }
    catch (e) { window.alert(e.message); }
    setBusy(false);
  };

  return (
    <li className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
      {icon}
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${check.result === 'dismissed' ? 'text-gray-500' : 'text-gray-900'}`}>
          {check.check_name}
        </p>
        {check.detail && <p className="text-xs text-gray-500">{check.detail}</p>}
        {(check.expected || check.found) && (
          <p className="text-xs text-gray-500">
            expected <code>{check.expected || '—'}</code> · found <code>{check.found || '—'}</code>
          </p>
        )}
        {check.result === 'dismissed' && (
          <p className="text-xs text-gray-500 italic">
            Waved through by {check.dismissed_by}: {check.dismissed_reason}
          </p>
        )}
      </div>
      {check.result === 'fail' && canEdit && (
        <button onClick={dismiss} disabled={busy}
          className="text-xs text-gray-500 underline shrink-0 disabled:opacity-50">Accept anyway</button>
      )}
    </li>
  );
}

const FLOW = {
  draft: ['in_review', 'rejected'],
  in_review: ['approved', 'rejected', 'draft'],
  approved: ['print_ready', 'rejected'],
  print_ready: [],
  rejected: ['draft'],
  superseded: [],
};

function VersionDetail({ sku, onClose, onChanged }) {
  const { user } = useAuth();
  const { data, refresh } = useApiGet(`/artwork/sku/${encodeURIComponent(sku)}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadFor, setUploadFor] = useState(null);

  const canEdit = ['admin', 'supervisor'].includes(user?.role)
    || ['qa', 'quality'].includes((user?.department || '').toLowerCase());

  const versions = data?.versions || [];
  const product = data?.product;

  const move = async (v, status) => {
    setBusy(true); setError('');
    try {
      await apiFetch(`/artwork/versions/${v.id}/status`, { method: 'POST', body: { status } });
      refresh(); onChanged?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const addVersion = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch('/artwork', { method: 'POST', body: { sku, component: 'primary' } });
      refresh(); onChanged?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const upload = async (versionId, file, kind) => {
    const fd = new FormData();
    fd.append('files', file);
    fd.append('kind', kind);
    try { await apiUpload(`/artwork/versions/${versionId}/files`, fd); refresh(); }
    catch (e) { setError(e.message); }
    setUploadFor(null);
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-2xl h-full overflow-y-auto p-5 space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">{product?.category}</p>
            <h3 className="text-lg font-bold text-gray-900">{product?.flavor || sku}</h3>
            <code className="text-sm text-gray-600">{sku}</code>
            {product?.gtin && <span className="ml-2 text-sm text-gray-500">{product.gtin}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        {error && <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

        {product && !product.nfp_approved_at && (
          <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              No approved NFP on this product. Artwork can be reviewed, but it cannot be
              released to print until the panel is approved.
            </span>
          </p>
        )}

        {canEdit && (
          <button onClick={addVersion} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
            <Upload size={14} /> New version
          </button>
        )}

        {versions.length === 0 && (
          <p className="text-sm text-gray-500">
            No artwork on file. Versions appear here automatically once a file goes
            through proofing, or start one manually above.
          </p>
        )}

        {versions.map((v) => (
          <div key={v.id} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">v{v.version}</span>
                {v.component !== 'primary' && <span className="text-xs text-gray-500">{v.component}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[v.status]?.style}`}>
                  {STATUS[v.status]?.label || v.status}
                </span>
                {v.source === 'proofing' && <span className="text-xs text-gray-500">from proofing</span>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {v.failures > 0 && <span className="text-red-700 font-medium">{v.failures} failing</span>}
                {v.warnings > 0 && <span className="text-amber-700">{v.warnings} warning</span>}
              </div>
            </div>

            <div className="p-3 space-y-3">
              {v.checks?.length > 0 ? (
                <ul>
                  {v.checks.map((c) => (
                    <CheckRow key={c.id} check={c} canEdit={canEdit} onChanged={refresh} />
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-500">No checks recorded on this version.</p>}

              {v.files?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {v.files.map((f) => (
                    <button key={f.id}
                      onClick={async () => {
                        try {
                          const { url } = await apiFetch(`/artwork/files/${f.id}`);
                          window.open(url, '_blank', 'noopener');
                        } catch (e) { setError(e.message); }
                      }}
                      className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50">
                      <FileText size={12} /> {f.filename}
                    </button>
                  ))}
                </div>
              )}

              {v.drive_url && (
                <a href={v.drive_url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-powder-700 underline">
                  <ExternalLink size={12} /> Open in Drive
                </a>
              )}

              {/* What the proofing run saw on the label, as sent — the record a
                  later re-proof compares against. Frozen with the version. */}
              {v.has_snapshot && <SnapshotDetails versionId={v.id} />}

              {canEdit && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {(FLOW[v.status] || []).map((s) => (
                    <button key={s} onClick={() => move(v, s)} disabled={busy}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
                        s === 'print_ready'
                          ? 'bg-powder-600 text-white hover:bg-powder-700'
                          : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                      {NEXT_LABEL[s]}
                    </button>
                  ))}
                  {['draft', 'in_review'].includes(v.status) && (
                    <label className="text-xs text-gray-600 underline cursor-pointer">
                      Attach a file
                      <input type="file" className="hidden"
                        onChange={(e) => e.target.files?.[0] && upload(v.id, e.target.files[0], 'print_pdf')} />
                    </label>
                  )}
                </div>
              )}

              {v.approved_by && (
                <p className="text-xs text-gray-500">
                  {v.status === 'print_ready' ? 'Released' : 'Approved'} by {v.approved_by}
                  {v.approved_at ? ` on ${v.approved_at.slice(0, 10)}` : ''}
                </p>
              )}
            </div>
          </div>
        ))}
        {uploadFor && null}
      </div>
    </div>
  );
}

export default function ArtworkPanel() {
  const { data, refresh } = useApiGet('/artwork');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null);
  const [showMissing, setShowMissing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const { user } = useAuth();
  const canManage = ['admin', 'supervisor'].includes(user?.role)
    || ['qa', 'quality'].includes((user?.department || '').toLowerCase());

  const packs = useMemo(() => data?.packs || [], [data]);
  const missing = useMemo(() => data?.missing || [], [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return packs.filter((v) => {
      if (status && v.status !== status) return false;
      if (!needle) return true;
      return [v.sku, v.flavor, v.gtin, v.category].some((x) => (x || '').toLowerCase().includes(needle));
    });
  }, [packs, q, status]);

  const failing = packs.filter((v) => v.failures > 0).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ImageIcon size={20} className="text-powder-600" /> Artwork
        </h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          What is on the pack, which revision it is, and whether it checks out against
          the master list. Versions file themselves when a proofing job finishes.
        </p>
        {canManage && !showImport && (
          <button type="button" onClick={() => setShowImport(true)}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            <Upload size={14} /> Import from a folder
          </button>
        )}
      </div>

      {/* Same importer as the panels — the job is identical, and Shaun's
          finished files live in a Drive folder the same way. */}
      {canManage && showImport && (
        <ProductFileImport target="artwork" title="Import artwork from a folder"
          onDone={() => { refresh(); setShowImport(false); }} />
      )}

      {failing > 0 && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span><strong>{failing}</strong> pack{failing === 1 ? '' : 's'} with a failing check.</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKU, flavour, GTIN"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {missing.length > 0 && (
          <button onClick={() => setShowMissing((v) => !v)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${showMissing
              ? 'bg-amber-100 border-amber-300 text-amber-900'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            No artwork on file <span className="tabular-nums">{missing.length}</span>
          </button>
        )}
      </div>

      {showMissing ? (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {missing.map((p) => (
            <button key={p.sku} onClick={() => setOpen(p.sku)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-3">
              <span><code className="text-gray-900">{p.sku}</code> <span className="text-gray-600">{p.flavor}</span></span>
              <span className="text-xs text-gray-400">{p.category}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500">{filtered.length} of {packs.length}</p>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">
              Nothing yet. Artwork appears here once a proofing job files a version.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((v) => (
                <button key={v.id} onClick={() => setOpen(v.sku)}
                  className="text-left border border-gray-200 rounded-xl overflow-hidden hover:border-powder-400 hover:shadow-sm transition">
                  <Thumb version={v} />
                  <div className="p-2.5 space-y-1">
                    <p className="text-sm font-medium text-gray-900 leading-tight line-clamp-2">{v.flavor}</p>
                    <code className="text-xs text-gray-500 block">{v.sku}</code>
                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS[v.status]?.style}`}>
                        {STATUS[v.status]?.label} · v{v.version}
                      </span>
                      {v.failures > 0 && (
                        <span className="text-xs text-red-700 font-medium">{v.failures}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {open && <VersionDetail sku={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  );
}
