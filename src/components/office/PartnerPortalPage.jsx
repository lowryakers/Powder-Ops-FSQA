import { useState, useEffect, useCallback } from 'react';
import {
  Scale, AlertTriangle, Upload, FileText, Check, ExternalLink, History, Download, CalendarClock,
} from 'lucide-react';

// What M4 sees. A public page, no login — the token in the URL is the whole
// credential, so the page is deliberately narrow: the latest closed month end
// and who pays it, what is open and not yet due, what was already settled, a
// way to hand over their own paperwork, and a way to say something looks wrong.
//
// THE HEADLINE IS A CLOSED MONTH END, never a running total. Each month end
// closes in cash on the documents due by it (Net 30); whoever owes pays. A net
// of everything open is not a figure either company agreed, so an open month
// shows its subtotals and no "who pays". The office keeps every basis on its
// own page; this page has none to choose.

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

/** A real link to the file, through the token-scoped route (it redirects). */
function FileLink({ token, d, label }) {
  if (!d.has_file) return null;
  return (
    <a href={`/api/partner-portal/${encodeURIComponent(token)}/documents/${d.id}/open`} target="_blank" rel="noopener noreferrer"
      data-new-tab data-portal-file={d.doc_number || d.id}
      className="inline-flex items-center gap-1 text-[11px] text-powder-600 hover:underline">
      <ExternalLink size={10} /> {label || 'PDF'}
    </a>
  );
}

/**
 * "This doesn't look right", or what became of it. An open question reads
 * "Raised, Powder Ops reviewing"; an answered one shows the answer.
 */
function Review({ reviews, onRaise, target, what }) {
  const mine = reviews.filter(x => (target.document_id ? x.document_id === target.document_id
    : target.settlement_id ? x.settlement_id === target.settlement_id && !x.document_id
      : x.period_end === target.period_end && !x.document_id && !x.settlement_id));
  const openOne = mine.find(x => x.status === 'open');
  const answered = mine.filter(x => x.status === 'answered');
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      {openOne ? (
        <span data-portal-review-open className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-800">
          Raised, Powder Ops reviewing
        </span>
      ) : (
        <button type="button" data-portal-raise onClick={() => onRaise(target, what)}
          className="text-[11px] text-gray-400 hover:text-red-600 hover:underline">
          This doesn&apos;t look right
        </button>
      )}
      {answered.slice(0, 1).map(x => (
        <span key={x.id} className="text-[11px] text-gray-500">Reviewed {String(x.resolved_at || '').slice(0, 10)}: {x.resolution}</span>
      ))}
    </span>
  );
}

