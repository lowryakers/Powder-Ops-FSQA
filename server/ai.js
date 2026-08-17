// Optional AI layer. Server-side only — the API key never leaves the backend.
// Everything degrades gracefully: with no ANTHROPIC_API_KEY configured,
// aiEnabled() is false and callers surface the feature as unavailable rather
// than erroring. Defaults to the cheapest model; override with ANTHROPIC_MODEL.
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { getDbPath, getDb } from './db.js';

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

// ── Translation ───────────────────────────────────────────────────────────────
// Translate one or more strings to Spanish, preserving Markdown/formatting.
// Returns an array aligned to the input array. Meant to be reviewed/edited by a
// human before it's relied on for compliance.
// OCR an image (photo/scan of an invoice or receipt) via vision. Returns the
// transcribed plain text, or null when AI is not configured / nothing legible.
export async function transcribeImage(buffer, mediaType) {
  const c = getClient();
  if (!c) return null;
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
        { type: 'text', text: 'Transcribe ALL text visible in this document image (it is an invoice or receipt). Output plain text only — supplier name, dates, invoice/PO numbers, every line item, and every amount you can read. No commentary, no formatting markup.' },
      ],
    }],
  });
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return text || null;
}

/**
 * Read the trainee names off a scanned group sign-in sheet (Form 409-02 —
 * one paper, everyone signs). Returns the PRINTED names as written on the
 * paper, misspellings included — matching them to the roster is the caller's
 * job, and these are SUGGESTIONS for a person to confirm, never auto-filed:
 * a name mis-read by a machine becomes a training record for the wrong
 * person. PDFs go through the API's document block; photos as images.
 */
export async function readSheetNames(buffer, mediaType) {
  const c = getClient();
  if (!c) return null;
  const isPdf = /pdf/i.test(mediaType || '');
  const block = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } };
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: 'You read scanned training sign-in sheets from a food plant. Extract ONLY the trainee names from the sign-in table — prefer the "Printed Name" column over signatures; skip the trainer, blank rows, and crossed-out rows. Transcribe each name exactly as written, even if misspelled. Return ONLY a JSON array of the names, in row order.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'List the trainee names on this sign-in sheet.' }] }],
    output_config: { format: { type: 'json_schema', schema: { type: 'array', items: { type: 'string' } } } },
  });
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean).slice(0, 60) : null;
  } catch { return null; }
}

export async function translateToSpanish(items) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const list = (Array.isArray(items) ? items : [items]).map(s => String(s ?? ''));
  if (list.every(s => !s.trim())) return list;

  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: 'You are a professional translator for a food-manufacturing facility. Translate the given English strings into clear, natural Latin American Spanish suitable for plant employees. Preserve any Markdown formatting, numbers, and proper nouns. Return ONLY a JSON array of translated strings in the same order and length as the input — no commentary.',
    messages: [{ role: 'user', content: JSON.stringify(list) }],
    output_config: { format: { type: 'json_schema', schema: { type: 'array', items: { type: 'string' } } } },
  });
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('Translation returned an unexpected response'); }
  if (!Array.isArray(out) || out.length !== list.length) throw new Error('Translation length mismatch');
  return out.map(s => String(s ?? ''));
}

