// Stability studies, their pulls, and what each product's expiration date
// rests on (CAR 4990683-9). A missed pull is a row past its date with nothing
// pulled — derived by the server on every read, so this screen never decides
// it. Sits in Retention Samples because the pulls come out of that library.
import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { formatDate } from '../../lib/datetime.js';
import { AlertTriangle, Plus, FlaskConical, Clock } from 'lucide-react';

const STATE = {
  planned: { label: 'Planned', cls: 'bg-slate-100 text-slate-600' },
  tasked: { label: 'Task raised', cls: 'bg-blue-50 text-blue-700' },
  missed: { label: 'MISSED', cls: 'bg-red-50 text-red-800' },
  pulled: { label: 'Pulled · awaiting result', cls: 'bg-amber-50 text-amber-800' },
  resulted: { label: 'Resulted', cls: 'bg-green-50 text-green-700' },
  skipped: { label: 'Skipped', cls: 'bg-slate-100 text-slate-500' },
};

export default function StabilityTab({ canEdit }) {
  const { data, refresh } = useApiGet('/stability');
  const [adding, setAdding] = useState(false);
  const [justifying, setJustifying] = useState(false);
  const studies = data?.studies || [];
  const cov = data?.coverage;
  return (
    <div className="space-y-4" data-stability>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-gray-600 max-w-2xl">
          Real-time and accelerated studies with their pull dates. A pull raises its own task two weeks ahead; one nobody took shows as
          <b> missed</b>. Each product's expiration date is linked to a study or to a written interim justification, and the products with
          neither are counted below.
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => { setJustifying(j => !j); setAdding(false); }} data-stability-justify className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Record a shelf-life basis</button>
            <button onClick={() => { setAdding(a => !a); setJustifying(false); }} data-stability-new className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700"><Plus size={16} /> New study</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat n={data?.missed ?? 0} label="pulls missed" tone={data?.missed ? 'red' : ''} attr="data-stability-missed" />
        <Stat n={data?.awaiting_result ?? 0} label="awaiting a result" tone={data?.awaiting_result ? 'amber' : ''} attr="data-stability-awaiting" />
        <Stat n={data?.upcoming ?? 0} label="pulls in the next 60 days" attr="data-stability-upcoming" />
        <Stat n={cov?.uncovered ?? 0} label={`products with no shelf-life basis (of ${(cov?.covered ?? 0) + (cov?.uncovered ?? 0)})`} tone={cov?.uncovered ? 'amber' : ''} attr="data-stability-uncovered" />
      </div>

      {adding && <StudyForm onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}
      {justifying && <JustificationForm onDone={() => { setJustifying(false); refresh(); }} onCancel={() => setJustifying(false)} />}

      {studies.length === 0 ? (
        <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-6 text-center">No stability study on record. The first one starts the clock; until then every product's date rests on an interim justification.</p>
      ) : studies.map(s => <StudyCard key={s.id} s={s} canEdit={canEdit} onChanged={refresh} />)}

      {cov && cov.uncovered > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3" data-stability-uncovered-list>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-1">Products whose expiration date has no recorded basis</h4>
          <p className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
            {cov.products.filter(p => !p.covered).slice(0, 60).map(p => <span key={p.sku}>{p.sku}</span>)}
            {cov.uncovered > 60 && <span>+{cov.uncovered - 60} more</span>}
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ n, label, tone, attr }) {
  const cls = tone === 'red' ? 'border-red-200 bg-red-50/40 text-red-800' : tone === 'amber' ? 'border-amber-200 bg-amber-50/40 text-amber-800' : 'border-gray-200 bg-white text-gray-900';
  return <div className={`border rounded-xl p-3 ${cls}`} {...{ [attr]: n }}><p className="text-lg font-bold">{n}</p><p className="text-xs opacity-80">{label}</p></div>;
}

