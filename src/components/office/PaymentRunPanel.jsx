import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { AlertTriangle, Lock, XCircle, Clock, Info, Plus, Settings2 } from 'lucide-react';

// The weekly payment run (D-360, PR A): the bills in QuickBooks, checked, and
// placed — must-pays locked at the top, flagged bills first, the rest after;
// bills kept off the run with the reason; bills not due until a later run.
// Everything on this page is DERIVED by the server on each read. The only
// writes here are a person confirming a bill's class, and Lowry's must-pay list
// and settings.

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
  const save = async () => {
    try { await apiPut('/payment-run/settings', { bill_owner_id: owner || null, controller_id: ctrl || null }); onDone(); }
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
          <div><button type="button" onClick={save} className="rounded bg-slate-800 px-3 py-1 text-sm text-white" data-settings-save>Save</button></div>
        </div>
      ) : (
        <p className="text-xs text-slate-600">Bill owner: {s.bill_owner?.name || 'nobody set'} · Controller: {s.controller?.name || 'nobody set'}</p>
      )}
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

      <Section title="On this run" note="Must-pays locked first, then highlighted, then noted" lines={data.on_run} data={data} onDone={refresh}
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
        Coming next: Danny's approval text and page, the bill-line and bank-detail checks, and paying and invoicing after approval.
      </p>
    </div>
  );
}
