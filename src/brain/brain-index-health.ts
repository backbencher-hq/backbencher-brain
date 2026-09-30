/**
 * Brain Index Health — Integrity Validation System
 *
 * Runs a fixed battery of validation queries against the brain database to
 * detect:
  * - Null byte/line bounds that break canonical bb_edit mutations
 * - Orphan relationships (dangling source or target symbol IDs)
 * - Stale files (hash mismatch or missing from disk)
 * - Embedding coverage gaps
 * - Syntax error files that tools shouldn't operate on
 * - WAL size monitoring
 * - File/symbol/relationship count consistency
 *
 * M64.I2: the count is DERIVED, not asserted. The tool description and the
 * generated docs both said "the 12-point index health check" while the array
 * held 13 entries (checkOrphanOwners returns two). A number kept in prose that
 * the code can drift away from is a number that will be wrong again, so the
 * count now comes from `checks.length` and nothing asserts it.
 *
 * M64.I3: `overallHealth` scores SCORED checks only. "Synthetic Container
 * References" is informational by construction — it reports a by-design
 * synthetic-id population whose status is hardcoded "ok" — and counting it
 * added a constant +7.7 points to every project, so a project with a real
 * integrity failure still could not report below 93%.
 *
 * All queries are SELECT-only — no schema changes needed.
 */

import type { ProjectID } from "../project/schema"
import { BrainDatabase } from "./database"
import { selectSampleFiles } from "./freshness"
// M40.A4: static imports instead of bare require() — the latter throws
// "require is not defined" under Node ESM (tsx), breaking the integrity
// phase on every index. Dual-runtime rule: M21.D2.
import * as fs from "node:fs"
import * as crypto from "node:crypto"

// ─── Health Report Types ───────────────────────────────────────────────────

export type HealthStatus = "ok" | "warn" | "error"

export interface HealthCheck {
  name: string
  status: HealthStatus
  value: number
  total?: number
  percentage?: number
  threshold: { warn: number; error: number }
  description: string
  remediation?: string
  sample?: string[] // First few affected items for diagnosis
  /**
   * M64.I3: "informational" checks report a population for context and are
   * excluded from `overallHealth`. A check that can only ever be "ok" (its
   * status is not a function of the data) would otherwise contribute a
   * constant number of points to every project and raise the floor of the
   * score. Defaults to "scored" so an existing caller is unaffected.
   */
  kind?: "scored" | "informational"
}

export interface IndexHealthReport {
  projectId: ProjectID
  timestamp: number
  /** M64.I3: ok / scoredChecks, 0-100. Informational checks do not count. */
  overallHealth: number
  checks: HealthCheck[]
  summary: {
    ok: number
    warn: number
    error: number
    /** M64.I2/I3: derived, so no prose has to assert it. */
    total: number
    scored: number
    informational: number
  }
}

// ─── Core Validation ───────────────────────────────────────────────────────

export interface IndexHealthOptions {
  /**
   * M64.N1: how the two disk-touching checks (Hash Drift, Files Missing) choose
   * which files to look at.
   *
   *   "sample"   a deterministic, order-independent, unbiased sample of ~200 /
   *              ~100 files. Cheap; the resulting rate carries sampling error.
   *   "complete" every indexed file. Exact.
   *
   * The split exists because the two callers want different things. The INDEXER
   * calls this on the hot path of every index run, where a full content hash of
   * the corpus is not affordable, and it only logs a summary line. bb_health's
   * `integrity: true` is the opt-in DEEP check, and a deep check that reports a
   * sampled rate cannot answer the question it exists to answer: a verdict that
   * depends on a threshold with a margin is a verdict that can disagree with
   * itself. Measured: on a corpus with a true 10.0% drift rate, the sampled
   * check reported 11.0% and graded "error" where a complete scan graded the
   * same index "warn".
   *
   * So the default is "sample" (the indexer's cost profile is unchanged) and
   * the deep check opts into "complete", which makes it agree EXACTLY with
   * bb_health's own `freshness: "complete"` — same population, same method,
   * no estimate between them.
   */
  diskScan?: "sample" | "complete"
}

