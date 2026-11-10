// The FORM 106-01 dilutions IN FORCE (D-327), read from the server.
// Document Control owns the list through `controlled.js`; the bundle's copy is
// the code, which may be parked waiting on approval. Fetched once per page.
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

let cached = null;
let pending = null;
function load() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = apiFetch('/dilution-forms')
      .then((r) => { cached = r; return r; })
      .catch(() => { pending = null; return null; });
  }
  return pending;
}

/** The dilution list in force, or null until loaded (or when `wanted` is false). */
export default function useDilutionForms(wanted = true) {
  const [limits, setLimits] = useState(cached);
  useEffect(() => {
    if (!wanted || limits) return undefined;
    let live = true;
    load().then((r) => { if (live && r) setLimits(r); });
    return () => { live = false; };
  }, [wanted, limits]);
  return wanted ? limits : null;
}
