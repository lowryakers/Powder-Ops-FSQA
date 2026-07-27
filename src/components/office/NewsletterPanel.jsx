import { useState, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, Trash2, Send, FileText, Image as ImageIcon, ArrowUp, ArrowDown, Eye, X, Newspaper } from 'lucide-react';

// The newsletter, in two halves.
//
// "Notes" are the cards Marnee keeps adding to through the month. "Build
// newsletter" freezes them into a draft she can rework — reorder, rewrite, add
// photos — and Share turns that draft into a PDF posted to #announcements with
// a message of her own. Sharing locks the issue, so what went out stays a
// record of what went out.

const KINDS = [
  { value: 'events', label: 'Upcoming event', tone: 'bg-blue-100 text-blue-700' },
  { value: 'shoutouts', label: 'Shout-out', tone: 'bg-green-100 text-green-700' },
  { value: 'news', label: 'Big news', tone: 'bg-purple-100 text-purple-700' },
  { value: 'stats', label: 'Stats', tone: 'bg-amber-100 text-amber-700' },
  { value: 'general', label: 'General', tone: 'bg-gray-100 text-gray-600' },
];
const kindMeta = (k) => KINDS.find(x => x.value === k) || KINDS[4];

function CardEditor({ card, onSave, onCancel }) {
  const [form, setForm] = useState({ kind: card?.kind || 'general', title: card?.title || '', body: card?.body || '' });
  const [saving, setSaving] = useState(false);
  return (
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(form); } finally { setSaving(false); } }}
      className="bg-white rounded-xl border border-powder-200 p-3 space-y-2">
      <div className="flex gap-2">
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
          className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm">
          {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <input required autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder="Headline" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={3}
        placeholder="Details — dates, names, numbers…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-powder-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-gray-600 text-sm rounded-lg hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}

function NotesTab({ canEdit, cards, refresh, onBuild, building }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const save = async (form, id) => {
    if (id) await apiPut(`/newsletter/cards/${id}`, form);
    else await apiPost('/newsletter/cards', form);
    setAdding(false); setEditingId(null);
    refresh();
  };
  const remove = async (c) => {
    if (!confirm(`Delete "${c.title}"?`)) return;
    await apiFetch(`/newsletter/cards/${c.id}`, { method: 'DELETE' });
    refresh();
  };
  const toggle = async (c) => { await apiPut(`/newsletter/cards/${c.id}`, { is_active: !c.is_active }); refresh(); };
  const move = async (c, dir) => {
    const list = [...(cards || [])];
    const i = list.findIndex(x => x.id === c.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    await apiPut(`/newsletter/cards/${list[i].id}`, { sort_order: list[j].sort_order });
    await apiPut(`/newsletter/cards/${list[j].id}`, { sort_order: list[i].sort_order });
    refresh();
  };

  const active = (cards || []).filter(c => c.is_active).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-500">
          Add to these through the month. {active} card{active === 1 ? '' : 's'} will go into the next newsletter.
        </p>
        <div className="flex gap-2">
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Plus size={15} /> Add a card
            </button>
          )}
          {canEdit && (
            <button onClick={onBuild} disabled={building || active === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              <Newspaper size={15} /> {building ? 'Building…' : 'Build newsletter'}
            </button>
          )}
        </div>
      </div>

      {adding && <CardEditor onSave={f => save(f)} onCancel={() => setAdding(false)} />}

      <div className="space-y-2">
        {(cards || []).map((c, i) => (
          editingId === c.id ? (
            <CardEditor key={c.id} card={c} onSave={f => save(f, c.id)} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={c.id} className={`bg-white rounded-xl border p-3 ${c.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${kindMeta(c.kind).tone}`}>{kindMeta(c.kind).label}</span>
                    <p className="font-medium text-gray-900">{c.title}</p>
                    {!c.is_active && <span className="text-[10px] font-bold text-gray-400">HELD BACK</span>}
                  </div>
                  {c.body && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{c.body}</p>}
                  <p className="text-[11px] text-gray-400 mt-1">Updated by {c.updated_by || '—'}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => move(c, -1)} disabled={i === 0} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => move(c, 1)} disabled={i === (cards || []).length - 1} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button onClick={() => toggle(c)} className="px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded">
                      {c.is_active ? 'Hold' : 'Include'}
                    </button>
                    <button onClick={() => setEditingId(c.id)} className="px-2 py-1 text-xs font-medium text-powder-700 hover:bg-powder-50 rounded">Edit</button>
                    <button onClick={() => remove(c)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          )
        ))}
        {(cards || []).length === 0 && (
          <p className="text-center py-10 text-sm text-gray-400">No cards yet. Add events, shout-outs and news as they happen.</p>
        )}
      </div>
    </div>
  );
}

