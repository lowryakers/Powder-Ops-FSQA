import { useState, useMemo, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, Edit2, Trash2, X, Network, Settings2, FileText, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import './OrgChart.css';
import SearchSelect from '../common/SearchSelect.jsx';

const DEPARTMENTS = ['executive', 'quality', 'production', 'sanitation', 'maintenance', 'warehouse', 'admin', 'other'];
const DEPT_CLASS = {
  executive: 'border-slate-400 bg-slate-50',
  quality: 'border-teal-400 bg-teal-50',
  production: 'border-green-400 bg-green-50',
  sanitation: 'border-emerald-400 bg-emerald-50',
  maintenance: 'border-orange-400 bg-orange-50',
  warehouse: 'border-indigo-400 bg-indigo-50',
  admin: 'border-purple-400 bg-purple-50',
  other: 'border-gray-300 bg-white',
};
const cap = (s) => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);

function PositionModal({ initial, parentTitle, allPositions, jobDescriptions, people, onSave, onCancel }) {
  const [form, setForm] = useState({
    title: initial?.title || '',
    name: initial?.name || '',
    backup: initial?.backup || '',
    department: initial?.department || 'production',
    parent_id: initial?.parent_id ?? (initial?._defaultParent ?? ''),
    job_description_ids: initial?.job_description_ids?.length
      ? initial.job_description_ids
      : (initial?.job_description_id ? [initial.job_description_id] : []),
    user_id: initial?.user_id || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Can't report into itself
  const parentOptions = (allPositions || []).filter(p => p.id !== initial?.id);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, parent_id: form.parent_id || null }); } catch (saveErr) {
      // A refused save must SAY so. This was try/finally with NO catch, so a
      // 403 or a validation 400 cleared the spinner and left the modal sitting
      // there — indistinguishable from a dead button, which is how a
      // deliberate rule reads as a broken screen.
      window.alert(saveErr.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Position' : 'Add Position'}</h3>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {parentTitle && !initial?.id && <p className="text-xs text-gray-500">Reports to <span className="font-medium">{parentTitle}</span></p>}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Position / Title *</label>
          <input required value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Quality Manager"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            {/* WHO HOLDS IT, by account. A typed name froze the chart at
                whatever was entered — a rename in Settings never reached it and
                a leaver kept their box. The free-text field survives below for
                a contractor or an agency temp with no ReadyDoc account. */}
            <label className="block text-xs font-medium text-gray-700 mb-1">Person</label>
            <select value={form.user_id || ''} onChange={e => set('user_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">— Vacant / not an account —</option>
              {(people || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Back-up</label>
            <input value={form.backup} onChange={e => set('backup', e.target.value)} placeholder="Back-up role/person"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
            <select value={form.department} onChange={e => set('department', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {DEPARTMENTS.map(d => <option key={d} value={d}>{cap(d)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reports to</label>
            <select value={form.parent_id || ''} onChange={e => set('parent_id', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">— Top level —</option>
              {parentOptions.map(p => <option key={p.id} value={p.id}>{p.title}{p.name ? ` (${p.name})` : ''}</option>)}
            </select>
          </div>
        </div>
        {!form.user_id && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name on the chart</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Leave blank if the position is vacant"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <p className="mt-1 text-[11px] text-gray-500">
              Only for someone without a ReadyDoc account. Pick a person above and the chart follows their
              account, so a rename in Settings reaches it.
            </p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Job Descriptions</label>
          {/* Several hats is the normal case in a plant this size, so this is
              a multi-pick: chips for what's linked, a type-ahead to add the
              next. The first pick is the primary (the chart's chip). */}
          {form.job_description_ids.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {form.job_description_ids.map(id => {
                const d = (jobDescriptions || []).find(x => x.id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-powder-50 border border-powder-200 text-xs text-powder-900">
                    {d ? `${d.doc_number ? `${d.doc_number} · ` : ''}${d.title}` : 'Unknown document'}
                    <button type="button" onClick={() => set('job_description_ids', form.job_description_ids.filter(x => x !== id))}
                      className="text-powder-400 hover:text-red-500"><X size={11} /></button>
                  </span>
                );
              })}
            </div>
          )}
          <SearchSelect value="" placeholder="Type to search job descriptions…"
            options={(jobDescriptions || []).filter(d => !form.job_description_ids.includes(d.id))
              .map(d => `${d.doc_number ? `${d.doc_number} · ` : ''}${d.title}`)}
            onChange={(label) => {
              if (!label) return;
              const d = (jobDescriptions || []).find(x => `${x.doc_number ? `${x.doc_number} · ` : ''}${x.title}` === label);
              if (d && !form.job_description_ids.includes(d.id)) set('job_description_ids', [...form.job_description_ids, d.id]);
            }} />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function MetaModal({ meta, onSave, onCancel }) {
  const [form, setForm] = useState({ version: meta?.version || '', approved_by: meta?.approved_by || '', effective_date: meta?.effective_date || '' });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => { e.preventDefault(); setSaving(true); try { await onSave(form); } catch (saveErr) {
      // A refused save must SAY so. This was try/finally with NO catch, so a
      // 403 or a validation 400 cleared the spinner and left the modal sitting
      // there — indistinguishable from a dead button, which is how a
      // deliberate rule reads as a broken screen.
      window.alert(saveErr.message);
    } finally { setSaving(false); } };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Chart Details</h3>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Version</label>
          <input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Approved by</label>
          <input value={form.approved_by} onChange={e => setForm(f => ({ ...f, approved_by: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Effective date</label>
          <input type="date" value={form.effective_date || ''} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function TreeNode({ node, canEdit, dnd, onAddChild, onEdit, onDelete, jdById = {} }) {
  const deptClass = DEPT_CLASS[node.department] || DEPT_CLASS.other;
  const isDragging = dnd.draggingId === node.id;
  const isForbidden = dnd.forbidden.has(node.id);
  const isDropTarget = dnd.dragOverId === node.id && dnd.draggingId && !isForbidden;
  return (
    <li>
      <div
        draggable={canEdit}
        onDragStart={canEdit ? (e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); dnd.onDragStart(node.id); } : undefined}
        onDragEnd={dnd.onDragEnd}
        onDragOver={canEdit && dnd.draggingId && !isForbidden ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dnd.dragOverId !== node.id) dnd.onDragEnter(node.id); } : undefined}
        onDrop={canEdit ? (e) => { e.preventDefault(); e.stopPropagation(); dnd.onDrop(node.id); } : undefined}
        className={`group/node relative border-2 rounded-lg px-3 py-2 min-w-[150px] max-w-[220px] text-center shadow-sm transition-all ${deptClass} ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
        title={canEdit ? 'Drag onto another position to change reporting line' : undefined}
      >
        <div className="text-xs font-bold text-gray-900 leading-tight">{node.title}</div>
        {node.name ? (
          <div className="text-xs text-gray-700 mt-0.5 flex items-center gap-1 flex-wrap justify-center">
            <span>{node.name}</span>
            {/* A box whose holder has left still shows their name on every
                printed chart until somebody notices. Now it says so. */}
            {node.person_active === false && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-medium">left</span>
            )}
            {node.link_broken && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-medium">account gone</span>
            )}
            {!node.user_id && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-500" title="Typed name — not linked to a ReadyDoc account, so a rename in Settings will not reach it">
                unlinked
              </span>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-400 mt-0.5 italic">Vacant</div>
        )}
        {node.backup && <div className="text-[10px] text-gray-400 mt-0.5">Back-up: {node.backup}</div>}
        {(node.job_description_ids?.length ? node.job_description_ids : (node.job_description_id ? [node.job_description_id] : [])).map((jd, i, all) => (
          <button key={jd}
            draggable={false}
            onClick={(e) => { e.stopPropagation(); try { localStorage.setItem('doc_focus', jd); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'job-descriptions' } })); }}
            className="mt-1 mr-1.5 inline-flex items-center gap-1 text-[10px] text-powder-600 hover:underline">
            <FileText size={10} /> {all.length === 1 ? 'Job Description' : (jdById[jd]?.doc_number || jdById[jd]?.title || `JD ${i + 1}`)}
          </button>
        ))}
        {canEdit && (
          <div className="absolute -top-2.5 right-1 hidden group-hover/node:flex items-center gap-0.5 bg-white border border-gray-200 rounded-md shadow-sm px-0.5">
            <button onClick={() => onAddChild(node)} className="p-1 text-gray-400 hover:text-green-600" title="Add report"><Plus size={12} /></button>
            <button onClick={() => onEdit(node)} className="p-1 text-gray-400 hover:text-powder-600" title="Edit"><Edit2 size={12} /></button>
            <button onClick={() => onDelete(node)} className="p-1 text-gray-400 hover:text-red-600" title="Remove"><Trash2 size={12} /></button>
          </div>
        )}
      </div>
      {node.children.length > 0 && (() => {
        // ANYTHING THAT DOESN'T BRANCH STACKS; BRANCHING STRUCTURES SPREAD.
        // The sideways scrolling came from every report taking a column of
        // its own: five department heads beside two real subtrees, and five
        // supervisor→worker chains side by side. A leaf or a pure chain
        // carries no structure that needs width, so those gather into ONE
        // vertical column (the idiom printed org charts use), while children
        // that genuinely branch keep the classic spread — the management
        // structure still reads as a tree. Fewer than two stackable children
        // stay inline: a single column of one is just a longer wire.
        const render = (c) => (
          <TreeNode key={c.id} node={c} canEdit={canEdit} dnd={dnd} onAddChild={onAddChild} onEdit={onEdit} onDelete={onDelete} jdById={jdById} />
        );
        // Depth-guarded: a reporting line that somehow loops (bad legacy data,
        // not something the API allows) would otherwise recurse until the
        // page died. A chart is never 50 deep, so the cap only ever fires on
        // data that is already wrong.
        const isChain = (n, depth = 0) => depth > 50 || (n.children?.length || 0) === 0
          || (n.children.length === 1 && isChain(n.children[0], depth + 1));
        const stackable = node.children.filter(isChain);
        const branching = node.children.filter(c => !isChain(c));
        if (stackable.length < 2) return <ul>{node.children.map(render)}</ul>;
        return (
          <ul>
            {branching.map(render)}
            <li className="orgstack-cell">
              <ul className="orgstack">{stackable.map(render)}</ul>
            </li>
          </ul>
        );
      })()}
    </li>
  );
}

export default function OrgChart() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'org-chart');
  const { data, loading, refresh } = useApiGet('/org');
  const { data: jobDescriptions } = useApiGet('/documents?doc_type=job_description');
  const jdById = useMemo(() => Object.fromEntries((jobDescriptions || []).map(d => [d.id, d])), [jobDescriptions]);
  const { data: people } = useApiGet('/org/people');
  const [editing, setEditing] = useState(null);   // position being edited
  const [adding, setAdding] = useState(null);      // { _defaultParent, parentTitle } when adding
  const [editMeta, setEditMeta] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const positions = useMemo(() => data?.positions || [], [data]);
  const meta = data?.meta;

  // A node can't be dropped onto itself or any of its own descendants (would create a cycle)
  const forbidden = useMemo(() => {
    const set = new Set();
    if (!draggingId) return set;
    const kids = {};
    positions.forEach(p => { (kids[p.parent_id] || (kids[p.parent_id] = [])).push(p.id); });
    set.add(draggingId);
    const stack = [draggingId];
    while (stack.length) { const cur = stack.pop(); for (const c of (kids[cur] || [])) { set.add(c); stack.push(c); } }
    return set;
  }, [draggingId, positions]);

  const handleReparent = async (targetId) => {
    const id = draggingId;
    setDraggingId(null);
    setDragOverId(null);
    if (!id || id === targetId || forbidden.has(targetId)) return;
    try { await apiPut(`/org/${id}`, { parent_id: targetId }); refresh(); }
    catch (err) { console.error('Failed to move position:', err); }
  };

  const dnd = {
    draggingId, dragOverId, forbidden,
    onDragStart: setDraggingId,
    onDragEnter: setDragOverId,
    onDragEnd: () => { setDraggingId(null); setDragOverId(null); },
    onDrop: handleReparent,
  };

  const { roots } = useMemo(() => {
    const byId = {};
    positions.forEach(p => { byId[p.id] = { ...p, children: [] }; });
    const roots = [];
    positions.forEach(p => {
      if (p.parent_id && byId[p.parent_id]) byId[p.parent_id].children.push(byId[p.id]);
      else roots.push(byId[p.id]);
    });
    const sortRec = (nodes) => { nodes.sort((a, b) => (a.sort_order - b.sort_order) || a.title.localeCompare(b.title)); nodes.forEach(n => sortRec(n.children)); };
    sortRec(roots);
    return { roots };
  }, [positions]);

  const handleSavePosition = async (form) => {
    if (editing?.id) await apiPut(`/org/${editing.id}`, form);
    else await apiPost('/org', form);
    setEditing(null); setAdding(null); refresh();
  };
  const handleDelete = async (node) => {
    const msg = node.children?.length
      ? `Remove "${node.title}"? Its ${node.children.length} direct report(s) will move up to report to ${node.parent_id ? 'its manager' : 'the top level'}.`
      : `Remove "${node.title}"?`;
    if (!window.confirm(msg)) return;
    await apiFetch(`/org/${node.id}`, { method: 'DELETE' });
    refresh();
  };
  const handleSaveMeta = async (form) => { await apiPut('/org/meta', form); setEditMeta(false); refresh(); };

  // Viewing controls: zoom in/out plus one-click fit-to-width, so a wide chart
  // is readable without endless sideways scrolling. Uses the CSS zoom property
  // (affects layout, so the scrollbar shrinks with the chart).
  const [zoom, setZoom] = useState(1);
  const chartWrapRef = useRef(null);
  const chartRef = useRef(null);
  const fitToWidth = () => {
    const wrap = chartWrapRef.current, chart = chartRef.current;
    if (!wrap || !chart) return;
    const natural = chart.scrollWidth / zoom;
    setZoom(Math.max(0.35, Math.min(1, +( (wrap.clientWidth - 24) / natural ).toFixed(2))));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Network size={20} className="text-gray-400" /> Org Chart</h2>
          <p className="text-sm text-gray-500">
            {meta?.version ? `Version ${meta.version}` : 'Organization structure'}
            {meta?.approved_by ? ` · Approved by ${meta.approved_by}` : ''}
            {meta?.effective_date ? ` · ${meta.effective_date}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setZoom(z => Math.max(0.35, +(z - 0.1).toFixed(2)))} className="p-1.5 text-gray-500 hover:bg-white rounded-md" data-tip="Zoom out"><ZoomOut size={15} /></button>
            <button onClick={() => setZoom(1)} className="px-1.5 text-xs font-medium text-gray-600 hover:bg-white rounded-md min-w-[3rem]" data-tip="Reset to 100%">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => Math.min(1.5, +(z + 0.1).toFixed(2)))} className="p-1.5 text-gray-500 hover:bg-white rounded-md" data-tip="Zoom in"><ZoomIn size={15} /></button>
            <button onClick={fitToWidth} className="p-1.5 text-gray-500 hover:bg-white rounded-md" data-tip="Fit whole chart to screen width"><Maximize2 size={15} /></button>
          </div>
          {canEdit && (
            <>
              <button onClick={() => setEditMeta(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
                <Settings2 size={15} /> Details
              </button>
              <button onClick={() => setAdding({ _defaultParent: '', parentTitle: null })} className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
                <Plus size={16} /> Add Position
              </button>
            </>
          )}
        </div>
      </div>

      {/* WHO IS NOT ON THE CHART. An org chart missing people is the hole an
          auditor finds, and until now nothing compared it to the roster. Named
          rather than counted, because the point is to place them. */}
      {(data?.unplaced?.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm font-medium text-amber-900">
            {data.unplaced.length} {data.unplaced.length === 1 ? 'person is' : 'people are'} not on the chart
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            {data.unplaced.map(u => u.name).join(', ')}
          </p>
          <p className="mt-1 text-[11px] text-amber-700">
            Add a position for each, or link them to one that already exists.
          </p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading org chart…</div>
      ) : roots.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Network size={36} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No positions yet.{canEdit ? ' Click "Add Position" to start building the chart.' : ''}</p>
        </div>
      ) : (
        <div ref={chartWrapRef} className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          {canEdit && <p className="text-[11px] text-gray-400 px-4 pt-3">Tip: drag a position onto another to change its reporting line. Hover a box for add/edit/remove.</p>}
          <div ref={chartRef} className="orgtree min-w-full" style={{ zoom }}>
            <ul>
              {roots.map(r => (
                <TreeNode key={r.id} node={r} canEdit={canEdit} dnd={dnd} jdById={jdById}
                  onAddChild={(n) => setAdding({ _defaultParent: n.id, parentTitle: n.title })}
                  onEdit={(n) => setEditing(n)} onDelete={handleDelete} />
              ))}
            </ul>
          </div>
        </div>
      )}

      {(editing || adding) && (
        <PositionModal
          initial={editing || { _defaultParent: adding._defaultParent }}
          parentTitle={adding?.parentTitle}
          allPositions={positions}
          jobDescriptions={jobDescriptions}
          people={people}
          onSave={handleSavePosition}
          onCancel={() => { setEditing(null); setAdding(null); }}
        />
      )}
      {editMeta && <MetaModal meta={meta} onSave={handleSaveMeta} onCancel={() => setEditMeta(false)} />}
    </div>
  );
}
