// script/m50/verify-vector-blobs.ts — M50.A2 (#764) permanent gate.
//
// Governed surface: the dense-vector read accelerator added because bb_ask
// spent ~1.75s re-parsing JSON vectors + ~0.45s reading 260MB of JSON text per
// call on the real index (validation/m50/results/A2-ask-phases.json).
//
// Claims this gate makes falsifiable, on a REAL indexed fixture:
//   P1. Fresh schema carries embedding_blob; a pre-existing table without it
//       gains it via the additive migration (O(1), NULL for every old row).
//   P2. The indexer writes a blob for every dense vector it stores — correct
//       byte length (dimension x 4) and decodable back to the same numbers.
//   P3. Sparse rows (tfidf-v1) are NEVER given a blob — a blob would
//       misrepresent a token list as a dense vector.
//   P4. Legacy rows (blob NULL) answer exactly as they did before: identical
//       results/similarities through the JSON path.
//   P5. backfillEmbeddingBlobs promotes legacy dense rows in place, leaves
//       sparse rows alone, and reports remaining=0 when done.
//   P6. After promotion, the same query returns the SAME answers (the
//       accelerator may not change what bb_ask says).
//   P7. The blob is actually preferred: with every JSON vector made unreadable
//       but blobs intact, the search still answers from vectors (method
//       "vector") — a reader that ignored the blob would fall back to keyword.
//   M1. MUTATION: truncated blobs (dimension x 4 - 1 bytes) must be rejected
//       and answered from JSON — never decoded into garbage, never thrown.
//   M2. MUTATION: the column dropped entirely (readonly/legacy open) must still
//       answer from JSON.
//
// Hermetic by construction: the provider is replaced with a deterministic dense
// vector function, so this gate never touches the network. Provider behaviour
// itself is covered by m21/verify-embedding-queue.ts and m16.
//
// Runs under bun AND node/tsx.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m50-blob-"))
const DIM = 32
const TEST_MODEL = "m50-test-dense-v1"

