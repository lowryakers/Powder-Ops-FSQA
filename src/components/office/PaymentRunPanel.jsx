import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { AlertTriangle, Lock, XCircle, Clock, Info, Plus, Settings2, Send, Snowflake, Ban, Copy } from 'lucide-react';

// The weekly payment run (D-360, PR A): the bills in QuickBooks, checked, and
// placed — must-pays locked at the top, flagged bills first, the rest after;
// bills kept off the run with the reason; bills not due until a later run.
// Everything on this page is DERIVED by the server on each read. The only
// writes here are a person confirming a bill's class, and Lowry's must-pay list
// and settings.
//
// D-361 (part B): a run is PREPARED (frozen into its own record), Lowry checks
// it and enters the bank balance, and "Send to Danny" texts him the link. What
// he does on his page — untick, approve, "I've sent $X" — shows here in the log.

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—');

function Chip({ tone, children }) {
  const c = { red: 'bg-red-100 text-red-800', amber: 'bg-amber-100 text-amber-800', slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800', blue: 'bg-blue-100 text-blue-800', violet: 'bg-violet-100 text-violet-800' }[tone] || 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c}`}>{children}</span>;
}

function ClassControl({ line, classes, canClassify, onDone }) {
  const [busy, setBusy] = useState(false);
  const set = async (v) => {
    setBusy(true);
    try { await apiPost(`/payment-run/bills/${line.id}/class`, { bill_class: v }); onDone(); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  if (line.bill_class) {
    return <Chip tone={line.bill_class === 'prodough_material' ? 'violet' : 'blue'}>{classes[line.bill_class]}</Chip>;
  }
  const s = line.suggested_class;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-class-confirm={line.id}>
      <Chip tone="red">Class not confirmed</Chip>
      {canClassify && Object.entries(classes).map(([k, label]) => (
        <button key={k} type="button" disabled={busy} onClick={() => set(k)} data-class-set={k}
          className={`rounded border px-2 py-0.5 text-[11px] ${s?.value === k ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-800' : 'border-slate-300 text-slate-600'}`}>
          {label}{s?.value === k ? ' (suggested)' : ''}
        </button>
      ))}
      {s?.value && <span className="text-[11px] text-slate-500">{s.why}</span>}
    </span>
  );
}

function BillRow({ line, data, onDone }) {
  const bad = line.failures?.length ? line.failures : [];
  return (
    <li className={`rounded-lg border p-3 ${line.must_pay ? 'border-slate-400 bg-slate-50' : line.highlight ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}
      data-bill={line.id} data-bill-highlight={line.highlight ? '1' : '0'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {line.must_pay && <Chip tone="slate"><Lock className="h-3 w-3" />Must-pay</Chip>}
            <span className="font-semibold text-slate-900">{line.vendor || '(no vendor)'}</span>
            {line.invoice_number && <span className="text-xs text-slate-500">#{line.invoice_number}</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            {line.what || 'No PO lines to describe it'}{line.po ? ` · PO ${line.po}` : ''} · due {day(line.due_date)}
          </div>
        </div>
        <div className="text-right font-semibold tabular-nums text-slate-900">{money(line.amount)}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ClassControl line={line} classes={data.classes} canClassify={data.can_classify} onDone={onDone} />
        {line.flags.map(f => (
          <Chip key={f.key} tone={f.severity === 'highlight' ? 'amber' : 'slate'}>
            {f.severity === 'highlight' ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />}{f.reason}
          </Chip>
        ))}
        {bad.filter(f => f.key !== 'class').map(f => <Chip key={f.key} tone="red"><XCircle className="h-3 w-3" />{f.reason}</Chip>)}
      </div>
    </li>
  );
}

function Section({ title, note, lines, data, onDone, empty, attr }) {
  return (
    <section className="space-y-2" {...attr}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{title} <span className="font-normal text-slate-500">({lines.length})</span></h3>
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
      {lines.length ? <ul className="space-y-2">{lines.map(l => <BillRow key={l.id} line={l} data={data} onDone={onDone} />)}</ul>
        : <p className="text-xs text-slate-500">{empty}</p>}
    </section>
  );
}

function MustPays({ data, onDone }) {
  const [vendor, setVendor] = useState(''); const [label, setLabel] = useState('');
  const add = async () => {
    try { await apiPost('/payment-run/must-pays', { vendor_name: vendor, label }); setVendor(''); setLabel(''); onDone(); }
    catch (e) { alert(e.message); }
  };
  const retire = async (m) => {
    const reason = window.prompt(`Why does ${m.vendor_name} come off the must-pay list?`);
    if (!reason) return;
    try { await apiPost(`/payment-run/must-pays/${m.id}/retire`, { reason }); onDone(); } catch (e) { alert(e.message); }
  };
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 p-3" data-must-pay-list>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Lock className="h-4 w-4" />Must-pay list</h3>
      <p className="text-xs text-slate-500">Bills from these vendors are locked at the top of every run and skip the PO and receiving checks. A vendor comes off with a reason; nothing is deleted.</p>
      <ul className="flex flex-wrap gap-1.5">
        {data.must_pays.map(m => (
          <li key={m.id}><Chip tone="slate">{m.vendor_name}{m.label ? ` · ${m.label}` : ''}
            {data.can_admin && <button type="button" onClick={() => retire(m)} className="ml-1 text-slate-400 hover:text-red-600" aria-label={`Take ${m.vendor_name} off`}>×</button>}
          </Chip></li>
        ))}
        {!data.must_pays.length && <li className="text-xs text-slate-500">Nothing on the list yet.</li>}
      </ul>
      {data.can_admin && (
        <div className="flex flex-wrap gap-2">
          <input id="mp-vendor" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor (as on its bills)" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          <input id="mp-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="What (e.g. lab testing)" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
          <button type="button" onClick={add} disabled={vendor.trim().length < 2} className="inline-flex items-center gap-1 rounded bg-slate-800 px-3 py-1 text-sm text-white disabled:opacity-40" data-must-pay-add><Plus className="h-4 w-4" />Add</button>
        </div>
      )}
    </section>
  );
}

function Score({ score }) {
  const max = Math.max(1, ...score.map(w => w.logged));
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 p-3" data-bill-score>
      <h3 className="text-sm font-semibold text-slate-800">Bills that failed a check, by week logged</h3>
      <p className="text-xs text-slate-500">A fixed record: a bill counts in the week it was logged once any check has failed, even after it is fixed.</p>
      <ul className="space-y-1">
        {score.map(w => (
          <li key={w.week_start} className="grid grid-cols-[6rem_1fr_5rem] items-center gap-2 text-xs">
            <span className="text-slate-500">wk of {new Date(`${w.week_start}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span className="h-2 rounded bg-slate-100"><span className="block h-2 rounded bg-red-400" style={{ width: `${(w.failed / max) * 100}%` }} /></span>
            <span className="text-right tabular-nums text-slate-700">{w.failed} of {w.logged}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsBox({ data, onDone }) {
  const { data: people } = useApiGet('/users/technicians');
  const s = data.settings;
  const [owner, setOwner] = useState(s.bill_owner?.id || '');
  const [ctrl, setCtrl] = useState(s.controller?.id || '');
  const [phone, setPhone] = useState(s.approver_phone || '');
  const [mode, setMode] = useState(s.materials_mode || 'weekly_at_cost');
  const [review, setReview] = useState(s.review_before_send !== false);
  const [bal, setBal] = useState('');
  const saveBal = async () => { try { await apiPut('/payment-run/bank-balance', { amount: bal }); setBal(''); onDone(); } catch (e) { alert(e.message); } };
  const save = async () => {
    try {
      await apiPut('/payment-run/settings', { bill_owner_id: owner || null, controller_id: ctrl || null, approver_phone: phone || null, materials_mode: mode, review_before_send: review });
      onDone();
    }
    catch (e) { alert(e.message); }
  };
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 p-3" data-payment-settings>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Settings2 className="h-4 w-4" />Who is told</h3>
      <p className="text-xs text-slate-600">Problems go to: {s.notify.map(u => u.name).join(', ') || 'nobody'}{s.notify_set ? '' : ' (default)'}.</p>
      {data.can_admin ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-600">Bill owner (fixes bill problems)
            <select id="pr-owner" value={owner} onChange={e => setOwner(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">— nobody set —</option>
              {(people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Controller (fixes payment problems)
            <select id="pr-ctrl" value={ctrl} onChange={e => setCtrl(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="">— nobody set —</option>
              {(people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Approver's mobile (blank = the flavor approver's number)
            <input id="pr-phone" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder={s.approver_number || '10-digit number'}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm" data-approver-phone />
          </label>
          <label className="text-xs text-slate-600">Materials invoice
            <select id="pr-mode" value={mode} onChange={e => setMode(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm">
              {Object.entries(s.materials_modes || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="mt-0.5 block text-[11px] text-slate-500">Until the accountant confirms how ProDough is invoiced.</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-600 sm:col-span-2">
            <input id="pr-review" type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" data-review-before-send />
            <span>I review the run before the text goes to Danny. Off: the run goes to Danny on its own on run day, if a bank balance was entered that week.</span>
          </label>
          <div><button type="button" onClick={save} className="rounded bg-slate-800 px-3 py-1 text-sm text-white" data-settings-save>Save</button></div>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 border-t border-slate-100 pt-2">
            <label className="text-xs text-slate-600">This week's bank balance (rides onto the run when it is prepared)
              <input id="pr-balance" value={bal} onChange={e => setBal(e.target.value)} inputMode="decimal" placeholder="e.g. 12500"
                className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <button type="button" disabled={bal === ''} onClick={saveBal} className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40" data-balance-save>Save balance</button>
            {s.bank_balance && <span className="text-[11px] text-slate-500">{money(s.bank_balance.amount)} entered by {s.bank_balance.by}, {new Date(s.bank_balance.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-600">Bill owner: {s.bill_owner?.name || 'nobody set'} · Controller: {s.controller?.name || 'nobody set'} · Danny's text goes to {s.approver_number || 'no number set'}</p>
      )}
    </section>
  );
}

const STATUS = {
  draft: ['amber', 'Prepared, not sent'], sent: ['blue', 'Waiting for Danny'], approved: ['violet', 'Approved, transfer not sent'],
  transferred: ['green', 'Transfer sent'], cancelled: ['slate', 'Cancelled'],
};
const EVENT = {
  frozen: 'Prepared', bank_balance: 'Bank balance entered', sent: 'Sent to Danny', resent: 'Sent again (new link)', opened: 'Page opened',
  unticked: 'Unticked', ticked: 'Ticked again', approved: 'Approved', transferred: 'Transfer recorded', reminder: 'Reminder sent', cancelled: 'Cancelled',
};
const when = (v) => (v ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v.replace(' ', 'T')}Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function OwesLines({ o }) {
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2" data-owes>
      <div className="flex justify-between"><dt className="text-slate-500">Materials invoice (at cost)</dt><dd className="tabular-nums">{money(o.materials)}</dd></div>
      <div className="flex justify-between"><dt className="text-slate-500">Production invoices</dt><dd className="tabular-nums">{o.production_count ? money(o.production) : 'none yet'}</dd></div>
      <div className="flex justify-between"><dt className="text-slate-500">Powder Ops expenses</dt><dd className="tabular-nums">{money(o.expenses)}</dd></div>
      <div className="flex justify-between"><dt className="text-slate-500">Bank balance used</dt><dd className="tabular-nums">{o.bank_balance === null ? 'not entered' : money(o.bank_balance)}</dd></div>
      {o.shortfall > 0 && <div className="flex justify-between"><dt className="text-slate-500">Shortfall</dt><dd className="tabular-nums">{money(o.shortfall)}</dd></div>}
      <div className="flex justify-between font-semibold sm:col-span-2 border-t border-slate-200 pt-1"><dt>ProDough owes</dt><dd className="tabular-nums" data-owes-total>{money(o.owes)}</dd></div>
    </dl>
  );
}

function RunCard({ run, canAdmin, onDone }) {
  const [open, setOpen] = useState(run.status === 'draft' || run.status === 'sent');
  const [bal, setBal] = useState(run.summary.bank_balance ?? '');
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chip, label] = STATUS[run.status] || ['slate', run.status];
  const act = async (fn) => { setBusy(true); try { await fn(); onDone(); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const send = () => act(async () => {
    const r = await apiPost(`/payment-run/runs/${run.id}/send`, {});
    setLink(r.texted ? null : r.link);
    if (r.texted) alert(`Texted to ${r.sent_to}.`);
  });
  const cancel = () => {
    const reason = window.prompt(`Why is ${run.run_no} cancelled? Its bills go back on the next run.`);
    if (reason) act(() => apiPost(`/payment-run/runs/${run.id}/cancel`, { reason }));
  };
  const s = run.summary;
  return (
    <li className="rounded-lg border border-slate-200 p-3" data-frozen-run={run.run_no} data-run-status={run.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex flex-wrap items-center gap-2 text-left">
          <span className="font-semibold text-slate-900">{run.run_no}</span>
          {run.kind === 'urgent' && <Chip tone="red">Urgent</Chip>}
          <Chip tone={chip}>{label}</Chip>
          <span className="text-sm tabular-nums text-slate-700">ProDough owes {money(s.owes)}</span>
          <span className="text-xs text-slate-500">{s.bills} bill{s.bills === 1 ? '' : 's'}{s.unticked ? ` · ${s.unticked} unticked` : ''}</span>
        </button>
        <span className="text-xs text-slate-500">{run.status === 'transferred' ? `${run.transferred_name} sent ${money(run.transferred_amount)} · ${when(run.transferred_at)}`
          : run.status === 'approved' ? `Approved by ${run.approved_name} · ${when(run.approved_at)}` : run.sent_at ? `Sent ${when(run.sent_at)}` : `Prepared ${when(run.created_at)}`}</span>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          {run.reason && <p className="text-xs text-slate-600">Why urgent: {run.reason}</p>}
          <p className="text-sm text-slate-800" data-run-sentence>{run.sentence}</p>
          <OwesLines o={s} />
          {canAdmin && run.status === 'draft' && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">Bank balance Powder Ops can pay from
                <input id={`bal-${run.id}`} value={bal} onChange={e => setBal(e.target.value)} inputMode="decimal" placeholder="e.g. 12500"
                  className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1 text-sm" data-run-balance />
              </label>
              <button type="button" disabled={busy || bal === ''} onClick={() => act(() => apiPost(`/payment-run/runs/${run.id}/bank-balance`, { amount: bal }))}
                className="rounded border border-slate-300 px-3 py-1 text-sm disabled:opacity-40" data-run-balance-save>Use this balance</button>
            </div>
          )}
          <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm" data-run-lines>
            {run.lines.map(l => (
              <li key={l.id} className={`flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5 ${l.included ? '' : 'text-slate-400 line-through'}`} data-run-line={l.included ? 'on' : 'off'}>
                <span className="min-w-0">{l.must_pay && <Lock className="mr-1 inline h-3 w-3" />}{l.vendor}{l.invoice_number ? ` #${l.invoice_number}` : ''}
                  <span className="ml-1 text-xs text-slate-500">{l.bill_class === 'prodough_material' ? 'ProDough material' : 'Powder Ops expense'}</span></span>
                <span className="tabular-nums">{money(l.amount)}</span>
              </li>
            ))}
          </ul>
          {canAdmin && (run.status === 'draft' || run.status === 'sent') && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || s.bank_balance === null} onClick={send} data-run-send
                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                <Send className="h-4 w-4" />{run.status === 'sent' ? 'Send again (new link)' : 'Checked: send to Danny'}
              </button>
              <button type="button" disabled={busy} onClick={cancel} data-run-cancel className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
                <Ban className="h-4 w-4" />Cancel run
              </button>
              {s.bank_balance === null && <span className="self-center text-xs text-amber-700">Enter the bank balance first.</span>}
            </div>
          )}
          {link && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-run-link>
              Texting is not set up, so nothing was sent. Text Danny this link yourself (it works once and expires in 5 days):
              <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all">{link}</code>
                <button type="button" onClick={() => navigator.clipboard?.writeText(link)} className="shrink-0 rounded border border-amber-400 px-2 py-0.5"><Copy className="h-3 w-3" /></button></div>
            </div>
          )}
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">What happened ({run.events.length})</summary>
            <ul className="mt-1 space-y-0.5" data-run-events>
              {run.events.map((e, i) => (
                <li key={i}>{when(e.at)} · {EVENT[e.kind] || e.kind}{e.by_name ? ` · ${e.by_name}` : ''}{e.detail?.vendor ? ` · ${e.detail.vendor} ${money(e.detail.amount)}` : ''}
                  {e.detail?.amount && !e.detail?.vendor ? ` · ${money(e.detail.amount)}` : ''}{e.ip ? ` · ${e.ip}` : ''}{e.device ? ` · ${String(e.device).slice(0, 60)}` : ''}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </li>
  );
}

function UrgentRun({ data, onDone }) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState([]);
  const [reason, setReason] = useState('');
  const pool = [...data.on_run, ...data.held];
  const go = async () => {
    try { await apiPost('/payment-run/runs', { kind: 'urgent', ids, reason }); setOpen(false); setIds([]); setReason(''); onDone(); }
    catch (e) { alert(e.message); }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700" data-urgent-open>Urgent run…</button>;
  return (
    <div className="w-full space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-3" data-urgent-run>
      <p className="text-xs text-slate-700">Pick the bills that cannot wait. Danny approves them on the same page.</p>
      <ul className="max-h-60 space-y-1 overflow-auto">
        {pool.map(l => (
          <li key={l.id}><label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={ids.includes(l.id)} onChange={e => setIds(v => e.target.checked ? [...v, l.id] : v.filter(x => x !== l.id))} />
            <span className="min-w-0 flex-1">{l.vendor} {l.invoice_number ? `#${l.invoice_number}` : ''} · due {day(l.due_date)}</span><span className="tabular-nums">{money(l.amount)}</span>
          </label></li>
        ))}
      </ul>
      <input id="urgent-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why it cannot wait" className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
      <div className="flex gap-2">
        <button type="button" disabled={!ids.length || reason.trim().length < 3} onClick={go} className="rounded bg-red-700 px-3 py-1 text-sm text-white disabled:opacity-40" data-urgent-go>Prepare urgent run</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 px-3 py-1 text-sm">Close</button>
      </div>
    </div>
  );
}

function PreparedRuns({ data, onDone }) {
  const thisWeek = (data.runs || []).find(r => r.kind === 'weekly' && r.week_start === data.run.week_start && r.status !== 'cancelled');
  const [busy, setBusy] = useState(false);
  const prepare = async () => {
    setBusy(true);
    try { await apiPost('/payment-run/runs', { kind: 'weekly' }); onDone(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-2 rounded-lg border border-slate-300 p-3" data-prepared-runs>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Snowflake className="h-4 w-4" />Runs for Danny's approval</h3>
        <div className="flex flex-wrap gap-2">
          {!thisWeek && data.can_classify && (
            <button type="button" disabled={busy || !data.on_run.length} onClick={prepare} data-run-prepare
              className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40">Prepare this week's run now</button>
          )}
          {data.can_admin && <UrgentRun data={data} onDone={onDone} />}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        The run is prepared on its own on run day and you are asked to check it. Preparing it freezes the bills: what Danny sees does not change if a bill is corrected afterwards (cancel and prepare again).
      </p>
      {(data.runs || []).length ? <ul className="space-y-2">{data.runs.map(r => <RunCard key={r.id} run={r} canAdmin={data.can_admin} onDone={onDone} />)}</ul>
        : <p className="text-xs text-slate-500">No run prepared yet.</p>}
    </section>
  );
}

export default function PaymentRunPanel() {
  const { data, loading, error, refresh } = useApiGet('/payment-run');
  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!data) return null;
  const t = data.totals;
  const run = data.run;
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4" data-payment-run>
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Payment run · {day(run.date)}{run.time ? ` at ${run.time}` : ''}</h2>
        <p className="text-sm text-slate-600">
          {run.payroll_week ? 'Payroll week: the run is Friday at noon.' : 'The run is Thursday.'}
          {run.moved ? ' Moved past a plant holiday.' : ''} Only bills entered in QuickBooks are listed.
          {data.not_in_qbo ? <> <span className="font-medium text-slate-800">{data.not_in_qbo} bill{data.not_in_qbo === 1 ? '' : 's'} in AP Drop not in QuickBooks yet.</span></> : null}
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-4" data-run-totals>
        <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">On this run</div><div className="text-lg font-semibold tabular-nums">{money(t.total)}</div><div className="text-xs text-slate-500">{t.count} bill{t.count === 1 ? '' : 's'}</div></div>
        <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">ProDough materials</div><div className="text-lg font-semibold tabular-nums">{money(t.materials)}</div><div className="text-xs text-slate-500">ProDough reimburses at cost</div></div>
        <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">Powder Ops expenses</div><div className="text-lg font-semibold tabular-nums">{money(t.expenses)}</div><div className="text-xs text-slate-500">incl. must-pays {money(t.must_pay)}</div></div>
        <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">To look at</div><div className="text-lg font-semibold tabular-nums">{t.highlighted} <span className="text-sm font-normal text-slate-500">highlighted</span></div><div className="text-xs text-slate-500">{t.failed} off the run · {t.held} not due yet</div></div>
      </div>

      <PreparedRuns data={data} onDone={refresh} />

      <Section title="Ready to pay" note="Not on a prepared run yet · must-pays first, then highlighted" lines={data.on_run} data={data} onDone={refresh}
        empty="No bills ready for this run." attr={{ 'data-run-on': '' }} />
      <Section title="Kept off the run" note={data.settings.bill_owner ? `${data.settings.bill_owner.name} fixes these` : 'No bill owner set'} lines={data.failed} data={data} onDone={refresh}
        empty="Nothing failed a check." attr={{ 'data-run-failed': '' }} />
      <Section title="Not due until a later run" note={`Due after ${day(run.following)}`} lines={data.held} data={data} onDone={refresh}
        empty="Nothing waiting." attr={{ 'data-run-held': '' }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <MustPays data={data} onDone={refresh} />
        <Score score={data.score} />
      </div>
      <SettingsBox data={data} onDone={refresh} />
      <p className="flex items-start gap-1.5 text-xs text-slate-500"><Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Coming next: the bill-line and bank-detail checks, paying and invoicing after approval, and production invoices to ProDough.
      </p>
    </div>
  );
}
