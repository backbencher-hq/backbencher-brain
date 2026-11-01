// script/verify-embedding-storage.ts — dense vectors are stored ONCE, and every reader still works
//
// WHY THIS GATE EXISTS. Until 2026-11-01 every embedding was written twice: JSON digits in
// `embedding_vector` and float32 in `embedding_blob`. Measured on a real 343-file repository
// (apollo-server, 218 indexable files): 28.9 MB JSON + 9.15 MB float32 on an 84.5 MB database —
// 34% of the whole index was a duplicate copy, and every write/read paid a JSON.stringify/parse.
// The storage contract is now: dense vector = float32 blob only (JSON column EMPTY); sparse token
// lists keep JSON; legacy rows keep JSON until promoted. This gate pins all four claims:
//
//   1. fresh index: every dense row has empty JSON, a dimension*4-byte blob, and the SUM of JSON
//      bytes is zero (the measured duplicate is actually gone, not just "smaller")
//   2. every row decodes through the shared blob-first reader
//   3. the integrity survey (blob-first) reports the rows usable, correct dimensions, no mismatch
//   4. a LEGACY row (JSON materialised from the blob, blob NULL) is still readable and counted
//      usable, and the backfill re-promotes its blob — old indexes keep answering without rebuild
//
// Deterministic/offline: the CLI runs from the fixture directory with embedding env stripped, so the
// built-in local word vectors are used (no provider, no network, no key).
//
// Run: npx tsx script/verify-embedding-storage.ts
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import path from "node:path"
import Database from "better-sqlite3"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const CLI = path.join(ROOT, "src/cli/index.ts")
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href

let checks = 0
let failed = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-embed-storage-"))
const project = path.join(tmp, "proj")
const dataDir = path.join(tmp, "data")
mkdirSync(path.join(project, "src"), { recursive: true })
mkdirSync(dataDir, { recursive: true })
for (let i = 1; i <= 6; i++) {
  writeFileSync(
    path.join(project, `src/unit${i}.ts`),
    `export class Service${i} { run(n: number): number { return n + ${i} } }\n` +
      `export function compute${i}(n: number): number { return n * ${i} }\n`,
  )
}
writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "embed-storage-fixture", version: "1.0.0" }))

const childEnv: Record<string, string> = {}
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith("BB_EMBEDDING") || k === "BB_CONFIG_FILE") continue
  if (v !== undefined) childEnv[k] = v
}
childEnv.BB_DATA_DIR = dataDir

