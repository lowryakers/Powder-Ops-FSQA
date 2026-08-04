import { useEffect, useState } from 'react';
import { CloudOff, UploadCloud, AlertTriangle, X } from 'lucide-react';
import { onQueueChange, pendingCount, isOnline, discardQueued } from '../../lib/offline';
import { flushOutbox } from '../../hooks/useApi';

// The one place the app tells you where your work is.
//
// Two different facts, and they must not be run together: whether you have a
// connection right now, and whether anything you filled in is still waiting to
// send. Someone can be back online with five things queued, and someone can be
// offline with nothing pending — the second person has lost nothing and should
// not be alarmed.
//
// Anything that fails on replay is listed by name. A queue that silently drops
// a rejected record is worse than no queue: the operator believes it was filed.

export default function OfflineBar() {
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const [failed, setFailed] = useState([]);

  useEffect(() => {
    pendingCount().then(setPending).catch(() => {});
    const off = onQueueChange((s) => {
      setPending(s.pending ?? 0);
      setFlushing(!!s.flushing);
      if (s.failed?.length) setFailed(f => [...f, ...s.failed]);
    });
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { off(); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  if (online && !pending && !failed.length) return null;

  return (
    <div className="sticky top-0 z-40 space-y-px">
      {!online && (
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-xs">
          <CloudOff size={14} className="shrink-0" />
          <span>
            <span className="font-semibold">No connection.</span> You can keep filling forms — they save on this
            device and send themselves when you&apos;re back. Signing anything off needs a connection.
          </span>
        </div>
      )}
      {pending > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-900 text-xs">
          <UploadCloud size={14} className={`shrink-0 ${flushing ? 'animate-pulse' : ''}`} />
          <span>
            <span className="font-semibold">{pending}</span> {pending === 1 ? 'entry is' : 'entries are'} waiting to send
            {flushing ? ' — sending now…' : online ? '.' : ' once you\'re back online.'}
          </span>
          {online && !flushing && (
            <button onClick={() => flushOutbox()} className="ml-auto font-semibold underline">Send now</button>
          )}
        </div>
      )}
      {failed.map((f, i) => (
        <div key={i} className="flex items-start gap-2 px-4 py-2 bg-red-100 text-red-900 text-xs">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">Not filed:</span> {f.label} — {f.error}. It was saved on this device
            at {String(f.queued_at).slice(0, 16).replace('T', ' ')}; open the form and enter it again.
          </span>
          <button onClick={() => { discardQueued(f.id); setFailed(list => list.filter((_, j) => j !== i)); }}
            className="ml-auto shrink-0 hover:text-red-700"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}
