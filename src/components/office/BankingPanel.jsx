import { useState, useMemo } from 'react';
import { useApiGet, apiFetch, apiPost, apiUpload, apiDelete } from '../../hooks/useApi';
import ModuleTabs from '../common/ModuleTabs.jsx';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore';
import {
  Landmark, Upload, RefreshCw, X, Plus, Search, Link2, AlertTriangle,
  CircleCheck, Lock,
} from 'lucide-react';

// Reconciling an account without a bookkeeper.
//
// The whole screen is built around one number — how many lines are still
// unaccounted for — because that is the number somebody is being paid by the
// hour to drive to zero. Everything else is in service of it: the statement
// comes in, the obvious pairs match themselves, and what is left is a short
// list with a reason beside each one.
//
// The arithmetic is entirely server-side (server/bank-match.js). Nothing here
// re-adds a balance: a second opinion computed in the browser is how a screen
// and its ledger start disagreeing about whether a month closed.

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

const STATUS = {
  unmatched: { label: 'Needs a decision', cls: 'bg-amber-100 text-amber-800' },
  matched: { label: 'Matched', cls: 'bg-green-100 text-green-800' },
  no_document: { label: 'No document', cls: 'bg-gray-100 text-gray-700' },
  ignored: { label: 'Ignored', cls: 'bg-gray-100 text-gray-400' },
};

const TARGET_LABEL = {
  ap_invoice: 'AP bill', ar_invoice: 'AR invoice',
  reimbursement: 'Reimbursement', partner_settlement: 'Partner settlement',
};

/* ── One line, and what it might be ───────────────────────────────────────── */

