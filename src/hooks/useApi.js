import { useState, useEffect, useCallback } from 'react';

const BASE = '/api';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
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

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch(path)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, ...deps]);

  useEffect(() => { refresh(); }, [refresh]);

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

export { apiFetch };
