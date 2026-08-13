import { useState } from 'react';
import { X, Share, MoreVertical, CheckCircle2, Smartphone, ExternalLink, Copy } from 'lucide-react';
import { useInstallPrompt, installEnvironment } from '../lib/useInstallPrompt.js';

// "Add ReadyDoc to my phone" — the same question from every new hire, answered
// for the browser they are actually holding. Chrome's own Install option is
// used when it is available; otherwise this gives the exact taps, including
// the case that trips people up most (opening the link inside another app's
// browser, where installing is impossible until they switch to Chrome).
function Step({ n, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="h-5 w-5 rounded-full bg-powder-100 text-powder-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
      <span className="text-sm text-gray-700 leading-snug">{children}</span>
    </li>
  );
}

const Menu = () => (
  <span className="inline-flex items-center gap-0.5 font-semibold">
    <MoreVertical size={13} className="inline -mt-0.5" />menu
  </span>
);

export default function InstallHelp({ onClose }) {
  const { deferred, install } = useInstallPrompt();
  const env = installEnvironment();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the URL is shown on screen anyway */ }
  };

  let body;
  if (env.standalone) {
    body = (
      <div className="flex items-start gap-2 text-sm text-gray-700">
        <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
        <p>ReadyDoc is already installed — you&apos;re using the installed app right now. Its icon is on your home screen.</p>
      </div>
    );
  } else if (env.inApp) {
    body = (
      <>
        <p className="text-sm text-gray-600 mb-3">
          You opened ReadyDoc inside another app&apos;s built-in browser (from a text, email, or chat link).
          That browser can&apos;t install apps — switch to Chrome first.
        </p>
        <ol className="space-y-2.5">
          <Step n={1}>Tap the <Menu /> in the top corner of this screen.</Step>
          <Step n={2}>Choose <span className="font-semibold">Open in Chrome</span> {env.ios ? 'or Open in Safari' : ''}.</Step>
          <Step n={3}>In {env.ios ? 'Safari' : 'Chrome'}, follow the install steps there — or reopen this window and it will show them.</Step>
        </ol>
      </>
    );
  } else if (env.ios && !env.safari) {
    body = (
      <>
        <p className="text-sm text-gray-600 mb-3">
          On iPhone and iPad only <span className="font-semibold">Safari</span> can add an app to the Home Screen.
        </p>
        <ol className="space-y-2.5">
          <Step n={1}>Copy the ReadyDoc address below.</Step>
          <Step n={2}>Open <span className="font-semibold">Safari</span> and paste it in.</Step>
          <Step n={3}>Tap <Share size={13} className="inline -mt-0.5" /> <span className="font-semibold">Share</span> → <span className="font-semibold">Add to Home Screen</span> → <span className="font-semibold">Add</span>.</Step>
        </ol>
      </>
    );
  } else if (env.ios) {
    body = (
      <ol className="space-y-2.5">
        <Step n={1}>Tap the <Share size={13} className="inline -mt-0.5" /> <span className="font-semibold">Share</span> button in Safari&apos;s toolbar.</Step>
        <Step n={2}>Scroll down and choose <span className="font-semibold">Add to Home Screen</span>.</Step>
        <Step n={3}>Tap <span className="font-semibold">Add</span> — ReadyDoc appears on your home screen.</Step>
        <Step n={4}>Open it from that icon. Notifications only work from the installed app on iPhone.</Step>
      </ol>
    );
  } else if (env.samsung) {
    body = (
      <ol className="space-y-2.5">
        <Step n={1}>Tap the <Menu /> at the bottom right of Samsung Internet.</Step>
        <Step n={2}>Choose <span className="font-semibold">Add page to</span> → <span className="font-semibold">Home screen</span>.</Step>
        <Step n={3}>Tap <span className="font-semibold">Add</span>.</Step>
      </ol>
    );
  } else if (env.firefox) {
    body = (
      <ol className="space-y-2.5">
        <Step n={1}>Tap the <Menu /> in Firefox.</Step>
        <Step n={2}>Choose <span className="font-semibold">Install</span> (or <span className="font-semibold">Add to Home screen</span>).</Step>
      </ol>
    );
  } else if (env.android) {
    body = (
      <>
        <ol className="space-y-2.5">
          <Step n={1}>Tap the <Menu /> at the top right of Chrome.</Step>
          <Step n={2}>Choose <span className="font-semibold">Add to Home screen</span> (some phones say <span className="font-semibold">Install app</span>).</Step>
          <Step n={3}>Tap <span className="font-semibold">Install</span> — ReadyDoc gets its own icon and opens full screen.</Step>
        </ol>
        <p className="mt-3 text-xs text-gray-500 leading-relaxed">
          Don&apos;t see the option? It&apos;s hidden in Incognito tabs, and it disappears once ReadyDoc
          is already installed — check your app drawer first. Make sure you&apos;re in the Chrome app
          itself, not a browser window inside another app.
        </p>
      </>
    );
  } else {
    body = (
      <ol className="space-y-2.5">
        <Step n={1}>Look for the install icon <ExternalLink size={13} className="inline -mt-0.5" /> at the right end of the address bar.</Step>
        <Step n={2}>Or open the <Menu /> → <span className="font-semibold">Install ReadyDoc</span> / <span className="font-semibold">Save and share</span> → <span className="font-semibold">Install</span>.</Step>
        <Step n={3}>Confirm <span className="font-semibold">Install</span>.</Step>
      </ol>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-[90] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Smartphone size={17} className="text-powder-600" /> Add ReadyDoc to your device
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X size={18} /></button>
        </div>

        <div className="px-5 py-4">
          {deferred && !env.standalone && (
            <button onClick={async () => { const ok = await install(); if (ok) onClose(); }}
              className="w-full mb-4 px-4 py-2.5 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700">
              Install ReadyDoc
            </button>
          )}
          {body}
        </div>

        {!env.standalone && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <span className="text-xs text-gray-600 truncate flex-1">{window.location.origin}</span>
              <button onClick={copyLink} className="flex items-center gap-1 text-xs font-medium text-powder-700 hover:underline shrink-0">
                <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
