import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { TestTube, PackagePlus, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';

// How many usable swabs are on the shelf.
//
// THE NUMBER IS DERIVED, NOT STORED — the last physical count, plus what has
// arrived since, minus every swab the cleaning log says was used. So it cannot
// disagree with the log it is computed from, and the screen shows its working:
// "126 counted on 1 Sep · 14 used since". A figure with no arithmetic behind it
// is one nobody trusts enough to act on.
//
// It ENFORCES NOTHING. Running low is a purchasing problem, not a reason to
// refuse a clean — the server raises the supply order and this says so.

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

const INPUT = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';

function CountForm({ swab, onDone, onCancel }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = Number(qty);
  // What the books say right now, so the variance is visible BEFORE the count
  // is filed rather than only in the audit trail afterwards.
  const variance = Number.isFinite(n) && qty !== '' && swab.on_hand != null ? n - swab.on_hand : null;

  const go = async () => {
    setBusy(true); setErr('');
    try {
      await apiPost(`/sanitation/swab-stock/${swab.key}/count`, { qty: n, reason: reason.trim() || null });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
      <Field label="Swabs counted on the shelf">
        <input type="number" min="0" step="1" autoFocus value={qty} onChange={e => setQty(e.target.value)} className={INPUT} />
      </Field>
      {variance != null && variance !== 0 && (
        <p className="text-[11px] text-amber-700">
          {variance > 0 ? `${variance} more` : `${Math.abs(variance)} fewer`} than the log expects ({swab.on_hand}).
          That difference is worth recording — say why below if you know.
        </p>
      )}
      <Field label="Note (optional)">
        <input value={reason} onChange={e => setReason(e.target.value)} className={INPUT} placeholder="Where the difference came from…" />
      </Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={go} disabled={busy || qty === '' || !Number.isFinite(n) || n < 0}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'File the count'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  );
}

function ReceivedForm({ swab, onDone, onCancel }) {
  const [boxes, setBoxes] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = Number(boxes);

  const go = async () => {
    setBusy(true); setErr('');
    try {
      await apiPost(`/sanitation/swab-stock/${swab.key}/received`, { boxes: n });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
      {/* Boxes, not swabs: that is how they are bought, and deriving the swab
          count from the box size means a full box can never be filed as 90. */}
      <Field label="Boxes received">
        <input type="number" min="1" step="1" autoFocus value={boxes} onChange={e => setBoxes(e.target.value)} className={INPUT} />
      </Field>
      <p className="text-[11px] text-gray-500">
        {Number.isFinite(n) && n > 0 ? `${n * swab.box_size} swabs` : '—'} at {swab.box_size} a box.
      </p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={go} disabled={busy || !Number.isFinite(n) || n <= 0}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Add to the shelf'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  );
}

function PointForm({ swab, onDone, onCancel }) {
  const [value, setValue] = useState(String(swab.reorder_point));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = Number(value);

  const go = async () => {
    setBusy(true); setErr('');
    try {
      await apiPut(`/sanitation/swab-stock/${swab.key}`, { reorder_point: n });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="mt-2 pt-2 border-t border-gray-100 space-y-2">
      <Field label="Order more when the shelf drops to">
        <input type="number" min="0" step="1" autoFocus value={value} onChange={e => setValue(e.target.value)} className={INPUT} />
      </Field>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={go} disabled={busy || !Number.isFinite(n) || n < 0}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  );
}

function SwabCard({ swab, canManage, onDone }) {
  const [form, setForm] = useState(null);
  const low = swab.below_reorder;
  const close = () => setForm(null);
  const done = () => { close(); onDone(); };

  return (
    <div className={`rounded-xl border p-3 ${low ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start gap-2">
        <TestTube size={15} className={low ? 'text-amber-700 mt-0.5' : 'text-gray-400 mt-0.5'} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{swab.label}</p>
          {swab.needs_count ? (
            // No baseline means no on-hand figure. It says so rather than
            // showing a number derived from nothing.
            <p className="text-[11px] text-gray-500 mt-0.5">Never counted — count what is on the shelf to start tracking.</p>
          ) : (
            <>
              <p className="text-2xl font-semibold text-gray-900 leading-tight">
                {swab.on_hand}
                <span className="text-xs font-normal text-gray-500 ml-1.5">on hand</span>
              </p>
              {/* The arithmetic, shown. */}
              <p className="text-[11px] text-gray-500 mt-0.5">
                {swab.counted_qty} counted {swab.counted_at ? `on ${formatDate(swab.counted_at)}` : ''}
                {swab.received_since > 0 && ` · ${swab.received_since} received since`}
                {` · ${swab.used_since} used since`}
              </p>
              <p className="text-[11px] text-gray-500">
                Order more at {swab.reorder_point}
                {swab.per_week != null && ` · about ${swab.per_week} a week`}
                {swab.weeks_of_cover != null && ` · ${swab.weeks_of_cover} weeks left`}
              </p>
            </>
          )}
          {low && (
            <p className="text-[11px] text-amber-800 font-medium mt-1 flex items-center gap-1">
              <AlertTriangle size={11} /> At the reorder point — a supply order has been raised.
            </p>
          )}
        </div>
      </div>

      {canManage && !form && (
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <button type="button" onClick={() => setForm('count')}
            className="flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50">
            <ClipboardCheck size={12} /> Count
          </button>
          <button type="button" onClick={() => setForm('received')}
            className="flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50">
            <PackagePlus size={12} /> Received
          </button>
          <button type="button" onClick={() => setForm('point')}
            className="px-2 py-1 text-gray-400 hover:text-gray-600 rounded-lg text-xs">Reorder point</button>
        </div>
      )}
      {form === 'count' && <CountForm swab={swab} onDone={done} onCancel={close} />}
      {form === 'received' && <ReceivedForm swab={swab} onDone={done} onCancel={close} />}
      {form === 'point' && <PointForm swab={swab} onDone={done} onCancel={close} />}
    </div>
  );
}

export default function SwabStock() {
  const { user } = useAuth() || {};
  // The same ladder the re-clean flags use.
  const canManage = user?.role === 'admin' || user?.role === 'supervisor' || user?.department === 'qa';
  const { data, refresh } = useApiGet('/sanitation/swab-stock');
  const swabs = data?.swabs || [];
  if (!swabs.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {swabs.map(s => <SwabCard key={s.key} swab={s} canManage={canManage} onDone={refresh} />)}
    </div>
  );
}
