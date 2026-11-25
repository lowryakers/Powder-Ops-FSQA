import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, ChevronRight, ExternalLink, Sparkles, HelpCircle, Scale } from 'lucide-react';
import { HELP_AUDIENCES, guidesFor, newsFor, matchesHelp, openHelpTarget } from '../data/help.js';
import { RULES } from '../lib/platformRules.js';
import { getParam, consumeParam } from '../lib/deepLink.js';

// THE ONE HELP PAGE (D-397): "What's new", "How do I…", and "Why does the app
// do that?". Everything is data (src/data/help.js, src/lib/platformRules.js);
// this file only renders it. `canOpen(tabId)` is App's own nav rule, so a guide
// about a screen somebody cannot open is never shown to them.

function GuideCard({ g, lang, open, onToggle }) {
  const es = lang === 'es' && g.es;
  const q = es ? g.es.q : g.q;
  const steps = es ? g.es.steps : g.steps;
  const ref = useRef(null);
  useEffect(() => { if (open && ref.current?.scrollIntoView) ref.current.scrollIntoView({ block: 'nearest' }); }, [open]);
  return (
    <div ref={ref} data-help-guide={g.id} className="border border-gray-200 rounded-lg bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50 rounded-lg">
        {open ? <ChevronDown size={16} className="mt-0.5 text-gray-400 shrink-0" /> : <ChevronRight size={16} className="mt-0.5 text-gray-400 shrink-0" />}
        <span className="flex-1 text-sm font-medium text-gray-900">{q}</span>
        {g.es && <span className="text-[10px] font-semibold text-gray-400 shrink-0 mt-0.5">EN/ES</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pl-9 space-y-3">
          <ol className="list-decimal pl-4 space-y-1.5 text-sm text-gray-700">
            {steps.map((s, i) => (typeof s === 'string' ? <li key={i}>{s}</li> : (
              <li key={i}><span className="font-medium text-gray-900">{s.title}</span>
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{s.who}</span>
                <span className="block">{s.body}</span></li>
            )))}
          </ol>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            {g.open && (
              <button type="button" onClick={() => openHelpTarget(g.open)} data-help-open={g.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-powder-600 text-white font-medium hover:bg-powder-700">
                <ExternalLink size={12} /> {es ? 'Abrirlo' : 'Open it'}
              </button>
            )}
            {g.sop && <span>Procedure: {g.sop}</span>}
            <span>Checked {g.checked} · kept by {g.owner}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HelpPanel({ canOpen = () => true }) {
  const [q, setQ] = useState('');
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('help_lang') || 'en'; } catch { return 'en'; }
  });
  const [openId, setOpenId] = useState(() => getParam('view'));
  const [showAllNews, setShowAllNews] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(null);

  useEffect(() => { consumeParam('view'); }, []);
  useEffect(() => {
    const h = (e) => { if (e.detail?.id) { setQ(''); setOpenId(e.detail.id); } };
    window.addEventListener('help-open', h);
    return () => window.removeEventListener('help-open', h);
  }, []);
  const pickLang = (l) => { setLang(l); try { localStorage.setItem('help_lang', l); } catch { /* private mode */ } };

  const guides = useMemo(() => guidesFor(canOpen), [canOpen]);
  const news = useMemo(() => newsFor(canOpen), [canOpen]);
  const term = q.trim();
  const shownGuides = guides.filter(g => matchesHelp(g, term));
  const shownNews = news.filter(n => matchesHelp(n, term));
  const rules = Object.entries(RULES).map(([id, r]) => ({ id, ...r }))
    .filter(r => matchesHelp({ q: r.title, body: r.body }, term));
  const groups = Object.entries(HELP_AUDIENCES)
    .map(([key, label]) => ({ key, label, items: shownGuides.filter(g => g.for === key) }))
    .filter(g => g.items.length);
  const newsList = term || showAllNews ? shownNews : shownNews.slice(0, 5);
  const nothing = !shownGuides.length && !shownNews.length && !rules.length;

  return (
    <div className="max-w-3xl space-y-6" data-help-page>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-bold text-gray-900 flex-1">Help</h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1" role="group" aria-label="Language">
            {[['en', 'English'], ['es', 'Español']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => pickLang(v)} data-help-lang={v}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${lang === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{l}</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-powder-300">
          <Search size={16} className="text-gray-400" />
          <input id="help-search" value={q} onChange={e => setQ(e.target.value)} data-help-search
            placeholder={lang === 'es' ? '¿Qué necesita hacer?' : 'What do you need to do?'}
            className="flex-1 text-sm outline-none bg-transparent" />
        </label>
        <p className="text-xs text-gray-500">
          Short how-tos for the screens you can open. A guide explains where the button is; the SOP is still the procedure.
          Something wrong or missing? Say so in Messages and the team that keeps the guide will fix it.
        </p>
      </div>

      {nothing && <div className="text-sm text-gray-500 py-8 text-center">Nothing matches “{term}”. Try fewer words.</div>}

      {shownNews.length > 0 && (
        <section className="space-y-2" data-help-news>
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><Sparkles size={14} /> What’s new</h3>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white">
            {newsList.map(n => (
              <li key={n.d + n.title} className="px-3 py-2.5 flex gap-3" data-help-news-item={n.d}>
                <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0 pt-0.5">{n.date}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{n.title}</div>
                  <div className="text-sm text-gray-600">{n.body}</div>
                </div>
                {n.open && (
                  <button type="button" onClick={() => openHelpTarget(n.open)} className="text-xs text-powder-700 hover:underline shrink-0 pt-0.5">Open</button>
                )}
              </li>
            ))}
          </ul>
          {!term && shownNews.length > 5 && (
            <button type="button" onClick={() => setShowAllNews(s => !s)} className="text-xs text-powder-700 hover:underline">
              {showAllNews ? 'Show less' : `Show all ${shownNews.length}`}
            </button>
          )}
        </section>
      )}

      {groups.length > 0 && (
        <section className="space-y-4" data-help-guides>
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><HelpCircle size={14} /> How do I…</h3>
          {groups.map(gr => (
            <div key={gr.key} className="space-y-1.5">
              <div className="text-xs font-semibold text-gray-700">{gr.label}</div>
              {gr.items.map(g => (
                <GuideCard key={g.id} g={g} lang={lang} open={openId === g.id || (!!term && shownGuides.length <= 2)}
                  onToggle={() => setOpenId(o => (o === g.id ? null : g.id))} />
              ))}
            </div>
          ))}
        </section>
      )}

      {rules.length > 0 && (
        <section className="space-y-2" data-help-rules>
          <button type="button" onClick={() => setRulesOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
            <Scale size={14} /> Why does the app do that? ({rules.length})
            {rulesOpen || term ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {(rulesOpen || term) && (
            <div className="space-y-1.5">
              {rules.map(r => (
                <div key={r.id} className="border border-gray-200 rounded-lg bg-white" data-help-rule={r.id}>
                  <button type="button" onClick={() => setRuleOpen(o => (o === r.id ? null : r.id))}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 rounded-lg">
                    {ruleOpen === r.id ? <ChevronDown size={16} className="mt-0.5 text-gray-400 shrink-0" /> : <ChevronRight size={16} className="mt-0.5 text-gray-400 shrink-0" />}
                    {r.title}
                  </button>
                  {ruleOpen === r.id && <p className="px-3 pb-3 pl-9 text-sm text-gray-600">{r.body}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
