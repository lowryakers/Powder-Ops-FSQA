import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { ClipboardList, Plus, CheckCircle, Filter, Package, Hash, Clock, AlertCircle, X, ChevronUp, ChevronDown } from 'lucide-react';

const TEAMS = ['Batching', 'Stick Pack', 'Hand Fill', 'Kitting', 'Quality', 'Warehouse', 'Sanitation', 'Other'];
const ROOMS = ['Batching 1', 'Batching 2', ...Array.from({ length: 16 }, (_, i) => String(i)), 'Other'];

function formatDate(d) {
  return new Date(d).toLocaleDateString();
}

function formatTime(t) {
  if (!t) return '';
  // Handle both "HH:mm" and full ISO strings
  if (t.length <= 5) return t;
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

const INITIAL_FORM = {
  date: todayStr(),
  team: '',
  room: '',
  product_name: '',
  mo_number: '',
  lot_number: '',
  start_time: '',
  end_time: '',
  quantity_completed: '',
  people_count: '',
  notes: '',
};

/* ── Entry Form ──────────────────────────────────────────── */

function EntryForm({ user, onSuccess }) {
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await apiPost('/production/entries', {
        ...form,
        quantity_completed: Number(form.quantity_completed),
        people_count: Number(form.people_count),
        submitted_by: user.name,
      });
      setMessage({ type: 'success', text: 'Entry submitted successfully.' });
      setForm({ ...INITIAL_FORM, date: todayStr() });
      onSuccess?.();
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to submit entry.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <Plus size={16} /> New Production Entry
      </h3>

      {message && (
        <div className={`px-3 py-2 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Today's Date *</label>
          <input required type="date" value={form.date} onChange={e => set('date', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Team *</label>
          <select required value={form.team} onChange={e => set('team', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select team...</option>
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Room *</label>
          <select required value={form.room} onChange={e => set('room', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select room...</option>
            {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Product Name *</label>
          <input required value={form.product_name} onChange={e => set('product_name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Product name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">MO # *</label>
          <input required value={form.mo_number} onChange={e => set('mo_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Manufacturing order #" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lot # *</label>
          <input required value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Lot number" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Project Start Time *</label>
          <input required type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Project End Time *</label>
          <input required type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity Completed *</label>
          <input required type="number" min="0" value={form.quantity_completed} onChange={e => set('quantity_completed', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="0" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1"># of People Working *</label>
          <input required type="number" min="1" value={form.people_count} onChange={e => set('people_count', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="1" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes / Observations</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Optional notes..." />
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Submitting...' : 'Submit Entry'}
        </button>
      </div>
    </form>
  );
}

/* ── QA Signoff Modal ────────────────────────────────────── */

function QASignoffModal({ entry, user, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/production/entries/${entry.id}/qa-signoff`, {
        qa_signoff_by: user.name,
        qa_notes: notes,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || 'Signoff failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">QA Signoff</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600">
          Signing off on <span className="font-medium">{entry.product_name}</span> &mdash; MO #{entry.mo_number}
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">QA Reviewer</label>
          <input readOnly value={user.name} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">QA Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Optional QA notes..." />
        </div>
        {error && <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Signing...' : 'Sign Off'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Summary KPI Cards ───────────────────────────────────── */

function SummaryCards({ from, to }) {
  const { data } = useApiGet(`/production/entries/summary?from=${from}&to=${to}`, [from, to]);

  const cards = [
    { label: 'Total Entries', value: data?.total_entries ?? '--', icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'Total Output', value: data?.total_quantity != null ? Number(data.total_quantity).toLocaleString() : '--', icon: Package, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Active MOs', value: data?.unique_mos ?? '--', icon: Hash, color: 'text-purple-600 bg-purple-50' },
    { label: 'Pending QA', value: data?.entries_pending_qa ?? '--', icon: AlertCircle, color: 'text-amber-600 bg-amber-50' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-500">{c.label}</span>
            <div className={`p-2 rounded-lg ${c.color}`}><c.icon size={18} /></div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Production Log Table ────────────────────────────────── */

const SORT_COLUMNS = [
  { label: 'Date', key: 'date', type: 'date' },
  { label: 'Team', key: 'team', type: 'string' },
  { label: 'Room', key: 'room', type: 'string' },
  { label: 'Product', key: 'product_name', type: 'string' },
  { label: 'MO #', key: 'mo_number', type: 'string' },
  { label: 'Lot #', key: 'lot_number', type: 'string' },
  { label: 'Start', key: 'start_time', type: 'string' },
  { label: 'End', key: 'end_time', type: 'string' },
  { label: 'Duration', key: 'duration_hours', type: 'number' },
  { label: 'Qty', key: 'quantity_completed', type: 'number' },
  { label: 'People', key: 'people_count', type: 'number' },
  { label: 'Units/Hr', key: 'units_per_hour', type: 'number' },
  { label: 'Units/Min/Person', key: 'units_per_min_per_person', type: 'number' },
  { label: 'QA Status', key: 'qa_signoff_by', type: 'boolean' },
];

function LogTable({ user }) {
  const [from, setFrom] = useState(thirtyDaysAgo());
  const [to, setTo] = useState(todayStr());
  const [teamFilter, setTeamFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [moSearch, setMoSearch] = useState('');
  const [signoffEntry, setSignoffEntry] = useState(null);
  const [expandedNotes, setExpandedNotes] = useState(null);
  const [sortCol, setSortCol] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  const { data: entries, loading, error, refresh } = useApiGet(
    `/production/entries?from=${from}&to=${to}`, [from, to]
  );

  const canSignoff = user.department === 'qa' || user.role === 'admin';

  const filtered = useMemo(() => {
    if (!entries) return [];
    let rows = Array.isArray(entries) ? entries : entries.data || [];
    if (teamFilter) rows = rows.filter(r => r.team === teamFilter);
    if (roomFilter) rows = rows.filter(r => r.room === roomFilter);
    if (moSearch) rows = rows.filter(r => (r.mo_number || '').toLowerCase().includes(moSearch.toLowerCase()));

    const col = SORT_COLUMNS.find(c => c.key === sortCol);
    const dir = sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (col?.type === 'date') {
        cmp = new Date(a[sortCol]) - new Date(b[sortCol]);
      } else if (col?.type === 'number') {
        cmp = (Number(a[sortCol]) || 0) - (Number(b[sortCol]) || 0);
      } else if (col?.type === 'boolean') {
        cmp = (a[sortCol] ? 1 : 0) - (b[sortCol] ? 1 : 0);
      } else {
        cmp = (a[sortCol] || '').toString().toLowerCase().localeCompare((b[sortCol] || '').toString().toLowerCase());
      }
      return cmp * dir;
    });
    return rows;
  }, [entries, teamFilter, roomFilter, moSearch, sortCol, sortDir]);

  return (
    <div className="space-y-4">
      <SummaryCards from={from} to={to} />

      {/* Filter Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Team</label>
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Teams</option>
              {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Room</label>
            <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">All Rooms</option>
              {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">MO # Search</label>
            <input value={moSearch} onChange={e => setMoSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Search MO #..." />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading && <div className="text-center py-8 text-gray-500 text-sm">Loading entries...</div>}
      {error && <div className="text-center py-8 text-red-600 text-sm">{error}</div>}

      {!loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {SORT_COLUMNS.map(col => (
                    <th key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-gray-900 hover:bg-gray-100 transition-colors">
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortCol === col.key && (
                          sortDir === 'asc' ? <ChevronUp size={14} className="text-blue-600" /> : <ChevronDown size={14} className="text-blue-600" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.length === 0 && (
                  <tr><td colSpan={14} className="px-3 py-8 text-center text-sm text-gray-500">No entries found.</td></tr>
                )}
                {filtered.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{formatDate(entry.date)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.team}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.room}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 max-w-[160px] truncate relative group">
                      {entry.product_name}
                      {entry.notes && (
                        <button type="button" onClick={() => setExpandedNotes(expandedNotes === entry.id ? null : entry.id)}
                          className="ml-1 text-gray-400 hover:text-gray-600" title="View notes">
                          <ClipboardList size={13} className="inline" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.mo_number}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.lot_number}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatTime(entry.start_time)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{formatTime(entry.end_time)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.duration_hours != null ? Number(entry.duration_hours).toFixed(1) + 'h' : '--'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{Number(entry.quantity_completed).toLocaleString()}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.people_count}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.units_per_hour != null ? Number(entry.units_per_hour).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '--'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{entry.units_per_min_per_person != null ? Number(entry.units_per_min_per_person).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '--'}</td>
                    <td className="px-3 py-2 text-sm whitespace-nowrap">
                      {entry.qa_signoff_by ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle size={12} /> Signed Off
                          <span className="text-green-600 font-normal">({entry.qa_signoff_by})</span>
                        </span>
                      ) : canSignoff ? (
                        <button type="button" onClick={() => setSignoffEntry(entry)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-200 cursor-pointer">
                          <Clock size={12} /> Pending QA
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <Clock size={12} /> Pending QA
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.map(entry => expandedNotes === entry.id && entry.notes && (
                  <tr key={`notes-${entry.id}`} className="bg-blue-50">
                    <td colSpan={14} className="px-4 py-2 text-sm text-gray-700">
                      <span className="font-medium text-gray-900">Notes:</span> {entry.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {signoffEntry && (
        <QASignoffModal entry={signoffEntry} user={user} onClose={() => setSignoffEntry(null)} onSaved={refresh} />
      )}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */

export default function ProductionLog({ user, directEntry }) {
  const [tab, setTab] = useState('form');
  const [refreshKey, setRefreshKey] = useState(0);

  if (directEntry) {
    return <EntryForm user={user} onSuccess={() => setRefreshKey(k => k + 1)} />;
  }

  const tabs = [
    { id: 'form', label: 'Entry Form', icon: Plus },
    { id: 'log', label: 'Production Log', icon: ClipboardList },
  ];

  return (
    <div className="space-y-4">
      {/* Tab Bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}>
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'form' && (
        <EntryForm user={user} onSuccess={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === 'log' && (
        <LogTable key={refreshKey} user={user} />
      )}
    </div>
  );
}
