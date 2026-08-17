import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import DataGrid from './DataGrid.jsx';
import { Plus, FlaskConical, RotateCcw, Check, Beaker, X } from 'lucide-react';
import ImportPanel from '../common/ImportPanel';

// Procurement & demand planning — the working replacement for Jake's two
// workbooks. Purchase orders and their KPIs, a demand plan that explodes
// through the BOMs, and the parts/pricing and samples sheets, all sortable,
// searchable and filterable.
//
// "Test mode" is a scenario: a full copy of the demand plan and the POs that
// he can rework freely, then either revert (throw away) or apply (make live).

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const today = () => new Date().toISOString().slice(0, 10);

const PO_STATUSES = ['draft', 'open', 'confirmed', 'shipped', 'received', 'cancelled'];

function ScenarioBar({ scenarios, active, setActive, canEdit, onChanged }) {
  const [busy, setBusy] = useState(false);
  const scenario = scenarios?.find(s => s.id === active);

  const create = async () => {
    const name = prompt('Name this working copy', `Working copy ${today()}`);
    if (name === null) return;
    setBusy(true);
    try {
      const sc = await apiPost('/procurement/scenarios', { name });
      await onChanged();
      setActive(sc.id);
    } finally { setBusy(false); }
  };
  const revert = async () => {
    if (!confirm(`Discard "${scenario.name}"? The live plan is untouched.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/procurement/scenarios/${scenario.id}`, { method: 'DELETE' });
      setActive(null);
      await onChanged();
    } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!confirm(`Replace the live plan and purchase orders with "${scenario.name}"?`)) return;
    setBusy(true);
    try {
      await apiPost(`/procurement/scenarios/${scenario.id}/apply`, {});
      setActive(null);
      await onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className={`rounded-xl border px-4 py-2.5 flex flex-wrap items-center gap-2 ${scenario ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
      {scenario ? <FlaskConical size={16} className="text-amber-600" /> : <Beaker size={16} className="text-gray-400" />}
      <span className={`text-sm font-medium ${scenario ? 'text-amber-800' : 'text-gray-700'}`}>
        {scenario ? `Test mode — ${scenario.name}` : 'Live plan'}
      </span>
      {scenario && <span className="text-[11px] text-amber-700">Edits here don&apos;t touch the live numbers.</span>}

      <div className="ml-auto flex items-center gap-2">
        <select value={active || ''} onChange={e => setActive(e.target.value || null)}
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
          <option value="">Live plan</option>
          {(scenarios || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {canEdit && !scenario && (
          <button onClick={create} disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 disabled:opacity-50">
            <Plus size={13} /> Create a copy to edit
          </button>
        )}
        {canEdit && scenario && (
          <>
            <button onClick={apply} disabled={busy}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
              <Check size={13} /> Make this live
            </button>
            <button onClick={revert} disabled={busy}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100 disabled:opacity-50">
              <RotateCcw size={13} /> Revert
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function POForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    po_number: '', vendor: '', part_no: '', description: '', qty: '', uom: '',
    unit_price: '', order_date: today(), expected_date: '', status: 'open', urgent: false, notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } catch (saveErr) {
      // A refused save must SAY so. This was try/finally with NO catch, so a
      // 403 or a validation 400 cleared the spinner and left the modal sitting
      // there — indistinguishable from a dead button, which is how a
      // deliberate rule reads as a broken screen.
      window.alert(saveErr.message);
    } finally { setSaving(false); }
  };

  const field = (name, label, type = 'text') => (
    <div key={name}>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} step={type === 'number' ? 'any' : undefined} value={form[name]}
        onChange={e => set(name, e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
    </div>
  );

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">New purchase order</h3>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {field('po_number', 'PO #')}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Vendor *</label>
          <input required value={form.vendor} onChange={e => set('vendor', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        {field('part_no', 'Part #')}
        {field('description', 'Description')}
        {field('qty', 'Qty', 'number')}
        {field('uom', 'UOM')}
        {field('unit_price', 'Unit price', 'number')}
        {field('order_date', 'Order date', 'date')}
        {field('expected_date', 'Expected date', 'date')}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {PO_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 mt-6 text-sm text-gray-700">
          <input type="checkbox" checked={form.urgent} onChange={e => set('urgent', e.target.checked)} /> Urgent
        </label>
        <div className="sm:col-span-4">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <input value={form.notes} onChange={e => set('notes', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-gray-600 text-sm font-medium hover:bg-gray-100 rounded-lg">Cancel</button>
      </div>
    </form>
  );
}

export default function ProcurementPanel() {
  const { user } = useAuth();
  const canEdit = canEditModule(user, 'procurement');
  const [tab, setTab] = useState('pos');
  const [scenario, setScenario] = useState(null);
  const [quarter, setQuarter] = useState('');
  const [adding, setAdding] = useState(false);

  const sq = scenario ? `scenario=${scenario}` : '';
  const { data: scenarios, refresh: refreshScenarios } = useApiGet('/procurement/scenarios');
  const { data: summary, refresh: refreshSummary } = useApiGet(`/procurement/summary?${sq}${quarter ? `&quarter=${quarter}` : ''}`, [scenario, quarter]);
  const { data: pos, loading: posLoading, refresh: refreshPos } = useApiGet(`/procurement/pos?${sq}${quarter ? `&quarter=${quarter}` : ''}`, [scenario, quarter]);
  const { data: demand, loading: demandLoading, refresh: refreshDemand } = useApiGet(`/procurement/demand?${sq}`, [scenario]);
  const { data: demandParts, loading: partsDemandLoading, refresh: refreshDemandParts } = useApiGet(`/procurement/demand/parts?${sq}`, [scenario]);
  const { data: parts, loading: partsLoading, refresh: refreshParts } = useApiGet('/procurement/parts');
  const { data: samples, loading: samplesLoading, refresh: refreshSamples } = useApiGet('/procurement/samples');
  const { data: boms, loading: bomsLoading } = useApiGet('/procurement/boms');

  const reloadAll = async () => {
    await Promise.all([refreshScenarios(), refreshSummary(), refreshPos(), refreshDemand(), refreshDemandParts()]);
  };

  const savePO = async (form) => {
    await apiPost(`/procurement/pos${scenario ? `?scenario=${scenario}` : ''}`, { ...form, scenario_id: scenario });
    setAdding(false);
    refreshPos(); refreshSummary();
  };
  const editPO = async (row, key, value) => {
    try { await apiPut(`/procurement/pos/${row.id}`, { [key]: value }); }
    catch (e) { alert(e.message); }
    refreshPos(); refreshSummary();
  };

  // Bulk selection + mass update — the Monday habit cell edits can't replace.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleRow = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = (visibleIds, on) => setSelected(prev => {
    const next = new Set(prev);
    for (const id of visibleIds) { if (on) next.add(id); else next.delete(id); }
    return next;
  });
  const bulk = async (patch) => {
    setBulkBusy(true);
    try {
      await apiPut('/procurement/pos/bulk', { ids: [...selected], patch });
      setSelected(new Set());
      refreshPos(); refreshSummary();
    } catch (e) { alert(e.message); }
    finally { setBulkBusy(false); }
  };
  const editDemand = async (row, key, value) => {
    await apiPut(`/procurement/demand/${row.id}`, { [key]: value });
    refreshDemand(); refreshDemandParts();
  };

  const cards = [
    { label: 'Open POs', value: summary?.open_count ?? 0 },
    { label: 'Urgent / delayed', value: summary?.urgent_delayed_count ?? 0, alert: (summary?.urgent_delayed_count ?? 0) > 0 },
    { label: 'Scheduled spend', value: money(summary?.scheduled_spend) },
  ];

  const poColumns = useMemo(() => [
    { key: 'po_number', label: 'PO #', edit: true },
    { key: 'vendor', label: 'Vendor', filter: true, edit: true },
    { key: 'part_no', label: 'Part #', edit: true },
    { key: 'description', label: 'Description', edit: true },
    { key: 'qty', label: 'Qty', type: 'number', align: 'right', edit: true },
    { key: 'uom', label: 'UOM', edit: true, width: '4rem' },
    { key: 'unit_price', label: 'Unit', type: 'money', align: 'right', edit: true },
    { key: 'total', label: 'Total', type: 'money', align: 'right' },
    { key: 'order_date', label: 'Ordered', edit: true },
    { key: 'expected_date', label: 'Expected', edit: true },
    { key: 'received_date', label: 'Received', edit: true },
    // Stored override wins; blank follows the expected date. Type 2026-Q4, or
    // blank the cell to go back to date-derived.
    { key: 'quarter', label: 'Quarter', filter: true, edit: true },
    { key: 'lead_time_days', label: 'Lead (d)', type: 'number', align: 'right', edit: true, width: '4.5rem' },
    { key: 'customer', label: 'Customer', filter: true, edit: true },
    { key: 'customer_po', label: 'Customer PO', edit: true },
    { key: 'bol', label: 'BOL', edit: true },
    // Monday's own word for the row, kept verbatim — provenance, not editable.
    { key: 'source_status', label: 'Board status', filter: true },
    { key: 'notes', label: 'Notes', edit: true },
    {
      key: 'status', label: 'Status', filter: true, edit: true,
      render: (r) => (
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
          r.status === 'received' ? 'bg-green-100 text-green-700'
          : r.status === 'cancelled' ? 'bg-gray-100 text-gray-400'
          : r.delayed ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
          {r.delayed && r.status !== 'received' ? `${r.status} · late` : r.status}
        </span>
      ),
    },
    {
      key: 'urgent', label: 'Urgent',
      // One click flips it — a flag is a toggle, not a value to type.
      render: (r) => (
        <button type="button" disabled={!canEdit}
          onClick={(e) => { e.stopPropagation(); if (canEdit) editPO(r, 'urgent', r.urgent ? 0 : 1); }}
          title={canEdit ? 'Click to toggle' : undefined}
          className={r.urgent
            ? 'px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold'
            : `px-1.5 py-0.5 rounded text-[10px] font-bold ${canEdit ? 'text-gray-300 hover:bg-gray-100 hover:text-gray-500' : 'text-gray-300'}`}>
          {r.urgent ? 'URGENT' : '—'}
        </button>
      ),
    },
    ...(canEdit ? [{
      key: 'id', label: '', align: 'right',
      render: (r) => (
        <button onClick={async () => { if (confirm('Delete this PO?')) { await apiFetch(`/procurement/pos/${r.id}`, { method: 'DELETE' }); refreshPos(); refreshSummary(); } }}
          className="p-1 text-gray-300 hover:text-red-500"><X size={13} /></button>
      ),
    }] : []),
  ], [canEdit, refreshPos, refreshSummary, editPO]);

  // `fields` drives the mapping step, so the target definition has to be in
  // hand before the panel mounts — it reads fields.length unguarded.
  const { data: importTargets } = useApiGet(canEdit ? '/imports/targets' : null);
  const importTarget = (importTargets || []).find(t => t.key === 'purchase_orders');

  const tabs = [
    ['pos', 'Purchase Orders'],
    ...(canEdit ? [['import', 'Import board']] : []),
    ['demand', 'Demand Plan'],
    ['parts-demand', 'Parts Needed'],
    ['parts', 'Parts & Pricing'],
    ['samples', 'Samples'],
    ['boms', 'BOMs'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Procurement &amp; Demand</h2>
        <div className="flex items-center gap-2">
          <select value={quarter} onChange={e => setQuarter(e.target.value)}
            className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
            <option value="">All quarters</option>
            {(summary?.quarters || []).map(q => <option key={q} value={q}>{q.replace('-', ' ')}</option>)}
          </select>
        </div>
      </div>

      <ScenarioBar scenarios={scenarios} active={scenario} setActive={setScenario}
        canEdit={canEdit} onChanged={reloadAll} />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-2xl font-bold ${c.alert ? 'text-red-600' : 'text-gray-900'}`}>{c.value}</p>
            {c.label === 'Urgent / delayed' && (summary?.delayed_count ?? 0) > 0 && (
              <p className="text-[11px] text-gray-400">{summary.delayed_count} past their expected date</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {tabs.map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
        ))}
      </div>

      {tab === 'pos' && (
        <>
          {adding && <POForm onSave={savePO} onCancel={() => setAdding(false)} />}
          {canEdit && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 bg-powder-50 border border-powder-200 rounded-xl px-3 py-2 text-sm">
              <span className="font-semibold text-powder-900">{selected.size} selected</span>
              <select disabled={bulkBusy} defaultValue="" onChange={e => { if (e.target.value) { bulk({ status: e.target.value }); e.target.value = ''; } }}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                <option value="">Set status…</option>
                {PO_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
              <select disabled={bulkBusy} defaultValue="" onChange={e => { if (e.target.value) { bulk({ quarter: e.target.value === '(clear)' ? '' : e.target.value }); e.target.value = ''; } }}
                className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                <option value="">Set quarter…</option>
                {(summary?.quarters || []).map(qq => <option key={qq} value={qq}>{qq}</option>)}
                <option value="(clear)">(follow expected date)</option>
              </select>
              <button disabled={bulkBusy} onClick={() => bulk({ urgent: true })}
                className="px-2.5 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">Mark urgent</button>
              <button disabled={bulkBusy} onClick={() => bulk({ urgent: false })}
                className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium bg-white disabled:opacity-50">Not urgent</button>
              <label className="flex items-center gap-1 text-xs text-gray-600">
                Expected:
                <input type="date" disabled={bulkBusy} onChange={e => { if (e.target.value) { bulk({ expected_date: e.target.value }); e.target.value = ''; } }}
                  className="px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white" />
              </label>
              <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Clear selection</button>
            </div>
          )}
          <DataGrid
            columns={poColumns} rows={pos} loading={posLoading} canEdit={canEdit} onEdit={editPO}
            selectable={canEdit} selected={selected} onToggleRow={toggleRow} onToggleAll={toggleAll}
            searchPlaceholder="Search PO #, vendor, part, notes…"
            empty="No purchase orders yet."
            rowClass={r => (r.delayed ? 'bg-red-50/40' : '')}
            toolbar={canEdit && !adding ? (
              <button onClick={() => setAdding(true)}
                className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
                <Plus size={15} /> New PO
              </button>
            ) : null}
          />
        </>
      )}

      {/* The Monday board this module replaces. Preview-then-commit and
          idempotent on the item, so re-exporting from Monday updates the rows
          already here instead of doubling them. */}
      {tab === 'import' && canEdit && (
        importTarget ? (
          <ImportPanel target="purchase_orders" targetLabel="Purchase Orders (Monday board)"
            fields={importTarget.fields} onDone={() => { refreshPos(); refreshSummary(); }} />
        ) : <p className="text-sm text-gray-500">Loading…</p>
      )}

      {tab === 'demand' && (
        <>
          <p className="text-sm text-gray-500">
            Set how many of each finished good you plan to make. The Parts Needed tab explodes it through the BOMs.
          </p>
          <DataGrid
            columns={[
              { key: 'product_number', label: 'Product #' },
              { key: 'product_name', label: 'Product' },
              { key: 'requested_qty', label: 'Planned qty', type: 'number', align: 'right', edit: true },
              { key: 'quarter', label: 'Quarter', filter: true, edit: true },
              { key: 'notes', label: 'Notes', edit: true },
            ]}
            rows={demand} loading={demandLoading} canEdit={canEdit} onEdit={editDemand}
            searchPlaceholder="Search finished goods…" empty="No products in the plan."
            initialSort={{ key: 'requested_qty', dir: 'desc' }}
          />
        </>
      )}

      {tab === 'parts-demand' && (
        <>
          <p className="text-sm text-gray-500">
            What the current plan needs, rolled down through intermediates and blends, with the 5% cushion.
          </p>
          <DataGrid
            columns={[
              { key: 'part_no', label: 'Part #' },
              { key: 'description', label: 'Part' },
              { key: 'uom', label: 'UOM', filter: true },
              { key: 'qty', label: 'Demand', type: 'number', align: 'right' },
              { key: 'qty_with_cushion', label: '+5%', type: 'number', align: 'right' },
              { key: 'vendor', label: 'Vendor', filter: true },
              { key: 'unit_price', label: 'Unit', type: 'money', align: 'right' },
              { key: 'extended_cost', label: 'Extended', type: 'money', align: 'right' },
              { key: 'lead_time_days', label: 'Lead (d)', type: 'number', align: 'right' },
            ]}
            rows={(demandParts || []).map(p => ({ ...p, id: p.part_no }))}
            loading={partsDemandLoading}
            searchPlaceholder="Search parts…" empty="Nothing needed — no planned quantities yet."
            initialSort={{ key: 'qty_with_cushion', dir: 'desc' }}
          />
        </>
      )}

      {tab === 'parts' && (
        <DataGrid
          columns={[
            { key: 'part_no', label: 'Part #', edit: true },
            { key: 'description', label: 'Description', edit: true },
            { key: 'vendor', label: 'Vendor', filter: true, edit: true },
            { key: 'price', label: 'Price', type: 'money', align: 'right', edit: true },
            { key: 'current_price', label: 'Current', type: 'money', align: 'right', edit: true },
            { key: 'moq', label: 'MOQ', type: 'number', align: 'right', edit: true },
            { key: 'lead_time_days', label: 'Lead (d)', type: 'number', align: 'right', edit: true },
            { key: 'priority', label: 'Priority', type: 'number', align: 'right', filter: true, edit: true },
            { key: 'last_checked', label: 'Checked' },
            { key: 'notes', label: 'Notes', edit: true },
          ]}
          rows={parts} loading={partsLoading} canEdit={canEdit}
          onEdit={async (row, key, value) => { await apiPut(`/procurement/parts/${row.id}`, { [key]: value }); refreshParts(); }}
          searchPlaceholder="Search part #, description, vendor…" empty="No parts loaded."
        />
      )}

      {tab === 'samples' && (
        <DataGrid
          columns={[
            { key: 'item_name', label: 'Item', edit: true },
            { key: 'vendor', label: 'Vendor', filter: true, edit: true },
            { key: 'status', label: 'Status', filter: true, edit: true },
            { key: 'viable', label: 'Viable?', filter: true, edit: true },
            { key: 'qc_approved', label: 'QC approved', filter: true, edit: true },
            { key: 'quality_rank', label: 'Quality', type: 'number', align: 'right', edit: true },
            { key: 'price', label: 'Price', type: 'money', align: 'right', edit: true },
            { key: 'moq', label: 'MOQ', type: 'number', align: 'right', edit: true },
            { key: 'lead_time', label: 'Lead time', edit: true },
            { key: 'ordering_notes', label: 'Contact / ordering', edit: true },
          ]}
          rows={samples} loading={samplesLoading} canEdit={canEdit}
          onEdit={async (row, key, value) => { await apiPut(`/procurement/samples/${row.id}`, { [key]: value }); refreshSamples(); }}
          searchPlaceholder="Search item, vendor, status…" empty="No samples tracked."
        />
      )}

      {tab === 'boms' && (
        <DataGrid
          columns={[
            { key: 'product_number', label: 'Product #' },
            { key: 'product_name', label: 'Product' },
            { key: 'group_name', label: 'Group', filter: true },
            { key: 'part_no', label: 'Part #' },
            { key: 'part_description', label: 'Part' },
            { key: 'uom', label: 'UOM', filter: true },
            { key: 'bom_qty', label: 'BOM qty', type: 'number', align: 'right' },
          ]}
          rows={boms} loading={bomsLoading}
          searchPlaceholder="Search product or part…" empty="No BOM lines loaded."
        />
      )}
    </div>
  );
}
