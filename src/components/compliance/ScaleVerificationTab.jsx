import { useState, Fragment } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CheckCircle2, XCircle, AlertTriangle, Clock, QrCode } from 'lucide-react';
import ScaleProcedureCard from '../common/ScaleProcedureCard.jsx';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import KioskQrModal from '../kiosk/KioskQrModal.jsx';
import { daysAgoStr, localDateStr } from '../../utils/dates';
import { formatDateTime } from '../../lib/datetime.js';

// Scale Verification — the daily three-point checks (Forms 417-01 … 417-05)
// filed from the floor kiosk. It sits inside Calibration because that's where
// someone goes to ask "is this scale trustworthy today", and it opens on the
// answer: one card per form showing whether today's check has been run.

// The stored value is UTC (SQLite datetime('now')); printing it raw showed
// the UTC clock as if it were local. formatDateTime does the conversion.
const fmt = (ts) => formatDateTime(ts);

function StatusCards({ status }) {
  if (!status?.forms) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {status.forms.map(f => {
        const t = f.today;
        const tone = !t ? 'border-amber-200 bg-amber-50'
          : t.result === 'fail' ? 'border-red-200 bg-red-50'
            : 'border-green-200 bg-green-50';
        return (
          <div key={f.code} className={`rounded-xl border px-3 py-2.5 ${tone}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900">{f.short}</span>
              {!t ? <Clock size={15} className="text-amber-600 shrink-0" />
                : t.result === 'fail' ? <XCircle size={15} className="text-red-600 shrink-0" />
                  : <CheckCircle2 size={15} className="text-green-600 shrink-0" />}
            </div>
            <p className="text-xs text-gray-600 mt-0.5">
              {!t
                ? (f.latest ? `Not checked today · last ${fmt(f.latest.performed_at)}` : 'Never checked')
                : `${t.result === 'fail' ? 'FAILED' : 'Passed'} · ${t.performed_by}${t.room ? ` · Room ${t.room}` : ''}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default function ScaleVerificationTab() {
  const { user } = useAuth();
  const [from, setFrom] = useState(daysAgoStr(30));
  const [to, setTo] = useState(localDateStr());
  const [formCode, setFormCode] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [verifying, setVerifying] = useState(null);
  const [qr, setQr] = useState(false);
  const expand = useRowExpand();

  const query = `/scale-verification?from=${from}&to=${to}${formCode ? `&form_code=${formCode}` : ''}${resultFilter ? `&result=${resultFilter}` : ''}`;
  const { data: rows, loading, refresh } = useApiGet(query, [query]);
  const { data: status, refresh: refreshStatus } = useApiGet('/scale-verification/status');
  const { data: formList } = useApiGet('/scale-verification/forms');

  const canVerify = user?.role === 'admin' || user?.role === 'supervisor'
    || ['qa', 'quality'].includes((user?.department || '').toLowerCase());

  const verify = async (r) => {
    setVerifying(r.id);
    try {
      await apiPut(`/scale-verification/${r.id}/verify`, {});
      refresh(); refreshStatus();
    } finally { setVerifying(null); }
  };

  const list = rows || [];
  const fails = list.filter(r => r.result === 'fail').length;
  const unverified = list.filter(r => !r.verified_by).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 max-w-2xl">
          Daily three-point scale checks (Forms 417-01 … 417-05). Supervisors run them at the scale
          before production starts; QA counter-signs here. Pass/fail is computed from the tolerances
          on the controlled form, so a reading out of tolerance can't be filed as a pass.
        </p>
        <button onClick={() => setQr(true)}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1.5 shrink-0">
          <QrCode size={14} /> Print QR
        </button>
      </div>

      <StatusCards status={status} />

      {/* Reference copy. The check itself is run at the scale from the kiosk,
          where this card is open by default; here it's collapsed so the log
          stays the point of the screen. */}
      <ScaleProcedureCard procedure={formList?.procedure} form={formList?.forms?.find(f => f.code === formCode)} defaultOpen={false} />

      {(fails > 0 || unverified > 0) && (
        <div className="flex flex-wrap gap-2">
          {fails > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-sm font-medium text-red-800">
              <AlertTriangle size={14} /> {fails} failed check{fails === 1 ? '' : 's'} in this range
            </span>
          )}
          {unverified > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-sm font-medium text-amber-800">
              <Clock size={14} /> {unverified} awaiting QA verification
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        <select value={formCode} onChange={e => setFormCode(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">All scales</option>
          {(formList?.forms || []).map(f => <option key={f.code} value={f.code}>{f.short}</option>)}
        </select>
        <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">Pass and fail</option>
          <option value="pass">Pass only</option>
          <option value="fail">Fail only</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading checks…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No scale checks in this range.</div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {list.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.form_title}</p>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${r.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {r.result.toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  {fmt(r.performed_at)} · {r.performed_by}{r.room ? ` · Room ${r.room}` : ''}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {r.readings.map((x, i) => (
                    <div key={i} className="flex justify-between text-[11px]">
                      <span className="text-gray-500">{x.label}</span>
                      <span className={x.pass ? 'text-gray-800' : 'text-red-700 font-semibold'}>{x.value} {x.unit}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  {r.verified_by ? `QA: ${r.verified_by}` : 'Awaiting QA'}
                </p>
                {canVerify && !r.verified_by && (
                  <button onClick={() => verify(r)} disabled={verifying === r.id}
                    className="mt-2 px-3 py-1.5 bg-powder-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                    {verifying === r.id ? 'Verifying…' : 'Verify'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="w-8 px-2 py-3" />
                  <th className="px-4 py-3">Scale</th>
                  <th className="px-4 py-3">Performed</th>
                  <th className="px-4 py-3">By</th>
                  <th className="px-4 py-3">Room</th>
                  <th className="px-4 py-3">Readings</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">QA verified</th>
                  {canVerify && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <Fragment key={r.id}>
                    <tr {...expand.rowProps(r.id, 'border-b border-gray-100')}>
                      <td className="px-2 py-3"><ExpandCell open={expand.isExpanded(r.id)} /></td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {r.form_title.replace('Scale Verification — ', '')}
                        <div className="text-[10px] text-gray-400">Form {r.form_code}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmt(r.performed_at)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.performed_by}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.room || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 w-full">
                        <div className="flex flex-wrap gap-1.5">
                          {r.readings.map((x, i) => (
                            <span key={i}
                              className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${x.pass ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-800 font-bold'}`}
                              title={x.label}>
                              {x.value}{x.unit}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.result === 'fail' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                          {r.result}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                        {r.verified_by ? `${r.verified_by} · ${fmt(r.verified_at)}` : <span className="text-amber-600">Pending</span>}
                      </td>
                      {canVerify && (
                        <td className="px-4 py-3 text-right whitespace-nowrap" onClick={stopRowClick}>
                          {!r.verified_by && (
                            <button onClick={() => verify(r)} disabled={verifying === r.id}
                              className="px-2.5 py-1 bg-powder-600 text-white text-xs font-semibold rounded-md disabled:opacity-50">
                              {verifying === r.id ? '…' : 'Verify'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {expand.isExpanded(r.id) && (
                      <DetailRow colSpan={canVerify ? 9 : 8}>
                        <DetailFields fields={[
                          { label: 'Form', value: `${r.form_code} — ${r.form_title}` },
                          { label: 'Room', value: r.room },
                          { label: 'Weights serial #', value: r.weights_serial },
                          { label: 'Asset tag', value: r.asset_tag },
                          { label: 'Performed by', value: r.performed_by },
                          { label: 'Performed', value: fmt(r.performed_at) },
                          { label: 'Result', value: r.result.toUpperCase() },
                          { label: 'QA verified', value: r.verified_by ? `${r.verified_by} · ${fmt(r.verified_at)}` : 'Pending' },
                          { label: 'Filed from', value: r.source === 'kiosk' ? 'Kiosk / QR' : 'In app' },
                          { label: 'Comments', value: r.notes, wide: true },
                        ]}>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">Three-point check</div>
                            <table className="text-xs">
                              <tbody>
                                {r.readings.map((x, i) => (
                                  <tr key={i}>
                                    <td className="pr-4 py-0.5 text-gray-600 whitespace-nowrap">{x.label}</td>
                                    <td className="pr-4 py-0.5 font-mono text-gray-900">{x.value} {x.unit}</td>
                                    <td className="pr-4 py-0.5 font-mono text-gray-500">
                                      {x.deviation > 0 ? '+' : ''}{x.deviation}
                                    </td>
                                    <td className={`py-0.5 font-semibold ${x.pass ? 'text-green-700' : 'text-red-700'}`}>
                                      {x.pass ? 'In tolerance' : 'OUT OF TOLERANCE'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </DetailFields>
                      </DetailRow>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {qr && (
        <KioskQrModal
          cfg={{
            kioskPath: '/kiosk/scale',
            label: 'Scale Verification',
            formCode: 'Forms 417-01 … 417-05',
            kioskTagline: 'Scan Before You Start',
            kioskBlurb: 'Post this at each scale. Scanning it opens the three-point verification form — no login required.',
          }}
          onClose={() => setQr(false)}
        />
      )}
    </div>
  );
}
