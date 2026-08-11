import { useState } from 'react';
import { ListOrdered, ChevronDown, ChevronUp, AlertCircle, FileText } from 'lucide-react';
import ScalePlacementDiagram from './ScalePlacementDiagram.jsx';

// The Scale Calibration Verification procedure, shown on the form you're filling in.
//
// It's the same procedure for all five forms — only the three weights differ,
// and the form already prints those — so the server sends it once with the form
// list and this renders it in both places (in-app tab and kiosk).
//
// Open by default and deliberately plain: someone standing at a scale with a
// phone in one hand needs the steps, not a document. The weights for THIS form
// are shown inside the steps rather than left abstract, because "the minimum
// weight" is a lookup and "25 kg" is an instruction.

export default function ScaleProcedureCard({ procedure, form, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!procedure) return null;

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
        <span className="text-sm font-semibold text-gray-900 flex-1">{procedure.title}</span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
          {procedure.note && (
            <p className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span>{procedure.note}</span>
            </p>
          )}

          {procedure.about && <p className="text-xs text-gray-600">{procedure.about}</p>}

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

          {/* Where the weights go — their own placement scheme, with this
              form's weights on it. Sits between the numbers and the steps:
              you read what to place, then where, then what to do. */}
          <div className="border border-gray-100 rounded-lg p-3 bg-gray-50/60">
            <ScalePlacementDiagram points={pts} unit={unit} />
          </div>

          <ol className="space-y-1.5">
            {(procedure.steps || []).map((step, i) => (
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
          {procedure.document?.url && (
            <a href={procedure.document.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-powder-700 hover:text-powder-800 hover:underline">
              <FileText size={13} />
              View the procedure sheet
              {procedure.document.code ? ` (${procedure.document.code})` : ''}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
