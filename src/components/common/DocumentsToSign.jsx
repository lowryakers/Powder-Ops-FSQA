import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApiGet, apiPost, apiFetch } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature.js';
import { downloadFile } from '../../lib/downloadFile.js';
import { onDataChanged, notifyDataChanged } from '../../lib/dataChanged';
import { getParam, consumeParam } from '../../lib/deepLink.js';
import { pdfViewerUrl } from '../../lib/pdfUrl';
import { useCompactLayout } from '../../lib/useCompactLayout.js';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { SignaturePad } from './SignatureCanvas.jsx';
import { FileSignature, X, ExternalLink, Download, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * A document the office sent this person to sign — the card that stays put
 * until it is signed, and the screen it is signed on.
 *
 * Two pieces, mounted separately on purpose: `DocumentsToSignCard` is the
 * list (the sidebar, the operator layout, the welcome screen — wherever the
 * person actually is), and `SignDocumentHost` is mounted ONCE per layout and
 * owns the modal. The sidebar is rendered twice (desktop rail + phone drawer),
 * so a modal inside the card would open twice; the card asks by event and the
 * host answers, the same arrangement as SignaturePrompt.
 */
const OPEN_EVENT = 'open-sign-document';
const openSignDocument = (id) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { id } }));

export default function DocumentsToSignCard({ variant = 'sidebar', deps = [] }) {
  const { data, refresh } = useApiGet('/employee-documents/mine', deps);
  useEffect(() => onDataChanged(refresh), [refresh]);
  const pending = data?.pending || [];
  if (!pending.length) return null;
  const sidebar = variant === 'sidebar';
  return (
    <div className={sidebar ? 'border-t border-powder-200 bg-powder-50 px-3 py-2' : 'bg-powder-50 border border-powder-200 rounded-xl px-4 py-3'} data-documents-to-sign={pending.length}>
      <p className={`${sidebar ? 'text-[10px] px-1 mb-1' : 'text-xs mb-2'} font-bold uppercase tracking-wider text-powder-700 flex items-center gap-1.5`}>
        <FileSignature size={sidebar ? 11 : 13} /> {pending.length} document{pending.length === 1 ? '' : 's'} to sign
      </p>
      <div className={`space-y-1 ${sidebar ? 'max-h-40 overflow-y-auto' : ''}`}>
        {pending.map(d => (
          <button key={d.id} type="button" onClick={() => openSignDocument(d.id)} data-sign-open={d.id}
            className={`w-full text-left rounded-lg bg-white border px-2.5 py-1.5 hover:border-powder-400 ${d.overdue ? 'border-red-300' : 'border-powder-200'}`}>
            <span className={`block truncate ${sidebar ? 'text-xs' : 'text-sm'} font-medium text-gray-800`}>{d.title}</span>
            <span className="block text-[10px] text-gray-500 truncate">
              from {d.sent_by || 'the office'}{d.due_date ? ` · ${d.overdue ? 'was due' : 'by'} ${formatDate(d.due_date)}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SignDocumentHost() {
  // The ReadyBot message links to /?sign=<id>. App consumes its own params and
  // this module mounts after that, so the value is read through deepLink.js —
  // a pure read for the initial state, the consume in an effect (StrictMode
  // double-invokes the initializer and keeps the second result).
  const [id, setId] = useState(() => getParam('sign') || null);
  useEffect(() => { consumeParam('sign'); }, []);
  useEffect(() => {
    const on = (e) => setId(e.detail?.id || null);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  const close = useCallback(() => { setId(null); notifyDataChanged(); }, []);
  if (!id) return null;
  // Keyed on the id so a second document opened from the card starts clean.
  return <SignDocumentModal key={id} id={id} onClose={close} />;
}

const input = 'w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm';

function Field({ f, value, onChange }) {
  const label = <span className="block text-xs font-medium text-gray-700 mb-1">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>;
  if (f.type === 'checkbox') {
    return (
      <label className="flex items-start gap-2 text-sm text-gray-800 py-1" data-sign-field={f.name}>
        <input type="checkbox" className="mt-0.5" checked={!!value} onChange={e => onChange(e.target.checked)} />
        <span>{f.label}</span>
      </label>
    );
  }
  if (f.type === 'radio') {
    return (
      <div data-sign-field={f.name}>{label}
        <div className="flex flex-wrap gap-1.5">
          {f.options.map(o => (
            <button key={o} type="button" onClick={() => onChange(value === o ? '' : o)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${value === o ? 'border-powder-500 bg-powder-50 text-powder-800' : 'border-gray-300 bg-white text-gray-700'}`}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (f.type === 'dropdown' || f.type === 'optionlist') {
    return (
      <div data-sign-field={f.name}>{label}
        <select className={input} value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {f.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div data-sign-field={f.name}>{label}
      {f.multiline
        ? <textarea className={input} rows={3} value={value || ''} maxLength={f.max_length || undefined} onChange={e => onChange(e.target.value)} />
        : <input className={input} value={value || ''} maxLength={f.max_length || undefined} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

export function SignDocumentModal({ id, onClose }) {
  const compact = useCompactLayout();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [values, setValues] = useState({});
  const [image, setImage] = useState(null);
  const [saved, setSaved] = useState(null);
  const [name, setName] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/employee-documents/${id}`).then(d => {
      if (!alive) return;
      setDoc(d);
      const v = {};
      for (const f of d.fields || []) if (f.value !== undefined) v[f.name] = f.value;
      setValues(v);
    }).catch(e => alive && setError(e.message));
    apiFetch('/users/me/signature').then(r => alive && setSaved(r?.signature_image || null)).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const sign = async () => {
    setBusy(true); setError('');
    try {
      const r = await withSignature(
        (extra) => apiPost(`/employee-documents/${id}/sign`, { signed_name: name, attest, signature_image: image, values, ...extra }),
        { title: 'Sign this document', detail: `${doc?.title || 'This document'} — confirming your password is what makes this your signature.` },
      );
      setDone(r);
    } catch (e) { if (!e.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };
  const decline = async () => {
    setBusy(true); setError('');
    try { await apiPost(`/employee-documents/${id}/decline`, { reason }); onClose(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const missing = [];
  if (doc?.can_sign) {
    for (const f of doc.fields || []) if (f.required && (values[f.name] == null || values[f.name] === '' || values[f.name] === false)) missing.push(f.label);
    if (!image) missing.push('your signature');
    if (!name.trim()) missing.push('your name');
    if (!attest) missing.push('the statement');
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-sign-modal>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2 z-10">
          <FileSignature size={18} className="text-powder-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate">{doc?.title || 'Document'}</p>
            {doc && <p className="text-[11px] text-gray-500 truncate">from {doc.sent_by || 'the office'} · {formatDateTime(doc.sent_at)}{doc.due_date ? ` · sign by ${formatDate(doc.due_date)}` : ''}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
        </div>

        {!doc && !error && <p className="px-4 py-8 text-sm text-gray-400 text-center">Loading…</p>}
        {error && !doc && <p className="px-4 py-6 text-sm text-red-700">{error}</p>}

        {doc && done && (
          <div className="px-4 py-8 text-center space-y-3" data-sign-done>
            <CheckCircle2 size={40} className="mx-auto text-green-600" />
            <p className="text-base font-bold text-gray-900">Signed</p>
            <p className="text-sm text-gray-600">Your signed copy is filed with the office and stays on your record. {done.sent_by || 'The office'} has been told.</p>
            <div className="flex justify-center gap-2 flex-wrap">
              <button type="button" onClick={() => downloadFile(`/employee-documents/${id}/signed`, done.signed_filename || 'signed.pdf').catch(e => setError(e.message))}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm"><Download size={14} /> Download my copy</button>
              <button type="button" onClick={onClose} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold" data-sign-close>Done</button>
            </div>
            {error && <p className="text-xs text-red-700">{error}</p>}
          </div>
        )}

        {doc && !done && (
          <div className="px-4 py-4 space-y-5">
            {doc.instructions && <p className="text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{doc.instructions}</p>}
            {doc.status !== 'pending' && (
              <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                This document is {doc.status}{doc.signed_at ? ` — signed ${formatDateTime(doc.signed_at)}` : ''}.
                {doc.signed_url && <a href={doc.signed_url} target="_blank" rel="noreferrer" className="ml-2 text-powder-700 underline">Open the signed copy</a>}
              </p>
            )}

            <section>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">1 · Read the document</h3>
                {doc.source_url && (
                  <a href={doc.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-powder-700 hover:underline" data-sign-open-doc>
                    <ExternalLink size={12} /> Open in a new tab
                  </a>
                )}
              </div>
              {/* A phone cannot pinch an embedded PDF (the app disables viewport
                  zoom and the frame ignores touch), so on a compact screen the
                  document is handed to the phone's own viewer and the frame is
                  a preview only. */}
              {doc.source_url
                ? <iframe title="Document" src={pdfViewerUrl(doc.source_url)} className={`w-full ${compact ? 'h-[40vh]' : 'h-[55vh]'} bg-gray-100 border border-gray-200 rounded-lg`} />
                : <p className="text-sm text-gray-500">The file is not available right now.</p>}
            </section>

            {doc.can_sign && (doc.fields || []).length > 0 && (
              <section className="space-y-3" data-sign-fields={(doc.fields || []).length}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">2 · Fill in the form</h3>
                <p className="text-[11px] text-gray-500">These are the form's own boxes. What you type here is written into the document and locked when you sign.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {doc.fields.map(f => <Field key={f.name} f={f} value={values[f.name]} onChange={v => setValues(s => ({ ...s, [f.name]: v }))} />)}
                </div>
              </section>
            )}

            {doc.can_sign && (
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">{(doc.fields || []).length ? '3' : '2'} · Sign</h3>
                {image ? (
                  <div className="flex items-center gap-3 flex-wrap" data-sign-drawn>
                    <img src={image} alt="Your signature" className="h-16 max-w-[240px] object-contain border border-gray-200 rounded-lg bg-white px-2" />
                    <button type="button" onClick={() => setImage(null)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"><RotateCcw size={12} /> Redraw</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <SignaturePad onSave={setImage} />
                    {saved && (
                      <button type="button" onClick={() => setImage(saved)} className="text-xs text-powder-700 hover:underline" data-sign-use-saved>Use the signature saved on my account instead</button>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type your full name as it is on your account</label>
                  <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder={doc.signer_name || ''} autoComplete="off" data-sign-name />
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={attest} onChange={e => setAttest(e.target.checked)} data-sign-attest />
                  <span>{doc.attestation}</span>
                </label>
                {missing.length > 0 && (
                  <p className="text-[11px] text-amber-800 flex items-center gap-1"><AlertTriangle size={12} /> Still needed: {missing.join(', ')}.</p>
                )}
                {error && <p className="text-sm text-red-700" data-sign-error>{error}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={sign} disabled={busy || missing.length > 0}
                    className="px-4 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-sign-submit>
                    {busy ? 'Signing…' : 'Sign this document'}
                  </button>
                  <span className="text-[11px] text-gray-500">You will be asked for your password — that is what makes it your signature.</span>
                  <button type="button" onClick={() => setDeclining(v => !v)} className="ml-auto text-xs text-gray-500 hover:text-gray-800" data-sign-decline-toggle>I can't sign this</button>
                </div>
                {declining && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
                    <p className="text-xs text-gray-700">Tell the office why, and they will sort it out with you.</p>
                    <input className={input} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. the name on it is wrong" data-sign-decline-reason />
                    <button type="button" onClick={decline} disabled={busy || reason.trim().length < 3}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-50" data-sign-decline>Send to the office</button>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
