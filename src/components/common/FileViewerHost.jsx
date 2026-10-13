import { useEffect, useState } from 'react';
import FilePreview from '../FilePreview.jsx';
import { OPEN_FILE_EVENT, registerHost, opensInApp, nameFromUrl } from '../../lib/openFile';

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
      const a = e.target?.closest?.('a[href][target="_blank"]');
      if (!a || a.hasAttribute('download') || a.hasAttribute('data-new-tab')) return;
      const url = a.href;
      const name = a.getAttribute('data-file-name') || undefined;
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