export async function runIndexHealthCheck(projectId: ProjectID, options: IndexHealthOptions = {}): Promise<IndexHealthReport> {
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const diskScan = options.diskScan ?? "sample"
  const checks: HealthCheck[] = []

  // 1. Byte bounds coverage
  checks.push(await checkByteBounds(rawDb, projectId))

  // 2. Line bounds coverage
  checks.push(await checkLineBounds(rawDb, projectId))

  // 3. Orphan relationships (target symbol deleted)
  checks.push(await checkOrphanTargets(rawDb, projectId))

  // 4. Dangling source relationships (source symbol deleted)
  checks.push(await checkDanglingSources(rawDb, projectId))

  // 5. Orphan owner_symbol_id — M51.A2 (#717) splits genuine danglers from
  // the by-design synthetic container ids (separate informational check).
  checks.push(...(await checkOrphanOwners(rawDb, projectId)))

  // 6. Stale file hashes (file_hash vs actual file content)
  checks.push(await checkHashDrift(rawDb, projectId, diskScan))

  // 7. Files missing from disk
  checks.push(await checkMissingFiles(rawDb, projectId, diskScan))

  // 8. Embedding coverage
  checks.push(await checkEmbeddingCoverage(rawDb, projectId))

  // 9. Syntax error files
  checks.push(await checkSyntaxErrorFiles(rawDb, projectId))

  // 10. WAL size
  checks.push(await checkWalSize(rawDb, projectId))

  // 11. File/symbol consistency (files with 0 symbols)
  checks.push(await checkEmptyFiles(rawDb, projectId))

  // 12. Relationship count vs symbol count ratio (sanity)
  checks.push(await checkRelationshipRatio(rawDb, projectId))

  // M64.I3: the score is over scored checks only. See HealthCheck.kind.
  const scored = checks.filter((c) => c.kind !== "informational")
  const informational = checks.filter((c) => c.kind === "informational")
  const ok = scored.filter((c) => c.status === "ok").length
  const warn = scored.filter((c) => c.status === "warn").length
  const error = scored.filter((c) => c.status === "error").length
  const overallHealth = Math.round((ok / Math.max(scored.length, 1)) * 100)

  return {
    projectId,
    timestamp: Date.now(),
    overallHealth,
    checks,
    summary: { ok, warn, error, total: checks.length, scored: scored.length, informational: informational.length },
  }
}

// ─── Individual Checks ─────────────────────────────────────────────────────

async function checkByteBounds(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  const row = rawDb.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN byte_start IS NULL OR byte_end IS NULL THEN 1 ELSE 0 END) as null_count
    FROM brain_symbol WHERE project_id = ?
  `).get(projectId) as any

  const total = row?.total ?? 0
  const nullCount = row?.null_count ?? 0
  const pct = total > 0 ? (nullCount / total) * 100 : 0

  let sample: string[] = []
  if (nullCount > 0) {
    const rows = rawDb.prepare(`
      SELECT name, file_id FROM brain_symbol
      WHERE project_id = ? AND (byte_start IS NULL OR byte_end IS NULL)
      LIMIT 5
    `).all(projectId) as any[]
    sample = rows.map((r: any) => `${r.name} (${r.file_id})`)
  }

  return {
    name: "Byte Bounds Coverage",
    status: pct > 5 ? "error" : pct > 1 ? "warn" : "ok",
    value: nullCount,
    total,
    percentage: Math.round((100 - pct) * 10) / 10,
    threshold: { warn: 1, error: 5 },
    description: `${nullCount} of ${total} symbols have NULL byte bounds. Without byte bounds, bb_edit cannot safely mutate these symbols.`,
    remediation: nullCount > 0 ? "Run bb_health with refresh=true and force=true to reindex affected files." : undefined,
    sample: sample.length > 0 ? sample : undefined,
  }
}

async function checkLineBounds(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  const row = rawDb.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN line_start IS NULL THEN 1 ELSE 0 END) as null_count
    FROM brain_symbol WHERE project_id = ?
  `).get(projectId) as any

  const total = row?.total ?? 0
  const nullCount = row?.null_count ?? 0
  const pct = total > 0 ? (nullCount / total) * 100 : 0

  return {
    name: "Line Bounds Coverage",
    status: pct > 10 ? "error" : pct > 2 ? "warn" : "ok",
    value: nullCount,
    total,
    percentage: Math.round((100 - pct) * 10) / 10,
    threshold: { warn: 2, error: 10 },
    description: `${nullCount} symbols have NULL line_start. Tools fall back to file-level operations for these.`,
    remediation: nullCount > 0 ? "These are typically top-level or auto-generated symbols. Generally safe." : undefined,
  }
}

