import { useState } from 'react';
import { useApiGet, apiPost, apiUpload } from '../../hooks/useApi';
import { FileUp, Check, SkipForward, Loader2, AlertTriangle, FileQuestion } from 'lucide-react';

// Document Control's worklist.
//
// The revision upload already reads a finalised document, works out which
// registry row it is and proposes a field-by-field change with nothing applied
// until it is ticked. What it could not do is REMEMBER: it is a modal, so doing
// twenty documents today means working from memory tomorrow about which twenty.
//
// Everything here is that same proposal, kept. Applying goes through the same
// writer the modal has always used. The only new thing is that the job survives
// being put down.

const KIND_LABEL = {
  revision_moved: 'Revision has moved',
  unmatched: 'Matched no document',
  dates_only: 'Effective date',
  title_only: 'Title',
  body_only: 'Body only',
  no_change: 'Matches what is on file',
};
const KIND_TONE = {
  revision_moved: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  unmatched: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  no_change: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

function Item({ item, onDone }) {
  // Everything is ticked to start with, because the upload IS the update — the
  // one people most often turn off is the body, which is frequently a worse
  // copy of what is already keyed in. So it is offered ticked and easy to clear,
  // not decided for them.
  const [picked, setPicked] = useState(() => new Set(item.changes.map(c => c.field)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (f) => setPicked(p => { const n = new Set(p); n.has(f) ? n.delete(f) : n.add(f); return n; });

  const act = async (what) => {
    setBusy(true); setError(null);
    try {
      if (what === 'apply') {
        await apiPost(`/documents/revisions/items/${item.id}/apply`, { fields: [...picked] });
      } else {
        const reason = window.prompt(`Skip ${item.filename}?\n\nThe row stays, with your reason on it.\n\nWhy?`);
        if (!reason) { setBusy(false); return; }
        await apiPost(`/documents/revisions/items/${item.id}/skip`, { reason });
      }
      onDone();
    } catch (e) { setError(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          KIND_TONE[item.kind] || 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'}`}>
          {KIND_LABEL[item.kind] || item.kind}
        </span>
        {item.doc_number
          ? <b className="text-sm">{item.doc_number} · {item.doc_title}</b>
          : <b className="text-sm text-rose-700 dark:text-rose-300">No matching document</b>}
        {item.overdue && (
          <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-3 w-3" /> review was due {item.review_due}
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-slate-400">{item.filename}</span>
      </div>

      {item.document_id ? (
        item.changes.length ? (
          <ul className="mt-2 space-y-1">
            {item.changes.map(c => (
              <li key={c.field} className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={picked.has(c.field)} disabled={busy}
                  onChange={() => toggle(c.field)} className="mt-1 shrink-0" />
                <span>
                  <b>{c.label}</b>{' '}
                  <span className="text-slate-500">{c.from || 'empty'}</span>
                  {' → '}
                  <span className="text-slate-900 dark:text-slate-100">{c.to}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            The upload matches what is on file. Nothing to change — skip it to clear it from the queue.
          </p>
        )
      ) : (
        <p className="mt-2 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <FileQuestion className="mt-0.5 h-4 w-4 shrink-0" />
          {/* Attaching a revision to the wrong document is worse than asking, so
              there is no fuzzy match and no guess offered here. */}
          Nothing in the registry matches this file by document number or exact title.
          Open it, decide which document it is, and apply it from that document — or skip it with a reason.
        </p>
      )}

      {!!(item.warnings || []).length && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
          {item.warnings.map(w => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        {item.document_id && !!item.changes.length && (
          <button type="button" disabled={busy || !picked.size} onClick={() => act('apply')}
            className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Apply {picked.size} change{picked.size === 1 ? '' : 's'}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => act('skip')}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-slate-600">
          <SkipForward className="h-4 w-4" /> Skip
        </button>
      </div>
    </li>
  );
}

export default function DocRevisionWorklist() {
  const { data, refresh } = useApiGet('/documents/revisions/worklist');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  const p = data?.progress;
  const items = data?.items || [];

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true); setError(null); setNote(null); setPct(0);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await apiUpload('/documents/revisions/batch', fd, 'POST', setPct);
      setNote(`${r.filed} file${r.filed === 1 ? '' : 's'} added to the worklist.`
        + (r.unreadable?.length ? ` ${r.unreadable.length} could not be read and were not filed.` : ''));
      refresh();
    } catch (e) { setError(e.message || 'Upload failed'); }
    finally { setBusy(false); setPct(0); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="font-semibold">Revisions to work through</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Drop the finalised documents in. Each one is read, matched to its registry row, and the change is
        proposed for you — <b>nothing is applied until you tick it</b>. The queue keeps its place, so this
        can be picked up over several days.
      </p>

      {p && (
        <p className="mt-2 text-sm">
          <b className="tabular-nums">{p.applied + p.skipped}</b> of <b className="tabular-nums">{p.total}</b> handled
          {p.outstanding ? <> · <b className="tabular-nums">{p.outstanding}</b> left</> : null}
          {p.needs_a_person ? <> · <b className="tabular-nums text-rose-600 dark:text-rose-400">{p.needs_a_person}</b> need a person to say which document</> : null}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white dark:bg-slate-200 dark:text-slate-900">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          Add documents
          <input type="file" multiple disabled={busy} className="hidden"
            accept=".pdf,.doc,.docx,.md,.txt"
            onChange={e => { upload([...e.target.files]); e.target.value = ''; }} />
        </label>
        {busy && pct > 0 && pct < 100 && <span className="text-sm tabular-nums text-slate-500">{pct}%</span>}
      </div>

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      {note && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{note}</p>}

      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map(i => <Item key={i.id} item={i} onDone={refresh} />)}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          {p?.total ? 'Nothing outstanding — every document filed here has been handled.' : 'Nothing filed yet.'}
        </p>
      )}
    </section>
  );
}
