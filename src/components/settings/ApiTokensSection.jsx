import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { KeyRound, Plus, AlertTriangle, ShieldCheck, Ban } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';
import CopyButton from '../common/CopyButton.jsx';

// Bot API tokens (D-161).
//
// A bot that drove ReadyDoc through a browser held somebody's password. A token
// is tied to ONE named, non-admin account instead, can only do what that
// account can, can never approve, sign, release, delete or administer anything, and every call it
// makes is in the audit log under that account's name. The screen says all of
// that in words, because a key that does more than people think it does is how
// a control gets misused.

const STATE = {
  live: { label: 'Live', tone: 'bg-green-100 text-green-800' },
  revoked: { label: 'Revoked', tone: 'bg-gray-100 text-gray-600' },
  expired: { label: 'Expired', tone: 'bg-gray-100 text-gray-600' },
  account_inactive: { label: 'Account deactivated', tone: 'bg-amber-100 text-amber-800' },
  account_is_admin: { label: 'Account is now an admin — refused', tone: 'bg-red-100 text-red-800' },
};
const SCOPE_COPY = {
  read: 'Read — see products, panels, artwork, orders, AP Drop and partner balances this account can see.',
  write: 'Write — create and edit anything this account is allowed to: product records, artwork and files, supply orders, AP Drop uploads, partner reconciliation documents, draft nutrition panels, messages. Never more than the account itself can do.',
};
const NEVER = 'Never allowed with any token: approving, signing, verifying, releasing or settling anything; deleting or voiding anything; changing users, roles or permissions; managing tokens. Those always need a person signed in.';

export default function ApiTokensSection() {
  const { data, refresh } = useApiGet('/api-tokens');
  const [form, setForm] = useState({ user_id: '', label: '', write: false, expires_at: '' });
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accounts = data?.accounts || [];
  const tokens = data?.tokens || [];

  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiPost('/api-tokens', {
        user_id: form.user_id, label: form.label,
        scopes: form.write ? ['read', 'write'] : ['read'],
        expires_at: form.expires_at || null,
      });
      setIssued(r);
      setForm({ user_id: '', label: '', write: false, expires_at: '' });
      refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const revoke = async (t) => {
    if (!window.confirm(`Revoke "${t.label}"? The bot holding it stops working immediately.`)) return;
    setError('');
    try { await apiPost(`/api-tokens/${t.id}/revoke`, {}); refresh(); } catch (e) { setError(e.message); }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <div className="space-y-5" data-api-tokens>
      <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-sm text-indigo-900 flex gap-2">
        <ShieldCheck size={18} className="shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div>A token lets a bot use ReadyDoc <strong>as one account</strong> — it sees and does only what that account can, and every call is in the audit log under that account's name.</div>
          <div><strong>A token can never approve, sign, verify, release or settle anything, delete anything, or change users, permissions or tokens.</strong> Those need a person signed in. It cannot belong to an admin.</div>
          {data?.limits && <div className="text-xs text-indigo-700">Limited to {data.limits.read} requests, {data.limits.write} writes and {data.limits.bulk} bulk writes a minute per token.</div>}
        </div>
      </div>

      <section className="p-4 rounded-lg border border-gray-200 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2"><Plus size={16} /> New token</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="block text-xs text-gray-500 mb-1">Account the bot acts as</span>
            <select value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })} className={input} data-api-token-user>
              <option value="">Choose an account…</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.role}{a.department ? ` · ${a.department}` : ''}</option>)}
            </select>
          </label>
          <label className="block"><span className="block text-xs text-gray-500 mb-1">Label — which bot holds it</span>
            <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Jarvis — artwork proofing" className={input} data-api-token-label />
          </label>
          <label className="block"><span className="block text-xs text-gray-500 mb-1">Expires (optional)</span>
            <input type="date" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className={input} data-api-token-expiry />
          </label>
          <div className="space-y-1 text-sm">
            <span className="block text-xs text-gray-500">What it may do</span>
            <label className="flex items-start gap-2 text-gray-500"><input type="checkbox" checked disabled className="mt-1" /> {SCOPE_COPY.read}</label>
            <label className="flex items-start gap-2"><input type="checkbox" checked={form.write} onChange={e => setForm({ ...form, write: e.target.checked })} className="mt-1" data-api-token-write /> {SCOPE_COPY.write}</label>
            <p className="text-xs text-gray-600 pt-1" data-api-token-never>{NEVER}</p>
          </div>
        </div>
        <button type="button" onClick={create} disabled={busy || !form.user_id || form.label.trim().length < 3}
          className="px-3 py-2 rounded-lg bg-powder-600 text-white text-sm disabled:opacity-50" data-api-token-create>Create token</button>
        {!accounts.length && <div className="text-xs text-gray-500">No eligible accounts. Create a non-admin account for the bot in Users first.</div>}
      </section>

      {error && <div className="text-sm text-red-600" data-api-token-error>{error}</div>}

      {issued && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 space-y-2" data-api-token-issued>
          <div className="text-sm font-semibold text-amber-900 flex items-center gap-2"><AlertTriangle size={16} /> Copy this token now — it will not be shown again</div>
          <code className="block p-2 bg-white border border-amber-200 rounded text-xs break-all select-all" data-api-token-plaintext>{issued.plaintext}</code>
          <div className="flex flex-wrap gap-2 items-center">
            <CopyButton getText={issued.plaintext} label="Copy token" />
            <button type="button" onClick={() => setIssued(null)} className="px-3 py-2 rounded-lg border border-gray-300 text-sm">I have stored it</button>
          </div>
          <div className="text-xs text-amber-800">Send it as <code>Authorization: Bearer &lt;token&gt;</code>. Only its hash is kept here.</div>
        </div>
      )}

      <section>
        <h3 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2"><KeyRound size={16} /> Tokens</h3>
        {!tokens.length && <div className="text-sm text-gray-500">No tokens yet.</div>}
        <ul className="space-y-2">
          {tokens.map(t => {
            const st = STATE[t.state] || STATE.live;
            return (
              <li key={t.id} className="p-3 rounded-lg border border-gray-200 text-sm" data-api-token-row={t.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-gray-900">{t.label}</strong>
                  <code className="text-xs text-gray-500">{t.token_prefix}…</code>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${st.tone}`} data-api-token-state>{st.label}</span>
                  {t.state === 'live' && (
                    <button type="button" onClick={() => revoke(t)} className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 text-red-700 text-xs hover:bg-red-50" data-api-token-revoke>
                      <Ban size={12} /> Revoke
                    </button>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-600 grid gap-0.5 sm:grid-cols-2">
                  <div>Acts as <strong>{t.user_name || 'deleted account'}</strong></div>
                  <div>Scopes: {t.scopes.join(', ')}</div>
                  <div data-api-token-last-used>Last used: {t.last_used_at ? `${formatDateTime(t.last_used_at)}${t.last_used_ip ? ` from ${t.last_used_ip}` : ''}` : 'never'}</div>
                  <div>Created {formatDateTime(t.created_at)} by {t.created_by}{t.expires_at ? ` · expires ${formatDateTime(t.expires_at)}` : ''}</div>
                  {t.revoked_at && <div>Revoked {formatDateTime(t.revoked_at)} by {t.revoked_by}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
