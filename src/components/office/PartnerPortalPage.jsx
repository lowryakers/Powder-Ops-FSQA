import { useState, useEffect, useCallback } from 'react';
import {
  Scale, AlertTriangle, Upload, FileText, Check, ExternalLink, History,
} from 'lucide-react';

// What M4 sees. A public page, no login — the token in the URL is the whole
// credential, so the page is deliberately narrow: read the same ledger and the
// same number we're looking at, hand over their own paperwork, and say when
// they disagree with something.
//
// It shows the SAME arithmetic, with the signs flipped to their side of the
// table. A portal that showed the partner a different figure would defeat the
// point of having one.

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

async function call(path, options = {}) {
  const res = await fetch(`/api/partner-portal${path}`, {
    ...options,
    headers: options.body instanceof FormData ? undefined
      : { 'Content-Type': 'application/json', ...options.headers },
    body: options.body instanceof FormData ? options.body
      : options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function DocList({ title, rows, tone, token, onDispute }) {
  const total = (rows || []).reduce((t, r) => t + (r.signed || 0), 0);
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between ${tone === 'owe' ? 'bg-amber-50/60' : 'bg-green-50/60'}`}>
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <span className="text-sm font-bold text-gray-900">{money(total)}</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {(rows || []).map(r => (
          <li key={r.id} className="px-4 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-gray-900 truncate">
                  {r.doc_number || r.description || 'Document'}
                  <span className="ml-1.5 text-xs text-gray-400 capitalize">
                    {r.doc_type === 'po' ? 'purchase order' : r.doc_type}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  issued {r.issued_date || '—'} · due {r.due_date || '—'}
                  {r.description && r.doc_number ? ` · ${r.description}` : ''}
                </p>
              </div>
              <span className={`text-sm whitespace-nowrap ${r.signed < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(r.signed)}</span>
            </div>
            <div className="mt-1 flex items-center gap-3">
              {r.filename && (
                <button onClick={async () => {
                  try {
                    const { url } = await call(`/${token}/documents/${r.id}/file`);
                    if (url) window.open(url, '_blank');
                  } catch (e) { window.alert(e.message); }
                }} className="inline-flex items-center gap-1 text-[11px] text-powder-600 hover:underline">
                  <ExternalLink size={10} /> {r.filename}
                </button>
              )}
              <button onClick={() => onDispute(r)} className="text-[11px] text-gray-400 hover:text-red-600 hover:underline">
                This doesn&apos;t look right
              </button>
            </div>
          </li>
        ))}
        {(rows || []).length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">Nothing here.</li>}
      </ul>
    </div>
  );
}

