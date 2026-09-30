// New Product Creation — the reference for the flow the Pipeline measures
// (D-134). Static: every word comes from shared/product-stage.js, the same
// entries the stage is computed from, so the page cannot describe a gate the
// code tests differently. One screen on purpose; a reference that needs
// scrolling twice is a policy document nobody reads.
import { STAGES, INCIDENTS } from '../../../shared/product-stage.js';

const OWNER_TONE = {
  Formulator: 'bg-violet-50 text-violet-800 border-violet-200',
  Ops: 'bg-sky-50 text-sky-800 border-sky-200',
  Design: 'bg-rose-50 text-rose-800 border-rose-200',
  Fulfillment: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export default function NewProductFlow() {
  return (
    <div className="space-y-3" data-new-product-flow>
      <p className="text-sm text-gray-700 max-w-3xl">
        A product moves through nine gates in this order. The <strong>stage</strong> on every product is the furthest gate that holds
        with every gate before it — computed, never typed. Gates report; they never stop an edit. A new formula version sends a
        shipped product back through the flow: it is a loop, not a ladder.
      </p>
      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table className="min-w-[760px] w-full text-xs" data-flow-stages>
          <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-600">
            <tr>
              <th className="px-2 py-1.5 w-8">#</th>
              <th className="px-2 py-1.5 w-44">Stage</th>
              <th className="px-2 py-1.5">Done when</th>
              <th className="px-2 py-1.5 w-24">Owner</th>
              <th className="px-2 py-1.5">Done out of order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {STAGES.map((s) => (
              <tr key={s.key} data-flow-stage={s.key} className="align-top">
                <td className="px-2 py-1.5 font-semibold tabular-nums text-gray-500">{s.n}</td>
                <td className="px-2 py-1.5 font-medium text-gray-900">{s.label}</td>
                <td className="px-2 py-1.5 text-gray-700">{s.done}</td>
                <td className="px-2 py-1.5"><span className={`inline-block px-1.5 py-0.5 rounded border ${OWNER_TONE[s.owner] || ''}`}>{s.owner}</span></td>
                <td className="px-2 py-1.5 text-gray-600">{s.breaks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2 md:grid-cols-3" data-flow-incidents>
        {INCIDENTS.map((i) => (
          <div key={i.title} className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs" data-flow-incident={i.stage}>
            <p className="font-semibold text-amber-900">{i.title} <span className="font-normal text-amber-700">· stage {i.stage}</span></p>
            <p className="mt-0.5 text-amber-900/90">{i.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
