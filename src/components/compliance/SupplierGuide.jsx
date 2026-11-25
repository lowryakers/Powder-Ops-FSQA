import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import { GUIDES } from '../../data/help.js';

// How the supplier register works, written for the person who keeps it
// (Purchasing). Plain steps in the order the work happens, and who does each
// one. It describes what the screens do; it enforces nothing.
const KEY = 'supplier_guide_open';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private window */ } };

// The steps live in the Help page's data (D-397), so this card and Help → "How
// does a supplier get qualified?" are one text that cannot drift apart.
const STEPS = GUIDES.find(g => g.id === 'qualify-a-supplier').steps;

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
