import { useState, useRef, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import NewsletterBanner from './NewsletterBanner.jsx';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { usePageTranslation } from '../../lib/usePageTranslation.js';
import LangToggle from '../LangToggle.jsx';
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

function CardEditor({ card, onSave, onCancel, tr = (x) => x, lang = 'en' }) {
  const [form, setForm] = useState({ kind: card?.kind || 'general', title: card?.title || '', body: card?.body || '' });
  const [saving, setSaving] = useState(false);
  return (
    <form onSubmit={async e => { e.preventDefault(); setSaving(true); try { await onSave(form); } finally { setSaving(false); } }}
      className="bg-white rounded-xl border border-powder-200 p-3 space-y-2">
      {/* Cards are written once, in English, and translated on display — so the
          editor always shows the original no matter which way the toggle is set. */}
      {lang === 'es' && (
        <p className="text-[11px] text-amber-700">{tr('You are editing the original text (English).')}</p>
      )}
      <div className="flex gap-2">
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
          className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm">
          {KINDS.map(k => <option key={k.value} value={k.value}>{tr(k.label)}</option>)}
        </select>
        <input required autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder={tr('Headline')} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={3}
        placeholder={tr('Details — dates, names, numbers…')} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-powder-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
          {saving ? tr('Saving…') : tr('Save')}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-gray-600 text-sm rounded-lg hover:bg-gray-100">{tr('Cancel')}</button>
      </div>
    </form>
  );
}

function NotesTab({ canEdit, cards, refresh, onBuild, building, tr = (x) => x, lang = 'en' }) {
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
          {tr('Add to these through the month.')}{' '}
          {active === 1
            ? `1 ${tr('card will go into the next newsletter.')}`
            : `${active} ${tr('cards will go into the next newsletter.')}`}
        </p>
        <div className="flex gap-2">
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Plus size={15} /> {tr('Add a card')}
            </button>
          )}
          {canEdit && (
            <button onClick={onBuild} disabled={building || active === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              <Newspaper size={15} /> {building ? tr('Building…') : tr('Build newsletter')}
            </button>
          )}
        </div>
      </div>

      {adding && <CardEditor onSave={f => save(f)} onCancel={() => setAdding(false)} tr={tr} lang={lang} />}

      <div className="space-y-2">
        {(cards || []).map((c, i) => (
          editingId === c.id ? (
            <CardEditor key={c.id} card={c} onSave={f => save(f, c.id)} onCancel={() => setEditingId(null)} tr={tr} lang={lang} />
          ) : (
            <div key={c.id} className={`bg-white rounded-xl border p-3 ${c.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${kindMeta(c.kind).tone}`}>{tr(kindMeta(c.kind).label)}</span>
                    <p className="font-medium text-gray-900">{tr(c.title)}</p>
                    {!c.is_active && <span className="text-[10px] font-bold text-gray-400">{tr('HELD BACK')}</span>}
                  </div>
                  {c.body && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{tr(c.body)}</p>}
                  <p className="text-[11px] text-gray-400 mt-1">{tr('Updated by')} {c.updated_by || '—'}</p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <button onClick={() => move(c, -1)} disabled={i === 0} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => move(c, 1)} disabled={i === (cards || []).length - 1} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button onClick={() => toggle(c)} className="px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded">
                      {c.is_active ? tr('Hold') : tr('Include')}
                    </button>
                    <button onClick={() => setEditingId(c.id)} className="px-2 py-1 text-xs font-medium text-powder-700 hover:bg-powder-50 rounded">{tr('Edit')}</button>
                    <button onClick={() => remove(c)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            </div>
          )
        ))}
        {(cards || []).length === 0 && (
          <p className="text-center py-10 text-sm text-gray-400">{tr('No cards yet. Add events, shout-outs and news as they happen.')}</p>
        )}
      </div>
    </div>
  );
}

