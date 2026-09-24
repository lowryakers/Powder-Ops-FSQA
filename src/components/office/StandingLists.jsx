import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CalendarClock, Plus, Trash2, Check, X, ListChecks, AlertTriangle, ExternalLink, Pencil } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';
import { externalUrl } from '../../lib/externalUrl.js';

/**
 * Standing lists: the things the office restocks on a cadence.
 *
 * WHAT RECURS IS THE ASKING, NOT THE ORDER. "Monthly break room snacks and
 * supplies" is a dozen items and which dozen is the whole question each month —
 * some months the paper towels do not need doing. So a cycle opens one prompt,
 * Marnee ticks what is actually low, and THAT files real requests. Filing
 * eighteen rows on the first of every month regardless would put noise in the
 * one queue that has to stay readable, which is the same reason the "used up"
 * strip groups suggestions instead of writing requests.
 */
const CADENCE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
const DAY_LABEL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
const whenLabel = (l) => (l.cadence === 'weekly'
  ? `${CADENCE_LABEL.weekly}, ${DAY_LABEL[Math.min(7, Math.max(1, l.day))]}`
  : `${CADENCE_LABEL[l.cadence] || 'Monthly'}, ${ordinal(Math.min(28, Math.max(1, l.day)))}`);

function TagChips({ tags }) {
  if (!tags?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {tags.map(t => (
        <span key={t} data-supply-tag={t} className="px-1.5 py-0.5 rounded-md bg-powder-50 text-powder-700 border border-powder-200 text-[10px] font-medium">{t}</span>
      ))}
    </span>
  );
}

/**
 * The open cycle. NOTHING IS ORDERED UNTIL SOMEBODY SAYS WHICH ITEMS AND HOW
 * MANY — and "nothing needed" is a real answer with a name and a date on it,
 * not an absence, because a month somebody looked at and skipped is a different
 * fact from one nobody opened.
 */
