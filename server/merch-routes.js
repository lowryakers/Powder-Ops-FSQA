// Merch in Products: styles, the colour register, variants and GS1 numbers (D-302).
//
// Registered on the products router BEFORE `/:sku` (Express matches in
// declaration order and `merch` is a perfectly good SKU). A variant is an
// ordinary `products` row — product_type 'merch', its style, colour and size —
// so every list, audit entry and readiness check reads it like any other
// product, and the food-only steps step aside through their `applies`.
//
// THREE RULES THE ROUTES BELOW EXIST TO HOLD:
//  1. A merch SKU is BUILT from style + colour + size, never typed, and the
//     flavour in it is an ACTIVE code from the flavour register. This flow
//     never mints or edits a flavour code.
//  2. A GTIN is NEVER auto-assigned. "Suggest" returns the lowest free number;
//     "reserve" holds one (a bot may); "assign" is a person's act (APPROVE_ROUTES)
//     and re-checks inside its write transaction.
//  3. Assignment waits for the colour and size, and for the colour to be
//     confirmed: a number drawn for "Blue" that becomes "Navy" is spent on a
//     product that never existed.

import { logAudit } from './db.js';
import {
  MERCH_LINE, MERCH_CATEGORY, MERCH_PACK, GARMENTS, MERCH_SIZES, SIZE_BY_CODE,
  COLOR_CODE_RE, HEX_COLOR_RE, buildStyleCode, parseStyleCode, buildMerchSku,
  variantTitle, gtinAssignRefusal, suggestNextGtin,
} from '../shared/merch.js';
import { checkDigit, gtinValid, normalizeGtin } from '../shared/gtin.js';
import { gtinPrefixes, takenGtins } from './product-shelf.js';

// Style fields a person types. The code, garment and flavour are the style's
// identity and never move; a different flavour or garment is a different style.
const STYLE_FIELDS = {
  name: 'text', supplier: 'text', blank_brand: 'text', blank_style: 'text',
  decorator: 'text', decoration_method: 'text', decoration_art_url: 'text',
  fabric: 'text', weight_gsm: 'number', fit: 'text', care: 'text', country_of_origin: 'text',
  unit_cost: 'number', msrp: 'number', moq: 'number', lead_time_days: 'number',
  shipping_weight_g: 'number', notes: 'text',
};

const PREFIX_WARN_FREE = 25;

function cleanStyleFields(body) {
  const out = {};
  for (const [k, kind] of Object.entries(STYLE_FIELDS)) {
    if (body[k] === undefined) continue;
    const raw = body[k];
    if (raw === null || String(raw).trim() === '') { out[k] = null; continue; }
    if (kind === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: `${k.replace(/_/g, ' ')} is a number of zero or more.`, field: k };
      out[k] = n;
    } else {
      out[k] = String(raw).trim().slice(0, 1000);
    }
  }
  return { fields: out };
}

/** The active register code for a flavour, by name or by code. */
function registerCode(db, { flavor, flavor_code: code }) {
  const byCode = code ? db.prepare('SELECT * FROM flavor_codes WHERE code = ? AND is_active = 1').get(String(code).trim().toUpperCase()) : null;
  const byName = flavor ? db.prepare('SELECT * FROM flavor_codes WHERE lower(flavor) = lower(?) AND is_active = 1').get(String(flavor).trim()) : null;
  if (code && flavor && byCode && byName && byCode.code !== byName.code) return { error: `${flavor} is ${byName.code} in the flavor register, not ${byCode.code}.` };
  const row = byCode || byName;
  if (!row) {
    const asked = code ? `code ${String(code).toUpperCase()}` : `"${flavor}"`;
    return { error: `${asked} is not an active code in the flavor register. Issue it there first (Products → Flavor codes); merch never mints a flavor code.` };
  }
  return { row };
}

const colorsMap = (db) => new Map(db.prepare('SELECT * FROM merch_colors').all().map((c) => [c.code, c]));

/** Every prefix this catalogue already draws from. A merch GTIN uses one of these, never a new one. */
function carriedPrefixes(db) {
  return gtinPrefixes(db).map((p) => p.prefix);
}

function prefixReport(db, prefix) {
  const row = gtinPrefixes(db).find((p) => p.prefix === prefix);
  if (!row) return null;
  return { prefix, used: row.used, free: row.free, low: row.free <= PREFIX_WARN_FREE,
    warning: row.free <= PREFIX_WARN_FREE ? `Prefix ${prefix} has ${row.free} numbers left. Order more from GS1 before it runs out.` : null };
}

