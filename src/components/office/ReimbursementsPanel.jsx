import { useState, useMemo, Fragment } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload, apiDelete } from '../../hooks/useApi';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import PhotoPicker from '../common/PhotoPicker.jsx';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import { CustomFields, CustomFieldValues } from '../common/CustomFields';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore';
import {
  Wallet, Plus, X, Check, Ban, Trash2, Receipt as ReceiptIcon,
  AlertTriangle, Search, ExternalLink,
} from 'lucide-react';

// Getting somebody their own money back.
//
// Two people, a personal card, and a photo of a receipt. The screen is built
// around the two facts that actually matter — what is owed, and what still
// needs a decision — and the filing form is deliberately four fields and a
// camera button, because every extra field is a reason to not bother and the
// claim nobody files is the one that turns into an argument later.
//
// Policy (who may approve, who may pay, whether a paid claim can be edited) is
// decided server-side and arrives stamped on each row as `can_edit` /
// `can_decide`. This renders what it is told; a second copy of the rule here is
// how the two start disagreeing.

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const today = () => new Date().toISOString().slice(0, 10);

const STATUS = {
  submitted: { label: 'Waiting on review', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved — to pay', cls: 'bg-blue-100 text-blue-800' },
  paid: { label: 'Paid', cls: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
};

function StatusChip({ s }) {
  const t = STATUS[s] || { label: s, cls: 'bg-gray-100 text-gray-700' };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${t.cls}`}>{t.label}</span>;
}

/* ── Filing ───────────────────────────────────────────────────────────────── */

function ClaimForm({ initial, people, categories, canFileForOthers, onClose, onSaved }) {
  const [f, setF] = useState(() => initial || {
    spent_on: today(), amount: '', category: '', merchant: '', description: '',
    payment_method: 'Personal card', user_id: '',
  });
  const [custom, setCustom] = useState(() => initial?.custom_data || {});
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (initial?.id) {
        await apiPut(`/reimbursements/${initial.id}`, { ...f, custom_data: custom });
      } else {
        const fd = new FormData();
        Object.entries(f).forEach(([k, v]) => fd.append(k, v ?? ''));
        fd.append('custom_data', JSON.stringify(custom));
        for (const file of files) fd.append('receipts', file);
        await apiUpload('/reimbursements', fd);
      }
      onSaved();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit claim' : 'What did you pay for?'}</h3>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid gap-3 grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Amount *</span>
              <input required type="number" step="0.01" min="0.01" inputMode="decimal" value={f.amount}
                onChange={e => set('amount', e.target.value)} placeholder="24.99"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">When *</span>
              <input required type="date" max={today()} value={f.spent_on}
                onChange={e => set('spent_on', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Where</span>
              <input value={f.merchant || ''} onChange={e => set('merchant', e.target.value)}
                placeholder="Home Depot" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">What kind</span>
              <select value={f.category || ''} onChange={e => set('category', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">—</option>
                {(categories || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">What it was for</span>
            <textarea rows={2} value={f.description || ''} onChange={e => set('description', e.target.value)}
              placeholder="Replacement gaskets for the stick packer"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </label>

          {canFileForOthers && !initial?.id && (
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Filing for</span>
              <select value={f.user_id || ''} onChange={e => set('user_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Me</option>
                {(people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="block text-[11px] text-gray-500 mt-0.5">
                For a receipt somebody handed you on paper.
              </span>
            </label>
          )}

          <CustomFields scope="reimbursement" values={custom} onChange={setCustom} />

          {!initial?.id && (
            <div>
              <span className="block text-xs font-medium text-gray-700 mb-1">The receipt</span>
              {/* The camera for the receipt in your hand at the till, the
                  camera roll for the one photographed earlier. */}
              <PhotoPicker name="receipt" accept="image/*,application/pdf"
                onChange={e => { const picked = Array.from(e.target.files || []); e.target.value = ''; setFiles(f => [...f, ...picked]); }} />
              {files.length > 0 && <p className="text-xs text-gray-600 mt-1">{files.length} photo{files.length === 1 ? '' : 's'} attached: {files.map(f => f.name).join(', ')}</p>}
              <p className="text-[11px] text-gray-500 mt-1">
                You can add it later if you haven&apos;t got it to hand — the claim will just show as
                missing its receipt until you do.
              </p>
            </div>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : initial?.id ? 'Save' : 'Submit it'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Receipts ─────────────────────────────────────────────────────────────── */

function Receipts({ row, onChanged }) {
  const open = async (r) => {
    try {
      const { url } = await apiFetch(`/reimbursements/receipts/${r.id}/file`);
      if (url) window.open(url, '_blank');
    } catch (e) { window.alert(e.message); }
  };
  const add = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const fd = new FormData();
    for (const f of files) fd.append('receipts', f);
    try { await apiUpload(`/reimbursements/${row.id}/receipts`, fd); onChanged(); }
    catch (e2) { window.alert(e2.message); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(row.receipts || []).map(r => (
        <button key={r.id} type="button" onClick={() => open(r)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-xs text-powder-700 hover:bg-powder-50">
          <ExternalLink size={11} /> {r.filename}
        </button>
      ))}
      {!row.receipts?.length && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle size={12} /> No receipt on this one yet
        </span>
      )}
      {row.can_edit && (
        <PhotoPicker name="receipt-add" accept="image/*,application/pdf" onChange={add} takeLabel="Take a photo" chooseLabel="Choose a file" />
      )}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export default function ReimbursementsPanel({ user }) {
  const [status, setStatus] = useState('open');
  const [person, setPerson] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const expand = useRowExpand();

  const params = new URLSearchParams();
  // "Open" isn't a status the server stores — it's the two that still cost
  // money. Asked for as `all` and narrowed here so the filter can stay one
  // control instead of two.
  if (status !== 'open') params.set('status', status);
  if (person) params.set('person', person);
  if (q.trim()) params.set('q', q.trim());
  const { data, refresh } = useApiGet(`/reimbursements?${params}`, [status, person, q]);

  const { data: users } = useApiGet('/users', []);
  const canDecide = !!data?.reimbursements?.[0]?.can_decide
    || user?.role === 'admin'
    || (user?.role === 'supervisor' && ['office', 'admin'].includes((user?.department || '').toLowerCase()));

  const rows = useMemo(() => {
    const all = data?.reimbursements || [];
    return status === 'open' ? all.filter(r => r.status === 'submitted' || r.status === 'approved') : all;
  }, [data, status]);
  const view = useCappedList(rows);

  const totals = data?.totals || {};
  const reload = () => { refresh(); setAdding(false); setEditing(null); setSelected(new Set()); };
  const act = async (fn) => {
    setBusy(true);
    try { await fn(); reload(); } catch (e) { window.alert(e.message); } finally { setBusy(false); }
  };

  // Only rows on screen and still owed can be selected — a claim hidden by a
  // filter must never be paid by a button you can't see it under.
  const payable = rows.filter(r => r.status === 'submitted' || r.status === 'approved');
  const toggle = (id) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const selectedRows = payable.filter(r => selected.has(r.id));
  const selectedTotal = selectedRows.reduce((t, r) => t + Number(r.amount || 0), 0);

  const payThem = async () => {
    const who = [...new Set(selectedRows.map(r => r.person))].join(', ');
    const period = window.prompt(`Paying ${money(selectedTotal)} to ${who}.\n\nWhich pay period? (e.g. "2026-08-15", optional)`);
    if (period === null) return;
    await act(() => apiPost('/reimbursements/pay', {
      ids: selectedRows.map(r => r.id), pay_period: period,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Wallet size={18} className="text-powder-600" /> Reimbursements
          </h3>
          <p className="text-sm text-gray-500 max-w-2xl">
            Money someone spent on their own card. Photograph the receipt, say what it was, and it&apos;s
            ticked off here when it goes out in payroll.
          </p>
        </div>
        <button onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 shrink-0">
          <Plus size={15} /> New claim
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border-2 border-powder-200 bg-powder-50/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {canDecide ? 'Owed to people right now' : 'Owed to you right now'}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{money(totals.owed)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Waiting on review</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{totals.awaiting_count ?? 0}</p>
          <p className="text-xs text-gray-500">{money(totals.awaiting_review)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Approved, not yet paid</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{totals.approved_count ?? 0}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={e => { setStatus(e.target.value); setSelected(new Set()); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="open">Still owed</option>
          <option value="submitted">Waiting on review</option>
          <option value="approved">Approved — to pay</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
          <option value="all">Everything</option>
        </select>
        {canDecide && (data?.people?.length > 1) && (
          <select value={person} onChange={e => setPerson(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Everyone</option>
            {data.people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Where, what for…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      {canDecide && selectedRows.length > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-powder-300 bg-white shadow-sm px-4 py-2.5">
          <span className="text-sm text-gray-800">
            <span className="font-semibold">{selectedRows.length}</span> selected ·{' '}
            <span className="font-semibold">{money(selectedTotal)}</span>
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => act(() => Promise.all(selectedRows.filter(r => r.status === 'submitted')
              .map(r => apiPost(`/reimbursements/${r.id}/approve`, {}))))}
              disabled={busy} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Approve
            </button>
            <button onClick={payThem} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-black disabled:opacity-50">
              <Check size={14} /> Mark paid
            </button>
            <button onClick={() => setSelected(new Set())} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
        </div>
      )}

      {/* Phones get cards, not a sideways-scrolling table. The two people who
          file these are standing in a shop; "did that one get paid" has to be
          readable without dragging a table left and right. */}
      <div className="md:hidden space-y-2">
        {view.items.map(r => {
          const selectable = r.status === 'submitted' || r.status === 'approved';
          return (
            <div key={r.id} className={`bg-white rounded-xl border border-gray-200 p-3 shadow-sm ${selected.has(r.id) ? 'ring-2 ring-powder-300' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                {canDecide && selectable && (
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                    className="mt-1 shrink-0 rounded border-gray-300" aria-label={`Select ${r.person} ${money(r.amount)}`} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{money(r.amount)}
                    <span className="ml-2 font-normal text-sm text-gray-500">{r.merchant || r.category || '—'}</span>
                  </p>
                  <p className="text-xs text-gray-500">{r.spent_on}{canDecide ? ` · ${r.person}` : ''}</p>
                  {r.description && <p className="text-xs text-gray-600 mt-0.5">{r.description}</p>}
                </div>
                <StatusChip s={r.status} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                <Receipts row={r} onChanged={refresh} />
                <div className="flex items-center gap-1.5 shrink-0">
                  {canDecide && r.status === 'submitted' && (
                    <button onClick={() => act(() => apiPost(`/reimbursements/${r.id}/approve`, {}))}
                      className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-medium">Approve</button>
                  )}
                  {canDecide && r.status === 'approved' && (
                    <button onClick={() => act(() => apiPost('/reimbursements/pay', { ids: [r.id] }))}
                      className="px-2.5 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium">Mark paid</button>
                  )}
                  {r.can_edit && (
                    <button onClick={() => setEditing(r)} className="p-1.5 text-gray-400" aria-label="Edit"><ReceiptIcon size={14} /></button>
                  )}
                </div>
              </div>
              {r.status === 'paid' && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Paid {(r.paid_at || '').slice(0, 10)}{r.pay_period ? ` · period ${r.pay_period}` : ''}
                </p>
              )}
              {r.rejected_reason && <p className="mt-1 text-[11px] text-red-600">{r.rejected_reason}</p>}
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">
            Nothing here. Spent your own money on something? Use <span className="font-medium">New claim</span>.
          </p>
        )}
        <ShowMore view={view} noun="claims" />
      </div>

      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {canDecide && <th className="w-8 px-2 py-2.5" />}
                <th className="w-8 px-2 py-2.5" />
                <th className="text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap">Date</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">Who</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">What</th>
                <th className="text-right px-3 py-2.5 font-medium text-gray-600">Amount</th>
                <th className="text-left px-3 py-2.5 font-medium text-gray-600">Status</th>
                <th className="px-3 py-2.5 w-32" />
              </tr>
            </thead>
            <tbody>
              {view.items.map(r => {
                const cols = canDecide ? 8 : 7;
                const selectable = r.status === 'submitted' || r.status === 'approved';
                return (
                  <Fragment key={r.id}>
                    <tr {...expand.rowProps(r.id)} className="border-b border-gray-100">
                      {canDecide && (
                        <td className="px-2 py-2.5" onClick={stopRowClick}>
                          {selectable && (
                            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                          )}
                        </td>
                      )}
                      <td className="px-2 py-2.5"><ExpandCell open={expand.isExpanded(r.id)} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">{r.spent_on}</td>
                      <td className="px-3 py-2.5 text-gray-900">{r.person}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-gray-900">{r.merchant || r.category || '—'}</span>
                        {r.description && <span className="block text-xs text-gray-500 truncate max-w-[22rem]">{r.description}</span>}
                        {!r.receipts?.length && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle size={10} /> no receipt
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{money(r.amount)}</td>
                      <td className="px-3 py-2.5"><StatusChip s={r.status} /></td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={stopRowClick}>
                        {canDecide && r.status === 'submitted' && (
                          <button onClick={() => act(() => apiPost(`/reimbursements/${r.id}/approve`, {}))}
                            className="px-2 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700">
                            Approve
                          </button>
                        )}
                        {canDecide && r.status === 'approved' && (
                          <button onClick={() => act(() => apiPost('/reimbursements/pay', { ids: [r.id] }))}
                            className="px-2 py-1 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-black">
                            Mark paid
                          </button>
                        )}
                        {canDecide && r.status !== 'paid' && r.status !== 'rejected' && (
                          <button onClick={() => {
                            const reason = window.prompt('Why is it being turned down? They filed it in good faith and are owed an answer.');
                            if (reason?.trim()) act(() => apiPost(`/reimbursements/${r.id}/reject`, { reason }));
                          }} className="ml-1 p-1 text-gray-300 hover:text-red-600" data-tip="Reject"><Ban size={13} /></button>
                        )}
                        {r.can_edit && (
                          <button onClick={() => setEditing(r)} className="ml-1 p-1 text-gray-400 hover:text-powder-600" data-tip="Edit"><ReceiptIcon size={13} /></button>
                        )}
                        {(user?.role === 'admin' || (r.status === 'submitted' && r.can_edit)) && (
                          <button onClick={() => { if (window.confirm('Withdraw this claim?')) act(() => apiDelete(`/reimbursements/${r.id}`)); }}
                            className="ml-1 p-1 text-gray-300 hover:text-red-600" data-tip="Withdraw"><Trash2 size={13} /></button>
                        )}
                      </td>
                    </tr>
                    {expand.isExpanded(r.id) && (
                      <DetailRow colSpan={cols}>
                        <DetailFields fields={[
                          { label: 'Category', value: r.category },
                          { label: 'Paid with', value: r.payment_method },
                          { label: 'Filed', value: (r.created_at || '').slice(0, 10) },
                          { label: 'Approved by', value: r.approved_by },
                          { label: 'Paid', value: r.paid_at ? `${(r.paid_at || '').slice(0, 10)} by ${r.paid_by}${r.pay_period ? ` · period ${r.pay_period}` : ''}` : null },
                          { label: 'Turned down', value: r.rejected_reason ? `${r.rejected_reason} — ${r.rejected_by}` : null },
                        ]} />
                        <CustomFieldValues scope="reimbursement" data={r.custom_data} />
                        <div className="mt-2"><Receipts row={r} onChanged={refresh} /></div>
                      </DetailRow>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={canDecide ? 8 : 7} className="px-3 py-10 text-center text-sm text-gray-400">
                  Nothing here. Spent your own money on something? Use <span className="font-medium">New claim</span>.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <ShowMore view={view} noun="claims" />
      </div>

      {(adding || editing) && (
        <ClaimForm
          initial={editing}
          categories={data?.categories}
          people={(users || []).filter(u => u.is_active !== 0)}
          canFileForOthers={canDecide}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={reload}
        />
      )}
    </div>
  );
}
