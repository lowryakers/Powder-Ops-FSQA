// npm run report:editfails -- <copy of the database>
// Training records an edit turned into a fail (D-267). Read-only: opens the
// file read-only and writes nothing.
import Database from 'better-sqlite3';
import { editFailedTraining, editFailedText } from '../server/edit-failed-training.js';

const [file] = process.argv.slice(2);
if (!file) { console.error('Usage: npm run report:editfails -- <database file>'); process.exit(2); }
const db = new Database(file, { readonly: true, fileMustExist: true });
console.log(editFailedText(editFailedTraining(db), file));
db.close();
