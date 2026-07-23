import { useState } from 'react';
import { apiPost } from '../../hooks/useApi';
import { Send, Copy, Check, MessageSquare } from 'lucide-react';
import QMSRecordsPanel from './QMSRecordsPanel.jsx';

// Flavor Approvals: the log (generic QMS panel) plus a "text it to Danny"
// action on freshly created pending requests. When Twilio is configured the
// link is texted automatically; otherwise it's copyable to send from any phone.
export default function FlavorPanel() {
  const [sendResult, setSendResult] = useState(null); // { link, texted, sms_configured }
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const sendForApproval = async (recordId) => {
    setSending(true); setSendResult(null); setCopied(false);
    try { setSendResult(await apiPost(`/qms/flavor_approval/${recordId}/send`, {})); }
    catch (e) { setSendResult({ error: e.message }); }
    finally { setSending(false); }
  };

  const copy = () => {
    try { navigator.clipboard?.writeText(sendResult.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3">
      {sendResult && !sendResult.error && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 text-sm space-y-2">
          {sendResult.texted ? (
            <p className="text-green-800 font-medium flex items-center gap-1.5"><MessageSquare size={15} /> Texted to Danny — he can approve or deny with one tap, no login.</p>
          ) : (
            <p className="text-green-800 font-medium">Approval link ready — text it to Danny from any phone. One tap approves or denies, no login needed.</p>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 break-all">{sendResult.link}</code>
            <button onClick={copy} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-white border border-green-200 rounded-lg text-xs font-medium text-green-700 hover:bg-green-100">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {!sendResult.sms_configured && (
            <p className="text-[11px] text-green-700/70">Auto-texting turns on once Twilio is configured (TWILIO_* + FLAVOR_APPROVER_PHONE env vars).</p>
          )}
          {sendResult.sms_error && <p className="text-[11px] text-amber-700">Text failed ({sendResult.sms_error}) — copy the link and send it manually.</p>}
        </div>
      )}
      {sendResult?.error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{sendResult.error}</div>}

      <QMSRecordsPanel key={refreshKey} recordType="flavor_approval" moduleId="flavor-approvals"
        rowAction={{
          label: sending ? 'Sending…' : 'Text for approval',
          icon: Send,
          show: (r) => r.status === 'pending',
          run: (r) => sendForApproval(r.id).then(() => setRefreshKey(k => k)),
        }} />
    </div>
  );
}