async function checkOrphanTargets(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  const row = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_relationship r
    WHERE r.project_id = ?
      AND r.target_symbol_id IS NOT NULL
      AND r.target_symbol_id != ''
      AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.target_symbol_id AND s.project_id = r.project_id)
  `).get(projectId) as any

  const orphanCount = row?.count ?? 0

  let sample: string[] = []
  if (orphanCount > 0) {
    const rows = rawDb.prepare(`
      SELECT r.id, r.target_symbol_id, r.source_symbol_id FROM brain_relationship r
      WHERE r.project_id = ?
        AND r.target_symbol_id IS NOT NULL
        AND r.target_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.target_symbol_id AND s.project_id = r.project_id)
      LIMIT 5
    `).all(projectId) as any[]
    sample = rows.map((r: any) => `rel ${r.id}: target ${r.target_symbol_id} (from ${r.source_symbol_id})`)
  }

  return {
    name: "Orphan Target Relationships",
    status: orphanCount > 100 ? "error" : orphanCount > 10 ? "warn" : "ok",
    value: orphanCount,
    threshold: { warn: 10, error: 100 },
    description: `${orphanCount} relationships point to symbols that no longer exist. These inflate bb_analyze graph results but lead nowhere.`,
    remediation: orphanCount > 0 ? "Run bb_health with refresh=true and force=true to rebuild the index." : undefined,
    sample: sample.length > 0 ? sample : undefined,
  }
}

async function checkDanglingSources(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  // M51.A2 (#717): source_symbol_id IS NULL is the legitimate representation
  // for external-source edges (source_external carries the name) — counting
  // NULL as dangling misreported 4,122 of 4,154 edges on this repo's index.
  const row = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_relationship r
    WHERE r.project_id = ?
      AND r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
      AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id AND s.project_id = r.project_id)
  `).get(projectId) as any

  const danglingCount = row?.count ?? 0

  return {
    name: "Dangling Source Relationships",
    status: danglingCount > 100 ? "error" : danglingCount > 10 ? "warn" : "ok",
    value: danglingCount,
    threshold: { warn: 10, error: 100 },
    description: `${danglingCount} relationships have a non-empty source_symbol_id that matches no stored symbol. These are dead edges in the call graph. (External-source edges with a NULL source_symbol_id are legitimate and not counted.)`,
    remediation: danglingCount > 0
      ? "Re-index the affected files (`bb index <dir>`) so edges are written against stored symbols. A --force rebuild only helps if the danglers came from an older indexer version; if they persist on a fresh index, this is an indexer bug — report it with the sample ids."
      : undefined,
  }
}

