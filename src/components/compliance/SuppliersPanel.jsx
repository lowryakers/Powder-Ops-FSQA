import { useState, useMemo, Fragment, useRef} from 'react';
import { useApiGet, apiPost, apiDelete, apiUpload } from '../../hooks/useApi';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow } from '../common/RowDetail';
import { useCappedList } from '../../lib/useCappedList';
import { useTableSort } from '../../lib/useTableSort';
import { useModuleTabs } from '../../lib/useModuleTabs';
import SortHeader from '../common/SortHeader.jsx';
import ShowMore from '../common/ShowMore.jsx';
import ModuleTabs from '../common/ModuleTabs.jsx';
import TextCell from '../common/TextCell.jsx';
import { formatDate } from '../../lib/datetime';
import { downloadFile } from '../../lib/downloadFile.js';
import {
  Building2, Search, AlertTriangle, Upload, Check, X, ShieldCheck,
  CalendarClock, FileWarning, Link2, Loader2, Trash2,
} from 'lucide-react';

// Supplier and laboratory qualification — SOP 404 V4.
//
// THE SCREEN LEADS WITH ONE DERIVED NUMBER: how many vendors we are actively
// buying from that are not qualified. SOP 404 § V.A says "Components ordered
// for Powder-Ops will be done through qualified vendors ONLY", so that pair is
// a finding — and it is the one thing neither the tracker nor the folders could
// say, because each holds half of it. It is computed on every read and never
// stored; a stored count goes stale the first time somebody files a
// questionnaire.
//
// The number is a BUTTON, not a statistic. "16 buying without qualification" is
// the start of a question, and working out which sixteen by hand is what nobody
// does — the same rule the Team Activity drill-downs and the attention bar
// follow.