function StudyCard({ s, canEdit, onChanged }) {
  const [resulting, setResulting] = useState(null);
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3" data-stability-study={s.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold text-gray-900 flex items-center gap-2"><FlaskConical size={15} className="text-powder-600" /> {s.title}
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{s.status}</span></h4>
          <p className="text-xs text-gray-500">{s.condition === 'accelerated' ? 'Accelerated' : 'Real time'}{s.condition_detail ? ` · ${s.condition_detail}` : ''} · started {formatDate(s.start_date)}
            {s.product_family ? ` · ${s.product_family}` : ''}{s.lot_number ? ` · lot ${s.lot_number}` : ''}{s.product_skus.length ? ` · ${s.product_skus.join(', ')}` : ''}</p>
          {s.tests && <p className="text-xs text-gray-600 mt-1">Tests: {s.tests}</p>}
        </div>
        <div className="text-xs text-gray-500 text-right">
          {s.missed > 0 && <p className="text-red-700 font-semibold flex items-center gap-1 justify-end"><AlertTriangle size={12} /> {s.missed} missed</p>}
          {s.awaiting_result > 0 && <p className="text-amber-800 flex items-center gap-1 justify-end"><Clock size={12} /> {s.awaiting_result} awaiting result</p>}
          {s.failed > 0 && <p className="text-red-700">{s.failed} failed</p>}
        </div>
      </div>
      <ul className="mt-2 divide-y divide-gray-100">
        {s.pulls.map(p => {
          const st = STATE[p.state] || STATE.planned;
          return (
            <li key={p.id} className="py-1.5 text-xs flex flex-wrap items-center gap-2" data-stability-pull={p.id} data-pull-state={p.state}>
              <span className="w-20 font-medium">{p.pull_month} mo</span>
              <span className="text-gray-500 w-24">{formatDate(p.due_date)}</span>
              <span className={`px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
              {p.pulled_on && <span className="text-gray-500">pulled {formatDate(p.pulled_on)} by {p.pulled_by}{p.quantity ? ` · ${p.quantity}` : ''}{p.lab ? ` → ${p.lab}` : ''}</span>}
              {p.result && <span className={`font-semibold ${p.result === 'fail' ? 'text-red-700' : 'text-green-700'}`}>{p.result.toUpperCase()}{p.result_summary ? ` — ${p.result_summary}` : ''}</span>}
              {p.notes && p.state === 'skipped' && <span className="text-gray-500">{p.notes}</span>}
              {canEdit && p.state === 'pulled' && (
                <button onClick={() => setResulting(resulting === p.id ? null : p.id)} data-pull-result-open className="ml-auto px-2 py-1 bg-powder-600 text-white rounded text-[11px]">Enter result</button>
              )}
              {resulting === p.id && <ResultForm pull={p} onDone={() => { setResulting(null); onChanged(); }} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ResultForm({ pull, onDone }) {
  const [f, setF] = useState({ result: 'pass', result_summary: '' });
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try { await apiPost(`/stability/pulls/${pull.id}/result`, f); onDone(); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="w-full mt-1 flex flex-wrap gap-2 items-center" data-pull-result-form>
      <select value={f.result} onChange={e => setF({ ...f, result: e.target.value })} className="px-2 py-1 border border-gray-300 rounded text-xs"><option value="pass">Pass</option><option value="fail">Fail</option></select>
      <input value={f.result_summary} onChange={e => setF({ ...f, result_summary: e.target.value })} placeholder="What was tested and what it read" className="flex-1 min-w-[200px] px-2 py-1 border border-gray-300 rounded text-xs" />
      <button onClick={save} className="px-2 py-1 bg-powder-600 text-white rounded text-xs">Save</button>
      {err && <span className="text-red-700">{err}</span>}
    </div>
  );
}

function StudyForm({ onDone, onCancel }) {
  const [f, setF] = useState({ title: '', product_family: '', product_skus: '', lot_number: '', condition: 'real_time', condition_detail: '', start_date: '', pull_months: '0, 3, 6, 12, 18, 24', tests: '', acceptance: '', retention_sample_id: '', protocol_ref: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await apiPost('/stability', f); onDone(); } catch (x) { setErr(x.message); }
  };
  const I = (k, ph, extra = {}) => <input value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} placeholder={ph} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" {...extra} />;
  return (
    <form onSubmit={submit} className="rounded-xl border border-powder-200 bg-powder-50/40 p-3 grid gap-2 sm:grid-cols-3" data-stability-form>
      {I('title', 'Study title *', { required: true, 'data-study-title': true })}
      {I('product_family', 'Product family (e.g. whey stick packs)')}
      {I('product_skus', 'SKUs covered, comma-separated', { 'data-study-skus': true })}
      {I('lot_number', 'Lot number on study')}
      <select value={f.condition} onChange={e => setF({ ...f, condition: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"><option value="real_time">Real time</option><option value="accelerated">Accelerated</option></select>
      {I('condition_detail', 'Storage condition (e.g. 25 °C / 60 % RH)')}
      <label className="text-xs text-gray-600">Start date *<input type="date" required value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-study-start /></label>
      <label className="text-xs text-gray-600">Pull points (months) *{I('pull_months', '0, 3, 6, 12, 18, 24', { 'data-study-months': true })}</label>
      {I('retention_sample_id', 'Retention sample / box the pulls come from')}
      {I('tests', 'Tests at each pull (micro, moisture/aw, organoleptic, potency…)')}
      {I('acceptance', 'Acceptance criteria (the specification)')}
      {I('protocol_ref', 'Procedure / protocol reference')}
      {err && <p className="sm:col-span-3 text-xs text-red-700">{err}</p>}
      <div className="sm:col-span-3 flex gap-2">
        <button type="submit" className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium" data-study-save>Create study and schedule the pulls</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs">Cancel</button>
      </div>
    </form>
  );
}

function JustificationForm({ onDone, onCancel }) {
  const [f, setF] = useState({ product_family: '', product_skus: '', shelf_life_months: '', basis: '', document_ref: '', decided_on: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await apiPost('/stability/justifications', f); onDone(); } catch (x) { setErr(x.message); }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 grid gap-2 sm:grid-cols-3" data-justification-form>
      <p className="sm:col-span-3 text-xs text-gray-600">What the expiration date rests on until the study reports: ingredient stability data, water activity, packaging protection, published data. A new basis for the same SKUs supersedes the old one; the history stays.</p>
      <input value={f.product_family} onChange={e => setF({ ...f, product_family: e.target.value })} placeholder="Product family" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <input value={f.product_skus} onChange={e => setF({ ...f, product_skus: e.target.value })} placeholder="SKUs covered, comma-separated *" required className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-just-skus />
      <input type="number" min="1" value={f.shelf_life_months} onChange={e => setF({ ...f, shelf_life_months: e.target.value })} placeholder="Shelf life (months) *" required className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-just-months />
      <textarea value={f.basis} onChange={e => setF({ ...f, basis: e.target.value })} placeholder="Basis for the date *" required rows={2} className="sm:col-span-3 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-just-basis />
      <input value={f.document_ref} onChange={e => setF({ ...f, document_ref: e.target.value })} placeholder="Document reference" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <input type="date" value={f.decided_on} onChange={e => setF({ ...f, decided_on: e.target.value })} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
      {err && <p className="sm:col-span-3 text-xs text-red-700">{err}</p>}
      <div className="sm:col-span-3 flex gap-2">
        <button type="submit" className="px-3 py-1.5 bg-amber-700 text-white rounded-lg text-xs font-medium" data-just-save>Record</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs">Cancel</button>
      </div>
    </form>
  );
}