function TransactionRow({ txn, canAct, onChanged }) {
  const [open, setOpen] = useState(false);
  const [sugg, setSugg] = useState(null);
  const [busy, setBusy] = useState(false);
  const out = Number(txn.amount) < 0;

  const load = async () => {
    setOpen(o => !o);
    if (sugg) return;
    try { setSugg(await apiFetch(`/banking/transactions/${txn.id}/suggestions`)); }
    catch { setSugg({ suggestions: [] }); }
  };
  const act = async (fn) => {
    setBusy(true);
    try { await fn(); onChanged(); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };

  return (
    <div className={`border-b border-gray-100 ${txn.status === 'unmatched' ? 'bg-amber-50/30' : ''}`}>
      <button onClick={load} className="w-full text-left px-3 py-2.5 hover:bg-gray-50">
        <div className="flex items-start gap-3">
          <span className="text-xs text-gray-500 w-20 shrink-0 pt-0.5">{txn.posted_date}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-gray-900 truncate">{txn.description || '(no description)'}</span>
            <span className="flex items-center gap-1.5 mt-0.5">
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${STATUS[txn.status]?.cls}`}>
                {STATUS[txn.status]?.label}
              </span>
              {txn.pending ? <span className="text-[10px] text-gray-400">pending</span> : null}
              {txn.category ? <span className="text-[10px] text-gray-400">{txn.category}</span> : null}
              {txn.matches?.length ? (
                <span className="text-[10px] text-green-700">
                  → {TARGET_LABEL[txn.matches[0].target_type] || txn.matches[0].target_type}
                  {txn.matches.length > 1 ? ` +${txn.matches.length - 1}` : ''}
                  {txn.matches[0].auto ? ' · matched automatically' : ''}
                </span>
              ) : null}
              {txn.resolution_note ? <span className="text-[10px] text-gray-400">{txn.resolution_note}</span> : null}
            </span>
          </span>
          <span className={`text-sm font-semibold whitespace-nowrap ${out ? 'text-gray-900' : 'text-green-700'}`}>
            {out ? '' : '+'}{money(txn.amount)}
          </span>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pl-24">
          {txn.reconciliation_id ? (
            <p className="text-xs text-gray-500 flex items-center gap-1"><Lock size={11} /> Inside a closed reconciliation.</p>
          ) : !canAct ? (
            <p className="text-xs text-gray-500">Matching is an office job.</p>
          ) : txn.status !== 'unmatched' ? (
            <button onClick={() => act(() => apiDelete(`/banking/transactions/${txn.id}/match`))} disabled={busy}
              className="text-xs text-powder-600 hover:underline">Undo this and decide again</button>
          ) : !sugg ? (
            <p className="text-xs text-gray-400">Looking for a match…</p>
          ) : (
            <div className="space-y-2">
              {sugg.ambiguous && (
                <p className="text-[11px] text-amber-700">
                  Two documents fit this equally well, so it wasn&apos;t matched automatically — pick the right one.
                </p>
              )}
              {sugg.suggestions?.length ? sugg.suggestions.map(s => (
                <div key={`${s.type}:${s.id}`} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-900">{s.detail || s.label}</span>
                    <span className="block text-[11px] text-gray-500">{s.reasons.join(' · ')}</span>
                  </span>
                  <button onClick={() => act(() => apiPost(`/banking/transactions/${txn.id}/match`, {
                    target_type: s.type, target_id: s.id, confidence: s.score,
                  }))} disabled={busy}
                    className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 shrink-0">
                    That&apos;s it
                  </button>
                </div>
              )) : (
                <p className="text-xs text-gray-500">
                  Nothing in the ledgers matches this amount. If it isn&apos;t an invoice — a bank fee,
                  interest, a transfer — say what it was.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={() => {
                  const note = window.prompt('What was it? (bank fee, interest, transfer to savings…)');
                  if (!note?.trim()) return;
                  const remember = window.confirm('Remember this, so lines like it are handled automatically next time?');
                  act(() => apiPost(`/banking/transactions/${txn.id}/resolve`, { note, category: note.slice(0, 60), remember }));
                }} disabled={busy}
                  className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50">
                  No document — it was…
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export default function BankingPanel({ user }) {
  const [accountId, setAccountId] = useState('');
  const [view, setView] = useState('review');
  const [status, setStatus] = useState('unmatched');
  const [q, setQ] = useState('');
  const [periodEnd, setPeriodEnd] = useState(monthEnd());
  const [stmtBalance, setStmtBalance] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const { data: accountData, refresh: refreshAccounts } = useApiGet('/banking/accounts');
  const accounts = useMemo(() => accountData?.accounts || [], [accountData]);
  const account = accounts.find(a => a.id === accountId) || accounts[0] || null;
  const id = account?.id;
  const canAct = accountData?.can_reconcile
    || user?.role === 'admin'
    || (user?.role === 'supervisor' && ['office', 'admin'].includes((user?.department || '').toLowerCase()));

  const tp = new URLSearchParams();
  if (status !== 'all') tp.set('status', status);
  if (q.trim()) tp.set('q', q.trim());
  const { data: txnData, refresh: refreshTxns } = useApiGet(
    id ? `/banking/accounts/${id}/transactions?${tp}` : null, [id, status, q]);

  const rp = new URLSearchParams({ period_end: periodEnd });
  if (stmtBalance !== '') rp.set('statement_balance', stmtBalance);
  const { data: recon, refresh: refreshRecon } = useApiGet(
    id ? `/banking/accounts/${id}/reconciliation?${rp}` : null, [id, periodEnd, stmtBalance]);
  const { data: history, refresh: refreshHistory } = useApiGet(
    id ? `/banking/accounts/${id}/reconciliations` : null, [id]);

  const txns = useMemo(() => txnData?.transactions || [], [txnData]);
  const listView = useCappedList(txns);
  const reload = () => { refreshTxns(); refreshRecon(); refreshAccounts(); };

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); reload(); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };

  const importStatement = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setBusy(true); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiUpload(`/banking/accounts/${id}/import`, fd);
      setImportResult(r);
      if (r.statement?.balance != null) setStmtBalance(String(r.statement.balance));
      reload();
    } catch (e2) { window.alert(e2.message); }
    finally { setBusy(false); e.target.value = ''; }
  };

  const close = async () => {
    if (!recon?.balanced) return;
    if (!window.confirm(`Close ${periodEnd} at ${money(recon.statement_balance)}?\n\n${recon.transaction_count} transactions are stamped into it and stop being editable.`)) return;
    await act(() => apiPost(`/banking/accounts/${id}/reconciliation`, {
      period_end: periodEnd, statement_balance: recon.statement_balance,
    }).then(refreshHistory));
  };

  if (!accounts.length) {
    return (
      <div className="space-y-4">
        <Header onAdd={() => setAdding(true)} canAct={canAct} feed={accountData?.feed} />
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
          <Landmark size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-600">No bank account set up yet.</p>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            Add one with the balance it started from, then import a statement — or connect the bank
            directly if a feed is configured.
          </p>
        </div>
        {adding && <AccountForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refreshAccounts(); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header onAdd={() => setAdding(true)} canAct={canAct} feed={accountData?.feed} />

      <div className="flex flex-wrap items-center gap-2">
        <select value={account?.id || ''} onChange={e => setAccountId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          {accounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{a.mask ? ` ••${a.mask}` : ''}{a.unmatched ? ` — ${a.unmatched} to review` : ''}
            </option>
          ))}
        </select>
        {canAct && (
          <>
            <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
              <Upload size={14} /> Import statement
              <input type="file" accept=".csv,.ofx,.qfx,text/csv" onChange={importStatement} className="hidden" />
            </label>
            {account?.provider === 'plaid' && (
              <button onClick={() => act(() => apiPost(`/banking/accounts/${id}/sync`, {}))} disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Sync
              </button>
            )}
          </>
        )}
        {account?.last_synced_at && (
          <span className="text-xs text-gray-400">last synced {(account.last_synced_at || '').slice(0, 16).replace('T', ' ')}</span>
        )}
      </div>

      {account?.last_sync_error && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Last sync failed: {account.last_sync_error}
        </p>
      )}

      {importResult && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900 flex items-start justify-between gap-3">
          <span>
            Read {importResult.created + importResult.updated} line{importResult.created + importResult.updated === 1 ? '' : 's'}
            {importResult.created ? ` (${importResult.created} new)` : ''}
            {importResult.auto_matched ? ` · ${importResult.auto_matched} matched automatically` : ''}
            {importResult.ruled ? ` · ${importResult.ruled} handled by a rule` : ''}
            {importResult.skipped ? ` · ${importResult.skipped} skipped` : ''}
          </span>
          <button onClick={() => setImportResult(null)} className="text-green-700 shrink-0"><X size={14} /></button>
        </div>
      )}

      {/* The one number this screen exists for. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`rounded-xl border-2 p-4 ${account?.unmatched ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50'}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Still to review</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{account?.unmatched ?? 0}</p>
          <p className="text-xs text-gray-600">
            {account?.unmatched ? 'lines with no document yet' : 'everything is accounted for'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Balance on the books</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{money(recon?.computed_balance)}</p>
          <p className="text-xs text-gray-500">opening {money(recon?.opening_balance)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reconciled through</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{account?.reconciled_through || '—'}</p>
          <p className="text-xs text-gray-500">{account?.transactions ?? 0} transactions on file</p>
        </div>
      </div>

      <ModuleTabs value={view} onChange={setView} tabs={[
        { id: 'review', label: 'Review', badge: account?.unmatched || undefined, badgeTone: 'alert' },
        { id: 'reconcile', label: 'Close a period' },
        { id: 'history', label: 'Closed', badge: history?.length },
      ]} />

      {view === 'review' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="unmatched">Needs a decision</option>
              <option value="matched">Matched</option>
              <option value="no_document">No document</option>
              <option value="all">Everything</option>
            </select>
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Description, reference…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {listView.items.map(t => (
              <TransactionRow key={t.id} txn={t} canAct={canAct} onChanged={reload} />
            ))}
            {txns.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-gray-400">
                {status === 'unmatched' ? 'Nothing waiting — every line is accounted for.' : 'Nothing here.'}
              </p>
            )}
            <ShowMore view={listView} noun="lines" />
          </div>
        </div>
      )}

      {view === 'reconcile' && recon && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Statement ends</span>
              <input type="date" value={periodEnd} max={today()} onChange={e => setPeriodEnd(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Closing balance on the statement</span>
              <input type="number" step="0.01" value={stmtBalance} onChange={e => setStmtBalance(e.target.value)}
                placeholder={String(recon.statement_balance ?? '')}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>

          <div className={`rounded-xl border-2 p-5 ${recon.balanced ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Difference</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{money(recon.difference)}</p>
            <p className="mt-0.5 text-sm font-medium text-gray-700">
              {recon.balanced ? 'The account agrees with the statement.' : 'The account does not agree with the statement yet.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
              <span><span className="text-gray-400">opening</span> {money(recon.opening_balance)}</span>
              <span className="text-gray-400">+</span>
              <span><span className="text-gray-400">cleared</span> {money(recon.cleared_total)}</span>
              <span className="text-gray-400">=</span>
              <span className="font-semibold text-gray-900">{money(recon.computed_balance)}</span>
              <span className="text-gray-400">vs statement</span>
              <span className="font-semibold text-gray-900">{money(recon.statement_balance)}</span>
            </div>
            {recon.unresolved > 0 && (
              <p className="mt-2 text-sm text-amber-900">
                {recon.unresolved} line{recon.unresolved === 1 ? '' : 's'} in this period still need a decision.
                <button onClick={() => { setView('review'); setStatus('unmatched'); }} className="ml-1 underline">Review them</button>
              </p>
            )}
            {canAct && (
              <button onClick={close} disabled={!recon.balanced || recon.unresolved > 0 || busy}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-40">
                <CircleCheck size={15} /> Close this period
              </button>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              A period only closes when the difference is zero and nothing is left unexplained. Closing
              stamps those transactions so they stop moving underneath the next month.
            </p>
          </div>
        </div>
      )}

      {view === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {(history || []).map(r => (
            <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="font-medium text-gray-900">
                  {r.period_end} · {money(r.statement_balance)}
                  {r.status === 'reopened' && <span className="ml-2 text-xs text-amber-700">reopened</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {r.transaction_count} transactions · cleared {money(r.cleared_total)}
                  {r.reopened_reason ? ` · ${r.reopened_reason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-400">{(r.closed_at || '').slice(0, 10)} · {r.closed_by}</span>
                {user?.role === 'admin' && r.status === 'closed' && (
                  <button onClick={() => {
                    const reason = window.prompt('Why is this period being reopened?');
                    if (reason?.trim()) act(() => apiPost(`/banking/reconciliations/${r.id}/reopen`, { reason }).then(refreshHistory));
                  }} className="text-xs text-red-600 hover:underline">Reopen</button>
                )}
              </div>
            </div>
          ))}
          {(history || []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No period has been closed yet.</p>
          )}
        </div>
      )}

      {adding && <AccountForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refreshAccounts(); }} />}
    </div>
  );
}