async function checkOrphanOwners(rawDb: any, projectId: ProjectID): Promise<HealthCheck[]> {
  // M51.A2 (#717): the old single check conflated two populations. Row-level
  // evidence on this repo: 134,045 orphans were synthetic container ids
  // (`<file>:<name>:0`) the pre-M51 indexer wrote as an owner fallback — by
  // design they never resolve (no stored row can have line 0) and every
  // consumer JOINs on owner_symbol_id, so they were already invisible; only
  // 28 were genuine danglers. Reporting 134k "errors" trained users to ignore
  // health (cry-wolf), and the old remediation ("rebuild with --force") was
  // proven false — a clean rebuild reproduced the identical warning.
  const genuine = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_symbol s
    WHERE s.project_id = ?
      AND s.owner_symbol_id IS NOT NULL
      AND s.owner_symbol_id != ''
      AND s.owner_symbol_id NOT LIKE '%:0'
      AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)
  `).get(projectId) as any

  const synthetic = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_symbol s
    WHERE s.project_id = ?
      AND s.owner_symbol_id IS NOT NULL
      AND s.owner_symbol_id != ''
      AND s.owner_symbol_id LIKE '%:0'
      AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)
  `).get(projectId) as any

  const samples = rawDb.prepare(`
    SELECT s.owner_symbol_id as oid, COUNT(*) as c FROM brain_symbol s
    WHERE s.project_id = ?
      AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
      AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)
    GROUP BY s.owner_symbol_id ORDER BY c DESC LIMIT 5
  `).all(projectId) as any[]

  const genuineCount = genuine?.count ?? 0
  const syntheticCount = synthetic?.count ?? 0
  const sample = samples.map((r) => `${r.c}x ${String(r.oid).slice(-60)}`)

  return [
    {
      name: "Orphan Owner References",
      status: genuineCount > 100 ? "error" : genuineCount > 10 ? "warn" : "ok",
      value: genuineCount,
      threshold: { warn: 10, error: 100 },
      description: `${genuineCount} symbols reference an owner_symbol_id that is not a synthetic container and matches no stored symbol. This breaks containment chains in bb_trace and the LSP document tree.`,
      remediation: genuineCount > 0
        ? "Re-index the affected files (`bb index <dir>`); if the count does not drop to zero on a fresh index, this is an indexer bug — report it with the sample ids. A --force rebuild is NOT guaranteed to fix this."
        : undefined,
      sample: sample.length > 0 ? sample : undefined,
    },
    {
      name: "Synthetic Container References",
      status: "ok",
      // M64.I3: informational. This population is by-design and its status does
      // not depend on the data, so scoring it added a constant +7.7 points to
      // every project's overallHealth and put a floor under the score that no
      // number of real failures could cross.
      kind: "informational",
      value: syntheticCount,
      threshold: { warn: 10000000, error: 10000000 },
      description: `${syntheticCount} symbols carry owner ids of the form <file>:<name>:0 — module/synthetic containers the pre-M51 indexer wrote as an owner fallback. By design they never resolve (no stored row has line 0) and every consumer JOINs on owner_symbol_id, so they are invisible to reads. Informational, not a defect, and excluded from overallHealth.`,
      remediation: syntheticCount > 0
        ? "Optional: re-run `bb index` — rows written by pre-M51 indexers are rewritten with a resolvable owner (or NULL) and this count drops to 0."
        : undefined,
      sample: sample.length > 0 ? sample : undefined,
    },
  ]
}

