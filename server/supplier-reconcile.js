// Reconciling the supplier tracker against the supplier archive.
//
// PURE. Sheet rows and parsed archive files in, a per-vendor reconciliation
// out. No Express, no database, no file access — the number two people are
// going to argue about should be checkable without standing up a server. Same
// doctrine as partner-recon.js, coa-submission.js and flash-report.js.
//
// WHY THIS EXISTS RATHER THAN AN IMPORTER THAT JUST LOADS BOTH SOURCES.
// Run 27 Aug 2026 over the real 836-file archive and the real 67-row tracker:
// the two disagree about THIRTY of the fifty-six vendors they both name. 27
// vendors have a questionnaire sitting in their folder that the tracker says
// they do not; 3 are marked done with nothing on file; 10 active vendors have
// no folder at all. Loading either source on its own would import a known-wrong
// answer and make it look authoritative. So the import is a RECONCILIATION —
// it shows both sides per vendor and a person resolves the difference, the same
// shape as the training-log importer's course mapping, where ~30 human
// decisions stood in for 3,639 rows.

/** Normalised for matching only. Never stored, never displayed. */
export function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Corporate suffixes and the words the plant drops casually. Stripped only for
// COMPARISON — "Mill Haven" and "Mill Haven Foods" are one vendor, and the
// auditor called it the second while the tracker calls it the first.
const NOISE = /(inc|llc|ltd|corp|corporation|company|co|foods?|ingredients?|supply|group|selection|usa|nutra|nutrition)$/;
const trimmed = (name) => {
  let k = nameKey(name);
  for (let i = 0; i < 3 && NOISE.test(k); i++) k = k.replace(NOISE, '');
  return k;
};

/**
 * How two names match, or null.
 *
 * THREE STRENGTHS, and the weakest is still offered rather than applied. An
 * exact key match is safe to take outright; anything else is a SUGGESTION a
 * person confirms, because "GNT" matching "Exberry-GNT" is right and "Impact"
 * matching "Impact Products" is right, but the same rule would happily match
 * "Traco" to "Traco Packaging" and "Talus" to "Aceto-Talus" — all correct here,
 * and all the kind of thing that is wrong exactly once and files a
 * qualification against the wrong company.
 */
export function matchStrength(a, b) {
  const ka = nameKey(a), kb = nameKey(b);
  if (!ka || !kb) return null;
  if (ka === kb) return 'exact';
  const ta = trimmed(a), tb = trimmed(b);
  if (ta && tb && ta === tb) return 'suffix';
  const [long, short] = ka.length >= kb.length ? [ka, kb] : [kb, ka];
  if (short.length >= 4 && long.includes(short)) return 'contains';
  return null;
}

/** The disagreements worth a person's time, in the order they should be worked. */
export const DISAGREEMENTS = {
  tracker_says_no_questionnaire_but_folder_has_one: {
    label: 'Questionnaire on file, tracker says none',
    note: 'The work was done and nobody ticked it off. Resolving these is the fastest way to shrink the unqualified list honestly.',
  },
  tracker_says_questionnaire_but_none_on_file: {
    label: 'Tracker says done, nothing on file',
    note: 'The dangerous direction — the tracker claims something the evidence does not support.',
  },
  active_with_no_folder: {
    label: 'Actively used, no folder in the archive',
    note: 'There is nothing to check. Either the folder is elsewhere or the qualification was never started.',
  },
  folder_with_no_tracker_row: {
    label: 'Folder exists, not on the tracker',
    note: 'Evidence collected for a vendor the tracker has never heard of.',
  },
};

/**
 * Reconcile one tracker against one parsed archive.
 *
 * @param {object[]} sheetRows  rows as read from the tracker, using its own headers
 * @param {object}   archive    the result of readSupplierArchive()
 * @param {object}   [opts]
 * @param {string[]} [opts.notVendorFolders]  top-level folders that are not vendors
 * @returns {{vendors: object[], disagreements: object[], counts: object}}
 */
