import { useState, useRef, useEffect } from 'react';
import { useApiGet, apiPut } from '../hooks/useApi';
import { MessageSquare, ChevronDown, Check, X } from 'lucide-react';

// "Discuss" button that jumps from a module into its linked Messages channel.
// Admins can change which channel the module links to (or unlink it entirely)
// via the small chevron; the choice is stored server-side for everyone.
export default function DiscussLink({ moduleId, defaultChannel, fromLabel, isAdmin }) {
  const { data: linkData, refresh } = useApiGet('/comms/module-links');
  const { data: channels } = useApiGet(isAdmin ? '/comms/channels' : '/comms/status');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Absent key -> module default; empty string -> explicitly unlinked.
  const configured = linkData?.links?.[moduleId];
  const channel = configured === undefined ? defaultChannel : configured;

  const setChannel = async (name) => {
    await apiPut('/comms/module-links', { module: moduleId, channel: name });
    refresh();
    setOpen(false);
  };

  const pickable = Array.isArray(channels) ? channels.filter(c => c.kind !== 'dm') : [];

  if (!channel && !isAdmin) return null; // unlinked and can't manage it

  return (
    <div className="relative flex items-center" ref={ref}>
      {channel && (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-comms-channel', { detail: { channel, from: moduleId, fromLabel } }))}
          className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          data-tip={`Discuss in #${channel}`}
        >
          <MessageSquare size={14} /> <span className="hidden sm:inline">Discuss</span>
        </button>
      )}
      {isAdmin && (
        <button onClick={() => setOpen(o => !o)} className="p-1 text-gray-400 hover:text-gray-600 rounded" data-tip="Change linked channel">
          <ChevronDown size={13} />
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-40 py-1 max-h-72 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase text-gray-400">Linked channel</div>
          {pickable.map(c => (
            <button key={c.id} onClick={() => setChannel(c.name)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 text-left">
              <span className="flex-1 truncate">#{c.name}</span>
              {c.name === channel && <Check size={14} className="text-powder-600 shrink-0" />}
            </button>
          ))}
          <button onClick={() => setChannel('')}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 text-left border-t border-gray-100 mt-1">
            <X size={14} /> No linked channel
          </button>
        </div>
      )}
    </div>
  );
}