function Header({ onAdd, canAct, feed }) {
  const connect = async () => {
    try {
      const { link_token } = await apiPost('/banking/feed/link-token', {});
      // Plaid Link is loaded on demand — the page carries no third-party script
      // until somebody actually chooses to connect a bank.
      window.alert(`Bank connection is configured. Link token issued (${String(link_token).slice(0, 12)}…).\n\nOpen Plaid Link with this token to finish connecting.`);
    } catch (e) { window.alert(e.message); }
  };
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Landmark size={18} className="text-powder-600" /> Banking &amp; Reconciliation
        </h3>
        <p className="text-sm text-gray-500 max-w-2xl">
          What the bank says happened, matched against what the ledgers say we did. The obvious pairs match
          themselves; what&apos;s left is a short list with a reason beside each one.
        </p>
      </div>
      {canAct && (
        <div className="flex items-center gap-2 shrink-0">
          {feed?.enabled && (
            <button onClick={connect}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
              <Link2 size={15} /> Connect a bank
            </button>
          )}
          <button onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={15} /> Add an account
          </button>
        </div>
      )}
    </div>
  );
}

function AccountForm({ onClose, onSaved }) {
  const [f, setF] = useState({ name: '', institution: '', account_type: 'checking', mask: '', opening_balance: '', opening_date: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await apiPost('/banking/accounts', f); onSaved(); }
    catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md my-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Add a bank account</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Name *</span>
            <input required value={f.name} onChange={e => set('name', e.target.value)}
              placeholder="Operating checking" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>
          <div className="grid gap-3 grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Bank</span>
              <input value={f.institution} onChange={e => set('institution', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Last 4</span>
              <input value={f.mask} onChange={e => set('mask', e.target.value)} maxLength={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>
          <div className="grid gap-3 grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Opening balance *</span>
              <input required type="number" step="0.01" value={f.opening_balance}
                onChange={e => set('opening_balance', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">As at</span>
              <input type="date" value={f.opening_date} onChange={e => set('opening_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>
          <p className="text-[11px] text-gray-500">
            The opening balance is what every reconciliation is built on — use the closing balance of the
            last statement you reconciled elsewhere, and start importing from the one after it.
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Add it'}
          </button>
        </div>
      </form>
    </div>
  );
}
