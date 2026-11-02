import { useState, useEffect, useMemo, useCallback } from 'react';

// A form's typing is kept as a draft in this browser while it is filled in
// (D-299), per person and per form, so a card closed by accident — or a tab
// that reloaded — offers it back. Nothing is saved to the record until Save.
//   const d = useFormDraft('qms:flavor_approval:new', () => blank);
//   d.value / d.set(v | fn) / d.restoredAt / d.touched / d.clear()
function userId() {
  try { return JSON.parse(localStorage.getItem('auth_user') || '{}').id || 'anon'; } catch { return 'anon'; }
}
function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

export function useFormDraft(name, initial) {
  const key = useMemo(() => `form_draft:${userId()}:${name}`, [name]);
  const [restoredAt] = useState(() => read(key)?.at || null);
  const [value, setValue] = useState(() => {
    const d = read(key);
    return d && 'value' in d ? d.value : (typeof initial === 'function' ? initial() : initial);
  });
  const [touched, setTouched] = useState(!!restoredAt);
  const set = useCallback((v) => { setTouched(true); setValue(v); }, []);
  useEffect(() => {
    if (!touched) return;
    try { localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), value })); } catch { /* full or blocked */ }
  }, [key, value, touched]);
  const clear = useCallback(() => { try { localStorage.removeItem(key); } catch { /* ignore */ } }, [key]);
  return { value, set, restoredAt, touched, clear };
}

/** Closing a form with something typed asks first. True = go ahead and close. */
export function confirmDiscard(touched) {
  return !touched || window.confirm('Close without saving? What you typed will be discarded.');
}
