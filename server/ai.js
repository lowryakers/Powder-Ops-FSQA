// Optional AI layer. Server-side only — the API key never leaves the backend.
// Everything degrades gracefully: with no ANTHROPIC_API_KEY configured,
// aiEnabled() is false and callers surface the feature as unavailable rather
// than erroring. Defaults to the cheapest model; override with ANTHROPIC_MODEL.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

let client = null;

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
