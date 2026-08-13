import { useState } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import QuickBooksSetupCard from '../compliance/QuickBooksSetupCard.jsx';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Copy, Check } from 'lucide-react';

/**
 * What is switched on, and what is missing to switch on the rest.
 *
 * Everything optional in ReadyDoc degrades gracefully, which is right and has
 * one cost: a feature that is OFF looks exactly like a feature that is BROKEN.
 * The paperclip simply isn't there; translation quietly stays English. This is
 * the page that says which it is.
 *
 * Nothing here shows a secret. The variable NAMES are already in the repo and
 * are what somebody needs in order to fix this; the values are the whole point
 * of a secret and the server never sends them.
 */
export default function IntegrationsSection() {
  const { data, loading, refetch } = useApiGet('/integrations');

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Connected services</h3>
        <p className="text-sm text-gray-600 max-w-2xl">
          Each of these is optional and ReadyDoc works without it — but a feature that is switched off looks
          the same as one that is broken, so this is where to check. Set the variables on the host (Railway →
          Variables) and restart; nothing here is configured from inside the app.
        </p>
      </div>

      {loading && <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking…</p>}

      {data && (
        <>
          <p className="text-xs text-gray-500">
            {data.counts.on} of {data.counts.total} connected.
          </p>
          <div className="space-y-2.5">
            {data.services.map(s => <Service key={s.id} s={s} onRetest={refetch} />)}
          </div>
        </>
      )}

      <div className="pt-2 border-t border-gray-200">
        <QuickBooksSetupCard />
      </div>
    </div>
  );
}

function Service({ s, onRetest }) {
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setBusy(true); setTest(null);
    try { setTest(await apiFetch('/integrations/storage/test', { method: 'POST' })); }
    catch (e) { setTest({ ok: false, step: 'request', error: e.message }); }
    finally { setBusy(false); onRetest?.(); }
  };

  return (
    <div className={`rounded-xl border p-3 ${s.enabled ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-start gap-2.5">
        {s.enabled
          ? <CheckCircle2 size={17} className="text-green-600 shrink-0 mt-0.5" />
          : <Circle size={17} className="text-gray-300 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-gray-900">{s.label}</h4>
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${s.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
              {s.enabled ? 'connected' : 'not configured'}
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5">{s.what}</p>

          {/* What is actually lost while it is off — so somebody can decide
              whether it matters, rather than treating every gap as urgent. */}
          {!s.enabled && s.off && (
            <p className="text-xs text-gray-500 mt-1"><span className="font-medium">While it is off:</span> {s.off}</p>
          )}

          {s.note && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 mt-1.5 flex gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{s.note}</span>
            </p>
          )}

          <VarList required={s.required} optional={s.optional} />

          {s.testable && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button type="button" onClick={runTest} disabled={busy}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {busy ? 'Testing…' : 'Test the connection'}
              </button>
              {/* Set is not the same as works: a revoked token or a bucket that
                  doesn't exist looks identical to a correct setup until
                  something is actually written. */}
              <span className="text-[11px] text-gray-400">Writes a small file, reads it back, deletes it.</span>
            </div>
          )}
          {test && <TestResult test={test} />}
        </div>
      </div>
    </div>
  );
}

function VarList({ required, optional }) {
  const all = [...required.map(v => ({ ...v, req: true })), ...optional.map(v => ({ ...v, req: false }))];
  if (!all.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {all.map(v => <VarChip key={v.name} v={v} />)}
    </div>
  );
}

function VarChip({ v }) {
  const [copied, setCopied] = useState(false);
  // The name is what somebody needs to paste into the host's variable editor,
  // and typing an underscore-heavy constant by hand is how a typo gets made.
  const copy = async () => {
    try { await navigator.clipboard.writeText(v.name); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* no clipboard */ }
  };
  const tone = v.set ? 'bg-green-100 text-green-900 border-green-200'
    : v.req ? 'bg-red-50 text-red-800 border-red-200'
      : 'bg-gray-50 text-gray-500 border-gray-200';
  return (
    <button type="button" onClick={copy} title={v.req ? 'Required' : 'Optional'}
      className={`inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded border ${tone} hover:opacity-80`}>
      {copied ? <Check size={10} /> : <Copy size={10} className="opacity-40" />}
      {v.name}
      {!v.set && !v.req && <span className="font-sans opacity-60">· optional</span>}
    </button>
  );
}

function TestResult({ test }) {
  if (test.ok) {
    return (
      <p className="mt-1.5 text-xs text-green-800 bg-green-50 rounded px-2 py-1.5">
        Wrote a file, read it back and deleted it in {test.ms}ms. Storage is working.
        {/* A bucket you can write to but not clean up is a real thing to know. */}
        {!test.cleaned && <span className="block text-amber-800 mt-0.5">
          The test file could not be deleted ({test.cleanup_error}) — the API token may be missing delete
          permission, which will leave orphaned objects behind when records are removed.
        </span>}
      </p>
    );
  }
  const where = { configure: 'Not configured', write: 'Could not write', read: 'Could not read back', request: 'The request failed' }[test.step] || 'Failed';
  return (
    <div className="mt-1.5 text-xs text-red-800 bg-red-50 rounded px-2 py-1.5">
      <span className="font-medium">{where}.</span> {test.error}
      {test.missing?.length > 0 && (
        <span className="block mt-0.5">Missing: <span className="font-mono">{test.missing.join(', ')}</span></span>
      )}
    </div>
  );
}
