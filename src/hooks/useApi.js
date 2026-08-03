import { useState, useEffect, useCallback } from 'react';
import { notifyDataChanged } from '../lib/dataChanged';

const BASE = '/api';

// Any write can move one of the counts behind the sidebar badges and the bell,
// so every successful non-GET announces itself from here. Doing it centrally
// rather than per-module is the point: a stale badge was the bug, and it came
// from a module having to remember.
//
// Skipped: chat traffic and cached translations. Those are writes by method
// only — a message, a read receipt, a translation — they feed no compliance
// count, and they happen constantly. Note the asymmetry that makes this list
// safe: getting it wrong costs a few extra 4ms GETs, while forgetting to opt a
// module IN is the bug being fixed. So the default is on and the list is short.
// The two comms endpoints that DO create records (to-task, to-record) call
// notifyDataChanged() at their call sites.
const NO_BADGE_PATHS = ['/comms/', '/ai/'];
const movesBadge = (path, method) =>
  method !== 'GET' && !NO_BADGE_PATHS.some(p => path.startsWith(p));

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
  if (movesBadge(path, method)) notifyDataChanged();
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
    // Uploads move counts too — attaching an SDS clears "chemical missing SDS".
    if (movesBadge(path, method)) notifyDataChanged();
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
      if (xhr.status >= 200 && xhr.status < 300) {
        if (movesBadge(path, method)) notifyDataChanged();
        return resolve(payload);
      }
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
