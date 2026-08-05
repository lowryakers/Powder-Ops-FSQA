import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import {
  RefreshCw, Search, Database, CheckCircle2, AlertTriangle, Link2Off,
  ArrowDownToLine, Landmark,
} from 'lucide-react';

// The QuickBooks side of the Accounting hub.
//
// The point of this connection is NOT to keep using QuickBooks. It's to answer
// two questions honestly before anything is replaced:
//   1. What is actually in these books? (Discovery — counted, not recalled.)
//   2. Can we get all of it out? (The full pull — everything, not a sample.)
// So the screen leads with those two, and the day-to-day incremental sync is
// the small button underneath.

const GROUPS = [
  { id: 'lists', label: 'Lists', hint: 'The structure of the books' },
  { id: 'payable', label: 'Money out', hint: 'Bills, expenses, what we owe' },
  { id: 'receivable', label: 'Money in', hint: 'Invoices, payments, what we are owed' },
  { id: 'ledger', label: 'General ledger', hint: 'The part that decides how big a full replacement is' },
];

const when = (iso) => {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString());

function Stat({ label, value, tone = '' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${tone || 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

export default function QuickBooksPanel({ user }) {
  const { data: status, refresh: refreshStatus } = useApiGet('/finance/quickbooks/status');
  const { data: inventory, refresh: refreshInventory } = useApiGet('/finance/quickbooks/inventory');
  const { data: pulled, refresh: refreshPulled } = useApiGet('/finance/quickbooks/pulled');
  const { data: accounts } = useApiGet('/finance/quickbooks/accounts');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showAccounts, setShowAccounts] = useState(false);

  if (user?.role !== 'admin') {
    return <p className="text-sm text-gray-500">The QuickBooks connection is admin-only.</p>;
  }

  const run = async (what, path, body, describe) => {
    setBusy(what); setMsg(null);
    try {
      const r = await apiPost(path, body);
      setMsg({ tone: 'ok', text: describe(r) });
      refreshStatus(); refreshInventory(); refreshPulled();
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message });
    } finally { setBusy(null); }
  };

  if (!status?.enabled) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">QuickBooks</h2>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
            <Link2Off size={15} /> Not connected yet
          </p>
          <p className="text-sm text-amber-900 mt-1.5 max-w-2xl">
            Four values go into Railway — <code className="text-xs">QBO_CLIENT_ID</code>,{' '}
            <code className="text-xs">QBO_CLIENT_SECRET</code>, <code className="text-xs">QBO_REFRESH_TOKEN</code> and{' '}
            <code className="text-xs">QBO_REALM_ID</code>. The step-by-step is in{' '}
            <code className="text-xs">docs/quickbooks-api-setup.md</code>. Until then this screen has nothing
            to read, and nothing else in ReadyDoc is affected.
          </p>
          <p className="text-xs text-amber-800 mt-2">
            The connection is read-only by design — there is no code here that writes back to QuickBooks.
          </p>
        </div>
      </div>
    );
  }

  const ents = inventory?.entities || [];
  const inUse = ents.filter(e => e.count > 0);
  const unused = ents.filter(e => e.count === 0);
  const unreadable = ents.filter(e => e.count === null);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900">QuickBooks</h2>
          <p className="text-xs text-gray-500">
            Connected to {status.environment}
            {status.full_pull_at
              ? ` · full copy pulled ${when(status.full_pull_at)}`
              : ' · no full copy pulled yet'}
          </p>
        </div>
        <button
          onClick={() => run('sync', '/finance/quickbooks/sync', {},
            r => `Sync: ${r.bills.created + r.invoices.created} new, ${r.bills.updated + r.invoices.updated} updated since ${r.since}.`)}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 shrink-0">
          <RefreshCw size={14} className={busy === 'sync' ? 'animate-spin' : ''} /> Sync changes
        </button>
      </div>

      {msg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${msg.tone === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {msg.text}
        </p>
      )}

      {/* Step 1 — what is in there */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-1.5"><Search size={15} /> What is actually in these books</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              Counts every kind of record QuickBooks holds for this company. Reads only — it counts without
              downloading, so it is safe to re-run. Last checked {when(inventory?.checked_at)}.
            </p>
          </div>
          <button onClick={() => run('discover', '/finance/quickbooks/discover', {},
            r => `Checked ${r.entities.length} record types: ${r.in_use.length} in use, ${r.unused.length} empty.`)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50 shrink-0">
            <Search size={14} className={busy === 'discover' ? 'animate-pulse' : ''} /> Check
          </button>
        </div>

        {ents.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
              <Stat label="In use" value={inUse.length} />
              <Stat label="Empty — nothing to replace" value={unused.length} tone="text-green-700" />
              <Stat label="Couldn't read" value={unreadable.length} tone={unreadable.length ? 'text-amber-700' : ''} />
            </div>

            <div className="mt-3 space-y-3">
              {GROUPS.map(g => {
                const rows = ents.filter(e => e.group === g.id);
                if (!rows.length) return null;
                return (
                  <div key={g.id}>
                    <p className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                      {g.label} <span className="font-normal normal-case text-gray-400">· {g.hint}</span>
                    </p>
                    <div className="overflow-x-auto mt-1">
                      <table className="w-full text-sm min-w-[420px]">
                        <tbody>
                          {rows.map(e => (
                            <tr key={e.name} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 pr-3 text-gray-800">{e.label}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums w-24">
                                {e.error
                                  ? <span className="text-amber-700 text-xs">unreadable</span>
                                  : <span className={e.count ? 'text-gray-900 font-medium' : 'text-gray-400'}>{num(e.count)}</span>}
                              </td>
                              <td className="py-1.5 text-xs text-gray-500 whitespace-nowrap">
                                {e.error ? e.error
                                  : e.first ? `${e.first} → ${e.last}`
                                    : e.count === 0 ? 'not used' : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Step 2 — get it out */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
              <ArrowDownToLine size={15} /> Pull a full copy
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              Everything, with no date cutoff, plus the chart of accounts, vendors and customers. This is the
              migration — run it once, then keep it current with Sync changes. Re-running is safe: rows are
              matched on their QuickBooks id and updated in place.
            </p>
          </div>
          <button onClick={() => run('full', '/finance/quickbooks/sync', { full: true },
            r => `Full pull: ${r.bills.created + r.bills.updated} bills, ${r.invoices.created + r.invoices.updated} invoices, `
              + `${r.accounts.created + r.accounts.updated} accounts, ${r.vendors.created + r.vendors.updated} vendors, `
              + `${r.customers.created + r.customers.updated} customers.`)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50 shrink-0">
            <Database size={14} className={busy === 'full' ? 'animate-pulse' : ''} /> Pull everything
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
          <Stat label="Accounts" value={num(pulled?.accounts)} />
          <Stat label="Vendors" value={num(pulled?.vendors)} />
          <Stat label="Customers" value={num(pulled?.customers)} />
          <Stat label="Bills" value={num(pulled?.ap)} />
          <Stat label="Invoices" value={num(pulled?.ar)} />
        </div>

        {/* The count is the claim; the list is the evidence. */}
        {(pulled?.accounts > 0) && (
          <div className="mt-3">
            <button onClick={() => setShowAccounts(v => !v)}
              className="text-xs font-medium text-powder-700 hover:underline inline-flex items-center gap-1">
              <Landmark size={12} /> {showAccounts ? 'Hide' : 'Show'} the chart of accounts as pulled
            </button>
            {showAccounts && (
              <div className="overflow-x-auto mt-2 border border-gray-200 rounded-lg">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="text-left px-3 py-1.5">#</th>
                      <th className="text-left px-3 py-1.5">Account</th>
                      <th className="text-left px-3 py-1.5">Type</th>
                      <th className="text-right px-3 py-1.5">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(accounts || []).map(a => (
                      <tr key={a.id} className={`border-t border-gray-100 ${a.active ? '' : 'opacity-50'}`}>
                        <td className="px-3 py-1.5 tabular-nums text-gray-500">{a.acct_number || '—'}</td>
                        <td className="px-3 py-1.5 text-gray-900">
                          {a.fully_qualified || a.name}
                          {!a.active && <span className="ml-1.5 text-[10px] text-gray-500">(inactive)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600 text-xs">{a.account_type}{a.account_sub_type ? ` · ${a.account_sub_type}` : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                          {a.current_balance === null ? '—' : Number(a.current_balance).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1.5">
        <p className="text-xs text-gray-600 flex items-start gap-1.5">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-green-600" />
          <span><strong>Read-only.</strong> Nothing here writes back to QuickBooks, so none of it can change your books.</span>
        </p>
        <p className="text-xs text-gray-600 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            A refresh token that goes <strong>100 days unused</strong> expires for good and step 4 of the
            setup has to be redone. That is an Intuit rule, not ours — running a sync occasionally keeps it alive.
          </span>
        </p>
      </div>
    </div>
  );
}
