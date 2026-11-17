// verify:calexport — what the calibration company needs, and calibration
// findings in QA Review (D-353). Caller sets PORT + DBPATH.
// Control: main before this — /calibration/export is 404 and QA Review has no
// calibration source.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5223);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'CalExport2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('ce-qa','Quinn Cal','Quinn Cal','supervisor','qa',1,'SC-ce',datetime('now','+7 day'),?)`).run(JSON.stringify({ calibration: 'edit', 'qa-review': 'edit' }));
const ins = db.prepare(`INSERT OR REPLACE INTO calibration_instruments (id,name,type,serial_number,manufacturer,model,location,asset_number,max_capacity,unit_of_measure,tolerance,next_due,last_calibrated,status,department)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
ins.run('ce-over', 'Bench scale CE', 'Scale', 'SN-OVER-1', 'Ohaus', 'R31', 'Room 3', '9001', '30 kg', 'kg', '± 0.005 kg', '2026-01-01', '2025-01-01', 'active', 'batching');
ins.run('ce-soon', 'Thermometer CE', 'Thermometer', 'SN-SOON-2', 'ThermoWorks', 'TW8', 'QA lab', '9002', '-40 to 150', '°C', '± 0.5 °C', '2099-01-01', '2026-01-01', 'active', 'qa');
ins.run('ce-oos', 'Old scale CE', 'Scale', 'SN-OOS-3', 'Ohaus', 'R11', 'Room 5', '9003', '15 kg', 'kg', '± 0.01', '2026-02-01', '2025-02-01', 'out_of_service', 'filling');
db.prepare(`INSERT OR REPLACE INTO calibration_records (id, instrument_id, calibrated_by, calibrated_at, result, certificate_number, disposition)
  VALUES ('ce-rec', 'ce-over', 'Precision Cal Co', '2025-01-01 10:00:00', 'adjusted_pass', 'PC-7781', 'pending')`).run();
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
  return { status: r.status, json, buf, type: r.headers.get('content-type') || '' };
};
await call('POST', '/users/set-password', { user_id: 'ce-qa', password: PW, setup_code: 'SC-ce' });
const tok = (await call('POST', '/users/login', { name: 'Quinn Cal', password: PW })).json?.token;
t('QA signs in', !!tok);
const before = q('SELECT COUNT(*) n FROM audit_log')[0].n;

console.log('\n── the export ──');
let r = await call('GET', '/calibration/export?scope=due&within=60', null, tok);
const ids = (r.json?.rows || []).map(x => x.id);
t('due within 60 days lists the overdue instrument', r.status === 200 && ids.includes('ce-over'), `${r.status}`);
t('…not one due in 2099', !ids.includes('ce-soon'));
t('…not an out-of-service one unless asked', !ids.includes('ce-oos'));
const row = (r.json?.rows || []).find(x => x.id === 'ce-over');
t('each row carries serial, make, model, range, tolerance and the last certificate', row?.serial_number === 'SN-OVER-1' && row?.manufacturer === 'Ohaus'
  && row?.max_capacity === '30 kg' && row?.tolerance === '± 0.005 kg' && row?.last_certificate === 'PC-7781' && row?.status_label === 'Overdue', JSON.stringify(row));
t('the certificate requirements travel with it', (r.json?.requirements || []).some(x => /NIST/.test(x)) && (r.json?.requirements || []).some(x => /out of tolerance/i.test(x)));
r = await call('GET', '/calibration/export?scope=all&oos=1', null, tok);
const all = (r.json?.rows || []).map(x => x.id);
t('"every instrument" with out of service ticked lists all three', ['ce-over', 'ce-soon', 'ce-oos'].every(i => all.includes(i)));
r = await call('GET', '/calibration/export.csv?scope=all', null, tok);
const csv = r.buf.toString();
t('the CSV downloads with a header row and the serial', r.status === 200 && /csv/.test(r.type) && /Serial #/.test(csv) && /SN-SOON-2/.test(csv));
r = await call('GET', '/calibration/export.pdf?scope=due', null, tok);
t('the PDF request downloads', r.status === 200 && r.buf.slice(0, 4).toString() === '%PDF');
t('EXPORTING WRITES NOTHING', q('SELECT COUNT(*) n FROM audit_log')[0].n === before && q("SELECT status FROM calibration_instruments WHERE id='ce-over'")[0].status === 'active');

console.log('\n── QA Review ──');
r = await call('GET', '/qa-review?source=calibration-findings', null, tok);
const src = (r.json?.sources || []).find(s => s.key === 'calibration-findings');
const rows = src?.items || [];
t('QA Review has a Calibration findings pile', !!src && src.count >= 2, JSON.stringify(src && { count: src.count }));
const kinds = rows.map(x => x.action_kind);
t('…with the product decision the adjusted calibration owes', kinds.includes('CAL_DISPOSITION'), JSON.stringify(kinds));
t('…and the overdue instrument', kinds.includes('CAL_OVERDUE'));
r = await call('POST', '/qa-review/sign', { source: 'calibration-findings', ids: [rows[0]?.id] }, tok);
t('nothing is signed from the list', r.status >= 400 || (r.json?.signed || 0) === 0, `${r.status} ${JSON.stringify(r.json)}`);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
const me = (await call('GET', '/users/me', null, tok)).json;
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, me]);
await page.goto(`${URL}/?tab=calibration`);
await page.waitForTimeout(3000);
await page.locator('[data-cal-export-open]').click();
await page.waitForTimeout(1200);
t('"For the calibration company" opens the export', await page.locator('[data-cal-export]').count() === 1);
t('…counting what it will send', /instrument/.test(await page.locator('[data-cal-export-count]').innerText()));
t('…with a PDF and a spreadsheet', await page.locator('[data-cal-export-pdf]').count() === 1 && await page.locator('[data-cal-export-csv]').count() === 1);
t('nothing pans sideways on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