async function checkHashDrift(rawDb: any, projectId: ProjectID, diskScan: "sample" | "complete"): Promise<HealthCheck> {
  // M64.N1: this sampled with `ORDER BY RANDOM()`, which made the check's own
  // verdict non-reproducible. Proven on a 400-file fixture with exactly 40
  // files (10.0%) staled on disk, five consecutive integrity runs on the SAME
  // unchanging index reported drift counts of 21, 17, 22, 19 and 16 out of 200
  // — five different answers, extrapolated to 42/34/44/38/32 "total" against a
  // truth of 40. The status thresholds are pct>10 => error and pct>3 => warn,
  // so at a true 10% drift rate the reported rate swung across the warn/error
  // boundary and the same index was graded differently from one second to the
  // next. A health check that cannot decide which state it is in is not a
  // health check.
  //
  // The replacement shares `selectSampleFiles` with the main freshness check —
  // the same deterministic, order-independent, unbiased selection over the same
  // population (all indexed files; the old SQL also excluded
  // language='unknown', so the two numbers could not be compared at all). One
  // selection, one method: these two checks now measure the same thing and
  // cannot disagree by construction. See M64 in src/brain/freshness.ts for why
  // a stride was tried and rejected.
  const totalRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_file WHERE project_id = ?
  `).get(projectId) as any
  const total = totalRow?.count ?? 0

  const allFiles = rawDb.prepare(`
    SELECT id, path, relative_path, file_hash FROM brain_file WHERE project_id = ?
  `).all(projectId) as any[]
  const files = (diskScan === "complete" ? selectSampleFiles(allFiles, Number.MAX_SAFE_INTEGER) : selectSampleFiles(allFiles, 200)) as any[]

  let driftCount = 0
  const driftSamples: string[] = []
  for (const f of files) {
    try {
      const buf = fs.readFileSync(f.path)
      const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16)
      if (hash !== f.file_hash) {
        driftCount++
        if (driftSamples.length < 5) driftSamples.push(f.relative_path)
      }
    } catch {
      // File deleted since index — counted by checkMissingFiles, skip here
    }
  }

  const sampleSize = files.length
  const pct = sampleSize > 0 ? (driftCount / sampleSize) * 100 : 0
  const isCompleteScan = sampleSize >= total
  const estimatedTotal = isCompleteScan ? driftCount : total > 0 ? Math.round((driftCount / Math.max(sampleSize, 1)) * total) : 0

  return {
    name: "Hash Drift (Stale Files)",
    status: pct > 10 ? "error" : pct > 3 ? "warn" : "ok",
    value: driftCount,
    total: sampleSize,
    percentage: Math.round((100 - pct) * 10) / 10,
    threshold: { warn: 3, error: 10 },
    description: isCompleteScan
      ? `${driftCount} of ${sampleSize} indexed files have changed on disk since indexing. EXACT: every indexed file was content-hashed, so this is the project's drift count and this status is a measurement, not an estimate.`
      : `${driftCount} of ${sampleSize} sampled files have changed on disk since indexing (estimated ${estimatedTotal} total). ESTIMATE: a deterministic unbiased sample of every indexed file — reproducible and independent of file ordering, but the rate and therefore this status carry sampling error. bb_health integrity=true runs this as a complete scan.`,
    remediation: driftCount > 0 ? "Run bb_health with refresh=true to reindex changed files." : undefined,
    sample: driftSamples.length > 0 ? driftSamples : undefined,
  }
}

