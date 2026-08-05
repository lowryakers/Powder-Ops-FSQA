import { useState, useMemo, Fragment } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload, apiDelete } from '../../hooks/useApi';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import ModuleTabs from '../common/ModuleTabs.jsx';
import {
  Scale, Search, Check, FileText, Pencil, Plus, X, Link2,
  ArrowUpRight, ArrowDownLeft, Ban, Trash2, Copy, ExternalLink, History,
} from 'lucide-react';

// X − Y = Z.
//
// Powder Ops and M4 Dynamics invoice each other constantly and it had stalled,
// because each company was adding up its own emails and getting a different
// answer. This screen exists to produce one number that both sides can see was
// derived the same way — so the middle panel is deliberately the loudest thing
// on it, and everything else is the evidence behind it.
//
// The arithmetic is entirely server-side (server/partner-recon.js). Nothing
// here re-adds anything: a client that computed its own total would be a second
// opinion, which is the whole problem.

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const today = () => new Date().toISOString().slice(0, 10);

const DIRECTIONS = [
  { value: 'receivable', label: 'They owe us', hint: 'We issued it — our invoice or their PO', icon: ArrowDownLeft },
  { value: 'payable', label: 'We owe them', hint: 'They issued it — their invoice or our PO', icon: ArrowUpRight },
];

const STATUS_TONE = {
  draft: 'bg-gray-100 text-gray-700',
  final: 'bg-green-100 text-green-800',
  disputed: 'bg-red-100 text-red-700',
  void: 'bg-gray-100 text-gray-400 line-through',
};

