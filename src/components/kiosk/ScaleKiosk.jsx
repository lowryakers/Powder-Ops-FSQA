import { useState, useEffect, useMemo } from 'react';
import { Scale, CheckCircle, AlertTriangle, ChevronLeft } from 'lucide-react';
import ScaleProcedureCard from '../common/ScaleProcedureCard.jsx';
import { useKioskLang } from './useKioskLang.js';
import KioskLangToggle from './KioskLangToggle.jsx';
import { kioskHeaders } from '../../lib/kioskToken.js';

// Scale Calibration Verification — Forms 417-01 … 417-05.
//
// A supervisor runs this at the scale before production starts, so it opens on
// "which scale" and nothing else: pick the form, put the three weights on, type
// what the display reads. Pass/fail is computed from the tolerances on the
// controlled form and shown live — nobody circles Pass on a reading that's out.

const EMPTY = { room: '', weights_serial: '', asset_tag: '', performed_by: '', notes: '' };

// Same rule the server applies. Shown live so the operator sees a bad reading
// before they submit, not after.
function pointState(point, raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  const dev = v - point.nominal;
  return { value: v, deviation: dev, pass: Math.abs(dev) <= point.tolerance + 1e-9 };
}

export default function ScaleKiosk({ defaultName = '' }) {
  const { lang, toggle, t } = useKioskLang();
  const [forms, setForms] = useState([]);
  // The directions, so the person at the scale reads them where they type.
  const [procedure, setProcedure] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState(null);      // the chosen 417-xx definition
  const [values, setValues] = useState(['', '', '']);
  const [meta, setMeta] = useState({ ...EMPTY, performed_by: defaultName });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch('/api/submit/scale-forms', { headers: kioskHeaders('scale') }).then(r => r.json())
      .then(d => { setForms(d.forms || []); setRooms(d.rooms || []); setProcedure(d.procedure || null); })
      .catch(() => {});
  }, []);

  const states = useMemo(
    () => (form ? form.points.map((p, i) => pointState(p, values[i])) : []),
    [form, values]
  );
  const complete = states.length > 0 && states.every(s => s !== null);
  const passes = complete && states.every(s => s.pass);

  const set = (k, v) => setMeta(m => ({ ...m, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/submit/scale-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...kioskHeaders('scale', { headers: kioskHeaders('scale') }) },
        body: JSON.stringify({ ...meta, form_code: form.code, readings: values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data.record);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startOver = (keepForm) => {
    setResult(null);
    setValues(['', '', '']);
    setMeta(m => ({ ...EMPTY, performed_by: m.performed_by, room: keepForm ? m.room : '' }));
    if (!keepForm) setForm(null);
  };

  /* ── Confirmation ────────────────────────────────────────────────────── */
  if (result) {
    const failed = result.result === 'fail';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          {failed
            ? <AlertTriangle size={64} className="mx-auto text-red-500 mb-4" />
            : <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />}
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            {failed ? t('k_recorded_failed') : t('k_verification_passed')}
          </h1>
          <p className="text-gray-600 mb-1">{result.form_title}</p>
          <p className="text-sm text-gray-500 mb-4">
            {result.room ? `Room ${result.room} · ` : ''}Logged by {result.performed_by}
          </p>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-left text-sm mb-4">
            {(result.readings || []).map((r, i) => (
              <div key={i} className="flex items-center justify-between py-0.5">
                <span className="text-gray-600">{r.label}</span>
                <span className={r.pass ? 'text-green-700 font-medium' : 'text-red-700 font-semibold'}>
                  {r.value} {r.unit} {r.pass ? '' : '· OUT'}
                </span>
              </div>
            ))}
          </div>
          {failed && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              {t('k_do_not_use')}
            </p>
          )}
          <p className="text-xs text-gray-400 mb-5">{t('k_awaiting_qa')}</p>
          <div className="flex flex-col gap-2">
            <button onClick={() => startOver(true)}
              className="px-6 py-3 bg-powder-600 text-white rounded-xl font-bold hover:bg-powder-700">
              {t('k_check_another')}
            </button>
            <button onClick={() => startOver(false)} className="text-sm text-gray-500 hover:text-gray-700">
              {t('k_pick_different_form')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Which scale? ────────────────────────────────────────────────────── */
  if (!form) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="max-w-lg mx-auto">
          <div className="flex justify-end mb-2">
            <KioskLangToggle lang={lang} onToggle={toggle} />
          </div>
          <div className="text-center mb-6">
            <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Scale size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">{t('k_scale_title')}</h1>
            <p className="text-sm text-gray-500 mt-1">{t('k_which_scale')}</p>
          </div>
          <div className="space-y-2">
            {forms.map(f => (
              <button key={f.code} onClick={() => { setForm(f); setValues(['', '', '']); }}
                className="w-full text-left bg-white rounded-xl border border-gray-200 px-4 py-3.5 hover:border-powder-400 hover:bg-powder-50/40 active:bg-powder-50 transition-colors">
                <div className="font-semibold text-gray-900">{f.short}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {f.points.map(p => `${p.nominal}${f.unit}`).join(' · ')} — Form {f.code} {f.revision}
                </div>
              </button>
            ))}
            {forms.length === 0 && <p className="text-center text-sm text-gray-400 py-8">{t('k_loading_forms')}</p>}
          </div>
        </div>
      </div>
    );
  }

  /* ── The check ───────────────────────────────────────────────────────── */
  const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button onClick={() => setForm(null)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ChevronLeft size={15} /> {t('k_different_scale')}
          </button>
          <KioskLangToggle lang={lang} onToggle={toggle} />
        </div>
        <div className="text-center mb-6">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Scale size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{form.short}</h1>
          <p className="text-sm text-gray-500 mt-1">Form {form.code} {form.revision} — three-point check</p>
        </div>

        <div className="mb-4">
          <ScaleProcedureCard procedure={procedure} form={form} />
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 shadow-sm">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 text-red-800 text-sm">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('k_room_no')}</label>
              <input list="scale-rooms" value={meta.room} onChange={e => set('room', e.target.value)}
                className={inputCls} placeholder={t('k_eg_batching1')} />
              <datalist id="scale-rooms">
                {rooms.map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('k_weights_serial')}</label>
              <input value={meta.weights_serial} onChange={e => set('weights_serial', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Asset tag</label>
              <input value={meta.asset_tag} onChange={e => set('asset_tag', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Readings <span className="font-normal text-gray-400">— what the scale displays</span>
            </label>
            <div className="space-y-2">
              {form.points.map((p, i) => {
                const st = states[i];
                return (
                  <div key={i} className={`rounded-xl border px-3 py-2.5 ${st === null ? 'border-gray-200' : st.pass ? 'border-green-300 bg-green-50/50' : 'border-red-300 bg-red-50/50'}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-28 shrink-0">
                        <div className="font-semibold text-gray-900">{p.nominal} {form.unit}</div>
                        <div className="text-[11px] text-gray-500">± {p.tolerance} {form.unit}</div>
                      </div>
                      <input
                        type="number" step="any" inputMode="decimal" required
                        value={values[i]}
                        onChange={e => setValues(v => v.map((x, j) => (j === i ? e.target.value : x)))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-base text-right font-mono"
                        placeholder={String(p.nominal)}
                      />
                      <span className="w-6 text-sm text-gray-400">{form.unit}</span>
                    </div>
                    {st && (
                      <div className={`text-[11px] mt-1 text-right font-medium ${st.pass ? 'text-green-700' : 'text-red-700'}`}>
                        {st.deviation > 0 ? '+' : ''}{Number(st.deviation.toFixed(4))} {form.unit}
                        {st.pass ? ' — in tolerance' : ' — OUT OF TOLERANCE'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {complete && (
              <div className={`mt-3 rounded-xl px-3 py-2.5 text-center font-bold ${passes ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}>
                {passes ? 'PASS' : 'FAIL — do not use this scale'}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Your name <span className="text-red-600">*</span>
            </label>
            <input required value={meta.performed_by} onChange={e => set('performed_by', e.target.value)}
              className={inputCls} placeholder={t('k_first_last')} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('k_comments')}</label>
            <textarea value={meta.notes} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls} />
          </div>

          <button type="submit" disabled={saving || !complete}
            className="w-full py-3.5 bg-powder-600 text-white rounded-xl font-bold text-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? t('k_submitting') : t('k_submit_verification')}
          </button>
        </form>
      </div>
    </div>
  );
}
