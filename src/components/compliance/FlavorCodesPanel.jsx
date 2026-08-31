import { useState } from 'react';
import { useApiGet, apiPost, apiDelete } from '../../hooks/useApi';
import { AlertTriangle, Plus, Tag } from 'lucide-react';

/**
 * The flavour register — one flavour, one abbreviation, for every pack.
 *
 * WHY THIS SCREEN EXISTS AT ALL. Under the legacy SKU the pack was in the
 * prefix, so a flavour could carry a different abbreviation on a pouch than on
 * a stick and nothing ever joined them. The new standard puts the flavour code
 * in the middle of every SKU, so it has to mean exactly one thing — and the
 * live catalogue contains ten flavours with two codes and four codes meaning
 * two flavours.
 *
 * The list of outstanding decisions is DERIVED on every read, so resolving one
 * makes it disappear from the list rather than leaving somebody to tick it off.
 */
export default function FlavorCodesPanel() {
  const { data, refresh } = useApiGet('/products/flavor-codes');
  const [form, setForm] = useState(null); // { flavor, code, legacy_codes, source }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  const codes = data?.codes || [];
  const pending = data?.needs_decision || [];
  const canEdit = !!data?.can_edit;
  const active = codes.filter(c => c.is_active);
  const retired = codes.filter(c => !c.is_active);
  const shown = q.trim()
    ? active.filter(c => `${c.flavor} ${c.code}`.toLowerCase().includes(q.trim().toLowerCase()))
    : active;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await apiPost('/products/flavor-codes', form);
      setForm(null); refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const retire = async (id) => {
    setError(null);
    try { await apiDelete(`/products/flavor-codes/${id}`); refresh(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <Tag size={17} className="text-powder-600" /> Flavour codes
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          The middle part of every new SKU — <code className="px-1 bg-gray-100 rounded">WHY-BTL-BLM</code> is
          whey, bottle, Blueberry Muffin. Each flavour has exactly one code and each code means exactly one
          flavour. <strong>A code is never changed once issued</strong>: it is printed on film and it is a
          join key on every PO.
        </p>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {/* THE DECISIONS ONLY A PERSON CAN MAKE. Two flavours whose only
          abbreviation is the same cannot both keep it, and nothing here guesses
          which one moves — a code invented by software gets printed and then
          argued about. */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-900">
              {pending.length} flavour{pending.length === 1 ? '' : 's'} still need a code
            </span>
          </div>
          <ul className="divide-y divide-amber-200/70">
            {pending.map(d => (
              <li key={d.flavor} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-900">{d.flavor}</span>
                    <p className="text-xs text-amber-900/80 mt-0.5">{d.reason}</p>
                    <p className="text-[11px] text-gray-600 mt-1">
                      In use: {d.options.map(o => <code key={o} className="mr-1 px-1 bg-white/70 rounded">{o}</code>)}
                    </p>
                  </div>
                  {canEdit && (
                    <button type="button"
                      onClick={() => { setError(null); setForm({ flavor: d.flavor, code: d.options[0], legacy_codes: d.options, source: 'decided' }); }}
                      className="shrink-0 px-2.5 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700">
                      Decide
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 border-t border-amber-200 text-[11px] text-amber-900/80">
            Bottle SKUs for these flavours cannot be minted until each has one code.
          </p>
        </div>
      )}

      {form && (
        <form onSubmit={submit} className="bg-white border border-powder-300 rounded-xl p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900">Issue a code for {form.flavor || 'a new flavour'}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Flavour</span>
              <input value={form.flavor} required
                onChange={e => setForm(f => ({ ...f, flavor: e.target.value }))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Code (2–4 letters)</span>
              <input value={form.code} required maxLength={4}
                onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm font-mono tracking-wider" />
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] text-gray-600 mb-0.5">Why this one (optional)</span>
            <input value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="CM stays with Chocolate Mousse — it has more SKUs on film"
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </label>
          <p className="text-[11px] text-gray-500">
            This is permanent. Once issued it goes on packaging and cannot be changed.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !form.flavor?.trim() || (form.code || '').length < 2}
              className="px-3.5 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Issuing…' : 'Issue code'}
            </button>
            <button type="button" onClick={() => { setForm(null); setError(null); }}
              className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-700">In use ({active.length})</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a flavour or code"
            className="ml-auto w-48 px-2.5 py-1 border border-gray-300 rounded-lg text-xs" />
          {canEdit && !form && (
            <button type="button" onClick={() => { setError(null); setForm({ flavor: '', code: '', source: 'new' }); }}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700">
              <Plus size={13} /> New flavour
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">No flavour matches that.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map(c => (
              <li key={c.id} className="px-4 py-2 flex items-center gap-3">
                <code className="font-mono font-semibold text-powder-800 bg-powder-50 border border-powder-200 rounded px-1.5 py-0.5 text-xs tracking-wider w-16 text-center shrink-0">
                  {c.code}
                </code>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-900">{c.flavor}</span>
                  {/* The superseded codes are kept and shown: a two-year-old PO
                      says BM and still has to resolve to Blueberry Muffin. */}
                  {c.legacy_codes?.length > 0 && (
                    <span className="ml-2 text-[11px] text-gray-500">was {c.legacy_codes.join(', ')}</span>
                  )}
                </div>
                {canEdit && (
                  <button type="button" onClick={() => retire(c.id)}
                    className="shrink-0 text-xs font-medium text-gray-400 hover:text-red-600">Retire</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {retired.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 text-sm font-semibold text-gray-500">
            Retired ({retired.length}) — these codes are never reissued
          </div>
          <ul className="divide-y divide-gray-100">
            {retired.map(c => (
              <li key={c.id} className="px-4 py-1.5 text-sm text-gray-500">
                <code className="font-mono text-xs mr-2 line-through">{c.code}</code>{c.flavor}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
