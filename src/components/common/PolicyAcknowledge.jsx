import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiPost, apiFetch } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature.js';
import { notifyDataChanged } from '../../lib/dataChanged';
import { getParam, consumeParam } from '../../lib/deepLink.js';
import { pdfViewerUrl } from '../../lib/pdfUrl';
import { openFile, fileKind } from '../../lib/openFile';
import { useCompactLayout } from '../../lib/useCompactLayout.js';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import RichText from './RichText.jsx';
import { POLICY_ACK_EVENT } from '../../lib/policyAck.js';
import { BookText, X, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

/**
 * A policy sent to this person to read and acknowledge (D-169).
 *
 * Listed on the same "Documents to sign" card as a W-4 (DocumentsToSign.jsx),
 * because one person should have one place for what is waiting on their
 * signature. The modal is owned by `PolicyAckHost`, which SignDocumentHost
 * renders — so it is mounted once per layout wherever that one is.
 */

export function PolicyAckHost() {
  // ReadyBot links to /?ack=<id>; read through deepLink.js (a lazy module never
  // sees the query string App consumed), consumed in an effect.
  const [id, setId] = useState(() => getParam('ack') || null);
  useEffect(() => { consumeParam('ack'); }, []);
  useEffect(() => {
    const on = (e) => setId(e.detail?.id || null);
    window.addEventListener(POLICY_ACK_EVENT, on);
    return () => window.removeEventListener(POLICY_ACK_EVENT, on);
  }, []);
  const close = useCallback(() => { setId(null); notifyDataChanged(); }, []);
  if (!id) return null;
  return <PolicyAckModal key={id} id={id} onClose={close} />;
}

const input = 'w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm';

export function PolicyAckModal({ id, onClose }) {
  const compact = useCompactLayout();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/policy-acks/${id}`).then(d => alive && setDoc(d)).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  const acknowledge = async () => {
    setBusy(true); setError('');
    try {
      const r = await withSignature(
        (extra) => apiPost(`/policy-acks/${id}/sign`, { signed_name: name, attest, ...extra }),
        { title: 'Acknowledge this policy', detail: `${doc?.title || 'This policy'} — confirming your password is what makes this your signature.` },
      );
      setDone(r);
    } catch (e) { if (!e.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };

  const missing = [];
  if (doc?.can_acknowledge) {
    if (!name.trim()) missing.push('your name');
    if (!attest) missing.push('the statement');
  }
  const isPdf = doc?.file_url && fileKind(doc.file_url, doc.filename) === 'pdf';

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-policy-ack-modal>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2 z-10">
          <BookText size={18} className="text-powder-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate">{doc?.title || 'Policy'}{doc?.version ? ` · v${doc.version}` : ''}</p>
            {doc && <p className="text-[11px] text-gray-500 truncate">from {doc.sent_by || 'the office'} · {formatDateTime(doc.sent_at)}{doc.due_date ? ` · by ${formatDate(doc.due_date)}` : ''}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
        </div>

        {!doc && !error && <p className="px-4 py-8 text-sm text-gray-400 text-center">Loading…</p>}
        {error && !doc && <p className="px-4 py-6 text-sm text-red-700">{error}</p>}

        {doc && done && (
          <div className="px-4 py-8 text-center space-y-3" data-policy-ack-done>
            <CheckCircle2 size={40} className="mx-auto text-green-600" />
            <p className="text-base font-bold text-gray-900">Acknowledged</p>
            <p className="text-sm text-gray-600">It is on your record that you read {doc.title}{doc.version ? ` (version ${doc.version})` : ''}.</p>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold" data-policy-ack-close>Done</button>
          </div>
        )}

        {doc && !done && (
          <div className="px-4 py-4 space-y-5">
            {doc.note && <p className="text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{doc.note}</p>}
            {doc.status === 'acknowledged' && (
              <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                You acknowledged this on {formatDateTime(doc.acknowledged_at)}{doc.ack_version ? ` (version ${doc.ack_version})` : ''}.
              </p>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">1 · Read the policy</h3>
              {doc.summary && <p className="text-sm text-gray-600 italic">{doc.summary}</p>}
              {doc.body && <div className="text-sm text-gray-800 leading-relaxed border border-gray-200 rounded-lg p-3 max-h-[45vh] overflow-y-auto" data-policy-ack-body><RichText text={doc.body} /></div>}
              {doc.file_url && (isPdf && !compact
                ? <iframe title="Policy" src={pdfViewerUrl(doc.file_url)} className="w-full h-[55vh] bg-gray-100 border border-gray-200 rounded-lg" data-policy-ack-frame />
                : (
                  <button type="button" onClick={() => openFile({ url: doc.file_url, name: doc.filename })} data-policy-ack-open
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm text-powder-700">
                    <ExternalLink size={14} /> Open {doc.filename || 'the document'}
                  </button>
                ))}
              {!doc.body && !doc.file_url && <p className="text-sm text-gray-500">The policy text is not available right now.</p>}
            </section>

            {doc.can_acknowledge && (
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">2 · Acknowledge</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Type your full name as it is on your account</label>
                  <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder={doc.signer_name || ''} autoComplete="off" data-policy-ack-name />
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={attest} onChange={e => setAttest(e.target.checked)} data-policy-ack-attest />
                  <span>{doc.attestation}</span>
                </label>
                {missing.length > 0 && (
                  <p className="text-[11px] text-amber-800 flex items-center gap-1"><AlertTriangle size={12} /> Still needed: {missing.join(', ')}.</p>
                )}
                {error && <p className="text-sm text-red-700" data-policy-ack-error>{error}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={acknowledge} disabled={busy || missing.length > 0}
                    className="px-4 py-2.5 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-policy-ack-submit>
                    {busy ? 'Saving…' : 'I have read it — acknowledge'}
                  </button>
                  <span className="text-[11px] text-gray-500">You will be asked for your password — that is what makes it your signature.</span>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
