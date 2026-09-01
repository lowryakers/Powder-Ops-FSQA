// The composer draws formatting on a layer behind a transparent textarea, so
// the caret you see belongs to the field while the words you see belong to the
// layer. If the two lay text out differently they walk apart, and what people
// report is "there is lots of space between where I am typing and where the
// cursor is showing".
//
// This measures it. For each kind of markup it compares where a character SITS
// in the layer against where the same character sits in a faithful mirror of
// the field, built from the field's own computed style. Positions are taken
// RELATIVE TO THE FIRST CHARACTER of each, so the box model cancels out and
// only real layout drift is left.
//
// Caller sets PORT + DBPATH and boots a server first.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 4871;
const B = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('cm-a','Comms Admin','Comms Admin','admin','qa',1,'SCM', datetime('now','+7 day'))`).run();
  db.close();
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(B, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (base) => {
  const H = { 'Content-Type': 'application/json' };
  await fetch(base + '/api/users/login', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Comms Admin' }) });
  await fetch(base + '/api/users/set-password', { method: 'POST', headers: H, body: JSON.stringify({ user_id: 'cm-a', password: 'CommsSecret2026', setup_code: 'SCM' }) });
  const j = await (await fetch(base + '/api/users/login', { method: 'POST', headers: H, body: JSON.stringify({ name: 'Comms Admin', password: 'CommsSecret2026' }) })).json();
  localStorage.setItem('auth_token', j.token);
  localStorage.setItem('auth_user', JSON.stringify(j.user));
  const A = { ...H, Authorization: `Bearer ${j.token}` };
  const cs = await (await fetch(base + '/api/comms/channels', { headers: A })).json();
  const list = cs.channels || cs;
  if (!Array.isArray(list) || !list.length) {
    await fetch(base + '/api/comms/channels', { method: 'POST', headers: A, body: JSON.stringify({ name: 'general', kind: 'public' }) });
  }
}, B);

await page.goto(B + '/chat', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
t('the composer is on screen', await page.locator('textarea').count() > 0);

const probe = async (text) => {
  const ta = page.locator('textarea').first();
  await ta.fill('');
  await ta.fill(text);
  await page.waitForTimeout(350);
  return page.evaluate((v) => {
    const ta = document.querySelector('textarea');
    const ov = ta?.parentElement?.querySelector('[aria-hidden="true"]');
    if (!ta || !ov) return { error: 'no overlay' };
    const cs = getComputedStyle(ta);

    const mirror = document.createElement('div');
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'textTransform', 'wordSpacing', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom',
      'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing', 'tabSize']) mirror.style[p] = cs[p];
    mirror.style.borderStyle = 'solid';
    mirror.style.borderColor = 'transparent';
    mirror.style.width = `${ta.offsetWidth}px`;
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.top = '0';
    mirror.style.left = '0';
    document.body.appendChild(mirror);

    // Where a character sits, relative to the FIRST character of the same text.
    // Anything shared by both boxes cancels; only layout drift survives.
    const at = (el, idx) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let seen = 0;
      while (w.nextNode()) {
        const n = w.currentNode, len = n.textContent.length;
        if (seen + len > idx) {
          const r = document.createRange();
          r.setStart(n, idx - seen); r.setEnd(n, idx - seen + 1);
          const b = r.getBoundingClientRect();
          return { x: b.left, y: b.top };
        }
        seen += len;
      }
      return null;
    };
    const rel = (el, idx) => {
      const a = at(el, 0), b = at(el, idx);
      return a && b ? { x: Math.round(b.x - a.x), y: Math.round(b.y - a.y) } : null;
    };

    mirror.textContent = v;
    const last = v.replace(/\s+$/, '').length - 1;
    const m = rel(mirror, last);
    const o = rel(ov, last);
    mirror.remove();
    return { mirror: m, overlay: o, dx: m && o ? o.x - m.x : null, dy: m && o ? o.y - m.y : null };
  }, text);
};

const BASE = 'The blender in room four needs a full strip down and an ATP swab before the next production run tomorrow morning, and Zuleika should log the clean in Sanitation as soon as it is finished so the seventy two hour rule does not raise another task.';
const RUN = 'needs a full strip down and an ATP swab before the next production run';
const cases = [
  ['plain', BASE],
  // The one that bit: `transform` needs an inline-block, and an inline-block
  // cannot break across lines — so a long italic run wrapped as one unit while
  // the field wrapped it word by word. 316px out in a 900px composer.
  ['italic', BASE.replace(RUN, `_${RUN}_`)],
  ['bold', BASE.replace(RUN, `*${RUN}*`)],
  ['underline', BASE.replace(RUN, `__${RUN}__`)],
  ['strike', BASE.replace(RUN, `~${RUN}~`)],
  ['code', BASE.replace(RUN, '`' + RUN + '`')],
  ['bullets', '- first item on the list\n- second item that runs on a good deal longer than the first one does here\n- third'],
  ['numbered', '1. first item\n2. second item that runs on a good deal longer than the first one does here today\n3. third'],
  ['emoji', BASE.replace('blender', 'blender 🎉')],
  ['mixed', '*Heads up* — the _blender in room four_ needs a ~full~ strip down and `an ATP swab` before the next production run tomorrow morning please, thanks everyone for the help.'],
];

// Narrow widths matter: the drift only appears once a styled run has to wrap,
// which is why it was invisible on a wide screen and obvious on a laptop.
for (const w of [1280, 1000, 900, 800]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(600);
  for (const [label, text] of cases) {
    const r = await probe(text);
    t(`${w}px · ${label}: the words stay under the caret`,
      r.dx === 0 && r.dy === 0, JSON.stringify(r));
  }
}

// Past the composer's height cap the field scrolls, and the layer has to scroll
// with it — it used to clamp 7px short and slide 149px out of register.
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(500);
const LONG = Array.from({ length: 18 }, (_, i) => `line ${i + 1} — *bold* and _italic_ text long enough to wrap once or twice inside the composer box`).join('\n');
const r = await probe(LONG);
t('a message past the height cap stays in register', r.dx === 0 && r.dy === 0, JSON.stringify(r));
const geom = await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  const ov = ta.parentElement.querySelector('[aria-hidden="true"]');
  ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.focus();
  return { taScroll: ta.scrollTop, ovScroll: ov.scrollTop, taH: ta.clientHeight, ovH: ov.clientHeight, taW: ta.clientWidth, ovW: ov.clientWidth };
});
t('the layer scrolls exactly with the field', geom.taScroll === geom.ovScroll, JSON.stringify(geom));
t('and is exactly the same box', geom.taH === geom.ovH && geom.taW === geom.ovW, JSON.stringify(geom));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
