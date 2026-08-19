import { useState, useRef } from 'react';
import { Camera, Paperclip, X, Loader2 } from 'lucide-react';

export default function FileUpload({ files, onChange, maxFiles = 5 }) {
  const [uploading, setUploading] = useState(false);
  // A FAILED UPLOAD USED TO BE INVISIBLE. The catch below only wrote to the
  // console, so a refused upload looked exactly like a successful one that
  // attached nothing — which is how a rate-limited bulk session was reported
  // as "I attach the file and it isn't there".
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const handleFiles = async (selected) => {
    if (!selected?.length) return;
    const remaining = maxFiles - files.length;
    if (remaining <= 0) return;
    const toUpload = Array.from(selected).slice(0, remaining);

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      toUpload.forEach(f => formData.append('files', f));
      // The token identifies the person, which is what the upload allowance is
      // counted against — without it a whole office shares one anonymous cap.
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/uploads', {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Upload failed (${res.status})`);
      }
      const uploaded = await res.json();
      onChange([...files, ...uploaded]);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeFile = (idx) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  const isImage = (name) => /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(name);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Photos / Files</label>
      <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.mp4,.mov" className="hidden"
        onChange={e => handleFiles(e.target.files)} />

      {files.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-2">
          {files.map((f, i) => (
            <div key={i} className="relative group">
              {isImage(f.originalName || f.filename) ? (
                <img src={f.url} alt={f.originalName} className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
              ) : (
                <div className="h-16 w-16 rounded-lg border border-gray-200 flex items-center justify-center bg-gray-50">
                  <Paperclip size={20} className="text-gray-400" />
                </div>
              )}
              <button type="button" onClick={() => removeFile(i)}
                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <X size={12} />
              </button>
              <p className="text-[10px] text-gray-500 truncate w-16 mt-0.5">{f.originalName || f.filename}</p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1 mb-2">{error}</p>}

      {files.length < maxFiles && (
        <div className="flex gap-2">
          <button type="button" onClick={() => { inputRef.current.setAttribute('capture', 'environment'); inputRef.current.click(); }}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            Take Photo
          </button>
          <button type="button" onClick={() => { inputRef.current.removeAttribute('capture'); inputRef.current.click(); }}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 disabled:opacity-50">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
            Attach File
          </button>
        </div>
      )}
    </div>
  );
}