function IssueEditor({ issue, canEdit, onChanged, onClose, tr = (x) => x, lang = 'en', setLang, translating }) {
  const [draft, setDraft] = useState(issue);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploadingFor, setUploadingFor] = useState(null);
  const fileRef = useRef(null);
  const shared = draft.status === 'shared';
  // Spanish is a view of the same document, so it reads rather than edits —
  // typing into a translation would quietly overwrite the original.
  const reading = lang === 'es';
  const locked = shared || reading;

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
        banner_cover: draft.banner_cover ?? null, banner_image_id: draft.banner_image_id ?? null,
      });
      setDraft(saved);
      onChanged?.(saved);
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

  // A banner photo goes through the same upload the section images use; only
  // where the id lands differs.
  const attachBannerImage = async (files) => {
    const file = files?.[0];
    if (!file) return;
    setUploadingFor('__banner__'); setError('');
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
      setDraft(d => ({ ...d, banner_image_id: images[0].id, banner_image_url: images[0].url, banner_cover: null }));
    } catch (e) { setError(e.message); } finally { setUploadingFor(null); }
  };

  const share = async () => {
    if (!confirm(`Share this newsletter to #announcements in ${lang === 'es' ? 'Spanish' : 'English'}? It will be locked afterwards.`)) return;
    setSharing(true); setError('');
    try {
      await save();
      await apiPost(`/newsletter/issues/${draft.id}/share`, { message, lang });
      onChanged?.();
      onClose();
    } catch (e) { setError(e.message); } finally { setSharing(false); }
  };

  const openPdf = () => {
    // Presigned-free: the endpoint streams the PDF for whoever can view it.
    fetch(`/api/newsletter/issues/${draft.id}/pdf?lang=${lang}`, { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } })
      .then(r => r.blob())
      .then(b => window.open(URL.createObjectURL(b), '_blank', 'noopener'))
      .catch(() => setError('Could not open the PDF.'));
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-[70] flex items-start justify-center overflow-y-auto sm:p-4">
      <div className="bg-gray-50 w-full max-w-3xl min-h-full sm:min-h-0 sm:rounded-2xl sm:shadow-xl sm:my-6 pb-20 sm:pb-0">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-gray-200 bg-white sm:rounded-t-2xl sticky top-0 z-10">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">
              {tr(shared ? 'Shared newsletter' : 'Newsletter preview')}
            </h3>
            <p className="text-[11px] text-gray-400">
              {shared ? `${tr('Shared by')} ${draft.shared_by} · ${(draft.shared_at || '').slice(0, 10)}`
                : reading ? tr('Reading in Spanish. Switch to EN to make changes.')
                : tr('Edit anything before it goes out.')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* The preview covers the page, so it carries its own toggle —
                otherwise "switch to EN to edit" would be impossible to act on. */}
            {setLang && <LangToggle lang={lang} setLang={setLang} translating={translating} />}
            <button onClick={openPdf} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
              <FileText size={13} /> PDF
            </button>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        <div className="p-3 sm:p-5 space-y-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {reading && !shared && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              {tr('Reading in Spanish. The PDF and Share will use Spanish too. Switch to EN to edit.')}
            </p>
          )}

          {/* The header image sits above the title, the way it reads when sent. */}
          <NewsletterBanner
            value={draft} disabled={locked} tr={tr}
            uploading={uploadingFor === '__banner__'}
            onUpload={(files) => attachBannerImage(files)}
            onChange={(patch) => setDraft(d => ({ ...d, ...patch }))} />

          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
            <input value={reading ? tr(draft.title) : draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} disabled={locked}
              className="w-full text-xl font-bold text-gray-900 border-0 border-b border-transparent focus:border-gray-200 focus:outline-none disabled:bg-transparent" />
            <textarea value={reading ? tr(draft.intro || '') : (draft.intro || '')} onChange={e => setDraft({ ...draft, intro: e.target.value })} disabled={locked}
              rows={2} placeholder={tr('A short intro (optional)')}
              className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 disabled:bg-transparent disabled:border-transparent" />
          </div>

          {draft.sections.map((s, i) => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="flex items-start gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 mt-1 ${kindMeta(s.kind).tone}`}>{tr(kindMeta(s.kind).label)}</span>
                <input value={reading ? tr(s.title) : s.title} onChange={e => setSection(s.id, { title: e.target.value })} disabled={locked}
                  className="flex-1 font-semibold text-gray-900 border-0 border-b border-transparent focus:border-gray-200 focus:outline-none disabled:bg-transparent" />
                {!locked && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => moveSection(s.id, -1)} disabled={i === 0} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button onClick={() => moveSection(s.id, 1)} disabled={i === draft.sections.length - 1} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button onClick={() => removeSection(s.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <textarea value={reading ? tr(s.body || '') : (s.body || '')} onChange={e => setSection(s.id, { body: e.target.value })} disabled={locked} rows={3}
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 disabled:bg-transparent disabled:border-transparent" />
              {s.image_url && <img src={s.image_url} alt="" className="rounded-lg max-h-56 object-contain" />}
              {!locked && canEdit && (
                <div>
                  <input ref={s.id === uploadingFor ? fileRef : null} type="file" accept="image/*" className="hidden"
                    id={`img-${s.id}`} onChange={e => attachImage(s.id, e.target.files)} />
                  <label htmlFor={`img-${s.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-medium cursor-pointer hover:bg-gray-200">
                    <ImageIcon size={13} /> {uploadingFor === s.id ? tr('Uploading…') : (s.image_id ? tr('Replace image') : tr('Add an image'))}
                  </label>
                </div>
              )}
            </div>
          ))}

          {!locked && canEdit && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <label className="block text-xs font-medium text-gray-700">{tr('Message to post with it')}</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={2}
                placeholder={tr('e.g. July newsletter is here — big month for the sticks line 🎉')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={share} disabled={sharing}
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50">
                  <Send size={14} /> {sharing ? tr('Sharing…') : tr('Share to #announcements')}
                </button>
                <button onClick={save} disabled={saving}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
                  {saving ? tr('Saving…') : tr('Save draft')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The page's own labels. Card and newsletter text is added to these at render
// time, so one toggle translates the chrome and the document together.
const PAGE_STRINGS = [
  'Newsletter', 'Notes', 'Newsletters', 'Add a card', 'Build newsletter', 'Building…',
  'Collect news through the month, then send it out in one go.', 'Open', 'Draft', 'Shared',
  'Upcoming event', 'Shout-out', 'Big news', 'Stats', 'General', 'Hold', 'Include', 'Edit',
  'Newsletter preview', 'Shared newsletter', 'Edit anything before it goes out.', 'Shared by',
  'Reading in Spanish. Switch to EN to make changes.', 'Message to post with it', 'Save draft',
  'Share to #announcements', 'Sharing…', 'Saving…',
  'Reading in Spanish. The PDF and Share will use Spanish too. Switch to EN to edit.',
  'Add to these through the month.', 'card will go into the next newsletter.',
  'cards will go into the next newsletter.', 'HELD BACK', 'Updated by',
  'No cards yet. Add events, shout-outs and news as they happen.',
  'Nothing built yet — add some notes, then press Build newsletter.',
  'section', 'sections', 'SHARED', 'DRAFT', 'Save', 'Cancel', 'Headline',
  'Details — dates, names, numbers…', 'A short intro (optional)',
  'You are editing the original text (English).',
  'Uploading…', 'Replace image', 'Add an image',
  'e.g. July newsletter is here — big month for the sticks line 🎉',
];

export default function NewsletterPanel() {
  const { user } = useAuth();
  const canEdit = canEditModule(user, 'newsletter');
  const [tab, setTab] = useState('notes');
  const [open, setOpen] = useState(null);
  const [building, setBuilding] = useState(false);

  const { data: cards, refresh: refreshCards } = useApiGet('/newsletter/cards');
  const { data: issues, refresh: refreshIssues } = useApiGet('/newsletter/issues');

  // The toggle covers the whole document, not just the chrome: every card, and
  // every heading and paragraph of whatever newsletter is open, goes through
  // the same translator as the labels.
  const contentStrings = useMemo(() => {
    const out = [...PAGE_STRINGS];
    for (const c of cards || []) { out.push(c.title); if (c.body) out.push(c.body); }
    for (const i of issues || []) out.push(i.title);
    if (open) {
      out.push(open.title);
      if (open.intro) out.push(open.intro);
      for (const s of open.sections || []) { out.push(s.title); if (s.body) out.push(s.body); }
    }
    return out;
  }, [cards, issues, open]);
  const { lang, setLang, tr, translating: pageTranslating } = usePageTranslation(contentStrings);

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
          <h2 className="text-xl font-bold text-gray-900">{tr('Newsletter')}</h2>
          <p className="text-sm text-gray-500">{tr('Collect news through the month, then send it out in one go.')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto max-w-full">
            {[['notes', 'Notes'], ['issues', 'Newsletters']].map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{tr(l)}</button>
            ))}
          </div>
          <LangToggle lang={lang} setLang={setLang} translating={pageTranslating} />
        </div>
      </div>

      {tab === 'notes' && (
        <NotesTab canEdit={canEdit} cards={cards} refresh={refreshCards} onBuild={build} building={building} tr={tr} lang={lang} />
      )}

      {tab === 'issues' && (
        <div className="space-y-2">
          {(issues || []).map(i => (
            <div key={i.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">{tr(i.title)}</p>
                <p className="text-[11px] text-gray-400">
                  {i.status === 'shared'
                    ? `${tr('Shared by')} ${i.shared_by} · ${(i.shared_at || '').slice(0, 10)}`
                    : `${tr('Draft')} · ${i.sections.length} ${i.sections.length === 1 ? tr('section') : tr('sections')}`}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${i.status === 'shared' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {i.status === 'shared' ? tr('SHARED') : tr('DRAFT')}
              </span>
              <button onClick={() => openIssue(i)}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200">
                <Eye size={13} /> {tr('Open')}
              </button>
            </div>
          ))}
          {(issues || []).length === 0 && (
            <p className="text-center py-10 text-sm text-gray-400">{tr('Nothing built yet — add some notes, then press Build newsletter.')}</p>
          )}
        </div>
      )}

      {open && (
        <IssueEditor issue={open} canEdit={canEdit} onClose={() => setOpen(null)}
          tr={tr} lang={lang} setLang={setLang} translating={pageTranslating}
          onChanged={(saved) => {
            refreshIssues(); refreshCards();
            // Keep the open issue current so a switch to ES translates what was
            // just written, not the text it replaced.
            if (saved) setOpen(saved);
          }} />
      )}
    </div>
  );
}