export function registerMerchRoutes(router, { getDb, canManage, hydrate, SELECT, moveProductRow, stampReadiness }) {
  // ── Read ───────────────────────────────────────────────────────────────────
  router.get('/merch', (_req, res) => {
    const db = getDb();
    const styles = db.prepare('SELECT * FROM merch_styles ORDER BY style_code').all();
    const variants = hydrate(db.prepare(`${SELECT} WHERE p.product_type = 'merch' ORDER BY p.style_code, p.sku`).all(), db);
    const byStyle = new Map();
    for (const v of variants) {
      if (!byStyle.has(v.style_code)) byStyle.set(v.style_code, []);
      byStyle.get(v.style_code).push(v);
    }
    const sizeSort = (v) => SIZE_BY_CODE[v.size_code]?.sort ?? 99;
    res.json({
      styles: styles.map((s) => {
        const vs = (byStyle.get(s.style_code) || []).sort((a, b) => String(a.color_code).localeCompare(String(b.color_code)) || sizeSort(a) - sizeSort(b));
        return {
          ...s, garment_label: GARMENTS[s.garment] || null, variants: vs,
          counts: { variants: vs.length, with_gtin: vs.filter((v) => v.gtin).length, confirming: new Set(vs.filter((v) => v.color?.confirming).map((v) => v.color_code)).size },
        };
      }),
      colors: db.prepare('SELECT * FROM merch_colors ORDER BY code').all().map((c) => ({ ...c, confirming: !!c.confirming })),
      sizes: MERCH_SIZES, garments: GARMENTS,
      prefixes: carriedPrefixes(db),
      reservations: db.prepare('SELECT * FROM gtin_reservations ORDER BY reserved_at DESC').all(),
      can_manage: canManage(_req.user),
    });
  });

  // ── Styles ─────────────────────────────────────────────────────────────────
  router.post('/merch/styles', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const b = req.body || {};
    const garment = String(b.garment || '').trim().toUpperCase();
    if (!GARMENTS[garment]) return res.status(400).json({ field: 'garment', error: `Garment is one of ${Object.entries(GARMENTS).map(([k, v]) => `${k} (${v})`).join(', ')}.` });
    const reg = registerCode(db, b);
    if (reg.error) return res.status(400).json({ field: 'flavor', code: 'FLAVOR_NOT_REGISTERED', error: reg.error });
    const styleCode = buildStyleCode(garment, reg.row.code);
    if (!styleCode) return res.status(400).json({ error: `${reg.row.code} cannot make a style code (two or three letters).` });
    if (b.style_code && String(b.style_code).trim().toUpperCase() !== styleCode) {
      return res.status(400).json({ field: 'style_code', error: `${garment} + ${reg.row.flavor} (${reg.row.code}) is ${styleCode}, not ${String(b.style_code).toUpperCase()}.` });
    }
    if (db.prepare('SELECT 1 FROM merch_styles WHERE style_code = ?').get(styleCode)) return res.status(409).json({ error: `${styleCode} already exists.` });
    const clean = cleanStyleFields(b);
    if (clean.error) return res.status(400).json(clean);
    const name = clean.fields.name || `ProDough ${reg.row.flavor} ${GARMENTS[garment]}`;
    const f = { ...clean.fields, name };
    const cols = Object.keys(f);
    db.prepare(`INSERT INTO merch_styles (style_code, flavor, flavor_code, garment, ${cols.join(', ')}, created_by)
                VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')}, ?)`)
      .run(styleCode, reg.row.flavor, reg.row.code, garment, ...cols.map((c) => f[c]), req.user.name);
    const row = db.prepare('SELECT * FROM merch_styles WHERE style_code = ?').get(styleCode);
    logAudit(req.user, 'merch_style_created', 'merch_style', styleCode, null, null, row, name);
    res.status(201).json(row);
  });

  router.put('/merch/styles/:code', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const before = db.prepare('SELECT * FROM merch_styles WHERE style_code = ?').get(req.params.code);
    if (!before) return res.status(404).json({ error: 'No such style.' });
    const b = req.body || {};
    for (const k of ['style_code', 'garment', 'flavor', 'flavor_code']) {
      if (b[k] !== undefined && String(b[k]) !== String(before[k])) {
        return res.status(400).json({ field: k, error: 'A style\'s code, garment and flavor are its identity. Open a new style instead.' });
      }
    }
    const clean = cleanStyleFields(b);
    if (clean.error) return res.status(400).json(clean);
    if (clean.fields.name === null) return res.status(400).json({ field: 'name', error: 'A style needs a name.' });
    const cols = Object.keys(clean.fields);
    if (!cols.length) return res.json(before);
    db.transaction(() => {
      db.prepare(`UPDATE merch_styles SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE style_code = ?`)
        .run(...cols.map((c) => clean.fields[c]), req.user.name, before.style_code);
      // The style name is the variants' family, so existing lists group by it.
      if (clean.fields.name && clean.fields.name !== before.name) {
        db.prepare("UPDATE products SET family = ?, updated_at = datetime('now') WHERE style_code = ? AND product_type = 'merch'")
          .run(clean.fields.name, before.style_code);
      }
    })();
    const after = db.prepare('SELECT * FROM merch_styles WHERE style_code = ?').get(before.style_code);
    logAudit(req.user, 'merch_style_updated', 'merch_style', before.style_code, { fields: cols }, before, after, after.name);
    res.json(after);
  });

  // ── The colour register ────────────────────────────────────────────────────
  router.post('/merch/colors', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    const name = String(b.name || '').trim();
    if (!COLOR_CODE_RE.test(code)) return res.status(400).json({ field: 'code', error: 'A color code is three letters (BLU, BLK).' });
    if (!name) return res.status(400).json({ field: 'name', error: 'A color needs a name.' });
    const hex = b.hex ? String(b.hex).trim() : null;
    if (hex && !HEX_COLOR_RE.test(hex)) return res.status(400).json({ field: 'hex', error: 'Hex is six characters, 0-9 and A-F.' });
    if (db.prepare('SELECT 1 FROM merch_colors WHERE code = ?').get(code)) return res.status(409).json({ error: `${code} is already in the register.` });
    // Every colour starts CONFIRMING. Confirming is a separate, deliberate act.
    db.prepare('INSERT INTO merch_colors (code, name, hex, confirming, note, created_by) VALUES (?, ?, ?, 1, ?, ?)')
      .run(code, name, hex ? hex.replace(/^#?/, '#').toUpperCase() : null, b.note ? String(b.note).slice(0, 500) : null, req.user.name);
    const row = db.prepare('SELECT * FROM merch_colors WHERE code = ?').get(code);
    logAudit(req.user, 'merch_color_created', 'merch_color', code, null, null, row, name);
    res.status(201).json({ ...row, confirming: true });
  });

  router.put('/merch/colors/:code', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const before = db.prepare('SELECT * FROM merch_colors WHERE code = ?').get(req.params.code);
    if (!before) return res.status(404).json({ error: 'No such color.' });
    const b = req.body || {};
    if (b.code !== undefined && String(b.code).toUpperCase() !== before.code) return res.status(400).json({ field: 'code', error: 'A color code never changes. Add the new color and recolor the variants.' });
    // Once confirmed the colour's name and swatch are what GTINs were drawn
    // against; a change then is a new colour, not an edit.
    if (!before.confirming && (b.name !== undefined || b.hex !== undefined)) {
      return res.status(409).json({ error: `${before.code} is confirmed. Its name and hex no longer change; add a new color instead.` });
    }
    const patch = {};
    if (b.name !== undefined) { const n = String(b.name || '').trim(); if (!n) return res.status(400).json({ field: 'name', error: 'A color needs a name.' }); patch.name = n; }
    if (b.hex !== undefined) {
      const h = b.hex ? String(b.hex).trim() : null;
      if (h && !HEX_COLOR_RE.test(h)) return res.status(400).json({ field: 'hex', error: 'Hex is six characters, 0-9 and A-F.' });
      patch.hex = h ? h.replace(/^#?/, '#').toUpperCase() : null;
    }
    if (b.note !== undefined) patch.note = b.note ? String(b.note).slice(0, 500) : null;
    const cols = Object.keys(patch);
    if (!cols.length) return res.json({ ...before, confirming: !!before.confirming });
    db.transaction(() => {
      db.prepare(`UPDATE merch_colors SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE code = ?`)
        .run(...cols.map((c) => patch[c]), before.code);
      // The variant title names the colour; keep it in step.
      if (patch.name && patch.name !== before.name) retitleVariants(db, { color: before.code });
    })();
    const after = db.prepare('SELECT * FROM merch_colors WHERE code = ?').get(before.code);
    logAudit(req.user, 'merch_color_updated', 'merch_color', before.code, { fields: cols }, before, after, after.name);
    res.json({ ...after, confirming: !!after.confirming });
  });

  router.post('/merch/colors/:code/confirm', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const before = db.prepare('SELECT * FROM merch_colors WHERE code = ?').get(req.params.code);
    if (!before) return res.status(404).json({ error: 'No such color.' });
    if (!before.confirming) return res.json({ ...before, confirming: false });
    db.prepare("UPDATE merch_colors SET confirming = 0, confirmed_by = ?, confirmed_at = datetime('now'), updated_at = datetime('now') WHERE code = ?")
      .run(req.user.name, before.code);
    const after = db.prepare('SELECT * FROM merch_colors WHERE code = ?').get(before.code);
    logAudit(req.user, 'merch_color_confirmed', 'merch_color', before.code, null, before, after, after.name);
    res.json({ ...after, confirming: false });
  });

  // ── Variants ───────────────────────────────────────────────────────────────
  router.post('/merch/styles/:code/variants', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const style = db.prepare('SELECT * FROM merch_styles WHERE style_code = ?').get(req.params.code);
    if (!style) return res.status(404).json({ error: 'No such style.' });
    // The flavour must still be live in the register when variants are minted.
    const reg = registerCode(db, { flavor_code: style.flavor_code });
    if (reg.error) return res.status(400).json({ code: 'FLAVOR_NOT_REGISTERED', error: reg.error });
    const colors = [...new Set((req.body?.colors || []).map((c) => String(c).trim().toUpperCase()))];
    const sizes = [...new Set((req.body?.sizes || []).map((s) => String(s).trim().toUpperCase()))];
    if (!colors.length || !sizes.length) return res.status(400).json({ error: 'Pick at least one color and one size.' });
    const register = colorsMap(db);
    const unknownColors = colors.filter((c) => !register.has(c));
    if (unknownColors.length) return res.status(400).json({ field: 'colors', error: `Not in the color register: ${unknownColors.join(', ')}. Add them first.` });
    const unknownSizes = sizes.filter((s) => !SIZE_BY_CODE[s]);
    if (unknownSizes.length) return res.status(400).json({ field: 'sizes', error: `Not a size: ${unknownSizes.join(', ')}. Sizes are ${MERCH_SIZES.map((s) => s.code).join(', ')}.` });

    const created = []; const existing = [];
    const insert = db.prepare(`INSERT INTO products (sku, gtin, gtin_valid, category, pack, flavor, base_flavor, family, status,
        product_type, style_code, color_code, size_code, created_by)
      VALUES (?, NULL, 0, ?, ?, ?, ?, ?, 'Draft', 'merch', ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const c of colors) for (const s of sizes) {
        const sku = buildMerchSku(style.style_code, c, s);
        if (!sku) continue;
        const have = db.prepare('SELECT sku, product_type FROM products WHERE sku = ?').get(sku);
        if (have) { existing.push(sku); continue; }
        const title = variantTitle({ flavor: style.flavor, garment: style.garment, colorName: register.get(c).name, sizeCode: s });
        insert.run(sku, MERCH_CATEGORY, MERCH_PACK, title, style.flavor, style.name, style.style_code, c, s, req.user.name);
        stampReadiness(db, sku, null, [], req.user.name);
        created.push(sku);
      }
    })();
    if (created.length) logAudit(req.user, 'merch_variants_created', 'merch_style', style.style_code, { created, existing }, null, null, style.name);
    res.status(created.length ? 201 : 200).json({ created, existing, line: MERCH_LINE });
  });

  router.post('/merch/variants/:sku/recolor', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const v = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
    if (!v || v.product_type !== 'merch') return res.status(404).json({ error: 'No such merch variant.' });
    if (v.gtin) return res.status(409).json({ code: 'HAS_GTIN', error: `${v.sku} carries GTIN ${v.gtin}. A variant with a GTIN keeps its color; make a new variant instead.` });
    const color = String(req.body?.color || '').trim().toUpperCase();
    const reg = colorsMap(db).get(color);
    if (!reg) return res.status(400).json({ field: 'color', error: `${color || 'That color'} is not in the color register.` });
    if (color === v.color_code) return res.json(v);
    const style = db.prepare('SELECT * FROM merch_styles WHERE style_code = ?').get(v.style_code);
    const next = buildMerchSku(v.style_code, color, v.size_code);
    if (!next) return res.status(400).json({ error: 'That color does not make a valid SKU.' });
    if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(next)) return res.status(409).json({ error: `${next} already exists.` });
    const title = variantTitle({ flavor: style?.flavor || v.base_flavor, garment: style?.garment || parseStyleCode(v.style_code)?.garment, colorName: reg.name, sizeCode: v.size_code });
    // The same row move a rename uses: every child table follows. A draft that
    // never shipped records no legacy code (the D-081 realign rule).
    db.transaction(() => moveProductRow(db, v, next, req.user, { extra: { color_code: color, flavor: title }, legacy: false }))();
    logAudit(req.user, 'merch_variant_recolored', 'product', next, { from: v.sku, to: next, color_from: v.color_code, color_to: color }, null, null, `${v.sku} → ${next}`);
    res.json(db.prepare(`${SELECT} WHERE p.sku = ?`).get(next));
  });

  // ── GS1 numbers ────────────────────────────────────────────────────────────
  router.get('/merch/gtin/suggest', (req, res) => {
    const db = getDb();
    const prefix = String(req.query.prefix || '').trim();
    const carried = carriedPrefixes(db);
    if (!carried.includes(prefix)) {
      return res.status(400).json({ code: 'PREFIX_NOT_CARRIED', error: `${prefix || 'No prefix'} is not a prefix this catalogue already uses. Choose one of ${carried.join(', ')}.`, prefixes: carried });
    }
    const s = suggestNextGtin(prefix, takenGtins(db), checkDigit);
    if (!s) return res.status(409).json({ code: 'PREFIX_FULL', error: `Prefix ${prefix} has no free numbers.`, ...prefixReport(db, prefix) });
    res.json({ suggestion: s.gtin, item: s.item, ...prefixReport(db, prefix), note: 'A suggestion only. Check it against the GS1 portal, then reserve or assign it.' });
  });

  /** Is this number free to hand out, and why not? `forSku` may consume its own reservation. */
  function gtinProblem(db, raw, { forSku = null } = {}) {
    const g = normalizeGtin(raw);
    if (!g || !/^\d{12}$/.test(g)) return { error: 'A merch GTIN is a 12-digit UPC-A.' };
    if (!gtinValid(g)) return { error: `${g} fails its GS1 check digit.` };
    const prefix = g.slice(0, 9);
    if (!carriedPrefixes(db).includes(prefix)) return { code: 'PREFIX_NOT_CARRIED', error: `${prefix} is not a prefix this catalogue already uses.` };
    // Compared in normalised form against EVERY product GTIN, whatever spelling it was typed in.
    const onProduct = db.prepare("SELECT sku, gtin FROM products WHERE gtin IS NOT NULL AND gtin != ''").all().find((r) => normalizeGtin(r.gtin) === g);
    if (onProduct) return { status: 409, code: 'GTIN_TAKEN', error: `${g} is already on ${onProduct.sku}.` };
    const held = db.prepare('SELECT * FROM gtin_reservations WHERE gtin = ?').get(g);
    if (held && !(forSku && held.reserved_for === forSku)) {
      return { status: 409, code: 'GTIN_RESERVED', error: `${g} is reserved${held.reserved_for ? ` for ${held.reserved_for}` : ''}.`, reservation: held };
    }
    return { gtin: g, prefix, item: g.slice(9, 11), reservation: held || null };
  }

  router.post('/merch/gtin/reserve', (req, res) => {
    // A bot token may reserve (WRITE_AREAS); its account's own grant decides.
    if (!canManage(req.user) && !req.user?.via_token) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const b = req.body || {};
    const reservedFor = b.reserved_for ? String(b.reserved_for).trim().slice(0, 120) : null;
    let out;
    try {
      out = db.transaction(() => {
        let raw = b.gtin;
        if (!raw) {
          if (!b.prefix) return { status: 400, body: { error: 'Send the number to reserve, or a prefix to take the next free one from.' } };
          const s = suggestNextGtin(String(b.prefix).trim(), takenGtins(db), checkDigit);
          if (!s) return { status: 409, body: { error: `Prefix ${b.prefix} has no free numbers.` } };
          raw = s.gtin;
        }
        const p = gtinProblem(db, raw);
        if (p.error) return { status: p.status || 400, body: p };
        if (reservedFor) {
          const v = db.prepare('SELECT * FROM products WHERE sku = ?').get(reservedFor);
          if (v && v.gtin) return { status: 409, body: { error: `${reservedFor} already carries GTIN ${v.gtin}.` } };
        }
        db.prepare('INSERT INTO gtin_reservations (id, gtin, prefix, item, reserved_for, source, note, reserved_by, reserved_by_id) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(p.gtin, p.prefix, p.item, reservedFor, b.source === 'gs1_portal' ? 'gs1_portal' : 'readydoc', b.note ? String(b.note).slice(0, 500) : null, req.user.name, req.user.id || null);
        return { status: 201, body: db.prepare('SELECT * FROM gtin_reservations WHERE gtin = ?').get(p.gtin) };
      }).immediate();
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(409).json({ code: 'GTIN_RESERVED', error: 'That number was just reserved by someone else.' });
      throw e;
    }
    if (out.status === 201) {
      logAudit(req.user, 'gtin_reserved', 'gtin_reservation', out.body.id, { gtin: out.body.gtin, reserved_for: out.body.reserved_for }, null, out.body, out.body.gtin);
      out.body = { ...out.body, ...prefixReport(db, out.body.prefix) };
    }
    res.status(out.status).json(out.body);
  });

  router.delete('/merch/gtin/reservations/:id', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    const r = db.prepare('SELECT * FROM gtin_reservations WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'No such reservation.' });
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Say why the number is being released.' });
    db.prepare('DELETE FROM gtin_reservations WHERE id = ?').run(r.id);
    logAudit(req.user, 'gtin_reservation_released', 'gtin_reservation', r.id, { gtin: r.gtin, reason }, r, null, r.gtin);
    res.json({ ok: true });
  });

  router.post('/merch/variants/:sku/gtin', (req, res) => {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Supervisors and QA manage the catalog.' });
    const db = getDb();
    let out;
    try {
      // IMMEDIATE: the write lock is taken before the checks, so a second
      // confirm of the same number waits and then finds it taken.
      out = db.transaction(() => {
        const v = db.prepare('SELECT * FROM products WHERE sku = ?').get(req.params.sku);
        const color = v?.color_code ? db.prepare('SELECT * FROM merch_colors WHERE code = ?').get(v.color_code) : null;
        const refusal = gtinAssignRefusal(v, color ? { ...color, confirming: !!color.confirming } : null);
        if (refusal) return { status: v ? 409 : 404, body: { code: 'GTIN_REFUSED', error: refusal } };
        const p = gtinProblem(db, req.body?.gtin, { forSku: v.sku });
        if (p.error) return { status: p.status || 400, body: p };
        db.prepare("UPDATE products SET gtin = ?, gtin_valid = 1, updated_at = datetime('now') WHERE sku = ?").run(p.gtin, v.sku);
        if (p.reservation) db.prepare('DELETE FROM gtin_reservations WHERE id = ?').run(p.reservation.id);
        stampReadiness(db, v.sku, v, ['gtin'], req.user.name);
        return { status: 200, before: v, gtin: p.gtin, prefix: p.prefix };
      }).immediate();
    } catch (e) {
      if (/UNIQUE/.test(e.message)) return res.status(409).json({ code: 'GTIN_TAKEN', error: 'That number was just assigned to another product.' });
      throw e;
    }
    if (out.status !== 200) return res.status(out.status).json(out.body);
    const after = db.prepare('SELECT * FROM products WHERE sku = ?').get(out.before.sku);
    logAudit(req.user, 'gtin_assigned', 'product', after.sku, { gtin: out.gtin }, out.before, after, after.sku);
    res.json({ ...hydrate([db.prepare(`${SELECT} WHERE p.sku = ?`).get(after.sku)], db)[0], prefix_report: prefixReport(db, out.prefix) });
  });
}

/** Rebuild the variant titles after a colour's name changes. */
function retitleVariants(db, { color }) {
  const rows = db.prepare("SELECT p.sku, p.size_code, s.flavor, s.garment, c.name AS color_name FROM products p JOIN merch_styles s ON s.style_code = p.style_code JOIN merch_colors c ON c.code = p.color_code WHERE p.product_type = 'merch' AND p.color_code = ?").all(color);
  const upd = db.prepare("UPDATE products SET flavor = ?, updated_at = datetime('now') WHERE sku = ?");
  for (const r of rows) upd.run(variantTitle({ flavor: r.flavor, garment: r.garment, colorName: r.color_name, sizeCode: r.size_code }), r.sku);
}
