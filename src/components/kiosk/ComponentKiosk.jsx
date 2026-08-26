import { useState, useEffect } from 'react';
import { useKioskLang } from './useKioskLang.js';
import KioskLangToggle from './KioskLangToggle.jsx';
import { PackageCheck, CheckCircle, AlertTriangle, LogOut, LogIn } from 'lucide-react';
import SearchSelect from '../common/SearchSelect.jsx';
import { kioskHeaders } from '../../lib/kioskToken.js';

const EMPTY = { direction: 'Out', item_name: '', part_number: '', lot_number: '', mo_number: '', qty_pulled: '', person: '' };

export default function ComponentKiosk({ defaultName = '' }) {
  const { lang, toggle, t } = useKioskLang();
  const [form, setForm] = useState({ ...EMPTY, person: defaultName });
  const [options, setOptions] = useState({ item_names: [], part_numbers: [], mo_numbers: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    // Merge rather than replace: a response from an older server without one
    // of the suggestion lists would otherwise leave it undefined and break the
    // datalist that maps over it.
    fetch('/api/submit/component-options', { headers: kioskHeaders('components') }).then(r => r.json())
      .then(o => setOptions(prev => ({ ...prev, ...o }))).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/component-signout', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...kioskHeaders('components', { headers: kioskHeaders('components') }) }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Component Signed {result.direction}</h1>
          <p className="text-gray-600 mb-1">{form.item_name}</p>
          <p className="text-sm text-gray-500 mb-6">Logged as <span className="font-medium">{result.record_number}</span> — awaiting WH/QA review.</p>
          {/* Keep the MO as well as the name: pulling several components for
              one job is the common case, and it stays visible to be changed. */}
          <button onClick={() => { setResult(null); setForm({ ...EMPTY, direction: form.direction, person: form.person, mo_number: form.mo_number }); }}
            className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
            {t('k_log_another')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="flex justify-end mb-2">
          <KioskLangToggle lang={lang} onToggle={toggle} />
        </div>
        <div className="text-center mb-6">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <PackageCheck size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('k_comp_title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('k_comp_sub')}</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('k_direction')}</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'Out', label: t('k_sign_out'), desc: t('k_pulling'), Icon: LogOut },
                { value: 'In', label: t('k_check_in'), desc: t('k_returning'), Icon: LogIn },
              ].map(d => (
                <button key={d.value} type="button" onClick={() => set('direction', d.value)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${form.direction === d.value ? 'border-powder-500 bg-powder-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <span className="text-sm font-bold flex items-center gap-1.5"><d.Icon size={15} /> {d.label}</span>
                  <span className="text-xs text-gray-500">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('k_your_name')}</label>
            <input required value={form.person} onChange={e => set('person', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder={t('k_enter_name')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('k_item_name')}</label>
            {/* Type-ahead with a VISIBLE list — the old <datalist> suggestions
                simply don't show on many phone browsers, and this kiosk lives
                on a phone at the shelf. Free text stays legal: a first-time
                item is a real answer. */}
            <SearchSelect value={form.item_name} onChange={v => set('item_name', v)} big allowFree
              options={options.item_names} placeholder={t('k_eg_wand')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('k_part_number')}</label>
              <SearchSelect value={form.part_number} onChange={v => set('part_number', v)} big allowFree
                options={options.part_numbers} placeholder={t('k_optional')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('k_qty')}</label>
              <input value={form.qty_pulled} onChange={e => set('qty_pulled', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder={t('k_eg_2')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('k_lot_number')}</label>
              <input value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder={t('k_optional')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('k_mo_number')}</label>
              <SearchSelect value={form.mo_number} onChange={v => set('mo_number', v)} big allowFree
                options={options.mo_numbers || []} placeholder={t('k_job_for')} />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full py-4 bg-powder-600 text-white rounded-xl text-lg font-bold hover:bg-powder-700 disabled:opacity-50 transition-colors active:scale-[0.98]">
            {saving ? 'Saving…' : `Sign ${form.direction}`}
          </button>
        </form>
      </div>
    </div>
  );
}
