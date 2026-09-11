import { useState } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';
import { Bot, Check, Users, Lock } from 'lucide-react';

/**
 * Who gets each automatic ReadyBot message.
 *
 * The question this answers is "is ReadyBot a channel everybody reads?" — it
 * is not. Every ReadyBot message is a DM between the bot and one person, so
 * two people never see the same conversation. What made it look shared is that
 * several of these go to "all admins" by default, which is what this screen
 * makes visible and, for the two that are a plant decision, changeable.
 *
 * Each audience is resolved SERVER-side by the function that actually sends
 * the message, so this screen cannot describe an audience the sender does not
 * use. An audience that follows a rule (the person who filed it, a department)
 * is shown and named rather than offered as a setting.
 */
function Picker({ people, chosen, onSave, onCancel, busy }) {
  const [ids, setIds] = useState(chosen);
  const [q, setQ] = useState('');
  const shown = people.filter(p => !q.trim() || `${p.name} ${p.department || ''} ${p.role || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => setIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  return (
    <div className="space-y-2" data-audience-picker>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter people"
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" />
      <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
        {shown.map(p => (
          <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} data-audience-person={p.id} />
            <span className="flex-1 truncate text-gray-800">{p.name}</span>
            <span className="text-[10px] uppercase text-gray-400">{p.department || p.role}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onSave(ids)} disabled={busy}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50" data-audience-save>
          {busy ? 'Saving…' : `Save (${ids.length})`}
        </button>
        <button type="button" onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
        <span className="text-[11px] text-gray-500">Choosing nobody puts it back to the default.</span>
      </div>
    </div>
  );
}

export default function NotificationsSection() {
  const { data, refresh } = useApiGet('/flash/readybot-audience');
  const [editing, setEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (key, ids) => {
    setBusy(true); setError('');
    try { await apiPut(`/flash/readybot-audience/${key}`, { ids }); setEditing(''); refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  return (
    <div className="space-y-3" data-readybot-audience>
      <p className="text-sm text-gray-600 bg-powder-50 border border-powder-200 rounded-xl px-3 py-2 flex items-start gap-2">
        <Bot size={15} className="text-powder-600 shrink-0 mt-0.5" />
        <span>
          <b>ReadyBot is not a channel.</b> Every message it sends is a private conversation between the bot and
          one person, so nobody reads anybody else&apos;s. What follows is who each automatic message reaches
          today. Two of them are your decision; the rest follow from what somebody did or from their department.
        </span>
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {(data.audiences || []).map(a => (
        <div key={a.key} className="bg-white border border-gray-200 rounded-xl p-3 space-y-1.5" data-audience={a.key}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{a.label}</p>
            {a.setting
              ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${a.source === 'setting' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
                  {a.source === 'setting' ? 'Chosen' : 'Default'}
                </span>
              : <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 inline-flex items-center gap-1"><Lock size={9} /> By rule</span>}
            {a.setting && editing !== a.setting && (
              <button type="button" onClick={() => setEditing(a.setting)} data-audience-edit={a.key}
                className="ml-auto px-2.5 py-1 border border-gray-300 rounded-lg text-xs hover:bg-gray-50">Change who gets it</button>
            )}
          </div>
          <p className="text-xs text-gray-600">{a.what}</p>
          <p className="text-[11px] text-gray-500">{a.when}</p>
          <p className="text-xs text-gray-800 flex items-start gap-1.5">
            <Users size={12} className="text-gray-400 shrink-0 mt-0.5" />
            {a.recipients.length
              ? <span data-audience-people>{a.recipients.map(r => r.name).join(', ')}</span>
              : <span className="text-gray-500">{a.note || 'Nobody on a fixed list — it reaches the person it is about.'}</span>}
          </p>
          {a.recipients.length > 0 && a.note && <p className="text-[11px] text-amber-800">{a.note}</p>}
          {a.setting && editing === a.setting && (
            <Picker people={data.people || []} chosen={a.source === 'setting' ? a.recipients.map(r => r.id) : []}
              busy={busy} onCancel={() => setEditing('')} onSave={(ids) => save(a.setting, ids)} />
          )}
        </div>
      ))}
      <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
        <Check size={12} className="shrink-0 mt-0.5" />
        A message that reaches the person it is about — the reviewer asked for an evaluation, the employee sent a
        document, the filer QA asked for a correction — has no list to set. Narrowing those would mean somebody
        not being told about their own work.
      </p>
    </div>
  );
}
