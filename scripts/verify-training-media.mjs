// A TRAINING VIDEO IS THE ONE UPLOAD HERE THAT IS GENUINELY LARGE.
//
// Reported from the plant: Daniela attached a video to a course and was told
// the file was too large. Two causes, both in this file's sights:
//
//   1. the ceiling. 200 MB is about ninety seconds of 1080p off a phone, and a
//      machine procedure is five to ten minutes — so the limit refused the
//      only thing course materials exist to hold.
//   2. the EXTENSION LIST. `isVideo()` decides which ceiling applies, so a
//      camcorder's .mts or a screen recorder's .wmv was not a video at all and
//      fell to the 25 MB rule — refused with a message about "non-video files"
//      for a file the person is watching in a video player.
//
// Executed against a live server with a real S3 stand-in, so the bytes go the
// whole way: multer to disk, streamed out in 8 MB parts, read back signed.
//
// Caller sets PORT + DBPATH and the R2_* stand-in variables.
const PORT = process.env.PORT || 4908;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { isVideo, MAX_FILE_BYTES, MAX_VIDEO_BYTES, MAX_LONG_VIDEO_BYTES, rejectOversize, humanSize } =
  await import('../server/media.js');

console.log('\nWhat counts as a video — the question that decides which ceiling applies');
{
  // A phone, a camcorder, a screen recorder and Windows. Every one of these is
  // a video somebody would reasonably attach to a course.
  const vids = ['clip.mp4', 'Clip.MOV', 'a.m4v', 'a.webm', 'a.mkv', 'a.avi', 'a.3gp',
    'walkthrough.wmv', 'line.mpg', 'line.mpeg', 'cam.mts', 'cam.m2ts', 'cam.ts', 'a.ogv', 'a.vob'];
  const missed = vids.filter(f => !isVideo('', f));
  t('every camera and recorder extension reads as video on the filename alone', missed.length === 0, missed.join(', '));
  t('a mime type alone is enough when the extension is unknown', isVideo('video/x-matroska', 'recording'));
  t('a PDF is still not a video', !isVideo('application/pdf', 'handout.pdf'));
  t('…nor is a name that merely contains one', !isVideo('', 'mp4-notes.txt'));
}

console.log('\nThe two ceilings, and which files meet which');
{
  const f = (name, size, mime = '') => ({ originalname: name, size, mimetype: mime });
  t('a 300 MB video is refused under the old 200 MB ceiling', MAX_VIDEO_BYTES < 300 * 1024 * 1024);
  t('and allowed under the course-material ceiling', MAX_LONG_VIDEO_BYTES > 300 * 1024 * 1024);
  t('a 300 MB .wmv is judged against the VIDEO limit, not the 25 MB one',
    rejectOversize([f('walkthrough.wmv', 300 * 1024 * 1024)], { videoMax: MAX_LONG_VIDEO_BYTES }) === null);
  const over = rejectOversize([f('huge.mp4', MAX_LONG_VIDEO_BYTES + 1)], { videoMax: MAX_LONG_VIDEO_BYTES });
  t('a video past the course ceiling is refused', !!over, String(over));
  t('…and the refusal NAMES THE FILE AND ITS SIZE, not just the limit',
    /huge\.mp4/.test(over || '') && /GB|MB/.test(over || ''), String(over));
  const doc = rejectOversize([f('scan.pdf', 40 * 1024 * 1024, 'application/pdf')], { videoMax: MAX_LONG_VIDEO_BYTES });
  t('a 40 MB PDF is still refused — the non-video limit did not move', !!doc, String(doc));
  t('…and says how big it actually is', new RegExp(humanSize(40 * 1024 * 1024)).test(doc || ''), String(doc));
  t('nothing oversize means nothing to report',
    rejectOversize([f('ok.pdf', 1024, 'application/pdf'), f('ok.mov', 300 * 1024 * 1024)], { videoMax: MAX_LONG_VIDEO_BYTES }) === null);
}

