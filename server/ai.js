// Optional AI layer. Server-side only — the API key never leaves the backend.
// Everything degrades gracefully: with no ANTHROPIC_API_KEY configured,
// aiEnabled() is false and callers surface the feature as unavailable rather
// than erroring. Defaults to the cheapest model; override with ANTHROPIC_MODEL.
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import Database from 'better-sqlite3';
import { getDbPath } from './db.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

let client = null;
let roDb = null;

// Dedicated read-only connection — even a malformed query cannot write.
function getReadonlyDb() {
  if (!roDb) roDb = new Database(getDbPath(), { readonly: true, fileMustExist: true });
  return roDb;
}

// Columns/tables that must never be exposed to the assistant.
const SENSITIVE = /\b(pin|password|token|sessions)\b/i;

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function aiModel() {
  return MODEL;
}

function getClient() {
  if (!aiEnabled()) return null;
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

// JSON schema for a generated quiz. Kept within the structured-outputs supported
// subset (objects/arrays/strings/enums; additionalProperties:false + required;
// no min/max constraints). correct_answer encoding matches the grader in
// server/api/training.js: multiple_choice → 0-based option index as a string;
// true_false → "true"/"false".
const TEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'prompt', 'options', 'correct_answer'],
        properties: {
          type: { type: 'string', enum: ['multiple_choice', 'true_false'] },
          prompt: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correct_answer: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You write short competency quizzes for a food-manufacturing facility's GMP / SQF training program.
Rules:
- Produce clear, unambiguous questions an operator can answer correctly after completing the training.
- Use only "multiple_choice" and "true_false" question types.
- For multiple_choice: "options" holds 3-4 answer choices and "correct_answer" is the 0-based index of the correct option, as a string (e.g. "2"). Exactly one option is correct.
- For true_false: "options" must be exactly ["True","False"] and "correct_answer" is "true" or "false".
- Keep the language simple and practical. Base questions on the provided material when given; do not invent facility-specific policies that aren't stated.`;

// Generate draft quiz questions for a course. Returns an array of questions in
// the shape the test-authoring UI and PUT /courses/:id/test expect. The caller
// (a human) reviews and edits before publishing. Throws if AI is not configured.
export async function generateTestQuestions({ title, description, sopText, count = 5 }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');

  const n = Math.min(Math.max(parseInt(count, 10) || 5, 1), 15);
  const context = [
    `Course title: ${title}`,
    description ? `Course description: ${description}` : null,
    sopText ? `Reference material (from the linked document):\n${String(sopText).slice(0, 12000)}` : null,
  ].filter(Boolean).join('\n\n');

  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Write ${n} quiz questions for the following training course.\n\n${context}` }],
    output_config: { format: { type: 'json_schema', schema: TEST_SCHEMA } },
  });

  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('AI returned an unexpected response'); }
  const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  // Normalize into the exact shape the editor/grader use.
  return questions.map(q => {
    const type = q.type === 'true_false' ? 'true_false' : 'multiple_choice';
    const options = type === 'true_false' ? ['True', 'False'] : (Array.isArray(q.options) ? q.options.filter(Boolean) : []);
    return { type, prompt: String(q.prompt || '').trim(), options, correct_answer: String(q.correct_answer ?? '').trim(), points: 1 };
  }).filter(q => q.prompt && q.options.length);
}

// ── Read-only query assistant ─────────────────────────────────────────────────
const ASK_SYSTEM = `You are a read-only analytics assistant for the "Powder Ops" food-safety and production management system (a SQLite database). Answer questions about production, KPIs, compliance, training, and overall system usage by querying the database — this is for an operator or executive who may be reading on a phone.

How to work:
- Call list_schema to see the exact tables and columns, then call run_sql with a single SQLite SELECT to fetch what you need. Only SELECT queries run; you cannot modify data.
- Prefer aggregates (counts, rates, sums, averages) over dumping rows.
- Use the provided current date for "this week", "overdue", "recent", etc.

Key tables (confirm columns via list_schema):
- production_schedule, production_entries — planned vs. actual production
- work_orders, pm_schedules, checklist_submissions — tasks / preventive-maintenance completion
- training_courses, training_records — training compliance (status='completed', superseded=0, next_due_date)
- capas, complaints, qms_records, disposals — open compliance items
- sanitation_records, calibration_instruments, equipment — operations
- audit_log — who did what / system activity
- users — staff (never select pins or tokens)

Answer style: lead with the number that answers the question, then one short supporting sentence. Keep it to 1-3 sentences. Never invent figures — every number must come from a query. If the data can't answer it, say so briefly.`;

// Answer a natural-language question by letting the model run guarded read-only
// queries. Returns the answer plus the SQL it ran (for transparency/citation).
export async function answerQuestion({ question }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const used = [];

  const listSchema = betaTool({
    name: 'list_schema',
    description: 'List the database tables and their column names. Call this before writing SQL to get exact names.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const db = getReadonlyDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
      const schema = {};
      for (const t of tables) {
        if (SENSITIVE.test(t)) continue;
        schema[t] = db.prepare(`PRAGMA table_info("${t}")`).all().map(col => col.name).filter(n => !SENSITIVE.test(n));
      }
      return JSON.stringify(schema);
    },
  });

  const runSql = betaTool({
    name: 'run_sql',
    description: 'Run a single read-only SQLite SELECT statement and return up to 200 rows as JSON. Only SELECT/WITH queries are permitted.',
    inputSchema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A single SQLite SELECT statement.' } },
      required: ['sql'], additionalProperties: false,
    },
    run: async ({ sql }) => {
      const s = String(sql || '').trim().replace(/;+\s*$/, '');
      if (!/^(select|with)\b/i.test(s)) return 'Error: only SELECT queries are allowed.';
      if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i.test(s)) return 'Error: only read-only SELECT queries are allowed.';
      if (SENSITIVE.test(s)) return 'Error: that query references restricted columns.';
      try {
        const rows = getReadonlyDb().prepare(s).all(); // readonly conn: writes are impossible
        used.push(s);
        return JSON.stringify(rows.slice(0, 200));
      } catch (e) {
        return `Error: ${e.message}`;
      }
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const final = await c.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 1500,
    system: `${ASK_SYSTEM}\n\nToday is ${today}.`,
    tools: [listSchema, runSql],
    messages: [{ role: 'user', content: String(question || '').slice(0, 2000) }],
    max_iterations: 8,
  });

  const answer = (final.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  return { answer: answer || 'I could not find an answer to that.', used };
}
