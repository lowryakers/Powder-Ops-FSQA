// The Pipeline (D-134): every product grouped by its derived stage, stage 0
// (not started) on the left through 9. The stage and the named next gate are
// computed by the server (shared/product-stage.js) and rendered as given —
// nothing here re-decides a gate. Blocked products are shown apart with their
// reason and owner and leave the needs-work count; they are never hidden.
import { useMemo, useState } from 'react';
import { STAGES, STAGE_OWNERS } from '../../../shared/product-stage.js';
import { Ban } from 'lucide-react';

const COLUMNS = [{ n: 0, label: 'Not started' }, ...STAGES.map((s) => ({ n: s.n, label: s.label }))];
const PACK_LABEL = { PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick pack', BOX: 'Carton', CUP: 'Cup', BTL: 'Bottle' };

export default function ProductPipeline({ products, onOpen, loading = false }) {
  const [line, setLine] = useState('');
  const [pack, setPack] = useState('');
  const [owner, setOwner] = useState('');
  const lines = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const packs = useMemo(() => [...new Set(products.map((p) => p.pack).filter(Boolean))].sort(), [products]);

  // The owner filter is the owner of the NEXT gate — who the product is
  // waiting on — or, for a blocked product, the named owner of the block.
  const shown = useMemo(() => products.filter((p) => p.stage
    && (!line || p.category === line) && (!pack || p.pack === pack)
    && (!owner || (p.stage.blocked ? p.stage.blocked.owner === owner : p.stage.next?.owner === owner))), [products, line, pack, owner]);
  const blocked = shown.filter((p) => p.stage.blocked);
  const flowing = shown.filter((p) => !p.stage.blocked);
  const byStage = COLUMNS.map((c) => ({ ...c, items: flowing.filter((p) => p.stage.stage === c.n) }));
  const needsWork = shown.filter((p) => p.stage.needs_work).length;
  const allHold = flowing.filter((p) => p.stage.stage === 9).length;
  const blockOwners = [...new Set(products.map((p) => p.stage?.blocked?.owner).filter(Boolean))];

  // Columns of zeros before the catalog has loaded read as "nothing needs work".
  if (loading) return <p className="text-sm text-gray-500" data-pipeline-loading>Loading…</p>;
  return (
    <div className="space-y-3" data-pipeline>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-900" data-pipeline-needs-work={needsWork}>{needsWork} need work</span>
        <span className="px-2.5 py-1 rounded-full border border-gray-300 bg-gray-50 text-gray-700" data-pipeline-blocked={blocked.length}>{blocked.length} blocked</span>
        <span className="px-2.5 py-1 rounded-full border border-green-300 bg-green-50 text-green-800" data-pipeline-complete={allHold}>{allHold} with every gate holding</span>
        <span className="ml-auto" />
        <select value={line} onChange={(e) => setLine(e.target.value)} data-pipeline-line className="px-2 py-1 border border-gray-300 rounded-lg bg-white">
          <option value="">All lines</option>{lines.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={pack} onChange={(e) => setPack(e.target.value)} data-pipeline-pack className="px-2 py-1 border border-gray-300 rounded-lg bg-white">
          <option value="">All packs</option>{packs.map((k) => <option key={k} value={k}>{PACK_LABEL[k] || k}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} data-pipeline-owner className="px-2 py-1 border border-gray-300 rounded-lg bg-white">
          <option value="">Waiting on anyone</option>
          {STAGE_OWNERS.map((o) => <option key={o} value={o}>Waiting on {o}</option>)}
          {blockOwners.filter((o) => !STAGE_OWNERS.includes(o)).map((o) => <option key={o} value={o}>Blocked on {o}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex gap-2 min-w-max">
          {byStage.map((c) => (
            <section key={c.n} data-pipeline-stage={c.n} data-count={c.items.length}
              className="w-48 shrink-0 rounded-lg border border-gray-200 bg-gray-50/60">
              <header className="px-2 py-1.5 border-b border-gray-200">
                <p className="text-[11px] font-semibold text-gray-500">Stage {c.n}</p>
                <p className="text-xs font-medium text-gray-900 leading-tight">{c.label}</p>
                <p className="text-[11px] text-gray-500 tabular-nums">{c.items.length} product{c.items.length === 1 ? '' : 's'}</p>
              </header>
              <ul className="p-1.5 space-y-1 max-h-[26rem] overflow-y-auto">
                {c.items.map((p) => (
                  <li key={p.sku}>
                    <button type="button" onClick={() => onOpen(p.sku, p.stage.next?.key)} data-pipeline-product={p.sku}
                      title={p.stage.summary}
                      className="w-full text-left rounded-md border border-gray-200 bg-white px-2 py-1 hover:border-powder-300">
                      <span className="block font-mono text-[11px] text-gray-900 truncate">{p.sku}</span>
                      <span className="block text-[11px] text-gray-600 truncate">{p.flavor}</span>
                      {p.stage.next && (
                        <span className="block text-[10px] text-amber-800 leading-snug">next: {p.stage.next.label.toLowerCase()} · {p.stage.next.owner}</span>
                      )}
                      {p.stage.held.length > 0 && <span className="block text-[10px] text-amber-700" data-pipeline-held>{p.stage.held.length} step{p.stage.held.length === 1 ? '' : 's'} held</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white" data-pipeline-blocked-list>
        <header className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-sm font-medium text-gray-900">
          <Ban size={14} className="text-gray-500" /> Blocked — waiting on something outside the flow
        </header>
        {blocked.length === 0 ? <p className="px-3 py-2 text-xs text-gray-500">Nothing is blocked.</p> : (
          <ul className="divide-y divide-gray-100">
            {blocked.map((p) => (
              <li key={p.sku}>
                <button type="button" onClick={() => onOpen(p.sku, p.stage.next?.key)} data-pipeline-blocked-product={p.sku}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50">
                  <span className="font-mono text-gray-900">{p.sku}</span> <span className="text-gray-600">{p.flavor}</span>
                  <span className="text-gray-500"> · stage {p.stage.stage}</span>
                  <span className="block text-gray-700">{p.stage.blocked.reason} — <strong>{p.stage.blocked.owner}</strong></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