let pass = 0
let failed = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`)
  }
}

/**
 * Deterministic dense vector for any text (no provider call). All vectors share
 * a fixed base direction plus a small per-text jitter, so their cosines sit
 * around 0.99 — well above the local-vector threshold (0.15) the real search
 * applies — while still ranking distinctly by text. This exercises the REAL
 * threshold/ranking path instead of a synthetic bypass.
 */
const BASE_VECTOR: number[] = (() => {
  let s = 12345
  const a: number[] = []
  for (let i = 0; i < DIM; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    a.push((s % 2000) / 1000 - 1)
  }
  return a
})()

function fakeVector(text: string): number[] {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h = h >>> 0
  return BASE_VECTOR.map((b, i) => b + (((h >>> (i % 24)) & 15) - 7) * 0.003)
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel, backfillEmbeddingBlobs, flushBackgroundEmbeddings } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { ensureSchema, ensureEmbeddingBlobColumn } = await import(path.join(ROOT, "src/brain/schema-ddl"))
  const { SemanticEngine } = await import(path.join(ROOT, "src/brain/semantic/engine"))
  const { semanticVectorSearch } = await import(path.join(ROOT, "src/intelligence/search/semantic-search"))
  const vb = await import(path.join(ROOT, "src/brain/semantic/vector-binary"))

  // ── hermetic provider: deterministic dense vectors, no network ───────────
  ;(SemanticEngine as any).embed = async (text: string) => fakeVector(text)
  ;(SemanticEngine as any).embedMany = async (texts: string[]) => texts.map(fakeVector)
  ;(SemanticEngine as any).getLastEmbeddingModel = () => TEST_MODEL

  const proj = mkdtempSync(path.join(tmpdir(), "bb-m50-blob-proj-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(path.join(proj, "src", "lib.ts"), `export function ledgerEntry(v: number): number { return v + 1 }\nexport function ledgerTotal(v: number): number { return v * 3 }\n`)
  writeFileSync(path.join(proj, "src", "app.ts"), `import { ledgerEntry, ledgerTotal } from "./lib"\nexport function ledgerFlow(v: number): number { return ledgerEntry(v) + ledgerTotal(v) }\nexport class LedgerService { balance(v: number): number { return ledgerFlow(v) } }\n`)
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "m50-blob-fixture", version: "1.0.0" }))

  // ── P1: migration adds the column to a pre-existing table ───────────────
  const legacyDbPath = path.join(process.env.BB_DATA_DIR!, "legacy-probe.db")
  {
    // Build a table exactly as the pre-M50 DDL did (no embedding_blob), through
    // the repo's cross-runtime driver (better-sqlite3 under node, bun:sqlite
    // under bun) — the gate must run on both.
    const isBun = typeof (globalThis as any).Bun !== "undefined"
    const { openDatabase } = await import(path.join(ROOT, isBun ? "src/storage/db.bun.ts" : "src/storage/db.node.ts"))
    const db = openDatabase(legacyDbPath)
    db.exec(`CREATE TABLE brain_semantic_embedding (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL, embedding_model TEXT NOT NULL, embedding_vector TEXT NOT NULL,
      vector_dimension INTEGER NOT NULL, content_hash TEXT NOT NULL, semantic_context TEXT,
      similarity_threshold REAL DEFAULT 0.7, last_updated INTEGER NOT NULL,
      time_created INTEGER NOT NULL DEFAULT 0, time_updated INTEGER NOT NULL DEFAULT 0)`)
    db.run(
      "INSERT INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      "x",
      "p",
      "e",
      "symbol",
      TEST_MODEL,
      JSON.stringify(fakeVector("legacy")),
      DIM,
      "h",
      1,
      1,
      1,
    )
    const colsBefore = (db.prepare("PRAGMA table_info(brain_semantic_embedding)").all() as any[]).map((c: any) => c.name)
    check("P1 pre-migration table has no embedding_blob", !colsBefore.includes("embedding_blob"), colsBefore.join(","))
    ensureEmbeddingBlobColumn(db as any)
    const colsAfter = (db.prepare("PRAGMA table_info(brain_semantic_embedding)").all() as any[]).map((c: any) => c.name)
    check("P1 migration adds embedding_blob", colsAfter.includes("embedding_blob"))
    const legacyValue = (db.prepare("SELECT embedding_blob b FROM brain_semantic_embedding WHERE id='x'").get() as any).b
    check("P1 existing rows read NULL (no fabricated vector)", legacyValue === null || legacyValue === undefined, String(legacyValue))
    // Idempotent: second call must not throw.
    ensureEmbeddingBlobColumn(db as any)
    check("P1 migration is idempotent", true)
    db.close()
  }

  // ── fixture project through the REAL indexer + embedding queue ──────────
  const pid = getProjectId(proj)
  const idx = await indexProjectParallel(pid as any, proj, { force: true, skipPostProcessing: true })
  check("fixture indexed", (idx?.successFiles ?? 0) >= 2, JSON.stringify({ f: idx?.successFiles, e: idx?.errors }))
  const flush = await flushBackgroundEmbeddings({ timeoutMs: 120_000 })
  check("embedding queue drained", flush.resolved === "drained", JSON.stringify(flush))

  const raw = await BrainDatabase.getRawInstance(pid as string)
  const denseRows = raw
    .prepare("SELECT rowid AS rowid, entity_id AS id, embedding_vector AS vector, embedding_blob AS blob, vector_dimension AS dim FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=?")
    .all(pid, TEST_MODEL) as Array<{ rowid: number; id: string; vector: string; blob: any; dim: number }>
  check("P2 dense rows exist in fixture", denseRows.length > 0, `rows=${denseRows.length}`)

  // ── P2: every dense row got a correct-length, decodable blob ────────────
  let badLen = 0
  let mismatched = 0
  let maxDelta = 0
  for (const r of denseRows) {
    if (!r.blob) {
      badLen++
      continue
    }
    const bytes = r.blob instanceof Uint8Array ? r.blob.byteLength : -1
    if (bytes !== r.dim * 4) badLen++
    const decoded = vb.decodeVectorBlob(r.blob, r.dim)
    const jsonVals = JSON.parse(r.vector) as number[]
    if (!decoded) {
      mismatched++
      continue
    }
    for (let i = 0; i < r.dim; i++) maxDelta = Math.max(maxDelta, Math.abs(decoded[i] - jsonVals[i]))
  }
  check("P2 every dense row has dimension x 4 bytes", badLen === 0, `bad=${badLen}/${denseRows.length}`)
  check("P2 blob decodes to the stored numbers", mismatched === 0 && maxDelta < 1e-6, `mismatch=${mismatched} maxDelta=${maxDelta}`)

  // ── P3: sparse rows never get a blob ───────────────────────────────────
  raw
    .prepare(
      "INSERT OR REPLACE INTO brain_semantic_embedding (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, last_updated, time_created, time_updated) VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?)",
    )
    .run("sparse-1:tfidf", pid, "sparse-1", "symbol", "tfidf-v1", JSON.stringify([1, 2, 3]), 3, "h", Date.now(), Date.now(), Date.now())
  const bfSparse = await backfillEmbeddingBlobs(pid as string, { budgetMs: 10_000 })
  const sparseBlob = (raw.prepare("SELECT embedding_blob b FROM brain_semantic_embedding WHERE id='sparse-1:tfidf'").get() as any).b
  check("P3 sparse row stays blob-free after backfill", sparseBlob === null, String(sparseBlob))
  check("P3 backfill does not report sparse rows as remaining", bfSparse.remaining === 0, JSON.stringify(bfSparse))

  // ── codec unit checks (falsifiable, no DB) ─────────────────────────────
  {
    const vals = [0.5, -1.25, 3.75, 1e-7]
    const buf = vb.encodeVectorBlob(vals)
    const dec = vb.decodeVectorBlob(buf, vals.length)
    check("U1 round-trip exact for float32-representable values", !!dec && vals.every((v, i) => dec![i] === Math.fround(v)), dec ? Array.from(dec).join(",") : "null")
    check("U2 short blob -> null (never garbage)", vb.decodeVectorBlob(buf.subarray(0, buf.byteLength - 1), vals.length) === null)
    check("U3 null/missing blob -> null", vb.decodeVectorBlob(null, 4) === null && vb.decodeVectorBlob(undefined, 4) === null)
    const scratch = new Float32Array(6)
    const jsonText = JSON.stringify([0.1, -0.2, 3, 4.5, -0.0009765625, 1e3])
    const n = vb.scanJsonVectorInto(jsonText, scratch)
    const parsed = JSON.parse(jsonText) as number[]
    let d = 0
    for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(scratch[i] - Math.fround(parsed[i])))
    check("U4 JSON scanner is count- and value-faithful", n === 6 && d < 1e-6, `n=${n} delta=${d}`)
    check(
      "U5 malformed JSON vectors are rejected (0, never partial)",
      vb.scanJsonVectorInto('["a","b"]', scratch) === 0 &&
        vb.scanJsonVectorInto("[1,2,3", scratch) === 0 &&
        vb.scanJsonVectorInto("1,2,3", scratch) === 0 &&
        vb.scanJsonVectorInto("[1,2,]", scratch) === 0 &&
        vb.scanJsonVectorInto(JSON.stringify(new Array(10).fill(1)), scratch) === 0,
    )
  }

  // ── P4: legacy rows (blob stripped) answer through the JSON path ────────
  const baseline = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
  check("P4 baseline uses vectors", baseline.metadata.method === "vector" && baseline.results.length > 0, JSON.stringify(baseline.metadata))
  const sig = (r: any) => ({ results: baseline.results.map((x) => `${x.symbolName}@${x.file}#${x.line}`), sims: baseline.results.map((x) => Number(x.similarity.toFixed(6))) })

  raw.prepare("UPDATE brain_semantic_embedding SET embedding_blob = NULL WHERE project_id = ? AND embedding_model = ?").run(pid, TEST_MODEL)
  const legacy = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
  const legacySig = { results: legacy.results.map((x) => `${x.symbolName}@${x.file}#${x.line}`), sims: legacy.results.map((x) => Number(x.similarity.toFixed(6))) }
  check(
    "P4 legacy (JSON-only) rows answer identically",
    legacy.metadata.method === "vector" && JSON.stringify(sig(baseline)) === JSON.stringify(legacySig),
    `${JSON.stringify(sig(baseline))} vs ${JSON.stringify(legacySig)}`,
  )

  // ── P8: a READ promotes legacy rows in the background (no re-index) ────
  {
    // Let any promotion scheduled by the P4 read finish first, then strip
    // synchronously so the premise below cannot race a timer.
    await new Promise((r) => setTimeout(r, 300))
    raw.prepare("UPDATE brain_semantic_embedding SET embedding_blob = NULL WHERE project_id = ? AND embedding_model = ?").run(pid, TEST_MODEL)
    const before = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=? AND embedding_blob IS NOT NULL").get(pid, TEST_MODEL) as any).c
    check("P8 fixture starts with no blobs (premise)", Number(before) === 0, `blobs=${before}`)
    const t0 = Date.now()
    const p8 = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
    const callMs = Date.now() - t0
    check("P8 the read answers from JSON (no inline promotion)", p8.metadata.method === "vector" && p8.results.length > 0, JSON.stringify(p8.metadata))
    let promotedCount = 0
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      promotedCount = Number(
        (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=? AND embedding_blob IS NOT NULL").get(pid, TEST_MODEL) as any).c,
      )
      if (promotedCount === denseRows.length) break
      await new Promise((r) => setTimeout(r, 100))
    }
    check("P8 background promotion filled every dense row without a re-index", promotedCount === denseRows.length, `${promotedCount}/${denseRows.length} after ${callMs}ms call`)
  }

  // ── P5: explicit backfill promotes exactly the dense legacy rows ───────
  raw.prepare("UPDATE brain_semantic_embedding SET embedding_blob = NULL WHERE project_id = ? AND embedding_model = ?").run(pid, TEST_MODEL)
  const bf = await backfillEmbeddingBlobs(pid as string, { budgetMs: 30_000 })
  const remaining = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_blob IS NULL AND embedding_model != 'tfidf-v1'").get(pid) as any).c
  check("P5 backfill promoted every dense row", bf.promoted === denseRows.length, JSON.stringify(bf))
  check("P5 remaining dense rows = 0", remaining === 0 && bf.remaining === 0, `remaining=${remaining}`)
  const reBlobbed = raw
    .prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=? AND embedding_blob IS NOT NULL AND LENGTH(embedding_blob) = vector_dimension * 4")
    .get(pid, TEST_MODEL) as any
  check("P5 re-promoted blobs have the right byte length", Number(reBlobbed.c) === denseRows.length, `c=${reBlobbed.c}`)

  // ── P6: answers unchanged after promotion ──────────────────────────────
  const promoted = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
  const promotedSig = { results: promoted.results.map((x) => `${x.symbolName}@${x.file}#${x.line}`), sims: promoted.results.map((x) => Number(x.similarity.toFixed(6))) }
  check("P6 accelerated answers identical to JSON answers", JSON.stringify(promotedSig) === JSON.stringify(legacySig), `${JSON.stringify(promotedSig)} vs ${JSON.stringify(legacySig)}`)

  // ── P7: the blob is actually preferred over JSON ───────────────────────
  raw.prepare("UPDATE brain_semantic_embedding SET embedding_vector = 'not-json' WHERE project_id = ? AND embedding_model = ?").run(pid, TEST_MODEL)
  const fromBlob = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
  check(
    "P7 with unreadable JSON, blobs still answer from vectors",
    fromBlob.metadata.method === "vector" && fromBlob.results.length > 0 && JSON.stringify({ results: fromBlob.results.map((x) => `${x.symbolName}@${x.file}#${x.line}`), sims: fromBlob.results.map((x) => Number(x.similarity.toFixed(6))) }) === JSON.stringify(promotedSig),
    `${fromBlob.metadata.method} fallback=${fromBlob.metadata.fallbackReason}`,
  )
  // restore the JSON column to each row's real vector
  {
    const restore = raw.prepare("UPDATE brain_semantic_embedding SET embedding_vector = ? WHERE project_id = ? AND entity_id = ? AND embedding_model = ?")
    for (const r of denseRows) restore.run(r.vector, pid, r.id, TEST_MODEL)
  }

  // ── M1: truncated blob must be rejected, JSON must answer ──────────────
  raw.prepare("UPDATE brain_semantic_embedding SET embedding_blob = SUBSTR(embedding_blob, 1, LENGTH(embedding_blob) - 1) WHERE project_id = ? AND embedding_model = ?").run(pid, TEST_MODEL)
  // M1 relies on the JSON column being VALID (the fallback must answer from it)
  {
    const restore = raw.prepare("UPDATE brain_semantic_embedding SET embedding_vector = ? WHERE project_id = ? AND entity_id = ? AND embedding_model = ?")
    for (const r of denseRows) restore.run(r.vector, pid, r.id, TEST_MODEL)
  }
  let mutFail = ""
  let m1: any = null
  try {
    m1 = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
  } catch (e: any) {
    mutFail = e?.message ?? String(e)
  }
  const m1LengthsOk = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? AND embedding_model=? AND embedding_blob IS NOT NULL AND LENGTH(embedding_blob) = vector_dimension*4").get(pid, TEST_MODEL) as any).c
  check("M1 truncated blobs exist (mutation applied)", Number(m1LengthsOk) === 0)
  check("M1 truncated blobs rejected, JSON path answers, no throw", mutFail === "" && m1?.metadata?.method === "vector" && m1.results.length > 0, mutFail || JSON.stringify(m1?.metadata))

  // ── M2: column dropped entirely must still answer ──────────────────────
  raw.prepare("UPDATE brain_semantic_embedding SET embedding_blob = NULL WHERE project_id = ? AND embedding_model = ?").run(pid, TEST_MODEL)
  raw.exec("ALTER TABLE brain_semantic_embedding DROP COLUMN embedding_blob")
  let m2: any = null
  let m2Err = ""
  try {
    m2 = await semanticVectorSearch(pid as string, "ledger flow", { maxResults: 5 })
  } catch (e: any) {
    m2Err = e?.message ?? String(e)
  }
  check("M2 without the column the search still answers from JSON", m2Err === "" && m2?.metadata?.method === "vector" && m2.results.length > 0, m2Err || JSON.stringify(m2?.metadata))

  // ── restore a conforming world (column back + rows promoted) ───────────
  ensureEmbeddingBlobColumn(raw)
  ensureSchema(raw)
  const bfRestore = await backfillEmbeddingBlobs(pid as string, { budgetMs: 30_000 })
  check("restore: dense rows re-promoted", bfRestore.remaining === 0, JSON.stringify(bfRestore))

  console.log(`\n${pass} passed, ${failed} failed`)
  // ── evidence stamp (M50.A5 pattern: every gate seals its run) ──────────
  try {
    const { execFileSync } = await import("node:child_process")
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const dir = path.join(ROOT, "validation/m50/results")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "A2-vector-blobs.json"),
      JSON.stringify(
        {
          gate: "M50.A2-vector-blobs",
          issue: 764,
          milestone: "M50",
          at: new Date().toISOString(),
          commit,
          checks: pass + failed,
          passed: pass,
          failed,
          // Declared for the G2 self-test: this gate performs its own
          // mutations in-run (M1 truncated blobs, M2 column dropped) and
          // restores a conforming world afterwards.
          mutationChecks: ["M1 truncated blobs rejected + JSON answers", "M2 column absent -> JSON answers", "restore re-promotes every dense row"],
          verifierCommand: "npx tsx script/m50/verify-vector-blobs.ts",
          status: failed === 0 ? "verified" : "known-gap",
        },
        null,
        2,
      ) + "\n",
    )
  } catch {}
  try {
    BrainDatabase.closeAll()
  } catch {}
  rmSync(process.env.BB_DATA_DIR!, { recursive: true, force: true })
  rmSync(proj, { recursive: true, force: true })
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error("FAIL", e && (e.stack || e.message))
  process.exit(1)
})