async function checkMissingFiles(rawDb: any, projectId: ProjectID, diskScan: "sample" | "complete"): Promise<HealthCheck> {
  // M64.I1: the comment here said "test 100 random files" and the SQL was an
  // unordered `LIMIT 100` — a prefix, not a random draw — and the verdict was
  // then extrapolated over the whole project (x16.5 on this repo's index). Same
  // defect the main freshness path had, inside the integrity report, with a
  // comment that misdescribed the method. Now the same deterministic,
  // order-independent selection as every other sampled check here, and the
  // description names the method so a reader can tell an estimate from a count.
  const totalRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_file WHERE project_id = ?
  `).get(projectId) as any
  const total = totalRow?.count ?? 0

  const allFiles = rawDb.prepare(`
    SELECT id, path, relative_path FROM brain_file WHERE project_id = ?
  `).all(projectId) as any[]
  const files = (diskScan === "complete" ? selectSampleFiles(allFiles, Number.MAX_SAFE_INTEGER) : selectSampleFiles(allFiles, 100)) as any[]

  let missing = 0
  const missingSamples: string[] = []
  for (const f of files) {
    if (!fs.existsSync(f.path)) {
      missing++
      if (missingSamples.length < 5) missingSamples.push(f.path)
    }
  }

  const isCompleteScan = files.length >= total
  const estimatedMissing = isCompleteScan ? missing : total > 0 ? Math.round((missing / Math.min(files.length, total)) * total) : 0

  return {
    name: "Files Missing from Disk",
    status: missing > 10 ? "error" : missing > 2 ? "warn" : "ok",
    value: missing,
    total: files.length,
    percentage: files.length > 0 ? Math.round((1 - missing / files.length) * 1000) / 10 : 100,
    threshold: { warn: 2, error: 10 },
    description: isCompleteScan
      ? `${missing} of ${files.length} indexed files no longer exist on disk. EXACT: every indexed file was checked. Tools will fail when trying to read these.`
      : `${missing} of ${files.length} sampled files no longer exist on disk. Estimated ${estimatedMissing} total missing. ESTIMATE: a deterministic unbiased sample of every indexed file (reproducible; independent of file ordering). bb_health integrity=true runs this as a complete scan.`,
      remediation: missing > 0 ? "Run bb_health with refresh=true to remove deleted files from the index." : undefined,
    sample: missingSamples.length > 0 ? missingSamples : undefined,
  }
}

export async function checkEmbeddingCoverage(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  // Check if embedding table exists
  const hasTable = rawDb.prepare(`
    SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='brain_semantic_embedding'
  `).get() as any

  if (!hasTable?.count) {
    return {
      name: "Embedding Coverage",
      status: "warn",
      value: 0,
      total: 0,
      percentage: 0,
      threshold: { warn: 50, error: 20 },
      description: "Semantic embedding table does not exist. Semantic search is keyword-only.",
      // M64.I4: this said `bb2 brain --post`. There is no `bb2` binary and no
      // `brain` subcommand — the CLI registers tool/index/setup/show/doctor/
      // stats/status/projects/search/health/onboard/mcp/version, so the advice
      // sent a user to a command that cannot be typed. The real interface is
      // the bb_index tool's post mode, which re-runs the derived phases.
      remediation: "Generate embeddings with the bb_index tool: { path: \"<project path>\", mode: \"post\" } (CLI: bb index \"<project path>\").",
    }
  }

  const totalRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_symbol WHERE project_id = ?
  `).get(projectId) as any
  const total = totalRow?.count ?? 0

  const embedRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_semantic_embedding WHERE project_id = ?
  `).get(projectId) as any
  const embedCount = embedRow?.count ?? 0

  const pct = total > 0 ? (embedCount / total) * 100 : 0

  // Get model breakdown
  const models = rawDb.prepare(`
    SELECT embedding_model, COUNT(*) as count FROM brain_semantic_embedding
    WHERE project_id = ?
    GROUP BY embedding_model
  `).all(projectId) as any[]
  const modelDesc = models.map((m: any) => `${m.embedding_model}: ${m.count}`).join(", ")

  return {
    name: "Embedding Coverage",
    status: pct < 20 ? "error" : pct < 50 ? "warn" : "ok",
    value: embedCount,
    total,
    percentage: Math.round(pct * 10) / 10,
    threshold: { warn: 50, error: 20 },
    description: `${embedCount} of ${total} symbols have semantic embeddings (${modelDesc || "none"}). Semantic search quality depends on this coverage.`,
    remediation: pct < 50 ? "Generate embeddings with the bb_index tool: { path: \"<project path>\", mode: \"post\" } (CLI: bb index \"<project path>\"). Note this only embeds the kinds the embedder supports — see bb_health verbose `unembedded kinds` for what it will never cover." : undefined,
  }
}

async function checkSyntaxErrorFiles(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  const totalRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_file WHERE project_id = ?
  `).get(projectId) as any
  const total = totalRow?.count ?? 0

  const errorRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_file WHERE project_id = ? AND has_syntax_errors = 1
  `).get(projectId) as any
  const errorCount = errorRow?.count ?? 0

  let sample: string[] = []
  if (errorCount > 0) {
    const rows = rawDb.prepare(`
      SELECT relative_path, language FROM brain_file
      WHERE project_id = ? AND has_syntax_errors = 1
      LIMIT 5
    `).all(projectId) as any[]
    sample = rows.map((r: any) => `${r.relative_path} (${r.language})`)
  }

  return {
    name: "Syntax Error Files",
    status: errorCount > total * 0.1 ? "error" : errorCount > total * 0.02 ? "warn" : "ok",
    value: errorCount,
    total,
    percentage: total > 0 ? Math.round((1 - errorCount / total) * 1000) / 10 : 100,
    threshold: { warn: 2, error: 10 },
    description: `${errorCount} files have recorded syntax errors. Tools operating on these files may produce incorrect byte bounds and garbled ASTs.`,
    remediation: errorCount > 0 ? "These files were parsed with errors. If they are hand-written code (not generated), fix the syntax errors. Otherwise, tools should check has_syntax_errors before operating." : undefined,
    sample: sample.length > 0 ? sample : undefined,
  }
}

async function checkWalSize(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  try {
    // Read WAL size from filesystem — do NOT run PRAGMA wal_checkpoint
    // (it blocks for 10-30s on large databases, was removed from getStats for this reason)
    const pageCount = (rawDb.prepare("PRAGMA page_count").get() as any)?.page_count ?? 0
    const pageSize = (rawDb.prepare("PRAGMA page_size").get() as any)?.page_size ?? 4096
    const dbSizeBytes = pageCount * pageSize

    const { BrainDatabase: BDB } = await import("./database")
    const rawPath = BDB.getPath(projectId)
    const walPath = rawPath + "-wal"
    let walSizeBytes = 0
    try {
      walSizeBytes = fs.statSync(walPath).size
    } catch {
      walSizeBytes = 0
    }

    const walMB = Math.round(walSizeBytes / (1024 * 1024) * 10) / 10

    return {
      name: "WAL Size",
      status: walMB > 500 ? "error" : walMB > 100 ? "warn" : "ok",
      value: walSizeBytes,
      total: dbSizeBytes,
      percentage: dbSizeBytes > 0 ? Math.round((1 - walSizeBytes / (dbSizeBytes + walSizeBytes)) * 1000) / 10 : 100,
      threshold: { warn: 100, error: 500 },
      description: `WAL file is ${walMB} MB (DB is ${Math.round(dbSizeBytes / (1024 * 1024) * 10) / 10} MB). Large WAL files slow down read queries.`,
      remediation: walMB > 200 ? "WAL will auto-checkpoint. If this persists, restart the brain service." : undefined,
    }
  } catch {
    return {
      name: "WAL Size",
      status: "ok",
      value: 0,
      threshold: { warn: 100, error: 500 },
      description: "WAL size check skipped (unable to query).",
    }
  }
}

async function checkEmptyFiles(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  const row = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_file f
    WHERE f.project_id = ?
      AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.file_id = f.id AND s.project_id = f.project_id)
      AND f.language IS NOT NULL
      AND f.language != 'unknown'
  `).get(projectId) as any

  const emptyCount = row?.count ?? 0

  let sample: string[] = []
  if (emptyCount > 0) {
    const rows = rawDb.prepare(`
      SELECT f.relative_path, f.language FROM brain_file f
      WHERE f.project_id = ?
        AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.file_id = f.id AND s.project_id = f.project_id)
        AND f.language IS NOT NULL AND f.language != 'unknown'
      LIMIT 5
    `).all(projectId) as any[]
    sample = rows.map((r: any) => `${r.relative_path} (${r.language})`)
  }

  return {
    name: "Files with Zero Symbols",
    status: emptyCount > 1000 ? "error" : emptyCount > 100 ? "warn" : "ok",
    value: emptyCount,
    threshold: { warn: 100, error: 1000 },
    description: `${emptyCount} indexed files have zero extracted symbols. These may be empty files, config files, or files the parser couldn't understand.`,
    remediation: emptyCount > 500 ? "These are likely config, documentation, or generated files — generally expected. Investigate if code files are affected." : undefined,
    sample: sample.length > 0 ? sample : undefined,
  }
}