/** What was on a document — the lines read off it, when there are any. */
function PortalLines({ d }) {
  const items = d.line_items || [];
  if (!items.length) return <p className="text-[11px] text-gray-400 mt-1">No line detail on this document.</p>;
  return (
    <div className="mt-1 overflow-x-auto" data-portal-lines>
      <table className="text-[11px] min-w-[320px]">
        <tbody className="divide-y divide-gray-100">
          {items.map((i, k) => (
            <tr key={k}>
              <td className="py-0.5 pr-3 text-gray-800">{i.description}</td>
              <td className="py-0.5 pr-3 text-right text-gray-500 whitespace-nowrap">{i.quantity != null ? `${i.quantity} ×` : ''}</td>
              <td className="py-0.5 pr-3 text-right text-gray-500 whitespace-nowrap">{i.unit_price != null ? money(i.unit_price) : ''}</td>
              <td className="py-0.5 text-right text-gray-900 whitespace-nowrap">{i.amount != null ? money(i.amount) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocRow({ d, token, reviews, onRaise, children }) {
  return (
    <li className="py-2" data-portal-doc-row={d.doc_number || d.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-900">
            {d.doc_number || d.description || 'Document'}
            <span className="ml-1.5 text-xs text-gray-400 capitalize">{d.doc_type === 'po' ? 'purchase order' : d.doc_type}</span>
          </p>
          <p className="text-xs text-gray-500">
            issued {d.issued_date || '—'} · due {d.due_date || '—'}
            {d.description && d.doc_number ? ` · ${d.description}` : ''}
          </p>
        </div>
        <span className="flex items-center gap-2 shrink-0">
          {children}
          <span className={`text-sm whitespace-nowrap ${d.signed < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(d.signed)}</span>
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 flex-wrap">
        <FileLink token={token} d={d} />
        <details className="text-[11px]" data-portal-doc={d.doc_number || d.id}>
          <summary className="cursor-pointer text-gray-500">What was on it{d.line_summary ? ` — ${d.line_summary}` : ''}</summary>
          <PortalLines d={d} />
        </details>
        {onRaise && <Review reviews={reviews} onRaise={onRaise} target={{ document_id: d.id }} what={d.doc_number || 'this document'} />}
      </div>
    </li>
  );
}

function SideLists({ docs, partnerName, token, reviews, onRaise, chip }) {
  return [['you_owe', `What ${partnerName} owes Powder Ops`], ['you_are_owed', `What Powder Ops owes ${partnerName}`]].map(([side, label]) => {
    const rows = docs.filter(d => d.side === side);
    if (!rows.length) return null;
    return (
      <div key={side}>
        <p className="text-[11px] font-semibold text-gray-700">{label}</p>
        <ul className="divide-y divide-gray-100">
          {rows.map(d => <DocRow key={d.id} d={d} token={token} reviews={reviews} onRaise={onRaise}>{chip?.(d)}</DocRow>)}
        </ul>
      </div>
    );
  });
}

const statementHref = (token, key) => `/api/partner-portal/${encodeURIComponent(token)}/statements/${key}.pdf`;

function StatementLink({ token, keyName }) {
  return (
    <a href={statementHref(token, keyName)} data-new-tab data-portal-statement={keyName} download
      className="inline-flex items-center gap-1 text-xs text-powder-700 hover:underline">
      <Download size={12} /> Download statement (PDF)
    </a>
  );
}

/** The latest closed month end — the one figure on this page that is owed. */
function CloseCard({ close, partner, token, reviews, onRaise }) {
  const youPay = close.owed_to === 'powder-ops';
  const nobody = close.owed_to === 'nobody';
  const tone = close.status === 'paid' || nobody ? 'border-gray-200 bg-white' : youPay ? 'border-amber-300 bg-amber-50' : 'border-green-300 bg-green-50';
  const sentence = nobody ? 'Nothing is owed either way.'
    : youPay ? `${partner.name} owes Powder Ops ${money(close.amount)}`
      : `Powder Ops owes ${partner.name} ${money(close.amount)}`;
  const status = close.status === 'paid'
    ? `Paid${close.settlement?.paid_at ? ` ${String(close.settlement.paid_at).slice(0, 10)}` : ''}${close.settlement?.payment_reference ? ` · ref ${close.settlement.payment_reference}` : ''}`
    : close.status === 'unpaid' ? 'Unpaid' : 'Nothing was due';
  return (
    <section className={`rounded-xl border-2 p-5 ${tone}`} data-portal-close={close.period_end}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {close.label} close (as of {close.period_end})
        </p>
        <span data-portal-close-status={close.status}
          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${close.status === 'paid' ? 'bg-green-100 text-green-800' : close.status === 'unpaid' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600'}`}>
          {status}
        </span>
      </div>
      <p className="mt-1 text-2xl sm:text-3xl font-bold text-gray-900" data-portal-headline>{sentence}</p>
      <p className="mt-1 text-xs text-gray-600">
        Documents due by {close.period_end} under Net {partner.terms_days}. Anything due later is open, below.
      </p>

      {close.documents.length > 0 && (
        <div className="mt-3 space-y-2">
          <SideLists docs={close.documents} partnerName={partner.name} token={token} reviews={reviews} onRaise={onRaise}
            chip={(d) => d.credit_applied > 0 ? <span className="text-[10px] text-indigo-700">credit {money(d.credit_applied)}</span> : null} />
          <p className="text-xs text-gray-600">
            {partner.name} owes {money(close.you_owe)}
            {close.credit && close.credit.side === 'you_owe' && <> (less the {close.credit.applies_to} credit {money(close.credit.applied)}) = {money(close.credit.side_after_credit)}</>}
            {' '}− Powder Ops owes {money(close.you_are_owed)}
            {close.credit && close.credit.side === 'you_are_owed' && <> (less the {close.credit.applies_to} credit {money(close.credit.applied)}) = {money(close.credit.side_after_credit)}</>}
            {' '}= {money(close.amount)}.
          </p>
        </div>
      )}

      {close.status === 'unpaid' && !nobody && (
        <div className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" data-portal-pay>
          <p className="font-medium text-gray-900">
            {youPay ? 'To pay' : 'Powder Ops will pay'}: {money(close.amount)}
          </p>
          <p className="text-gray-700">Reference: <span className="font-mono" data-portal-reference>{close.reference}</span></p>
          <p className="text-[11px] text-gray-500">Bank details are sent separately, not shown here.</p>
        </div>
      )}

      <div className="mt-3 flex items-center gap-4 flex-wrap">
        <StatementLink token={token} keyName="close" />
        <Review reviews={reviews} onRaise={onRaise}
          target={close.settlement ? { settlement_id: close.settlement.id } : { period_end: close.period_end }}
          what={`the ${close.label} close`} />
      </div>
    </section>
  );
}

/** Open, not yet due — grouped by the month end each falls into. No net. */
function OpenSection({ open, credit, partner, token, reviews, onRaise }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden" data-portal-open>
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
        <CalendarClock size={14} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-900">Open, not yet due</span>
      </div>
      <div className="px-4 py-3 space-y-4">
        {credit && (
          <p className="text-xs text-indigo-800" data-portal-credit-line>
            {credit.label || 'Credit'} available: <span className="font-semibold">{money(credit.available)}</span>; applied at each close
            {credit.applies_to ? ` (${credit.applies_to} only)` : ''}.
          </p>
        )}
        {open.length === 0 && <p className="text-sm text-gray-400">Nothing open that falls due later.</p>}
        {open.map(g => (
          <div key={g.period_end} data-portal-open-month={g.period_end}>
            <div className="flex items-baseline justify-between gap-2 flex-wrap border-b border-gray-100 pb-1">
              <span className="text-sm font-semibold text-gray-900">{g.label} close <span className="font-normal text-gray-500">(due by {g.period_end})</span></span>
              <span className="text-xs text-gray-600">
                {partner.name} owes {money(g.you_owe)} · Powder Ops owes {money(g.you_are_owed)}
              </span>
            </div>
            <div className="mt-1 space-y-2">
              <SideLists docs={g.documents} partnerName={partner.name} token={token} reviews={reviews} onRaise={onRaise} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const HOW_WORDS = {
  covered_by_credit: ['Covered by the credit', 'bg-indigo-50 text-indigo-700 border-indigo-200'],
  netted: ['Netted', 'bg-green-50 text-green-700 border-green-200'],
  paid_to_you: ['Paid to you', 'bg-amber-50 text-amber-800 border-amber-200'],
};

/**
 * One settlement, from their side: every document in it, how each cleared, and
 * the file behind it. M4's AP asked for exactly this list ("all the paid and
 * credited invoice #s included in the August reconciliation").
 */
function PortalSettlement({ s, token, reviews, onRaise }) {
  const [open, setOpen] = useState(false);
  const owed = (side) => s.documents.filter(d => d.side === side);
  return (
    <li className="px-4 py-2.5" data-portal-settlement={s.period_end}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm text-gray-900">
          Already settled {s.period_end} · {money(Math.abs(s.net_amount))}{' '}
          <span className="text-gray-500">
            {s.owed_to === 'us' ? 'you paid Powder Ops' : s.owed_to === 'them' ? 'Powder Ops paid you' : ''}
            {' · '}{s.documents.length} document{s.documents.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="text-xs text-powder-600">{open ? 'Hide' : 'Show the documents'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-gray-600">
            You owed {money(s.you_owed)}
            {s.credit?.applied > 0 && <> (less the {s.credit.applies_to} credit {money(s.credit.applied)}) = {money(s.credit.side_after_credit)}</>}
            {' '}− Powder Ops owed you {money(s.you_were_owed)} = {money(Math.abs(s.net_amount))}
            {s.owed_to === 'them' ? ' paid to you' : s.owed_to === 'us' ? ' paid to Powder Ops' : ''}.
          </p>
          {s.credit?.applied > 0 && (
            <p className="text-xs text-indigo-800">Credit: {money(s.credit.balance_before)} before → {money(s.credit.balance_after)} after.</p>
          )}
          {[['you_owe', 'What you owed'], ['you_are_owed', 'What Powder Ops owed you']].map(([side, label]) => owed(side).length > 0 && (
            <div key={side}>
              <p className="text-[11px] font-semibold text-gray-700">{label}</p>
              <ul className="divide-y divide-gray-100">
                {owed(side).map(d => {
                  const [w, tone] = HOW_WORDS[d.how_cleared] || ['—', 'bg-gray-100 border-gray-200'];
                  return (
                    <li key={d.id} className="py-1.5" data-portal-settled-doc={d.doc_number || d.id}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-sm text-gray-900">
                          {d.doc_number || 'Document'}
                          <span className="ml-1 text-xs text-gray-400">issued {d.issued_date || '—'} · due {d.due_date || '—'}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span data-portal-how={d.how_cleared} className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${tone}`}>
                            {w}{d.how_cleared === 'covered_by_credit' && d.remainder > 0 ? ` ${money(d.credited_amount)}, ${money(d.remainder)} netted` : ''}
                          </span>
                          <span className="text-sm whitespace-nowrap">{money(d.signed)}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap mt-0.5">
                        <FileLink token={token} d={d} />
                        <details className="text-[11px]">
                          <summary className="cursor-pointer text-gray-500">What was on it</summary>
                          <PortalLines d={d} />
                        </details>
                        <Review reviews={reviews} onRaise={onRaise} target={{ document_id: d.id }} what={d.doc_number || 'this document'} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            {s.payment_reference && <span>ref {s.payment_reference}</span>}
            {s.basis === 'selected' && <span>chosen documents</span>}
            {s.basis === 'issued' && <span>documents issued in the period</span>}
            {s.paid_at && <span>paid {(s.paid_at || '').slice(0, 10)}</span>}
            {s.proof_filename && (
              <a href={`/api/partner-portal/${encodeURIComponent(token)}/settlements/${s.id}/proof/open`} target="_blank" rel="noopener noreferrer"
                data-new-tab className="text-[11px] text-indigo-700 underline">proof of payment</a>
            )}
            <StatementLink token={token} keyName={s.id} />
            <Review reviews={reviews} onRaise={onRaise} target={{ settlement_id: s.id }} what={`the ${s.period_end} settlement`} />
          </div>
        </div>
      )}
    </li>
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

  const raise = async (target, what) => {
    const note = window.prompt(`What's wrong with ${what}?`);
    if (!note?.trim()) return;
    try {
      const r = await call(`/${token}/reviews`, { method: 'POST', body: { ...target, note } });
      setSent(r.disputed
        ? 'Raised. It comes out of the number until it\'s sorted out, and Powder Ops can see why.'
        : 'Raised. Powder Ops will review it and answer here.');
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
  const reviews = data.reviews || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Scale size={18} className="text-powder-600" /> {data.partner.name} ⇄ Powder Ops
          </h1>
          <p className="text-sm text-gray-500">
            The same ledger both sides are looking at. Each month end closes on what is due by it (Net {data.partner.terms_days}); whoever owes pays.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        {sent && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800 flex items-start gap-2">
            <Check size={15} className="mt-0.5 shrink-0" /> {sent}
          </div>
        )}

        <CloseCard close={data.close} partner={data.partner} token={token} reviews={reviews} onRaise={raise} />

        <OpenSection open={data.open || []} credit={data.credit_available} partner={data.partner} token={token} reviews={reviews} onRaise={raise} />

        {data.waiting?.length > 0 && (
          <section className="rounded-xl border border-gray-200 bg-white p-4" data-portal-waiting>
            <h2 className="text-sm font-semibold text-gray-900">Not counted yet</h2>
            <p className="text-xs text-gray-500 mb-1">
              Waiting for Powder Ops to confirm as final, or raised and being reviewed. None of these is in any figure above.
            </p>
            <ul className="divide-y divide-gray-100">
              {data.waiting.map(d => (
                <DocRow key={d.id} d={d} token={token} reviews={reviews} onRaise={null}>
                  <span className="text-[10px] text-gray-500">{d.status === 'disputed' ? 'Raised, Powder Ops reviewing' : 'Waiting to be confirmed'}</span>
                </DocRow>
              ))}
            </ul>
          </section>
        )}

        {data.settlements?.length > 0 && (
          <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
              <History size={14} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-900">Already settled</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {data.settlements.map(s => <PortalSettlement key={s.id} s={s} token={token} reviews={reviews} onRaise={raise} />)}
            </ul>
          </section>
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

        <p className="text-[11px] text-gray-400 flex items-center gap-1 pb-6">
          <FileText size={11} /> This link is yours alone — anyone with it can see this page. Ask your
          contact at Powder Ops to turn it off if it gets out.
        </p>
      </main>
    </div>
  );
}
