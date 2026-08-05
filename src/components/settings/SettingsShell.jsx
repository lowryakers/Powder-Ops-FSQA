import { useState, useEffect, useMemo, useRef } from 'react';
import { useCompactLayout } from '../../lib/useCompactLayout.js';
import { ChevronRight, ArrowLeft, Search } from 'lucide-react';

// The chrome around Settings: a list of sections on the left, one section at a
// time on the right.
//
// Settings had become one long scroll of seven stacked blocks. That shape has a
// specific failure: everything is equally prominent, so finding the one thing
// you came for means reading past six things you didn't. It also meant a
// section's permission rule lived inline in the middle of the render, where a
// section could appear in the page but have nothing to show.
//
// Two rules this shell exists to enforce:
//
//   1. A SECTION IS DATA, not a block of JSX in a mega-render. `visible(user)`
//      lives on the section, so the nav and the pane can never disagree about
//      whether someone may see it — the nav is built from the same predicate
//      that gates the content.
//   2. ONE PANE AT A TIME ON A PHONE. Same rule as comms: the compact layout
//      shows the index, tapping a section replaces it, and Back returns. A
//      two-pane settings screen on a 360px phone is two unusable columns.
//
// Sections are rendered lazily — only the open one mounts — so opening Settings
// no longer fires every section's queries at once.

export default function SettingsShell({ groups, user, initialSection = null, storageKey = 'settings_section' }) {
  const compact = useCompactLayout();
  const paneRef = useRef(null);

  // Flatten to the sections this person may actually see. Everything else in
  // here works from `visible`, so a hidden section cannot be reached by a stale
  // deep link or a remembered id either.
  const sections = useMemo(() => {
    const out = [];
    for (const g of groups) {
      for (const s of g.sections) {
        if (!s.visible || s.visible(user)) out.push({ ...s, group: g.label });
      }
    }
    return out;
  }, [groups, user]);

  // A linked section wins over the remembered one; App.jsx reads it off the URL
  // (see the deep-link effect there — the query string is consumed before a
  // lazily-loaded module ever mounts, so this cannot be read here).
  const [active, setActive] = useState(() => {
    if (initialSection) return initialSection;
    try { return localStorage.getItem(storageKey) || null; } catch { return null; }
  });
  const [filter, setFilter] = useState('');

  // A remembered or linked section that this person can't see must not leave
  // the pane blank. On a wide layout fall back to the first section they can
  // see; on a phone fall back to the index, because choosing for people is what
  // made the comms landing feel random.
  const valid = active && sections.some(s => s.id === active);
  const current = valid ? sections.find(s => s.id === active)
    : compact ? null : sections[0] || null;

  useEffect(() => {
    if (!current) return;
    try { localStorage.setItem(storageKey, current.id); } catch { /* private mode */ }
  }, [current, storageKey]);

  // Opening a section on a phone replaces the index, so start at the top of it
  // rather than wherever the index was scrolled to.
  const open = (id) => {
    setActive(id);
    if (compact) requestAnimationFrame(() => paneRef.current?.scrollIntoView({ block: 'start' }));
  };

  const q = filter.trim().toLowerCase();
  const matches = (s) => !q
    || s.label.toLowerCase().includes(q)
    || (s.description || '').toLowerCase().includes(q)
    || (s.keywords || '').toLowerCase().includes(q);

  const visibleGroups = groups
    .map(g => ({ ...g, sections: g.sections.filter(s => (!s.visible || s.visible(user)) && matches(s)) }))
    .filter(g => g.sections.length);

  const Nav = (
    <nav className="space-y-4">
      {sections.length > 6 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Find a setting…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      )}
      {visibleGroups.map(g => (
        <div key={g.label}>
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{g.label}</p>
          <ul className="space-y-0.5">
            {g.sections.map(s => {
              const on = current?.id === s.id;
              return (
                <li key={s.id}>
                  <button onClick={() => open(s.id)}
                    className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${on ? 'bg-powder-50 text-powder-800' : 'text-gray-700 hover:bg-gray-100'}`}>
                    {s.icon && <s.icon size={15} className={`mt-0.5 shrink-0 ${on ? 'text-powder-600' : 'text-gray-400'}`} />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{s.label}</span>
                      {s.description && <span className="block text-[11px] text-gray-500 leading-snug">{s.description}</span>}
                    </span>
                    {compact && <ChevronRight size={15} className="text-gray-300 mt-0.5 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {visibleGroups.length === 0 && (
        <p className="px-2 py-6 text-sm text-gray-400 text-center">Nothing matches &ldquo;{filter}&rdquo;.</p>
      )}
    </nav>
  );

  // ── Compact: index, or one section with a way back ────────────────────────
  if (compact) {
    if (!current) {
      return (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Settings</h2>
          {Nav}
        </div>
      );
    }
    return (
      <div ref={paneRef} className="space-y-4">
        <button onClick={() => setActive(null)}
          className="inline-flex items-center gap-1.5 text-sm text-powder-600 font-medium">
          <ArrowLeft size={15} /> Settings
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{current.label}</h2>
          {current.description && <p className="text-sm text-gray-500">{current.description}</p>}
        </div>
        <current.Component user={user} />
      </div>
    );
  }

  // ── Wide: rail beside the pane ────────────────────────────────────────────
  return (
    <div className="flex gap-6 items-start">
      <div className="w-60 shrink-0 sticky top-4">
        <h2 className="text-lg font-bold text-gray-900 px-2 mb-3">Settings</h2>
        {Nav}
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        {current ? (
          <>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{current.label}</h2>
              {current.description && <p className="text-sm text-gray-500">{current.description}</p>}
            </div>
            <current.Component user={user} />
          </>
        ) : (
          <p className="text-sm text-gray-400 py-12 text-center">Pick a setting from the list.</p>
        )}
      </div>
    </div>
  );
}
