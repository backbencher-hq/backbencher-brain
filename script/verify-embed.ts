// verify-embed.ts — Phase 4 acceptance:
//  1. A mock OpenAI-compatible /embeddings endpoint serves deterministic
//     vectors; the core's embedMany must call it (not the local fallback).
//  2. A fixture project indexed WITH the API configured stores embeddings
//     under the API model name with the API dimension.
//  3. Semantic query: the nearest stored vector by cosine must be the
//     conceptually matching symbol.
//  4. Without API config, embedMany falls back to local word vectors.
//
//   bun run script/verify-embed.ts      (and npx tsx under Node)
import { SemanticEngine } from "../src/brain/semantic/engine"
import { BrainDatabase } from "../src/brain/database"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../src/ast/parallel-indexer"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

// ── mock OpenAI-compatible embeddings server ─────────────────────────────
// Deterministic vector per token set: hash-based, dim 8. Same text → same vec.
function mockVector(text: string): number[] {
  // character-bag vector: similar text -> similar vectors (pseudo-semantic)
  const v = new Array(8).fill(0.1)
  for (const ch of text.toLowerCase()) {
    v[ch.charCodeAt(0) % 8] += 1
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0))
  return v.map((x) => x / norm)
}

import { createServer } from "http"
const server = createServer((req, res) => {
  if (req.url === "/embeddings" && req.method === "POST") {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const body = JSON.parse(raw)
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      const data = { model: body.model, data: inputs.map((t: string) => ({ embedding: mockVector(t), index: 0 })), usage: { total_tokens: inputs.length } }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(data))
    })
    return
  }
  res.writeHead(404)
  res.end("not found")
})
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
const addr = server.address() as any
const baseURL = `http://127.0.0.1:${addr.port}`
process.env.BB_EMBEDDING_BASE_URL = baseURL
process.env.BB_EMBEDDING_API_KEY = "test-key"
process.env.BB_EMBEDDING_MODEL = "mock-embed-8d"
console.log(`mock embedding API at ${baseURL}`)

// ── 1. embedMany must hit the API ────────────────────────────────────────
const apiVecs = await SemanticEngine.embedMany(["calculate the total", "save a note"])
check("embedMany via API returns vectors", apiVecs.length === 2 && apiVecs[0].length === 8, `got ${apiVecs.length} x ${apiVecs[0]?.length}`)
const sameText = await SemanticEngine.embedMany(["calculate the total"])
check("embedMany deterministic (same text -> same vec)", sameText[0].every((x, i) => x === apiVecs[0][i]), "vectors differ")

// ── 2. index a fixture with API embeddings ───────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-embed-fixture-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(
  path.join(root, "src", "calc.ts"),
  `export function calculateTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0)
}

export class PriceCalculator {
  compute(price: number, tax: number): number {
    return price + tax
  }
}
`,
)
writeFileSync(
  path.join(root, "src", "notes.ts"),
  `export function saveNote(title: string, body: string): void {
  console.log(title, body)
}

export function listNotes(): string[] {
  return []
}
`,
)
const pid = "verify-embed"
const result = await indexProjectParallel(pid, root, {})
console.log(`  indexed: totalFiles=${result.totalFiles}`)
// Embeddings are generated on the background queue — wait for them so the
// assertions below read durable vectors.
await flushBackgroundEmbeddings()

const raw = await BrainDatabase.getRawInstance(pid)
const embRows = raw
  .prepare("SELECT entity_id, entity_type, embedding_model, vector_dimension, embedding_vector FROM brain_semantic_embedding")
  .all() as any[]
console.log(`  embedding rows: ${embRows.length}`)
check("embeddings stored", embRows.length > 0, "zero rows")
const models = new Set(embRows.map((r) => r.embedding_model))
check("stored under API model", models.has("bb/mock-embed-8d") || models.has("mock-embed-8d"), `models=${[...models].join(",")}`)
const dims = new Set(embRows.map((r) => r.vector_dimension))
check("stored with API dimension 8", dims.size === 1 && dims.has(8), `dims=${[...dims].join(",")}`)
const vecs = embRows.map((r) => JSON.parse(r.embedding_vector))
check("vectors are real (non-empty, numeric)", vecs.every((v) => Array.isArray(v) && v.length === 8 && v.every((x) => typeof x === "number")))

// ── 3. semantic query: nearest vector by cosine ──────────────────────────
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
const queryVec = (await SemanticEngine.embedMany(["save a note with a title"]))[0]
let best: any = null
let bestScore = -Infinity
for (let i = 0; i < embRows.length; i++) {
  const s = cosine(queryVec, vecs[i])
  if (s > bestScore) {
    bestScore = s
    best = embRows[i]
  }
}
check("semantic query returns a result", best != null, "none")
console.log(`  best semantic match: ${best?.entity_id?.split(":").slice(-2).join(":")} (cos ${bestScore.toFixed(3)})`)
const bestName = best?.entity_id?.split(":").slice(-2, -1)[0] ?? ""
check("semantic query matches the note symbol", /saveNote|listNotes/.test(bestName), `got ${bestName}`)

// ── 4. fallback without API config ───────────────────────────────────────
delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
const fallback = await SemanticEngine.embedMany(["fallback test text"])
check("no-API fallback returns local word vectors", fallback.length === 1 && fallback[0].length > 0, `got ${fallback[0]?.length}`)

server.close()
rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true })
console.log(failures === 0 ? "\nEMBED VERIFY: ALL PASS" : `\nEMBED VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