function IssueEditor({ issue, canEdit, onChanged, onClose }) {
  const [draft, setDraft] = useState(issue);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploadingFor, setUploadingFor] = useState(null);
  const fileRef = useRef(null);
  const shared = draft.status === 'shared';

  const setSection = (id, patch) =>
    setDraft(d => ({ ...d, sections: d.sections.map(s => (s.id === id ? { ...s, ...patch } : s)) }));

  const moveSection = (id, dir) => setDraft(d => {
    const list = [...d.sections];
    const i = list.findIndex(s => s.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return d;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...d, sections: list };
  });

  const removeSection = (id) => setDraft(d => ({ ...d, sections: d.sections.filter(s => s.id !== id) }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const saved = await apiPut(`/newsletter/issues/${draft.id}`, {
        title: draft.title, intro: draft.intro, sections: draft.sections,
      });
      setDraft(saved);
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const attachImage = async (sectionId, files) => {
    const file = files?.[0];
    if (!file) return;
    setUploadingFor(sectionId); setError('');
    try {
      const body = new FormData();
      body.append('files', file);
      body.append('issue_id', draft.id);
      const res = await fetch('/api/newsletter/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
        body,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
      const { images } = await res.json();
      setSection(sectionId, { image_id: images[0].id, image_url: images[0].url });
    } catch (e) { setError(e.message); } finally { setUploadingFor(null); }
  };

  const share = async () => {
    if (!confirm('Share this newsletter to #announcements? It will be locked afterwards.')) return;
    setSharing(true); setError('');
    try {
      await save();
      await apiPost(`/newsletter/issues/${draft.id}/share`, { message });
      onChanged?.();
      onClose();
    } catch (e) { setError(e.message); } finally { setSharing(false); }
  };

  const openPdf = () => {
    // Presigned-free: the endpoint streams the PDF for whoever can view it.
    fetch(`/api/newsletter/issues/${draft.id}/pdf`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } })
      .then(r => r.blob())
      .then(b => window.open(URL.createObjectURL(b), '_blank', 'noopener'))
      .catch(() => setError('Could not open the PDF.'));
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-gray-50 rounded-2xl shadow-xl w-full max-w-3xl my-6">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-white rounded-t-2xl sticky top-0 z-10">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{shared ? 'Shared newsletter' : 'Newsletter preview'}</h3>
            <p className="text-[11px] text-gray-400">
              {shared ? `Shared by ${draft.shared_by} · ${(draft.shared_at || '').slice(0, 10)}` : 'Edit anything before it goes out.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openPdf} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
              <FileText size={13} /> PDF
            </button>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        <div className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} disabled={shared}
              className="w-full text-xl font-bold text-gray-900 border-0 border-b border-transparent focus:border-gray-200 focus:outline-none disabled:bg-transparent" />
            <textarea value={draft.intro || ''} onChange={e => setDraft({ ...draft, intro: e.target.value })} disabled={shared}
              rows={2} placeholder="A short intro (optional)"
              className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 disabled:bg-transparent disabled:border-transparent" />
          </div>

          {draft.sections.map((s, i) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 mt-1 ${kindMeta(s.kind).tone}`}>{kindMeta(s.kind).label}</span>
                <input value={s.title} onChange={e => setSection(s.id, { title: e.target.value })} disabled={shared}
                  className="flex-1 font-semibold text-gray-900 border-0 border-b border-transparent focus:border-gray-200 focus:outline-none disabled:bg-transparent" />
                {!shared && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => moveSection(s.id, -1)} disabled={i === 0} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => moveSection(s.id, 1)} disabled={i === draft.sections.length - 1} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button onClick={() => removeSection(s.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <textarea value={s.body || ''} onChange={e => setSection(s.id, { body: e.target.value })} disabled={shared} rows={3}
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 disabled:bg-transparent disabled:border-transparent" />
              {s.image_url && <img src={s.image_url} alt="" className="rounded-lg max-h-56 object-contain" />}
              {!shared && canEdit && (
                <div>
                  <input ref={s.id === uploadingFor ? fileRef : null} type="file" accept="image/*" className="hidden"
                    id={`img-${s.id}`} onChange={e => attachImage(s.id, e.target.files)} />
                  <label htmlFor={`img-${s.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium cursor-pointer hover:bg-gray-200">
                    <ImageIcon size={13} /> {uploadingFor === s.id ? 'Uploading…' : (s.image_id ? 'Replace image' : 'Add an image')}
                  </label>
                </div>
              )}
            </div>
          ))}

          {!shared && canEdit && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <label className="block text-xs font-medium text-gray-700">Message to post with it</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2}
                placeholder="e.g. July newsletter is here — big month for the sticks line 🎉"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
              <div className="flex gap-2">
                <button onClick={share} disabled={sharing}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
                  <Send size={14} /> {sharing ? 'Sharing…' : 'Share to #announcements'}
                </button>
                <button onClick={save} disabled={saving}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewsletterPanel() {
  const { user } = useAuth();
  const canEdit = canEditModule(user, 'newsletter');
  const [tab, setTab] = useState('notes');
  const [open, setOpen] = useState(null);
  const [building, setBuilding] = useState(false);

  const { data: cards, refresh: refreshCards } = useApiGet('/newsletter/cards');
  const { data: issues, refresh: refreshIssues } = useApiGet('/newsletter/issues');

  const build = async () => {
    setBuilding(true);
    try {
      const issue = await apiPost('/newsletter/issues', {});
      refreshIssues();
      setOpen(issue);
    } finally { setBuilding(false); }
  };

  const openIssue = async (i) => setOpen(await apiFetch(`/newsletter/issues/${i.id}`));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Newsletter</h2>
          <p className="text-sm text-gray-500">Collect news through the month, then send it out in one go.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[['notes', 'Notes'], ['issues', 'Newsletters']].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'notes' && (
        <NotesTab canEdit={canEdit} cards={cards} refresh={refreshCards} onBuild={build} building={building} />
      )}

      {tab === 'issues' && (
        <div className="space-y-2">
          {(issues || []).map(i => (
            <div key={i.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">{i.title}</p>
                <p className="text-[11px] text-gray-400">
                  {i.status === 'shared'
                    ? `Shared by ${i.shared_by} · ${(i.shared_at || '').slice(0, 10)}`
                    : `Draft · ${i.sections.length} section${i.sections.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${i.status === 'shared' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {i.status === 'shared' ? 'SHARED' : 'DRAFT'}
              </span>
              <button onClick={() => openIssue(i)}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
                <Eye size={13} /> Open
              </button>
            </div>
          ))}
          {(issues || []).length === 0 && (
            <p className="text-center py-10 text-sm text-gray-400">Nothing built yet — add some notes, then press Build newsletter.</p>
          )}
        </div>
      )}

      {open && (
        <IssueEditor issue={open} canEdit={canEdit} onClose={() => setOpen(null)}
          onChanged={() => { refreshIssues(); refreshCards(); }} />
      )}
    </div>
  );
}
