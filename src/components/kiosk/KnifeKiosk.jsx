import { useState, useEffect, useMemo } from 'react';
import { Scissors, CheckCircle, AlertTriangle, Search, ArrowLeft, LogOut, LogIn } from 'lucide-react';

export default function KnifeKiosk() {
  const [knives, setKnives] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('Good');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const load = () => fetch('/api/submit/knife-list').then(r => r.json()).then(setKnives).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return knives;
    return knives.filter(k => String(k.tool_id).toLowerCase().includes(q));
  }, [knives, query]);

  const submit = async () => {
    if (!name.trim()) { setError('Please enter your name.'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/knife', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_id: selected.id, person: name.trim(), condition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => { setSelected(null); setResult(null); setName(''); setCondition('Good'); setError(''); setQuery(''); };

  // Success confirmation
  if (result) {
    const isOut = result.action === 'out';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={64} className={`mx-auto mb-4 ${isOut ? 'text-amber-500' : 'text-green-500'}`} />
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Knife {result.tool_id} {isOut ? 'Checked Out' : 'Checked In'}
          </h1>
          <p className="text-gray-600 mb-1">{isOut ? `Issued to ${name.trim()}` : `Returned by ${name.trim()}`}</p>
          <p className="text-sm text-gray-500 mb-6">Condition recorded: <span className="font-medium">{result.condition}</span></p>
          <button onClick={reset} className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            Done
          </button>
        </div>
      </div>
    );
  }

  // Check-in/out panel for the picked knife
  if (selected) {
    const isIssued = selected.status === 'issued';
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-lg mx-auto">
          <button onClick={() => { setSelected(null); setError(''); }} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
            <ArrowLeft size={16} /> Back to list
          </button>
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5">
            <div className="text-center">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center mx-auto mb-3 ${isIssued ? 'bg-amber-500' : 'bg-green-600'}`}>
                <Scissors size={24} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">{selected.tool_id}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {isIssued
                  ? <>Currently issued to <span className="font-medium text-gray-700">{selected.issued_to || 'someone'}</span></>
                  : 'Available to check out'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Blade Condition</label>
              <div className="grid grid-cols-2 gap-2">
                {['Good', 'Bad'].map(c => (
                  <button key={c} type="button" onClick={() => setCondition(c)}
                    className={`p-3 rounded-xl border-2 font-bold transition-all ${condition === c
                      ? c === 'Bad' ? 'border-red-500 bg-red-50 text-red-700' : 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {c}
                  </button>
                ))}
              </div>
              {condition === 'Bad' && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 mt-2">
                  Flag a supervisor — a damaged blade may need to be decommissioned.
                </p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
                <AlertTriangle size={16} /> {error}
              </div>
            )}

            <button onClick={submit} disabled={saving}
              className={`w-full py-4 rounded-xl text-lg font-bold text-white disabled:opacity-50 transition-colors active:scale-[0.98] flex items-center justify-center gap-2 ${isIssued ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
              {isIssued ? <LogIn size={20} /> : <LogOut size={20} />}
              {saving ? 'Saving…' : isIssued ? 'Check In' : 'Check Out'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Knife roster
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Scissors size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Knife / Blade Sign In/Out</h1>
          <p className="text-sm text-gray-500 mt-1">Tap your knife to check it out or return it</p>
        </div>

        <div className="relative mb-4">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-base"
            placeholder="Search by knife #..." />
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-gray-500 bg-white rounded-2xl border border-gray-200">
              {knives.length === 0 ? 'No knives registered yet.' : `No knives match "${query}"`}
            </div>
          )}
          {filtered.map(k => {
            const issued = k.status === 'issued';
            return (
              <button key={k.id} onClick={() => { setSelected(k); setError(''); }}
                className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-powder-300 hover:bg-powder-50 transition-colors active:scale-[0.99]">
                <div>
                  <span className="block font-bold text-gray-900">{k.tool_id}</span>
                  {issued && <span className="block text-xs text-gray-500">Issued to {k.issued_to || 'someone'}</span>}
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${issued ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                  {issued ? 'Issued' : 'Available'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