// ── Live ─────────────────────────────────────────────────────────────────────
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('tm-admin','Media Admin','Media Admin','admin','quality',1,'SC-TM',datetime('now','+7 day'),'{"training":"edit"}')`).run();
const course = db.prepare("SELECT id FROM training_courses LIMIT 1").get();
db.close();

await post('/users/login', { name: 'Media Admin' });
await post('/users/set-password', { user_id: 'tm-admin', password: 'MediaPW2026!', setup_code: 'SC-TM' });
token = (await J(await post('/users/login', { name: 'Media Admin', password: 'MediaPW2026!' })))?.token;
t('signed in', !!token);
t('a course exists to attach to', !!course?.id);

const upload = async (name, bytes, type) => {
  const fd = new FormData();
  fd.append('files', new Blob([bytes], { type }), name);
  const r = await req(`/training/courses/${course.id}/materials`, { method: 'POST', body: fd });
  return { status: r.status, body: await J(r) };
};

console.log('\nA video that the old ceiling refused, uploaded end to end');
{
  // 40 MB: comfortably past the 25 MB non-video limit, small enough to push
  // through a test in seconds. The point is which RULE it is judged by.
  const big = Buffer.alloc(40 * 1024 * 1024, 7);
  const r = await upload('line-7-changeover.mp4', big, 'video/mp4');
  t('a 40 MB mp4 is accepted', r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
  t('…and is recorded as a video', r.body?.[0]?.is_video === true, JSON.stringify(r.body?.[0] || {}));
  t('…at its real size', Number(r.body?.[0]?.size) === big.length, String(r.body?.[0]?.size));
}

console.log('\nA .wmv — the extension that used to fall to the 25 MB rule');
{
  const r = await upload('gown-room.wmv', Buffer.alloc(30 * 1024 * 1024, 3), 'application/octet-stream');
  t('accepted although the browser sent no video mime type', r.status === 201,
    `${r.status} ${JSON.stringify(r.body)}`);
  t('…and is treated as a video', r.body?.[0]?.is_video === true);
}

console.log('\nThe non-video limit is unchanged, and the refusal is readable');
{
  const r = await upload('handout.pdf', Buffer.alloc(30 * 1024 * 1024, 1), 'application/pdf');
  t('a 30 MB PDF is still refused', r.status === 413, String(r.status));
  t('…naming the file, its size and the limit',
    /handout\.pdf/.test(r.body?.error || '') && /30 MB/.test(r.body?.error || '') && /25 MB/.test(r.body?.error || ''),
    r.body?.error);
}

console.log('\nThe material comes back, and the bytes are the ones sent');
{
  const list = await J(await req(`/training/courses/${course.id}/materials`));
  t('both videos are on the course', Array.isArray(list) && list.length >= 2, `${list?.length} materials`);
  const mp4 = (list || []).find(m => m.filename === 'line-7-changeover.mp4');
  t('the mp4 has a signed URL', !!mp4?.url);
  if (mp4?.url) {
    const got = await fetch(mp4.url);
    const buf = Buffer.from(await got.arrayBuffer());
    t('…and it serves the whole 40 MB back', got.ok && buf.length === 40 * 1024 * 1024, `${buf.length} bytes`);
  }
}

console.log('\nThe screen states the limit the server actually enforces');
{
  const src = await (await import('fs/promises')).readFile('src/components/compliance/TrainingPanel.jsx', 'utf8');
  const hint = (src.match(/data-material-limits[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
  t('the hint names the course ceiling', /2\s*GB/i.test(hint), hint.trim().slice(0, 120));
  t('…and the unchanged 25 MB limit for everything else', /25\s*MB/i.test(hint), hint.trim().slice(0, 120));
  t('a hint naming the OLD 200 MB ceiling is gone — it would send somebody to trim a video that fits',
    !/200\s*MB/i.test(hint), hint.trim().slice(0, 120));
  t('and it says a long upload cannot resume', /resume/i.test(hint), hint.trim().slice(0, 120));
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
