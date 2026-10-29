import { useEffect, useState } from 'react';
import FilePreview from '../FilePreview.jsx';
import { OPEN_FILE_EVENT, registerHost, opensInApp, nameFromUrl, fileKind } from '../../lib/openFile';
import { logFileOpen } from '../../lib/activityLog';

// The one in-app file viewer, mounted once beside <App/> so every screen —
// signed in or a public page — shares it (D-168). See src/lib/openFile.js.
export default function FileViewerHost() {
  const [item, setItem] = useState(null);

  useEffect(() => {
    const unregister = registerHost();
    const onOpen = (e) => setItem(e.detail);
    // A link written the ordinary way — <a href target="_blank"> — is caught here
    // in the CAPTURE phase, before any row handler, so no screen has to remember
    // to route its file links through openFile().
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.('a[href][target="_blank"], a[href][download]');
      if (!a) return;
      const url = a.href;
      const name = a.getAttribute('data-file-name') || undefined;
      // A stored file opened from a plain link is a file open in the activity
      // log (D-261) — whether it opens here or in a tab.
      if (fileKind(url, name) || /\/uploads\/|X-Amz-Signature/.test(url)) {
        logFileOpen(url, name || nameFromUrl(url), a.hasAttribute('download') ? 'download' : 'file_open');
      }
      if (a.target !== '_blank' || a.hasAttribute('download') || a.hasAttribute('data-new-tab')) return;
      if (!opensInApp(url, name)) return;
      e.preventDefault();
      setItem({ url, name: name || nameFromUrl(url) });
    };
    window.addEventListener(OPEN_FILE_EVENT, onOpen);
    document.addEventListener('click', onClick, true);
    return () => {
      unregister();
      window.removeEventListener(OPEN_FILE_EVENT, onOpen);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  if (!item) return null;
  return <FilePreview items={[item]} index={0} onClose={() => setItem(null)} />;
}
