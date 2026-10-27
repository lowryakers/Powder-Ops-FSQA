// The public certificate page (D-247, COA Phase 2 task E4). Mounted at
// `/tested`, outside `/api`, before the app's own pages. The ONE public COA
// router: it reads `coa_publications`, `coa_brands`, `coa_settings` and
// `coa_products` and nothing else, and it writes nothing
// (`scripts/check-public-coa.mjs` fails otherwise).
//
//  · EVERY response is the same 404 unless the master switch is on, ProDough
//    may publish, and the certificate is a publication. Off, the page does not
//    exist — it does not say why.
//  · No cookies, inline CSS only, a strict CSP, noindex unless the indexable
//    switch is on, a rate limit, and no internal id anywhere (the public id is
//    random and is the only handle).
import { Router } from 'express';
import { getDb } from '../db.js';
import { publicState, isLive } from '../coa-public-snapshot.js';
import { certificateHtml, tombstoneHtml, lotHtml, skuHtml, verifyHtml, embedHtml, NOT_FOUND_HTML, certificatePdf } from '../coa-public-render.js';

const router = Router();
const BASE = '/tested';
const ID_RE = /^[A-Za-z0-9]{6,32}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOT_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,40}$/;

// In memory, per address: the page is small and a restart forgetting the
// counts costs nothing. 60 a minute for pages, 20 for the verify form.
const hits = new Map();
function limited(req, bucket, max) {
  // Railway sits in front, so the first forwarded address is the visitor's.
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
  const key = `${bucket}|${ip}`;
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
  return list.length > max;
}

