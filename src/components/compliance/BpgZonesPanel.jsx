// The brittle plastic & glass zone register: what is in each zone, and whether
// that zone's inspection is reaching anybody.
//
// WHY IT IS HERE AND NOT ONLY ON THE TASK CARD. The inventories were editable
// in exactly one place — the BP&G card in the Operator View, which is
// department-locked to `qa` and gated on `isAdmin`. So Document Control, whose
// job maintaining these lists is, had no door at all, and a zone that is not
// producing a card has no card to edit, which is precisely the zone somebody
// is asking about. A fix that is not where the problem is seen is a fix nobody
// runs.
//
// The screen therefore shows the inventory AND the live inspection state side
// by side: a zone with no card names the reason and what to change, rather
// than leaving somebody to hunt through the Equipment registry and Recurring
// Schedules to find out why.

import { useState, useMemo } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';
import { Search, Pencil, Plus, Trash2, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';

const MATERIALS = ['Plastic', 'Glass'];

function StateChip({ zone }) {
  if (zone.inspectable) {
    const wo = zone.live_card;
    const late = wo?.status === 'missed' || wo?.status === 'overdue';
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${late ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'}`}>
        <CheckCircle2 size={11} />
        {late ? `${wo.status.toUpperCase()} · due ${formatDate(wo.due_date)}` : `Open · due ${formatDate(wo.due_date)}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
      <AlertTriangle size={11} /> Not being inspected
    </span>
  );
}

function ItemsEditor({ zone, onDone, onCancel }) {
  const [items, setItems] = useState(() => zone.items.map(i => ({ ...i })));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (i, patch) => setItems(prev => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      await apiPut(`/bpg/zones/${zone.schedule_id}/items`, { items: items.filter(i => i.name.trim()) });
      onDone();
    } catch (e) { setErr(e.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="mt-2 border border-powder-200 rounded-lg p-2 bg-powder-50/40 space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_60px_90px_28px] gap-1 items-center">
          <input value={item.name} onChange={e => set(i, { name: e.target.value })}
            data-bpg-item-name
            className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Item" />
          <input value={item.qty} onChange={e => set(i, { qty: e.target.value })}
            data-bpg-item-qty
            className="px-2 py-1 border border-gray-300 rounded text-sm text-center" placeholder="Qty" />
          <select value={item.material} onChange={e => set(i, { material: e.target.value })}
            className="px-1 py-1 border border-gray-300 rounded text-xs">
            {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
            className="text-gray-400 hover:text-red-500" aria-label="Remove item">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setItems([...items, { name: '', qty: '1', material: 'Plastic' }])}
        className="w-full py-1.5 text-xs text-powder-600 hover:bg-powder-50 rounded border border-dashed border-powder-300 flex items-center justify-center gap-1">
        <Plus size={12} /> Add item
      </button>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={save} disabled={saving}
          data-bpg-save
          className="flex-1 py-1.5 bg-powder-600 text-white rounded text-xs font-bold hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save inventory'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 bg-white text-gray-600 rounded text-xs border border-gray-200">Cancel</button>
      </div>
      <p className="text-[10px] text-gray-500">
        Saved changes reach the inspection card already open, including one that is past its date.
      </p>
    </div>
  );
}

function ZoneCard({ zone, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3" data-bpg-zone={zone.zone}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{zone.zone}</p>
          <p className="text-[11px] text-gray-500">
            {zone.equipment?.asset_id || 'no asset number'}
            {zone.equipment?.location ? ` · ${zone.equipment.location}` : ''}
            {' · '}{zone.frequency}
          </p>
        </div>
        <StateChip zone={zone} />
      </div>

      {!zone.inspectable && (
        <p className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
          {zone.gap_reason}
        </p>
      )}

      <p className="mt-2 text-[11px] text-gray-500">
        <span data-bpg-count className="font-semibold text-gray-700">{zone.item_count}</span> item{zone.item_count === 1 ? '' : 's'} on file
        {zone.glass_count ? ` · ${zone.glass_count} glass` : ''}
        {zone.last_inspected_at
          ? ` · last inspected ${formatDate(zone.last_inspected_at)}${zone.last_inspected_by ? ` by ${zone.last_inspected_by}` : ''}`
          : ' · no inspection on record'}
      </p>

      {zone.item_count === 0 && !editing && (
        <p className="mt-1 text-[11px] text-amber-700">
          No inventory on file — the inspector is handed an empty list.
        </p>
      )}

      {editing ? (
        <ItemsEditor zone={zone} onCancel={() => setEditing(false)}
          onDone={() => { setEditing(false); onSaved(); }} />
      ) : (
        <>
          {zone.item_count > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_50px_70px] bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-500 uppercase">
                <span>Item</span><span>Qty</span><span>Type</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {zone.items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_50px_70px] px-2 py-1 items-center">
                    <span className="text-sm text-gray-800 truncate">{it.name}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{it.qty}</span>
                    <span className={`text-[10px] font-medium ${/glass/i.test(it.material) ? 'text-blue-600' : 'text-gray-500'}`}>{it.material}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)}
              data-bpg-edit
              className="mt-2 inline-flex items-center gap-1 text-xs text-powder-700 hover:text-powder-900 font-medium">
              <Pencil size={12} /> Edit inventory
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function BpgZonesPanel() {
  const { data, loading, refresh } = useApiGet('/bpg/zones');
  const [q, setQ] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);

  const rows = useMemo(() => {
    const zones = data?.zones || [];
    const needle = q.toLowerCase().trim();
    return zones.filter(z => {
      if (onlyGaps && z.inspectable) return false;
      if (!needle) return true;
      return [z.zone, z.equipment?.asset_id, ...z.items.map(i => i.name)]
        .some(v => v && String(v).toLowerCase().includes(needle));
    });
  }, [data, q, onlyGaps]);

  if (loading) return <div className="text-center py-8 text-gray-500">Loading zones…</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        What each brittle plastic &amp; glass zone contains, and whether its monthly inspection is
        reaching anybody. Correcting a count here reaches the card the inspector is working from.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Zones', value: data?.total ?? 0, tone: 'text-gray-900' },
          { label: 'Not being inspected', value: data?.not_inspectable ?? 0, tone: (data?.not_inspectable ? 'text-red-600' : 'text-gray-900') },
          { label: 'No inventory on file', value: data?.no_items ?? 0, tone: (data?.no_items ? 'text-amber-600' : 'text-gray-900') },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold ${c.tone}`} data-bpg-card={c.label}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOnlyGaps(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${onlyGaps ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Only zones with no card
        </button>
        <a href="/forms/FORM-431-01-V5-Brittle-Plastic-and-Glass-Diagram.pdf" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
          <FileText size={14} /> View diagram
        </a>
        <div className="relative w-full sm:w-64 sm:ml-auto">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search zone or item…"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
      </div>

      {!data?.can_edit && (
        <p className="text-[11px] text-gray-500">
          Changing what an inspection covers is for Quality and Document Control. Report a miscount to
          them and it will be corrected here.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No zones match.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map(z => (
            <ZoneCard key={z.schedule_id} zone={z} canEdit={!!data?.can_edit} onSaved={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
