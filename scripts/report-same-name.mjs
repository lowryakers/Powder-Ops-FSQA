// npm run report:samename -- <copy of the database> ["Carol Pierce"]
// Accounts that share a name, side by side (D-262). Read-only: opens the file
// read-only and writes nothing.
import Database from 'better-sqlite3';
import { sameNameAccounts, sameNameText } from '../server/same-name-accounts.js';

const [file, name] = process.argv.slice(2);
if (!file) { console.error('Usage: npm run report:samename -- <database file> ["Name"]'); process.exit(2); }
const db = new Database(file, { readonly: true, fileMustExist: true });
const r = sameNameAccounts(db, { name: name || null });
console.log(sameNameText(r, file));
db.close();
