import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

// How the supplier register works, written for the person who keeps it
// (Purchasing). Plain steps in the order the work happens, and who does each
// one. It describes what the screens do; it enforces nothing.
const KEY = 'supplier_guide_open';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private window */ } };

const STEPS = [
  {
    who: 'Purchasing',
    title: 'Set the supplier up',
    body: 'Open the supplier and press Edit details. Pick its Type (raw material, packaging, and so on) and tick “We still buy from this supplier” if we do. The type decides which documents they owe. A new supplier is added by an admin for now.',
  },
  {
    who: 'Purchasing',
    title: 'Send the questionnaire',
    body: 'Press Send questionnaire link and send the link to the supplier. They fill in and sign FORM 404-1 online, and it files itself on the supplier.',
  },
  {
    who: 'Purchasing',
    title: 'Collect their documents',
    body: 'Raw material and packaging suppliers must have a current third-party GMP certificate. Use Attach GMP certificate and enter its expiry date. Packaging and food-contact suppliers also need a letter of guarantee with its renewal date. Attach anything else (spec, COA, allergen statement) with Attach documents and pick what it is.',
  },
  {
    who: 'Purchasing',
    title: 'List what we buy from them',
    body: 'Under Ingredients, press Add an ingredient for each material, with its part number.',
  },
  {
    who: 'Quality',
    title: 'Check and decide',
    body: 'Quality checks each ingredient against the banned-substance lists, then records the decision: approved, conditional or not approved. Approval waits for the GMP certificate and the banned-list check.',
  },
  {
    who: 'Purchasing',
    title: 'Keep it current',
    body: 'The Needs attention tab lists missing and expiring documents. Ask the supplier for the new copy before the old one runs out. Each approved supplier gets a review task once a year.',
  },
];

export default function SupplierGuide() {
  const [open, setOpen] = useState(() => read() !== '0');
  const toggle = () => { const next = !open; setOpen(next); write(next ? '1' : '0'); };
  return (
    <section data-supplier-guide className="rounded-lg border border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-sky-900 dark:text-sky-200">
        <BookOpen className="h-4 w-4 shrink-0" />
        <span className="flex-1">How this works</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <ol className="space-y-2 px-3 pb-3 text-sm text-slate-700 dark:text-slate-300">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-2" data-guide-step>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold text-white">{i + 1}</span>
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {s.title} <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800">{s.who}</span>
                </p>
                <p className="text-[13px] leading-snug">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
