import { useState, useMemo } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { X, Send, Users, Bell, Ban, CheckCircle2 } from 'lucide-react';

/**
 * The office's half of a policy acknowledgement (D-169): send published
 * policies to people — one by one, by department or role, or everyone — and
 * see who has read and acknowledged which version.
 *
 * The audience shown here is a PREVIEW; the server resolves it again from the
 * same rule (active employees only), so a guest client or an auditor pass can
 * never be reached by ticking "everyone".
 */
const STATE = {
  acknowledged: ['Acknowledged', 'bg-green-100 text-green-800'],
  pending: ['Waiting', 'bg-amber-100 text-amber-800'],
  overdue: ['Overdue', 'bg-red-100 text-red-800'],
  earlier_version: ['Acknowledged an earlier version', 'bg-gray-100 text-gray-700'],
  cancelled: ['Withdrawn', 'bg-gray-100 text-gray-500'],
};

const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function AckChip({ acks }) {
  if (!acks?.sent) return null;
  const waiting = acks.pending + acks.overdue;
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${acks.overdue ? 'bg-red-50 text-red-700' : waiting ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}
      data-ack-chip={`${acks.acknowledged}/${acks.sent}`}>
      {acks.acknowledged} of {acks.sent} acknowledged{acks.overdue ? ` · ${acks.overdue} overdue` : ''}
    </span>
  );
}

