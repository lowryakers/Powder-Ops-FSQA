import { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Lock, Banknote } from 'lucide-react';

// Danny's payment-run page (D-361), opened from the texted link — no login.
// The same experience as the flavor approval: the details, one button, the
// decision logged. What ProDough owes leads; the bills follow, flagged ones
// first. He can untick a bill (not a must-pay), approve once, then say when he
// has sent the money. The server logs his typed name, address and device on
// every step; this page decides nothing.

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const api = async (path, body) => {
  const r = await fetch(`/api/payment-approval/${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
};

function Part({ label, value, sub }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div><div className="text-[14px] text-gray-800">{label}</div>{sub && <div className="text-[11px] text-gray-500">{sub}</div>}</div>
      <div className="text-[15px] font-semibold tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

export default function PaymentApprovePage({ token }) {
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('payment_approver_name') || ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState('');
  const [sentDone, setSentDone] = useState(false);

  useEffect(() => {
    api(encodeURIComponent(token)).then(setRun).catch(e => setError(e.message));
  }, [token]);
  useEffect(() => { try { if (name.trim()) localStorage.setItem('payment_approver_name', name.trim()); } catch { /* private mode */ } }, [name]);

  const act = async (fn) => {
    setBusy(true); setError('');
    try { setRun(await fn()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const toggle = (l) => act(() => api(`${encodeURIComponent(token)}/lines/${l.id}`, { included: !l.included, name }));
  const approve = () => act(async () => { const v = await api(`${encodeURIComponent(token)}/approve`, { name }); setConfirming(false); return v; });
  const transferred = () => act(async () => {
    const v = await api(`${encodeURIComponent(token)}/transferred`, { name, amount: amount === '' ? undefined : amount });
    setSentDone(true); return v;
  });

  if (error && !run) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm text-center" data-pay-error>
          <AlertTriangle size={48} className="mx-auto mb-3 text-amber-500" />
          <p className="font-medium text-gray-700">{error}</p>
        </div>
      </div>
    );
  }
  if (!run) return <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-400">Loading…</div>;

  const o = run.status === 'sent' ? run.summary : (run.approved_summary || run.summary);
  const lines = [...run.lines].sort((a, b) => (b.must_pay - a.must_pay) || ((b.flags.some(f => f.severity === 'highlight') ? 1 : 0) - (a.flags.some(f => f.severity === 'highlight') ? 1 : 0)) || (b.flags.length - a.flags.length));
  const named = name.trim().length >= 2;

  if (sentDone || run.status === 'transferred') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm text-center" data-pay-done>
          <CheckCircle size={64} className="mx-auto mb-4 text-green-500" />
          <h1 className="mb-1 text-2xl font-bold text-gray-900">Transfer recorded</h1>
          <p className="text-gray-600">{money(run.transferred_amount)} for run {run.run_no}. Lowry and the Controller have been told. You can close this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8" data-pay-page data-pay-status={run.status}>
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-powder-600"><Banknote size={24} className="text-white" /></div>
          <h1 className="text-2xl font-bold text-gray-900">Payment run</h1>
          <p className="mt-1 text-sm text-gray-500">{run.run_no}{run.kind === 'urgent' ? ' · urgent' : ''} · {day(run.run_date)}</p>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-[13px] text-gray-500">ProDough owes Powder Ops</p>
          <p className="text-3xl font-bold tabular-nums text-gray-900" data-pay-owes>{money(o.owes)}</p>
          <div className="mt-3 divide-y divide-gray-100 border-t border-gray-100">
            <Part label="Materials" sub="ProDough material bills on this run, at cost" value={money(o.materials)} />
            {o.production_count > 0 && <Part label={`${o.production_count} production run${o.production_count === 1 ? '' : 's'}`} value={money(o.production)} />}
            {o.shortfall > 0 && <Part label="Shortfall" sub={`Powder Ops expenses ${money(o.expenses)} less the bank balance used, ${money(o.bank_balance)}`} value={money(o.shortfall)} />}
          </div>
          {run.reason && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-800">Urgent: {run.reason}</p>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <header className="flex items-baseline justify-between border-b border-gray-100 px-4 py-2.5">
            <h2 className="text-[14px] font-semibold text-gray-900">{o.bills} bill{o.bills === 1 ? '' : 's'}, {money(o.bills_total)}</h2>
            {run.status === 'sent' && <span className="text-[11px] text-gray-500">Untick a bill to leave it for next week</span>}
          </header>
          <ul className="divide-y divide-gray-100">
            {lines.map(l => {
              const hl = l.flags.some(f => f.severity === 'highlight');
              return (
                <li key={l.id} className={`px-4 py-3 ${l.included ? '' : 'bg-gray-50'} ${hl && l.included ? 'border-l-4 border-amber-400' : ''}`} data-pay-line={l.id} data-pay-included={l.included ? '1' : '0'}>
                  <div className="flex items-start gap-3">
                    {run.status === 'sent' ? (
                      l.must_pay ? <Lock size={18} className="mt-0.5 shrink-0 text-gray-500" aria-label="Must-pay" />
                        : <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={l.included} disabled={busy} onChange={() => toggle(l)} aria-label={`Pay ${l.vendor}`} data-pay-tick />
                    ) : <span className="mt-0.5 h-5 w-5 shrink-0">{l.included ? '✓' : ''}</span>}
                    <div className={`min-w-0 flex-1 ${l.included ? '' : 'text-gray-400 line-through'}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[14px] font-semibold text-gray-900">{l.vendor}</span>
                        <span className="text-[14px] font-semibold tabular-nums">{money(l.amount)}</span>
                      </div>
                      <div className="text-[12px] text-gray-600">
                        {[l.what, l.qty_text, l.invoice_number && `#${l.invoice_number}`, `due ${day(l.due_date)}`].filter(Boolean).join(' · ')}
                      </div>
                      <div className="text-[11px] text-gray-500">{l.must_pay ? 'Must-pay · ' : ''}{l.bill_class === 'prodough_material' ? 'ProDough material' : 'Powder Ops expense'}</div>
                      {l.flags.map((f, i) => (
                        <p key={i} className={`mt-1 text-[12px] ${f.severity === 'highlight' ? 'font-medium text-amber-800' : 'text-gray-600'}`}>{f.severity === 'highlight' ? '⚠ ' : ''}{f.reason}</p>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <input value={name} onChange={e => setName(e.target.value)} type="text" autoComplete="name" placeholder="Your name"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-base" data-pay-name />
          {error && <p className="text-sm text-red-600">{error}</p>}
          {run.status === 'sent' && (confirming ? (
            <div className="space-y-2">
              <p className="text-center text-sm font-medium text-gray-700">Approve {o.bills} bills and a transfer of {money(o.owes)}?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={approve} disabled={busy} className="rounded-xl bg-green-600 py-3 font-bold text-white disabled:opacity-50" data-pay-confirm>{busy ? 'Saving…' : 'Yes, approve'}</button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-xl bg-gray-100 py-3 font-bold text-gray-700">Back</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setConfirming(true)} disabled={!named || !o.bills} data-pay-approve
                className="w-full rounded-xl bg-green-600 py-4 text-lg font-bold text-white active:scale-[0.98] disabled:opacity-40">✓ Approve</button>
              {!named && <p className="text-center text-xs text-gray-500">Type your name above: the record has to say who approved.</p>}
            </>
          ))}
          {run.status === 'approved' && (
            <div className="space-y-2" data-pay-transfer>
              <p className="text-sm text-gray-700">Approved by {run.approved_name}. When you have sent the money, say so here.</p>
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder={`Amount sent (${money(o.owes)})`}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-base" data-pay-amount />
              <button type="button" onClick={transferred} disabled={!named || busy} data-pay-sent
                className="w-full rounded-xl bg-powder-600 py-4 text-lg font-bold text-white disabled:opacity-40">I've sent {money(amount === '' ? o.owes : amount)}</button>
            </div>
          )}
          <p className="text-center text-[11px] text-gray-400">This link works for this run only and expires {run.expires_at ? new Date(run.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'soon'}.</p>
        </section>
      </div>
    </div>
  );
}