// Translate strings to a target language ('en' or 'es'), auto-detecting the
// source. Used for on-display chat translation. Returns same-length array.
export async function translateText(items, targetLang = 'es') {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const list = (Array.isArray(items) ? items : [items]).map(s => String(s ?? ''));
  if (list.every(s => !s.trim())) return list;
  const langName = targetLang === 'en' ? 'English' : 'Latin American Spanish';
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a translator for a food-manufacturing team chat. Translate each given string into natural ${langName}, auto-detecting the source language. If a string is already in ${langName}, return it unchanged. Preserve @mentions, numbers, URLs, emoji, and Markdown. Return ONLY a JSON array of translated strings in the same order and length as the input — no commentary.`,
    messages: [{ role: 'user', content: JSON.stringify(list) }],
    output_config: { format: { type: 'json_schema', schema: { type: 'array', items: { type: 'string' } } } },
  });
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('Translation returned an unexpected response'); }
  if (!Array.isArray(out) || out.length !== list.length) throw new Error('Translation length mismatch');
  return out.map(s => String(s ?? ''));
}

// Cached content translation. Reuses translateText() but persists each result in
// translation_cache keyed by (sha1(source), lang) so repeated strings — e.g. the
// same task title shown to every operator — are translated once. Degrades
// gracefully: returns the source strings unchanged when AI is off or on failure,
// so callers never break. Order/length always matches the input.
const hashText = (s) => crypto.createHash('sha1').update(s).digest('hex');

export async function translateCached(texts, targetLang = 'es') {
  const list = (Array.isArray(texts) ? texts : [texts]).map(s => String(s ?? ''));
  if (targetLang === 'en' || !aiEnabled()) return list;

  const db = getDb();
  const out = new Array(list.length);
  const misses = [];
  const missIdx = [];
  const getStmt = db.prepare('SELECT translated FROM translation_cache WHERE source_hash = ? AND target_lang = ?');
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s.trim()) { out[i] = s; continue; }
    let row = null;
    try { row = getStmt.get(hashText(s), targetLang); } catch { /* cache read best-effort */ }
    if (row) out[i] = row.translated;
    else { misses.push(s); missIdx.push(i); }
  }

  if (misses.length) {
    let translated;
    try {
      translated = await translateText(misses, targetLang);
    } catch {
      for (const i of missIdx) out[i] = list[i]; // fall back to source on failure
      return out;
    }
    const ins = db.prepare(
      'INSERT OR IGNORE INTO translation_cache (source_hash, target_lang, source_text, translated, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    const now = new Date().toISOString();
    for (let k = 0; k < misses.length; k++) {
      const i = missIdx[k];
      out[i] = translated[k];
      try { ins.run(hashText(misses[k]), targetLang, misses[k].slice(0, 4000), translated[k], now); } catch { /* cache write best-effort */ }
    }
  }
  return out;
}

// Proofread document/test content: fix spelling, grammar, punctuation, and
// clarity WITHOUT changing meaning, procedure steps, numbers, measurements, or
// Markdown structure. Returns the corrected text plus short notes on what changed.
export async function proofreadText(text) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const src = String(text ?? '');
  if (!src.trim()) return { corrected: src, notes: [] };
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: `You are a proofreader for food-safety and quality documents (SOPs, work instructions, training material). Correct spelling, grammar, and punctuation and improve clarity, but DO NOT change the meaning, procedure steps, sequence, numbers, measurements, chemical names, or Markdown structure (headings, lists, tables, links). Return ONLY JSON: {"corrected":"<the full corrected text>","notes":["short description of a fix", ...]} — notes summarize the kinds of changes you made (max 6). If nothing needs changing, return the text unchanged with an empty notes array.`,
    messages: [{ role: 'user', content: src.slice(0, 12000) }],
    output_config: { format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['corrected', 'notes'], properties: { corrected: { type: 'string' }, notes: { type: 'array', items: { type: 'string' } } } } } },
  });
  const text2 = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(text2); } catch { throw new Error('Proofread returned an unexpected response'); }
  return { corrected: String(out.corrected ?? src), notes: Array.isArray(out.notes) ? out.notes.map(String).slice(0, 6) : [] };
}

// ── Policy drafting ───────────────────────────────────────────────────────────
// A STARTING POINT for a human to edit, never a finished policy. The model is
// told in as many words not to invent this plant's specifics — an AI-written
// number (an accrual rate, a notice period) that nobody chose is exactly the
// kind of thing that ends up quoted back at the company, so unknowns come out
// as visible [SQUARE BRACKET] placeholders instead.
const POLICY_SYSTEM = `You draft internal company policies for a small US food-manufacturing business (a powder blending and packaging plant, roughly 30 employees, hourly production staff plus a small office team).

Rules:
- Write the policy in plain, direct language an hourly employee can read. Short sentences. No legalese where a plain word works.
- Structure it with a Purpose, Scope, the policy itself, and Responsibilities. Use headings and short lists.
- NEVER invent facts specific to this company: dollar amounts, accrual rates, notice periods, phone numbers, names, or legal citations. Where a specific is needed, write a placeholder in square brackets like [ACCRUAL RATE] or [HR CONTACT] so a person fills it in.
- Do not claim legal compliance or cite statutes unless the user supplied them.
- Formatting: plain text with *bold*, _italic_, "- " bullets and "1. " numbered lists. No Markdown headings with #; write a heading as a bold line.
- End with a line: "This policy is a draft for review." `;

export async function draftPolicy({ title, category, notes }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured on this server.');
  const ask = [
    `Policy title: ${String(title || '').slice(0, 200)}`,
    category ? `Category: ${String(category).slice(0, 80)}` : '',
    notes ? `What it needs to cover:\n${String(notes).slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n');
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: POLICY_SYSTEM,
    messages: [{ role: 'user', content: ask }],
  });
  return (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
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

// ── Chat digest / Q&A over messages (Comms Phase 4) ───────────────────────────
// Synthesizes an answer from a set of already-access-checked chat messages
// (retrieved via embeddings by the caller). The model only sees what the user is
// allowed to see, so membership scoping is preserved.
export async function summarizeChat({ question, contextMessages }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const msgs = (contextMessages || []).slice(0, 40);
  if (msgs.length === 0) return 'There are no relevant messages to answer that.';
  const today = new Date().toISOString().slice(0, 10);
  const context = msgs.map((m, i) =>
    `[${i + 1}] #${m.channel_name} — ${m.user_name} (${m.created_at}): ${m.body}`
  ).join('\n');
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: `You are an assistant summarizing internal team chat for a food-manufacturing facility. Answer the user's question using ONLY the provided messages. Be concise (1-4 sentences or a short bulleted list). Cite the messages you used with their bracket numbers like [2]. If the messages don't contain the answer, say so plainly. Today is ${today}.`,
    messages: [{ role: 'user', content: `Question: ${String(question || '').slice(0, 500)}\n\nMessages:\n${context}` }],
  });
  return (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || 'I could not find an answer in the messages.';
}

