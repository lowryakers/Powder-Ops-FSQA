import { useState } from 'react';
import { useApiGet, apiPost, apiFetch } from '../../hooks/useApi';
import { QrCode, Plus, Trash2, Copy, AlertTriangle, Check, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';
import KioskQrModal from '../kiosk/KioskQrModal.jsx';

// Keys for the QR posters.
//
// The kiosk pages are public because a QR code carries no session. A key binds
// each poster to its own kiosk, so the lists those pages need stop being
// readable by anyone who knows the address.
//
// THE SCREEN'S REAL JOB IS THE CHANGEOVER, not the key list. Posters are on
// walls and the lobby tablet is on a home screen; switching enforcement on
// before they are replaced breaks them all at once, in front of whoever is
// standing there. So the three states are laid out in order with the evidence
// for moving between them — the count of requests still arriving with no key.

const MODE_COPY = {
  off:  { label: 'Off', tone: 'bg-gray-100 text-gray-700',
    what: 'Nothing is checked. This is how the plant has always run.' },
  warn: { label: 'Counting', tone: 'bg-amber-100 text-amber-800',
    what: 'Posters without a key still work, and every one is counted. Stay here until the count stops rising.' },
  on:   { label: 'Enforced', tone: 'bg-green-100 text-green-800',
    what: 'A poster without a valid key is refused.' },
};

export default function KioskKeysSection() {
  const { data, refresh } = useApiGet('/kiosk-tokens');
  const [issued, setIssued] = useState(null);   // { slug, token } — shown once
  const [poster, setPoster] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const mode = data?.mode || 'off';
  const kiosks = data?.kiosks || [];
  const uncovered = kiosks.filter(k => !k.live);

  const setMode = async (m) => {
    setBusy(true); setError('');
    try { await apiPost('/kiosk-tokens/mode', { mode: m }); refresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const issue = async (k) => {
    setBusy(true); setError('');
    try {
      const r = await apiPost('/kiosk-tokens', { slug: k.slug, label: k.label });
      setIssued({ ...r, kiosk: k }); setCopied(false); refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const revoke = async (t) => {
    if (!window.confirm(`Revoke this key? Any poster printed with it stops working as soon as enforcement is on. Print a replacement first.`)) return;
    await apiFetch(`/kiosk-tokens/${t.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Kiosk keys</h3>
        <p className="text-sm text-gray-500">
          Each QR poster carries its own key, so the forms behind it are not open to anyone who knows the address.
        </p>
      </div>

      {/* ── The changeover, in order ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-700">Enforcement</span>
          {['off', 'warn', 'on'].map(m => (
            <button key={m} type="button" disabled={busy || m === mode} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${m === mode
                ? `${MODE_COPY[m].tone} border-transparent`
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {MODE_COPY[m].label}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600 mt-2">{MODE_COPY[mode].what}</p>

        {mode !== 'on' && (
          <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700 space-y-1.5">
            <p className="font-medium text-gray-900">Before switching on</p>
            <p>1. Issue a key for each kiosk below and print the new poster.</p>
            <p>2. Put the new posters up and re-add the lobby tablet to its home screen from the new link.</p>
            <p>3. Set this to <span className="font-medium">Counting</span> and leave it a few days.</p>
            <p>4. When nothing is still arriving without a key, switch to <span className="font-medium">Enforced</span>.</p>
          </div>
        )}

        {/* The evidence for step 4, rather than a guess. */}
        {mode === 'warn' && (
          <div className={`mt-3 rounded-lg p-3 text-sm border ${data?.untokened_total
            ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-green-50 border-green-200 text-green-900'}`}>
            {data?.untokened_total ? (
              <>
                <span className="font-medium">{data.untokened_total} request{data.untokened_total === 1 ? '' : 's'} still arriving with no key</span>
                {data.untokened_last_at && <> — most recently {formatDateTime(data.untokened_last_at)}.</>}
                {' '}An old poster is still in use somewhere. Switching on now would stop it working.
              </>
            ) : (
              <><ShieldCheck size={14} className="inline mb-0.5 mr-1" />
              Nothing has arrived without a key since the counter was last reset. Safe to enforce.</>
            )}
            <button type="button" onClick={async () => { await apiPost('/kiosk-tokens/reset-counter', {}); refresh(); }}
              className="ml-2 underline font-medium">Reset the count</button>
          </div>
        )}

        {mode === 'on' && uncovered.length > 0 && (
          <p className="mt-3 flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {uncovered.map(k => k.label).join(', ')} {uncovered.length === 1 ? 'has' : 'have'} no key — {uncovered.length === 1 ? 'that poster is' : 'those posters are'} refusing scans right now.
          </p>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />{error}
        </p>
      )}

      {/* A key, shown exactly once. */}
      {issued && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-green-900">
            Key issued for {issued.kiosk.label}
          </p>
          <p className="text-sm text-green-900">
            Print the poster now — the key is inside the QR code and is <span className="font-medium">not shown again</span>.
            If it gets lost, issue a new one and reprint.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setPoster({ ...issued.kiosk, kioskPath: issued.kiosk.path, kioskToken: issued.token })}
              className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
              <QrCode size={15} /> Print the poster
            </button>
            <button type="button"
              onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${issued.kiosk.path}?k=${issued.token}`); setCopied(true); }}
              className="px-3 py-2 bg-white border border-green-300 text-green-900 rounded-lg text-sm font-medium flex items-center gap-1.5">
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy the link'}
            </button>
            <button type="button" onClick={() => setIssued(null)}
              className="px-3 py-2 text-gray-600 text-sm font-medium">Done</button>
          </div>
        </div>
      )}

      {/* ── One row per poster ── */}
      <div className="space-y-2">
        {kiosks.map(k => {
          const keys = (data?.tokens || []).filter(t => t.slug === k.slug);
          const live = keys.filter(t => !t.revoked_at);
          return (
            <div key={k.slug} className="bg-white rounded-xl border border-gray-200 p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{k.label}</p>
                  <p className="text-xs text-gray-500">{k.path}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${live.length
                    ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {live.length ? `${live.length} key${live.length === 1 ? '' : 's'}` : 'no key'}
                  </span>
                  <button type="button" onClick={() => issue(k)} disabled={busy}
                    className="px-2.5 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 flex items-center gap-1">
                    <Plus size={13} /> Issue a key
                  </button>
                </div>
              </div>

              {mode === 'warn' && k.untokened_requests > 0 && (
                <p className="text-[11px] text-amber-700 mt-1.5">
                  {k.untokened_requests} scan{k.untokened_requests === 1 ? '' : 's'} of an old poster since the counter was reset
                </p>
              )}

              {keys.length > 0 && (
                <div className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
                  {keys.map(t => (
                    <div key={t.id} className="py-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className={t.revoked_at ? 'text-gray-400 line-through' : 'text-gray-600'}>
                        Issued {formatDateTime(t.created_at)}{t.created_by ? ` by ${t.created_by}` : ''}
                        {t.use_count > 0 && <> · used {t.use_count}×{t.last_used_at ? `, last ${formatDateTime(t.last_used_at)}` : ''}</>}
                        {t.use_count === 0 && !t.revoked_at && <span className="text-amber-700"> · never scanned</span>}
                      </span>
                      {!t.revoked_at && (
                        <button type="button" onClick={() => revoke(t)} title="Revoke"
                          className="p-1 text-gray-400 hover:text-red-600 shrink-0"><Trash2 size={13} /></button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-400">
        A key is stored hashed and shown in clear once. Revoking one stops that poster the moment enforcement
        is on; every issue and revoke is in the audit log.
      </p>

      {poster && <KioskQrModal cfg={poster} onClose={() => setPoster(null)} />}
    </div>
  );
}
