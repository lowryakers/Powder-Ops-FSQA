// Optional semantic layer for comms (Phase 4). Uses Voyage AI for embeddings —
// Anthropic has no first-party embeddings API. Degrades gracefully: with no
// VOYAGE_API_KEY, voyageEnabled() is false and callers fall back to keyword
// search / hide the feature rather than erroring.
//
//   VOYAGE_API_KEY   - required to enable
//   VOYAGE_MODEL     - default 'voyage-3.5-lite' (cheap + multilingual EN/ES)
//   VOYAGE_BASE_URL  - default 'https://api.voyageai.com/v1' (override for tests)
const API_KEY = process.env.VOYAGE_API_KEY;
const MODEL = process.env.VOYAGE_MODEL || 'voyage-3.5-lite';
const BASE_URL = process.env.VOYAGE_BASE_URL || 'https://api.voyageai.com/v1';

export function voyageEnabled() {
  return !!API_KEY;
}
export function embeddingModel() {
  return MODEL;
}

// Embed one or more texts. input_type 'document' when storing, 'query' when
// searching (Voyage tunes the two differently). Returns an array of Float32Array.
export async function embed(texts, inputType = 'document') {
  if (!voyageEnabled()) throw new Error('Semantic features are not configured on this server.');
  const input = Array.isArray(texts) ? texts : [texts];
  if (input.length === 0) return [];
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ input, model: MODEL, input_type: inputType }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Voyage embeddings failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.data || []).sort((a, b) => a.index - b.index).map(d => Float32Array.from(d.embedding));
}

// ── Vector (de)serialization for SQLite BLOB storage ──────────────────────────
export function vectorToBlob(vec) {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
export function blobToVector(buf) {
  // Copy into an aligned buffer so the Float32Array view is valid.
  return new Float32Array(new Uint8Array(buf).buffer.slice(0));
}

// Cosine similarity between two equal-length vectors.
export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
