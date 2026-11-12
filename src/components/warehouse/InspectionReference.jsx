import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { FileText, ExternalLink, AlertTriangle, CheckCircle2, Search, X, Eye } from 'lucide-react';
import { openFile } from '../../lib/openFile';
import { pdfViewerUrl } from '../../lib/pdfUrl';
import { externalUrl } from '../../lib/externalUrl';
import { formatDate } from '../../lib/datetime.js';

/**
 * The product's specification and artwork, beside an open FORM 418-01 sheet
 * (D-348). QA used to run the inspection with Artwork in one window and
 * Receiving in another, or do it on paper and key it in afterwards.
 *
 * READ-ONLY, AND NOTHING IS COPIED ONTO THE SHEET. The sheet stores which SKU it
 * is for; every open reads the spec, colours, artwork and approved panel as they
 * stand (GET /film-inspection/:id/reference). A file opens in the in-app viewer
 * on top of the sheet, and closing it lands back on the question you were on —
 * answers save as they are tapped, so nothing is lost either way.
 */

const STATUS = {
  print_ready: { label: 'Released to print', cls: 'bg-green-100 text-green-800' },
  approved: { label: 'Approved — not yet released', cls: 'bg-amber-100 text-amber-800' },
  in_review: { label: 'In review — NOT released', cls: 'bg-red-100 text-red-800' },
  draft: { label: 'Draft — NOT released', cls: 'bg-red-100 text-red-800' },
};
const FILE_LABEL = { print_pdf: 'Print file', dieline: 'Dieline', proof_report: 'Proof report', other: 'File' };
const isPdf = (f) => /pdf/i.test(f?.content_type || '') || /\.pdf$/i.test(f?.filename || '');

function Fact({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-2 text-xs py-0.5">
      <span className="w-32 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-900 min-w-0 break-words">{value}</span>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <section className="border-b border-gray-100 px-3 py-2.5">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{title}</h4>
      {children}
    </section>
  );
}

/** The product box on the sheet: search the catalog, pick one, clear it. */
export function ProductPicker({ value, label, kind, disabled, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useApiGet(open ? `/film-inspection/products?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind || '')}` : null, [open, q, kind]);
  if (value && !open) {
    return (
      <div className="flex items-center gap-2 text-sm" data-ref-product={value}>
        <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{value}</span>
        <span className="text-gray-700 truncate">{label}</span>
        {!disabled && (
          <>
            <button type="button" onClick={() => setOpen(true)} className="text-xs text-powder-700 hover:underline shrink-0">Change</button>
            <button type="button" onClick={() => onPick('')} className="text-gray-400 hover:text-red-600 shrink-0" aria-label="Clear product"><X size={14} /></button>
          </>
        )}
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} data-ref-pick
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-powder-400 text-powder-700 rounded-md text-xs font-semibold disabled:opacity-50">
        <Search size={13} /> Pick the product to see its specs and artwork
      </button>
    );
  }
  return (
    <div className="space-y-1" data-ref-search>
      <div className="flex items-center gap-2">
        <input id="ref-product-search" autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="SKU, GTIN or flavor"
          className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">Cancel</button>
      </div>
      <ul className="max-h-56 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100 bg-white">
        {(data || []).map(p => (
          <li key={p.sku}>
            <button type="button" onClick={() => { onPick(p.sku); setOpen(false); setQ(''); }} data-ref-option={p.sku}
              className="w-full text-left px-2 py-1.5 hover:bg-powder-50 flex items-center gap-2">
              <span className="font-mono text-xs">{p.sku}</span>
              <span className="text-xs text-gray-600 truncate">{p.label}</span>
              {p.fits_kind === false && <span className="ml-auto text-[10px] text-gray-400 shrink-0">other pack</span>}
            </button>
          </li>
        ))}
        {data && !data.length && <li className="px-2 py-2 text-xs text-gray-500">No product matches.</li>}
      </ul>
    </div>
  );
}