export default function PartnerPortalPage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [form, setForm] = useState({
    direction: 'payable', doc_type: 'invoice', doc_number: '', reference: '',
    description: '', issued_date: new Date().toISOString().slice(0, 10), amount: '',
  });
  const [files, setFiles] = useState([]);

  const load = useCallback(() => {
    call(`/${encodeURIComponent(token)}`).then(setData).catch(e => setError(e.message));
  }, [token]);
  useEffect(load, [load]);

  const dispute = async (row) => {
    const reason = window.prompt(`What's wrong with ${row.doc_number || 'this document'}?`);
    if (!reason?.trim()) return;
    try {
      await call(`/${token}/documents/${row.id}/dispute`, { method: 'POST', body: { reason } });
      setSent('Flagged. It comes out of the number until it\'s sorted out, and Powder Ops can see why.');
      load();
    } catch (e) { window.alert(e.message); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
      for (const f of files) fd.append('files', f);
      const r = await call(`/${token}/documents`, { method: 'POST', body: fd });
      setSent(r.note || 'Received.');
      setForm(f => ({ ...f, doc_number: '', reference: '', description: '', amount: '' }));
      setFiles([]);
      load();
    } catch (e2) { setError(e2.message); }
    finally { setBusy(false); }
  };

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertTriangle size={48} className="mx-auto mb-3 text-amber-500" />
          <p className="text-gray-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading…</div>;
  }

  const nobody = data.owed_to === 'nobody';
  const youPay = data.owed_to === 'powder-ops';
  const tone = nobody ? 'border-gray-200 bg-gray-50' : youPay ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Scale size={18} className="text-powder-600" /> {data.partner.name} ⇄ Powder Ops
          </h1>
          <p className="text-sm text-gray-500">
            The same ledger both sides are looking at. Net {data.partner.terms_days}, settled monthly.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {sent && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-start gap-2">
            <Check size={15} className="mt-0.5 shrink-0" /> {sent}
          </div>
        )}

        <div className={`rounded-xl border-2 p-5 ${tone}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Settlement as at {data.as_of}
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{money(data.amount_due)}</p>
          <p className="mt-0.5 text-sm font-medium text-gray-700">
            {nobody ? 'Nothing is owed either way this period.'
              : youPay ? `${data.partner.name} pays Powder Ops`
                : `Powder Ops pays ${data.partner.name}`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
            <span><span className="text-gray-400">you owe</span> {money(data.you_owe)}</span>
            <span className="text-gray-400">−</span>
            <span><span className="text-gray-400">you&apos;re owed</span> {money(data.you_are_owed)}</span>
            <span className="text-gray-400">=</span>
            <span className="font-semibold text-gray-900">{money(Math.abs(data.net_amount))}</span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <DocList title="What you owe Powder Ops" rows={data.documents.you_owe} tone="owe" token={token} onDispute={dispute} />
          <DocList title="What Powder Ops owes you" rows={data.documents.you_are_owed} tone="owed" token={token} onDispute={dispute} />
        </div>

        {data.excluded_summary?.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Not in this number</h2>
            <p className="text-xs text-gray-500 mb-2">
              Deliberately left out of the figure above — anything not yet due lands in a later settlement.
            </p>
            <ul className="divide-y divide-gray-100">
              {data.excluded_summary.map(e => (
                <li key={e.reason} className="py-2 flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-800 capitalize">
                      {e.reason.replace('_', ' ')} · {e.count} document{e.count === 1 ? '' : 's'}
                    </span>
                    <span className="block text-xs text-gray-500">{e.note}</span>
                  </span>
                  <span className="text-xs text-gray-600 whitespace-nowrap text-right">
                    {e.receivable ? <span className="block">you owe {money(e.receivable)}</span> : null}
                    {e.payable ? <span className="block">you&apos;re owed {money(e.payable)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Upload size={15} className="text-powder-600" /> Send over an invoice or PO
          </h2>
          <p className="text-xs text-gray-500">
            It lands as a draft. Powder Ops confirms it as final once the goods or the run are done — that is
            when it starts counting towards the number above.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Which way does it go?</span>
              <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="payable">Our invoice to Powder Ops</option>
                <option value="receivable">Our PO / what we owe you</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Type</span>
              <select value={form.doc_type} onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="invoice">Invoice</option>
                <option value="po">Purchase order</option>
                <option value="credit">Credit note</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Number</span>
              <input value={form.doc_number} onChange={e => setForm(f => ({ ...f, doc_number: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Amount *</span>
              <input required type="number" step="0.01" min="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Issued</span>
              <input type="date" value={form.issued_date}
                onChange={e => setForm(f => ({ ...f, issued_date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">What it&apos;s for</span>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>

          <div>
            <span className="block text-xs font-medium text-gray-600 mb-1">The file</span>
            <input type="file" multiple accept="application/pdf,image/*"
              onChange={e => setFiles(Array.from(e.target.files || []))} className="w-full text-sm" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send it over'}
          </button>
        </form>

        {data.settlements?.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
              <History size={14} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-900">Already settled</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {data.settlements.map(s => (
                <li key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-900">
                    {s.period_end} · {money(Math.abs(s.net_amount))}{' '}
                    <span className="text-gray-500">
                      {s.owed_to === 'us' ? 'you paid Powder Ops' : s.owed_to === 'them' ? 'Powder Ops paid you' : ''}
                    </span>
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {s.payment_reference ? `ref ${s.payment_reference}` : (s.paid_at || '').slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-gray-400 flex items-center gap-1 pb-6">
          <FileText size={11} /> This link is yours alone — anyone with it can see this page. Ask your
          contact at Powder Ops to turn it off if it gets out.
        </p>
      </main>
    </div>
  );
}
