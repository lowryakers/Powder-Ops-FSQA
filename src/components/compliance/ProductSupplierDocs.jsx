// The supplier documents a product's recipe reaches (D-340). READ-ONLY: the
// documents live on the supplier and its ingredient; this lists them by file id
// and opens them from there. There is no upload here and no product copy.
import { downloadFile } from '../../lib/downloadFile.js';

const TONE = {
  current: 'bg-emerald-100 text-emerald-800',
  expiring: 'bg-amber-100 text-amber-800',
  expired: 'bg-rose-100 text-rose-800',
  no_date: 'bg-slate-100 text-slate-600',
};
const LABEL = { current: 'current', expiring: 'expiring soon', expired: 'expired', no_date: 'no expiry' };

function Doc({ d }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-xs" data-recipe-doc={d.id}>
      <span className="text-gray-500">{d.kind_label}</span>
      {d.stored
        ? <button type="button" className="text-left text-blue-600 hover:underline"
            onClick={() => downloadFile(`/suppliers/files/${d.id}/download`, d.filename)}>{d.filename}</button>
        : <span title="Catalogued; the file itself is not stored">{d.filename}</span>}
      {d.lot_number && <span className="text-gray-500">lot {d.lot_number}</span>}
      <span className={`rounded px-1.5 py-0.5 text-[11px] ${TONE[d.status] || TONE.no_date}`} data-recipe-doc-status={d.status}>
        {LABEL[d.status] || d.status}{d.expires_on ? ` ${d.expires_on}` : ''}
      </span>
    </li>
  );
}

export default function ProductSupplierDocs({ recipe, sku }) {
  const lines = recipe?.lines || [];
  return (
    <div data-recipe-rollup className="space-y-3 text-sm">
      <p className="text-xs text-gray-500">Read from the supplier register through this product's recipe. Documents are filed on the supplier, not here.</p>
      <ul className="space-y-2">
        {lines.map(l => (
          <li key={l.id} data-recipe-line={l.part_number}>
            <div className="font-medium text-gray-800">
              {l.description || l.part_number} <code className="ml-1 text-xs text-gray-500">{l.part_source_system} {l.part_number}</code>
              {l.qty != null && <span className="ml-1 text-xs text-gray-500">{l.qty}{l.uom ? ` ${l.uom}` : ''}</span>}
            </div>
            {l.suppliers.length ? l.suppliers.map(s => (
              <div key={s.material_id} className="ml-3 mt-1" data-recipe-supplier={s.supplier_name}>
                <div className="text-xs text-gray-700">{s.supplier_name}{s.manufacturer_name ? ` · made by ${s.manufacturer_name}` : ''}</div>
                {s.documents.length
                  ? <ul className="ml-3 space-y-0.5">{s.documents.map(d => <Doc key={d.id} d={d} />)}</ul>
                  : <p className="ml-3 text-xs text-amber-700">No documents filed for this ingredient.</p>}
              </div>
            )) : <p className="ml-3 text-xs text-amber-700" data-recipe-no-supplier>No supplier ingredient carries this part number yet.</p>}
          </li>
        ))}
      </ul>
      {(recipe?.suppliers || []).some(s => s.documents.length) && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Supplier-level documents</div>
          {recipe.suppliers.filter(s => s.documents.length).map(s => (
            <div key={s.id} className="mt-1">
              <div className="text-xs text-gray-700">{s.name}</div>
              <ul className="ml-3 space-y-0.5">{s.documents.map(d => <Doc key={d.id} d={d} />)}</ul>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" data-customer-pack
          onClick={() => downloadFile(`/products/customer-pack?skus=${encodeURIComponent(sku)}&preset=whole-foods-natural-flavor&format=zip`, `whole-foods-natural-flavor-${sku}.zip`)}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Download Whole Foods natural-flavor pack</button>
        <button type="button"
          onClick={() => downloadFile(`/products/customer-pack?skus=${encodeURIComponent(sku)}&preset=whole-foods-natural-flavor&format=xlsx`, `whole-foods-natural-flavor-${sku}.xlsx`)}
          className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Summary sheet only</button>
      </div>
    </div>
  );
}