/**
 * Read an equipment manual against the maintenance tasks written for it, and
 * say what the manual mentions that the tasks don't.
 *
 * SUGGESTIONS ONLY. The output is a list somebody reads and decides on — it is
 * never applied. A machine's maintenance procedure rewritten by a model that
 * read a PDF is precisely the kind of compliance record that must not change
 * without a person, and a wrong suggestion is cheap while a wrong task is not.
 *
 * The model is told to quote the manual for each suggestion, so the reader can
 * check the claim rather than take it on trust — an unsourced "the manual says
 * you should grease this monthly" is unverifiable and therefore useless.
 */
/**
 * Read a lab certificate of analysis that the pattern reader could not.
 *
 * `parseCTLACoa` is a set of line regexes: it wants "Label: value" on one line
 * and a test name with its result beside it. A real CoA is a TABLE, and pdfjs
 * hands a table back as cells in reading order — so the label and its value
 * land on different lines, and a result sits three lines below its test name.
 * No amount of extra regex generalises across labs; this is exactly the job a
 * model does well and a pattern does badly.
 *
 * IT PROPOSES AND NEVER APPLIES. The caller shows every field and every result
 * for a person to tick, the same contract as `compareManualToTasks` and
 * `draftPolicy`. That is what makes reading a compliance record with a model
 * safe: nothing reaches the record without someone agreeing to it.
 *
 * Three rules in the prompt do the real work:
 *   · Copy values EXACTLY as printed. "<10", "Not Detected", "ND", "Absent/25g"
 *     are results, not numbers to tidy up — normalising them is how a limit
 *     turns into a different limit.
 *   · Never infer a result that is not printed. A missing test is a missing
 *     test; inventing "pass" for it is the worst thing this could do.
 *   · The lab's own pass/fail only, when the report states one. Grading against
 *     the plant's specification happens on the server afterwards, against the
 *     approved spec — not here.
 */