export function reconcileSuppliers(sheetRows, archive, opts = {}) {
  const NOT_VENDOR = opts.notVendorFolders
    ?? [/^signed-completed/i, /^current suppliers/i];
  const isVendorFolder = (n) => !NOT_VENDOR.some(re => re.test(n));

  const cell = (row, key) => String(row?.[key] ?? '').trim();
  const flag = (row, key) => cell(row, key) === '1'
    || /^(y|yes|true|x|✓)$/i.test(cell(row, key));

  const folders = (archive.vendors || []).filter(v => isVendorFolder(v.vendor));
  const rows = (sheetRows || []).filter(r => cell(r, 'Vendor'));

  // Pair them, strongest match first, each side used once. Strength order
  // matters: a weak "contains" hit must never claim a folder that an exact
  // match elsewhere would have taken.
  const usedF = new Set(), usedS = new Set(), pairs = [];
  for (const strength of ['exact', 'suffix', 'contains']) {
    for (const row of rows) {
      if (usedS.has(row)) continue;
      for (const folder of folders) {
        if (usedF.has(folder)) continue;
        if (matchStrength(cell(row, 'Vendor'), folder.vendor) !== strength) continue;
        pairs.push({ row, folder, matched: strength });
        usedS.add(row); usedF.add(folder);
        break;
      }
    }
  }

  const vendors = [];
  const add = (name, row, folder, matched) => {
    const active = row ? flag(row, 'Actively Using') : null;
    const trackerDone = row ? flag(row, 'Questionnaire Completed') : null;
    const folderHas = folder ? !!folder.has_questionnaire : null;
    const issues = [];
    if (row && folder && !trackerDone && folderHas) issues.push('tracker_says_no_questionnaire_but_folder_has_one');
    if (row && folder && trackerDone && !folderHas) issues.push('tracker_says_questionnaire_but_none_on_file');
    if (row && !folder && active) issues.push('active_with_no_folder');
    if (!row && folder) issues.push('folder_with_no_tracker_row');
    vendors.push({
      name, matched,
      on_tracker: !!row, has_folder: !!folder,
      actively_using: active,
      tracker_questionnaire: trackerDone,
      folder_questionnaire: folderHas,
      // The evidence, so a person resolving this does not have to go and look.
      files: folder?.files ?? 0,
      periods: folder?.periods ?? [],
      undated_files: folder?.undated_files ?? 0,
      unexpanded_containers: folder?.unexpanded_containers ?? 0,
      contacts: row ? String(row.Contact || '').split(',').map(s => s.trim()).filter(Boolean) : [],
      notes: row ? cell(row, 'Notes') : '',
      issues,
    });
  };

  for (const p of pairs) add(cell(p.row, 'Vendor'), p.row, p.folder, p.matched);
  for (const row of rows) if (!usedS.has(row)) add(cell(row, 'Vendor'), row, null, null);
  for (const f of folders) if (!usedF.has(f)) add(f.vendor, null, f, null);

  vendors.sort((a, b) => (b.issues.length - a.issues.length)
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const disagreements = Object.keys(DISAGREEMENTS).map(k => ({
    kind: k, ...DISAGREEMENTS[k],
    vendors: vendors.filter(v => v.issues.includes(k)).map(v => v.name),
  })).filter(d => d.vendors.length);

  // THE HEADLINE IS DERIVED, NEVER STORED. "Actively used and not qualified" is
  // the number the whole register exists to surface, and it must be recomputed
  // from whatever the sources currently say — a stored count is a count that
  // goes stale the first time somebody files a questionnaire.
  const active = vendors.filter(v => v.actively_using);
  return {
    vendors, disagreements,
    counts: {
      vendors: vendors.length,
      matched: pairs.length,
      tracker_only: rows.length - usedS.size,
      folder_only: folders.length - usedF.size,
      active: active.length,
      // Qualified means EITHER source has a questionnaire — the union, because
      // this stage is establishing what is on hand, not deciding approval. The
      // disposition (SOP 404 § V.C.III) is a later, deliberate act.
      active_with_questionnaire_somewhere:
        active.filter(v => v.tracker_questionnaire || v.folder_questionnaire).length,
      active_with_none: active.filter(v => !v.tracker_questionnaire && !v.folder_questionnaire).length,
      disagreeing: vendors.filter(v => v.issues.length).length,
    },
  };
}
