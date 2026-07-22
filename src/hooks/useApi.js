import { useState, useEffect, useCallback } from 'react';

const BASE = '/api';

// While an admin previews the app as another user ("View as"), writes are
// blocked client-side: the API would still act as the admin, so any change made
// from inside the preview would be mis-attributed. Set/cleared by AuthProvider.
let viewAsName = null;
export function setViewAsWriteGuard(name) { viewAsName = name || null; }

async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (viewAsName && method !== 'GET') {
    window.dispatchEvent(new CustomEvent('view-as-blocked'));
    throw new Error(`Read-only preview — exit "Viewing as ${viewAsName}" to make changes.`);
  }
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      window.dispatchEvent(new CustomEvent('app-logout'));
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export function useApiGet(path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    apiFetch(path)
      .then(d => { if (!stale) setData(d); })
      .catch(e => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, depsKey, tick]);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  return { data, loading, error, refresh };
}

export async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body });
}

export async function apiPut(path, body) {
  return apiFetch(path, { method: 'PUT', body });
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

export async function apiUpload(path, formData) {
  if (viewAsName) {
    window.dispatchEvent(new CustomEvent('view-as-blocked'));
    throw new Error(`Read-only preview — exit "Viewing as ${viewAsName}" to make changes.`);
  }
  const token = localStorage.getItem('auth_token');
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      window.dispatchEvent(new CustomEvent('app-logout'));
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json();
}

export { apiFetch };
