import { useState, useMemo, Fragment } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload, apiDelete } from '../../hooks/useApi';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import ModuleTabs from '../common/ModuleTabs.jsx';
import {
  Scale, Search, Check, FileText, Pencil, Plus, X, Link2,
  ArrowUpRight, ArrowDownLeft, Ban, Trash2, Copy, ExternalLink, History, Upload,
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
    category: '',
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
            {/* WHAT IT IS FOR, which is a different question from what kind of
                document it is — and the only thing that lets a credit tell a
                production run apart from an ingredient sale. Left blank means
                blank: nothing is ever guessed from the description. */}
            <label className="block">
              <span className="block text-xs font-medium text-gray-600 mb-1">
                What it&rsquo;s for <span className="font-normal text-gray-400">— decides credit</span>
              </span>
              <select value={f.category || ''} onChange={e => set('category', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Not categorised</option>
                <option value="manufacturing">Manufacturing / production run</option>
                <option value="materials">Raw materials / ingredients</option>
                <option value="freight">Freight</option>
                <option value="other">Other</option>
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

/**
 * The credit facility, on the settlement card.
 *
 * Shows the WORKING, not just the balance: what the facility is, what was used
 * before this period, what this period draws and against which runs, and what
 * is left. A single remaining figure is a number somebody has to trust; the
 * draws behind it are a number they can check.
 *
 * It also names what the credit did NOT cover. "Why wasn't my run credited" is
 * the first question anyone asks, and an uncategorised document is the usual
 * answer — the credit refuses to guess, so the screen has to say so.
 */
// Opening the facility. Without this the endpoint exists and nothing can reach
// it — which is exactly how the credit was invisible after the first deploy.
function OpenCreditForm({ pid, onDone, onCancel }) {
  const [amount, setAmount] = useState('200000');
  const [label, setLabel] = useState('');
  const [appliesTo, setAppliesTo] = useState('manufacturing');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await apiPost(`/partners/${pid}/credits`, {
        amount: Number(amount), applies_to: appliesTo, direction: 'receivable',
        label: label.trim() || undefined, description: note.trim() || undefined,
      });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">Open a credit</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] text-indigo-800 mb-1">Amount</span>
          <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)}
            className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white" />
        </label>
        <label className="block">
          <span className="block text-[11px] text-indigo-800 mb-1">Applies to</span>
          <select value={appliesTo} onChange={e => setAppliesTo(e.target.value)}
            className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white">
            <option value="manufacturing">Manufacturing / production runs</option>
            <option value="materials">Raw materials / ingredients</option>
            <option value="freight">Freight</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="block text-[11px] text-indigo-800 mb-1">Name it</span>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="M4 manufacturing credit"
          className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white" />
      </label>
      <label className="block">
        <span className="block text-[11px] text-indigo-800 mb-1">What was agreed</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
          placeholder="e.g. Danny — production runs only, not raw material purchases."
          className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-sm bg-white" />
      </label>
      <p className="text-[11px] text-indigo-800">
        Only documents marked as {appliesTo === 'manufacturing' ? 'manufacturing' : appliesTo} draw on this.
        Anything left uncategorised is never absorbed.
      </p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={go} disabled={busy || !(Number(amount) > 0)}
          className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          {busy ? 'Opening…' : 'Open credit'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-2 rounded-lg border border-indigo-200 text-indigo-800 text-sm hover:bg-indigo-100">Cancel</button>
      </div>
    </div>
  );
}

// Categorise one document without opening the edit form.
//
// It sits in the "Not covered by the credit" list because that is where the
// problem is noticed — the shortest path from "why wasn't that absorbed" to
// "now it is". The edit pencil can't do this job: it only appears on drafts,
// and the documents that need categorising are the final ones.
const CATEGORY_OPTIONS = [
  ['', 'Not categorised'],
  ['manufacturing', 'Manufacturing'],
  ['materials', 'Raw materials'],
  ['freight', 'Freight'],
  ['other', 'Other'],
];

function CategoryPicker({ documentId, value, onChanged, disabled }) {
  const [busy, setBusy] = useState(false);
  const set = async (v) => {
    setBusy(true);
    try { await apiPut(`/partners/documents/${documentId}/category`, { category: v }); onChanged?.(); }
    catch (e) { window.alert(e.message); }
    finally { setBusy(false); }
  };
  return (
    <select value={value || ''} disabled={busy || disabled} onChange={e => set(e.target.value)}
      className="px-1.5 py-0.5 border border-gray-300 rounded text-[11px] bg-white disabled:opacity-50">
      {CATEGORY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function CreditCard({ credit, pid, canSettle, onChanged }) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  if (!credit) {
    if (!canSettle) return null;
    return opening
      ? <OpenCreditForm pid={pid} onDone={() => { setOpening(false); onChanged?.(); }} onCancel={() => setOpening(false)} />
      : (
        <button type="button" onClick={() => setOpening(true)}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-300 text-indigo-800 bg-white text-xs font-medium hover:bg-indigo-50">
          + Add a credit
        </button>
      );
  }
  const pct = credit.facility > 0
    ? Math.min(100, Math.round(((credit.facility - credit.remaining_balance) / credit.facility) * 100)) : 0;

  return (
    <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
            {credit.label || 'Credit'} · {credit.applies_to} only
          </span>
          <span className="text-[11px] text-indigo-700 underline">{open ? 'Hide' : 'How this was used'}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold text-indigo-900">{money(credit.remaining_balance)}</span>
          <span className="text-xs text-indigo-800">left of {money(credit.facility)}</span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-indigo-200 overflow-hidden">
          <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} />
        </div>
        {credit.drawn_this_period > 0 && (
          <p className="mt-1.5 text-[11px] text-indigo-800">
            {money(credit.drawn_this_period)} of this period&rsquo;s {credit.applies_to} comes off the credit —
            the balance due drops from {money(credit.net_before_credit)} to {money(credit.net_amount)}.
          </p>
        )}
      </button>

      {open && (
        <div className="mt-2.5 space-y-2 border-t border-indigo-200 pt-2">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {[['Facility', credit.facility], ['Used before this period', credit.applied_to_date],
              ['Drawn this period', credit.drawn_this_period]].map(([l, v]) => (
              <div key={l}>
                <div className="text-indigo-700">{l}</div>
                <div className="font-semibold text-indigo-900">{money(v)}</div>
              </div>
            ))}
          </div>

          {credit.draws.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-indigo-900">Coming off the credit this period</p>
              <ul className="mt-0.5 space-y-0.5">
                {credit.draws.map(d => (
                  <li key={d.document_id} className="text-[11px] text-indigo-800 flex justify-between gap-2">
                    <span className="truncate">{d.doc_number || d.description || d.document_id}</span>
                    <span className="shrink-0 font-medium">
                      {money(d.amount)}{!d.covered_in_full && ` of ${money(d.document_total)} — credit ran out`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {credit.ineligible.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-700">Not covered by the credit</p>
              <ul className="mt-0.5 space-y-1">
                {credit.ineligible.map(d => (
                  <li key={d.document_id} className="text-[11px] text-gray-600 flex items-center justify-between gap-2 flex-wrap">
                    <span className="truncate min-w-0 flex-1">{d.doc_number || d.description || d.document_id}</span>
                    <span className="shrink-0">{money(d.amount)}</span>
                    {canSettle
                      ? <CategoryPicker documentId={d.document_id} value={d.category} onChanged={onChanged} />
                      : <span className="shrink-0">{d.reason}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-gray-500">
                An uncategorised document is never absorbed. Set one to {credit.applies_to} and it comes off the credit
                straight away.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TheNumber({ recon, partner, canSettle, onSettle, busy, onCreditChanged }) {
  if (!recon) return null;
  const credit = recon.credit;
  // After the credit is what is actually owed, so that is the headline. The
  // before-credit figure stays visible in the working below it.
  const owed_to = credit ? credit.owed_to : recon.owed_to;
  const amount_due = credit ? credit.amount_due : recon.amount_due;
  const net_amount = credit ? credit.net_amount : recon.net_amount;
  const { receivable_total, payable_total } = recon;
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
        <span className={credit?.drawn_this_period ? 'text-gray-500' : 'font-semibold text-gray-900'}>
          {money(recon.net_amount)}
        </span>
        {credit?.drawn_this_period > 0 && (
          <>
            <span className="text-gray-400">−</span>
            <span><span className="text-gray-400">credit</span> {money(credit.drawn_this_period)}</span>
            <span className="text-gray-400">=</span>
            <span className="font-semibold text-gray-900">{money(net_amount)}</span>
          </>
        )}
      </div>

      <CreditCard credit={credit} pid={partner?.id} canSettle={canSettle} onChanged={onCreditChanged} />

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
  const [importing, setImporting] = useState(false);
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
    // AFTER the credit — that is what is actually being paid, and it is what
    // the server recomputes and compares `expected_net` against. Sending the
    // pre-credit figure would 409 on every period the credit draws on.
    const c = recon.credit;
    const owedTo = c ? c.owed_to : recon.owed_to;
    const due = c ? c.amount_due : recon.amount_due;
    const expected = c ? c.net_amount : recon.net_amount;
    const who = owedTo === 'us' ? `${partner.name} pays Powder Ops` : `Powder Ops pays ${partner.name}`;
    const creditLine = c?.drawn_this_period > 0
      ? `\n\n${money(c.drawn_this_period)} comes off the ${c.applies_to} credit, leaving ${money(c.remaining_balance)} on it.`
      : '';
    if (!window.confirm(`${who} ${money(due)}.${creditLine}\n\nThis closes ${recon.counts.receivable + recon.counts.payable} documents into a settlement you can reopen later. Record it as paid?`)) return;
    const reference = window.prompt('Payment reference (cheque #, ACH, note) — optional:') ?? '';
    await act(() => apiPost(`/partners/${pid}/settle`, {
      as_of: recon.as_of, expected_net: expected, payment_reference: reference,
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
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setImporting(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
            <Upload size={15} /> Import invoices
          </button>
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={15} /> Add document
          </button>
        </div>
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
          <TheNumber recon={recon} partner={partner} canSettle={canSettle} onSettle={settle} busy={busy}
            onCreditChanged={reloadAll} />
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
                        <td className="px-3 py-2.5 max-w-[22rem]">
                          <span className="font-medium text-gray-900">{d.doc_number || '—'}</span>
                          <span className="block text-xs text-gray-500 capitalize">
                            {d.doc_type === 'po' ? 'Purchase order' : d.doc_type}
                            {d.source === 'partner-portal' && <span className="ml-1 text-powder-600">· from {partner.name}</span>}
                          </span>
                          {/* WHAT WAS ON IT. The whole point of the row is that
                              you can tell one invoice from another without
                              opening the PDF — a number and an amount cannot do
                              that. Falls back to the typed description when
                              nothing could be read off the file, and says so
                              when there is neither, rather than leaving a blank
                              that reads as "nothing was on it". */}
                          {d.line_summary ? (
                            <span className="block text-xs text-gray-700 mt-0.5 truncate" title={d.line_items.map(i => i.description).join(', ')}>
                              {d.line_summary}
                              {d.lines_reconcile === false && (
                                <span className="ml-1 text-amber-600" title="The lines read off this file do not add up to its total — some may not have been read.">·&nbsp;partial</span>
                              )}
                            </span>
                          ) : d.description ? (
                            <span className="block text-xs text-gray-700 mt-0.5 truncate" title={d.description}>{d.description}</span>
                          ) : (
                            <span className="block text-xs text-gray-400 mt-0.5 italic">no detail on file</span>
                          )}
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
                          <LineItems doc={d} money={money} onRead={reloadAll} />
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
      {importing && (
        <ImportInvoices partner={partner} onClose={() => setImporting(false)} onImported={reloadAll} />
      )}
    </div>
  );
}

/**
 * What was on the invoice or PO, in full.
 *
 * The row above carries a one-line summary; this is the detail behind it.
 *
 * The line total is shown BESIDE the document's amount rather than instead of
 * it. They come from different places — the lines are read off the body of the
 * document, the amount off its total — and when they disagree that is a fact
 * worth seeing, not something to resolve by preferring one. The document's
 * amount stays the money; the lines stay a description of it.
 */
function LineItems({ doc, money, onRead }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const items = doc.line_items || [];

  const read = async () => {
    setBusy(true); setError('');
    try { await apiPost(`/partners/documents/${doc.id}/read-lines`, {}); onRead?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!items.length) {
    return (
      <div className="mt-2">
        <p className="text-xs text-gray-500">
          No line detail on this document.
          {doc.description ? ' The description above is what was recorded.' : ''}
        </p>
        {doc.has_text && (
          <button onClick={read} disabled={busy}
            className="mt-1 text-xs text-powder-600 hover:underline disabled:opacity-50">
            {busy ? 'Reading…' : 'Read the lines from the file'}
          </button>
        )}
        {error && <p className="text-xs text-amber-700 mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-gray-700 mb-1">What was on it ({items.length})</p>
      <div className="overflow-x-auto">
        <table className="text-xs min-w-[380px]">
          <tbody className="divide-y divide-gray-100">
            {items.map((i, k) => (
              <tr key={k}>
                <td className="py-1 pr-3 text-gray-800">{i.description}</td>
                <td className="py-1 pr-3 text-right text-gray-500 whitespace-nowrap">
                  {i.quantity != null ? `${i.quantity} ×` : ''}
                </td>
                <td className="py-1 pr-3 text-right text-gray-500 whitespace-nowrap">
                  {i.unit_price != null ? money(i.unit_price) : ''}
                </td>
                <td className="py-1 text-right text-gray-900 font-medium whitespace-nowrap">
                  {i.amount != null ? money(i.amount) : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-t border-gray-200">
              <td className="py-1 pr-3 text-gray-500" colSpan={3}>Lines add up to</td>
              <td className="py-1 text-right font-semibold whitespace-nowrap">{money(doc.lines_total || 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {doc.lines_reconcile === false && (
        <p className="text-[11px] text-amber-700 mt-1">
          These lines come to {money(doc.lines_total || 0)}, and the document is {money(doc.amount)}. The
          difference is usually tax, freight, or a line the reader could not pick up — the document&rsquo;s
          amount is what counts toward the balance.
        </p>
      )}
    </div>
  );
}

/**
 * Import a folder of invoices in one go.
 *
 * Scan → review → commit. The scan writes NOTHING; it reads each file and
 * proposes a row. What makes the review step necessary rather than decorative
 * is the direction column: `receivable` and `payable` are the difference
 * between being paid and paying, and an import that guesses wrong moves five
 * figures the wrong way with a confident number to match. So a file whose
 * direction could not be read from the document arrives unset and cannot be
 * imported until someone says which way it points.
 *
 * The files are re-sent on commit rather than stashed server-side, so a
 * half-finished import leaves nothing behind.
 */
function ImportInvoices({ partner, onClose, onImported }) {
  const [files, setFiles] = useState([]);
  const [scan, setScan] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const pick = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    if (!list.length) return;
    setFiles(list); setBusy(true); setError(''); setScan(null);
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      const data = await apiUpload(`/partners/${partner.id}/documents/scan`, fd);
      setScan(data);
      setRows(data.files.map(f => {
        const p = f.proposal || {};
        return {
          skip: !!f.duplicate_of,
          allow_duplicate: false,
          direction: p.direction || '',
          doc_type: p.doc_type || 'invoice',
          doc_number: p.doc_number || '',
          reference: p.reference || '',
          issued_date: p.issued_date || '',
          terms_days: p.terms_days ?? partner.terms_days,
          amount: p.amount ?? '',
          description: '',
          // Carried straight through to the commit, so the summary on the row
          // is what was read off THAT file rather than being re-derived later.
          line_items: p.line_items || [],
        };
      }));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const set = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const ready = rows.filter((r, i) => !r.skip && r.direction && r.amount !== '' && scan?.files[i]);
  const blocked = rows.filter(r => !r.skip && (!r.direction || r.amount === ''));

  const commit = async () => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('rows', JSON.stringify(rows.map(r => ({
        ...r, amount: r.amount === '' ? null : Number(r.amount),
        terms_days: r.terms_days === '' ? null : Number(r.terms_days),
      }))));
      const res = await apiUpload(`/partners/${partner.id}/documents/import`, fd);
      setDone(res);
      onImported();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h3 className="text-sm font-semibold text-gray-900">Import invoices — Powder Ops ⇄ {partner.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          {done ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-900">
                {done.created.length} document{done.created.length === 1 ? '' : 's'} added as drafts.
              </p>
              <p className="text-xs text-gray-500">
                Drafts do not count toward the balance. Approve each one as final when the work behind it
                has happened.
              </p>
              {done.skipped?.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-medium text-amber-900">{done.skipped.length} not imported:</p>
                  <ul className="text-[11px] text-amber-800 mt-1 space-y-0.5">
                    {done.skipped.map((s, i) => <li key={i}>{s.filename} — {s.reason}</li>)}
                  </ul>
                </div>
              )}
              <button onClick={onClose} className="px-3 py-1.5 bg-powder-600 text-white text-sm rounded-lg hover:bg-powder-700">Done</button>
            </div>
          ) : !scan ? (
            <>
              <p className="text-sm text-gray-600">
                Pick the invoices, POs and credit notes for this partner. Each file is read on its own —
                nothing is written until you have checked the rows.
              </p>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 cursor-pointer">
                <Upload size={15} /> {busy ? 'Reading…' : 'Choose files'}
                <input type="file" multiple className="hidden" onChange={pick} disabled={busy} />
              </label>
              <p className="text-[11px] text-gray-400">Up to 10 files at a time. PDFs read best; a photo of an invoice has to be typed in.</p>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Check each row. <span className="font-medium text-gray-700">Direction is never guessed from a
                document that does not say who issued it</span> — getting it backwards moves the money the
                wrong way, so those rows have to be set by hand.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500 w-8"></th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">File</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">Direction</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">Type</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">Doc #</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">Date</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">Net</th>
                      <th className="px-2 py-1.5 text-left font-medium text-gray-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {scan.files.map((f, i) => {
                      const r = rows[i] || {};
                      const p = f.proposal || {};
                      return (
                        <tr key={i} className={r.skip ? 'opacity-50' : ''}>
                          <td className="px-2 py-1.5 align-top">
                            <input type="checkbox" checked={!r.skip} onChange={e => set(i, 'skip', !e.target.checked)} />
                          </td>
                          <td className="px-2 py-1.5 align-top max-w-[200px]">
                            <span className="block font-medium text-gray-800 truncate" title={f.filename}>{f.filename}</span>
                            {f.duplicate_of && (
                              <span className="block text-[10px] text-amber-700 mt-0.5">{f.message}</span>
                            )}
                            {f.readable === false && <span className="block text-[10px] text-amber-700 mt-0.5">{f.message || f.error}</span>}
                            {p.missing?.length > 0 && f.readable !== false && (
                              <span className="block text-[10px] text-gray-500 mt-0.5">Could not read: {p.missing.join(', ')}</span>
                            )}
                            {p.direction_weak && (
                              <span className="block text-[10px] text-amber-700 mt-0.5">{p.direction_reason} — check this one.</span>
                            )}
                            {p.terms_from_partner && (
                              <span className="block text-[10px] text-gray-400 mt-0.5">Net taken from the partner's terms, not the invoice.</span>
                            )}
                            {/* What the file says was on it — the thing that
                                tells two invoices apart at a glance. */}
                            {p.line_items?.length > 0 && (
                              <span className="block text-[10px] text-gray-600 mt-0.5"
                                title={p.line_items.map(li => li.description).join('\n')}>
                                {p.line_items.length} line{p.line_items.length === 1 ? '' : 's'}: {p.line_items.slice(0, 2).map(li => li.description).join(', ')}
                                {p.line_items.length > 2 ? ` +${p.line_items.length - 2}` : ''}
                                {p.lines_reconcile === false && <span className="text-amber-700"> · lines don’t match the total</span>}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <select value={r.direction || ''} onChange={e => set(i, 'direction', e.target.value)}
                              className={`px-1.5 py-1 border rounded text-xs ${r.direction ? 'border-gray-300' : 'border-amber-400 bg-amber-50'}`}>
                              <option value="">Set this…</option>
                              <option value="receivable">They owe us</option>
                              <option value="payable">We owe them</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <select value={r.doc_type || 'invoice'} onChange={e => set(i, 'doc_type', e.target.value)}
                              className="px-1.5 py-1 border border-gray-300 rounded text-xs">
                              <option value="invoice">Invoice</option>
                              <option value="po">PO</option>
                              <option value="credit">Credit</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input value={r.doc_number || ''} onChange={e => set(i, 'doc_number', e.target.value)}
                              className="w-24 px-1.5 py-1 border border-gray-300 rounded text-xs" />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input type="date" value={r.issued_date || ''} onChange={e => set(i, 'issued_date', e.target.value)}
                              className="px-1.5 py-1 border border-gray-300 rounded text-xs" />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input type="number" min="0" value={r.terms_days ?? ''} onChange={e => set(i, 'terms_days', e.target.value)}
                              className="w-14 px-1.5 py-1 border border-gray-300 rounded text-xs" />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input type="number" step="any" value={r.amount ?? ''} onChange={e => set(i, 'amount', e.target.value)}
                              className={`w-24 px-1.5 py-1 border rounded text-xs ${r.amount !== '' ? 'border-gray-300' : 'border-amber-400 bg-amber-50'}`} />
                            {p.amount_label && <span className="block text-[10px] text-gray-400 mt-0.5">from “{p.amount_label}”</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {scan.files.some(f => f.duplicate_of) && (
                <p className="text-[11px] text-amber-700">
                  Rows already on the ledger are unticked. Importing one again would double what is owed —
                  tick it only if it really is a second document.
                </p>
              )}
              {blocked.length > 0 && (
                <p className="text-[11px] text-amber-700">
                  {blocked.length} row{blocked.length === 1 ? '' : 's'} still need a direction or an amount.
                </p>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>

        {scan && !done && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 sticky bottom-0 bg-white">
            <span className="text-xs text-gray-500">{ready.length} of {scan.files.length} ready — all imported as drafts</span>
            <div className="flex-1" />
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600">Cancel</button>
            <button onClick={commit} disabled={busy || !ready.length}
              className="px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Importing…' : `Import ${ready.length}`}
            </button>
          </div>
        )}
      </div>
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
