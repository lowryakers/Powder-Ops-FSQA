// Which tabs a person gets, and which one they're on.
//
// Lives in lib/ rather than beside <ModuleTabs> because a file that exports
// both a component and a hook breaks fast refresh — the lint rule that caught
// this is the codebase's, and it's right.

import { useState, useMemo, useEffect } from 'react';
import { getParam, consumeParam } from './deepLink.js';

/* ── Which tabs this person actually gets ─────────────────────────────────── */

// `visible` is optional; a tab without one is visible to everyone who reached
// the module. Kept as a plain predicate so a caller can express anything —
// role, department, module grant, or a feature being configured at all.
export function visibleTabs(tabs, user) {
  return (tabs || []).filter(t => t && (typeof t.visible === 'function' ? t.visible(user) : t.visible !== false));
}

/* ── State: the current tab, remembered and deep-linkable ─────────────────── */

// `id` names the module so two modules don't share a remembered tab.
//
// Precedence: an explicit `?view=` deep link, then whatever you were last on,
// then the caller's default, then the first tab you can see. A remembered tab
// you have since lost access to falls through rather than leaving a blank pane
// — the same rule SettingsShell applies to its sections.
export function useModuleTabs({ id, tabs, user, initial = null }) {
  const shown = useMemo(() => visibleTabs(tabs, user), [tabs, user]);
  const storageKey = id ? `module_tab_${id}` : null;

  const [tab, setTab] = useState(() => {
    // Pure read — see deepLink.js on why this must not consume under StrictMode.
    const linked = getParam('view');
    if (linked) return linked;
    if (initial) return initial;
    if (storageKey) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) return saved;
      } catch { /* private mode */ }
    }
    return null;
  });

  const valid = tab && shown.some(t => t.id === tab);
  const current = valid ? tab : (shown[0]?.id ?? null);

  // Spend the deep link once it has actually landed, so navigating away and
  // back doesn't keep dragging you to the linked tab.
  useEffect(() => { consumeParam('view'); }, []);

  useEffect(() => {
    if (!storageKey || !current) return;
    try { localStorage.setItem(storageKey, current); } catch { /* private mode */ }
  }, [storageKey, current]);

  return { tabs: shown, tab: current, setTab };
}
