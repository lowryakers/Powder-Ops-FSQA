// Release & publishing (D-246, D-247): the readiness report Lowry reads before
// strict, what the lot rule would have blocked (for Quality to call right or
// wrong), one lot at a time with its override and its publish checklist, the
// publications, and the two public switches. Everything signed asks for the
// password; nothing here changes the gate's mode except the mode control,
// which asks why.
import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature';
import downloadFile from '../../lib/downloadFile';
import { AlertTriangle, CheckCircle2, Circle, Eye, Globe, Lock, ShieldCheck, X } from 'lucide-react';

const enc = encodeURIComponent;
const MODE_LABEL = { off: 'Off', warn: 'Warn', on: 'Strict' };
const Tick = ({ ok }) => (ok ? <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" /> : <Circle size={14} className="text-amber-500 shrink-0 mt-0.5" />);
const fmt = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '—');

function signed(send, title, detail) {
  return withSignature(send, { title, detail: `${detail} Enter the password you sign in with.` });
}

function Readiness({ isAdmin, onOpenLot }) {
  const { data, refresh } = useApiGet('/coa/readiness');
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [golden, setGolden] = useState(null);
  const [msg, setMsg] = useState('');
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const changeMode = async () => {
    setMsg('');
    try {
      await signed((x) => apiPut('/coa/release-gate', { mode, reason, ...x }), 'Change the release gate', `Release gate: ${MODE_LABEL[data.mode]} → ${MODE_LABEL[mode]}.`);
      setMode(null); setReason(''); refresh();
    } catch (e) { if (!e.cancelled) setMsg(e.message); }
  };
  const attest = async () => {
    setMsg('');
    try {
      await signed((x) => apiPost('/coa/readiness/golden-attest', { ...golden, ...x }), 'Record the golden-file run', `${golden.pdfs_read} lab reports read on ${golden.run_on}.`);
      setGolden(null); refresh();
    } catch (e) { if (!e.cancelled) setMsg(e.message); }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-coa-readiness={data.mode}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-900">Ready for strict?</h3>
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800" data-readiness-mode>Gate: {MODE_LABEL[data.mode]}</span>
        <span className="text-sm text-gray-700" data-readiness-headline>{data.headline}</span>
        <button type="button" onClick={() => downloadFile('/coa/readiness?format=csv', 'coa-readiness.csv').catch(() => {})} className="ml-auto text-xs text-powder-600 hover:underline">Download CSV</button>
      </div>
      <ul className="space-y-1">
        {data.lines.map(l => <li key={l.key} className="flex gap-2 text-sm text-gray-700" data-readiness-line={l.key} data-ok={l.ok ? '1' : '0'}><Tick ok={l.ok} />{l.text}</li>)}
      </ul>
      {data.would_block.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-700">Lots strict would block ({data.would_block.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.would_block.map(l => (
              <li key={`${l.item_number}|${l.base_lot}`} className="text-xs text-gray-600" data-would-block-lot={l.base_lot}>
                <button type="button" onClick={() => onOpenLot(l.item_number, l.base_lot)} className="text-powder-600 hover:underline font-medium">{l.display_name || l.item_number} · lot {l.base_lot}</button>
                {' — '}{l.summary}{l.at_fault.length ? `: ${l.at_fault.map(b => `batch ${b.batch ?? '—'} (${b.reasons.join('; ')})`).join(' · ')}` : l.problems.length ? `: ${l.problems.join('; ')}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2 text-xs">
        {isAdmin && !mode && (
          <select value="" onChange={e => setMode(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg" data-readiness-mode-select>
            <option value="">Change the gate…</option>
            {['off', 'warn', 'on'].filter(m => m !== data.mode).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        )}
        {!golden && <button type="button" onClick={() => setGolden({ run_on: new Date().toISOString().slice(0, 10), pdfs_read: '', mismatches: '0', unread_rows: '0', note: '' })} className="px-2 py-1 border border-gray-300 rounded-lg">Record a golden-file run</button>}
      </div>
      {mode && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 text-sm">
          <p>Move the gate from <b>{MODE_LABEL[data.mode]}</b> to <b>{MODE_LABEL[mode]}</b>.{mode === 'on' && ' Strict stops a certificate or a production QA sign-off for a lot the rule does not release.'}</p>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why" className="w-full px-2 py-1 border border-gray-300 rounded" data-readiness-mode-reason />
          <div className="flex gap-2"><button type="button" onClick={changeMode} className="px-3 py-1 bg-powder-600 text-white rounded-lg text-xs font-semibold">Change</button><button type="button" onClick={() => setMode(null)} className="text-xs text-gray-500">Cancel</button></div>
        </div>
      )}
      {golden && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 grid gap-2 sm:grid-cols-4 text-xs" data-golden-form>
          <p className="sm:col-span-4 text-gray-600">Run the real lab reports through the reader on a computer (see the runbook), then record what it showed. The reports never come to the server.</p>
          <label className="grid gap-1">Run on<input type="date" value={golden.run_on} onChange={e => setGolden(g => ({ ...g, run_on: e.target.value }))} className="px-2 py-1 border rounded" /></label>
          <label className="grid gap-1">Lab reports read<input value={golden.pdfs_read} onChange={e => setGolden(g => ({ ...g, pdfs_read: e.target.value }))} inputMode="numeric" className="px-2 py-1 border rounded" /></label>
          <label className="grid gap-1">Mismatches<input value={golden.mismatches} onChange={e => setGolden(g => ({ ...g, mismatches: e.target.value }))} inputMode="numeric" className="px-2 py-1 border rounded" /></label>
          <label className="grid gap-1">Unread lines<input value={golden.unread_rows} onChange={e => setGolden(g => ({ ...g, unread_rows: e.target.value }))} inputMode="numeric" className="px-2 py-1 border rounded" /></label>
          <label className="grid gap-1 sm:col-span-4">Note<input value={golden.note} onChange={e => setGolden(g => ({ ...g, note: e.target.value }))} className="px-2 py-1 border rounded" /></label>
          <div className="flex gap-2 sm:col-span-4"><button type="button" onClick={attest} className="px-3 py-1 bg-powder-600 text-white rounded-lg font-semibold">Record</button><button type="button" onClick={() => setGolden(null)} className="text-gray-500">Cancel</button></div>
        </div>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </section>
  );
}

function WouldBlocks({ onOpenLot }) {
  const { data, refresh } = useApiGet('/coa/gate-events?pending=1');
  const [open, setOpen] = useState(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const events = data?.events || [];
  const review = async (id, verdict) => {
    setMsg('');
    try { await apiPost(`/coa/gate-events/${id}/review`, { review: verdict, note }); setOpen(null); setNote(''); refresh(); } catch (e) { setMsg(e.message); }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-2" data-would-blocks={events.length}>
      <h3 className="font-semibold text-gray-900">Would strict have been right? ({events.length})</h3>
      <p className="text-xs text-gray-500">Each time a lot reaches a certificate signature or a production QA sign-off while the gate is on warn, the app writes down whether strict would have stopped it. Say for each one whether that would have been right — strict waits for 30 days of these with no wrong blocks in the last 14.</p>
      {events.length === 0 ? <p className="text-sm text-gray-400">Nothing to review.</p> : (
        <ul className="divide-y divide-gray-100">
          {events.map(e => (
            <li key={e.id} className="py-2 text-sm" data-gate-event={e.id}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onOpenLot(e.item_number, e.base_lot)} className="font-medium text-powder-600 hover:underline">{e.item_number} · lot {e.base_lot}</button>
                <span className="text-xs text-gray-500">{e.door === 'coa_sign' ? 'certificate signature' : 'production QA sign-off'} · {fmt(e.at)} · {e.actor || '—'}</span>
                {open !== e.id && <button type="button" onClick={() => { setOpen(e.id); setNote(''); }} className="ml-auto text-xs text-powder-600 hover:underline">Review</button>}
              </div>
              <p className="text-xs text-gray-600">{e.reasons.join('; ')}</p>
              {open === e.id && (
                <div className="mt-1 flex flex-wrap gap-2 items-center">
                  <input value={note} onChange={x => setNote(x.target.value)} placeholder="Why" className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded text-xs" data-gate-event-note />
                  <button type="button" onClick={() => review(e.id, 'correct')} className="px-2 py-1 text-xs rounded bg-green-600 text-white" data-gate-event-correct>Right to block</button>
                  <button type="button" onClick={() => review(e.id, 'false_block')} className="px-2 py-1 text-xs rounded bg-red-600 text-white" data-gate-event-false>Wrong — should have passed</button>
                  <button type="button" onClick={() => setOpen(null)} className="text-xs text-gray-500">Cancel</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </section>
  );
}

function Preview({ pages, onClose }) {
  const [i, setI] = useState(0);
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-3" role="dialog" aria-label="Public page preview">
      <div className="bg-white rounded-xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b text-sm">
          <Eye size={15} /> <b>Preview of the public page</b>
          {pages.length > 1 && pages.map((p, j) => <button key={j} type="button" onClick={() => setI(j)} className={`px-2 py-0.5 rounded text-xs ${i === j ? 'bg-powder-600 text-white' : 'bg-gray-100'}`}>Batch {p.batch ?? '—'}</button>)}
          <button type="button" onClick={onClose} className="ml-auto p-1" aria-label="Close"><X size={16} /></button>
        </div>
        <iframe title="Public certificate preview" sandbox="" srcDoc={pages[i].html} className="flex-1 w-full" data-public-preview />
      </div>
    </div>
  );
}

function Lot({ item, base, onClose }) {
  const { data, refresh } = useApiGet(`/coa/lots/${enc(item)}/${enc(base)}`);
  const [check, setCheck] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState(null);
  const [msg, setMsg] = useState('');
  if (!data) return null;
  const run = async (fn) => { setMsg(''); try { await fn(); } catch (e) { if (!e.cancelled) setMsg(e.message); } };
  const loadCheck = () => run(async () => setCheck(await apiFetch(`/coa/lots/${enc(item)}/${enc(base)}/publish-check`)));
  const loadPreview = () => run(async () => setPreview((await apiFetch(`/coa/lots/${enc(item)}/${enc(base)}/preview`)).pages));
  const override = () => run(async () => {
    await signed((x) => apiPost(`/coa/lots/${enc(item)}/${enc(base)}/override`, { reason, ...x }), 'Override the lot rule', `Let production QA sign-off go ahead for ${item} lot ${base}. This never makes a certificate signable or publishable.`);
    setAction(null); setReason(''); refresh();
  });
  const revoke = () => run(async () => {
    await signed((x) => apiPost(`/coa/lots/${enc(item)}/${enc(base)}/override/revoke`, { reason, ...x }), 'Revoke the override', `${item} lot ${base}.`);
    setAction(null); setReason(''); refresh();
  });
  const publish = () => run(async () => {
    const out = await signed((x) => apiPost(`/coa/lots/${enc(item)}/${enc(base)}/publish`, x), 'Publish this lot', `Every batch of ${data.product?.display_name || item} lot ${base} goes on the public page.`);
    setMsg(out.note); refresh(); setCheck(null);
  });
  return (
    <section className="bg-white rounded-xl border-2 border-powder-200 p-4 space-y-3" data-coa-lot={base} data-lot-state={data.state}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-900">{data.product?.display_name || item} · lot {base}</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${data.met ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{data.met ? 'Released' : data.state === 'unknown' ? 'No required tests defined' : 'Not released'}</span>
        <button type="button" onClick={onClose} className="ml-auto p-1" aria-label="Close lot"><X size={16} /></button>
      </div>
      <p className="text-sm text-gray-700">{data.summary}.{data.plan ? ` Plan: ${data.plan.name} v${data.plan.version} (${data.plan.status}).` : ''}</p>
      {data.batches.length > 0 && (
        <ul className="text-sm space-y-1">
          {data.batches.map(b => <li key={b.request_id} className="flex gap-2" data-lot-batch={b.batch ?? ''}><Tick ok={b.state === 'ok'} /><span>Batch {b.batch ?? '—'} ({b.lot_number}){b.reasons.length ? ` — ${b.reasons.join('; ')}` : ' — signed and passing'}</span></li>)}
        </ul>
      )}
      <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-2">
        <p className="font-medium flex items-center gap-1.5"><ShieldCheck size={15} /> Override</p>
        {data.override ? (
          <p className="text-xs text-gray-700" data-lot-override>In force since {fmt(data.override.at)}, by {data.override.by_name}: {data.override.reason}. It lets production QA sign-off go ahead in strict; it never makes a certificate signable or publishable.</p>
        ) : <p className="text-xs text-gray-500">None. In strict, production QA sign-off for this lot is refused until the lot is released or Quality overrides it.</p>}
        {data.can_override && !action && <button type="button" onClick={() => { setAction(data.override ? 'revoke' : 'override'); setReason(''); }} className="text-xs text-powder-600 hover:underline">{data.override ? 'Revoke the override' : 'Override this lot'}</button>}
        {action && (
          <div className="flex flex-wrap gap-2 items-center">
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder={action === 'override' ? 'Why (at least 10 characters)' : 'Why'} className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded text-xs" data-lot-override-reason />
            <button type="button" onClick={action === 'override' ? override : revoke} className="px-2 py-1 text-xs rounded bg-powder-600 text-white" data-lot-override-go>{action === 'override' ? 'Override' : 'Revoke'}</button>
            <button type="button" onClick={() => setAction(null)} className="text-xs text-gray-500">Cancel</button>
          </div>
        )}
      </div>
      <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-2">
        <p className="font-medium flex items-center gap-1.5"><Globe size={15} /> Public certificate</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" onClick={loadCheck} className="px-2 py-1 border border-gray-300 rounded bg-white" data-publish-check>Check whether it can be published</button>
          <button type="button" onClick={loadPreview} className="px-2 py-1 border border-gray-300 rounded bg-white" data-publish-preview>Preview the public page</button>
        </div>
        {check && (
          <ul className="space-y-1" data-publish-checks={check.ok ? 'ok' : 'blocked'}>
            {check.checks.map((c, i) => <li key={i} className="flex gap-2 text-xs text-gray-700" data-check={c.key} data-ok={c.ok ? '1' : '0'}><Tick ok={c.ok} />{c.text}</li>)}
          </ul>
        )}
        {check?.ok && data.can_publish && <button type="button" onClick={publish} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-semibold" data-publish-go>Publish lot {base}</button>}
        {check?.ok && !data.can_publish && <p className="text-xs text-gray-500"><Lock size={12} className="inline" /> Publishing is an admin&apos;s decision for now.</p>}
        {data.publications.length > 0 && <p className="text-xs text-gray-600">Published before: {data.publications.map(p => `batch ${p.batch ?? '—'} ${p.status}`).join(', ')}.</p>}
      </div>
      {msg && <p className="text-xs text-gray-800" data-lot-msg>{msg}</p>}
      {preview && <Preview pages={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function Publications({ isAdmin }) {
  const { data, refresh } = useApiGet('/coa/publications');
  const [withdraw, setWithdraw] = useState(null);
  const [reason, setReason] = useState('');
  const [sw, setSw] = useState(null);
  const [msg, setMsg] = useState('');
  if (!data) return null;
  const run = async (fn) => { setMsg(''); try { await fn(); } catch (e) { if (!e.cancelled) setMsg(e.message); } };
  const doWithdraw = () => run(async () => {
    await signed((x) => apiPost(`/coa/publications/${withdraw.id}/withdraw`, { reason, ...x }), 'Withdraw a public certificate', `Certificate ${withdraw.certificate_number}, lot ${withdraw.base_lot}.`);
    setWithdraw(null); setReason(''); refresh();
  });
  const doSwitch = () => run(async () => {
    await signed((x) => apiPut(`/coa/public-switches/${sw.key}`, { value: sw.value, reason, ...x }), 'Change a public switch', `${sw.label}: ${sw.value}.`);
    setSw(null); setReason(''); refresh();
  });
  const st = data.public;
  const live = st.enabled === 'on' && st.brand_allowed;
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-publications={data.publications.length}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-900">Public certificates</h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${live ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`} data-public-live={live ? 'on' : 'off'}>{live ? 'Page is live' : 'Page is off'}</span>
      </div>
      <ul className="text-xs text-gray-700 space-y-1">
        <li className="flex flex-wrap items-center gap-2" data-switch="enabled">Public certificate page: <b>{st.enabled}</b>{isAdmin && <button type="button" onClick={() => { setSw({ key: 'enabled', value: st.enabled === 'on' ? 'off' : 'on', label: 'The public certificate page' }); setReason(''); }} className="text-powder-600 hover:underline">Switch {st.enabled === 'on' ? 'off' : 'on'}</button>}</li>
        <li className="flex flex-wrap items-center gap-2" data-switch="brand">ProDough publishing: <b>{st.brand_allowed ? 'allowed' : 'not allowed'}</b>{isAdmin && <button type="button" onClick={() => { setSw({ key: 'brand', value: st.brand_allowed ? 'off' : 'on', label: 'ProDough publishing' }); setReason(''); }} className="text-powder-600 hover:underline">{st.brand_allowed ? 'Stop' : 'Allow'}</button>}</li>
        <li>Search engines: <b>{st.indexable === 'on' ? 'allowed' : 'blocked'}</b> · Gluten results on products with no gluten-free claim: <b>{st.nonclaim_gluten}</b></li>
      </ul>
      {sw && (
        <div className="flex flex-wrap gap-2 items-center rounded-lg bg-amber-50 border border-amber-200 p-2">
          <span className="text-xs">{sw.label} → <b>{sw.value}</b></span>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why" className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded text-xs" data-switch-reason />
          <button type="button" onClick={doSwitch} className="px-2 py-1 text-xs rounded bg-powder-600 text-white" data-switch-go>Change</button>
          <button type="button" onClick={() => setSw(null)} className="text-xs text-gray-500">Cancel</button>
        </div>
      )}
      {data.publications.length === 0 ? <p className="text-sm text-gray-400">Nothing published yet.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-left text-gray-500"><th className="py-1 pr-2">Product</th><th className="pr-2">Lot</th><th className="pr-2">Batch</th><th className="pr-2">Certificate</th><th className="pr-2">Status</th><th className="pr-2">Published</th><th /></tr></thead>
          <tbody>{data.publications.map(p => (
            <tr key={p.id} className="border-t border-gray-100" data-publication={p.public_id} data-status={p.status}>
              <td className="py-1 pr-2">{p.product_slug}</td><td className="pr-2">{p.base_lot}</td><td className="pr-2">{p.batch ?? '—'}</td><td className="pr-2">{p.certificate_number}</td>
              <td className="pr-2">{p.status}{p.withdrawn_reason ? ` — ${p.withdrawn_reason}` : ''}</td><td className="pr-2">{fmt(p.published_at)} · {p.published_by}</td>
              <td>{data.can_withdraw && p.status === 'published' && <button type="button" onClick={() => { setWithdraw(p); setReason(''); }} className="text-red-600 hover:underline" data-withdraw={p.public_id}>Withdraw</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {withdraw && (
        <div className="flex flex-wrap gap-2 items-center rounded-lg bg-red-50 border border-red-200 p-2">
          <span className="text-xs">Withdraw certificate {withdraw.certificate_number} (lot {withdraw.base_lot}, batch {withdraw.batch ?? '—'}). The public page will say it was withdrawn.</span>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why (at least 10 characters)" className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded text-xs" data-withdraw-reason />
          <button type="button" onClick={doWithdraw} className="px-2 py-1 text-xs rounded bg-red-600 text-white" data-withdraw-go>Withdraw</button>
          <button type="button" onClick={() => setWithdraw(null)} className="text-xs text-gray-500">Cancel</button>
        </div>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </section>
  );
}

export default function CoaRelease({ isAdmin, initialLot = null }) {
  const [lot, setLot] = useState(initialLot);
  const [find, setFind] = useState({ item: '', base: '' });
  const openLot = (item, base) => setLot({ item, base });
  return (
    <div className="space-y-4" data-coa-release>
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-900 flex gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        A lot is released only when every batch has a signed certificate with every test its approved plan requires, all passing. On warn the app writes down what strict would do and stops nothing.
      </div>
      <form className="flex flex-wrap gap-2 items-end text-xs" onSubmit={e => { e.preventDefault(); if (find.item && find.base) openLot(find.item.trim(), find.base.trim()); }}>
        <label className="grid gap-1">Item number<input value={find.item} onChange={e => setFind(f => ({ ...f, item: e.target.value }))} className="px-2 py-1 border border-gray-300 rounded" data-lot-find-item /></label>
        <label className="grid gap-1">Lot (without the batch)<input value={find.base} onChange={e => setFind(f => ({ ...f, base: e.target.value }))} className="px-2 py-1 border border-gray-300 rounded" data-lot-find-base /></label>
        <button type="submit" className="px-3 py-1.5 bg-powder-600 text-white rounded-lg font-semibold">Open lot</button>
      </form>
      {lot && <Lot key={`${lot.item}|${lot.base}`} item={lot.item} base={lot.base} onClose={() => setLot(null)} />}
      <Readiness isAdmin={isAdmin} onOpenLot={openLot} />
      <WouldBlocks onOpenLot={openLot} />
      <Publications isAdmin={isAdmin} />
    </div>
  );
}
