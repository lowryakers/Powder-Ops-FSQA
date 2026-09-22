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
import { useAuth } from '../../hooks/useAuth';
import { moduleLevel } from '../../utils/permissions';
import { Search, Pencil, Plus, Trash2, FileText, AlertTriangle, CheckCircle2, Map, Printer } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';

const MATERIALS = ['Plastic', 'Glass'];

// The live inventory sheet — the thing an auditor asks for beside the drawing.
//
// IT IS PRINTED, NOT STORED, AND IT SAYS SO. It is derived from the zone cards
// at the moment somebody presses the button, so it is always current and is
// therefore NOT a controlled record: the stamp names FORM 431-01 and its
// revision as the controlled drawing, and the footer says uncontrolled when
// printed — the same doctrine as printing a controlled document, for the same
// reason. A printout that looked controlled would become a shadow copy.
//
// A clean window rather than the app styled for print: somebody asking for
// paper should get the inventory, not a screenshot of software.
function printInventory(zones, diagram) {
  const w = window.open('', '_blank');
  if (!w) return;
  const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const body = zones.map(z => `
    <section>
      <h2>${esc(z.zone)}${z.equipment?.asset_id ? ` <span class="asset">${esc(z.equipment.asset_id)}</span>` : ''}</h2>
      <p class="sub">${z.item_count} item${z.item_count === 1 ? '' : 's'}${z.glass_count ? ` · ${z.glass_count} glass` : ''}${
        z.inspectable ? '' : ` · NOT CURRENTLY INSPECTED — ${esc(z.gap_reason || '')}`}</p>
      ${z.item_count === 0
        ? '<p class="empty">No inventory on file.</p>'
        : `<table><thead><tr><th>Item</th><th class="n">Qty</th><th>Type</th></tr></thead><tbody>${
            z.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${esc(i.qty)}</td><td>${esc(i.material)}</td></tr>`).join('')
          }</tbody></table>`}
    </section>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Brittle plastic &amp; glass — zone inventories</title>
    <style>
      body { font: 11pt/1.45 Georgia, serif; margin: 0.6in; color: #111; }
      h1 { font-size: 15pt; margin: 0 0 4px; }
      .meta { font: 9pt/1.4 Helvetica, Arial, sans-serif; color: #444; border-bottom: 1px solid #999; padding-bottom: 8px; margin-bottom: 14px; }
      .stamp { font: 9pt/1.45 Helvetica, Arial, sans-serif; border: 2px solid #92400e; color: #7c2d12; padding: 7px 9px; margin: 0 0 16px; }
      section { break-inside: avoid; margin: 0 0 14px; }
      h2 { font-size: 11.5pt; margin: 0 0 2px; }
      .asset { font: 8.5pt Helvetica, Arial, sans-serif; color: #666; font-weight: normal; }
      .sub { font: 8.5pt Helvetica, Arial, sans-serif; color: #555; margin: 0 0 5px; }
      .empty { font: 9pt Helvetica, Arial, sans-serif; color: #92400e; margin: 0; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #999; padding: 3px 6px; font-size: 9.5pt; text-align: left; }
      th { background: #f3f4f6; font: 8.5pt Helvetica, Arial, sans-serif; text-transform: uppercase; }
      td.n, th.n { text-align: right; width: 3em; font-variant-numeric: tabular-nums; }
      .foot { margin-top: 18px; font: 8pt Helvetica, Arial, sans-serif; color: #777; border-top: 1px solid #ccc; padding-top: 4px; }
    </style></head><body>
    <h1>Brittle plastic &amp; glass — zone inventories</h1>
    <div class="meta">${zones.length} zones · generated from ReadyDoc ${new Date().toLocaleString()}</div>
    <div class="stamp">
      <strong>This sheet is not a controlled document.</strong>
      It is generated from the zone inventories in ReadyDoc, which the plant maintains.
      ${diagram?.code ? `The controlled drawing is <strong>${esc(diagram.code)}${diagram.revision ? ` ${esc(diagram.revision)}` : ''}</strong>` : 'The controlled drawing is FORM 431-01'}
      — where this sheet and the drawing disagree, raise a document change request.
    </div>
    ${body}
    <div class="foot">Uncontrolled when printed. Verify against the controlled drawing in the registry.</div>
    </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

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

// Where the plant's own counts have moved away from the issued drawing — the
// answer to "when does FORM 431-01 need updating", which nothing could answer
// before: the comparison ran at boot and went to a deploy log.
//
// IT REPORTS, IT NEVER REWRITES. The drawing is Document Control's to re-issue,
// and the inventories are the plant's to correct; this only says the two have
// parted company. Derived on every read, so it clears itself once the re-issued
// drawing is transcribed.
function DriftStrip({ drift, diagram }) {
  const [open, setOpen] = useState(false);
  if (!drift?.length) return null;
  const rev = diagram?.revision ? `${diagram.code} ${diagram.revision}` : (diagram?.code || 'the diagram');
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3" data-bpg-drift>
      <p className="text-sm font-semibold text-amber-900">
        {drift.length} zone{drift.length === 1 ? '' : 's'} no longer match {rev}
      </p>
      <p className="text-[11px] text-amber-800 mt-0.5">
        {drift.map(d => d.zone).join(' · ')}
      </p>
      <p className="text-[11px] text-amber-700 mt-1">
        The drawing is a controlled document and does not redraw itself — these are the zones to raise a
        document change request for. Nothing here is wrong: the counts on the cards are what the plant has.
      </p>
      <button type="button" onClick={() => setOpen(v => !v)} data-bpg-drift-toggle
        className="mt-2 text-xs font-bold text-amber-800 hover:text-amber-900">
        {open ? 'Hide what changed' : 'Show what changed'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {drift.map(d => (
            <div key={d.schedule_id} className="text-[11px] text-amber-900" data-bpg-drift-zone={d.zone}>
              <span className="font-semibold">{d.zone}</span>
              <ul className="list-disc ml-4 mt-0.5 space-y-0.5">
                {d.changed.map(c => <li key={`c${c.name}`}>{c.name}: {c.was} → <span className="font-semibold">{c.now}</span></li>)}
                {d.added.map(i => <li key={`a${i.name}`}>added {i.name} ({i.qty} {i.material})</li>)}
                {d.removed.map(i => <li key={`r${i.name}`}>removed {i.name} ({i.qty} {i.material})</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BpgZonesPanel() {
  const { user } = useAuth();
  // A DOOR THAT LEADS NOWHERE READS AS A FAULT, NOT AS A BOUNDARY. Document
  // Control reaches this screen through the `qa-inspections` grant and does not
  // necessarily hold `facility-map`; without it the link falls back to the
  // first module and looks like the app ignoring the click. Offered only to
  // somebody who can actually get there — the guest-client rule (D-091).
  const canSeeMap = !!moduleLevel(user, 'facility-map');
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

      <DriftStrip drift={data?.drift} diagram={data?.diagram} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOnlyGaps(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${onlyGaps ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Only zones with no card
        </button>
        {/* The revision comes from the register, so the day Document Control
            issues V6 this button says V6 with no deploy. */}
        {data?.diagram?.href && (
          <a href={data.diagram.href} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
            <FileText size={14} /> {data.diagram.code} {data.diagram.revision}
          </a>
        )}
        {/* THE LIVE PICTURE ALREADY EXISTS and nobody knew: the Facility Map's
            BP&G layer draws these same zones on the floor plan and reads these
            same inventories. It is not FORM 431-01 and never claims to be. */}
        {canSeeMap && (
        <a href="/?tab=facility-map&layer=bpg"
          data-bpg-map
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
          <Map size={14} /> See the zones on the map
        </a>
        )}
        <button type="button" onClick={() => printInventory(rows, data?.diagram)}
          data-bpg-print
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200">
          <Printer size={14} /> Print inventory sheet
        </button>
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