const STATUS = {
  unqualified: { label: 'Not qualified', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  approved: { label: 'Approved', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  conditionally_approved: { label: 'Conditionally approved', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  not_approved: { label: 'Not approved', tone: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
  disqualified: { label: 'Disqualified', tone: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
};
const StatusChip = ({ status }) => {
  const s = STATUS[status] || STATUS.unqualified;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>;
};

// Columns as DATA — the header maps over these and useTableSort reads the type
// off them, so a column cannot be sortable in one place and not the other.
const COLUMNS = [
  { key: null, label: '', className: 'w-8' },
  { key: 'name', label: 'Supplier', type: 'text' },
  { key: 'vendor_type', label: 'Type', type: 'text' },
  { key: 'actively_using', label: 'In use', type: 'number' },
  { key: 'status', label: 'Qualification', type: 'text' },
  { key: 'material_count', label: 'Materials', type: 'number' },
  { key: 'file_count', label: 'Files', type: 'number' },
  { key: 'expired_files', label: 'Expired', type: 'number' },
  { key: 'next_expiry', label: 'Next expiry', type: 'date' },
];

function Stat({ value, label, tone = '', onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`rounded-lg border p-3 text-left transition ${
        active ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200 dark:border-slate-700'
      } ${onClick ? 'hover:border-blue-400 cursor-pointer' : ''} bg-white dark:bg-slate-900`}
    >
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </Tag>
  );
}

export default function SuppliersPanel({ user }) {
  const { data, loading, refresh } = useApiGet('/suppliers');
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(null);   // null | 'gap' | 'expired'
  const [decide, setDecide] = useState(null);
  const [queue, setQueue] = useState([]);
  const expand = useRowExpand();

  const { tabs, tab, setTab } = useModuleTabs({
    id: 'suppliers', user,
    tabs: [
      { id: 'register', label: 'Register' },
      { id: 'attention', label: 'Needs attention',
        badge: data?.summary?.buying_without_qualification || undefined, badgeTone: 'alert' },
      { id: 'import', label: 'Import', visible: (u) => u?.role === 'admin' },
    ],
  });

  // Memoised because `data?.suppliers || []` is a new array on every render,
  // which would make the filter below recompute each time.
  const suppliers = useMemo(() => data?.suppliers || [], [data]);
  const summary = data?.summary || {};

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return suppliers.filter(s => {
      if (only === 'gap' && !s.no_questionnaire) return false;
      if (only === 'decide' && !s.awaiting_disposition) return false;
      if (only === 'active' && !s.actively_using) return false;
      if (only === 'expired' && !s.expired_files) return false;
      if (!needle) return true;
      return [s.name, s.vendor_type, ...(s.legacy_names || [])]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(needle));
    });
  }, [suppliers, q, only]);

  // Sort BEFORE the render cap, or only the hundred rows on screen get ordered.
  // useTableSort takes the initial key and direction POSITIONALLY and returns
  // { sorted, sortCol, sortDir, toggleSort } — passing an options object left
  // the table unsorted, and assigning the whole result to `sorted` handed
  // useCappedList an object, whose `.items` is not an array. The register
  // crashed on render; nothing caught it because the dead tab strip meant
  // this pane never mounted.
  const { sorted, sortCol, sortDir, toggleSort } = useTableSort(filtered, COLUMNS, 'name', 'asc');
  const capped = useCappedList(sorted);

  if (loading && !data) {
    return <div className="p-8 text-center text-slate-500"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Building2 className="h-6 w-6 text-slate-500" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Supplier Qualification</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">SOP 404 V4 · FORM 404-1, 404-2</p>
        </div>
      </header>

      <ModuleTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'register' && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={summary.active ?? 0} label="Actively used"
              onClick={() => setOnly(only === 'active' ? null : 'active')} active={only === 'active'} />
            {/* TWO GAPS, NOT ONE. "Awaiting a disposition" is Quality's queue
                and is usually a short job — the evidence is already on file.
                "No questionnaire" is Purchasing's chase list and takes weeks.
                One number covering both tells neither person what to do. */}
            <Stat
              value={summary.awaiting_disposition ?? 0}
              label="Awaiting a disposition"
              tone={summary.awaiting_disposition ? 'text-amber-600 dark:text-amber-400' : ''}
              onClick={summary.awaiting_disposition ? () => setOnly(only === 'decide' ? null : 'decide') : undefined}
              active={only === 'decide'}
            />
            {/* The finding. A button, because "16" is the start of a question. */}
            <Stat
              value={summary.no_questionnaire ?? 0}
              label="No questionnaire document on file"
              tone={summary.no_questionnaire ? 'text-rose-600 dark:text-rose-400' : ''}
              onClick={summary.no_questionnaire ? () => setOnly(only === 'gap' ? null : 'gap') : undefined}
              active={only === 'gap'}
            />
            <Stat
              value={summary.expired_documents ?? 0}
              label="Expired documents"
              tone={summary.expired_documents ? 'text-amber-600 dark:text-amber-400' : ''}
              onClick={summary.expired_documents
                ? () => setOnly(only === 'expired' ? null : 'expired') : undefined}
              active={only === 'expired'}
            />
          </div>

          {only === 'gap' && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <b>SOP 404 § V.A:</b> “Components ordered for Powder-Ops will be done through qualified
                vendors ONLY.” These are actively used and have <b>no questionnaire on file at all</b> —
                the chase list, not the sign-off queue.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search suppliers, including former names…"
                className="w-full rounded border border-slate-300 py-2 pl-8 pr-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </div>
            {(only || q) && (
              <button type="button" onClick={() => { setOnly(null); setQ(''); }}
                className="rounded border border-slate-300 px-2 py-2 text-sm dark:border-slate-600">Clear</button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>{COLUMNS.map((c, i) => (
                  <SortHeader key={c.key || `c${i}`} col={c}
                    sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} className={c.className} />
                ))}</tr>
              </thead>
              <tbody>
                {capped.items.map(s => (
                  <Fragment key={s.id}>
                    <tr {...expand.rowProps(s.id, 'border-t border-slate-100 dark:border-slate-800')}>
                      <td className="px-2 py-2"><ExpandCell open={expand.isExpanded(s.id)} /></td>
                      <td className="px-3 py-2 font-medium">
                        {s.name}
                        {!!(s.legacy_names || []).length && (
                          <span className="ml-1 text-xs font-normal text-slate-400">
                            (also {s.legacy_names.join(', ')})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{s.vendor_type || '—'}</td>
                      <td className="px-3 py-2">{s.actively_using ? <Check className="h-4 w-4 text-emerald-600" /> : ''}</td>
                      <td className="px-3 py-2"><StatusChip status={s.status} /></td>
                      <td className="px-3 py-2 tabular-nums">{s.material_count || '—'}</td>
                      <td className="px-3 py-2 tabular-nums">{s.file_count || '—'}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {s.expired_files
                          ? <span className="font-medium text-rose-600 dark:text-rose-400">{s.expired_files}</span>
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{s.next_expiry ? formatDate(s.next_expiry) : '—'}</td>
                    </tr>
                    {expand.isExpanded(s.id) && (
                      <DetailRow colSpan={COLUMNS.length}>
                        <SupplierDetail id={s.id} user={user} onDecide={() => setDecide(s)} onRemoved={refresh} />
                      </DetailRow>
                    )}
                  </Fragment>
                ))}
                {!capped.items.length && (
                  <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-slate-500">
                    {suppliers.length ? 'No suppliers match.' : 'No suppliers yet — import the tracker and the archive.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <ShowMore view={capped} noun="suppliers" />
        </>
      )}

      {tab === 'attention' && (
        <AttentionTab summary={summary} suppliers={suppliers}
          canDecide={user?.role === 'admin'
            || (['qa', 'quality'].includes((user?.department || '').toLowerCase()) && user?.role === 'supervisor')}
          onWorkQueue={(list) => { if (list.length) { setDecide(list[0]); setQueue(list.slice(1)); } }}
          onPick={(s) => { setTab('register'); setQ(s.name); }} />
      )}
      {tab === 'import' && <><ImportTab onDone={refresh} /><ArchiveStep onDone={refresh} /></>}

      {/* Keyed on the supplier so advancing through the queue REMOUNTS the
          form. Resetting four pieces of state in an effect is the same thing
          done worse, and it leaves a frame where the last supplier's answers
          are on screen against the next supplier's name. */}
      {decide && (
        <DispositionModal
          key={decide.id}
          supplier={decide} data={data} queue={queue}
          onClose={() => { setDecide(null); setQueue([]); refresh(); }}
          onSaved={() => { setDecide(null); setQueue([]); refresh(); }}
          onAdvance={(next, rest) => { setDecide(next); setQueue(rest); }}
        />
      )}
    </div>
  );
}

// ── One supplier, expanded ──────────────────────────────────────────────────

// Attach one or more documents to a single supplier. The server classifies the
// kind and reads an expiry from the FILENAME with the same functions the
// archive walk uses, so a file attached by hand is catalogued exactly as one
// that arrived in the zip — and if the name says nothing it lands as "other",
// visibly, rather than being guessed at.
function AttachSupplierFiles({ supplierId, onDone }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const inputRef = useRef(null);

  const send = async (fileList) => {
    const picked = [...(fileList || [])];
    if (!picked.length) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      for (const f of picked) fd.append('files', f);
      const r = await apiUpload(`/suppliers/${supplierId}/files`, fd, 'POST');
      const n = r?.saved?.length || 0;
      setMsg({ ok: true, text: `${n} document${n === 1 ? '' : 's'} attached.` });
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'Upload failed.' });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {msg.text}
        </span>
      )}
      <input ref={inputRef} type="file" multiple className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
        onChange={e => send(e.target.files)} />
      <button type="button" disabled={busy} onClick={e => { stopRowClick(e); inputRef.current?.click(); }}
        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
        <Upload size={12} /> {busy ? 'Attaching…' : 'Attach documents'}
      </button>
    </div>
  );
}

function SupplierDetail({ id, user, onDecide, onRemoved }) {
  const { data, loading, refresh } = useApiGet(`/suppliers/${id}`);
  if (loading || !data) return <div className="py-4 text-sm text-slate-500">Loading…</div>;
  const { supplier, contacts, materials, qualifications, files } = data;
  const canDecide = user?.role === 'admin'
    || (['qa', 'quality'].includes((user?.department || '').toLowerCase()) && user?.role === 'supervisor');

  return (
    <div className="grid gap-4 py-2 md:grid-cols-2">
      {/* Why the supplier is in the state it is in. A status with no reason
          beside it is the thing somebody has to go and ask about. */}
      {(supplier.status_reason || supplier.notes) && (
        <section className="md:col-span-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
          {supplier.status_reason && (
            <p><b>Disposition note:</b> {supplier.status_reason}
              {supplier.status_set_by && (
                <span className="text-xs text-slate-500"> — {supplier.status_set_by}, {formatDate(supplier.status_set_at)}</span>
              )}
            </p>
          )}
          {supplier.notes && <p className="text-slate-600 dark:text-slate-300">{supplier.notes}</p>}
        </section>
      )}

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Contacts</h4>
        {contacts.length ? (
          <ul className="space-y-0.5 text-sm">
            {contacts.map(c => (
              <li key={c.id} className="flex items-baseline gap-2">
                <span className="truncate">{c.email || c.name}</span>
                {/* No role is shown because none is guessed: only 4 of 179
                    addresses are recognisably quality contacts, so the role is
                    learned from whoever sends FORM 404-1. */}
                {c.role && <span className="text-xs text-slate-400">{c.role}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">None recorded.</p>}
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Materials</h4>
        {materials.length ? (
          <ul className="space-y-0.5 text-sm">
            {materials.map(m => (
              <li key={m.id}>
                {m.item_description}
                {m.manufacturer_name && <span className="text-slate-500"> — made by {m.manufacturer_name}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">None recorded yet.</p>}
      </section>

      <section className="md:col-span-2">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Qualification periods</h4>
        {qualifications.length ? (
          <ul className="space-y-1 text-sm">
            {qualifications.map(qr => (
              <li key={qr.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{qr.period_label || 'Undated'}</span>
                {qr.disposition
                  ? <><StatusChip status={qr.disposition} />
                      <span className="text-xs text-slate-500">
                        {qr.decided_by} · {formatDate(qr.decided_at)}
                      </span></>
                  : <span className="text-xs text-slate-400">No disposition — evidence on file, decision not made</span>}
                {qr.next_review_due && (
                  <span className="text-xs text-slate-500">review due {formatDate(qr.next_review_due)}</span>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">None.</p>}
        {/* Only offered where it can succeed: nothing decided, nothing stored.
            An import that filed under the wrong name is a mistake to undo; a
            supplier Quality has ruled on is retired, never deleted. */}
        {user?.role === 'admin' && !qualifications.length && supplier.status === 'unqualified'
          && !files.some(f => f.stored) && (
          <button type="button"
            onClick={async (e) => {
              stopRowClick(e);
              const reason = window.prompt(
                `Remove "${supplier.name}" from the register?\n\nThis deletes its ${files.length} catalogued document row(s). `
                + 'It is refused if anything has been decided or stored.\n\nWhy?');
              if (!reason) return;
              try {
                await apiDelete(`/suppliers/${supplier.id}`, { reason });
                onRemoved?.();
              } catch (err) { window.alert(err.message || 'Could not remove that supplier'); }
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-rose-300 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40">
            <Trash2 className="h-4 w-4" /> Remove — filed by mistake
          </button>
        )}
        {canDecide && (
          <button type="button" onClick={(e) => { stopRowClick(e); onDecide(); }}
            className="mt-2 inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900">
            <ShieldCheck className="h-4 w-4" /> Record a disposition
          </button>
        )}
      </section>

      <section className="md:col-span-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Documents on file ({files.length})
          </h4>
          {/* THE MANUAL DOOR. POST /suppliers/:id/files has existed since the
              archive import shipped — its own comment says it is for "a vendor
              who emails a questionnaire next week" — and nothing in the client
              ever called it, so the only way a single document reached a
              supplier was inside a zip of the whole Drive. The Import tab is for
              reconciling an archive; one file for one vendor belongs on that
              vendor's record, here, where the person holding the email is
              already looking. */}
          {data.can_edit && <AttachSupplierFiles supplierId={id} onDone={refresh} />}
        </div>
        {files.length ? (
          <div className="max-h-64 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <tbody>
                {files.map(f => (
                  <tr key={f.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-2 py-1 text-slate-500">{f.period_label || '—'}</td>
                    <td className="px-2 py-1 text-slate-500">{f.kind.replace(/_/g, ' ')}</td>
                    <td className="px-2 py-1">
                      {f.stored
                        ? <button type="button" onClick={e => { stopRowClick(e); downloadSupplierFile(f); }}
                            className="text-left text-blue-600 hover:underline dark:text-blue-400">
                            <TextCell value={f.filename} width={340} lines={1} />
                          </button>
                        : <TextCell value={f.filename} width={340} lines={1} />}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-400">
                      {/* Catalogued and stored are different facts. A row that
                          named a document ReadyDoc cannot produce would read
                          exactly like one it can. */}
                      {f.stored ? '' : 'catalogued only'}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {f.expires_on
                        ? <span className={f.expired ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-500'}>
                            {f.expired ? 'expired ' : 'expires '}{formatDate(f.expires_on)}
                          </span>
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-slate-400">None.</p>}
      </section>
    </div>
  );
}

// ── Needs attention ─────────────────────────────────────────────────────────

function AttentionTab({ summary, suppliers, onPick, canDecide, onWorkQueue }) {
  const { data } = useApiGet('/suppliers/documents/expiring?days=120');
  const gaps = suppliers.filter(s => s.buying_without_qualification);
  const withEvidence = gaps.filter(s => s.questionnaire_files);
  const noEvidence = gaps.filter(s => !s.questionnaire_files);
  const expired = data?.expired || [];
  const expiring = data?.expiring || [];

  const Row = ({ children, onClick }) => (
    <li>
      <button type="button" onClick={onClick}
        className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
        {children}
      </button>
    </li>
  );

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          Buying without qualification ({gaps.length})
        </h3>
        <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
          Actively used, with no approved disposition. SOP 404 § V.A permits ordering through qualified
          vendors only, so each of these is either a decision waiting to be made or a supplier to stop
          buying from.
        </p>
        {/* TWO PILES, NOT ONE — the same split the register headline makes.
            One is a decision Quality can take today because the evidence is
            already on file; the other cannot be decided at all until somebody
            asks the supplier for a questionnaire. A single list of 44 tells
            neither person what their next action is. */}
        {!!gaps.length && (
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span>
              <b className="tabular-nums">{withEvidence.length}</b> can be decided now
              {' · '}
              <b className="tabular-nums">{noEvidence.length}</b> have no questionnaire to decide against
            </span>
            {canDecide && !!withEvidence.length && (
              <button type="button" onClick={() => onWorkQueue?.(withEvidence)}
                className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white dark:bg-slate-200 dark:text-slate-900">
                <ShieldCheck className="h-4 w-4" /> Work through the {withEvidence.length} with evidence
              </button>
            )}
          </div>
        )}
        {gaps.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {gaps.map(s => (
              <Row key={s.id} onClick={() => onPick(s)}>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-slate-500">
                  {s.file_count ? `${s.file_count} documents on file` : 'nothing on file'}
                  {s.questionnaire_files ? ' · questionnaire present' : ''}
                </span>
              </Row>
            ))}
          </ul>
        ) : <p className="text-sm text-emerald-700 dark:text-emerald-400">Nothing outstanding.</p>}
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <FileWarning className="h-4 w-4 text-rose-500" /> Expired documents ({expired.length})
        </h3>
        {expired.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {expired.map(f => (
              <Row key={f.id} onClick={() => onPick({ name: f.supplier_name })}>
                <span className="w-24 shrink-0 tabular-nums text-rose-600 dark:text-rose-400">{formatDate(f.expires_on)}</span>
                <span className="font-medium">{f.supplier_name}</span>
                <TextCell value={f.filename} width={380} lines={1} />
              </Row>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">None.</p>}
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <CalendarClock className="h-4 w-4 text-amber-500" /> Expiring within 120 days ({expiring.length})
        </h3>
        {expiring.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {expiring.map(f => (
              <Row key={f.id} onClick={() => onPick({ name: f.supplier_name })}>
                <span className="w-24 shrink-0 tabular-nums text-slate-500">{formatDate(f.expires_on)}</span>
                <span className="font-medium">{f.supplier_name}</span>
                <TextCell value={f.filename} width={380} lines={1} />
              </Row>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-400">None.</p>}
      </section>
      {!!summary.total && (
        <p className="text-xs text-slate-400">
          Every figure here is derived on read — nothing on this screen is a stored count.
        </p>
      )}
    </div>
  );
}

// The download goes through our own origin — a presigned R2 URL is a different
// origin, where the browser ignores `download` and opens a tab instead.
const downloadSupplierFile = (f) => downloadFile(`/suppliers/files/${f.id}/download`, f.filename);

// ── Step two: the documents themselves ──────────────────────────────────────
//
// The import above catalogues WHAT EXISTS. This attaches the bytes, and the
// two are deliberately separate steps: the catalogue is built from a listing
// that takes a second to upload, while the documents are gigabytes and will
// arrive over several sittings.
//
// The property that makes that bearable is that RE-UPLOADING IS SAFE. Anything
// already stored is skipped by name, so a transfer that dies at 60% is
// recovered by doing it again — nobody has to work out what got through.
function ArchiveStep({ onDone }) {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [linked, setLinked] = useState([]);
  const { data: cov, refresh: refreshCov } = useApiGet('/suppliers/files/coverage');

  const review = async () => {
    if (!file) return setError('Attach a .zip of the supplier folders.');
    setBusy(true); setError(null); setPct(0); setStage('Uploading');
    try {
      const fd = new FormData();
      fd.append('files', file);
      const r = await apiUpload('/suppliers/files/archive/analyze', fd, 'POST', setPct);
      setPlan(r.plan); setUploadId(r.upload_id); setDone(null);
      refreshCov();
    } catch (e) { setError(e.message || 'Upload failed'); }
    finally { setBusy(false); setPct(0); setStage(null); }
  };

  // STORING LOOPS, because one request cannot hold hundreds of uploads to
  // object storage — that is minutes of wall time and the proxy closes it,
  // which is the 502. The zip is already held server-side, so each pass sends
  // only its id; a pass that fails loses nothing, because what stored is
  // stored and the next pass skips it.
  const store = async () => {
    if (!uploadId) return setError('Review the zip again — the held upload has expired.');
    setBusy(true); setError(null);
    const tally = { stored: 0, failed: 0, skipped: 0, unmatched: 0, total: 0 };
    try {
      for (let pass = 0; pass < 200; pass++) {
        const fd = new FormData();
        fd.append('upload_id', uploadId);
        const r = await apiUpload('/suppliers/files/archive/commit', fd, 'POST');
        const res = r.result || {};
        tally.stored += res.stored || 0;
        tally.failed += (res.failed || []).length;
        tally.skipped = res.skipped || 0;
        tally.unmatched = res.unmatched || 0;
        tally.total = tally.total || res.total || 0;
        setStage(`Stored ${tally.stored} of ${tally.total || '?'}`);
        setDone({ ...tally });
        refreshCov();
        if (!res.remaining) break;
        // A pass that stored nothing but still reports work left would spin.
        if (!res.stored && (res.failed || []).length === 0) break;
      }
      setPlan(null);
      onDone?.();
    } catch (e) { setError(`${e.message || 'Upload failed'} — press Store again to carry on; nothing already stored is repeated.`); }
    finally { setBusy(false); setStage(null); }
  };

  const off = cov && cov.storage_enabled === false;

  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <h3 className="font-semibold">Attach the documents</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        The step above records that a certificate exists. This puts the file itself behind it, so
        &ldquo;show me the questionnaire&rdquo; ends in a document rather than a filename.
      </p>

      {cov && (
        <p className="mt-2 text-sm">
          <b className="tabular-nums">{cov.stored}</b> of <b className="tabular-nums">{cov.total}</b> catalogued
          documents are stored{cov.total ? ` (${Math.round((cov.stored / cov.total) * 100)}%)` : ''}.
        </p>
      )}

      {off ? (
        <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          File storage is not configured on this server, so documents cannot be attached yet.
          The catalogue still works — this step turns on once storage is set up.
        </p>
      ) : (
        <>
          <input type="file" accept=".zip" disabled={busy}
            onChange={e => { setFile(e.target.files?.[0] || null); setPlan(null); setDone(null); setUploadId(null); }}
            className="mt-3 block w-full text-sm" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !file}
              onClick={review}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Review the zip
            </button>
            {plan && !!plan.counts.store && (
              <button type="button" disabled={busy}
                onClick={store}
                className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                <Upload className="h-4 w-4" /> Store {plan.counts.store} documents
              </button>
            )}
            {busy && (stage || pct > 0) && (
              <span className="text-sm tabular-nums text-slate-500">
                {stage}{stage && pct > 0 && pct < 100 ? ' · ' : ''}{pct > 0 && pct < 100 ? `${pct}%` : ''}
              </span>
            )}
          </div>
        </>
      )}

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

      {plan && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            <b>{plan.counts.store}</b> to store
            {plan.counts.skip ? <> · <b>{plan.counts.skip}</b> skipped</> : null}
            {plan.counts.unmatched ? <> · <b className="text-amber-600">{plan.counts.unmatched}</b> not recognised</> : null}
          </p>
          {/* A folder the register spells differently is not a dead end — name
              the supplier it probably belongs to and offer the one act that
              fixes it. Linking is deliberate and audited; nothing is attached
              on a fuzzy match. */}
          {!!(plan.suggestions || []).filter(g => g.supplier_id).length && (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/30">
              <p className="text-blue-900 dark:text-blue-200">
                Some folders are named differently on the register. Link the name and review again —
                nothing is attached on a guess.
              </p>
              <ul className="mt-2 space-y-1">
                {plan.suggestions.filter(g => g.supplier_id).map(g => (
                  <li key={g.folder} className="flex flex-wrap items-center gap-2 text-xs">
                    <code className="rounded bg-white px-1 dark:bg-slate-900">{g.folder}</code>
                    <span className="text-slate-500">{g.files} files → probably</span>
                    <b>{g.supplier_name}</b>
                    <button type="button" disabled={busy || linked.includes(g.folder)}
                      onClick={async () => {
                        try {
                          await apiPost(`/suppliers/${g.supplier_id}/link-name`, { name: g.folder });
                          setLinked(l => [...l, g.folder]);
                        } catch (e) { setError(e.message || 'Could not link that name'); }
                      }}
                      className="rounded border border-blue-400 px-2 py-0.5 text-blue-700 disabled:opacity-40 dark:text-blue-300">
                      {linked.includes(g.folder) ? 'Linked' : 'Link this name'}
                    </button>
                  </li>
                ))}
              </ul>
              {!!linked.length && (
                <p className="mt-2 text-xs text-blue-900 dark:text-blue-200">
                  {linked.length} linked — press <b>Review the zip</b> again to pick those documents up.
                </p>
              )}
            </div>
          )}
          {/* Grouped BY FOLDER, not as 169 loose paths. "Bio-Cat, 30 files,
              no supplier of that name" is something a person can act on; a
              list of every path is something they scroll past. */}
          {!!(plan.suggestions || []).filter(g => !g.supplier_id).length && (
            <details className="rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
              <summary className="cursor-pointer text-amber-900 dark:text-amber-200">
                {plan.suggestions.filter(g => !g.supplier_id).reduce((n, g) => n + g.files, 0)} files
                under {plan.suggestions.filter(g => !g.supplier_id).length} folder names that are not on the register
              </summary>
              <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
                {plan.suggestions.filter(g => !g.supplier_id).map(g => (
                  <li key={g.folder}><code>{g.folder}</code> — {g.files} files, no supplier of that name</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                These are companies you hold documents for that are not on the register — which is a
                finding, not a matching failure. <b>Put this same zip through the step above</b> and it
                adds them (as unqualified, like every import), then review here again. Nothing is ever
                filed against a company that is not on the register.
              </p>
            </details>
          )}
          <p className="text-xs text-slate-500">Reviewing writes nothing and uploads nothing.</p>
        </div>
      )}

      {done && (
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          <p><b>{done.stored}</b> documents stored.</p>
          {!!done.skipped && <p className="text-slate-600 dark:text-slate-300">{done.skipped} skipped (already stored, or not a document).</p>}
          {!!done.failed && (
            <p className="text-rose-600">{done.failed} failed — press Store again; what stored already is skipped.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Import: analyze, review, commit ─────────────────────────────────────────

function ImportTab({ onDone }) {
  const [files, setFiles] = useState([]);
  const [plan, setPlan] = useState(null);
  const [notes, setNotes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [linked, setLinked] = useState([]);

  // Linking is a deliberate act on the register, audited — it is not part of
  // the import, and it happens BEFORE one so the import sees a single company.
  const linkPair = async (k) => {
    setError(null);
    try {
      await apiPost('/suppliers/link-name-by-name',
        { supplier_name: k.on_register, name: k.archive_folder });
      setLinked(l => [...l, k.archive_folder]);
    } catch (e) { setError(e.message || 'Could not link that name'); }
  };

  const send = async (path, setResult) => {
    if (!files.length) return setError('Attach the tracker, the archive, or both.');
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await apiUpload(`/suppliers/import/${path}`, fd);
      setResult(r);
    } catch (e) { setError(e.message || 'Import failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Attach the supplier tracker (<code>.xlsx</code>) and the archive (a <code>.zip</code>, or a plain
          text listing of its paths). <b>Reviewing writes nothing.</b>
        </p>
        <input type="file" multiple accept=".xlsx,.xlsm,.csv,.tsv,.zip,.txt"
          onChange={e => { setFiles([...e.target.files]); setPlan(null); setDone(null); }}
          className="block w-full text-sm" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy || !files.length}
            onClick={() => send('analyze', r => { setPlan(r.plan); setNotes(r.notes || []); })}
            className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Review
          </button>
          {plan && (
            <button type="button" disabled={busy}
              onClick={() => send('commit', r => { setDone(r); setPlan(null); onDone?.(); })}
              className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              <Upload className="h-4 w-4" /> Import {plan.counts.suppliers} suppliers
            </button>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        {notes.map(n => <p key={n} className="mt-1 text-xs text-slate-500">{n}</p>)}
      </div>

      {done && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
          <p className="font-medium">Imported.</p>
          <ul className="mt-1 space-y-0.5 text-slate-700 dark:text-slate-300">
            {Object.entries(done.result).map(([k, v]) => <li key={k}>{v} {k.replace(/_/g, ' ')}</li>)}
          </ul>
        </div>
      )}

      {plan && <PlanReview plan={plan} linked={linked} onLink={linkPair} />}
    </div>
  );
}

function PlanReview({ plan, linked = [], onLink }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={plan.counts.suppliers} label="Suppliers" />
        <Stat value={plan.counts.files} label="Documents" />
        <Stat value={plan.counts.needing_attention} label="Need a person"
          tone="text-amber-600 dark:text-amber-400" />
        <Stat value={plan.counts.approved} label="Imported as approved" />
      </div>

      {/* Stated on the review screen, not only in a comment: this is the rule
          somebody would otherwise assume the other way round. */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p>
          <b>Nothing is imported as qualified.</b> A completed questionnaire is evidence for a disposition
          under SOP 404 § V.C.III, not the disposition itself. Every supplier arrives “not qualified” and
          Quality decides afterwards.
        </p>
      </div>

      {/* Two lists that are one company. Named, never joined automatically —
          the matcher refuses a three-character name inside another on purpose,
          and importing without linking makes a second record for a company
          already on the register. */}
      {!!(plan.reconciliation.likely_same || []).length && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
          <p className="font-medium text-blue-900 dark:text-blue-200">
            Possibly the same company, in both lists
          </p>
          <p className="mt-0.5 text-xs text-blue-900/80 dark:text-blue-200/80">
            Link the folder name first, or importing files this evidence under a second record.
          </p>
          <ul className="mt-2 space-y-1">
            {plan.reconciliation.likely_same.map(k => (
              <li key={k.archive_folder} className="flex flex-wrap items-center gap-2 text-xs">
                <b>{k.on_register}</b>
                <span className="text-slate-500">on the register ·</span>
                <code className="rounded bg-white px-1 dark:bg-slate-900">{k.archive_folder}</code>
                <span className="text-slate-500">in the archive</span>
                <button type="button" disabled={linked.includes(k.archive_folder)}
                  onClick={() => onLink?.(k)}
                  className="rounded border border-blue-400 px-2 py-0.5 text-blue-700 disabled:opacity-40 dark:text-blue-300">
                  {linked.includes(k.archive_folder) ? 'Linked' : 'Link this name'}
                </button>
              </li>
            ))}
          </ul>
          {!!linked.length && (
            <p className="mt-2 text-xs text-blue-900 dark:text-blue-200">
              {linked.length} linked — press <b>Review</b> again before importing.
            </p>
          )}
        </div>
      )}

      {plan.reconciliation.disagreements.map(d => (
        <section key={d.kind}>
          <h4 className="font-semibold">{d.label} <span className="text-slate-400">({d.vendors.length})</span></h4>
          <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">{d.note}</p>
          <p className="text-sm">{d.vendors.join(', ')}</p>
        </section>
      ))}

      <p className="text-xs text-slate-500">
        {plan.unexpanded_containers} nested archives were not opened by this listing, and{' '}
        {plan.unreadable.length} paths could not be classified — both are reported rather than guessed.
      </p>
    </div>
  );
}

// ── The disposition — SOP 404 § V.C.III, transcribed ────────────────────────

// `queue` is the rest of the suppliers being worked in this sitting. Deciding
// 44 suppliers one navigation at a time is how a queue stops being worked, so
// saving advances to the next — but NOTHING about the decision itself is
// batched. Every disposition is still seven criteria and a person, because a
// disposition is a judgement under SOP 404 § V.C.III and a "approve all" button
// would be 44 compliance records nobody made.
function DispositionModal({ supplier, data, onClose, onSaved, queue = [], onAdvance }) {
  const [disposition, setDisposition] = useState('');
  const [criteria, setCriteria] = useState({});
  const [notes, setNotes] = useState('');
  const [period, setPeriod] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The evidence, in the same window as the decision. Deciding from a supplier
  // name alone is the rubber stamp this module exists to prevent, and in a
  // queue nobody is going to open another screen 44 times.
  const { data: detail } = useApiGet(`/suppliers/${supplier.id}`);
  const files = detail?.files || [];
  const questionnaires = files.filter(f => /questionnaire/.test(f.kind) && !/blank/.test(f.kind));
  const expired = files.filter(f => f.expired);

  const CRITERIA = data?.risk_criteria || [];
  const DISPOSITIONS = data?.dispositions || [];
  const unanswered = CRITERIA.filter(c => !(c.key in criteria));
  const needsReason = disposition && disposition !== 'approved';
  const ready = disposition && !unanswered.length && (!needsReason || notes.trim().length > 2);

  const save = async (advance) => {
    setBusy(true); setError(null);
    try {
      await apiPost(`/suppliers/${supplier.id}/disposition`, {
        disposition, period_label: period || null, risk_criteria: criteria, notes,
      });
      if (advance && queue.length) onAdvance(queue[0], queue.slice(1));
      else onSaved();
    } catch (e) { setError(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 dark:bg-slate-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Disposition — {supplier.name}</h3>
            <p className="text-xs text-slate-500">SOP 404 V4 § V.C.III. The wording below is the SOP’s.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What is on file</p>
          {files.length ? (
            <>
              <p className="mt-1">
                <b>{files.length}</b> document{files.length === 1 ? '' : 's'}
                {questionnaires.length
                  ? <> · <b className="text-emerald-700 dark:text-emerald-400">{questionnaires.length} completed questionnaire{questionnaires.length === 1 ? '' : 's'}</b></>
                  : <> · <b className="text-rose-600 dark:text-rose-400">no completed questionnaire</b></>}
                {expired.length ? <> · <b className="text-rose-600 dark:text-rose-400">{expired.length} expired</b></> : null}
              </p>
              <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs">
                {files.slice(0, 40).map(f => (
                  <li key={f.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-slate-500">{f.period_label || '—'}</span>
                    <span className="text-slate-500">{String(f.kind).replace(/_/g, ' ')}</span>
                    {f.stored
                      ? <button type="button" onClick={() => downloadSupplierFile(f)}
                          className="text-blue-600 hover:underline dark:text-blue-400">{f.filename}</button>
                      : <span>{f.filename}</span>}
                    {f.expired && <span className="text-rose-600 dark:text-rose-400">expired {formatDate(f.expires_on)}</span>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-rose-600 dark:text-rose-400">
              Nothing on file. There is no evidence here to approve against.
            </p>
          )}
        </div>

        <label className="mb-3 block text-sm">
          <span className="text-slate-600 dark:text-slate-300">Period</span>
          <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="2026"
            className="mt-1 w-32 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </label>

        <fieldset className="mb-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Risk evaluation — all seven, § V.C.B.I
          </legend>
          <p className="mb-2 text-xs text-slate-500">
            The SOP calls these the <i>minimum</i> criteria, so a decision cannot be recorded with one left
            unanswered.
          </p>
          <ul className="space-y-1.5">
            {CRITERIA.map(c => (
              <li key={c.key} className="flex items-start gap-2 text-sm">
                <div className="mt-0.5 flex shrink-0 gap-1">
                  {['yes', 'no', 'na'].map(v => (
                    <button key={v} type="button"
                      onClick={() => setCriteria({ ...criteria, [c.key]: v })}
                      className={`rounded px-1.5 py-0.5 text-xs uppercase ${
                        criteria[c.key] === v
                          ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                          : 'border border-slate-300 text-slate-500 dark:border-slate-600'}`}>
                      {v}
                    </button>
                  ))}
                </div>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="mb-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Disposition</legend>
          <div className="space-y-2">
            {DISPOSITIONS.map(d => (
              <label key={d.value}
                className={`block cursor-pointer rounded border p-2 text-sm ${
                  disposition === d.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-200 dark:border-slate-700'}`}>
                <span className="flex items-center gap-2 font-medium">
                  <input type="radio" name="disposition" value={d.value}
                    checked={disposition === d.value} onChange={() => setDisposition(d.value)} />
                  {d.label}
                </span>
                {/* The SOP's own definition, shown in full — this is what makes
                    "conditionally approved" mean one thing rather than whatever
                    the person deciding assumes it means. */}
                <span className="mt-1 block pl-6 text-xs text-slate-500 dark:text-slate-400">{d.text}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mb-3 block text-sm">
          <span className="text-slate-600 dark:text-slate-300">
            Notes{needsReason && <b className="text-rose-600"> — required: the SOP names the deficiencies</b>}
          </span>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" />
        </label>

        {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          {!!unanswered.length && (
            <span className="mr-auto text-xs text-slate-500">{unanswered.length} of 7 criteria unanswered</span>
          )}
          <button type="button" onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">Cancel</button>
          {!!queue.length && (
            <button type="button" disabled={busy}
              onClick={() => onAdvance(queue[0], queue.slice(1))}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">
              Skip
            </button>
          )}
          {!!queue.length && (
            <button type="button" disabled={!ready || busy} onClick={() => save(true)}
              className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              Record &amp; next ({queue.length} left)
            </button>
          )}
          <button type="button" disabled={!ready || busy} onClick={() => save(false)}
            className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Record decision
          </button>
        </div>
      </div>
    </div>
  );
}