try {
  const run = spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, "index", ".", "--force", "--no-setup"], {
    cwd: project,
    encoding: "utf8",
    env: childEnv,
    timeout: 300_000,
  })
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`
  check("fixture index exits 0", run.status === 0, `status=${run.status}\n${out.slice(-300)}`)

  const { getProjectId } = await import("../src/util/project-id")
  const pid = getProjectId(project)
  const dbPath = path.join(dataDir, "projects", pid, "brain.db")
  process.env.BB_DATA_DIR = dataDir // the in-process survey/backfill must read the same DB

  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .prepare(
      `SELECT rowid AS rowid, embedding_model AS model, vector_dimension AS dim,
              embedding_vector AS vector, embedding_blob AS blob
         FROM brain_semantic_embedding ORDER BY rowid`,
    )
    .all() as Array<{ rowid: number; model: string; dim: number; vector: string; blob: Buffer | null }>
  const sums = db
    .prepare(
      `SELECT COUNT(*) AS rows, SUM(LENGTH(embedding_vector)) AS jsonBytes, SUM(LENGTH(embedding_blob)) AS blobBytes
         FROM brain_semantic_embedding`,
    )
    .get() as { rows: number; jsonBytes: number; blobBytes: number }
  db.close()

  check("the fixture produced embeddings (the check has signal)", rows.length > 0, `rows=${rows.length}`)
  check("only the local fallback model is present", rows.every((r) => r.model === "local-word-vectors-v3"), JSON.stringify([...new Set(rows.map((r) => r.model))]))

  // ── 1. one storage copy ────────────────────────────────────────────────────────────────────────
  const nonEmptyJson = rows.filter((r) => r.vector !== "").length
  const badBlob = rows.filter((r) => !r.blob || (r.blob as Buffer).byteLength !== Number(r.dim) * 4).length
  check("every dense row keeps the JSON column empty", nonEmptyJson === 0, `${nonEmptyJson}/${rows.length} non-empty`)
  check("every dense row has a dimension*4-byte blob", badBlob === 0, `${badBlob}/${rows.length} bad`)
  check(
    "the database stores ZERO JSON vector bytes for dense rows",
    Number(sums.jsonBytes ?? 0) === 0 && Number(sums.blobBytes ?? 0) === rows.reduce((n, r) => n + Number(r.dim) * 4, 0),
    `jsonBytes=${sums.jsonBytes} blobBytes=${sums.blobBytes}`,
  )

  // ── 2. the shared reader decodes every row ──────────────────────────────────────────────────────
  const { readRowVector, decodeVectorBlob } = await import("../src/brain/semantic/vector-binary")
  let decoded = 0
  let degenerate = 0
  for (const r of rows) {
    const v = readRowVector(r.blob, r.vector, Number(r.dim), new Float32Array(Number(r.dim)))
    if (!v) continue
    decoded++
    let nonzero = false
    for (let i = 0; i < v.length; i++) {
      if (!Number.isFinite(v[i])) { nonzero = false; break }
      if (v[i] !== 0) nonzero = true
    }
    if (!nonzero) degenerate++
  }
  check("every row decodes through readRowVector", decoded === rows.length, `${decoded}/${rows.length}`)
  check("decoded vectors are finite and non-degenerate", degenerate === 0, `${degenerate} degenerate`)

  // ── 3. the integrity survey is blob-first and clean ────────────────────────────────────────────
  const { surveyEmbeddingIntegrity, backfillEmbeddingBlobs } = await import("../src/ast/parallel-indexer")
  const survey = await surveyEmbeddingIntegrity(pid as any)
  check("survey sees every row", survey.total === rows.length && survey.scanned === rows.length, JSON.stringify({ total: survey.total, scanned: survey.scanned }))
  check(
    "survey reports no mismatches/malformed/unusable rows",
    survey.dimensionMismatches === 0 && survey.malformedVectors === 0 && survey.unusableEmbeddings === 0,
    JSON.stringify({ dim: survey.dimensionMismatches, malformed: survey.malformedVectors, unusable: survey.unusableEmbeddings }),
  )
  check("survey reports the observed dimension", survey.models.length === 1 && survey.models[0].dimensions.includes(Number(rows[0].dim)), JSON.stringify(survey.models))
  check("survey does not call the index mixed", survey.mixed === false)

  // ── 4. legacy compatibility: JSON-only rows still work, backfill promotes ──────────────────────
  {
    const legacy = rows[0]
    const decoded0 = decodeVectorBlob(legacy.blob, Number(legacy.dim))!
    const write = new Database(dbPath)
    try {
      write
        .prepare("UPDATE brain_semantic_embedding SET embedding_vector = ?, embedding_blob = NULL WHERE rowid = ?")
        .run(JSON.stringify(Array.from(decoded0)), legacy.rowid)
    } finally {
      write.close()
    }
    const legacyRow = { blob: null, vector: JSON.stringify(Array.from(decoded0)), dim: Number(legacy.dim) }
    const read = readRowVector(legacyRow.blob, legacyRow.vector, legacyRow.dim, new Float32Array(legacyRow.dim))
    check("a legacy JSON-only row is still readable through the shared reader", !!read && read.length === legacyRow.dim)
    const surveyLegacy = await surveyEmbeddingIntegrity(pid as any)
    check(
      "the survey counts the legacy JSON-only row as usable, not malformed",
      surveyLegacy.unusableEmbeddings === 0 && surveyLegacy.malformedVectors === 0,
      JSON.stringify({ unusable: surveyLegacy.unusableEmbeddings, malformed: surveyLegacy.malformedVectors }),
    )
    const bf = await backfillEmbeddingBlobs(pid as any, { budgetMs: 30_000 })
    const after = new Database(dbPath, { readonly: true })
    const reBlobbed = after
      .prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE embedding_blob IS NOT NULL AND LENGTH(embedding_blob) = vector_dimension * 4")
      .get() as { c: number }
    after.close()
    check("the backfill re-promoted the legacy row's blob", bf.remaining === 0 && Number(reBlobbed.c) === rows.length, JSON.stringify({ ...bf, reblobbed: reBlobbed.c }))
  }
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nEMBEDDING STORAGE: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
process.exit(failed === 0 ? 0 : 1)
