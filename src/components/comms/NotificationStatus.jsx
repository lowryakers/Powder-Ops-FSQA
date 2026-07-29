import { useState, useEffect } from 'react';
import { apiFetch, apiPost } from '../../hooks/useApi';
import { X, Bell, CheckCircle2, AlertTriangle, XCircle, Smartphone } from 'lucide-react';

// Why am I not getting notifications on my phone? Every layer that has to be
// working is listed with its real state, so the answer is visible instead of
// guessed: server keys → browser support → iOS install → permission →
// subscription registered with the server. Includes a self-test push.
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.navigator.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

function Row({ state, label, detail }) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'warn' ? AlertTriangle : XCircle;
  const tone = state === 'ok' ? 'text-green-600' : state === 'warn' ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon size={15} className={`${tone} mt-0.5 shrink-0`} />
      <div className="min-w-0">
        <p className="text-sm text-gray-800">{label}</p>
        {detail && <p className="text-[11px] text-gray-500 leading-snug">{detail}</p>}
      </div>
    </div>
  );
}

export default function NotificationStatus({ subscribed, onClose, onToggle }) {
  const [serverOn, setServerOn] = useState(null);
  const [registered, setRegistered] = useState(null);
  const [devices, setDevices] = useState([]);
  const [testState, setTestState] = useState(null);

  const supported = ('serviceWorker' in navigator) && ('PushManager' in window);
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  const iosNeedsInstall = isIos() && !isInstalled();

  useEffect(() => {
    apiFetch('/comms/push/key').then(d => setServerOn(!!d.key)).catch(() => setServerOn(false));
    apiFetch('/comms/push/status')
      .then(d => { setRegistered(d.count || 0); setDevices(d.devices || []); })
      .catch(() => setRegistered(null));
  }, [subscribed]);

  const sendTest = async () => {
    setTestState('sending');
    try {
      await apiPost('/comms/push/test', {});
      setTestState('sent');
    } catch (e) { setTestState(e.message || 'failed'); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Bell size={17} className="text-powder-600" /> Notification status</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X size={18} /></button>
        </div>
        <div className="px-5 py-3 divide-y divide-gray-50">
          <Row state={serverOn === false ? 'bad' : 'ok'}
            label={serverOn === false ? 'Server push keys are not configured' : 'Server can send notifications'}
            detail={serverOn === false ? 'An admin needs to set the VAPID keys on the server.' : null} />
          <Row state={supported ? 'ok' : 'bad'}
            label={supported ? 'This browser supports notifications' : 'This browser cannot receive push notifications'}
            detail={supported ? null : 'Try Chrome on Android, or Safari on iOS 16.4+ with the app added to your Home Screen.'} />
          {isIos() && (
            <Row state={iosNeedsInstall ? 'bad' : 'ok'}
              label={iosNeedsInstall ? 'Add ReadyDoc to your Home Screen' : 'Installed to Home Screen'}
              detail={iosNeedsInstall ? 'On iPhone, notifications only work from the installed app: Share → Add to Home Screen, then open it from there.' : null} />
          )}
          <Row state={permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : 'warn'}
            label={permission === 'granted' ? 'Notification permission granted'
              : permission === 'denied' ? 'Notifications are blocked for this site'
              : 'Notification permission not requested yet'}
            detail={permission === 'denied'
              ? 'Re-allow in your phone settings: Settings → Apps → browser → Notifications (Android), or Settings → Notifications → ReadyDoc (iPhone).'
              : permission === 'granted' ? null : 'Tap "Turn on notifications" below.'} />
          <Row state={subscribed ? 'ok' : 'warn'}
            label={subscribed ? 'This device is subscribed' : 'This device is not subscribed yet'}
            detail={registered != null ? `${registered} device${registered === 1 ? '' : 's'} registered on your account.` : null} />
          {/* What actually happened on the last send, per device. Without this
              a failing subscription looks identical to a healthy one. */}
          {devices.map((d, i) => {
            const broken = d.stale_key || !!d.last_error;
            return (
              <Row key={i} state={broken ? 'bad' : d.last_success_at ? 'ok' : 'warn'}
                label={`${d.device}${broken ? ' — not receiving' : d.last_success_at ? ' — delivering' : ' — nothing sent yet'}`}
                detail={d.stale_key
                  ? 'Registered against older server keys, so nothing can reach it. Turn notifications off and back on to re-register.'
                  : d.last_error
                    ? `Last attempt failed (${d.last_error}).`
                    : d.last_success_at
                      ? `Last delivered ${new Date(d.last_success_at).toLocaleString()}.`
                      : 'Registered, but no notification has been sent to it yet — try the test below.'} />
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-2">
          {!subscribed && permission !== 'denied' && supported && !iosNeedsInstall && (
            <button onClick={onToggle} className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700">
              Turn on notifications
            </button>
          )}
          {subscribed && (
            <>
              <button onClick={sendTest} disabled={testState === 'sending'}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
                <Smartphone size={15} /> {testState === 'sending' ? 'Sending…' : 'Send a test notification'}
              </button>
              <button onClick={onToggle} className="px-3 py-2 text-gray-500 text-sm font-medium hover:bg-gray-100 rounded-lg">
                Turn off
              </button>
            </>
          )}
          <button onClick={onClose} className="px-4 py-2 text-gray-600 text-sm font-medium hover:bg-gray-100 rounded-lg ml-auto">Close</button>
        </div>
        {testState && testState !== 'sending' && (
          <p className={`px-5 pb-3 text-xs ${testState === 'sent' ? 'text-green-700' : 'text-red-600'}`}>
            {testState === 'sent'
              ? 'Test sent. It should appear within a few seconds — if it does not, check the phone-level settings above.'
              : testState}
          </p>
        )}
      </div>
    </div>
  );
}
