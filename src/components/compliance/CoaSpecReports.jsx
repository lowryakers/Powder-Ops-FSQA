// Two read-only lists on the Specifications tab. Neither edits anything.
//  · Text-only specs (D-309): active specs that carry words and no number, so
//    they grade nothing numeric. QA rewrites them as a limit; the app never does.
//  · The gluten misread (D-308): signed certificates whose gluten result was
//    stored as "<44" (MDL glued to the result) or under the joined name
//    "Gluten Allergen ReportELISA <". They are corrected inside a correction
//    window — un-sign with a reason, correct to <4, sign again.
import { useState } from 'react';
import { useApiGet } from '../../hooks/useApi';

export default function CoaSpecReports({ showGluten }) {
  const [open, setOpen] = useState(false);
  const { data: text } = useApiGet(open ? '/coa/specifications/text-only' : null, [open]);
  const { data: gluten } = useApiGet(open && showGluten ? '/coa/reports/gluten-misread' : null, [open, showGluten]);
  return (
    <section className="bg-white rounded-xl border border-gray-200" data-spec-reports>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-900">Specifications to look at</span>
        <span className="text-xs text-powder-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 text-xs text-gray-700">
          <div data-text-only>
            <p className="font-semibold text-gray-800">Words but no number ({text?.specs?.length ?? '…'})</p>
            <p className="text-gray-500">These grade nothing numeric. Rewrite each as a limit (Edit → Limit) — the app does not change them.</p>
            <ul className="mt-1 max-h-48 overflow-y-auto">
              {(text?.specs || []).map(s => <li key={s.id}>{s.item_number} · {s.test_type}: “{s.specification}”{s.unit ? ` ${s.unit}` : ''}</li>)}
            </ul>
          </div>
          {showGluten && (
            <div data-gluten-report>
              <p className="font-semibold text-gray-800">Signed certificates with the gluten misread ({gluten?.signed?.length ?? '…'})</p>
              <p className="text-gray-500">{gluten?.note}</p>
              <ul className="mt-1 max-h-48 overflow-y-auto">
                {(gluten?.signed || []).map(r => (
                  <li key={r.request_id} data-gluten-cert={r.certificate_number || r.request_id}>
                    {r.certificate_number || '—'} · lot {r.lot_number} · {r.item_description} — {r.results.map(x => `${x.test_type}: ${x.result_value} (${x.problem})`).join('; ')}
                  </li>
                ))}
              </ul>
              {gluten && (gluten.unsigned.length + gluten.reopened.length) > 0 && (
                <p className="mt-1 text-gray-500">{gluten.unsigned.length} unsigned and {gluten.reopened.length} reopened request{gluten.unsigned.length + gluten.reopened.length === 1 ? '' : 's'} have the same misread and can be corrected directly.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