async function checkRelationshipRatio(rawDb: any, projectId: ProjectID): Promise<HealthCheck> {
  const symbolRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_symbol WHERE project_id = ?
  `).get(projectId) as any
  const totalSymbols = symbolRow?.count ?? 0

  const relRow = rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_relationship WHERE project_id = ?
  `).get(projectId) as any
  const totalRels = relRow?.count ?? 0

  const ratio = totalSymbols > 0 ? totalRels / totalSymbols : 0

  const status: HealthStatus =
    totalSymbols === 0 ? "ok" :
    ratio < 0.1 ? "error" :
    ratio < 0.5 ? "warn" : "ok"

  return {
    name: "Relationship Density",
    status,
    value: totalRels,
    total: totalSymbols,
    percentage: Math.round(ratio * 100) / 100,
    threshold: { warn: 0.5, error: 0.1 },
    description: `${ratio.toFixed(2)} relationships per symbol. Below 0.5 may indicate relationship extraction issues (some language analyzers may not produce relationships). Below 0.1 indicates a likely indexing failure.`,
    remediation: ratio < 0.3 ? "Check if the project's primary language has relationship extraction support. Some languages (CSS, JSON, YAML) naturally have low relationship density." : undefined,
  }
}

// ─── Fast Pre-Flight Check (for tool pre-flight) ───────────────────────────

