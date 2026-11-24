import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useApiGet, apiPost } from '../../hooks/useApi';

// "Log a failed check" (D-389, A-20261124-002). The X-ray / metal-detector
// operation log stays in Keychain with the batch record; when a check FAILS, the
// person at the machine logs it here and the lot goes On Hold (Form 424-01). QA
// releases it on the On Hold log, as any hold. Folded to one line until opened.
const T = {
  en: {
    title: 'Failed X-ray or metal detector check?', open: 'Log a failed check', close: 'Close',
    how: 'The check itself is still recorded in Keychain. Logging the failure here puts the lot on hold for QA.',
    check: 'Which check', xray: 'X-ray', metal: 'Metal detector', machine: 'Machine', other: 'Other (type it)',
    lot: 'Lot', product: 'Product (optional)', qty: 'Quantity held (optional)', what: 'What happened',
    save: 'Put the lot on hold', filed: (n) => `${n} filed — the lot is on hold. QA releases it on the On Hold log.`,
  },
  es: {
    title: '¿Falló la revisión de rayos X o del detector de metales?', open: 'Registrar una revisión fallida', close: 'Cerrar',
    how: 'La revisión se sigue registrando en Keychain. Registrar la falla aquí pone el lote en retención para QA.',
    check: 'Qué revisión', xray: 'Rayos X', metal: 'Detector de metales', machine: 'Máquina', other: 'Otra (escríbala)',
    lot: 'Lote', product: 'Producto (opcional)', qty: 'Cantidad retenida (opcional)', what: 'Qué pasó',
    save: 'Poner el lote en retención', filed: (n) => `${n} registrado — el lote está en retención. QA lo libera en el registro de retenciones.`,
  },
};

export default function FailedCheckCard({ lang = 'en' }) {
  const t = T[lang === 'es' ? 'es' : 'en'];
  const [open, setOpen] = useState(false);
  const { data } = useApiGet(open ? '/qms/on_hold/failed-check' : null, [open]);
  const [f, setF] = useState({ check: 'xray', equipment_id: '', machine_name: '', lot: '', product: '', qty: '', what_happened: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF(x => ({ ...x, [k]: e.target.value }));
  const machines = data?.machines || [];
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const body = { ...f, equipment_id: f.equipment_id && f.equipment_id !== '__other' ? f.equipment_id : null };
      const r = await apiPost('/qms/on_hold/failed-check', body);
      setMsg({ ok: true, text: t.filed(r.record_number) });
      setF(x => ({ ...x, lot: '', product: '', qty: '', what_happened: '' }));
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  };
  const input = 'mt-0.5 w-full px-2 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 space-y-2" data-failed-check-card>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldAlert size={16} className="text-rose-700" />
        <span className="text-sm font-semibold text-gray-900">{t.title}</span>
        <button type="button" onClick={() => setOpen(o => !o)} data-failed-check-open
          className="ml-auto px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold">{open ? t.close : t.open}</button>
      </div>
      {open && (
        <form onSubmit={save} className="space-y-2" data-failed-check-form>
          <p className="text-xs text-gray-700">{t.how}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-xs text-gray-600">{t.check}
              <select id="fc-check" value={f.check} onChange={set('check')} className={input} data-failed-check-kind>
                <option value="xray">{t.xray}</option>
                <option value="metal_detector">{t.metal}</option>
              </select>
            </label>
            <label className="text-xs text-gray-600">{t.machine}
              <select id="fc-machine" value={f.equipment_id} onChange={set('equipment_id')} className={input} data-failed-check-machine required>
                <option value="">—</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name}{m.asset_number ? ` #${m.asset_number}` : ''}</option>)}
                <option value="__other">{t.other}</option>
              </select>
            </label>
            {f.equipment_id === '__other' && (
              <label className="text-xs text-gray-600">{t.machine}
                <input id="fc-machine-name" value={f.machine_name} onChange={set('machine_name')} className={input} data-failed-check-machine-name required />
              </label>
            )}
            <label className="text-xs text-gray-600">{t.lot}
              <input id="fc-lot" value={f.lot} onChange={set('lot')} className={input} data-failed-check-lot required />
            </label>
            <label className="text-xs text-gray-600">{t.product}
              <input id="fc-product" value={f.product} onChange={set('product')} className={input} />
            </label>
            <label className="text-xs text-gray-600">{t.qty}
              <input id="fc-qty" value={f.qty} onChange={set('qty')} className={input} />
            </label>
          </div>
          <label className="block text-xs text-gray-600">{t.what}
            <textarea id="fc-what" value={f.what_happened} onChange={set('what_happened')} rows={2} className={input} data-failed-check-what required />
          </label>
          <button type="submit" disabled={busy} data-failed-check-save
            className="px-3 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">{t.save}</button>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.ok ? 'text-gray-900' : 'text-rose-700'}`} data-failed-check-msg>{msg.text}</p>}
    </section>
  );
}
