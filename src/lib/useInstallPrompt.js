import { useEffect, useState } from 'react';

// Chrome fires `beforeinstallprompt` once, very early — often before React has
// mounted the component that wants it. Capture it at module load and hand it
// out to whoever asks, so both the install toast and the "Add to home screen"
// help sheet can trigger the real prompt instead of only giving instructions.
let captured = null;
const listeners = new Set();
const broadcast = () => { for (const fn of listeners) fn(captured); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    captured = e;
    broadcast();
  });
  window.addEventListener('appinstalled', () => { captured = null; broadcast(); });
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState(captured);
  useEffect(() => {
    const fn = (e) => setDeferred(e);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  // Returns true only when the user actually accepted. The event is one-shot:
  // Chrome will not let us re-prompt with the same one.
  const install = async () => {
    if (!captured) return false;
    captured.prompt();
    const res = await captured.userChoice.catch(() => null);
    captured = null;
    broadcast();
    return res?.outcome === 'accepted';
  };

  return { deferred, install };
}

// What we can actually tell this user to tap. Browsers differ enough that
// generic "use the menu" advice is what makes people give up.
export function installEnvironment() {
  const ua = navigator.userAgent || '';
  const standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const ios = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  // Android WebViews (";wv") and the big social/messaging apps' embedded
  // browsers can never install — the option simply isn't in their menu.
  const inApp = (android && /; wv\)/.test(ua)) ||
    /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|MicroMessenger|Slack|Teams\/|WhatsApp|GSA\//.test(ua);
  const samsung = /SamsungBrowser/.test(ua);
  const firefox = /Firefox|FxiOS/.test(ua);
  const chrome = /Chrome|CriOS/.test(ua) && !samsung && !/Edg\//.test(ua);
  const edge = /Edg\//.test(ua);
  const safari = ios && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return { standalone, ios, android, inApp, samsung, firefox, chrome, edge, safari,
    desktop: !ios && !android };
}
