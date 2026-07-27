import { useState, useEffect } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Copy, Check, RefreshCw, Link2 } from 'lucide-react';

// Everything Intuit's developer portal asks for when you register the app,
// in one place with copy buttons — including the outbound IP address, which
// can only be discovered by asking the server itself.
function Row({ label, value, hint, onCopy, copied, busy, onRefresh }) {
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="text-sm text-gray-900 font-mono break-all">{busy ? 'Checking…' : (value || '—')}</p>
          {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
        </div>
        {onRefresh && (
          <button onClick={onRefresh} disabled={busy} title="Check again"
            className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-40">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          </button>
        )}
        <button onClick={() => onCopy(value)} disabled={!value || busy}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-powder-700 hover:bg-powder-50 disabled:opacity-40 shrink-0">
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
    </div>
  );
}

export default function QuickBooksSetupCard() {
  const [ip, setIp] = useState(null);
  const [ipError, setIpError] = useState('');
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState(null);
  const [copied, setCopied] = useState(null);

  // The public front door is what a reviewer should be shown, even when an
  // admin happens to be working on the Railway origin.
  const publicBase = 'https://start.powder-ops.com';

  const loadIp = () => {
    setChecking(true); setIpError('');
    apiFetch('/finance/quickbooks/egress-ip')
      .then(d => setIp(d.ip))
      .catch(e => setIpError(e.message || 'Could not check'))
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    loadIp();
    apiFetch('/finance/quickbooks/status').then(setStatus).catch(() => {});
  }, []);

  const copy = (value) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 2000);
  };

  const fields = [
    { label: 'Country (where the app is hosted)', value: 'United States' },
    {
      label: 'IP address', value: ip, refresh: true, busy: checking,
      hint: ipError
        ? `Couldn't check just now: ${ipError}`
        : 'This is the address QuickBooks sees our requests come from. Choose "Single IP address" and paste this. If the sync ever stops working, check here again — hosting can move us to a new address.',
    },
    { label: 'Host domain', value: 'powder-ops.com' },
    { label: 'Launch URL', value: `${publicBase}/` },
    { label: 'End-user licence agreement (EULA) URL', value: `${publicBase}/terms` },
    { label: 'Privacy policy URL', value: `${publicBase}/privacy` },
    { label: 'Disconnect URL', value: `${publicBase}/quickbooks/disconnect` },
    {
      label: 'Redirect URI', value: 'https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl',
      hint: 'Only needed while getting the refresh token through Intuit’s OAuth Playground.',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Link2 size={16} className="text-powder-600" /> QuickBooks connection details
          </h3>
          <p className="text-sm text-gray-500">
            What to paste into the Intuit developer portal when registering this app.
          </p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${status?.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {status?.enabled ? `Connected (${status.environment})` : 'Not connected yet'}
        </span>
      </div>

      <div>
        {fields.map(f => (
          <Row key={f.label} label={f.label} value={f.value} hint={f.hint}
            busy={f.busy} onCopy={copy} copied={copied === f.value}
            onRefresh={f.refresh ? loadIp : null} />
        ))}
      </div>

      <p className="text-[11px] text-gray-400">
        The four secrets from Intuit (client ID, client secret, realm ID, refresh token) go into the
        server&apos;s environment variables, not here — they are never stored in the app&apos;s database.
      </p>
    </div>
  );
}