export function SendAckModal({ initialPolicyIds = [], onClose, onSent }) {
  const { data: policyList } = useApiGet('/policies?status=published');
  const { data: aud } = useApiGet('/policies/acknowledgements/people');
  const [policySel, setPolicySel] = useState(() => Object.fromEntries(initialPolicyIds.map(id => [id, true])));
  const [everyone, setEveryone] = useState(false);
  const [depts, setDepts] = useState({});
  const [roles, setRoles] = useState({});
  const [picked, setPicked] = useState({});
  const [search, setSearch] = useState('');
  const [due, setDue] = useState(plusDays(14));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const people = useMemo(() => aud?.people || [], [aud]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? people.filter(p => `${p.name} ${p.department || ''}`.toLowerCase().includes(q)) : people;
  }, [people, search]);
  const chosenPolicies = (policyList || []).filter(p => policySel[p.id]);
  const deptOn = Object.keys(depts).filter(k => depts[k]);
  const roleOn = Object.keys(roles).filter(k => roles[k]);
  const userIds = Object.keys(picked).filter(k => picked[k]);
  const reach = useMemo(() => {
    const d = new Set(deptOn.map(x => x.toLowerCase())); const r = new Set(roleOn.map(x => x.toLowerCase()));
    return people.filter(p => everyone || d.has(String(p.department || '').toLowerCase()) || r.has(String(p.role || '').toLowerCase()) || picked[p.id]).length;
  }, [people, everyone, deptOn, roleOn, picked]);

  const send = async () => {
    if (!chosenPolicies.length) { setError('Pick at least one policy.'); return; }
    if (!reach) { setError('Pick who it goes to.'); return; }
    setBusy(true); setError('');
    try {
      const r = await apiPost('/policies/acknowledgements/send', {
        policy_ids: chosenPolicies.map(p => p.id), everyone, departments: deptOn, roles: roleOn, user_ids: userIds,
        due_date: due || null, note: note.trim() || null,
      });
      setResult(r); onSent?.(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const chip = (on) => `px-2.5 py-1 rounded-full border text-xs font-medium ${on ? 'border-powder-500 bg-powder-50 text-powder-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`;

  return (
    <div className="fixed inset-0 bg-black/40 z-[75] flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[92vh] flex flex-col" data-send-ack-modal>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Send size={16} className="text-powder-600" /> Send to read and acknowledge</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {result ? (
          <div className="p-4 space-y-3 overflow-y-auto text-sm" data-send-ack-result={result.created.length}>
            <p className="font-semibold text-green-800 flex items-center gap-1.5">
              <CheckCircle2 size={16} /> Sent to {result.people_sent} {result.people_sent === 1 ? 'person' : 'people'}
              {' '}— {result.policies.length} {result.policies.length === 1 ? 'policy' : 'policies'}, {result.created.length} to acknowledge.
            </p>
            <p className="text-xs text-gray-600">
              Each person has a message and the policy is on their "Documents to sign" card{result.due_date ? `, due ${formatDate(result.due_date)}` : ''}.
              Anyone still waiting after two days is reminded every other day.
            </p>
            {!!result.skipped?.length && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-1" data-send-ack-skipped={result.skipped.length}>
                <p className="text-xs font-semibold text-amber-900">Not sent again:</p>
                {Object.entries(result.skipped.reduce((m, x) => { const k = `${x.policy} · ${x.why}`; (m[k] = m[k] || []).push(x.name); return m; }, {}))
                  .map(([k, names]) => <p key={k} className="text-xs text-amber-900"><span className="font-medium">{k}</span> — {names.join(', ')}</p>)}
              </div>
            )}
            {!!result.rejected?.length && (
              <p className="text-xs text-red-700">{result.rejected.map(r => `${r.name}: ${r.why}`).join('; ')}</p>
            )}
            {!!result.unavailable?.length && (
              <p className="text-xs text-red-700">{result.unavailable.map(u => `${u.title || 'A policy'}: ${u.why}`).join('; ')}</p>
            )}
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg">Done</button>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Policies * {chosenPolicies.length > 0 && <span className="font-normal text-gray-500">{chosenPolicies.length} selected</span>}
                </label>
                <div className="border border-gray-200 rounded-lg max-h-36 overflow-y-auto divide-y">
                  {(policyList || []).map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={!!policySel[p.id]} data-send-ack-policy={p.title}
                        onChange={() => setPolicySel(m => ({ ...m, [p.id]: !m[p.id] }))} />
                      <span className="text-gray-800">{p.title}</span>
                      {p.version && <span className="text-[11px] text-gray-400">v{p.version}</span>}
                    </label>
                  ))}
                  {policyList && !policyList.length && <p className="px-3 py-3 text-xs text-gray-400">No published policies. Only a published policy can be sent.</p>}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-700">Who * <span className="font-normal text-gray-500" data-send-ack-reach={reach}>{reach} {reach === 1 ? 'person' : 'people'}</span></label>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setEveryone(v => !v)} className={chip(everyone)} data-send-ack-everyone>
                    <Users size={12} className="inline -mt-0.5 mr-1" />Everyone ({people.length})
                  </button>
                </div>
                {!!aud?.departments?.length && (
                  <div className="flex flex-wrap gap-1.5" data-send-ack-departments>
                    <span className="text-[11px] text-gray-500 self-center mr-1">Department</span>
                    {aud.departments.map(d => (
                      <button key={d.value} type="button" onClick={() => setDepts(m => ({ ...m, [d.value]: !m[d.value] }))}
                        className={chip(!!depts[d.value])} data-send-ack-dept={d.value}>{d.value} ({d.count})</button>
                    ))}
                  </div>
                )}
                {!!aud?.roles?.length && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-gray-500 self-center mr-1">Role</span>
                    {aud.roles.map(r => (
                      <button key={r.value} type="button" onClick={() => setRoles(m => ({ ...m, [r.value]: !m[r.value] }))}
                        className={chip(!!roles[r.value])} data-send-ack-role={r.value}>{r.value} ({r.count})</button>
                    ))}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Add people by name…"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
                    <button type="button" onClick={() => setPicked(m => ({ ...m, ...Object.fromEntries(shown.map(p => [p.id, true])) }))}
                      className="text-xs text-powder-700 hover:underline whitespace-nowrap">Tick all shown</button>
                  </div>
                  <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y">
                    {shown.map(p => (
                      <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={!!picked[p.id]} data-send-ack-person={p.name}
                          onChange={() => setPicked(m => ({ ...m, [p.id]: !m[p.id] }))} />
                        <span className="text-gray-800">{p.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{p.department || ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">Active employees only — client guests and auditor passes are never included. Somebody already waiting on a policy, or who has acknowledged this version, is not sent it again.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Acknowledge by</label>
                  <input type="date" value={due} onChange={e => setDue(e.target.value)} data-send-ack-due
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
                  <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. updated PTO rules"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </div>
              {error && <p className="text-sm text-red-700" data-send-ack-error>{error}</p>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={send} disabled={busy} data-send-ack-submit
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
                <Send size={14} /> {busy ? 'Sending…' : `Send to ${reach} ${reach === 1 ? 'person' : 'people'}`}
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Who a policy went to, and where each person is. Inside the policy view. */
export function AckList({ policyId, refreshKey }) {
  const { data, refresh } = useApiGet(`/policies/${policyId}/acknowledgements`, [policyId, refreshKey]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState('open');
  if (!data) return null;
  if (!data.rows.length) return <p className="text-xs text-gray-400" data-ack-list="0">Not sent to anyone yet.</p>;

  const act = async (id, fn) => {
    setBusy(id); setError('');
    try { await fn(); refresh(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const c = data.counts;
  const rows = data.rows.filter(r => show === 'all' || r.state !== 'cancelled');
  return (
    <div className="space-y-2" data-ack-list={data.rows.length}>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold text-gray-700">Acknowledgements</span>
        <span className="text-green-700" data-ack-count-acknowledged={c.acknowledged}>{c.acknowledged} acknowledged</span>
        <span className="text-amber-700">{c.pending} waiting</span>
        {!!c.overdue && <span className="text-red-700">{c.overdue} overdue</span>}
        {!!c.earlier_version && <span className="text-gray-600" data-ack-count-earlier={c.earlier_version}>{c.earlier_version} on an earlier version</span>}
        {!!c.cancelled && (
          <button type="button" onClick={() => setShow(s => s === 'all' ? 'open' : 'all')} className="ml-auto text-gray-500 hover:underline">
            {show === 'all' ? 'Hide withdrawn' : `Show ${c.cancelled} withdrawn`}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="border border-gray-200 rounded-lg divide-y max-h-72 overflow-y-auto">
        {rows.map(r => {
          const [label, tone] = STATE[r.state] || [r.state, 'bg-gray-100 text-gray-600'];
          return (
            <div key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm flex-wrap sm:flex-nowrap" data-ack-row={r.name} data-ack-state={r.state}>
              <div className="min-w-0 flex-1">
                <span className="text-gray-900">{r.name}</span>
                {r.department && <span className="text-[11px] text-gray-400 ml-1.5">{r.department}</span>}
                <p className="text-[11px] text-gray-500">
                  {r.acknowledged_at
                    ? `Acknowledged ${formatDateTime(r.acknowledged_at)}${r.ack_version ? ` · v${r.ack_version}` : ''}`
                    : r.status === 'cancelled'
                      ? `Withdrawn ${formatDate(r.cancelled_at)} — ${r.cancelled_reason}`
                      : `Sent ${formatDate(r.sent_at)} by ${r.sent_by || 'the office'}${r.due_date ? ` · due ${formatDate(r.due_date)}` : ''}${r.opened_at ? ' · opened' : ' · not opened yet'}`}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${tone}`}>{label}</span>
              {r.status === 'pending' && (
                <span className="flex gap-1 shrink-0">
                  <button type="button" disabled={busy === r.id} title="Remind" data-ack-remind={r.name}
                    onClick={() => act(r.id, () => apiPost(`/policies/acknowledgements/${r.id}/remind`, {}))}
                    className="p-1 text-gray-400 hover:text-powder-600"><Bell size={14} /></button>
                  <button type="button" disabled={busy === r.id} title="Withdraw" data-ack-cancel={r.name}
                    onClick={() => {
                      const reason = window.prompt(`Withdraw this from ${r.name}? Say why:`);
                      if (reason) act(r.id, () => apiPost(`/policies/acknowledgements/${r.id}/cancel`, { reason }));
                    }}
                    className="p-1 text-gray-400 hover:text-red-600"><Ban size={14} /></button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