export default function InspectionReference({ inspectionId, sku }) {
  const { data } = useApiGet(sku ? `/film-inspection/${inspectionId}/reference` : null, [inspectionId, sku]);
  // One PDF embedded in the column (wide screens), so the print file sits beside
  // the questions rather than over them.
  const [embedded, setEmbedded] = useState(null);

  if (!sku) {
    return <p className="p-3 text-xs text-gray-500">Pick the product this sheet is for, and its specification and released artwork show here.</p>;
  }
  if (!data) return <p className="p-3 text-xs text-gray-400">Loading…</p>;
  if (data.missing) return <p className="p-3 text-xs text-red-700">The product {sku} is no longer in the catalog.</p>;

  const { product, spec, colors, artwork, nfp, barcode } = data;
  const show = (f) => f?.url && openFile({ url: f.url, name: f.filename });

  return (
    <div data-inspection-reference={sku}>
      <Block title="Product">
        <p className="text-sm font-semibold text-gray-900">{product.label}</p>
        <Fact label="SKU" value={product.sku + (product.legacy_sku ? ` (was ${product.legacy_sku})` : '')} />
        <Fact label="GTIN" value={product.gtin ? `${product.gtin}${product.gtin_valid ? '' : ' — check digit fails'}` : 'None on file'} />
        <Fact label="Fill weight" value={product.fill_weight_g != null ? `${product.fill_weight_g} g` : null} />
        <Fact label="Unit size" value={product.unit_size} />
        <Fact label="Eye mark color" value={product.eyemark_color} />
        {barcode?.url && (
          <button type="button" onClick={() => show(barcode)} className="mt-1 text-xs text-powder-700 hover:underline inline-flex items-center gap-1">
            <Eye size={12} /> Barcode image{barcode.stale ? ' (made for another number — check it)' : ''}
          </button>
        )}
      </Block>

      <Block title="Packaging specification">
        {spec ? (
          <>
            <p className="text-xs font-semibold text-gray-800">{spec.name} <span className="font-mono text-gray-500">{spec.spec_id}</span></p>
            <Fact label="Format" value={spec.format} />
            <Fact label="Material" value={spec.material_structure} />
            <Fact label="Print" value={spec.print_process} />
            <Fact label="Zipper" value={spec.zipper} />
            <Fact label="Trim (L × W)" value={spec.trim_length_mm || spec.trim_width_mm ? `${spec.trim_length_mm ?? '—'} × ${spec.trim_width_mm ?? '—'} mm` : null} />
            <Fact label="Gusset" value={spec.gusset_mm != null ? `${spec.gusset_mm} mm` : null} />
            <Fact label="Front panel" value={spec.front_panel_mm != null ? `${spec.front_panel_mm} mm` : null} />
            <Fact label="Wind direction" value={spec.wind_direction} />
            <Fact label="Core" value={spec.core_in} />
            <Fact label="Vendor" value={spec.vendor} />
            {spec.notes && <p className="text-[11px] text-gray-600 mt-1 whitespace-pre-line">{spec.notes}</p>}
          </>
        ) : <p className="text-xs text-amber-800">No packaging spec is linked to this product.</p>}
      </Block>

      <Block title="Colors">
        {colors.length ? (
          <ul className="space-y-1">
            {colors.map(c => (
              <li key={c.slot} className="flex items-center gap-2 text-xs">
                <span className="h-5 w-5 rounded border border-gray-300 shrink-0"
                  style={{ background: c.hex_valid ? `#${String(c.hex).replace(/^HEX\s*|#/gi, '')}` : 'transparent' }} />
                <span className="text-gray-900">{c.pms || '—'}</span>
                <span className="font-mono text-gray-500">{c.hex || ''}</span>
                {(!c.pms_valid || !c.hex_valid) && <span className="text-[10px] text-amber-700">check</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-gray-500">No colors on file.</p>}
      </Block>

      <Block title="Artwork">
        {!artwork.length && <p className="text-xs text-amber-800">No artwork on file for this product.</p>}
        {artwork.map(a => {
          const st = STATUS[a.status] || { label: a.status, cls: 'bg-gray-100 text-gray-700' };
          return (
            <div key={a.id} className="mb-3 last:mb-0" data-ref-artwork={a.status}>
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="text-xs font-semibold text-gray-800 capitalize">{a.component} · V{a.version}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                {a.open_failures > 0 && (
                  <span className="text-[10px] text-red-700 inline-flex items-center gap-0.5"><AlertTriangle size={10} />{a.open_failures} open proof failure{a.open_failures === 1 ? '' : 's'}</span>
                )}
              </div>
              {a.preview?.url && (
                <button type="button" onClick={() => show(a.preview)} className="block w-full" title="Open full size">
                  <img src={a.preview.url} alt={`${a.component} artwork V${a.version}`} className="w-full max-h-64 object-contain bg-gray-50 border border-gray-200 rounded" />
                </button>
              )}
              <Fact label="Panel (NFP) drawn on" value={a.nfp_version} />
              <Fact label="Released" value={a.effective_date ? formatDate(a.effective_date) : null} />
              <div className="flex flex-wrap gap-1.5 mt-1">
                {a.files.map(f => (
                  <span key={f.id} className="inline-flex items-center gap-1">
                    <button type="button" disabled={!f.url} onClick={() => show(f)} data-ref-file={f.kind}
                      className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded text-[11px] text-gray-700 hover:border-powder-400 disabled:opacity-50">
                      <FileText size={11} /> {FILE_LABEL[f.kind] || f.kind}
                    </button>
                    {isPdf(f) && f.url && (
                      <button type="button" onClick={() => setEmbedded(embedded?.id === f.id ? null : f)}
                        className="hidden md:inline text-[11px] text-powder-700 hover:underline">
                        {embedded?.id === f.id ? 'Hide' : 'Show here'}
                      </button>
                    )}
                  </span>
                ))}
                {a.drive_url && externalUrl(a.drive_url) && (
                  <a href={externalUrl(a.drive_url)} target="_blank" rel="noreferrer" data-new-tab
                    className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded text-[11px] text-gray-700">
                    <ExternalLink size={11} /> Drive
                  </a>
                )}
              </div>
              {!a.files.length && !a.preview && <p className="text-[11px] text-gray-500">No files stored for this version.</p>}
            </div>
          );
        })}
        {embedded && (
          <iframe title={embedded.filename} src={pdfViewerUrl(embedded.url)} className="hidden md:block w-full h-[70vh] border border-gray-200 rounded mt-2" data-ref-embedded />
        )}
        {!data.storage && <p className="text-[11px] text-gray-500 mt-1">File storage is not configured, so files cannot be opened.</p>}
      </Block>

      <Block title="Nutrition Facts panel">
        {nfp ? (
          <>
            <p className="text-xs text-gray-800 inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-green-600" /> Approved {nfp.version}{nfp.approved_at ? ` · ${formatDate(nfp.approved_at)}` : ''}</p>
            <Fact label="Serving size" value={nfp.serving_size} />
            <Fact label="Servings" value={nfp.servings_per_container} />
            {nfp.file?.url && (
              <button type="button" onClick={() => show(nfp.file)} data-ref-file="nfp"
                className="mt-1 inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded text-[11px] text-gray-700">
                <FileText size={11} /> Approved panel
              </button>
            )}
          </>
        ) : <p className="text-xs text-amber-800">No approved panel on file.</p>}
      </Block>
    </div>
  );
}
