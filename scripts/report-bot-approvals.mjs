// npm run report:bot-approvals -- <copy of the database>
// Every bot token and what it can approve (nothing), and every approval on file
// made by a bot account (expected: none). Read-only (D-279).
import Database from 'better-sqlite3';
import { botApprovalReport } from '../server/bot-approval-report.js';

const [file] = process.argv.slice(2);
if (!file) { console.error('Usage: npm run report:bot-approvals -- <database file>'); process.exit(2); }
const db = new Database(file, { readonly: true, fileMustExist: true });
const r = botApprovalReport(db);
console.log(`Bot approval check — ${file}\n`);
console.log(`Bot accounts: ${r.bot_accounts.length}`);
for (const b of r.bot_accounts) console.log(`  ${b.name} (${b.role}${b.department ? `, ${b.department}` : ''}) — ${b.why || ''}`);
console.log(`\nTokens: ${r.token_count} (${r.live_token_count} live)`);
for (const t of r.tokens) {
  console.log(`  ${t.prefix || '?'}  ${t.label || ''} — ${t.account || '(no account)'} · ${t.live ? 'live' : 'not live'} · scopes ${t.scopes.join(', ') || '-'} · grants ${t.grants.join(', ') || '-'} · can approve: no`);
}
console.log(`\n${r.verdict}`);
for (const f of r.approvals_by_bots) console.log(`  [${f.source}] ${f.at || ''} ${f.actor || ''} ${f.action} — ${f.record}${f.via_token ? ' (via token)' : ''}`);
db.close();
process.exit(r.approvals_by_bots.length ? 1 : 0);
