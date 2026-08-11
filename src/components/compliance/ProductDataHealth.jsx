import { useState } from 'react';
import { AlertTriangle, Barcode, GitMerge, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * What is wrong with the catalogue, and what has to be decided before the
 * flavour table can be frozen.
 *
 * This existed as counts in a document, worked out by hand. The trouble with
 * that is not accuracy — it was accurate — it is that it answers the question
 * once, on the day someone counted, and the whole value of a punch list is
 * watching it shrink. Everything here is derived server-side on every read, so
 * fixing a colour makes the number go down without anyone regenerating
 * anything.
 *
 * NOTHING IS FIXED AUTOMATICALLY, and that is not timidity. Every row is a
 * decision about a real product: which flavour keeps `CC`, whether Key Lime and
 * Key Lime Pie are one flavour or two, whether a missing colour was never
 * chosen or just never written down. A tool that guessed would produce a
 * catalogue that looks complete and isn't — and these codes get printed on
 * film, where a wrong answer costs a print run.
 */

const KIND_LABEL = {
  no_spec: 'No usable packaging spec',
  bad_color: 'Colour value that cannot be used',
  no_colors: 'No brand colours at all',
  not_a_sku: 'Not a SKU',
  gtin: 'GS1 barcode problem',
};

const KIND_WHY = {
  no_spec: 'The proofer checks dimensions and material against the spec. Without one it has nothing to check against.',
  bad_color: 'A hex or PMS value the proofer cannot parse, so the colour check silently covers nothing.',
  no_colors: 'No brand colours recorded, so nothing verifies what came back from the printer.',
  not_a_sku: 'A numeric id sitting in the SKU column — almost certainly a Shopify variant id.',
  gtin: 'Missing, or fails its GS1 check digit. A bad barcode scans as another product or not at all.',
};

function Group({ kind, items, open, onToggle }) {
  const skus = [...new Set(items.map((i) => i.sku))];
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50">
        {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <span className="text-sm font-semibold text-gray-900 flex-1">{KIND_LABEL[kind] || kind}</span>
        <span className="text-sm font-bold text-amber-700">{skus.length}</span>
        <span className="text-[11px] text-gray-400">SKU{skus.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
          <p className="text-[11px] text-gray-500 mb-2">{KIND_WHY[kind]}</p>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {items.map((i, k) => (
              <div key={k} className="flex items-start gap-2 text-xs">
                <span className="font-mono font-medium text-gray-900 shrink-0 w-28 truncate">{i.sku}</span>
                <span className="text-gray-600">{i.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// `data` comes from the panel above, which fetches it so the tab can show the
// count. One fetch, one number — the badge and this screen cannot disagree.
export default function ProductDataHealth({ data }) {
  const [open, setOpen] = useState(null);

  if (!data) return <p className="text-sm text-gray-400">Checking the catalogue…</p>;

  const byKind = {};
  for (const i of data.issues || []) (byKind[i.kind] = byKind[i.kind] || []).push(i);
  const kinds = Object.keys(byKind).sort((a, b) => byKind[b].length - byKind[a].length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-xl border border-gray-200 px-3 py-2">
          <p className="text-lg font-bold text-gray-900">{data.affected}</p>
          <p className="text-[11px] text-gray-500">of {data.products} SKUs need something</p>
        </div>
        <div className="rounded-xl border border-gray-200 px-3 py-2">
          <p className="text-lg font-bold text-gray-900">{data.flavors}</p>
          <p className="text-[11px] text-gray-500">distinct flavours</p>
        </div>
        <p className="text-xs text-gray-500 flex-1 min-w-[16rem]">
          Counted live from the catalogue. Nothing here is fixed automatically — each one is a decision
          about a real product.
        </p>
      </div>

      {/* The GS1 blocks. A hundred numbers per prefix and no way to make more;
          running out is a hard stop on launching anything, found at the worst
          moment, because a new block from GS1 takes weeks to obtain. */}
      {data.gs1?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-1.5">
            <Barcode size={15} className="text-powder-600" /> GS1 numbering left
          </h4>
          <div className="flex flex-wrap gap-2">
            {data.gs1.map((g) => (
              <div key={g.prefix} className={`rounded-lg border px-3 py-2 ${g.low ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                <p className="font-mono text-xs text-gray-500">{g.prefix}</p>
                <p className={`text-sm font-bold ${g.low ? 'text-amber-800' : 'text-gray-900'}`}>
                  {g.remaining} left
                </p>
                <p className="text-[11px] text-gray-500">{g.used} of {g.capacity} used</p>
              </div>
            ))}
          </div>
          {data.gs1.some((g) => g.low) && (
            <p className="text-[11px] text-amber-700 mt-1.5">
              A prefix under 25 free is roughly one flavour launched across every format. Ordering the next
              block takes weeks — start before a launch needs it, not when it does.
            </p>
          )}
        </div>
      )}

      {/* The collisions block the new SKU standard, so they sit above the data
          faults even though there are fewer of them. */}
      {data.collisions?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-1">
            <GitMerge size={15} className="text-red-600" /> One abbreviation, two flavours ({data.collisions.length})
          </h4>
          <p className="text-xs text-gray-600 mb-2">
            The new SKU standard uses the flavour abbreviation as a key, and a key that means two things is
            not a key. <span className="font-medium">Decide these before the flavour table is frozen</span> —
            a code that has been printed cannot be changed.
          </p>
          <div className="space-y-1.5">
            {data.collisions.map((c) => (
              <div key={c.abbr} className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2">
                <span className="font-mono text-sm font-bold text-red-800">{c.abbr}</span>
                <span className="text-xs text-gray-500"> currently means</span>
                <div className="mt-1 space-y-0.5">
                  {c.flavors.map((f) => (
                    <div key={f.flavor} className="text-xs">
                      <span className="font-medium text-gray-900">{f.flavor}</span>
                      <span className="text-gray-500"> — {f.skus.join(', ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.similar?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 mb-1">
            Flavour names that may be the same thing ({data.similar.length})
          </h4>
          <p className="text-xs text-gray-600 mb-2">
            One name is contained in the other. Sometimes two real products, sometimes one product named
            twice — only you know which, so nothing is merged.
          </p>
          <div className="space-y-1">
            {data.similar.map((s, k) => (
              <div key={k} className="flex items-center gap-2 flex-wrap text-xs rounded-lg border border-gray-200 px-2.5 py-1.5">
                <span className="font-medium text-gray-900">{s.a}</span>
                <span className="text-gray-400">({s.a_skus.length})</span>
                <span className="text-gray-400">vs</span>
                <span className="font-medium text-gray-900">{s.b}</span>
                <span className="text-gray-400">({s.b_skus.length})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5 mb-2">
          <AlertTriangle size={15} className="text-amber-600" /> Data to fix
        </h4>
        {kinds.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing outstanding — every SKU has a spec, colours and a valid barcode.</p>
        ) : (
          <div className="space-y-2">
            {kinds.map((kind) => (
              <Group key={kind} kind={kind} items={byKind[kind]}
                open={open === kind} onToggle={() => setOpen(open === kind ? null : kind)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
