import { Camera, ImageIcon } from 'lucide-react';

/**
 * Two ways to attach a picture, because a phone has two.
 *
 * `capture="environment"` on a file input opens the camera directly — and on
 * iOS it opens ONLY the camera: a photo already taken cannot be chosen. One
 * input therefore cannot serve both "photograph the load now" and "attach the
 * picture I took ten minutes ago", so this renders two, sharing one onChange.
 * The chat composer has had this split since the paperclip bug; this is the
 * same rule once, for every form that takes a photo.
 *
 * `accept` defaults to images; pass `accept` to also allow PDFs. `name` labels
 * the pair for a test (`data-photo-picker`).
 */
export default function PhotoPicker({ onChange, disabled, busy, multiple = true, accept = 'image/*', takeLabel = 'Take a photo', chooseLabel = 'Choose from photos', className = '', name }) {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer';
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} data-photo-picker={name || true}>
      <label className={`${base} ${disabled || busy ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-powder-600 text-white hover:bg-powder-700'}`}>
        <Camera size={13} /> {busy ? 'Uploading…' : takeLabel}
        <input type="file" accept="image/*" capture="environment" multiple={multiple} onChange={onChange} disabled={disabled || busy} className="hidden" data-photo-take />
      </label>
      <label className={`${base} border ${disabled || busy ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-gray-300 text-gray-700 hover:border-powder-400 bg-white'}`}>
        <ImageIcon size={13} /> {chooseLabel}
        <input type="file" accept={accept} multiple={multiple} onChange={onChange} disabled={disabled || busy} className="hidden" data-photo-choose />
      </label>
    </div>
  );
}
