import { useState } from 'react';
import { ChevronDown, ChevronUp, CornerDownRight, Flag, Printer } from 'lucide-react';
import { FLOWS, DEPARTMENTS } from '../../data/processFlows.js';

// Process maps for the Auditor View.
//
// Rendered as structured HTML rather than drawn as SVG on purpose: it stays
// readable at any width, it prints, and an auditor can select and copy the
// text. A picture that has to be zoomed on a laptop in a conference room is
// worse than a clear list with the hand-offs made obvious.
//
// A `branch` step is a path that only happens sometimes (a failure, a
// correction, an exception). It's indented and marked, because collapsing the
// exception into the happy path is how a process map ends up describing
// something the plant doesn't actually do.

function Step({ step, index }) {
  return (
    <li className={`relative pl-8 pb-4 last:pb-0 ${step.branch ? 'ml-6' : ''}`}>
      <span className={`absolute left-0 top-0 flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${step.branch
        ? 'bg-amber-100 text-amber-700 border border-amber-300'
        : 'bg-powder-100 text-powder-700 border border-powder-300'}`}>
        {step.branch ? <CornerDownRight size={12} /> : index}
      </span>
      {/* connector */}
      <span className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200 last:hidden" aria-hidden />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {step.actor}{step.branch && <span className="ml-1.5 font-normal normal-case text-amber-700">· only if it happens</span>}
        </p>
        <p className="text-sm text-gray-900 mt-0.5">{step.action}</p>
        {step.form && step.form !== '—' && (
          <p className="text-[11px] text-gray-500 mt-0.5">Recorded on: <span className="font-medium text-gray-700">{step.form}</span></p>
        )}
      </div>
    </li>
  );
}

function Flow({ flow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start justify-between gap-3 p-4 text-left hover:bg-gray-50">
        <div>
          <h4 className="font-semibold text-gray-900">{flow.title}</h4>
          <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">{flow.summary}</p>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400 shrink-0 mt-1" /> : <ChevronDown size={16} className="text-gray-400 shrink-0 mt-1" />}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-4">
          <ol className="space-y-0">
            {flow.steps.map((s, i) => <Step key={i} step={s} index={flow.steps.slice(0, i + 1).filter(x => !x.branch).length} />)}
          </ol>
          <p className="mt-3 flex items-start gap-2 text-[12px] text-green-900 bg-green-50 border border-green-200 rounded-lg p-2.5">
            <Flag size={13} className="mt-0.5 shrink-0" /> <span><span className="font-semibold">Ends with:</span> {flow.close}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function Department({ dept }) {
  const block = (label, items) => items?.length ? (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <ul className="space-y-0.5">
        {items.map((t, i) => <li key={i} className="text-[13px] text-gray-800 flex gap-1.5"><span className="text-gray-300">•</span>{t}</li>)}
      </ul>
    </div>
  ) : null;
  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <h4 className="font-semibold text-gray-900 mb-3">{dept.name}</h4>
      <div className="grid gap-4 sm:grid-cols-3">
        {block('Owns these records', dept.owns)}
        {block('Signs off on', dept.signs)}
        {block('Scheduled work', dept.scheduled)}
      </div>
    </div>
  );
}

export default function ProcessFlows() {
  const [tab, setTab] = useState('flows');
  const print = () => window.print();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[['flows', 'How a record moves'], ['departments', 'Who does what']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={print} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200">
          <Printer size={14} /> Print this page
        </button>
      </div>

      {tab === 'flows' ? (
        <>
          <p className="text-xs text-gray-500 max-w-3xl">
            Each flow is one record's life — from the event that starts it to the signature that closes it — naming the
            form used at every step and who does it. Amber steps are paths that only run when something goes wrong.
          </p>
          <div className="space-y-2">{FLOWS.map(f => <Flow key={f.id} flow={f} />)}</div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500 max-w-3xl">
            What each team owns, signs and is scheduled for. Roles, not people — so this stays accurate when someone
            changes jobs.
          </p>
          <div className="space-y-3">{DEPARTMENTS.map(d => <Department key={d.id} dept={d} />)}</div>
        </>
      )}
    </div>
  );
}