/**
 * Lightweight pre-flight check for individual tool usage.
 * Only runs the 3 fastest checks (byte bounds for target file, syntax errors, orphan targets).
 * Returns a simple go/no-go with specific warnings.
 */
export async function preFlightCheck(
  projectId: ProjectID,
  context: { fileId?: string; symbolName?: string },
): Promise<{
  ok: boolean
  warnings: string[]
  fixes: string[]
}> {
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const warnings: string[] = []
  const fixes: string[] = []

  // Check 1: Does the target file have syntax errors?
  if (context.fileId) {
    const syntaxRow = rawDb.prepare(`
      SELECT has_syntax_errors FROM brain_file WHERE id = ? AND project_id = ?
    `).get(context.fileId, projectId) as any
    if (syntaxRow?.has_syntax_errors) {
      warnings.push("Target file has recorded syntax errors. Byte bounds may be incorrect.")
      fixes.push("Use bb_search mode=symbol to manually review the file. Avoid bb_edit on this file.")
    }
  }

  // Check 2: Does the target symbol have byte bounds?
  if (context.symbolName && context.fileId) {
    const boundsRow = rawDb.prepare(`
      SELECT byte_start, byte_end FROM brain_symbol
      WHERE file_id = ? AND name = ? AND project_id = ?
      LIMIT 1
    `).get(context.fileId, context.symbolName, projectId) as any
    if (boundsRow && (boundsRow.byte_start === null || boundsRow.byte_end === null)) {
      warnings.push(`Symbol "${context.symbolName}" has NULL byte bounds. Edits may be imprecise.`)
      fixes.push("Run bb_health with refresh=true and wait=true to reindex this file, or use line-based editing.")
    }
  }

  // Check 3: Global index emptiness
  const symbolCount = (rawDb.prepare(`
    SELECT COUNT(*) as count FROM brain_symbol WHERE project_id = ?
  `).get(projectId) as any)?.count ?? 0

  if (symbolCount < 100) {
    warnings.push("Brain index is nearly empty. Most tools will return no results.")
    fixes.push("Run bb_health with refresh=true to index the project first.")
  }

  return {
    ok: warnings.length === 0,
    warnings,
    fixes,
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatHealthReport(report: IndexHealthReport): string {
  const barLen = 20
  const filled = Math.round((report.overallHealth / 100) * barLen)
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled)

  let output = `INDEX HEALTH: ${report.overallHealth}%  [${bar}]\n`
  output += `Project: ${report.projectId}\n`
  output += `Time: ${new Date(report.timestamp).toISOString()}\n`
  output += `Status: ${report.summary.ok} OK / ${report.summary.warn} WARN / ${report.summary.error} ERROR\n\n`

  const icon = (s: HealthStatus) => s === "ok" ? "✅" : s === "warn" ? "⚠️" : "❌"

  for (const check of report.checks) {
    const pctStr = check.percentage !== undefined ? ` (${check.percentage}%)` : ""
    output += `${icon(check.status)} ${check.name}: ${check.value.toLocaleString()}${check.total ? ` / ${check.total.toLocaleString()}` : ""}${pctStr}\n`
    output += `   ${check.description}\n`
    if (check.remediation) {
      output += `   🔧 ${check.remediation}\n`
    }
    if (check.sample && check.sample.length > 0) {
      output += `   Sample: ${check.sample.slice(0, 3).join(", ")}\n`
    }
    output += "\n"
  }

  return output
}
