import { useState, useRef, useEffect } from 'react';
import { apiPost } from '../../hooks/useApi';
import { Sparkles, Send, AlertTriangle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

const SUGGESTIONS = [
  'How is production tracking against schedule this week?',
  'What is our task / PM completion rate right now?',
  'How many open CAPAs, deviations, and non-conformances are there?',
  'What is our overall training compliance?',
  'What were the most common actions in the system this week?',
];

// One answered turn in the transcript. Queries are shown collapsed.
function Turn({ turn }) {
  const [showQueries, setShowQueries] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <p className="text-sm font-medium text-gray-500">{turn.question}</p>
      <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">{turn.answer}</p>
      {turn.used?.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <button onClick={() => setShowQueries(v => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            {showQueries ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {turn.used.length} quer{turn.used.length === 1 ? 'y' : 'ies'} used
          </button>
          {showQueries && (
            <div className="mt-2 space-y-1">
              {turn.used.map((q, i) => (
                <pre key={i} className="text-[11px] bg-gray-50 border border-gray-100 rounded-lg p-2 overflow-x-auto text-gray-600">{q}</pre>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="text-[11px] text-gray-400">AI-generated from live data — verify figures before acting on them.</p>
    </div>
  );
}

export default function AiAskPanel() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState([]); // [{ id, question, answer, used }]
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns, loading]);

  const ask = async (q) => {
    const query = (q ?? question).trim();
    if (!query || loading) return;
    setLoading(true); setError(''); setQuestion('');
    try {
      // Each question is answered independently from live data (no chat memory);
      // the transcript is a running record you can scroll back through.
      const res = await apiPost('/ai/ask', { question: query });
      setTurns(t => [...t, { id: Date.now(), question: query, answer: res.answer, used: res.used }]);
    } catch (e) {
      setError(e.message || 'The assistant could not answer that.');
    } finally {
      setLoading(false);
    }
  };

  const newChat = () => { setTurns([]); setError(''); setQuestion(''); };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={22} className="text-violet-600" />
            <h2 className="text-xl font-bold text-gray-900">Ask AI</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">Ask about production, KPIs, compliance, or system activity. Answers are read-only and based on live data.</p>
        </div>
        {turns.length > 0 && (
          <button onClick={newChat} title="Clear the conversation and start fresh"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
            <RotateCcw size={15} /> New chat
          </button>
        )}
      </div>

      <form onSubmit={e => { e.preventDefault(); ask(); }} className="flex items-center gap-2">
        <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g. How is production tracking this week?"
          className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-base" />
        <button type="submit" disabled={loading || !question.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-3 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 disabled:opacity-50">
          <Send size={16} /> {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {turns.length === 0 && !loading && !error && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => ask(s)}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200">{s}</button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {turns.map(t => <Turn key={t.id} turn={t} />)}
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 text-gray-500 text-sm animate-pulse">Querying the system…</div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
