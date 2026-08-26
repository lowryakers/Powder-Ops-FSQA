import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyText } from '../../lib/clipboard.js';

/**
 * Copy, and say so.
 *
 * `getText` may be a string or a function — including an async one, so a caller
 * can compose server-side on the click and still copy within the same user
 * gesture, which is what some browsers require for clipboard access.
 */
export default function CopyButton({ getText, label = 'Copy', doneLabel = 'Copied', className = '', disabled = false }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" disabled={disabled}
      className={className || 'inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50'}
      onClick={async () => {
        const text = typeof getText === 'function' ? await getText() : getText;
        if (text && await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 2000); }
      }}>
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? doneLabel : label}
    </button>
  );
}