function StatusChip({ s }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium capitalize whitespace-nowrap ${STATUS_TONE[s] || 'bg-gray-100'}`}>{s}</span>;
}

/* ── Upload / add a document ──────────────────────────────────────────────── */

function DocumentForm({ partner, initial, onClose, onSaved }) {
  const [f, setF] = useState(() => initial || {
    direction: 'receivable', doc_type: 'invoice', doc_number: '', reference: '',
    description: '', issued_date: today(), terms_days: partner?.terms_days ?? 30, amount: '',
  });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (initial?.id) {
        await apiPut(`/partners/documents/${initial.id}`, f);
      } else {
        const fd = new FormData();
        Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ''));
        for (const file of files) fd.append('files', file);
        await apiUpload(`/partners/${partner.id}/documents`, fd);
      }
      onSaved();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit document' : `Add a document — ${partner?.name}`}</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <span className="block text-xs font-medium text-gray-600 mb-1">Which way does this one go? *</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {DIRECTIONS.map(d => (
                <button key={d.value} type="button" onClick={() => set('direction', d.value)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${f.direction === d.value ? 'border-powder-400 bg-powder-50' : 'border-gray-300 hover:bg-gray-50'}`}>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                    <d.icon size={14} className={f.direction === d.value ? 'text-powder-600' : 'text-gray-400'} /> {d.label}
                  </span>
                  <span className="block text-[11px] text-gray-500">{d.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Type</span>
              <select value={f.doc_type} onChange={e => set('doc_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="invoice">Invoice</option>
                <option value="po">Purchase order</option>
                <option value="credit">Credit note</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Number</span>
              <input value={f.doc_number || ''} onChange={e => set('doc_number', e.target.value)}
                placeholder="INV-1042" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Amount *</span>
              <input required type="number" step="0.01" min="0" value={f.amount}
                onChange={e => set('amount', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Issued</span>
              <input type="date" value={f.issued_date || ''} onChange={e => set('issued_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Terms (days)</span>
              <input type="number" min="0" value={f.terms_days} onChange={e => set('terms_days', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <span className="block text-[10px] text-gray-400 mt-0.5">Due date is worked out from this.</span>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">Reference</span>
              <input value={f.reference || ''} onChange={e => set('reference', e.target.value)}
                placeholder="PO / MO it relates to" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">What it&apos;s for</span>
            <textarea rows={2} value={f.description || ''} onChange={e => set('description', e.target.value)}
              placeholder="Raspberry flavour, 40 kg · production run for M4 stick packs"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>

          {!initial?.id && (
            <div>
              <span className="block text-xs font-medium text-gray-600 mb-1">The PO or invoice (optional)</span>
              <input type="file" multiple accept="application/pdf,image/*"
                onChange={e => setFiles(Array.from(e.target.files || []))}
                className="w-full text-sm" />
              <p className="text-[11px] text-gray-500 mt-1">
                The file is read on upload, so a search finds a lot number printed inside the PDF — not just
                what was typed in above.
              </p>
            </div>
          )}

          <p className="text-[11px] text-gray-500">
            It goes in as a <span className="font-medium">draft</span>. It only reaches the balance once
            someone approves it as final — that is, once the goods went out or the run finished.
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : initial?.id ? 'Save' : 'Add it'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── The number ───────────────────────────────────────────────────────────── */

function TheNumber({ recon, partner, canSettle, onSettle, busy }) {
  if (!recon) return null;
  const { owed_to, amount_due, receivable_total, payable_total, net_amount } = recon;
  const nobody = owed_to === 'nobody';
  const tone = nobody ? 'border-gray-200 bg-gray-50'
    : owed_to === 'us' ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50';

  return (
    <div className={`rounded-xl border-2 p-5 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Settlement as at {recon.as_of}
      </p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{money(amount_due)}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-700">
        {nobody ? 'Nothing is owed either way this period.'
          : owed_to === 'us' ? `${partner?.name} owes Powder Ops`
            : `Powder Ops owes ${partner?.name}`}
      </p>

      {/* How the number was reached, in one line — this is the X − Y = Z. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
        <span><span className="text-gray-400">They owe us</span> {money(receivable_total)}</span>
        <span className="text-gray-400">−</span>
        <span><span className="text-gray-400">we owe them</span> {money(payable_total)}</span>
        <span className="text-gray-400">=</span>
        <span className="font-semibold text-gray-900">{money(net_amount)}</span>
      </div>

      {canSettle && !nobody && (
        <button onClick={onSettle} disabled={busy}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black disabled:opacity-50">
          <Check size={15} /> {busy ? 'Recording…' : 'Mark PAID and close the period'}
        </button>
      )}
      {!nobody && (
        <p className="mt-2 text-[11px] text-gray-500">
          Marking it paid stamps every document above into this settlement, so the next period starts from
          zero and this one can still be opened later.
        </p>
      )}
    </div>
  );
}

/* ── What's not in the number ─────────────────────────────────────────────── */

function ExcludedReport({ recon }) {
  if (!recon?.excluded_summary?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-gray-900">Not in this number</h4>
      <p className="text-xs text-gray-500 mb-2">
        Everything below is deliberately out of the figure above. Anything not yet due lands in a later
        settlement; anything disputed stays out until it&apos;s agreed or corrected.
      </p>
      <ul className="divide-y divide-gray-100">
        {recon.excluded_summary.map(e => (
          <li key={e.reason} className="py-2 flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-gray-800 capitalize">
                {e.reason.replace('_', ' ')} · {e.count} document{e.count === 1 ? '' : 's'}
              </span>
              <span className="block text-xs text-gray-500">{e.note}</span>
            </span>
            <span className="text-xs text-gray-600 whitespace-nowrap text-right">
              {e.receivable ? <span className="block">they owe {money(e.receivable)}</span> : null}
              {e.payable ? <span className="block">we owe {money(e.payable)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export default function PartnerReconPanel({ user }) {
  const { data: partners } = useApiGet('/partners');
  const partner = (partners || [])[0] || null;

  const [view, setView] = useState('balance');
  const [asOf, setAsOf] = useState('');
  const [q, setQ] = useState('');
  const [dirFilter, setDirFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newLink, setNewLink] = useState(null);
  const expand = useRowExpand();

  const pid = partner?.id;
  const { data: recon, refresh: refreshRecon } = useApiGet(
    pid ? `/partners/${pid}/reconcile${asOf ? `?as_of=${asOf}` : ''}` : null, [pid, asOf]);
  const docParams = new URLSearchParams({ unsettled: '1' });
  if (q.trim()) docParams.set('q', q.trim());
  if (dirFilter) docParams.set('direction', dirFilter);
  const { data: docData, refresh: refreshDocs } = useApiGet(
    pid ? `/partners/${pid}/documents?${docParams}` : null, [pid, q, dirFilter]);
  const { data: settlements, refresh: refreshSettlements } = useApiGet(
    pid ? `/partners/${pid}/settlements` : null, [pid]);
  const { data: tokens, refresh: refreshTokens } = useApiGet(
    pid ? `/partners/${pid}/portal-tokens` : null, [pid]);

  const canSettle = user?.role === 'admin'
    || (user?.role === 'supervisor' && ['office', 'admin'].includes((user?.department || '').toLowerCase()));

  const reloadAll = () => { refreshRecon(); refreshDocs(); refreshSettlements(); setAdding(false); setEditing(null); };
  const docs = useMemo(() => docData?.documents || [], [docData]);

  const act = async (fn) => {
    setBusy(true);
    try { await fn(); reloadAll(); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };

  const settle = async () => {
    if (!recon) return;
    const who = recon.owed_to === 'us' ? `${partner.name} pays Powder Ops` : `Powder Ops pays ${partner.name}`;
    if (!window.confirm(`${who} ${money(recon.amount_due)}.\n\nThis closes ${recon.counts.receivable + recon.counts.payable} documents into a settlement you can reopen later. Record it as paid?`)) return;
    const reference = window.prompt('Payment reference (cheque #, ACH, note) — optional:') ?? '';
    await act(() => apiPost(`/partners/${pid}/settle`, {
      as_of: recon.as_of, expected_net: recon.net_amount, payment_reference: reference,
    }));
  };

  if (!partner) {
    return <p className="text-sm text-gray-500 py-12 text-center">No trading partner is set up yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Scale size={18} className="text-powder-600" /> Powder Ops ⇄ {partner.name}
          </h3>
          <p className="text-sm text-gray-500 max-w-2xl">
            One ledger, both directions. What they owe us minus what we owe them, settled monthly — with
            the documents behind it and Net {partner.terms_days} applied so nothing is claimed early.
          </p>
        </div>
        <button onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 shrink-0">
          <Plus size={15} /> Add document
        </button>
      </div>

      <ModuleTabs value={view} onChange={setView} tabs={[
        { id: 'balance', label: 'The balance', icon: Scale },
        { id: 'documents', label: 'Documents', icon: FileText, badge: docs.length },
        { id: 'history', label: 'Settled', icon: History, badge: settlements?.length },
        ...(canSettle ? [{ id: 'access', label: 'Partner access', icon: Link2 }] : []),
      ]} />

      {view === 'balance' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-gray-500">As at</label>
            <input type="date" value={asOf || recon?.as_of || ''} onChange={e => setAsOf(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
            {asOf && (
              <button onClick={() => setAsOf('')} className="text-xs text-powder-600 hover:underline">
                back to month end
              </button>
            )}
          </div>
          <TheNumber recon={recon} partner={partner} canSettle={canSettle} onSettle={settle} busy={busy} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SideList title={`${partner.name} owes Powder Ops`} rows={recon?.documents?.receivable} tone="green" />
            <SideList title={`Powder Ops owes ${partner.name}`} rows={recon?.documents?.payable} tone="amber" />
          </div>
          <ExcludedReport recon={recon} />
        </div>
      )}

      {view === 'documents' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="Number, reference, description — or text inside the PDF"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <select value={dirFilter} onChange={e => setDirFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">Both directions</option>
              <option value="receivable">They owe us</option>
              <option value="payable">We owe them</option>
            </select>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="w-8 px-2 py-2.5" />
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600">Document</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600">Direction</th>
                    <th className="text-right px-3 py-2.5 font-medium text-gray-600">Amount</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Due</th>
                    <th className="text-left px-3 py-2.5 font-medium text-gray-600">Status</th>
                    <th className="px-3 py-2.5 w-40" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map(d => (
                    <Fragment key={d.id}>
                      <tr {...expand.rowProps(d.id)} className="border-b border-gray-100">
                        <td className="px-2 py-2.5"><ExpandCell open={expand.isExpanded(d.id)} /></td>
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-gray-900">{d.doc_number || '—'}</span>
                          <span className="block text-xs text-gray-500 capitalize">
                            {d.doc_type === 'po' ? 'Purchase order' : d.doc_type}
                            {d.source === 'partner-portal' && <span className="ml-1 text-powder-600">· from {partner.name}</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-600">
                          {d.direction === 'receivable' ? 'They owe us' : 'We owe them'}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap ${d.doc_type === 'credit' ? 'text-red-600' : 'text-gray-900'}`}>
                          {d.doc_type === 'credit' ? '−' : ''}{money(d.amount)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{d.due_date || '—'}</td>
                        <td className="px-3 py-2.5"><StatusChip s={d.status} /></td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-right" onClick={stopRowClick}>
                          {d.status === 'draft' && canSettle && (
                            <button onClick={() => act(() => apiPost(`/partners/documents/${d.id}/finalize`, {}))}
                              className="px-2 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700">
                              Approve as final
                            </button>
                          )}
                          {d.status === 'final' && (
                            <button onClick={() => {
                              const reason = window.prompt('What\'s the disagreement? It goes in the report both sides read.');
                              if (reason?.trim()) act(() => apiPost(`/partners/documents/${d.id}/dispute`, { reason }));
                            }} className="px-2 py-1 rounded-lg border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50">
                              Dispute
                            </button>
                          )}
                          {d.status === 'disputed' && canSettle && (
                            <button onClick={() => act(() => apiPost(`/partners/documents/${d.id}/finalize`, {}))}
                              className="px-2 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700">
                              Resolve as final
                            </button>
                          )}
                          {d.status === 'draft' && (
                            <button onClick={() => setEditing(d)} className="ml-1 p-1 text-gray-400 hover:text-powder-600" data-tip="Edit"><Pencil size={13} /></button>
                          )}
                          {canSettle && d.status !== 'void' && (
                            <button onClick={() => act(() => apiPost(`/partners/documents/${d.id}/void`, {}))}
                              className="ml-1 p-1 text-gray-300 hover:text-red-600" data-tip="Void"><Ban size={13} /></button>
                          )}
                          {user?.role === 'admin' && (
                            <button onClick={() => { if (window.confirm('Delete this document?')) act(() => apiDelete(`/partners/documents/${d.id}`)); }}
                              className="ml-1 p-1 text-gray-300 hover:text-red-600" data-tip="Delete"><Trash2 size={13} /></button>
                          )}
                        </td>
                      </tr>
                      {expand.isExpanded(d.id) && (
                        <DetailRow colSpan={7}>
                          <DetailFields fields={[
                            { label: 'Issued', value: d.issued_date },
                            { label: 'Terms', value: d.terms_days != null ? `Net ${d.terms_days}` : null },
                            { label: 'Reference', value: d.reference },
                            { label: 'Description', value: d.description },
                            { label: 'Added by', value: d.created_by },
                            { label: 'Approved final by', value: d.finalized_by },
                            { label: 'Dispute', value: d.disputed_reason ? `${d.disputed_reason} — ${d.disputed_by}` : null },
                          ]} />
                          {d.filename && (
                            <button onClick={async () => {
                              try {
                                const { url } = await apiFetch(`/partners/documents/${d.id}/file`);
                                if (url) window.open(url, '_blank');
                              } catch (e) { window.alert(e.message); }
                            }} className="mt-2 inline-flex items-center gap-1 text-xs text-powder-600 hover:underline">
                              <ExternalLink size={11} /> {d.filename}{d.has_text ? ' · searchable' : ''}
                            </button>
                          )}
                        </DetailRow>
                      )}
                    </Fragment>
                  ))}
                  {docs.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">Nothing outstanding.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {view === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {(settlements || []).map(s => (
            <div key={s.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {s.period_end} · {money(Math.abs(s.net_amount))}{' '}
                  <span className="font-normal text-gray-500">
                    {s.owed_to === 'us' ? `from ${partner.name}` : s.owed_to === 'them' ? `to ${partner.name}` : ''}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  they owed {money(s.receivable_total)} − we owed {money(s.payable_total)} ·
                  {' '}{s.document_count} document{s.document_count === 1 ? '' : 's'}
                  {s.payment_reference ? ` · ref ${s.payment_reference}` : ''}
                </p>
              </div>
              <span className="text-xs text-gray-400 whitespace-nowrap">
                paid {(s.paid_at || '').slice(0, 10)} · {s.paid_by}
              </span>
            </div>
          ))}
          {(settlements || []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Nothing settled yet.</p>
          )}
        </div>
      )}

      {view === 'access' && canSettle && (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-gray-900">A link for {partner.name}</h4>
            <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
              Lets them see this same ledger and the same number, upload their own invoices and POs, and flag
              anything they disagree with. They cannot approve a document as final, void one, or settle —
              those stay here. The link can be turned off at any time.
            </p>
            <button onClick={async () => {
              try {
                const r = await apiPost(`/partners/${pid}/portal-tokens`, { label: `${partner.name} portal` });
                setNewLink(`${window.location.origin}/partner/${r.token}`);
                refreshTokens();
              } catch (e) { window.alert(e.message); }
            }} className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
              <Link2 size={14} /> Create a link
            </button>

            {newLink && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-xs font-medium text-amber-900">
                  Copy this now — it is shown once and never stored in readable form.
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 min-w-0 text-xs break-all text-gray-800">{newLink}</code>
                  <button onClick={() => navigator.clipboard?.writeText(newLink)}
                    className="p-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0">
                    <Copy size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {(tokens || []).map(t => (
              <div key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{t.label || 'Partner link'}</p>
                  <p className="text-xs text-gray-500">
                    created {(t.created_at || '').slice(0, 10)} by {t.created_by}
                    {t.last_used_at ? ` · last used ${(t.last_used_at || '').slice(0, 10)}` : ' · never used'}
                    {t.revoked_at ? ' · turned off' : ''}
                  </p>
                </div>
                {!t.revoked_at && (
                  <button onClick={() => act(() => apiDelete(`/partners/portal-tokens/${t.id}`).then(refreshTokens))}
                    className="text-xs text-red-600 hover:underline shrink-0">Turn off</button>
                )}
              </div>
            ))}
            {(tokens || []).length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No links yet.</p>
            )}
          </div>
        </div>
      )}

      {(adding || editing) && (
        <DocumentForm partner={partner} initial={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={reloadAll} />
      )}
    </div>
  );
}

function SideList({ title, rows, tone }) {
  const total = (rows || []).reduce((t, r) => t + (r.signed || 0), 0);
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between ${tone === 'green' ? 'bg-green-50/60' : 'bg-amber-50/60'}`}>
        <span className="text-sm font-semibold text-gray-900">{title}</span>
        <span className="text-sm font-bold text-gray-900">{money(total)}</span>
      </div>
      <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
        {(rows || []).map(r => (
          <li key={r.id} className="px-4 py-2 flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm text-gray-900 truncate">{r.doc_number || r.description || 'Document'}</span>
              <span className="block text-xs text-gray-500">due {r.due_date || '—'}</span>
            </span>
            <span className={`text-sm whitespace-nowrap ${r.signed < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(r.signed)}</span>
          </li>
        ))}
        {(rows || []).length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">Nothing due.</li>}
      </ul>
    </div>
  );
}