export async function readLabReport({ text, itemHint, expectedTests }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');

  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      'You read laboratory Certificates of Analysis for a food-manufacturing plant and extract what they say.',
      'The text comes from a PDF table, so columns may be split across lines and a value may appear several lines after its label. Use the layout to pair them up.',
      'Copy every value EXACTLY as printed, including qualifiers: "<10", "<10 cfu/g", "Not Detected", "ND", "Absent in 25g", "Negative". Do not convert, round or normalise them.',
      'NEVER infer or invent a result. If a test is named but has no printed result, leave it out entirely. A missing test must not appear as a passing one.',
      'Record a pass/fail ONLY if the report itself states one (a Pass/Fail column, "Complies", "Conforms"). Otherwise leave it null — the plant grades against its own specification separately.',
      'If a field is not on the report, omit it rather than guessing.',
    ].join(' '),
    messages: [{
      role: 'user',
      content: [
        itemHint ? `The plant believes this report is for: ${itemHint}` : '',
        expectedTests?.length ? `Tests the plant requested: ${expectedTests.join(', ')}` : '',
        '',
        'Certificate of Analysis text:',
        text,
      ].filter(Boolean).join('\n'),
    }],
    tools: [{
      name: 'report_coa',
      description: 'Report exactly what this certificate of analysis states.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['test_results'],
        properties: {
          item_description: { type: 'string' },
          item_number: { type: 'string' },
          lot_number: { type: 'string' },
          manufacturer_lot: { type: 'string' },
          vendor_lot: { type: 'string' },
          supplier: { type: 'string' },
          origin: { type: 'string' },
          product_expiration: { type: 'string', description: 'As printed.' },
          received_date: { type: 'string', description: 'As printed.' },
          date_of_results: { type: 'string', description: 'As printed.' },
          test_results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['test_type', 'result_value'],
              properties: {
                test_type: { type: 'string', description: 'The test name as printed on the report.' },
                result_value: { type: 'string', description: 'The result EXACTLY as printed, qualifiers included.' },
                unit: { type: 'string', description: 'Only if printed separately from the value.' },
                method: { type: 'string', description: 'The method, if the report names one.' },
                spec_on_report: { type: 'string', description: "The lab's own stated limit for this test, if printed." },
                pass_fail: { type: 'string', enum: ['pass', 'fail'], description: 'Only if the report states it.' },
              },
            },
          },
        },
      },
    }],
    tool_choice: { type: 'tool', name: 'report_coa' },
  });
  const use = (res.content || []).find(b => b.type === 'tool_use');
  if (!use) return { test_results: [] };
  return use.input || { test_results: [] };
}

export async function compareManualToTasks({ equipmentName, manualText, tasks }) {
  const c = getClient();
  if (!c) throw new Error('AI is not configured');
  const written = Object.entries(tasks || {})
    .filter(([, v]) => Array.isArray(v) && v.length)
    .map(([freq, list]) => `${freq}:\n${list.map(t => `  - ${t}`).join('\n')}`)
    .join('\n') || '(no maintenance tasks written yet)';

  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [
      'You compare an equipment manual against the preventive-maintenance tasks a food-manufacturing plant has written for that machine.',
      'Report ONLY maintenance or inspection activity the manual calls for that is not already covered by the written tasks.',
      'Ignore installation, warranty, troubleshooting and operating instructions — this is about recurring maintenance.',
      'For every suggestion, quote the manual in `evidence` so the reader can verify it. If you cannot quote it, do not suggest it.',
      'Suggest a frequency only when the manual states one; otherwise use "unspecified" — do not invent a cadence.',
      'If the written tasks already cover the manual, return an empty list. Saying "nothing missing" is a useful answer.',
    ].join(' '),
    messages: [{
      role: 'user',
      content: `Machine: ${equipmentName}\n\nMaintenance tasks currently written:\n${written}\n\nManual text:\n${manualText}`,
    }],
    tools: [{
      name: 'report_gaps',
      description: 'Report maintenance the manual calls for that the written tasks do not cover.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['suggestions', 'summary'],
        properties: {
          summary: { type: 'string', description: 'One or two sentences on how well the tasks match the manual.' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['task', 'frequency', 'evidence'],
              properties: {
                task: { type: 'string', description: 'The maintenance activity, phrased as a task.' },
                frequency: { type: 'string', enum: ['Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'As Needed', 'unspecified'] },
                evidence: { type: 'string', description: 'A short quote from the manual supporting this.' },
              },
            },
          },
        },
      },
    }],
    tool_choice: { type: 'tool', name: 'report_gaps' },
  });
  const use = (res.content || []).find(b => b.type === 'tool_use');
  if (!use) return { summary: 'The manual could not be compared.', suggestions: [] };
  return { summary: use.input.summary || '', suggestions: use.input.suggestions || [] };
}
