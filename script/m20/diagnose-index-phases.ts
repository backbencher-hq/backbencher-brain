// script/m20/diagnose-index-phases.ts — read-only/index-diagnostic evidence.
//
// This script does not wipe, reset, clean, or mutate source repositories. It
// measures existing DB state and a bounded incremental run over selected files.
// It intentionally separates discovery/parse-store timing from optional heavy
// post-processing and embedding state. No result is treated as a complexity
// proof; all numbers are machine-specific observations.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings, type ParallelIndexingStats } from "../../src/ast/parallel-indexer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m20/results")
const candidates = [
  { id: "rake", path: "$HOME/fixtures/repositories/rake", sample: 12 },
  { id: "typescript", path: "$HOME/TypeScript", sample: 12 },
  { id: "intellij-community", path: "$HOME/intellij-community", sample: 12 },
  { id: "aspnetcore", path: "$HOME/aspnetcore", sample: 12 },
]

function count(raw: any, table: string, projectId: string): number {
  return Number((raw.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id=?`).get(projectId) as any)?.c ?? 0)
}

function sourcePathHash(file: string): string {
  return Bun.hash(readFileSync(file)).toString(16)
}
async function flushWithTimeout(ms: number): Promise<boolean> {
  let completed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = flushBackgroundEmbeddings().then(() => { completed = true })
  try {
    await Promise.race([
      flush,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) }),
    ])
    return completed
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const measured: any[] = []
let checks = 0
let passed = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

for (const candidate of candidates) {
  if (!existsSync(candidate.path)) continue
  const projectId = getProjectId(candidate.path)
  const dbPath = BrainDatabase.getDbPath(projectId)
  if (!existsSync(dbPath)) {
    check(`${candidate.id}: indexed DB exists`, false, dbPath)
    continue
  }
  const raw = await BrainDatabase.getRawInstance(projectId)
  const before = {
    files: count(raw, "brain_file", projectId),
    symbols: count(raw, "brain_symbol", projectId),
    relationships: count(raw, "brain_relationship", projectId),
    embeddings: count(raw, "brain_semantic_embedding", projectId),
  }
  const status = raw.prepare("SELECT * FROM brain_index_status WHERE project_id=?").get(projectId) as any
  const errors = status?.indexing_errors ? JSON.parse(String(status.indexing_errors)) : []
  const performanceStats = status?.performance_stats ? JSON.parse(String(status.performance_stats)) : null
  check(`${candidate.id}: non-empty indexed state`, before.files > 0 && before.symbols > 0, JSON.stringify(before))

  // Run only a bounded incremental sample. Existing unchanged files should be
  // skipped; if files are stale, this measures real parser/store work. The
  // source hash proves this diagnostic did not alter the sampled source file.
  const rows = raw.prepare("SELECT path FROM brain_file WHERE project_id=? ORDER BY path LIMIT ?").all(projectId, candidate.sample) as any[]
  const sample = rows.map((r) => String(r.path)).filter((p) => existsSync(p))
  const sourceHashes = new Map(sample.map((p) => [p, sourcePathHash(p)]))
  const started = performance.now()
  let stats: ParallelIndexingStats | null = null
  let error = ""
  let embeddingFlushTimedOut = false
  try {
    stats = await indexProjectParallel(projectId as any, candidate.path, {
      files: sample,
      isIncremental: true,
      skipPostProcessing: true,
      logger: { log: () => {}, write: () => {} },
    })
    // This is intentionally awaited to expose whether background embedding
    // work is coupled to the caller's completion path.
    embeddingFlushTimedOut = !(await flushWithTimeout(30000))
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100
  const sourceUnchanged = sample.every((p) => sourceHashes.get(p) === sourcePathHash(p))
  const after = {
    files: count(raw, "brain_file", projectId),
    symbols: count(raw, "brain_symbol", projectId),
    relationships: count(raw, "brain_relationship", projectId),
    embeddings: count(raw, "brain_semantic_embedding", projectId),
  }
  check(`${candidate.id}: bounded run returned`, stats !== null, error)
  check(`${candidate.id}: source remained unchanged`, sourceUnchanged)
  if (stats) {
    check(`${candidate.id}: accounting is bounded`, stats.processedFiles <= Math.max(stats.totalFiles, sample.length), `processed=${stats.processedFiles} total=${stats.totalFiles}`)
  }
  measured.push({
    id: candidate.id,
    path: candidate.path,
    sampleFiles: sample.length,
    before,
    after,
    elapsedMs,
    stats,
    persistedIndexStatus: { errors, performanceStats },
    sourceUnchanged,
    error: error || null,
    embeddingFlushTimedOut,
  })
}

const result = {
  issue: "M20.PERF-DIAGNOSTIC",
  code: "PERF-DIAGNOSTIC",
  milestone: "M20",
  status: checks > 0 && checks === passed ? "verified" : "known-gap",
  checks,
  passed,
  failed: checks - passed,
  currentCommit: (await Bun.$`git rev-parse HEAD`.text()).trim(),
  verifierCommand: "bun run script/m20/diagnose-index-phases.ts",
  generatedAt: new Date().toISOString(),
  methodology: "Read existing index state, then run a bounded incremental sample with post-processing disabled; await background embeddings separately; hash sampled source files before/after.",
  measured,
  interpretation: "elapsedMs includes parser/store work for the bounded sample plus the bounded embedding-flush wait. A timed-out flush is reported explicitly and does not count as embedding completion; this is not a full-index duration and does not establish asymptotic complexity.",
  limitations: [
    "Only repositories present and already indexed on this machine are measured.",
    "The bounded sample is not representative of a cold full index.",
    "Provider/API latency is reported only indirectly unless embedding configuration exposes provider timing.",
    "Index status fields are observed as persisted; missing fields are null, never interpreted as zero.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(path.join(RESULTS, "PERF-DIAGNOSTIC.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`PERF-DIAGNOSTIC: ${result.status.toUpperCase()} (${passed}/${checks})`)
process.exit(result.status === "verified" ? 0 : 1)