function CycleForm({ list, onDone }) {
  const cycle = list.open_cycle;
  const [picked, setPicked] = useState({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const chosen = Object.entries(picked).filter(([, v]) => v);

  const close = async (nothing) => {
    setBusy(true); setErr('');
    try {
      await apiPost(`/office/supply/cycles/${cycle.id}/close`, {
        nothing_needed: nothing,
        note: note.trim() || null,
        items: nothing ? [] : chosen.map(([id, v]) => ({ item_id: id, qty: v.qty || null, urgent: !!v.urgent })),
      });
      onDone?.();
    } catch (e) { setErr(e.message || 'Could not file that.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2" data-supply-cycle={cycle.id}>
      <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
        <CalendarClock size={13} />
        {cycle.period} · due {formatDate(cycle.due_date)}
        {cycle.days_late > 0 && <span className="text-amber-700">· {cycle.days_late} day{cycle.days_late === 1 ? '' : 's'} ago</span>}
      </p>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {list.items.map(i => {
          const on = !!picked[i.id];
          return (
            <label key={i.id} data-cycle-item={i.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-white ${on ? 'border-powder-400' : 'border-gray-200'}`}>
              <input type="checkbox" checked={on} data-cycle-pick={i.item_name}
                onChange={e => setPicked(p => ({ ...p, [i.id]: e.target.checked ? { qty: i.qty ?? '', urgent: false } : false }))} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-gray-800 truncate">{i.item_name}</span>
                <span className="block text-[11px] text-gray-500 truncate">{[i.supplier, i.uom].filter(Boolean).join(' · ') || '—'}</span>
              </span>
              {on && (
                <input type="number" step="any" value={picked[i.id].qty} data-cycle-qty={i.item_name}
                  onChange={e => setPicked(p => ({ ...p, [i.id]: { ...p[i.id], qty: e.target.value } }))}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm" placeholder="Qty" />
              )}
            </label>
          );
        })}
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" data-cycle-note />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => close(false)} disabled={busy || !chosen.length} data-cycle-file
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {busy ? 'Filing…' : `Order ${chosen.length || ''} ${chosen.length === 1 ? 'item' : 'items'}`.trim()}
        </button>
        {/* A REAL ANSWER, not a dismiss: it closes the cycle with a name and a
            date, so "was February skipped or missed" is answerable. */}
        <button onClick={() => close(true)} disabled={busy} data-cycle-nothing
          className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-50">
          Nothing needed this month
        </button>
      </div>
    </div>
  );
}

function ItemAdder({ list, onSaved }) {
  const blank = { item_name: '', qty: '', uom: '', supplier: '', link: '' };
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!form.item_name.trim()) return;
    setBusy(true);
    try { await apiPost(`/office/supply/lists/${list.id}/items`, form); setForm(blank); onSaved?.(); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <input value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} placeholder="Add an item…"
        data-list-add-name className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <input value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Qty" type="number" step="any"
        className="w-20 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier"
        data-list-add-supplier className="w-32 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
      {/* THE LINK WAS IN THE PAYLOAD AND THE COLUMN ALL ALONG — the form sent
          it, the server stored it, the cycle carries it onto the order, and
          nothing on the screen ever asked for it. It is the field that makes
          the list worth ticking: reordering is opening the page you bought it
          from last time. */}
      <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="Product link"
        data-list-add-link className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
      <button onClick={add} disabled={busy || !form.item_name.trim()} data-list-add
        className="px-2.5 py-1.5 bg-gray-800 text-white rounded-lg text-sm disabled:opacity-40"><Plus size={14} /></button>
    </div>
  );
}

/**
 * One item, and the inline correction of it.
 *
 * A standing list is filled in once and lived with, so the ordinary change to
 * it is a CORRECTION to a row that is already there. Retire-and-re-add would
 * have worked and is the wrong act: the retired row is what last month's cycle
 * ordered against.
 */
function ItemRow({ list, item, canManage, onChanged }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    item_name: item.item_name, qty: item.qty ?? '', uom: item.uom || '',
    supplier: item.supplier || '', link: item.link || '',
  });
  const [busy, setBusy] = useState(false);
  const href = externalUrl(item.link);

  const save = async () => {
    if (!form.item_name.trim()) return;
    setBusy(true);
    try {
      // apiPut, NOT apiFetch with a stringified body — `apiFetch` serializes
      // `options.body` itself, so passing a string double-encodes it and the
      // server receives a JSON string where it expects an object.
      await apiPut(`/office/supply/lists/${list.id}/items/${item.id}`, form);
      setEdit(false);
      onChanged?.();
    } finally { setBusy(false); }
  };

  if (edit) {
    return (
      <div className="border-b border-gray-100 py-2 space-y-1.5" data-list-item-edit={item.item_name}>
        <div className="flex flex-wrap gap-1.5 items-center">
          <input value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })}
            data-edit-name className="flex-1 min-w-[140px] px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <input value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Qty" type="number" step="any"
            data-edit-qty className="w-20 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="Supplier"
            data-edit-supplier className="w-32 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="Product link"
            data-edit-link className="flex-1 min-w-[160px] px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          <button onClick={save} disabled={busy || !form.item_name.trim()} data-edit-save
            className="px-2.5 py-1.5 bg-gray-800 text-white rounded-lg text-sm disabled:opacity-40"><Check size={14} /></button>
          <button onClick={() => setEdit(false)} disabled={busy}
            className="px-2.5 py-1.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm"><X size={14} /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-700 border-b border-gray-100 py-1" data-list-item={item.item_name}>
      {/* The name IS the link when there is one, the same shape the Spend tab
          and the orders list already use — a separate "open" button beside the
          name is a second thing to aim at for one fact. */}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" data-list-item-link={item.item_name} title={item.link}
          className="flex-1 min-w-0 truncate font-medium text-powder-700 hover:underline inline-flex items-center gap-1">
          <span className="truncate">{item.item_name}</span><ExternalLink size={11} className="shrink-0" />
        </a>
      ) : <span className="flex-1 min-w-0 truncate">{item.item_name}</span>}
      <span className="text-xs text-gray-400 truncate">{[item.qty, item.uom, item.supplier].filter(Boolean).join(' · ')}</span>
      {canManage && (
        <>
          <button onClick={() => setEdit(true)} data-list-edit={item.item_name}
            className="text-gray-300 hover:text-powder-600" title="Edit"><Pencil size={13} /></button>
          <button onClick={() => onChanged?.(item.id)} data-list-remove={item.item_name}
            className="text-gray-300 hover:text-red-500" title="Remove"><Trash2 size={13} /></button>
        </>
      )}
    </div>
  );
}

function ListCard({ list, onChanged, canManage }) {
  const [open, setOpen] = useState(!!list.open_cycle);
  const removeItem = async (id) => {
    // Retired, never deleted: a cycle filed last month recorded what it ordered
    // against the list as it stood.
    await apiFetch(`/office/supply/lists/${list.id}/items/${id}`, { method: 'DELETE' });
    onChanged?.();
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-standing-list={list.name}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
            <ListChecks size={15} className="text-powder-600 shrink-0" />
            <span className="truncate">{list.name}</span>
            <TagChips tags={list.tags} />
          </h4>
          <p className="text-xs text-gray-500 mt-0.5">
            {whenLabel(list)} · {list.item_count} item{list.item_count === 1 ? '' : 's'}
            {list.next_due && !list.open_cycle && <> · next {formatDate(list.next_due)}</>}
            {list.last_cycle && <> · last {list.last_cycle.outcome === 'nothing_needed'
              ? 'nothing needed' : `${list.last_cycle.orders_created} ordered`} ({list.last_cycle.period})</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {list.open_cycle
            ? <span data-list-due className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">Due now</span>
            : <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-medium">Up to date</span>}
          <button onClick={() => setOpen(o => !o)} className="text-xs text-powder-700 font-medium">{open ? 'Hide' : 'Open'}</button>
        </div>
      </div>

      {/* A LIST WITH NOTHING ON IT ASKS NOBODY ANYTHING, and says so rather
          than looking broken — the three shipped lists arrive named and empty
          because what is on each one is not something anyone outside the
          office knows. */}
      {!list.item_count && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5" data-list-empty>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Nothing on this list yet. Add what it covers — nothing is asked about until it has at least one item.
        </p>
      )}

      {open && (
        <div className="space-y-3">
          {list.open_cycle && canManage && <CycleForm list={list} onDone={onChanged} />}
          <div className="space-y-1">
            {list.items.map(i => (
              <ItemRow key={i.id} list={list} item={i} canManage={canManage}
                onChanged={(removeId) => (removeId ? removeItem(removeId) : onChanged?.())} />
            ))}
          </div>
          {canManage && <ItemAdder list={list} onSaved={onChanged} />}
        </div>
      )}
    </div>
  );
}

function NewList({ tags, onCreated }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', cadence: 'monthly', day: 1, tags: [] });
  const [busy, setBusy] = useState(false);
  if (!show) {
    return (
      <button onClick={() => setShow(true)} data-standing-new
        className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 flex items-center gap-1.5">
        <Plus size={14} /> New standing list
      </button>
    );
  }
  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try { await apiPost('/office/supply/lists', form); setShow(false); setForm({ name: '', cadence: 'monthly', day: 1, tags: [] }); onCreated?.(); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="What does this list cover?"
        className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm" />
      <div className="flex flex-wrap gap-1.5 items-center">
        <select value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })}
          className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm bg-white">
          {Object.entries(CADENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="number" min={1} max={form.cadence === 'weekly' ? 7 : 28} value={form.day}
          onChange={e => setForm({ ...form, day: Number(e.target.value) })}
          className="w-20 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
        <span className="text-xs text-gray-500">{form.cadence === 'weekly' ? 'day of the week (1 = Monday)' : 'day of the month'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(tags || []).map(t => (
          <button key={t.value} type="button"
            onClick={() => setForm(f => ({ ...f, tags: f.tags.includes(t.value) ? f.tags.filter(x => x !== t.value) : [...f.tags, t.value] }))}
            className={`px-2 py-1 rounded-lg border text-xs ${form.tags.includes(t.value) ? 'border-powder-500 bg-powder-50 text-powder-800' : 'border-gray-300 bg-white text-gray-600'}`}>
            {t.value}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || !form.name.trim()} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          <Check size={14} className="inline mr-1" />Create
        </button>
        <button onClick={() => setShow(false)} className="px-3 py-1.5 text-sm text-gray-600"><X size={14} className="inline mr-1" />Cancel</button>
      </div>
    </div>
  );
}

/**
 * READING IS OPEN TO ANYONE WHO MAY SUBMIT A REQUEST; editing is the office's.
 *
 * Knowing the break-room list exists is how somebody stops filing a one-off
 * for paper towels — but the controls that the server would refuse are not
 * rendered at all, because a button that errors reads as a fault rather than
 * as a boundary (D-091).
 */
export default function StandingLists({ onChanged }) {
  const { user } = useAuth() || {};
  const canManage = user?.role === 'admin';
  const { data, refresh } = useApiGet('/office/supply/lists');
  const { data: tags } = useApiGet('/office/supply/tags');
  const lists = data || [];
  const bump = () => { refresh(); onChanged?.(); };
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-xs text-gray-600 max-w-2xl">
          A standing list is what the office restocks on a cadence. When it comes round, ReadyDoc asks what is
          actually low — it does not file the whole list. Ticking items is what raises real requests, and
          <span className="font-medium"> nothing needed</span> is a real answer that is recorded.
          {!canManage && ' The office decides what is ordered; this is here so you can see what is already covered.'}
        </p>
        {canManage && <NewList tags={tags} onCreated={bump} />}
      </div>
      {!lists.length && <p className="text-sm text-gray-500">No standing lists yet.</p>}
      {lists.map(l => <ListCard key={l.id} list={l} onChanged={bump} canManage={canManage} />)}
    </div>
  );
}

export { TagChips };
