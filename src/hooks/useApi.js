import { useState, useEffect, useCallback } from 'react';

const BASE = '/api';

// While an admin previews the app as another user ("View as"), writes are
// blocked client-side (the API would still act as the admin, so any change
// made from inside the preview would be mis-attributed), and reads carry an
// X-View-As header so the server scopes lists (e.g. comms channels) to the
// previewed user. Set/cleared by AuthProvider.
let viewAsUser = null; // { id, name } | null
export function setViewAsWriteGuard(target) { viewAsUser = target || null; }

async function apiFetch(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (viewAsUser && method !== 'GET') {
    window.dispatchEvent(new CustomEvent('view-as-blocked'));
    throw new Error(`Read-only preview — exit "Viewing as ${viewAsUser.name}" to make changes.`);
  }
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(viewAsUser && { 'X-View-As': viewAsUser.id }),
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
    // A null path means "nothing to fetch yet" (e.g. the caller isn't allowed
    // this endpoint), so callers can keep hooks unconditional.
    if (!path) { setLoading(false); return undefined; }
    setLoading(true);
    setError(null);
    apiFetch(path)
      .then(d => { if (!stale) setData(d); })
      .catch(e => { if (!stale) setError(e.message); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
     
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

// Pass onProgress to get 0-100 as the bytes go out. fetch() can't report
// request progress at all, so anything that needs a real progress bar (video,
// which can be 200 MB) goes through XMLHttpRequest instead.
export async function apiUpload(path, formData, method = 'POST', onProgress) {
  if (viewAsUser) {
    window.dispatchEvent(new CustomEvent('view-as-blocked'));
    throw new Error(`Read-only preview — exit "Viewing as ${viewAsUser.name}" to make changes.`);
  }
  const token = localStorage.getItem('auth_token');
  if (!onProgress) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, { method, headers, body: formData });
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

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${BASE}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    // The bytes are out but the server is still streaming them to storage —
    // hold at 100 rather than snapping back or looking stalled.
    xhr.upload.onload = () => onProgress(100);
    xhr.onload = () => {
      let payload = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* non-JSON error body */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(payload);
      if (xhr.status === 401) {
        localStorage.removeItem('auth_token');
        window.dispatchEvent(new CustomEvent('app-logout'));
      }
      reject(new Error(payload?.error || `API error ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(formData);
  });
}

export { apiFetch };
