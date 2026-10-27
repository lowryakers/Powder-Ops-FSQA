#!/usr/bin/env node
// report:usage — READ-ONLY. Which parts of ReadyDoc are used, from a COPY of the database (D-214).
//
//   npm run report:usage -- path/to/readydoc.db            (text)
//   npm run report:usage -- path/to/readydoc.db --csv      (one row per module)
//
// The logic is server/module-usage.js, which Settings → Data & backup → Module usage also runs
// (D-216). It imports nothing from server/db.js, so this opens no second connection.
import Database from 'better-sqlite3';
import { moduleUsage, usageText, usageCsv } from '../server/module-usage.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('Usage: npm run report:usage -- <database file> [--csv]'); process.exit(2); }
const db = new Database(file, { readonly: true, fileMustExist: true });
const r = moduleUsage(db);
console.log(args.includes('--csv') ? usageCsv(r) : usageText(r, file));
