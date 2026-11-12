// Export the filtered catalogue (R-0645 PR C): a preset, CSV or Excel.
// The server applies the same filters the screen does, so the file holds the
// rows on screen. master.csv (the proofer's feed) is separate and unchanged.
import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadFile } from '../../lib/downloadFile.js';

const PRESETS = [
  ['full', 'Full'],
  ['shalee', 'Distributor sheet (Shalee)'],
  ['retailer', 'Retailer item setup'],
  ['gs1', 'GS1 check'],
];

export default function ProductExport({ filters }) {
  const [preset, setPreset] = useState('full');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const go = async (format) => {
    setBusy(format); setError('');
    try {
      const q = new URLSearchParams({ preset, format, filters: JSON.stringify(filters || {}) });
      await downloadFile(`/products/export?${q}`, `products-${preset}-${new Date().toISOString().slice(0, 10)}.${format}`);
    } catch (e) { setError(e.message); }
    setBusy('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-product-export>
      <Download size={15} className="text-gray-400" />
      <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Export preset" data-export-preset
        className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
        {PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <button type="button" onClick={() => go('csv')} disabled={!!busy} data-export-format="csv"
        className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">{busy === 'csv' ? 'Exporting…' : 'CSV'}</button>
      <button type="button" onClick={() => go('xlsx')} disabled={!!busy} data-export-format="xlsx"
        className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium hover:bg-gray-50 disabled:opacity-50">{busy === 'xlsx' ? 'Exporting…' : 'Excel'}</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
