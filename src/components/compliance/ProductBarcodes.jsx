import { useMemo, useState } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { AlertTriangle, Search } from 'lucide-react';

/**
 * The barcode board — the same question the Nutrition panels tab answers, for
 * the other file that has to be right before anything prints.
 *
 * FIVE STATES, AND THE ORDER IS THE POINT. A product with no GTIN is a punch
 * list item; one whose stored barcode image encodes a number the product no
 * longer carries is a RELABEL waiting to happen, and it is the only one that
 * looks finished from every other screen. It sorts first and it is red.
 *
 * The counts are `.length` of the rows the server returned, not a second query
 * — a headline that disagrees with the list it opens is the defect this
 * codebase keeps unpicking.
 */
const STATE = {
  stale: {
    label: 'Barcode is for a different GTIN', tone: 'bg-red-100 text-red-800',
    note: 'The stored image encodes a number this product no longer carries. Do not send it to a printer.',
    rank: 0,
  },
  bad_gtin: {
    label: 'GTIN fails its check digit', tone: 'bg-red-100 text-red-800',
    note: 'The number itself is wrong — fix it before anything is generated from it.',
    rank: 1,
  },
  no_gtin: {
    label: 'No GS1 number', tone: 'bg-amber-100 text-amber-800',
    note: 'Nothing to encode yet. Allocate the GTIN first.',
    rank: 2,
  },
  no_image: {
    label: 'No barcode image', tone: 'bg-amber-100 text-amber-800',
    note: 'The number is assigned; the PNG from the GS1 site has not been attached.',
    rank: 3,
  },
  ok: { label: 'On file', tone: 'bg-green-100 text-green-700', note: '', rank: 4 },
};

function Card({ id, count, label, active, onClick, tone }) {
  const off = count === 0;
  return (
    <button type="button" onClick={off ? undefined : onClick} disabled={off}
      className={`text-left rounded-xl border px-3 py-2.5 transition ${
        active ? 'border-powder-400 ring-1 ring-powder-200' : 'border-gray-200'
      } ${off ? 'opacity-50 cursor-default' : 'hover:border-powder-300'} bg-white`}>
      <div className={`text-xl font-bold tabular-nums ${tone}`}>{count}</div>
      <div className="text-xs text-gray-600">{label}</div>
      {off && id !== 'ok' && <div className="text-[10px] text-gray-400">nothing here</div>}
    </button>
  );
}

export default function ProductBarcodes({ onOpenSku }) {
  const { data } = useApiGet('/products/barcodes');
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    let l = data?.products || [];
    if (filter) l = l.filter((p) => p.state === filter);
    const needle = q.trim().toLowerCase();
    if (needle) l = l.filter((p) => [p.sku, p.gtin, p.flavor].some((v) => (v || '').toLowerCase().includes(needle)));
    // What must not print, first.
    return [...l].sort((a, b) => STATE[a.state].rank - STATE[b.state].rank || a.sku.localeCompare(b.sku));
  }, [data, filter, q]);

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const c = data.counts;
  const pick = (k) => setFilter((f) => (f === k ? '' : k));

  return (
    <div className="space-y-4">
      {c.stale > 0 && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong>{c.stale} barcode image{c.stale === 1 ? '' : 's'} no longer match{c.stale === 1 ? 'es' : ''} its product&apos;s GTIN.</strong>{' '}
            The file on record encodes the old number. Replace it before the artwork goes out.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Card id="stale" count={c.stale} label="Wrong number" tone="text-red-700" active={filter === 'stale'} onClick={() => pick('stale')} />
        <Card id="bad_gtin" count={c.bad_gtin} label="Bad check digit" tone="text-red-700" active={filter === 'bad_gtin'} onClick={() => pick('bad_gtin')} />
        <Card id="no_gtin" count={c.no_gtin} label="No GS1 number" tone="text-amber-700" active={filter === 'no_gtin'} onClick={() => pick('no_gtin')} />
        <Card id="no_image" count={c.no_image} label="No image yet" tone="text-amber-700" active={filter === 'no_image'} onClick={() => pick('no_image')} />
        <Card id="ok" count={c.ok} label="On file" tone="text-green-700" active={filter === 'ok'} onClick={() => pick('ok')} />
      </div>

      {/* GS1 numbers are finite: nine digits of company prefix plus two of item
          is exactly 100 numbers, and finding out you are out by running out is
          finding out too late — a new prefix is a purchase with a lead time. */}
      {data.prefixes?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">GS1 company prefixes</h4>
          <div className="space-y-1.5">
            {data.prefixes.map((p) => (
              <div key={p.prefix} className="flex items-center gap-3 text-xs">
                <code className="font-mono text-gray-700 w-24 shrink-0">{p.prefix}</code>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden max-w-xs">
                  <div className={`h-full ${p.low ? 'bg-amber-500' : 'bg-powder-500'}`} style={{ width: `${p.used}%` }} />
                </div>
                <span className="tabular-nums text-gray-600">{p.used}/100 used</span>
                <span className={`tabular-nums font-medium ${p.low ? 'text-amber-700' : 'text-gray-400'}`}>
                  {p.free} free{p.low ? ' — running low' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, GTIN or flavour…"
          className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">SKU</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">Product</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">GTIN</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Image</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.sku} onClick={() => onOpenSku?.(p.sku)}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <td className="px-3 py-2 whitespace-nowrap"><code className="font-mono text-gray-900">{p.sku}</code></td>
                  <td className="px-3 py-2 text-gray-600">{p.flavor}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-600">{p.gtin || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                    {p.has_barcode_image ? (
                      <>
                        <span className="text-gray-700">{p.barcode_filename || 'on file'}</span>
                        {/* Both numbers, named. "Stale" alone does not tell
                            anybody which one the file actually encodes. */}
                        {p.barcode_stale && (
                          <div className="text-red-700 font-medium">encodes {p.barcode_gtin} · product is {p.gtin}</div>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATE[p.state].tone}`}>
                      {STATE[p.state].label}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Nothing matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {filter && STATE[filter].note && <p className="text-xs text-gray-500">{STATE[filter].note}</p>}
    </div>
  );
}
