import { useState } from 'react';
import { ListOrdered, ChevronDown, ChevronUp, AlertCircle, FileText } from 'lucide-react';
import ScalePlacementDiagram from './ScalePlacementDiagram.jsx';

// The Scale Calibration Verification procedure, shown on the form you're filling in.
//
// Most of it is the same for all five forms, but WHERE THE WEIGHTS GO is not:
// the sheet was revised for the Batching pallet scale only. The server sends
// each form its own assembled procedure (`form.procedure`) so the steps and the
// placement diagram can never describe different things — the global
// `procedure` prop is the fallback for a caller that has no form.
//
// Open by default and deliberately plain: someone standing at a scale with a
// phone in one hand needs the steps, not a document. The weights for THIS form
// are shown inside the steps rather than left abstract, because "the minimum
// weight" is a lookup and "25 kg" is an instruction.

export default function ScaleProcedureCard({ procedure, form, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  // This form's own wording wins; the shared object is only a fallback.
  const proc = form?.procedure || procedure;
  if (!proc) return null;

  const pts = form?.points || [];
  const unit = form?.unit || '';
  const named = ['minimum', 'target', 'maximum'];
  // Substitute this form's actual weights into the three placing steps, so the
  // operator reads "add 50 kg", not "add the second weight".
  const stepText = (text) => {
    const idx = named.findIndex(n => new RegExp(n, 'i').test(text));
    if (idx === -1 || !pts[idx]) return text;
    return text.replace(new RegExp(named[idx], 'i'), `${named[idx].toUpperCase()} (${pts[idx].nominal} ${unit})`);
  };

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50">
        <ListOrdered size={16} className="text-powder-600 shrink-0" />
        <span className="text-sm font-semibold text-gray-900 flex-1">{proc.title}</span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {proc.note && (
            <p className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span>{proc.note}</span>
            </p>
          )}

          {proc.about && <p className="text-xs text-gray-600">{proc.about}</p>}

          {pts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pts.map((p, i) => (
                <span key={i} className="px-2 py-1 rounded-lg bg-gray-100 text-xs">
                  <span className="text-gray-500">{named[i] || `point ${i + 1}`}</span>{' '}
                  <span className="font-semibold text-gray-900">{p.nominal} {unit}</span>{' '}
                  <span className="text-gray-500">± {p.tolerance} {unit}</span>
                </span>
              ))}
            </div>
          )}

          {/* Where the weights go — this form's own placement scheme, with
              this form's weights on it. Sits between the numbers and the
              steps: you read what to place, then where, then what to do.
              `form.diagram` decides the pattern; only the Batching pallet
              scale's sheet was revised to the centre-line layout. */}
          <div className="border border-gray-100 rounded-lg p-3 bg-gray-50/60">
            <ScalePlacementDiagram points={pts} unit={unit} variant={form?.diagram} />
          </div>

          <ol className="space-y-1.5">
            {(proc.steps || []).map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-gray-800">
                <span className="shrink-0 w-5 h-5 rounded-full bg-powder-100 text-powder-700 text-[11px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <span>{stepText(step)}</span>
              </li>
            ))}
          </ol>

          {/* The controlled sheet these steps and the diagram were transcribed
              from. Served straight out of `public/forms` — an operator at a
              scale, or an auditor asking to see the procedure, must be able to
              open it whether or not file storage is configured. Same reasoning
              as the Brittle Plastic & Glass diagram. */}
          {proc.document?.url && (
            <a href={proc.document.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-powder-700 hover:text-powder-800 hover:underline">
              <FileText size={13} />
              View the procedure sheet
              {proc.document.code ? ` (${proc.document.code})` : ''}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
