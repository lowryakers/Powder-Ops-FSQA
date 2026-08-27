import { useState, useEffect, useCallback, useRef } from 'react';
import { notifyDataChanged } from '../lib/dataChanged';
import {
  isNetworkError, mayQueue, queueWrite, flushQueue, cacheRead, cachedRead,
} from '../lib/offline';

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

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (err) {
    // fetch only rejects when the request never completed — the radio is off,
    // there's no route. An HTTP 400 resolves and is handled below, because the
    // server said no and hiding that behind "we'll try later" is how a rejected
    // record looks saved.
    if (!isNetworkError(err)) throw err;
    if (mayQueue(path, method)) {
      await queueWrite({ path, method, body: options.body ?? null });
      // Leads with a tick because most forms render this in their error slot,
      // and a success that looks like a failure is how people stop trusting it.
      const queued = new Error('\u2713 Saved on this device — it will send by itself when you\'re back online.');
      queued.queued = true;
      throw queued;
    }
    const offline = new Error(method === 'GET'
      ? 'No connection.'
      : 'This needs a connection — signatures and approvals are never sent later, because you have to be looking at the record you sign.');
    offline.offline = true;
    throw offline;
  }

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('auth_token');
      window.dispatchEvent(new CustomEvent('app-logout'));
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  if (movesBadge(path, method)) notifyDataChanged();
  const data = await res.json();
  // Every successful GET is the copy the floor sees if the network drops on
  // the next screen. Fire and forget — a cache write must never delay a render.
  if (method === 'GET') cacheRead(path, data).catch(() => {});
  return data;
}

// Replay the outbox. Goes straight to fetch rather than through apiFetch, so a
// still-flaky connection re-queues nothing and the queue stays the one place
// pending work lives.
async function sendQueued(row) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`${BASE}${row.path}`, {
    method: row.method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: row.body ? JSON.stringify(row.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error ${res.status}`);
  }
  return res.json().catch(() => null);
}

export async function flushOutbox() {
  const out = await flushQueue(sendQueued);
  if (out.sent > 0) notifyDataChanged();
  return out;
}

// Drain on reconnect, and once at start-up for the tab that was closed offline.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushOutbox().catch(() => {}); });
  setTimeout(() => { flushOutbox().catch(() => {}); }, 2000);
}

export function useApiGet(path, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // True when what's on screen came from the offline cache rather than the
  // server. A screen that quietly shows yesterday's data is worse than one
  // that says so, so this travels back to the caller.
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);
  const depsKey = JSON.stringify(deps);
  // `refreshing` is a REFETCH OF THE SAME QUERY; `loading` is "there is nothing
  // to show yet". Callers almost all render `loading ? spinner : content`, so
  // while the two were the same thing every refresh() blanked the screen and
  // remounted everything under it — which is how reacting to a message in the
  // Threads inbox collapsed the card you were reading and wiped the reply you
  // had half-typed. State that lives in those children (expanded, drafts,
  // scroll position) cannot survive a remount, so the fix has to be that the
  // remount does not happen.
  //
  // A DIFFERENT QUERY IS NOT A REFRESH. Switching channel must not show the
  // previous channel's messages while the new ones load, so the data is
  // cleared when the path or deps change and kept when only `tick` does.
  const [refreshing, setRefreshing] = useState(false);
  const queryKey = `${path}|${depsKey}`;
  const lastQuery = useRef(null);

  useEffect(() => {
    let stale = false;
    // A null path means "nothing to fetch yet" (e.g. the caller isn't allowed
    // this endpoint), so callers can keep hooks unconditional.
    if (!path) { setLoading(false); return undefined; }
    const sameQuery = lastQuery.current === queryKey;
    lastQuery.current = queryKey;
    if (sameQuery) setRefreshing(true);
    else { setData(null); setLoading(true); }
    setError(null);
    apiFetch(path)
      .then(d => { if (!stale) { setData(d); setOffline(false); } })
      .catch(async (e) => {
        if (stale) return;
        // Fall back to the last copy of this exact screen. Only for a genuine
        // network failure — a 403 must still read as a 403.
        if (e.offline) {
          const hit = await cachedRead(path);
          if (hit && !stale) { setData(hit.data); setOffline(true); setError(null); return; }
        }
        if (!stale) setError(e.message);
      })
      .finally(() => { if (!stale) { setLoading(false); setRefreshing(false); } });
    return () => { stale = true; };

  }, [path, queryKey, tick]);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  return { data, loading, error, offline, refresh, refreshing };
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