function headers(res, state, { frame = false } = {}) {
  const ancestors = frame && state.frame_ancestors && state.frame_ancestors !== 'none'
    ? state.frame_ancestors.split(/\s+/).filter(a => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(a)).join(' ') || "'none'" : "'none'";
  res.set({
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors ${ancestors}`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'public, max-age=300',
    'X-Robots-Tag': state.indexable === 'on' ? 'all' : 'noindex, nofollow',
  });
  if (!frame) res.set('X-Frame-Options', 'DENY');
  res.removeHeader('Set-Cookie');
}

const notFound = (res) => res.status(404).type('html').set('Cache-Control', 'no-store').send(NOT_FOUND_HTML);

// Every route: the rate limit, then the switches. A closed page is a 404,
// with the same body as a certificate that does not exist.
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
  if (limited(req, 'page', 60)) return res.status(429).type('text').set('Retry-After', '60').send('Too many requests. Try again in a minute.');
  const state = publicState(getDb());
  if (!isLive(state)) return notFound(res);
  res.locals.state = state;
  headers(res, state);
  next();
});

const pub = (db, publicId) => db.prepare('SELECT * FROM coa_publications WHERE public_id = ?').get(publicId);
const snapOf = (p) => JSON.parse(p.snapshot);
const productBySlug = (db, slug) => db.prepare("SELECT display_name, slug FROM coa_products WHERE slug = ? AND brand_owner = 'ProDough'").get(slug);

/** The live publication that replaced this one, following the chain. */
function replacement(db, p) {
  let cur = p; const seen = new Set();
  while (cur?.superseded_by_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = db.prepare('SELECT * FROM coa_publications WHERE id = ?').get(cur.superseded_by_id);
  }
  return cur && cur.status === 'published' ? cur : null;
}

router.get('/c/:handle', (req, res) => {
  const m = String(req.params.handle).match(/^(.+?)(\.json|\.pdf)?$/);
  const publicId = m?.[1]; const kind = m?.[2] || '';
  if (!publicId || !ID_RE.test(publicId)) return notFound(res);
  const db = getDb();
  const p = pub(db, publicId);
  if (!p || p.brand_owner !== 'ProDough') return notFound(res);
  if (p.status === 'withdrawn') {
    if (kind === '.json') return res.status(410).json({ status: 'withdrawn', withdrawn_on: String(p.withdrawn_at || '').slice(0, 10) });
    if (kind === '.pdf') return notFound(res);
    return res.status(410).type('html').send(tombstoneHtml({ base: BASE, withdrawnOn: p.withdrawn_at }));
  }
  const s = snapOf(p);
  let banner = null; let replacedBy = null;
  if (p.status === 'superseded') {
    const next = replacement(db, p);
    replacedBy = next?.public_id || null;
    banner = next ? `This certificate was replaced. <a href="${BASE}/c/${next.public_id}">See the current certificate</a>.` : 'This certificate was replaced.';
  }
  if (kind === '.json') return res.json({ status: p.status, ...(replacedBy ? { replaced_by: replacedBy } : {}), certificate: s });
  if (kind === '.pdf') {
    res.type('application/pdf').set('Content-Disposition', `inline; filename="COA-${s.certificate_number}.pdf"`);
    try { certificatePdf(s, res, { banner: p.status === 'superseded' ? 'This certificate was replaced by a newer one.' : null }); } catch { res.end(); }
    return;
  }
  res.type('html').send(certificateHtml(s, { base: BASE, banner }));
});

router.get('/lot/:slug/:baseLot', (req, res) => {
  const { slug, baseLot } = req.params;
  if (!SLUG_RE.test(slug) || !LOT_RE.test(baseLot)) return notFound(res);
  const db = getDb();
  const product = productBySlug(db, slug);
  if (!product) return notFound(res);
  const rows = db.prepare("SELECT public_id, batch, certificate_number FROM coa_publications WHERE product_slug = ? AND base_lot = ? AND status = 'published' AND brand_owner = 'ProDough' ORDER BY batch")
    .all(slug, baseLot);
  if (!rows.length) return notFound(res);
  res.type('html').send(lotHtml({ base: BASE, product: product.display_name, lot: baseLot, batches: rows }));
});

function lotsFor(db, slug) {
  return db.prepare(`SELECT base_lot, COUNT(*) batches, MAX(json_extract(snapshot, '$.date_of_issuance')) issued FROM coa_publications
    WHERE product_slug = ? AND status = 'published' AND brand_owner = 'ProDough' GROUP BY base_lot ORDER BY issued DESC, base_lot DESC LIMIT 200`).all(slug);
}

router.get('/sku/:slug', (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return notFound(res);
  const db = getDb();
  const product = productBySlug(db, slug);
  if (!product) return notFound(res);
  const lots = lotsFor(db, slug);
  if (!lots.length) return notFound(res);
  res.type('html').send(skuHtml({ base: BASE, product: product.display_name, slug, lots }));
});

router.get('/verify', (req, res) => {
  const cert = String(req.query.cert ?? '').trim().slice(0, 32);
  const lot = String(req.query.lot ?? '').trim().slice(0, 40);
  res.set('Cache-Control', 'no-store');
  if (!cert && !lot) return res.type('html').send(verifyHtml({ base: BASE }));
  if (limited(req, 'verify', 20)) return res.status(429).type('text').set('Retry-After', '60').send('Too many checks. Try again in a minute.');
  // Both are required: a certificate number alone must not be a way to list lots.
  if (!cert || !lot) return res.status(400).type('html').send(verifyHtml({ base: BASE, cert, lot, asked: true, found: null }));
  const db = getDb();
  const p = db.prepare(`SELECT public_id, snapshot FROM coa_publications WHERE certificate_number = ? AND status = 'published' AND brand_owner = 'ProDough'
    AND (LOWER(json_extract(snapshot, '$.lot_number')) = LOWER(?) OR LOWER(base_lot) = LOWER(?))`).get(cert, lot, lot);
  const s = p ? JSON.parse(p.snapshot) : null;
  res.type('html').send(verifyHtml({ base: BASE, cert, lot, asked: true,
    found: s ? { public_id: p.public_id, certificate_number: s.certificate_number, lot_number: s.lot_number, product: s.product } : null }));
});

router.get('/embed/:slug', (req, res) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return notFound(res);
  const db = getDb();
  const product = productBySlug(db, slug);
  if (!product) return notFound(res);
  headers(res, res.locals.state, { frame: true });
  res.type('html').send(embedHtml({ base: BASE, product: product.display_name, slug, latest: lotsFor(db, slug)[0]?.base_lot || null }));
});

router.get('/badge/:file', (req, res) => {
  const slug = String(req.params.file).replace(/\.json$/, '');
  if (!req.params.file.endsWith('.json') || !SLUG_RE.test(slug)) return notFound(res);
  const db = getDb();
  const product = productBySlug(db, slug);
  if (!product) return notFound(res);
  const lots = lotsFor(db, slug);
  res.json({ product: product.display_name, tested_by: 'Powder Ops', lots_published: lots.length, latest_lot: lots[0]?.base_lot || null, url: `${BASE}/sku/${slug}` });
});

router.get('/robots.txt', (_req, res) => {
  res.type('text').send(res.locals.state.indexable === 'on' ? 'User-agent: *\nAllow: /tested/\n' : 'User-agent: *\nDisallow: /\n');
});

router.use((_req, res) => notFound(res));

export default router;
