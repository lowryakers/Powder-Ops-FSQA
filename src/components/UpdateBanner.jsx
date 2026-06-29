import { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

export default function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialVersion = useRef(null);

  useEffect(() => {
    let mounted = true;

    async function checkVersion() {
      try {
        const res = await fetch('/api/version');
        if (!res.ok) return;
        const { version } = await res.json();

        if (!initialVersion.current) {
          initialVersion.current = version;
          return;
        }

        if (version !== initialVersion.current && mounted) {
          setUpdateAvailable(true);
        }
      } catch {}
    }

    checkVersion();
    const interval = setInterval(checkVersion, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom">
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 px-5 py-3 bg-powder-600 text-white rounded-full shadow-lg hover:bg-powder-700 transition-colors text-sm font-semibold"
      >
        <RefreshCw size={16} />
        Update available — tap to refresh
      </button>
    </div>
  );
}
