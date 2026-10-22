// The temperature and humidity limits IN FORCE (D-201), read from the server.
// The number is owned by Document Control through `controlled.js`; a copy here
// would tell the floor one limit while the record was graded against another —
// the ATP hint's reason (D-180). Fetched once per page, only when asked for.
import { useEffect, useState } from 'react';
import { apiFetch } from '../hooks/useApi';

let cached = null;
let pending = null;
function load() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = apiFetch('/env-limits')
      .then((r) => { cached = r; return r; })
      .catch(() => { pending = null; return null; });
  }
  return pending;
}

/** The limits in force, or null until loaded (or when `wanted` is false). */
export default function useEnvLimits(wanted = true) {
  const [limits, setLimits] = useState(cached);
  useEffect(() => {
    if (!wanted || limits) return undefined;
    let live = true;
    load().then((r) => { if (live && r) setLimits(r); });
    return () => { live = false; };
  }, [wanted, limits]);
  return wanted ? limits : null;
}
