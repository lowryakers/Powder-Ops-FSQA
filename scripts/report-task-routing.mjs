#!/usr/bin/env node
// report:routing — READ-ONLY. Who sees which tasks, from a COPY of the database (D-217).
//   npm run report:routing -- path/to/readydoc.db
// The logic is server/task-routing.js, which Settings → Data backup → Who sees which tasks runs too.
import Database from 'better-sqlite3';
import { taskRouting, routingText } from '../server/task-routing.js';

const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) { console.error('Usage: npm run report:routing -- <database file>'); process.exit(2); }
const db = new Database(file, { readonly: true, fileMustExist: true });
console.log(routingText(taskRouting(db), file));
