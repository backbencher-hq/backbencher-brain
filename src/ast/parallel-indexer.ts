// Parallel Indexer v4 - Batch Processing to Avoid Event Loop Blocking
// Scales gracefully and avoids 500ms setup overhead per file

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

import { cpus } from "os"
import * as path from "path"
import { fork, type ChildProcess } from "child_process"
import { realpathSync } from "fs"
import * as Log from "../tool/brain-log"
import {
  resolvePoolWorkerForkSafe,
  poolFailureLine,
  poolStartupTimeoutMs,
} from "./pool-diagnostics"
import type { ProjectID } from "../project/schema"
import { BrainDatabase } from "../brain/database"
import { isIndexArtifactName, isIndexArtifactNameStrict } from "./analysis-exclusions"
import { decideWatchdog, WATCHDOG_MIN_STALL_MS, WATCHDOG_TICK_MS } from "./watchdog-policy"
import { isTestFileCandidate } from "./test-classification"
import { createStoreDiagnostics } from "./store-diagnostics"
// M50.A2 (#764): dense-vector read accelerator (JSON stays the source of truth).
import { encodeVectorBlob, scanJsonVectorInto } from "../brain/semantic/vector-binary"
import { Bus } from "../bus"
import { BrainService } from "../brain/service"
import { readdir, stat, open } from "fs/promises"
import { computeAndStoreProjectHealth } from "./project-health"
import { CrossLanguageIntelligencePersister } from "./cross-language-intelligence-persister"
import { detectLanguageFromPath } from "./language-detection"
import { writeLiveStatus } from "./index-status"
import { acquireIndexLock, type IndexLockHandle } from "./index-lock"
import { resolveImportTargets } from "./import-resolution"
import { retargetCrossFileOverrides } from "./override-retarget"
import { retargetJuliaMethodTableBindings } from "./julia-binding-collapse"
import { claimOwnerCarryingTargets } from "./member-owner-resolution"
import { ASTEngine } from "./engine"

const log = Log.create({ service: "parallel-indexer" })

// ============================================================================
// PILLAR 3: LAYER-AWARE PAGERANK
// ============================================================================

export async function calculateGravityScores(
  projectId: ProjectID,
  // M40.A2: scoped mode — recompute gravity only for the given symbols.
  // Bounded incremental runs pass exactly the touched symbols (+ their direct
  // callers, whose in-degree PageRank boost changes). Each UPDATE below is
  // identical to the full pass except for the id-chunked scope, so scoped and
  // full runs can never diverge in formula.
  opts: { symbolIds?: string[] } = {},
) {
  const { BrainDatabase } = await import("../brain/database")
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const scopeIds = opts.symbolIds
  // M40.A2 guard: an EXPLICIT but empty scope is a no-op, never a full pass
  // (the bounded caller passes [] when nothing was touched).
  if (scopeIds != null && scopeIds.length === 0) return
  const CHUNK = 500
  const chunks: string[][] = scopeIds?.length
    ? Array.from({ length: Math.ceil(scopeIds.length / CHUNK) }, (_, i) => scopeIds.slice(i * CHUNK, (i + 1) * CHUNK))
    : []
  // In scoped mode each UPDATE runs per id-chunk with `AND id IN (...)`;
  // in full mode it runs once over the whole table (identical formula).
  const runScoped = (sql: string, params: any[] = []) => {
    if (!chunks.length) {
      rawDb.prepare(sql).run(...params)
      return
    }
    for (const chunk of chunks) {
      const placeholders = chunk.map(() => "?").join(",")
      rawDb.prepare(`${sql} AND brain_symbol.id IN (${placeholders})`).run(...params, ...chunk)
    }
  }

  // 1. Reset gravity scores to base complexity + visibility (fallback if needed)
  // (WHERE 1=1 gives scoped mode a valid anchor for its id filter)
  runScoped(`
     UPDATE brain_symbol
     SET gravity_score = (complexity * (CASE WHEN visibility = 'public' THEN 1.5 ELSE 1.0 END))
     WHERE 1=1
  `)

  // 2. PageRank increment (In-degree calculation)
  // Give highly-referenced symbols massive gravity boosts
  runScoped(`
     UPDATE brain_symbol
     SET gravity_score = gravity_score + (
        SELECT COUNT(*) * 5.0 
        FROM brain_relationship r 
        WHERE r.target_symbol_id = brain_symbol.id
     )
     WHERE EXISTS (
        SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id
     )
  `)

  // 3. Architectural Weighting (Layers)
  runScoped(`
     UPDATE brain_symbol
     SET gravity_score = gravity_score * 2.0
     WHERE layer = 'core'
  `)

  // 3b. Service/db weighting (same formula, scoped id-chunk)
  runScoped(`
     UPDATE brain_symbol
     SET gravity_score = gravity_score * 1.5
     WHERE layer = 'service' OR layer = 'db'
  `)

  // 4. Test intelligence weighting (Tests themselves are lower gravity, but tested code is higher)
  runScoped(`
     UPDATE brain_symbol
     SET gravity_score = gravity_score * 0.5
     WHERE layer = 'test'
  `)
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export const ParallelIndexerConfig = {
  // Concurrency tuning (leave some cores for the OS/DB)
  concurrency: Math.max(2, Math.min(cpus().length - 1, 12)),

  // Hard timeout per file in ms - worker gets KILLED if exceeded.
  // Env-configurable (BB_FILE_TIMEOUT_MS) so deterministic crash/timeout
  // fixtures can run without waiting 45s per file (M21.W1).
  fileTimeoutMs: Number(process.env.BB_FILE_TIMEOUT_MS || 45000),

  // Maximum file size to parse (larger files get basic extraction)
  maxFileSizeBytes: 1 * 1024 * 1024, // 1MB - skip huge YAML files that cause memory exhaustion

  // Max files per worker batch (lower = more responsive progress, higher = less IPC overhead)
  workerBatchSize: 10,

  // Max files to bulk insert into SQLite at once
  dbBatchSize: 100,

  // How often to emit progress events via the Bus (ms)
  progressUpdateMs: 100,

  // File extensions to index
  extensions: new Set([
    // === WEB TECHNOLOGIES ===
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".json",
    ".yaml",
    ".yml",
    ".svelte",
    ".vue",
    ".graphql",
    ".gql",
    // === SYSTEMS PROGRAMMING ===
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cc",
    ".cxx",
    ".rs",
    ".go",
    ".zig",
    // === ENTERPRISE & JVM ===
    ".java",
    ".kt",
    ".kts",
    ".scala",
    ".sc",
    ".groovy",
    // `.gsp` was listed here until the M60 #913 ruling (2026-09-24): an HTML template
    // is not Groovy source, and the registry no longer routes it. Note this Set is not
    // read anywhere — what admits a file is `hasValidExtension` → detectLanguageFromPath
    // below — so removing the entry is consistency, not control: a list nothing consults
    // cannot be the thing that admits a file, and it must not disagree with the registry
    // that does. script/m60/routing-outlier-census.ts gates the registry side.
    // === SCRIPTING & DYNAMIC ===
    ".py",
    ".pyw",
    ".rb",
    ".php",
    ".lua",
    ".pl",
    ".pm",
    ".t",
    ".perl",
    ".ex",
    ".exs",
    // === FUNCTIONAL PROGRAMMING ===
    ".hs",
    ".lhs",
    ".clj",
    ".cljs",
    ".cljc",
    ".edn",
    ".icl",
    ".dcl",
    // === MOBILE & MODERN ===
    ".swift",
    ".dart",
    // === MICROSOFT ECOSYSTEM ===
    ".cs",
    ".csx",
    ".fs",
    ".fsi",
    ".fsx",
    // === DATA SCIENCE & STATS ===
    ".r",
    ".R",
    ".sql",
    // === SHELL & SYSTEM ===
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".psm1",
    ".psd1",
    // === INFRASTRUCTURE AS CODE ===
    ".tf",
    ".tfvars",
    ".tofu",
    ".hcl",
    // === ERLANG ===
    ".erl",
    ".hrl",
    // === OBJECTIVE-C ===
    ".m",
    ".mm",
    // === CONFIG, DOCS & ASSETS (engine-supported) ===
    ".toml",
    ".xml",
    ".xsd",
    ".dtd",
    ".md",
    ".markdown",
    ".svelte",
    ".nim",
    ".vb",
    ".vbs",
    ".proto",
  ]),

  // Directories/files to skip entirely
  skipPatterns: [
    // === GENERATED & DEPENDENCY DIRECTORIES ===
    /\/node_modules\//,
    // NOT here either: /\/vendor\// . `vendor` is a build-output name in
    // Composer, where it holds third-party code — but it is a FIRST-PARTY
    // source name in Go (a vendored tree the project then edits) and in
    // TypeScript projects that keep curated first-party code under
    // src/vendor/. Measured on this corpus: src/vendor/format.ts is invisible
    // to the index, so the import that reaches it is reported as an unresolved
    // specifier and the file has no symbols, no complexity and no freshness —
    // for a file that is compiled into the product. node_modules is already
    // skipped by name, and that is where a dependency tree actually lives.
    /\/bower_components\//,
    /\/__pycache__\//,
    /\/\.venv\//,
    /\/venv\//,
    /\/env\//,
    /\/\.env/,
    /\/dist\//,
    /\/build\//,
    /\/out\//,
    /\/target\//,
    /\/\.next\//,
    /\/\.nuxt\//,
    /\/\.svelte-kit\//,
    /\/coverage\//,
    /\/\.nyc_output\//,
    /\/\.cache\//,
    /\/\.turbo\//,
    /\/\.git\//,
    /\/\.svn\//,
    /\/\.hg\//,
    /\/\.gradle\//,
    /\/\.idea\//,
    /\/\.vs\//,
    /\/Pods\//,
    /\/\.dart_tool\//,
    /\/\.pub-cache\//,
    /\/_build\//,
    /\/deps\//,
    /\/\.stack-work\//,
    /\/\.tox\//,
    /\/\.pytest_cache\//,
    /\/\.terraform\//,
    /\/bin\//,
    /\/obj\//,
    /\/storybook-static\//,
    /\/tree-sitter-clean\//,
    /\/\.bb_backups\//,
    // === MOBILE BUILD DIRECTORIES ===
    /\/android\/build\//,
    /\/ios\/build\//,
    /\/\.expo\//,
    /\/platforms\//,
    // === GENERATED FILES (case-insensitive — .NET uses PascalCase "Generated") ===
    /.*\.(generated|Generated|gen|Gen)\./i,
    /.*\.g\.(cs|ts|js|fs)$/i,
    /\/__generated__\//i,
    /\/generated\//i,
    /\/gen\//,
    // === MINIFIED & GENERATED FILES ===
    /.*\.min\./,
    /.*-min\./,
    /.*\.bundle\./,
    /.*\.chunk\./,
    /.*\.map$/,
    /.*\.d\.ts$/,
    // === LOCK FILES ===
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /bun\.lockb$/,
    // === LARGE AUTO-GENERATED SCHEMAS ===
    /openapi\.json$/,
    /swagger\.json$/,
    /schema\.json$/,
    // === AZURE & DATA LAKE ===
    /.*Az\..*\.json$/,
    /.*DataLake.*\.json$/,
    /.*PowerBI.*\.json$/,
    /.*Sftp.*\.json$/,
    /\/gen\/.*\.(ts|js)$/,
    // === PERFORMANCE & WEB ASSET DIRECTORIES ===
    // `/perf/` used to be here and in the compiled-mode list. Removed: it hid real
    // source in this repository (measured: 17 tracked files with a valid extension,
    // including the worker-pool gate), and a benchmark tree is a handful of small
    // files — hiding it is not worth hiding source by mistake. Projects that keep
    // generated benchmark data there can exclude it in .bbignore, which now also
    // works in reverse (`!path`) because the built-in rules became overridable.
    /\/Microbenchmarks\//,
    /\/wwwroot\//,
    /\/testassets\//,
    /\/benchmarkapps\//,
    // NOT here: /\/test\// . A directory named `test` is where Go, Python,
    // Node, Java and most JVM projects keep their test SUITE. Skipping it drops
    // those files before they are parsed, so is_test_file can never be set for
    // them, and testMapping/testGaps/testQuality then report every production
    // symbol untested with the "no-test-evidence-edges" note attached — which
    // reads as "we looked and found none" rather than "we never saw the tests".
    // Differential measurement on a corpus holding one file of each shape:
    //
    //   spec/format.spec.ts    indexed, is_test_file=1
    //   tests/engine.test.ts   indexed, is_test_file=1
    //   test/should-be-…       ABSENT from the index
    //
    // Same language, same naming infix, only the directory name differs. The
    // read paths need the files; deciding what counts as a test is
    // test-classification.ts's job and it already gates on file type.
  ],
}

// ============================================================================
// TYPES
// ============================================================================

export interface ParallelIndexingStats {
  totalFiles: number
  processedFiles: number
  successFiles: number
  timeoutFiles: number
  errorFiles: number
  skippedFiles: number
  symbolsExtracted: number
  relationshipsFound: number
  importsFound: number
  startTime: number
  endTime?: number
  filesPerSecond?: number
  errors: Array<{ file: string; error: string }>
  /**
   * M21.I3: structured error records (phase/language/retry/fallback) derived
   * from this run, ready for durable persistence. Populated alongside errors.
   */
  structuredErrors?: BrainDatabase.IndexingErrorRecord[]
  /** M21.I1: phase-level timing/accounting telemetry for indexing runs. */
  phases?: IndexPhaseTimings
  /** M22.V1: live fields surfaced to the onProgress callback for the CLI. */
  currentFile?: string
  /** M22.V1: overall progress 0..98 during parsing (100 reached at completion). */
  progress?: number
  /** M22.V1: elapsed wall-clock in ms since the run started. */
  elapsedSeconds?: number
  /** M22.V1: execution mode of the parse phase (worker-pool | in-process). */
  phase?: string
  /**
   * M21.R3: true when the run ended because options.signal was aborted.
   */
  cancelled?: boolean
  /**
   * M40.A2: bounded-pass telemetry for incremental runs — what the scoped
   * derived-data pass actually did. Absent on full runs and deferred runs.
   */
  m40Bounded?: {
    repairedInEdges: number
    purgedDeletedFiles: number
    touchedSymbols: number
  }
  /**
   * M22.V5: honest per-bucket run summary. Every input file lands in exactly
   * one bucket so a run that "succeeds" but silently loses files is visible.
   * symbolLoss = parsed successfully but yielded 0 symbols (e.g. ENGINE_EMPTY
   * bypass on SCSS) — the silent-loss class the probe exposed.
   */
  summary?: {
    totalCandidates: number
    newlyParsed: number
    unchanged: number
    skipped: number
    symbolLoss: number
    errors: number
    timeouts: number
    /** M21.R3: files dropped because the run was cancelled (not errors). */
    cancelled: number
    /**
     * M40.A2: what this run did about derived data (relationships/enrichment/
     * gravity/taints/health). "full" = complete pass; "bounded" = scoped pass
     * over touched symbols/edges; "deferred" = skipped by request or cancel;
     * "skipped-unchanged" = nothing was parsed, so no derived pass ran.
     * Absent on legacy persisted runs.
     *
     * `derivedPass` says WHICH pass ran. It never said whether the derived data
     * ended up CONSISTENT, and this comment used to claim it did — "untouched and
     * still consistent" — which is false in exactly the case a user meets it.
     * Measured: cancel a 60-file index mid-run, then `bb index --resume`. The
     * cancel leaves 16 relationships with `target_symbol_id IS NULL` (the
     * resolution phase was interrupted); the resume parses nothing, so its pass
     * is "skipped-unchanged"; the relationship COUNT recovers to the clean
     * index's 180, so every count-based check reads healthy — and those 16 edges
     * are still unattached. Only `bb index --post` resolves them (16 -> 0).
     * So `derivedPass` is not a consistency statement, and the count below is.
     */
    derivedPass?: "full" | "bounded" | "deferred" | "skipped-unchanged" | "partial"
    /**
     * Store batches that rolled back during this run, and the files they carried.
     *
     * A rollback means those files are NOT in the index. Before this field the only
     * trace was a stderr line, and a run that lost batches still reported success and
     * persisted `status: "complete"` — measured: injecting a single batch failure made
     * the CLI print `✓ indexed 12 files` with no indication that anything was missing.
     */
    storeFailures?: number
    storeFailureFiles?: number
    /**
     * Files this run discovered that are absent from `brain_file` AFTER the recovery
     * pass. This is the state of the index, not a guess about it: the pass above
     * re-processes what a rollback cost, and whatever it could not save is counted
     * here. Non-zero means the index is incomplete, and every consumer that reports
     * health, counts or "complete" has to be able to see that.
     */
    missingAfterRecovery?: number
    /** Relationships this project holds whose target could not be attached to a
     *  stored symbol: `target_symbol_id IS NULL AND target_external IS NOT NULL`.
     *  The row is present and counted, but it is not an edge — traversal reads it
     *  as absent, so it under-reports. Measured 0 after a clean full index, 16
     *  after a cancel, and 0 again after `runPostProcessing`. This is the
     *  measurement `derivedPass` is not, and it is what decides whether the
     *  remediation is `bb index --post`. */
    unresolvedRelationships?: number
    /** What happened to embeddings during this run.
     *
     *  Embeddings are produced AFTER parsing, in the background, by a drainer
     *  that can fail long after the parse phase reported success. Those outcomes
     *  were accumulated in `backgroundEmbedMetrics` and read NOWHERE — not by the
     *  summary, not by the CLI — so a run could lose every vector and still print
     *  "✓ indexed N files".
     *
     *  `embedded` counts vectors actually stored. `failed` includes vectors the
     *  provider returned but which were unusable (empty, non-array, or holding a
     *  non-finite component); those are a different fault from a short result and
     *  are worth separating when triaging. */
    embedOutcome?: {
      queued: number
      embedded: number
      failed: number
      skipped: number
      dropped: number
      /** Vectors that arrived malformed and were discarded at the write boundary. */
      invalid: number
    }
    /** Distinct embedding models present in the index after this run.
     *
     *  More than one means the index is MIXED: when the provider dies mid-run
     *  some chunks are written under the API model and the rest under the local
     *  one. That is measured, not hypothetical — 100 rows `mock-1536d`/1536
     *  alongside 160 rows `local-word-vectors-v3`/50 in a single index.
     *
     *  It matters because `bb_ask` reads the index under ONE model label, so the
     *  other model's vectors become invisible with nothing on screen saying so.
     *  Reported rather than prevented: each vector is valid for its own model,
     *  so per-vector validation cannot stop this. */
    embedModels?: Array<{ model: string; dimension: number; count: number }>
    /** Vector-integrity census for this project.
     *
     *  Exists because a corrupt vector is invisible in every other number:
     *  `vector_dimension` is written as `vec.length`, so a bad vector records a
     *  dimension that describes itself and the row looks internally consistent.
     *  Nothing re-derives the true length at read time, so the row surfaces much
     *  later as a silently missing search result.
     *
     *  `dimensions` are OBSERVED lengths rather than the declared
     *  `vector_dimension`, deliberately: reading back the declared value would
     *  report the corrupt row as healthy, which is the one thing this census
     *  exists to prevent. A model whose observed lengths disagree with each
     *  other is the signal.
     *
     *  Contract pinned by script/a3-relationship-enrichment/verify-embedding-integrity.ts. */
    embeddingIntegrity?: {
      /** Rows in brain_semantic_embedding for this project. */
      total: number
      /** One entry per DISTINCT embedding_model. */
      models: Array<{ model: string; rows: number; dimensions: number[] }>
      /** More than one model — `bb_ask` reads the index under a single label. */
      mixed: boolean
      /** Rows whose OBSERVED length disagrees with their declared vector_dimension. */
      dimensionMismatches: number
      /** Rows whose vector does not scan to finite numbers. */
      malformedVectors: number
      /** mismatches + malformed. Coverage must EXCLUDE these, not count them. */
      unusableEmbeddings: number
      /** Vectors actually inspected. Below `total` when the scan was bounded. */
      scanned?: number
      /** True when the bounded scan did not cover every row, so the counts
       *  above describe a SAMPLE. Reported rather than implied: a partial
       *  census presented as complete is the same dishonesty as an uncounted
       *  corrupt row. */
      truncated?: boolean
    }
    /** How the files were parsed: `worker-pool` or `in-process`.
     *
     *  When the pool's fork test fails the run degrades to in-process parsing and
     *  indexes everything correctly — measured by SIGKILLing workers mid-run: 81
     *  of 81 files indexed, no orphan symbols, no dangling relationship targets,
     *  and the run returns normally rather than throwing. That is the right
     *  behaviour and it is worth having.
     *
     *  But it is roughly an order of magnitude slower, and `phases.mode` already
     *  recorded it while nothing the caller reads carried it: the measured run
     *  took 72 s against a much faster pool-backed one, and its summary read
     *  `workerCount: 0, retries: 0, errors: 0, timeouts: 0` — every number
     *  pristine. A caller cannot tell a healthy parallel run from a serial one
     *  that lost its pool, which is the same shape as derivedPass/consistency:
     *  a real degradation with no declared measurement. */
    parseMode?: "worker-pool" | "in-process"
  }
}

/**
 * M21.I1 phase telemetry. Every duration is wall-clock milliseconds measured
 * inside the index run; boundaries are documented so a reported completion
 * duration can be reconciled with the phases it actually covers.
 *
 * Phase boundaries (all wall-clock, measured around the real code paths):
 *  - discoveryMs: discoverAndFilterFiles (walk + ignore rules + skip-unchanged)
 *  - workerStartupMs: the pool fork readiness probe (60s worst case)
 *  - parseMs: time inside processWithWorkerPool/processInProcess (per-file parse)
 *  - dbFlushMs: accumulated storeResults wall time (batches flushed inside the pool)
 *  - finalAccountingMs: outcome aggregation + getIndexingStats + status update
 *  - postProcessingMs: resolveRelationships/enrich/gravity/taint/health, only when
 *    a full (non-incremental, non-skipPostProcessing) run executes it
 *
 * The reported completion duration (endTime - startTime) covers discovery,
 * worker startup, parse, db flush, and final accounting. Post-processing is a
 * separate phase and is NOT included in the reported completion duration; it is
 * reported separately so the two never blur together.
 */
export interface IndexPhaseTimings {
  discoveryMs: number
  workerStartupMs: number
  parseMs: number
  dbFlushMs: number
  finalAccountingMs: number
  postProcessingMs?: number
  mode: "worker-pool" | "in-process"
  /** Number of pool workers actually spawned (0 for in-process mode). */
  workerCount: number
  /** Files handed to the parse phase (after discovery filtering). */
  parsedFiles: number
  /** Configured worker batch size used for pool dispatch. */
  workerBatchSize: number
  /** Configured DB batch size used for storeResults. */
  dbBatchSize: number
  /** Retries observed in the worker pool (0 for in-process mode). */
  retries: number
  /**
   * M21.W1: worker fork/startup failures — distinct from per-file parser
   * failures. A worker that never signals ready (broken runtime, hung engine
   * boot) increments this instead of being mislabeled as a parse error.
   */
  workerStartupFailures: number
  /**
   * M21.W1: poison pills — batches dropped because a worker died before
   * reporting file_start. Bounded by the per-file retry cap; visible in stats.
   */
  poisonFiles: number
  /** True when discovery found nothing to parse (no-op run, no parser work). */
  noop: boolean
  /**
   * M21.I2: true wall time from index start to the moment the function
   * returns, INCLUDING post-processing. This differs from the reported
   * completion duration (endTime - startTime), which is recorded before
   * post-processing and therefore excludes it — the two are never confused.
   */
  totalWallMs?: number
  /**
   * M21.I2: per-phase post-processing timings and outcomes. Present only when
   * a full (non-incremental, non-skipPostProcessing) run executes the heavy
   * post-processing block. A phase whose execution failed records outcome
   * "failed" and stays visible; a skipped phase records "skipped".
   */
  postProcessingPhases?: PostProcessingPhaseTiming[]
  /**
   * M21.W3: per-language outcome counts for the files that reached the parse
   * phase, keyed by detected language. "fallback" counts files whose parse
   * used regex/structural extraction instead of the full AST grammar
   * (FileResult.fallback === true) — never presented as full AST parsing.
   */
  byLanguage?: Record<string, { files: number; success: number; error: number; timeout: number; fallback: number }>
}

/** M21.I2: one measured post-processing phase with its outcome. */
export interface PostProcessingPhaseTiming {
  name: "relationships" | "enrichment" | "gravity" | "taint" | "health" | "integrity" | "vectorBlobs" | "analyze"
  ms: number
  outcome: "ok" | "failed" | "skipped"
}

export interface FileResult {
  filePath: string
  success: boolean
  timeout?: boolean
  error?: string
  symbols?: any[]
  relationships?: any[]
  imports?: any[]
  language?: string
  framework?: string
  fileHash?: string
  sizeBytes?: number
  lastModified?: number
}

// ============================================================================
// FILE DISCOVERY & INCREMENTAL FILTERING
// ============================================================================

function shouldSkip(filePath: string): boolean {
  return ParallelIndexerConfig.skipPatterns.some((p) => p.test(filePath))
}

const cliSkipPatterns: RegExp[] = [
  /\/node_modules\//, /\/dist\//, /\/build\//, /\/\.git\//,
  /\/storybook-static\//, /\/\.turbo\//, /\/\.next\//,
  /\/coverage\//, /\/__pycache__\//, /\/\.cache\//,
  /.*\.min\./, /.*-min\./, /.*\.bundle\./, /.*\.chunk\./,
  /snapshot\.json$/, /openapi\.json$/, /package-lock\.json$/,
  /yarn\.lock$/, /bun\.lockb$/,
]

export function shouldSkipCli(filePath: string): boolean {
  return cliSkipPatterns.some((p) => p.test(filePath))
}

/**
 * The CLI skip list, exported so the fingerprint walk can DERIVE its own list from
 * the same patterns instead of keeping a hand-maintained copy.
 *
 * The copy drifted by 21 directory names, which made `computeCheckoutFingerprint`
 * and `computeDbFingerprint` disagree on an unchanged tree — every index then
 * looked permanently stale, and the "did anything change" signal meant nothing.
 * Two copies of a skip list cannot be kept in agreement by review; they have to
 * have only one source.
 *
 * Exported as a copy of the array reference so a caller cannot mutate ours.
 */
export function parallelIndexerCliSkipPatterns(): RegExp[] {
  return cliSkipPatterns.slice()
}

export function hasValidExtension(filePath: string): boolean {
  return detectLanguageFromPath(filePath) !== null
}

/**
 * M14 #277 — admit an EXTENSIONLESS file whose `#!` line names a shell.
 *
 * `hasValidExtension` above is deliberately PURE: it answers from the path
 * alone, so the change-detection paths that call it (an explicit file list, a
 * rename, a cached mtime) never touch the disk. This helper is the one place
 * that is allowed to, and it is called only from the directory walk.
 *
 * The read is bounded twice over — an extension check first, so only
 * extensionless candidates are opened at all, and 256 bytes, because a `#!`
 * line is short by definition. Measured cost on the five bash corpora used for
 * the routing census: 385 admitted out of 2,582 extensionless files examined,
 * i.e. 2,582 bounded reads of at most 256 bytes to gain 385 files at a 97.7%
 * clean-parse rate.
 *
 * A recognised extension short-circuits before any read, so this can only ever
 * ADD files the router previously returned null for. It cannot re-route a file
 * another lane already owns.
 */
export async function admitsShellShebang(filePath: string): Promise<boolean> {
  const base = filePath.replace(/\\/g, "/").slice(filePath.replace(/\\/g, "/").lastIndexOf("/") + 1)
  if (base.includes(".")) return false
  if (detectLanguageFromPath(filePath) !== null) return false
  let head: string
  try {
    const fh = await open(filePath, "r")
    try {
      const buf = Buffer.alloc(256)
      const { bytesRead } = await fh.read(buf, 0, 256, 0)
      head = buf.subarray(0, bytesRead).toString("utf8")
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
  return detectLanguageFromPath(filePath, head) !== null
}

/**
 * The symbol body as stored in `brain_symbol.source_text`, bounded.
 *
 * This column exists so content search can reach a word that appears only
 * inside a function — measured unreachable for 27% of body-only words on rake
 * and 38% on ripgrep, because `searchContent` selected only
 * name/qualified_name/docstring and the body was indexed solely as a
 * 50-dimensional hash that cannot be queried by word.
 *
 * Bounded for two measured reasons:
 *  - size. A 25 599-character body was measured on rake (a whole class body).
 *    `searchContentClassic` loads every symbol row for a project, so an
 *    unbounded body would make content search memory scale with total source
 *    rather than with the query.
 *  - diminishing returns past the cap. The median measured body is 28 tokens
 *    and p90 is 69, so a few hundred lines is generous: a word a developer
 *    remembers is overwhelmingly likely to be near the top of the symbol.
 *
 * Returns null when there is no body, so the column reads as "this symbol has
 * no body to search" rather than as an empty string that matches everything.
 */
const MAX_BODY_SOURCE_CHARS = 4000
const MAX_BODY_SOURCE_LINES = 200

function boundSourceText(snippet: string | undefined | null, startLine: number, endLine: number): string | null {
  if (!snippet) return null
  let text = String(snippet)
  // The analyzer's snippet is occasionally the whole file when line information
  // is missing. Trust the line range when we have one.
  if (endLine > startLine && startLine > 0) {
    const lines = text.split("\n")
    if (lines.length > endLine - startLine + 1) {
      text = lines.slice(0, endLine - startLine + 1).join("\n")
    }
  }
  const lines = text.split("\n")
  if (lines.length > MAX_BODY_SOURCE_LINES) text = lines.slice(0, MAX_BODY_SOURCE_LINES).join("\n")
  if (text.length > MAX_BODY_SOURCE_CHARS) text = text.slice(0, MAX_BODY_SOURCE_CHARS)
  return text.length > 0 ? text : null
}

/**
 * Tokenize code snippet + name for TF-IDF semantic embedding.
 * Splits camelCase, PascalCase, snake_case, kebab-case identifiers
 * and returns token-weight pairs for similarity matching.
 */
function tokenizeCodeForEmbedding(snippet: string, name: string): { token: string; weight: number }[] {
  const tokens = name.split(/(?=[A-Z])|_|-|\.|\s+/)
    .filter(t => t.length > 1)
    .map(t => t.toLowerCase())
  // Add tokens from snippet (first 500 chars for performance)
  const snippetTokens = snippet.slice(0, 500)
    .split(/[^a-zA-Z0-9_]+/)
    .filter(t => t.length > 1 && t.length < 40)
    .map(t => t.toLowerCase())
  tokens.push(...snippetTokens)
  // Count frequencies
  const freq = new Map<string, number>()
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
  // Return weighted tokens
  const total = tokens.length || 1
  return [...freq.entries()]
    .filter(([, c]) => c > 1) // At least 2 occurrences for signal
    .slice(0, 32) // Cap at 32 tokens
    .map(([token, count]) => ({ token, weight: count / total }))
}

/**
 * M64.C: the files this project WOULD index, under the indexer's own rules.
 *
 * Exported for bb_health, which needs to answer "is my new file in the index?"
 * and cannot answer it from the index alone: an absent file is indistinguishable
 * from an unindexed one without asking the indexer what it considers a file.
 *
 * Read-only by construction. It performs no database write, does not open the
 * project database at all, and the `eligible-only` mode suppresses the stale-file
 * cleanup that the indexing path performs — a health read must not delete index
 * rows to answer a question.
 *
 * The rules are the indexer's, not a copy: .gitignore, .bbignore, the skip
 * directories, the compiled-mode path filter, nested `.git` boundaries, the
 * depth cap, the extension and shell-shebang gates, and the >5MB size skip. A
 * second implementation would report gitignored files, `node_modules` and
 * binaries as unindexed, and would drift the first time a rule was added here.
 *
 * Cost is the same as one index run's discovery phase — a stat per eligible
 * file and no parsing — so callers should treat it as opt-in rather than part of
 * a default health call.
 */
export async function discoverIndexableFiles(
  projectPath: string,
  excludePatterns?: string[],
): Promise<string[]> {
  const throwaway = {
    totalFiles: 0, processedFiles: 0, skippedFiles: 0, failedFiles: 0,
    totalSymbols: 0, totalRelationships: 0, workerBatchSize: 0, dbBatchSize: 0,
    retries: 0, noop: false,
  } as unknown as ParallelIndexingStats
  return discoverAndFilterFiles("" as ProjectID, projectPath, throwaway, undefined, excludePatterns, "eligible-only")
}

async function discoverAndFilterFiles(
  projectId: ProjectID,
  projectPath: string,
  stats: ParallelIndexingStats,
  filesOverride?: string[],
  excludePatterns?: string[],
  /**
   * M64.C: "eligible-only" answers a different question from "changed", using
   * the SAME rules.
   *
   * "index" (default, unchanged) returns the files that need re-parsing: the
   * eligible set minus whatever the mtime+size check calls untouched. That is
   * the right answer for an index run and the wrong one for a health question.
   *
   * "eligible-only" returns every file the indexer WOULD write, changed or not.
   * bb_health needs that set to answer "is my new file in the index?", and there
   * must be exactly ONE implementation of "what counts as an indexable file" —
   * this one, which knows .gitignore, .bbignore, the skip directories, the
   * compiled-mode path filter, nested .git boundaries, the depth cap, the
   * extension and shebang gates, and the size tiers. A second copy of those rules
   * inside the health provider would report gitignored files, node_modules and
   * .pngs as unindexed, and would begin lying the moment anyone added a rule
   * here.
   *
   * It is an early branch, not a move: not one line of the walk changes, so the
   * indexer's own path is unchanged by construction.
   */
  mode: "index" | "eligible-only" = "index",
): Promise<string[]> {
  const files: string[] = []
  const eligibleOnly = mode === "eligible-only"
  const startTime = Date.now()
  const { readFile, stat: statFile } = await import("fs/promises")
  const { createHash } = await import("crypto")
  const ignore = await import("ignore").then((m) => m.default)
  const { existsSync } = await import("fs")

  // =========================================================================
  // .bbignore SUPPORT — User-controlled indexing exclusions (like .gitignore)
  // =========================================================================
  const bbignorePath = path.join(projectPath, ".bbignore")
  let bbignoreRules: string[] = []
  if (existsSync(bbignorePath)) {
    try {
      const bbignoreContent = await readFile(bbignorePath, "utf8")
      bbignoreRules = bbignoreContent
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line && !line.startsWith("#"))
      log.info("loaded .bbignore rules", { ruleCount: bbignoreRules.length })
    } catch {
      // Ignore read errors
    }
  }

  // Fetch existing stats for incremental checking.
  // M64.C: an eligible-only run never consults them, so it does not open the
  // project database at all — a health read must not create or migrate one.
  const rawDb = eligibleOnly ? null : await BrainDatabase.getRawInstance(projectId)
  let existingRecords: { path: string; last_modified: number; size_bytes: number }[] = []

  if (!rawDb) {
    // M64.C: nothing below needs the index, and `rawDb` is deliberately null
    // here. The guard has to be a branch rather than a `rawDb &&` on each use:
    // the first version assigned null and then dereferenced it two lines later,
    // so the whole walk threw and bb_health reported UNKNOWN_SCAN_FAILED on
    // every call.
    //
    // ON `!rawDb` AND NOT ON `eligibleOnly`, which is what this used to test.
    // `rawDb` is null IFF `eligibleOnly`, so the two guards accept exactly the
    // same runs — but only one of them lets the type system know. Narrowing a
    // `const` union by a DIFFERENT variable is not something TypeScript tracks,
    // so every `rawDb.` below stayed "possibly null" and the seven uses that
    // follow needed suppression to compile. Testing the value that is actually
    // dereferenced is both correct and narrower: it holds if a future
    // `getRawInstance` can return null for any other reason.
  } else if (filesOverride && filesOverride.length > 0) {
    // Only fetch stats for the specific files being overridden
    const placeholders = filesOverride.map(() => "?").join(",")
    existingRecords = rawDb
      .prepare(
        `SELECT path, last_modified, size_bytes FROM brain_file WHERE project_id = ? AND path IN (${placeholders})`,
      )
      .all(projectId, ...filesOverride) as { path: string; last_modified: number; size_bytes: number }[]
  } else {
    // Fetch all for full project index
    existingRecords = rawDb
      .prepare(`SELECT path, last_modified, size_bytes FROM brain_file WHERE project_id = ?`)
      .all(projectId) as { path: string; last_modified: number; size_bytes: number }[]
  }

  const existingStats = new Map(existingRecords.map((f) => [f.path, { mtime: f.last_modified, size: f.size_bytes }]))
  const foundFiles = new Set<string>()

  // =========================================================================
  // SIZE-TIERED FILE HANDLING
  // 1MB = full AST indexing, 1-5MB = structural only, >5MB = skip entirely
  // =========================================================================
  const FULL_AST_LIMIT = 1 * 1024 * 1024 // 1 MB
  const STRUCTURAL_LIMIT = 5 * 1024 * 1024 // 5 MB
  const structuralExtensions = new Set([".json", ".yaml", ".yml", ".toml", ".xml", ".xsd", ".dtd", ".md", ".proto"])

  async function processFile(fullPath: string) {
    try {
      const fileStat = await statFile(fullPath)
      foundFiles.add(fullPath)

      // SIZE TIER 3: Skip files over 5MB entirely
      if (fileStat.size > STRUCTURAL_LIMIT) {
        log.debug("skipping file over 5MB", { filePath: fullPath, sizeBytes: fileStat.size })
        stats.skippedFiles++
        return
      }

      // SIZE TIER 2: Structural-only for data files between 1-5MB
      if (fileStat.size > FULL_AST_LIMIT && structuralExtensions.has(path.extname(fullPath).toLowerCase())) {
        // These files are too large for full AST but we still index them structurally
        // The pool worker will handle this via fallback extraction
      }

      // SIZE TIER 2b: Large source files (.js, .ts) over 1MB also get structural extraction
      // Full AST parsing on files >1MB causes OOM crashes and timeouts
      const largeSourceExtensions = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"])
      if (fileStat.size > FULL_AST_LIMIT && largeSourceExtensions.has(path.extname(fullPath).toLowerCase())) {
        // Send to fallback extraction which handles large files gracefully
      }

      // Incremental check: skip unchanged files.
      // M64.C: in eligible-only mode the caller wants the whole eligible set —
      // "would the indexer write this file?" — and not "does it need
      // re-parsing?", so the mtime+size shortcut must not narrow the answer.
      if (eligibleOnly) {
        files.push(fullPath)
        return
      }
      const existing = existingStats.get(fullPath)
      const mtimeMs = Math.floor(fileStat.mtimeMs)

      if (existing && Math.floor(existing.mtime) === mtimeMs && existing.size === fileStat.size) {
        stats.skippedFiles++
      } else {
        files.push(fullPath)
      }
    } catch {
      // Skip on error
    }
  }

  if (filesOverride) {
    for (const f of filesOverride) {
      await processFile(f)
    }
  } else {
    const walk = async (dir: string, ig: ReturnType<typeof ignore>, depth = 0, forceInclude = false) => {
      if (depth > 50) return
      try {
        const entries = await readdir(dir, { withFileTypes: true })

        // Stop if we find a nested project boundary in a subdirectory.
        //
        // `.git` is a DIRECTORY in a normal checkout but a FILE in a submodule and in a
        // linked worktree. Testing only for the directory meant every submodule and every
        // worktree was walked as if it were first-party source; the file form is what git
        // actually writes in both cases.
        if (
          dir !== projectPath &&
          entries.some((e) => (e.isDirectory() || e.isFile()) && e.name === ".git")
        ) {
          return
        }

        // Parse local .gitignore if exists
        let localIg = ig
        const gitignoreEntry = entries.find((e) => e.isFile() && e.name === ".gitignore")
        if (gitignoreEntry) {
          try {
            const gitignoreContent = await readFile(path.join(dir, ".gitignore"), "utf8")
            localIg = ignore({ ignorecase: false }).add(ig).add(gitignoreContent)
          } catch {
            // Ignore read errors
          }
        }

        // Parse local .bbignore if exists (overrides .gitignore — higher priority)
        const bbignoreEntry = entries.find((e) => e.isFile() && e.name === ".bbignore")
        if (bbignoreEntry) {
          try {
            const bbignoreContent = await readFile(path.join(dir, ".bbignore"), "utf8")
            localIg = localIg.add(bbignoreContent)
          } catch {
            // Ignore read errors
          }
        }

        const promises = []

        for (const entry of entries) {
          // Useful hidden directories such as .github, .vscode, and
          // .devcontainer contain supported source/configuration files. Skip
          // only metadata and cache directories; normal skip/ignore rules
          // handle the rest.
          if (entry.isDirectory() && [".git", ".svn", ".hg", ".cache", ".nyc_output", ".venv", ".next", ".nuxt", ".svelte-kit", ".turbo"].includes(entry.name)) continue
          const fullPath = path.join(dir, entry.name)
          const relativePath = path.relative(projectPath, fullPath)
          const ignorePath = relativePath + (entry.isDirectory() ? "/" : "")

          // ── an explicit `!pattern` is consulted FIRST ──────────────────────
          // Every rule below this point is a DEFAULT, and a default a user cannot
          // override is a bug. Measured in this repository before this change: the
          // compiled-mode list hid 17 first-party files (`script/perf/**`, including
          // the gate that verifies the worker pool) and `/bin/` hid the shipped
          // `bin/bb` launcher, and NO ignore file could bring any of them back —
          // `shouldSkip` ran before `.bbignore`/`.gitignore` and supported no negation.
          //
          // So the ignore verdict is read first, and an explicit un-ignore (or being
          // inside a directory that was explicitly un-ignored) escapes the built-in
          // skips for that subtree. Normal ignoring is unchanged: a file the ignore
          // files ignore is still skipped below.
          const verdict = localIg.test(ignorePath)
          const forced = forceInclude || verdict.unignored

          // === COMPILED-MODE SAFE DIRECTORY FILTER (v2) ===
          // Kept as plain string checks so they survive minification, but no longer
          // unconditional: `forced` is the user's explicit override.
          //
          // `/perf/` was REMOVED here. It is a plausible default for someone else's
          // benchmark tree, but in this repository it silently excluded real source
          // (measured: 17 tracked files with a valid extension), and a benchmark
          // directory is not something bb should decide to hide on the user's behalf
          // when the cost of indexing it is a handful of small files.
          if (
            !forced &&
            (relativePath.includes("/Microbenchmarks/") ||
              relativePath.includes("/wwwroot/") ||
              relativePath.includes("/coverage/") ||
              relativePath.includes("/node_modules/") ||
              relativePath.includes("/dist/") ||
              relativePath.includes("/build/") ||
              relativePath.includes("/.git/") ||
              relativePath.includes("/obj/") ||
              relativePath.includes("/bin/") ||
              relativePath.includes("/testData/"))
          ) {
            continue
          }

          // Skip patterns are project-relative: a skip dir must be INSIDE the
          // project. Matching the absolute path would also skip any project
          // rooted under a skipped directory (e.g. ~/.vscode/tmp fixtures).
          if (!forced && shouldSkip("/" + relativePath)) continue

          if (verdict.ignored) continue

          if (entry.isDirectory()) {
            promises.push(walk(fullPath, localIg, depth + 1, forced))
          } else if (entry.isFile()) {
            // Two gates, cheapest first: the PURE path-only check admits every
            // recognised extension with no I/O, and only an extensionless file
            // pays for the bounded shebang read.
            if (hasValidExtension(fullPath)) {
              promises.push(processFile(fullPath))
            } else if (await admitsShellShebang(fullPath)) {
              promises.push(processFile(fullPath))
            }
          }
        }
        await Promise.all(promises)
      } catch {
        // Skip
      }
    }

    // CASE-SENSITIVE, because these are GITIGNORE patterns and git is case-sensitive.
    // The `ignore` package defaults to case-INsensitive, so `**/testData/**` was matching
    // lowercase `testdata/` — which git does NOT do with the same pattern and the same file.
    // MEASURED: 12,479 routed-extension files across 452 lowercase `testdata/` directories,
    // confirmed three ways (the graphql lane's own count of 156, a filesystem census that
    // counted exactly 156 `.graphql`, and the predicate itself returning IGNORED for a
    // lowercase path — while `ignorecase: false` and git both KEEP it).
    // Falsifier: the indexer's own admission count should rise by the files this was losing.
    const rootIg = ignore({ ignorecase: false })
    // Built-in ignore globs. These are DEFAULTS and are overridable: the user's
    // .bbignore is added BELOW, and last-match-wins means an explicit `!pattern`
    // there re-includes any of them. That ordering is the reason these can stay
    // while the walk's other two rule layers had to be changed (they ran before the
    // ignore files and supported no negation).
    //
    // `**/perf/**` was REMOVED from this list for the same measured reason it was
    // removed from the walk: it hid real source in this repository (17 tracked files
    // with a valid extension, the worker-pool gate among them) and a benchmark
    // directory costs a handful of small files to index. A project that keeps
    // generated benchmark data under perf/ can exclude it in .bbignore.
    rootIg.add([
      "**/Microbenchmarks/**",
      "**/wwwroot/**",
      "**/testassets/**",
      "**/benchmarkapps/**",
      "**/coverage/**",
      "**/testData/**",
    ])
    // Load root .bbignore (user-controlled indexing exclusions)
    if (bbignoreRules.length > 0) {
      rootIg.add(bbignoreRules)
    }
    // Load CLI --exclude patterns (comma-separated globs)
    if (excludePatterns && excludePatterns.length > 0) {
      rootIg.add(excludePatterns)
    }
    await walk(projectPath, rootIg)
  }

  // Cleanup stale files (files in DB but no longer on disk)
  // Only do this for a full run (when there are no filesOverride).
  // M64.C: NEVER on an eligible-only run. That caller is asking what is on disk,
  // and deleting index rows to "answer" a health question would make the
  // question destructive — a read-only tool that mutated the index.
  // `rawDb` rather than `!eligibleOnly` for the same reason as the guard above:
  // this block dereferences the handle seven times, and the null-ness is the
  // handle's own. `existingRecords` is empty on the null path, so `staleFiles`
  // is empty too — the `!rawDb` test changes nothing about what runs.
  if (rawDb && !eligibleOnly && (!filesOverride || filesOverride.length === 0)) {
    const staleFiles = existingRecords.filter((record) => !foundFiles.has(record.path))
    if (staleFiles.length > 0) {
      log.debug("cleaning up stale files from database", { staleCount: staleFiles.length })
      const tx = rawDb.transaction(() => {
        const deleteFileSymbols = rawDb.prepare(`DELETE FROM brain_symbol WHERE file_id = ?`)
        const deleteFileImports = rawDb.prepare(`DELETE FROM brain_import WHERE file_id = ?`)
        const deleteFileRelationships = rawDb.prepare(`
          DELETE FROM brain_relationship 
          WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
        `)
        const deleteFileTaints = rawDb.prepare(`
          DELETE FROM brain_taint_flow 
          WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
             OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
        `)
        const deleteFile = rawDb.prepare(`DELETE FROM brain_file WHERE id = ?`)

        for (const stale of staleFiles) {
          let relativePath = path.relative(projectPath, stale.path)
          const fileId = `${projectId}:${relativePath}`

          deleteFileRelationships.run(fileId)
          deleteFileTaints.run(fileId, fileId)
          deleteFileSymbols.run(fileId)
          deleteFileImports.run(fileId)
          deleteFile.run(fileId)
        }
      })

      try {
        tx()
        log.info(`✅ Removed ${staleFiles.length} deleted files from brain index`)
      } catch (err) {
        log.error("failed to clean up stale files", { error: err })
      }
    }
  }

  log.debug("file discovery and incremental check complete", {
    filesToIndex: files.length,
    skippedFiles: stats.skippedFiles,
    durationMs: Date.now() - startTime,
  })

  return files
}

// ============================================================================
// IN-PROCESS PARSER (for compiled binary where fork() doesn't work)
// ============================================================================

async function processInProcess(
  projectId: ProjectID,
  projectPath: string,
  files: string[],
  onProgress: (processed: number, total: number, currentFile: string) => void,
  telemetry?: { dbFlushMs: number; retries: number; workerCount: number },
  signal?: AbortSignal,
): Promise<FileResult[]> {
  // M21.R3: cooperative cancellation check for the in-process fallback path.
  const aborted = () => signal?.aborted ?? false
  const results: FileResult[] = []
  let processed = 0
  let consecutiveTimeouts = 0
  const MAX_CONSECUTIVE_TIMEOUTS = 50
  // A cancel observed here has to be REPORTED, and `stats` does not exist in
  // this function — this line read `stats.cancelled = true`, which is a
  // ReferenceError at runtime. It was invisible because the whole file carries
  // `@ts-nocheck`, which is exactly the class of defect that directive hides.
  //
  // `telemetry` is the channel this function already has for telling the caller
  // what happened (it carries workerStartFailures/poisonFiles and is threaded
  // from the caller), so `cancelled` belongs there rather than in a phantom
  // variable. The caller propagates it to `stats.cancelled`.
  let sawCancel = false
  const FILE_TIMEOUT_MS = 60000 // 60s per file in in-process mode

  // SAFETY LIMITS for compiled mode (where tree-sitter WASM can hang synchronously)
  // After FULL_AST_CUTOFF files, switch to regex-based fallback extraction only
  // After MAX_FILES_IN_PROCESS files, stop entirely
  const FULL_AST_CUTOFF = 13000
  const MAX_FILES_IN_PROCESS = 14000
  const effectiveFiles = files.slice(0, MAX_FILES_IN_PROCESS)
  if (files.length > MAX_FILES_IN_PROCESS) {
    log.warn(`clamping files from ${files.length} to ${MAX_FILES_IN_PROCESS} (compiled mode safety limit)`)
  }

  // Load pool-worker's parse function
  const poolWorker = await import("./pool-worker")
  const parseFile = (poolWorker as any).parseFile

  for (const file of effectiveFiles) {
    // M21.R3: cooperative cancellation — stop before starting the next file.
    if (aborted()) {
      sawCancel = true
      if (telemetry) (telemetry as { cancelled?: number }).cancelled = 1
      for (const f of effectiveFiles.slice(effectiveFiles.indexOf(file))) {
        results.push({ filePath: f, success: false, error: "cancelled by user" })
        processed++
      }
      break
    }
    // Check if we should abort due to consecutive hangs
    if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
      log.warn(`aborting in-process indexing after ${MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts at file ${processed}/${effectiveFiles.length}`)
      break
    }

    // After FULL_AST_CUTOFF, use fallback extraction only (regex-based, can't hang)
    const useFallbackOnly = processed >= FULL_AST_CUTOFF

    try {
      let result: any
      if (useFallbackOnly) {
        result = await extractFallbackResult(file, projectPath)
      } else {
        // Per-file timeout race — Bun may fire setTimeout even during CPU-bound WASM
        result = await Promise.race([
          parseFile
            // M60 yaml lane (2026-10-09): the IN-PROCESS path hands the analyzers the
            // project root too, so a file-scoped identity (a document, a module) is scoped
            // identically whether the file is parsed in a worker or in this process. The
            // worker path carries it at `pool-worker.ts`'s `contextFor`.
            ? parseFile(file, projectPath, { projectRoot: projectPath })
            : extractFallbackResult(file, projectPath),
          new Promise<any>((_, reject) =>
            setTimeout(() => reject(new Error("FILE_TIMEOUT")), FILE_TIMEOUT_MS)
          ),
        ])
      }

      consecutiveTimeouts = 0 // Reset on success
      if (result) {
        results.push({ filePath: file, ...result, success: true })
      }
    } catch (e: any) {
      const isTimeout = e?.message === "FILE_TIMEOUT"
      if (isTimeout) {
        consecutiveTimeouts++
        log.warn(`in-process parse timed out after ${FILE_TIMEOUT_MS}ms for ${file} (${consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS})`)
      } else {
        consecutiveTimeouts = 0
        log.warn(`in-process parse failed for ${file}: ${e?.message}`)
      }
      // Store error metadata for the file
      results.push({ filePath: file, success: false, error: e?.message || String(e) })
    }
    processed++
    onProgress(processed, files.length, file)

    // Store results in DB every 100 files (same as worker pool batch)
    if (results.length >= 100) {
      const batch = results.splice(0, results.length)
      const flushStart = Date.now()
      try {
        await storeResults(projectId as any, projectPath, batch, { skipResolution: true })
        if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
        log.info(`stored ${batch.length} file results in DB`)
      } catch (e: any) {
        if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
        log.error(`storeResults failed: ${e?.message || String(e)}`)
      }
      // Re-add for return value
      results.push(...batch)
    }
  }

  // Flush remaining results to DB. skipResolution=false so the cross-file
  // relationship resolution pass runs once at the end (parity with the
  // opencode brain's final pass — otherwise cross-file edges are missing).
  if (results.length > 0) {
    const flushStart = Date.now()
    try {
      await storeResults(projectId as any, projectPath, results, { skipResolution: false })
      if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
      log.info(`stored final ${results.length} file results in DB`)
    } catch (e: any) {
      if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
      log.error(`final storeResults failed: ${e?.message || String(e)}`)
    }
  }

  return results
}

async function extractFallbackResult(filePath: string, projectPath: string): Promise<any> {
  const { extractFallback } = await import("./pool-worker")
  const { readFile } = await import("fs/promises")
  const path = await import("path")
  const content = await readFile(filePath, "utf-8")
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const stat = await import("fs").then((fs) => fs.statSync(filePath))
  let hash = ""
  try {
    if (typeof Bun !== "undefined") {
      hash = Bun.hash(content).toString(36)
    } else {
      // FNV-1a (32-bit) — deterministic cross-runtime fallback
      let h = 0x811c9dc5
      for (let i = 0; i < content.length; i++) {
        h ^= content.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
      }
      hash = (h >>> 0).toString(36)
    }
  } catch {}
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", rs: "rust", go: "go", rb: "ruby", java: "java",
    cs: "csharp", cpp: "cpp", c: "c", h: "c", swift: "swift",
    kt: "kotlin", scala: "scala", php: "php", lua: "lua", r: "r",
    pl: "perl", sh: "bash", bash: "bash", zsh: "bash",
  }
  return extractFallback(content, langMap[ext] || ext, hash, stat.size, stat.mtimeMs)
}

// ============================================================================
// WORKER POOL PARSER
// ============================================================================

function findOnPath(name: string): string | null {
  const paths = (process.env.PATH || "").split(path.delimiter)
  for (const dir of paths) {
    const candidate = path.join(dir, name)
    try {
      if (require("fs").existsSync(candidate)) return candidate
    } catch {}
  }
  return null
}

// Resolve the correct fork target for pool workers. fork() always loads its
// first arg as a script under process.execPath, so the target is always the
// worker module path — never the executable.
// - Compiled dist (plain Node): dist/pool-worker.js
// - Dev (Node + tsx): tsx binary (local .bin, then PATH) + src/ast/pool-worker.ts
// - Dev (Bun): bun binary + src/ast/pool-worker.ts (runs TypeScript natively)
function resolvePoolWorkerFork(): { workerPath: string | null; workerArgs: string[] } {
  const moduleDir = path.dirname(require("url").fileURLToPath(import.meta.url))
  const isCompiled =
    (moduleDir.endsWith(`${path.sep}dist`) || moduleDir.includes(`${path.sep}dist${path.sep}`)) &&
    !moduleDir.includes(`${path.sep}src${path.sep}`)
  if (isCompiled) {
    return {
      workerPath: path.join(moduleDir, "pool-worker.js"),
      workerArgs: [],
    }
  }
  const projectRoot = path.resolve(moduleDir, "../..")
  const workerEntry = path.join(projectRoot, "src", "ast", "pool-worker.ts")
  if (process.execPath.endsWith("node") || process.execPath.endsWith("node.exe")) {
    // Dev mode with tsx — local bin first, then PATH. If neither exists, the
    // fork test fails fast and indexing falls back to in-process.
    const localTsx = path.join(projectRoot, "node_modules", ".bin", "tsx")
    const tsxPath = require("fs").existsSync(localTsx) ? localTsx : findOnPath("tsx")
    if (!tsxPath) return { workerPath: null, workerArgs: [] }
    return { workerPath: tsxPath, workerArgs: [workerEntry] }
  }
  // Bun: runs TypeScript natively — fork the worker entry itself
  return { workerPath: workerEntry, workerArgs: [] }
}

/**
 * Why a worker pool could not be started, in terms a user can act on.
 *
 * `resolvePoolWorkerFork` returns `workerPath: null` when it cannot find a
 * TypeScript loader, but its two call sites used to pass that straight into
 * `fork()`. `fork(null)` throws a TypeError, and because the call sat inside a
 * broad try/catch the throw was swallowed and reported as a generic
 * "worker pool unavailable" — so a missing `tsx` looked identical to a genuine
 * crash, and the run silently degraded to serial in-process parsing.
 *
 * This narrows the diagnosis so the CLI can name the actual cause and the fix.
 */
export function describePoolWorkerUnavailable(): string {
  // Retained for callers that only want prose. The resolver below is the
  // structured path and should be preferred.
  if (process.execPath.endsWith("node") || process.execPath.endsWith("node.exe")) {
    const moduleDir = path.dirname(require("url").fileURLToPath(import.meta.url))
    const projectRoot = path.resolve(moduleDir, "../..")
    const localTsx = path.join(projectRoot, "node_modules", ".bin", "tsx")
    if (!require("fs").existsSync(localTsx) && !findOnPath("tsx")) {
      return (
        "no TypeScript loader found: neither node_modules/.bin/tsx nor tsx on PATH. " +
        "Run `npm install` (or `npm i -D tsx`) to restore parallel indexing, or set " +
        "BB_POOL_WORKER=0 to accept serial in-process indexing."
      )
    }
  }
  return "the worker pool could not be forked; falling back to serial in-process indexing"
}

export async function processWithWorkerPool(
  projectId: ProjectID,
  projectPath: string,
  files: string[],
  onProgress: (processed: number, total: number, currentFile: string) => void,
  telemetry?: { dbFlushMs: number; retries: number; workerCount: number; workerStartupFailures: number; poisonFiles: number },
  signal?: AbortSignal,
): Promise<FileResult[]> {
  const concurrency = ParallelIndexerConfig.concurrency
  const batchSize = ParallelIndexerConfig.workerBatchSize
  const numWorkers = Math.min(concurrency, Math.ceil(files.length / batchSize) || 1)
  const timeoutMs = ParallelIndexerConfig.fileTimeoutMs
  // M21.W1: a forked worker must signal `ready` within this window or it is
  // presumed hung (engine boot crash, broken runtime). Env-configurable so the
  // startup watchdog is deterministically exercisable in fixtures.
  const workerStartupTimeoutMs = Number(process.env.BB_WORKER_STARTUP_TIMEOUT_MS || 30000)

  // ── Event-loop stall detector: the watchdog must not blame the worker for the
  // parent's block ─────────────────────────────────────────────────────────────
  // `handleWorkerTimeout` is a WALL-CLOCK timer in the parent, and the parent is
  // the only process that touches SQLite — synchronously. One long `flushDbBatch`
  // therefore expires the timers of every in-flight batch at once, and the pool
  // is killed as a unit: measured 99 kills in one run, in bursts of exactly 7
  // (the whole pool), every 3-5 minutes, while the machine sat at load 4.1 and the
  // same files parsed in 82-520 ms. A worker was never the slow part.
  //
  // The tick below measures how long the loop was ACTUALLY blocked, and
  // `decideWatchdog` refuses to kill a worker for a window the parent spent
  // blocked. See src/ast/watchdog-policy.ts for the measurements and the rule.
  let lastStallMs = 0
  let lastStallEndedAt = 0
  let stalledTotalMs = 0
  let watchdogDeferrals = 0
  let workerKills = 0
  let poolCompletionLogged = false
  let stallTickAt = Date.now()
  const stallTimer = setInterval(() => {
    const tickNow = Date.now()
    const lateness = tickNow - stallTickAt - WATCHDOG_TICK_MS
    stallTickAt = tickNow
    if (lateness >= WATCHDOG_MIN_STALL_MS) {
      lastStallMs = lateness
      lastStallEndedAt = tickNow
      stalledTotalMs += lateness
      log.warn("parent event loop was blocked", { ms: lateness, stalledTotalMs })
    }
  }, WATCHDOG_TICK_MS)
  // Never hold the process open for a diagnostic.
  stallTimer.unref?.()

  log.debug("starting worker pool", { numWorkers, files: files.length, batchSize })

  // Streaming DB batch
  let pendingDbBatch: FileResult[] = []
  const dbPromises: Array<
    Promise<{
      symbols: number
      relationships: number
      imports: number
      failed?: boolean
      rolledBackBatches?: number
      rolledBackFiles?: number
    }>
  > = []

  // Stall-bounded flush (opt-in, measured — the DEFAULT is deliberately the cheap
  // end, because correctness no longer depends on shortening the block; the
  // deferral policy in watchdog-policy.ts already survives it).
  //
  // A `storeResults` call is ONE synchronous pass through better-sqlite3: it holds
  // the parent's event loop for its whole duration. Measured, same graph both ways
  // (relHash `2d44228f89e5bb77` at n800, `8b164c3b570db152` at n200):
  //
  //   tier  chunk  files  wallMs  parseMs  dbFlushMs  blocks>=1s  blockedMs
  //   n200      4    196   30,790   24,048     20,165           0          0
  //   n200     10    196   30,510   24,055     14,619           1      1,535
  //   n200     20    196   30,214   24,060     13,555           8     10,782
  //   n800      4    796   55,200   42,786    127,066           1      1,024
  //   n800     20    796   52,782   41,058     32,406           7     10,294
  //
  // Chunking 20 files into 5 transactions costs 4x the store CPU at n800 and is
  // 2.4 s SLOWER end to end, so it buys responsiveness, not speed. It is kept as a
  // lever (`BB_DB_FLUSH_CHUNK=4`) for a deployment whose blocks would outlast the
  // per-file timeout on a much larger database — there, the 4x store cost is
  // cheaper than waiting out the deferrals.
  const FLUSH_CHUNK_FILES = Number(process.env.BB_DB_FLUSH_CHUNK || 20)
  const flushDbBatch = async (
    batchToStore: FileResult[],
  ): Promise<{
    symbols: number
    relationships: number
    imports: number
    failed?: boolean
    rolledBackBatches?: number
    rolledBackFiles?: number
  }> => {
    if (batchToStore.length === 0) return { symbols: 0, relationships: 0, imports: 0 }
    const flushStart = Date.now()
    let symbols = 0
    let relationships = 0
    let imports = 0
    let rolledBackBatches = 0
    let rolledBackFiles = 0
    try {
      for (let i = 0; i < batchToStore.length; i += FLUSH_CHUNK_FILES) {
        const chunk = batchToStore.slice(i, i + FLUSH_CHUNK_FILES)
        const stats = await storeResults(projectId, projectPath, chunk, { skipResolution: true })
        symbols += stats.symbols
        relationships += stats.relationships
        imports += stats.imports
        rolledBackBatches += stats.rolledBackBatches ?? 0
        rolledBackFiles += stats.rolledBackFiles ?? 0
        // Yield between chunks: this is the line that keeps the loop responsive.
        if (i + FLUSH_CHUNK_FILES < batchToStore.length) {
          await new Promise((r) => setImmediate(r))
        }
      }
      if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
      return { symbols, relationships, imports, rolledBackBatches, rolledBackFiles }
    } catch (e: any) {
      if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
      // Same contract as before chunking: a failed batch is reported as failed and
      // the caller skips it. Chunks already committed before the failure are not
      // subtracted back out — the counts here are the batch's, not a running total,
      // and under-reporting a failed batch is the honest direction to err.
      log.error("storeResults failed", { error: e?.message, batchSize: batchToStore.length, chunkFiles: FLUSH_CHUNK_FILES })
      return {
        symbols: -1,
        relationships: -1,
        imports: -1,
        failed: true,
        rolledBackBatches: 1,
        rolledBackFiles: batchToStore.length,
      }
    }
  }

  // async: the project-index build below awaits a dynamic import, and an `await` in a
  // non-async Promise executor is a parse error rather than a runtime one.
  return new Promise(async (resolve) => {
    const results: FileResult[] = []

    let processed = 0

    // ── SOL-21: the project index, built ONCE per run and shipped with every batch.
    //
    // WHY IT IS BUILT HERE AND NOT IN THE WORKER. A worker sees only its BATCH, so an
    // index built there would resolve against whatever else happened to be in that batch
    // — the same file would get a different answer depending on the run. Building it
    // once here, from the whole run's file list, and shipping it makes every file in a
    // run see the SAME project view.
    //
    // AND WHY THAT IS STILL RUN-DEPENDENT, STATED RATHER THAN GLOSSED. The index is
    // built from `files`, which for an INCREMENTAL run is a subset of the project, so an
    // incremental run produces LESS enrichment than a full one. That is why the analyzer
    // stamps `projectIndexSupplied` on every row: a per-file answer and a settled answer
    // are then distinguishable in the store, and enrichment is MONOTONIC — a full re-index
    // can only add resolution, never contradict a settled one, because a settled one is
    // written only when the index knew. Resolving against the whole project on an
    // incremental run would need a second discovery pass that honours .bbignore and
    // .git boundaries, and duplicating that logic is a worse risk than an under-enriched
    // incremental run.
    //
    // Opt-in per EXTENSION, and the only entries are ones this repository has measured the
    // benefit of. A language with no entry pays nothing and behaves exactly as before.
    //
    // `.fs` and NOT `.fsi`: an F# signature/definition pair states the same entity twice, and
    // indexing the `.fsi` too would let a `.fs` file resolve a target to a surface declared only
    // there — a real population (3,689 edges on the lane's corpus census), but one whose identity
    // rule (which of the two a target means) is undecided, and an index is the wrong place to
    // decide it by accident.
    //
    // FS-P16. APPLIED TWICE: this block was silently reverted once by a stale write from another
    // session editing this file, and the symptom was invisible — the run simply produced the
    // pre-index classes (0 `in-project-*` rows in the store) with no warning anywhere, because a
    // missing index is a SUPPORTED state. The store-side check that catches it is written down in
    // `docs/analyzers/real-fsharp-analyzer.md` pass 16: index a small F# project and count
    // `in-project-*` in `brain_relationship.metadata`; 0 means the registration is gone.
    // `.proto` ADDED 2026-10-11 (protobuf lane). The entry is INERT WITHOUT A SPEC: measured over the
    // whole corpus (847 .proto files), the Solidity default yields 0 names and 0 types — an entry that
    // indexes the right SHAPE and holds nothing, which is the dart situation one layer down.
    const PROJECT_INDEX_EXTENSIONS: Record<string, string> = { ".sol": "solidity", ".fs": "fsharp", ".proto": "protobuf", ".scss": "scss", ".java": "java" }
    // `.groovy` IS DELIBERATELY ABSENT, and it was added and then removed in the same change: this
    // table is only half the contract, and the other half is `specByLang` below. With `.groovy` here
    // and no groovy spec there, the lookup fell through to `?? SOLIDITY_DECLARATION_SPEC` and
    // indexed GROOVY declarations with the SOLIDITY spec — which is EXACTLY the defect this file's
    // `.scss` comment records from this morning (`.scss` reached the table without its spec being
    // reachable). A lane is wired when BOTH halves exist, not when its extension is listed.
    let projectIndexes: Record<string, unknown> | undefined
    try {
      const wanted = new Set<string>()
      for (const f of files) {
        const base = f.slice(f.lastIndexOf("/") + 1)
        const dot = base.lastIndexOf(".")
        if (dot <= 0) continue
        const ext = base.slice(dot).toLowerCase()
        if (PROJECT_INDEX_EXTENSIONS[ext] !== undefined) wanted.add(ext)
      }
      if (wanted.size > 0) {
        const mod: any = await import("./project-index")
        // The wasm lives beside this module's package root, resolved the same way
        // `resolvePoolWorkerFork` resolves its own paths — from THIS file's location, so
        // it is correct whether the code runs from `src/ast` or from `dist`.
        const repoRoot = path.resolve(path.dirname(require("url").fileURLToPath(import.meta.url)), "..", "..")
        const wasmByLang: Record<string, string> = {
          solidity: path.join(repoRoot, "wasm", "tree-sitter-solidity.wasm"),
          fsharp: path.join(repoRoot, "wasm", "tree-sitter-fsharp.wasm"),
          protobuf: path.join(repoRoot, "wasm", "tree-sitter-protobuf.wasm"),
          scss: path.join(repoRoot, "wasm", "tree-sitter-scss.wasm"),
        }
        // The SPEC is per language for the reason project-index.ts gives: the generic extractor
        // reads `childForFieldName("name")`, which is true of Solidity and false of F# three ways
        // (a clause's name is an UNNAMED `type_name` child, a member is named after the instance
        // dot, an abstract member's name is its signature's first identifier). A language absent
        // here keeps Solidity's spec, which is what every pre-existing entry did and is why this
        // map is additive rather than a rewrite.
        const specByLang: Record<string, unknown> = {
          solidity: mod.SOLIDITY_DECLARATION_SPEC,
          fsharp: mod.FSHARP_DECLARATION_SPEC,
          // `.scss` was added to PROJECT_INDEX_EXTENSIONS without an entry here, so the lookup below
          // fell through to `?? SOLIDITY_DECLARATION_SPEC` and indexed SCSS declarations with the
          // SOLIDITY spec. The spec is now exported (see project-index.ts) and mapped by name.
          scss: mod.SCSS_DECLARATION_SPEC,
          // JAVA. `qualifyTypeWithFile` gives the index the fully-qualified type names a LOCALITY
          // question needs (`java.util.List` vs `org.grails.Foo` are the same shape otherwise), which
          // is the same reasoning `.scss` needed its spec for.
          java: mod.JAVA_DECLARATION_SPEC,
          // DYNAMIC, like `mod` above: the indexer does not otherwise import an analyzer, and a static
          // import would pull the whole engine into its startup for a spec used once. The spec lives in
          // the language's own analyzer because the grammar's declarations are named by a CHILD node
          // (`message_name`, not a `name` field) and the `package` is a SIBLING of the declaration.
          protobuf: (await import("./real-protobuf-analyzer")).PROTOBUF_DECLARATION_SPEC,
        }
        const { existsSync: wasmExists } = await import("fs")
        const byExt: Record<string, unknown> = {}
        for (const ext of wanted) {
          const lang = PROJECT_INDEX_EXTENSIONS[ext]
          const wasm = wasmByLang[lang]
          if (wasm === undefined || !wasmExists(wasm)) continue
          const subset = files.filter((f) => f.toLowerCase().endsWith(ext))
          if (subset.length === 0) continue
          const built = await mod.buildProjectIndexFromDisk(wasm, subset, specByLang[lang] ?? mod.SOLIDITY_DECLARATION_SPEC)
          byExt[ext] = mod.serializeProjectIndex(built)
          log.info("project index built", { ext, files: subset.length, types: built.typeKinds.size })
        }
        if (Object.keys(byExt).length > 0) projectIndexes = byExt
      }
    } catch (e: any) {
      // A failure here must not fail the run: no index is exactly the pre-SOL-21
      // behaviour, and enrichment is additive by construction.
      log.warn("project index unavailable, indexing per-file", { error: e?.message ?? String(e) })
      projectIndexes = undefined
    }

    const fileQueue = [...files]
    const fileRetries = new Map<string, number>() // Track retries per file; skip after 3 attempts
    const MAX_FILE_RETRIES = 3
    const pendingBatches = new Map<
      number,
      {
        files: string[]
        worker: ChildProcess
        timeout: ReturnType<typeof setTimeout>
        currentFile?: string
        attempts?: number
        /** Watchdog deferrals granted to this batch (see watchdog-policy.ts). */
        deferrals?: number
      }
    >()
    let batchCounter = 0
    // M21.R3: cooperative cancellation. Once aborted, stop dispatching new
    // batches; in-flight batches drain and the pool resolves normally so the
    // DB keeps only fully-stored files (the durable checkpoint).
    const aborted = () => signal?.aborted ?? false

    const workers = new Set<ChildProcess>()
    const idleWorkers: ChildProcess[] = []
    /**
     * Workers that have exited. Membership is what makes "is this worker still
     * usable?" answerable, which the pool previously never asked.
     *
     * THE RACE THIS EXISTS TO CLOSE. A worker can exit before its `exit` event
     * is delivered AND before a queued message from it is delivered. The two
     * orderings are not guaranteed relative to each other, so:
     *
     *   1. the process exits        -> `exit` handler runs, `idleWorkers`
     *                                  does not contain the worker yet, so its
     *                                  splice is a no-op
     *   2. a queued `engine_fail`   -> the handler runs LATER and does
     *      message is delivered        `idleWorkers.push(worker)` unconditionally
     *
     * The dead worker is now in the idle pool. `scheduleNext` shifts it and calls
     * `worker.send(...)` on a closed IPC channel, which raises EPIPE. On a
     * ChildProcess that surfaces as an 'error' event, and nothing is listening,
     * so Node terminates the whole index process and the in-flight batch is lost.
     *
     * Measured on this repository: the index reached 1,361 of 7,354 files and
     * died; on `--resume` it reached 1,777, then 1,839, then 2,108. The trigger
     * was always a large JSON file, and always after the pool had been running
     * long enough for an engine-failure/exit race.
     *
     * Two independent guards, because either alone leaves a window: membership
     * here stops a dead worker entering the pool, and the `send` try/catch below
     * stops a dead worker that is already in it from taking the process down.
     */
    const deadWorkers = new Set<ChildProcess>()

    function handleWorkerTimeout(worker: ChildProcess, batchId: number) {
      try {
        const batch = pendingBatches.get(batchId)
        if (!batch) return

        // An expired timer is only evidence about the worker when the PARENT was
        // able to observe it. If the event loop spent a large part of this
        // batch's window blocked in a synchronous store, the worker is innocent:
        // re-arm and let it finish. Measured failure this prevents: 99 kills in
        // one run, in bursts of exactly 7 — the whole pool — every 3-5 minutes.
        const decision = decideWatchdog({
          now: Date.now(),
          lastStallMs,
          lastStallEndedAt,
          timeoutMs,
          deferrals: batch.deferrals ?? 0,
        })
        if (decision.action === "defer") {
          batch.deferrals = (batch.deferrals ?? 0) + 1
          watchdogDeferrals++
          clearTimeout(batch.timeout)
          batch.timeout = setTimeout(() => handleWorkerTimeout(worker, batchId), timeoutMs)
          log.warn("watchdog deferred — the parent's event loop was blocked, the worker was not", {
            batchId,
            currentFile: batch.currentFile,
            stallMs: lastStallMs,
            deferrals: batch.deferrals,
          })
          return
        }

        clearTimeout(batch.timeout)
        pendingBatches.delete(batchId)

        workerKills++
        log.warn("Worker timed out or crashed, killing process", { batchId, currentFile: batch.currentFile, reason: decision.reason })

        try {
          worker.kill("SIGKILL")
        } catch (e: any) {}

        const currentFile = batch.currentFile

        if (currentFile) {
          results.push({ filePath: currentFile, success: false, timeout: true, error: "Worker crash/timeout" })
          pendingDbBatch.push({ filePath: currentFile, success: false, timeout: true, error: "Worker crash/timeout" })
          processed++
          try {
            onProgress(processed, files.length, currentFile)
          } catch (e: any) {}

          const idx = batch.files.indexOf(currentFile)
          if (idx !== -1 && idx < batch.files.length - 1) {
            const remaining = batch.files.slice(idx + 1)
            // Filter out files that have been retried too many times
            for (const f of remaining) {
              const retries = (fileRetries.get(f) || 0) + 1
              if (retries > MAX_FILE_RETRIES) {
                log.warn("Skipping file after max retries", { file: f, retries })
                results.push({ filePath: f, success: false, error: "Max retries exceeded" })
                processed++
                onProgress(processed, files.length, f)
              } else {
                fileRetries.set(f, retries)
                if (telemetry) telemetry.retries++
                fileQueue.unshift(f)
              }
            }
          }
        } else {
          // Worker died BEFORE reporting file_start. This is a Poison Pill batch.
          log.warn("Worker crashed before file_start. Dropping suspected poison pill.", { droppedFile: batch.files[0] })
          if (telemetry) telemetry.poisonFiles++
          results.push({ filePath: batch.files[0], success: false, error: "Worker crashed before file_start" })
          pendingDbBatch.push({ filePath: batch.files[0], success: false, error: "Worker crashed before file_start" })
          processed++
          try {
            onProgress(processed, files.length, batch.files[0])
          } catch (e: any) {}

          if (batch.files.length > 1) {
            const remaining = batch.files.slice(1)
            for (const f of remaining) {
              const retries = (fileRetries.get(f) || 0) + 1
              if (retries > MAX_FILE_RETRIES) {
                log.warn("Skipping poison-pill file after max retries", { file: f, retries })
                results.push({ filePath: f, success: false, error: "Max retries exceeded (poison pill)" })
                processed++
                onProgress(processed, files.length, f)
              } else {
                fileRetries.set(f, retries)
                if (telemetry) telemetry.retries++
                fileQueue.unshift(f)
              }
            }
          }
        }
      } catch (err) {
        log.error("Error in handleWorkerTimeout", { error: err })
      }
      // Dispatch queued files to any remaining idle workers
      scheduleNext()
    }

    // M21.W1: a worker that never reaches the ready state (fork failure, tsx
    // missing, engine boot crash) is a STARTUP failure — distinct from a
    // per-file parser failure. Track it so the pool can fail visibly instead
    // of silently stalling with zero usable workers.
    let startupFailures = 0
    // Allow at most one full pool of startup attempts before giving up. This
    // bounds the restart loop: a broken worker runtime must not cause an
    // infinite spawn-kill-spawn cycle with zero progress.
    const MAX_STARTUP_FAILURES = Math.max(numWorkers, 2)

    // Fail every file still queued with a visible startup-failure outcome so
    // the pool terminates instead of hanging with zero usable workers.
    const failRemainingAsStartup = () => {
      if (fileQueue.length === 0 && pendingBatches.size === 0) return
      const stuck = fileQueue.splice(0)
      for (const f of stuck) {
        results.push({ filePath: f, success: false, error: "worker pool unavailable (startup failure)" })
        processed++
        try { onProgress(processed, files.length, f) } catch {}
      }
      // The queue is now empty; without this the pool never resolves and the
      // whole index run hangs (the resolve only happens inside scheduleNext).
      scheduleNext()
    }

    const onStartupFailure = () => {
      startupFailures++
      if (telemetry) telemetry.workerStartupFailures = startupFailures
      // Bootstrap case: the very first createWorker calls all failed with no
      // worker ever forked (e.g. tsx missing). Nothing else will fire, so fail
      // visibly right here instead of hanging.
      if (workers.size === 0 && idleWorkers.length === 0 && fileQueue.length > 0 && startupFailures >= numWorkers) {
        failRemainingAsStartup()
      }
    }

    // Which workers have signalled `ready`. A worker that dies BEFORE that is a
    // startup failure, not a batch loss, and counting it is what makes the
    // restart cap below a cap.
    //
    // The bug this closes: `clearStartupTimer(worker)` is the first statement of
    // the `exit` handler, so a worker that died quickly could never trip the
    // startup watchdog, and nothing on the exit path incremented
    // `startupFailures`. A runtime that crashes before `ready` therefore forked a
    // replacement forever — zero files parsed, no error reported, the run simply
    // hung. Counted once per worker through countStartupFailure so the several
    // paths that can observe the same death cannot double-count it.
    const readyWorkers = new Set<ChildProcess>()
    const countStartupFailure = (w: ChildProcess) => {
      if ((w as any)._bbStartupCounted) return
      ;(w as any)._bbStartupCounted = true
      onStartupFailure()
    }

    function createWorker(workerId: number) {
      // Worker pool: fork a child process that enters pool-worker IPC mode.
      const { workerPath, workerArgs } = resolvePoolWorkerFork()
      if (!workerPath) {
        log.error("worker pool unavailable — no tsx binary found (dev mode)")
        onStartupFailure()
        return
      }
      if (telemetry) telemetry.workerCount++

      const worker = fork(workerPath, workerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      workers.add(worker)

      // M21.W1 startup watchdog: if this worker never signals `ready` within
      // workerStartupTimeoutMs, kill it and count a startup failure. The exit
      // handler decides whether to spawn a replacement (within the restart
      // cap) or fail the remaining queue visibly.
      const startupTimer = setTimeout(() => {
        if (!workers.has(worker)) return
        log.warn("Worker did not become ready within startup timeout — killing", {
          workerId,
          timeoutMs: workerStartupTimeoutMs,
        })
        countStartupFailure(worker)
        try { worker.kill("SIGKILL") } catch (e: any) {}
      }, workerStartupTimeoutMs)
      ;(worker as any)._bbStartupTimer = startupTimer

      const clearStartupTimer = (w: ChildProcess) => {
        const t = (w as any)._bbStartupTimer
        if (t) {
          clearTimeout(t)
          ;(w as any)._bbStartupTimer = undefined
        }
      }

      // Worker stdout/stderr is piped (never inherited), so something has to drain it
      // or a chatty child fills the pipe buffer and deadlocks. But echoing every
      // line verbatim turned routine INFO logging from N workers into a wall of
      // `[WORKER-ERR] [INFO] [ast-engine] tree-sitter core initialized` noise
      // that buried the progress line users actually read.
      //
      // So: drain always (required), echo only when explicitly asked, and treat
      // the child's stderr as diagnostics rather than errors — a worker writing
      // to stderr is normal, not a failure.
      const echoWorkerOutput = process.env.BB_WORKER_ECHO === "1"
      const relayWorker = (tag: string) => (data: Buffer) => {
        if (!echoWorkerOutput) return
        // Buffer partial lines: a single chunk can split mid-line and produce
        // ragged, doubled output.
        const text = data.toString()
        for (const line of text.split("\n")) {
          if (line.trim().length > 0) process.stderr.write(`[${tag}] ${line}\n`)
        }
      }
      worker.stderr?.on("data", relayWorker("worker"))
      worker.stdout?.on("data", relayWorker("worker-out"))

      // A worker's IPC channel can fail ASYNCHRONOUSLY, and an unhandled 'error'
      // event on a ChildProcess kills the PARENT — taking the whole index run with
      // it, which is the failure class the dispatch guard's comment claims to have
      // fixed. The try/catch around `worker.send()` cannot see this: it only
      // catches a synchronous throw. Reproduced on Node v22.22.1 — a dispatch into
      // a worker that died while the parent was blocked in a synchronous store
      // returned `true`, and the write then failed with EPIPE as an unhandled
      // 'error' (process exit 7); after the `exit` event the same send returns
      // false AND emits ERR_IPC_CHANNEL_CLOSED (exit 1).
      //
      // So every worker carries an error handler for its whole life. The batch it
      // held is requeued by the `exit` handler, which follows; this handler's job
      // is to make the failure a worker loss instead of a run loss, and to retire
      // the worker deterministically so that requeue actually happens.
      worker.on("error", (err: Error) => {
        log.warn("worker IPC error — retiring the worker so its batch is requeued", {
          workerId,
          error: String((err as any)?.message ?? err),
        })
        deadWorkers.add(worker)
        clearStartupTimer(worker)
        const deadIdx = idleWorkers.indexOf(worker)
        if (deadIdx !== -1) idleWorkers.splice(deadIdx, 1)
        if (!readyWorkers.has(worker)) countStartupFailure(worker)
        try { worker.kill("SIGKILL") } catch {}
        scheduleNext()
      })

      worker.on("message", (msg: any) => {
        try {
          if (msg.type === "ready") {
            clearStartupTimer(worker)
            readyWorkers.add(worker)
            idleWorkers.push(worker)
            scheduleNext()
          } else if (msg.type === "engine_fail") {
            process.stderr.write(`[brain] worker ${msg.workerId} engine load FAILED: ${msg.error}\n`)
            clearStartupTimer(worker)
            // Only pool this worker if it is still alive. This branch is exactly
            // where a dead worker used to enter the pool: the message can be
            // delivered after the `exit` event that already ran the splice
            // below, and there the splice found nothing to remove. See
            // deadWorkers for the full ordering.
            if (deadWorkers.has(worker) || worker.exitCode !== null || worker.killed) {
              log.warn("engine_fail arrived from a worker that had already exited; not pooling it", { workerId: msg.workerId })
            } else {
              // Still add to idle — regex fallback can handle files without engine
              idleWorkers.push(worker)
            }
            scheduleNext()
          } else if (msg.type === "file_start") {
            const batch = pendingBatches.get(msg.batchId)
            if (batch) {
              batch.currentFile = msg.filePath
              clearTimeout(batch.timeout)
              batch.timeout = setTimeout(() => handleWorkerTimeout(worker, msg.batchId), timeoutMs)
            }
          } else if (msg.type === "file_done") {
            // Keep the DB batch shape AND the accounting shape in sync: the
            // full parse result (symbols/imports/relationships/…) flows to
            // both. A historical stub here — `{ filePath, success: true }`
            // with no symbols — made the M22.V5 summary bucket every parsed
            // file as symbol-loss on real (worker-pool) runs (3,000+
            // "symbol-loss" printed next to 168k stored symbols) while
            // small-fixture gates could not see the inflation.
            const fileResult = { filePath: msg.filePath, ...msg.result }
            results.push({ ...fileResult, success: true, timeout: false, error: undefined })
            pendingDbBatch.push(fileResult)

            if (pendingDbBatch.length >= 20) { // Flush smaller batches to avoid blocking event loop
              const batchToStore = pendingDbBatch
              pendingDbBatch = []
              dbPromises.push(flushDbBatch(batchToStore))
            }

            processed++
            onProgress(processed, files.length, msg.filePath)
          } else if (msg.type === "file_error") {
            process.stderr.write(`[BB-WORKER-ERR] ${msg.filePath}: ${msg.error?.substring(0, 200)}\n`)
            results.push({ filePath: msg.filePath, success: false, error: msg.error })
            pendingDbBatch.push({ filePath: msg.filePath, success: false, error: msg.error })
            processed++
            onProgress(processed, files.length, msg.filePath)
          } else if (msg.type === "batch_done") {
            const batch = pendingBatches.get(msg.batchId)
            if (batch) {
              clearTimeout(batch.timeout)
              pendingBatches.delete(msg.batchId)
            }
            // Same guard as engine_fail, same race: a worker that finished a
            // batch and died before the message was delivered must not be
            // pooled.
            if (!deadWorkers.has(worker) && worker.exitCode === null && !worker.killed) idleWorkers.push(worker)
            scheduleNext()
          }
        } catch (err) {
          log.error("Error handling worker message", { error: err, msg })
        }
      })

      worker.on("exit", (code, signal) => {
        try {
          clearStartupTimer(worker)
          // Record the exit FIRST. Every path that puts a worker back into the
          // idle pool checks this, so a message delivered after the exit is
          // ignored rather than resurrecting a corpse.
          deadWorkers.add(worker)
          workers.delete(worker)
          const idx = idleWorkers.indexOf(worker)
          if (idx !== -1) idleWorkers.splice(idx, 1)

          // A worker that dies before it ever signalled `ready` is a STARTUP
          // failure. Without this the restart cap could never be reached (see
          // readyWorkers): the counter only advanced from the startup watchdog,
          // which clearStartupTimer above has just disarmed for exactly this
          // worker, and from the warmup send. A runtime that crashes on boot
          // therefore forked replacements forever with nothing parsed and nothing
          // reported. Counted before the replacement decision below, so that
          // decision sees the failure it is deciding about.
          if (!readyWorkers.has(worker)) countStartupFailure(worker)
          readyWorkers.delete(worker)

          pendingBatches.forEach((batch, batchId) => {
            if (batch.worker === worker) {
              log.warn("Worker died unexpectedly during batch", { batchId, code, signal })
              handleWorkerTimeout(worker, batchId)
            }
          })

          if (workers.size < numWorkers && (fileQueue.length > 0 || pendingBatches.size > 0)) {
            // M21.W1 restart cap: if startup has failed more than a full pool's
            // worth of attempts, the worker runtime is broken — stop spawning
            // replacements and fail the remaining queue visibly instead of
            // looping forever with zero progress.
            if (startupFailures > MAX_STARTUP_FAILURES) {
              log.error("worker pool startup repeatedly failed — failing remaining files", {
                startupFailures,
                queued: fileQueue.length,
              })
              failRemainingAsStartup()
            } else {
              // Spawn replacement immediately — do NOT use setTimeout.
              // If the event loop is blocked by a DB transaction (flushDbBatch),
              // the timer never fires and the pool permanently stalls.
              createWorker(Date.now())
              scheduleNext()
            }
          } else {
            scheduleNext()
          }
        } catch (err) {
          log.error("Error in worker exit handler", { error: err })
          scheduleNext()
        }
      })

      // Same class of hazard as the dispatch path: this send can also hit a
      // channel that closed during startup. It is wrapped for the same reason —
      // an unhandled 'error' event here kills the process rather than the worker.
      try {
        worker.send({ type: "warmup", workerId })
      } catch (err: any) {
        log.warn("warmup send failed; treating the worker as dead", { workerId, error: String(err?.message ?? err) })
        deadWorkers.add(worker)
        countStartupFailure(worker)
        try { worker.kill("SIGKILL") } catch {}
        if (fileQueue.length > 0) scheduleNext()
      }
    }

    function scheduleNext() {
      if (fileQueue.length === 0 && pendingBatches.size === 0) {
        clearInterval(stallTimer)
        // The pool's own accounting, so a run can be read for what the watchdog
        // did rather than only for how long it took: kills are work lost, and
        // deferrals are kills that the stall detector prevented. Logged ONCE —
        // scheduleNext reaches this branch on every pass.
        if (!poolCompletionLogged) {
          poolCompletionLogged = true
          log.info("worker pool complete", {
            files: files.length,
            workers: numWorkers,
            workerKills,
            watchdogDeferrals,
            parentStalledMs: stalledTotalMs,
          })
        }
        workers.forEach((w) => w.kill())
        if (pendingDbBatch.length > 0) {
          dbPromises.push(flushDbBatch(pendingDbBatch))
          pendingDbBatch = []
        }
        Promise.all(dbPromises).then((storedStats) => {
          const finalStored: {
            symbols: number
            relationships: number
            imports: number
            failed?: boolean
            storeFailures?: number
            storeFailureFiles?: number
          } = {
            symbols: 0,
            relationships: 0,
            imports: 0,
            storeFailures: 0,
            storeFailureFiles: 0,
          }
          for (const s of storedStats) {
            // FIX: Handle failed batches - don't add negative values
            if (s.failed) {
              log.error("a batch failed to store, some files may be missing from DB", {
                symbols: s.symbols,
                relationships: s.relationships,
              })
              finalStored.storeFailures! += s.rolledBackBatches ?? 1
              finalStored.storeFailureFiles! += s.rolledBackFiles ?? 0
              continue
            }
            // Rolled-back batches inside an otherwise successful call: counted, not
            // swallowed. These files are absent from the index, and the run has to be
            // able to say so instead of reporting a clean "complete".
            finalStored.storeFailures! += s.rolledBackBatches ?? 0
            finalStored.storeFailureFiles! += s.rolledBackFiles ?? 0
            finalStored.symbols += s.symbols
            finalStored.relationships += s.relationships
            finalStored.imports += s.imports
          }
          ;(results as any)._dbStats = finalStored
          resolve(results)
        })
        return
      }

      while (idleWorkers.length > 0 && fileQueue.length > 0) {
        // M21.R3: stop dispatching new batches once aborted; queued files are
        // dropped (they were never parsed or stored, so resume re-discovers
        // them via the normal incremental path).
        if (aborted()) {
          for (const f of fileQueue.splice(0)) {
            results.push({ filePath: f, success: false, error: "cancelled by user" })
          }
          // M21.R3: if no batch is in flight either, no future worker message
          // will re-enter scheduleNext — the completion branch (which kills the
          // workers, flushes the DB, and resolves) would never run and the pool
          // would hang forever. Trigger it now.
          if (pendingBatches.size === 0) scheduleNext()
          break
        }
        const worker = idleWorkers.shift()!
        // A worker can die between being pooled and being dispatched. The splice
        // in the `exit` handler cannot help here: the worker is already out of
        // `idleWorkers`, so there is nothing left to remove and the send below
        // would raise EPIPE on a closed IPC channel — which, on a ChildProcess
        // with no 'error' listener, terminates the process.
        if (deadWorkers.has(worker) || worker.exitCode !== null || worker.killed) {
          log.warn("skipping a dead worker during dispatch", { batchId: ++batchCounter })
          deadWorkers.delete(worker)
          scheduleNext()
          return
        }
        const batchFiles = fileQueue.splice(0, batchSize)
        const batchId = ++batchCounter

        pendingBatches.set(batchId, {
          files: batchFiles,
          worker,
          timeout: setTimeout(() => handleWorkerTimeout(worker, batchId), timeoutMs),
          attempts: 1,
          deferrals: 0,
        })

        // RESOLVED 2026-10-02 (branch consolidation): a UNION.
        //   local  -- adds `projectIndexes` to the parse_batch payload, omitted
        //            entirely when no project index was built so every other
        //            language keeps a byte-identical message shape.
        //   remote -- wraps the send in try/catch and treats a late channel
        //            close as the worker death it is, requeueing the batch
        //            instead of throwing out of the scheduler.
        // Both are kept: the hardened send, carrying the new payload field.
        try {
          worker.send({
            type: "parse_batch",
            batchId,
            files: batchFiles,
            projectPath,
            ...(projectIndexes !== undefined ? { projectIndexes } : {}),
          })
        } catch (err: any) {
          // The send can still fail after the liveness checks -- the channel can
          // close between them. Treat it as the worker death it is: drop the
          // batch, requeue its files, and carry on.
          log.warn("send to worker failed; treating the worker as dead", { batchId, error: String(err?.message ?? err) })
          deadWorkers.add(worker)
          const batch = pendingBatches.get(batchId)
          pendingBatches.delete(batchId)
          if (batch) clearTimeout(batch.timeout)
          for (const f of batchFiles) {
            const retries = (fileRetries.get(f) || 0) + 1
            if (retries > MAX_FILE_RETRIES) {
              results.push({ filePath: f, success: false, error: "Max retries exceeded (send failed)" })
              processed++
            } else {
              fileRetries.set(f, retries)
              fileQueue.unshift(f)
            }
          }
          try { worker.kill("SIGKILL") } catch {}
          if (workers.size < numWorkers && fileQueue.length > 0) createWorker(Date.now())
          scheduleNext()
        }
      }
    }

    for (let i: any = 0; i < numWorkers; i++) {
      createWorker(i)
    }
  })
}

// ============================================================================
// DATABASE STORAGE
// ============================================================================

const fileRelCounters = new Map<string, number>()

// ============================================================================
// BACKGROUND SEMANTIC EMBEDDING QUEUE (module-level, serialized)
// Embeddings must never block indexing, and they must never accumulate
// unbounded memory on huge corpora. All storeResults calls share one queue
// drained by a single background loop with a total-item cap; overflow batches
// are dropped with a warning (they can be re-embedded later via `bb index --force`).
// ============================================================================
interface BackgroundEmbedJob {
  projectId: ProjectID
  projectPath: string
  items: any[]
}
const backgroundEmbedJobs: BackgroundEmbedJob[] = []
let backgroundEmbedActive = false
let backgroundEmbedQueuedItems = 0
let embeddingFlushWaiters: Array<() => void> = []

/**
 * How much background embedding work is still queued.
 *
 * The drainer keeps the event loop alive until its queue empties, so a command
 * that has already printed its index summary can sit silent for as long as the
 * provider takes — measured 2026-10-08: a 427 s index followed by ~10 minutes of
 * no output at all, which reads exactly like a hang (and bb's own closing line
 * invites reporting a perceived hang). Exported so a CLI can say what it is
 * waiting for instead of leaving the user to guess.
 */
export function pendingEmbeddingCount(): number {
  return backgroundEmbedQueuedItems
}
const EMBED_QUEUE_ITEM_CAP = Number(process.env.BB_EMBEDDING_QUEUE_LIMIT || 25000)

// M21.E2: production counters for the embedding queue lifecycle. These are
// exported so run summaries, `bb status`, and verifiers can report what the
// queue actually did (embedded vs dropped vs failed vs fallback) instead of
// claiming success for work that never happened.
// M21.E2 deep-audit: a provider call that never resolves (network hang,
// wedged server) must not permanently wedge the background drainer — the
// bounded flush only protects the CALLER's wait, not the drainer itself.
// Each chunk's embedMany call is raced against this bound; a timeout is a
// provider failure (routes to the TF-IDF fallback with honest accounting).
const EMBED_CALL_TIMEOUT_MS = Number(process.env.BB_EMBEDDING_CALL_TIMEOUT_MS || 60_000)
function withTimeout<T>(p: Promise<T> | T, ms: number, msg: string): Promise<T> {
  // Promise.resolve mirrors `await` semantics: a provider that returns a plain
  // value instead of a promise is treated as an immediately-resolved result.
  const q = Promise.resolve(p)
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    q.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/**
 * Which embedding models does this index actually hold?
 *
 * A mixed-model index is producible in a single run: when the provider dies
 * partway, earlier chunks were written under the API model and later ones under
 * the local fallback. Measured: 100 rows `mock-1536d`/1536 alongside 160 rows
 * `local-word-vectors-v3`/50 in one index.
 *
 * This is not prevented, because each vector is individually valid for its own
 * model — a per-vector check cannot detect a cross-vector inconsistency. It is
 * MEASURED and reported instead, because `bb_ask` reads the index under a single
 * model label: the other model's vectors stop being found, and without this
 * number nothing on screen says why results got worse.
 */
export async function surveyEmbeddingModels(
  projectId: ProjectID,
): Promise<Array<{ model: string; dimension: number; count: number }>> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    return raw
      .prepare(
        `SELECT embedding_model AS model, vector_dimension AS dimension, COUNT(*) AS count
         FROM brain_semantic_embedding
         WHERE project_id = ?
         GROUP BY embedding_model, vector_dimension
         ORDER BY count DESC`,
      )
      .all(projectId) as Array<{ model: string; dimension: number; count: number }>
  } catch (e: any) {
    log.warn("could not survey embedding models", { error: e?.message })
    return []
  }
}

/**
 * Census the actual vectors, not the numbers that describe them.
 *
 * `brain_semantic_embedding.vector_dimension` is written as `vec.length`, so it
 * is self-describing and cannot detect a corrupt row. This walks the stored
 * vectors instead:
 *
 *   - observed length vs declared `vector_dimension` -> dimension mismatch
 *   - a vector that does not scan to finite numbers   -> malformed
 *
 * The malformed check is not theoretical: a non-finite component makes every
 * downstream cosine NaN, and the read path filters NaN — so such a row is
 * counted in `total` and in coverage while being unreachable by search.
 *
 * Bounded on purpose. A project with 500k vectors cannot afford to JSON.parse
 * all of them on every run, so above `MAX_INTEGRITY_SCAN_VECTORS` this reports
 * what it measured and sets `scanned`/`truncated` so a caller can say the census
 * is partial rather than implying full coverage.
 */
const MAX_INTEGRITY_SCAN_VECTORS = 50_000

export async function surveyEmbeddingIntegrity(projectId: ProjectID): Promise<{
  total: number
  models: Array<{ model: string; rows: number; dimensions: number[] }>
  mixed: boolean
  dimensionMismatches: number
  malformedVectors: number
  unusableEmbeddings: number
  scanned: number
  truncated: boolean
}> {
  const empty = {
    total: 0,
    models: [],
    mixed: false,
    dimensionMismatches: 0,
    malformedVectors: 0,
    unusableEmbeddings: 0,
    scanned: 0,
    truncated: false,
  }
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const total = Number(
      (raw
        .prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ?")
        .get(projectId) as any)?.c ?? 0,
    )

    // Per-model row counts and declared dimensions, straight from SQL.
    const byModel = raw
      .prepare(
        `SELECT embedding_model AS model, COUNT(*) AS rows, vector_dimension AS declared
         FROM brain_semantic_embedding WHERE project_id = ?
         GROUP BY embedding_model, vector_dimension`,
      )
      .all(projectId) as Array<{ model: string; rows: number; declared: number }>

    const models = new Map<string, { model: string; rows: number; dimensions: number[] }>()
    for (const r of byModel) {
      const cur = models.get(r.model) ?? { model: r.model, rows: 0, dimensions: [] }
      cur.rows += r.rows
      models.set(r.model, cur)
    }

    // Now actually look at the vectors, within a bounded scan.
    const limit = Math.min(total, MAX_INTEGRITY_SCAN_VECTORS)
    const rows = raw
      .prepare(
        `SELECT embedding_model AS model, embedding_vector AS vec, vector_dimension AS declared
         FROM brain_semantic_embedding WHERE project_id = ? LIMIT ?`,
      )
      .all(projectId, limit) as Array<{ model: string; vec: string | null; declared: number | null }>

    let dimensionMismatches = 0
    let malformedVectors = 0

    for (const r of rows) {
      let observed: number | null = null
      let ok = true
      if (r.vec) {
        try {
          const parsed = JSON.parse(r.vec)
          if (Array.isArray(parsed)) {
            observed = parsed.length
            for (const v of parsed) {
              if (typeof v !== "number" || !Number.isFinite(v)) {
                ok = false
                break
              }
            }
          } else {
            ok = false
          }
        } catch {
          ok = false
        }
      } else {
        ok = false
      }

      const entry = models.get(r.model)
      if (entry && observed !== null && !entry.dimensions.includes(observed)) {
        entry.dimensions.push(observed)
      }
      if (!ok) malformedVectors++
      if (observed !== null && r.declared !== null && observed !== r.declared) {
        dimensionMismatches++
      }
    }

    const modelList = [...models.values()]
      .map((m) => ({ model: m.model, rows: m.rows, dimensions: m.dimensions.sort((a, b) => a - b) }))
      .sort((a, b) => b.rows - a.rows)

    return {
      total,
      models: modelList,
      mixed: modelList.length > 1,
      dimensionMismatches,
      malformedVectors,
      // A row can be both (wrong length AND non-finite), so count the union:
      // "unusable" is a count of rows, not of findings.
      unusableEmbeddings: rows.length - rows.filter((r) => {
        try {
          const p = JSON.parse(r.vec as string)
          if (!Array.isArray(p)) return false
          if (r.declared !== null && p.length !== r.declared) return false
          return p.every((v) => typeof v === "number" && Number.isFinite(v))
        } catch {
          return false
        }
      }).length,
      scanned: rows.length,
      truncated: total > limit,
    }
  } catch (e: any) {
    log.warn("could not survey embedding integrity", { error: e?.message })
    return empty
  }
}

/**
 * The pool numbers this run adds to the persisted summary.
 *
 * `BrainDatabase.IndexPerformanceStats["runs"][number]` declares exactly five keys
 * (database.ts:284-290) and this is a sixth, so the object literal below was
 * rejected for a property the type did not know about. The key IS written to the
 * JSON column and IS read back by nothing — `dbFlushMs` duplicates `phases`, and
 * the other four are pool counters that `phases` omits.
 *
 * Declared here rather than cast at the call site, because a cast would only
 * silence the check; naming the shape states what is actually persisted. The
 * honest long-term fix is one of:
 *
 *   - add `poolTelemetry?: {...}` to `IndexPerformanceStats` in
 *     src/brain/database.ts (one line, keeps the data), or
 *   - drop the key, since nothing consumes it.
 *
 * Neither is this file's to decide — the first belongs to database.ts, the second
 * changes persisted output. Kept as-is, typed honestly, until then.
 */
type PersistedRun = BrainDatabase.IndexPerformanceStats["runs"][number] & {
  poolTelemetry?: {
    dbFlushMs: number
    retries: number
    workerCount: number
    workerStartupFailures: number
    poisonFiles: number
  }
}

/**
 * Render the integrity census through the indexer's logger.
 *
 * Shared by both summary paths (derived-pass and no-op incremental) and used
 * instead of two inline copies, so the logger and the CLI cannot drift into
 * reporting different things about the same index. Silent when healthy.
 */
function reportEmbeddingIntegrity(
  _log: { log: (s: string) => void },
  // `IndexStatsSummary["embeddingIntegrity"]`, NOT `ReturnType<typeof
  // surveyEmbeddingIntegrity>` — the parameter type was derived from the
  // PRODUCER, which always sets both fields, while the argument is often the
  // value READ BACK from `performanceStats`, where a run persisted before those
  // fields existed genuinely lacks them. The producer's return type therefore
  // promised something the read path cannot deliver.
  //
  // The body already knew: it tests `if (integ.truncated)` and prints
  // `integ.scanned ?? 0`. Those are not defensive noise — they are the code
  // this signature was written for, and the annotation was the part that was
  // wrong.
  integ: NonNullable<ParallelIndexingStats["summary"]>["embeddingIntegrity"],
): void {
  if (!integ || (integ.models.length <= 1 && integ.unusableEmbeddings === 0)) return
  if (integ.mixed) {
    _log.log(
      `  ⚠ index holds ${integ.models.length} embedding models — search compares only one, so the rest are ignored:`,
    )
    for (const m of integ.models) {
      _log.log(
        `      ${m.model}: ${m.rows.toLocaleString()} vectors (observed dims ${m.dimensions.join(", ")})`,
      )
    }
  }
  if (integ.unusableEmbeddings > 0) {
    _log.log(
      `  ⚠ ${integ.unusableEmbeddings} of ${integ.total.toLocaleString()} vectors are unusable ` +
        `(${integ.dimensionMismatches} dimension mismatch, ${integ.malformedVectors} malformed) — ` +
        `counted as coverage, unreachable by search`,
    )
    _log.log(`      fix: reindex with a single provider — bb index --force`)
  }
  if (integ.truncated) {
    _log.log(
      `      (integrity census sampled ${(integ.scanned ?? 0).toLocaleString()} of ${integ.total.toLocaleString()} vectors)`,
    )
  }
}

export const backgroundEmbedMetrics = {
  // M40.A9: verifier-only observability for the background queue (read by
  // script/m21 gates). Product code consumes queue state via DB rows, not
  // this counter object. Keep exported; do not call from product paths.
  //
  // CORRECTION (launch-readiness): that "verifier-only" framing is why a run
  // could fail to embed every vector and still print "✓ indexed N files" —
  // these numbers were accumulated and read by nothing a user sees. They are
  // now copied onto the run summary (`summary.embedOutcome`) and printed by
  // the CLI, because an embedding outage that is invisible is indistinguishable
  // from an index that succeeded.
  /** Items accepted into the queue (cap-permitting). */
  queued: 0,
  /** Items dropped because the queue cap or batch limit was hit. */
  dropped: 0,
  /** Items embedded via the real provider. */
  embedded: 0,
  /** Items written via the TF-IDF fallback after a provider failure. */
  fallback: 0,
  /** Items whose provider attempt AND fallback both failed. */
  failed: 0,
  /** Vectors the provider RETURNED that were unusable and were discarded at the
   *  write boundary: empty, not an array, or containing a non-finite component.
   *  A distinct fault from `failed` (which is "nothing came back") because the
   *  cause and the fix differ — this one points at a malformed provider response
   *  or a corrupt upstream, not at connectivity. */
  invalid: 0,
  /** Jobs skipped entirely because the project/db was removed. */
  skipped: 0,
}

/**
 * Await completion of all queued background embedding jobs, with a deadline.
 * Returns when the queue is fully drained and idle, OR when the timeout
 * expires (resolve="timeout") — a timed-out flush leaves embeddings PARTIAL,
 * which callers must report honestly rather than claiming durability.
 * Note: the queue is shared process-wide, so this waits for every project's
 * queued jobs, not just the caller's. Used by tests and tools that need
 * semantic vectors durable before reading them back (verify-embed,
 * verify-semantic).
 */
export async function flushBackgroundEmbeddings(opts: { timeoutMs?: number } = {}): Promise<{ resolved: "drained" | "timeout"; pendingItems: number }> {
  // M40.A9: no production caller BY DESIGN — the background queue drains
  // itself on its own loop; this is the deterministic-drain seam for
  // verifier/e2e harnesses (script/m18, script/m21) that must await
  // embedding durability. Keep exported; do not call from product paths.
  const deadline = opts.timeoutMs && opts.timeoutMs > 0 ? Date.now() + opts.timeoutMs : undefined
  while (backgroundEmbedActive || backgroundEmbedJobs.length > 0) {
    if (deadline !== undefined && Date.now() >= deadline) {
      return { resolved: "timeout", pendingItems: backgroundEmbedQueuedItems }
    }
    const wait = deadline !== undefined
      ? new Promise<void>((resolve) => {
          const t = setTimeout(() => resolve(), Math.max(1, deadline - Date.now()))
          embeddingFlushWaiters.push(() => { clearTimeout(t); resolve() })
        })
      : new Promise<void>((resolve) => embeddingFlushWaiters.push(resolve))
    await wait
  }
  return { resolved: "drained", pendingItems: 0 }
}

function queueBackgroundEmbeddings(projectId: ProjectID, projectPath: string, items: any[]) {
  if (items.length === 0) return
  const embedBatchLimit = Number(process.env.BB_EMBEDDING_BATCH_LIMIT || 50000)
  if (items.length >= embedBatchLimit) {
    log.debug("skipping embeddings for oversized batch", { count: items.length, limit: embedBatchLimit })
    return
  }
  if (backgroundEmbedQueuedItems + items.length > EMBED_QUEUE_ITEM_CAP) {
    // Debug level: a saturated queue drops batches on huge corpora and this
    // would otherwise spam warns (hundreds per full index). The behavior is
    // documented in EMBEDDINGS.md; vectors are recoverable via `bb index --force`.
    log.debug("embedding queue at capacity — batch dropped (re-embed later with bb index --force)", {
      queued: backgroundEmbedQueuedItems,
      dropped: items.length,
      cap: EMBED_QUEUE_ITEM_CAP,
    })
    backgroundEmbedMetrics.dropped += items.length
    return
  }
  backgroundEmbedQueuedItems += items.length
  backgroundEmbedMetrics.queued += items.length
  // Keep project identity, not a live SQLite handle. A caller may close or
  // remove a project while this non-blocking queue is draining.
  backgroundEmbedJobs.push({ projectId, projectPath, items })
  if (!backgroundEmbedActive) {
    backgroundEmbedActive = true
    setImmediate(() => {
      drainBackgroundEmbeddings().catch((e: any) =>
        log.warn("background embedding drainer failed", { error: e?.message }),
      )
    })
  }
}

async function drainBackgroundEmbeddings() {
  try {
    while (backgroundEmbedJobs.length > 0) {
      const job = backgroundEmbedJobs.shift()!
      backgroundEmbedQueuedItems -= job.items.length
      // M21.E2 deep-audit: `accounted` tracks how many items of THIS job have
      // already exited through a metric (embedded/failed). Every terminal path
      // below counts only the UNACCOUNTED remainder, so the conservation
      // invariant (queued == embedded + dropped + failed + fallback + skipped)
      // holds even when a job is interrupted mid-way (provider throw after
      // partial embedding, project removal between chunks).
      let accounted = 0
      try {
        const { existsSync } = await import("node:fs")
        const dbPath = BrainDatabase.getDbPath(job.projectId)
        // A removed project must not be recreated by the background worker.
        // This is the lifecycle boundary that prevents stale writes after
        // temporary-project cleanup or an explicit project deletion.
        if (!existsSync(job.projectPath) || !existsSync(dbPath)) {
          log.debug("dropping embeddings for removed project", { projectId: job.projectId })
          backgroundEmbedMetrics.skipped += job.items.length
          accounted = job.items.length
          continue
        }

        const { SemanticEngine } = await import("../brain/semantic/engine")
        const { Instance } = await import("../project/instance")
        const { createHash } = await import("crypto")
        let rawDb = await BrainDatabase.getRawInstance(job.projectId)
        // M50.A2 (#764): dense vectors are written as JSON (source of truth)
        // AND as a little-endian float32 blob (read accelerator).
        let insertEmbed = rawDb.prepare(`
          INSERT OR REPLACE INTO brain_semantic_embedding
          (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const maxBatch = 100
        for (let j = 0; j < job.items.length; j += maxBatch) {
          const chunk: any[] = job.items.slice(j, j + maxBatch)
          const docs = chunk.map((i: any) => i.snippet)

          const embeddings: any = await Instance.provide({
            directory: job.projectPath,
            fn: () => withTimeout(
              // The project id matters for the LOCAL model: it selects the
              // project's vocabulary, so the identifiers inside a snippet
              // contribute the same words a query naming that symbol will.
              // Word vectors are position-independent, so both sides sharing a
              // vocabulary is a pure coverage increase rather than a change of
              // vector space — see local-embed.ts `wordVector`.
              SemanticEngine.embedMany(docs, job.projectId),
              EMBED_CALL_TIMEOUT_MS,
              `embedding provider call exceeded ${EMBED_CALL_TIMEOUT_MS}ms bound`,
            ),
          })
          // M21.E2: an empty result is a provider failure, not a success.
          // SemanticEngine.embedMany returns [] once both the API and the
          // local model are unavailable; an empty array is truthy, so the old
          // truthiness guard on the result never fired and every item in the
          // batch was silently dropped — no TF-IDF fallback, no accounting.
          // Throwing routes the batch into the fallback path below, where it
          // gets tfidf-v1 vectors and honest `fallback`/`failed` counters.
          if (!embeddings || embeddings.length === 0) {
            throw new Error("embedding provider returned no vectors")
          }

          const modelLabel = SemanticEngine.getLastEmbeddingModel()
          // Reopen after provider latency if a caller closed the project DB.
          // Never use a handle captured by storeResults.
          if (!existsSync(job.projectPath) || !existsSync(dbPath)) {
            log.debug("dropping embeddings after project removal", { projectId: job.projectId })
            backgroundEmbedMetrics.skipped += job.items.length - accounted
            accounted = job.items.length
            break
          }
          rawDb = await BrainDatabase.getRawInstance(job.projectId)
          insertEmbed = rawDb.prepare(`
            INSERT OR REPLACE INTO brain_semantic_embedding
            (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, embedding_blob, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          let missingInChunk = 0
          // Vectors that ARRIVED but are unusable (empty, non-array, or holding
          // a non-finite component). Counted separately from `missing` so a
          // malformed-provider response is distinguishable from a short result —
          // they have different causes and different fixes.
          let invalidInChunk = 0
          const txEmbed = rawDb.transaction((rows: any) => {
            for (let k = 0; k < rows.length; k++) {
              const item = chunk[k]
              const vec = embeddings[k]
              // M21.E2: a missing vector inside a non-empty result is a
              // partial provider failure — accounted as `failed`, never
              // silently skipped. Counts are applied AFTER the transaction
              // commits so a rolled-back batch is never counted as embedded.
              if (!vec) { missingInChunk++; continue }
              // Validate the vector before it becomes a stored claim.
              //
              // `vector_dimension` is written as `vec.length`, so a malformed
              // vector records a dimension that describes itself — the row then
              // looks internally consistent while the bytes are wrong. Nothing
              // downstream re-derives the true length, and the read path admits
              // a blob only at the exact byte length, so a bad vector surfaces
              // much later as a silently missing row rather than at the write.
              //
              // Co-agent 2 measured the cause: when the provider dies mid-run
              // some chunks are written under the API model and some under
              // `local-word-vectors-v3`, so ONE index can hold vectors of
              // different dimensions and different vector spaces. Per-vector
              // validation cannot prevent that (each vector is valid for its own
              // model); it prevents the corrupt-vector case, which it can.
              if (!Array.isArray(vec) || vec.length === 0) {
                invalidInChunk++
                continue
              }
              // A non-finite component makes every downstream cosine NaN, which
              // the read path filters — so the vector silently disappears from
              // results while the row claims a dimension.
              let hasNonFinite = false
              for (let j = 0; j < vec.length; j++) {
                if (typeof vec[j] !== "number" || !Number.isFinite(vec[j])) {
                  hasNonFinite = true
                  break
                }
              }
              if (hasNonFinite) {
                invalidInChunk++
                continue
              }
              const contentHash = createHash("sha256").update(item.snippet).digest("hex")
              insertEmbed.run(
                `${item.symbolId}:embed`,
                job.projectId,
                item.symbolId,
                item.kind || "symbol",
                modelLabel,
                JSON.stringify(vec),
                // Dense numeric vectors only; encodeVectorBlob is a byte copy of
                // the same numbers, so JSON stays the source of truth.
                encodeVectorBlob(vec),
                vec.length,
                contentHash,
                JSON.stringify({ name: item.name, kind: item.kind }),
                0.7,
                Date.now(),
                Date.now(),
                Date.now(),
              )
            }
          })
          try {
            txEmbed(chunk)
            // `embedded` must count only vectors actually stored. Skipping
            // invalidInChunk here would report a corrupt vector as a success,
            // and the index would claim coverage it does not have.
            backgroundEmbedMetrics.embedded += chunk.length - missingInChunk - invalidInChunk
            backgroundEmbedMetrics.failed += missingInChunk + invalidInChunk
            if (invalidInChunk > 0) {
              backgroundEmbedMetrics.invalid += invalidInChunk
              log.warn("discarded malformed embedding vectors", {
                projectId: job.projectId,
                count: invalidInChunk,
                model: modelLabel,
              })
            }
            accounted += chunk.length
          } catch (txErr: any) {
            // Transaction rolled back: nothing durable was written for this
            // chunk. Count the whole chunk as failed (honest) and let the
            // outer catch fall back for the UNACCOUNTED remainder only.
            backgroundEmbedMetrics.failed += chunk.length
            accounted += chunk.length
            throw txErr
          }
        }
        log.debug("background embedding pass completed", { embedded: accounted })
      } catch (e: any) {
        log.warn("background semantic embedding failed", { error: e?.message })
        // Fall back to TF-IDF for the unaccounted remainder of the batch.
        // Items already embedded/failed in committed chunks must not be
        // re-processed (that would double-count AND write duplicate
        // :embed/:tfidf rows for the same symbol).
        try {
          const { createHash } = await import("crypto")
          const { existsSync } = await import("node:fs")
          if (!existsSync(job.projectPath) || !existsSync(BrainDatabase.getDbPath(job.projectId))) {
            log.debug("dropping fallback embeddings for removed project", { projectId: job.projectId })
            backgroundEmbedMetrics.skipped += job.items.length - accounted
            accounted = job.items.length
            continue
          }
          const fallbackDb = await BrainDatabase.getRawInstance(job.projectId)
          const tfidfInsert = fallbackDb.prepare(`
            INSERT OR REPLACE INTO brain_semantic_embedding
            (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (let k = accounted; k < job.items.length; k++) {
            const item = job.items[k]
            const tokens = tokenizeCodeForEmbedding(item.snippet, item.name)
            // A symbol with no tokenizable content exits the queue as
            // `skipped` — it must still be counted (conservation), it is
            // just not a failure.
            if (tokens.length === 0) { backgroundEmbedMetrics.skipped++; continue }
            backgroundEmbedMetrics.fallback++
            const contentHash = createHash("sha256").update(item.snippet).digest("hex")
            tfidfInsert.run(
              `${item.symbolId}:tfidf`, job.projectId, item.symbolId, item.kind || "symbol",
              "tfidf-v1", JSON.stringify(tokens), tokens.length, contentHash,
              JSON.stringify({ name: item.name, kind: item.kind }), 0.15, Date.now(), Date.now(), Date.now(),
            )
          }
          accounted = job.items.length
        } catch (fallbackErr: any) {
          log.warn("TF-IDF fallback also failed", { error: fallbackErr?.message })
          backgroundEmbedMetrics.failed += job.items.length - accounted
          accounted = job.items.length
        }
      }
      // Yield to the event loop between jobs so the indexer is never starved.
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    backgroundEmbedActive = false
    // Race guard: a job queued while the loop was finishing.
    if (backgroundEmbedJobs.length > 0) {
      backgroundEmbedActive = true
      setImmediate(() => {
        drainBackgroundEmbeddings().catch((e: any) =>
          log.warn("background embedding drainer failed", { error: e?.message }),
        )
      })
    }
    // Wake flushBackgroundEmbeddings awaiters; they re-check the idle
    // condition in a loop, so a re-activated drainer is still awaited.
    const waiters = embeddingFlushWaiters
    embeddingFlushWaiters = []
    for (const w of waiters) w()
  }
}

// ── HOISTED FOR THE ID-CARRYING JOIN (r-lane, 2026-10-12) ─────────────────────────────────────────
// These two were inline inside `storeResults`. They are MUTATION-FREE — every use is a read
// (`CONTAINER_TYPES_LOOKUP.has`, `CONTAINER_PRIORITY[…]`) — so hoisting them is a pure move and the
// store's counts cannot change. They are hoisted because the companion pass needs the SAME span index
// the store builds: "one computation, one answer" means one implementation with two callers, not two
// implementations that agree. Hoisting the MUTABLE state is a different matter and is NOT done here
// (see the denylist note at the span-index construction).
const CONTAINER_TYPES_LOOKUP = new Set([
  "class", "interface", "struct", "trait", "enum", "object", "actor",
  "module", "namespace", "package", "impl", "type",
])

/** Container kinds sort first (class, interface, …) so FK references from methods to their containers
 *  resolve. Read-only, hoisted with the set above. */
const CONTAINER_PRIORITY: Record<string, number> = {
  class: 0, interface: 0, struct: 0, trait: 0, enum: 0, object: 0,
  module: 0, namespace: 0, package: 0, impl: 0, type: 0,
  method: 1, function: 1, constructor: 1, field: 2, property: 2,
  variable: 2,
}

/** The span index the store builds over a file's STOREABLE symbols. `start`/`end` are 1-based lines.
 *  Hoisted so the companion pass can build the SAME index the store builds — one implementation, two
 *  callers. The array is sorted by `start` ascending; the scans below rely on that. */
export type StoreableSpan = { id: string; name: string; start: number; end: number; kind: string }

/** The innermost storeable span whose extent covers `line`. A BACKWARD SCAN, not a predicate: the pass
 *  re-parses the same file, gets the same symbols, and FINDS the same span. */
export function enclosingSpanId(spans: StoreableSpan[], line: number | null): string | null {
  if (!line || line < 1) return null
  for (let i = spans.length - 1; i >= 0; i--) {
    const sp = spans[i]
    if (sp.start > line) continue
    if (sp.end >= line) return sp.id
  }
  return null
}

/** The innermost STOREABLE span carrying this NAME whose extent covers `line`. Same-name candidates are
 *  FIRST-WINS in the in-memory lookups, so the containment rule replaces them with the innermost. */
export function enclosingSpanIdByName(spans: StoreableSpan[], name: string, line: number | null): string | null {
  if (!name || !line || line < 1) return null
  for (let i = spans.length - 1; i >= 0; i--) {
    const sp = spans[i]
    if (sp.name !== name) continue
    if (sp.start > line) continue
    if (sp.end >= line) return sp.id
  }
  return null
}

/** The nearest enclosing span that is NOT a container and is not the span itself. */
export function enclosingNonContainerId(
  spans: StoreableSpan[],
  start: number,
  end: number,
  selfId: string,
): string | null {
  if (start < 1) return null
  for (let i = spans.length - 1; i >= 0; i--) {
    const sp = spans[i]
    if (sp.id === selfId) continue
    if (sp.start >= start) continue
    if (sp.end < end) continue
    if (CONTAINER_TYPES_LOOKUP.has(sp.kind)) continue
    return sp.id
  }
  return null
}

/** Build the span index for one file's symbols. INCLUDES THE SORT: a caller that skips it changes every
 *  scan result, and the sort is part of the construction rather than an optimisation.
 *  `isStoreable` IS A PARAMETER ON PURPOSE — see the denylist note at the call site: the name filter is
 *  per-call mutable state and must not be read from module scope. */
export function buildStoreableSpans(
  symbols: any[],
  fileId: string,
  isStoreable: (nm: string | undefined, startLine: number) => boolean,
): StoreableSpan[] {
  const out: StoreableSpan[] = []
  for (const s of symbols ?? []) {
    const sStart = s.startLine ?? s.range?.startLine ?? 0
    const sEnd = s.endLine ?? s.range?.endLine ?? sStart
    if (sStart < 1) continue
    if (!isStoreable(s.name, sStart)) continue
    out.push({
      id: `${fileId}:${s.name}:${sStart}`,
      name: String(s.name || ""),
      start: sStart,
      end: Math.max(sEnd, sStart),
      kind: String(s.type || s.kind || "unknown"),
    })
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

export async function storeResults(
  projectId: ProjectID,
  projectPath: string,
  results: FileResult[],
  options: { skipResolution?: boolean } = {},
): Promise<{
  symbols: number
  relationships: number
  imports: number
  /** Batches that rolled back during this call — their files are NOT in the index. */
  rolledBackBatches?: number
  /** How many files those rolled-back batches carried (an upper bound on the loss). */
  rolledBackFiles?: number
}> {
  let totalSymbols = 0
  let totalRelationships = 0
  let totalImports = 0
  // A rollback used to be swallowed: the batch was skipped, a line went to stderr, and
  // the run went on to report success with a status of "complete". Measured consequence:
  // a full disk (or any constraint failure) produced `✓ indexed N files` with N silently
  // smaller and nothing in the persisted status to say so. The counters below are how
  // that becomes a fact the run can report.
  let rolledBackBatches = 0
  let rolledBackFiles = 0
  // Test hook, OFF by default and named after the existing worker hooks.
  //
  //   BB_TEST_FAIL_STORE_ONCE=1    the FIRST batch of the first storeResults call throws
  //                                — the rollback that recovery can still rescue.
  //   BB_TEST_FAIL_STORE_ALWAYS=1  EVERY batch throws — the full-disk case, where the
  //                                recovery pass cannot save the run either.
  //
  // Both exercise the rollback path end to end without needing a full disk. Used by
  // script/perf/verify-store-failure-honesty.ts.
  const failOnce = process.env.BB_TEST_FAIL_STORE_ONCE === "1"
  const failAlways = process.env.BB_TEST_FAIL_STORE_ALWAYS === "1"
  // MODULE-level, not per-call: the recovery pass calls storeResults again, and a
  // per-call flag made "fail once" fail once per call — so recovery re-injected and
  // the run lost every file instead of exercising the path where recovery works.
  const injectFailure = () => {
    if (failAlways) return true
    if (failOnce && !(globalThis as any).__bbInjectedStoreFailure) {
      ;(globalThis as any).__bbInjectedStoreFailure = true
      return true
    }
    return false
  }

  const rawDb = await BrainDatabase.getRawInstance(projectId)
  // M54.P1 (#727): FK enforcement is ON at every open AND during the bulk
  // store (the old store-phase "PRAGMA foreign_keys = OFF" was removed when
  // the finally-restore was added; the historical "compiled binary's SQLite
  // can spuriously reject valid data" claim was never reproduced and the
  // full verification suite — P1 parity, m51 A1, m21 R2, m13 H3, m52 V1 —
  // plus the multi-language soak (script/m54/probe-fk-store-soak.ts) runs
  // green with store-phase enforcement active). The finally below restores
  // the open-time policy on every exit; BB_FK_ENFORCE=0 disables enforcement
  // stack-wide (open AND store) for legacy-posture tooling.
  try {
   const now = Date.now()
 
   const semanticBatch: any[] = []
 
   const insertFile = rawDb.prepare(`
     INSERT OR REPLACE INTO brain_file 
     (id, project_id, path, relative_path, file_hash, size_bytes, line_count, last_modified, language, framework_type, has_syntax_errors, error_report, is_test_file, layer, time_created, time_updated, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `)
 
   const insertSymbol = rawDb.prepare(`
     INSERT OR REPLACE INTO brain_symbol
     -- RESOLVED 2026-10-02 (branch consolidation): a UNION, and an ORDERED one.
     -- The local side added super_types; the remote side added source_text.
     -- Both writers exist downstream (the merged .run() below binds 31 values,
     -- verified by parse: docstring, source_text, scope_kind, is_declaration,
     -- super_types, time_created, time_updated). The column list must therefore
     -- carry BOTH columns in exactly that order and VALUES must carry 31
     -- placeholders -- 30 would silently bind every value after source_text to
     -- the wrong column, which is the seam class this INSERT was fixed for.
     (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, byte_start, byte_end, visibility, parameters, return_type, qualified_calls, complexity, api_contract_path, gravity_score, layer, owner_symbol_id, annotations, is_async, is_static, is_abstract, generic_parameters, docstring, source_text, scope_kind, is_declaration, super_types, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `)
 
   const insertImport = rawDb.prepare(`
     INSERT OR REPLACE INTO brain_import
     (id, project_id, file_id, imported_name, imported_as, import_path, import_type, is_external, line_number, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `)
 
   const insertRelationship = rawDb.prepare(`
     INSERT OR IGNORE INTO brain_relationship
     (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external, relationship_type, confidence, context, line_number, is_cross_file, is_cross_language, bridge_mechanism, metadata, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `)
 
   // We are creating a "placeholder" for taint flows directly on the file if they haven't been resolved across files yet.
   // Actually, we can store partial taints right now, where the sink is known and the source is known inside the symbol.
   const insertTaintSource = rawDb.prepare(`
     INSERT OR REPLACE INTO brain_taint_flow
     (id, project_id, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path, cross_language_boundaries, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `)
 
   const deleteFileSymbols = rawDb.prepare(`DELETE FROM brain_symbol WHERE file_id = ?`)
   const deleteFileImports = rawDb.prepare(`DELETE FROM brain_import WHERE file_id = ?`)
   // Co-agent 2 measured this: nothing in src/ ever deleted from
   // brain_semantic_embedding, so a renamed or moved symbol kept a live vector
   // forever (3 embedding rows for 2 live symbols after a rename). The table
   // grows without bound across reindexes and `coverage` counts those orphans,
   // so a health check reports coverage it does not have.
   //
   // Must run BEFORE deleteFileSymbols: it selects the file's symbol ids while
   // they still exist. Ordered after the relationship deletes so nothing is
   // removed out from under a constraint.
   const deleteFileEmbeddings = rawDb.prepare(`
     DELETE FROM brain_semantic_embedding
     WHERE entity_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
   `)
   const deleteFileRelationships = rawDb.prepare(`
     DELETE FROM brain_relationship 
     WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
   `)
   // Also delete relationships from OTHER files that target this file's symbols.
   // Without this, deleteFileSymbols fails with FK violation when cross-file
   // relationships (e.g. calls, uses) still reference symbols being deleted.
   const deleteFileRelationshipsByTarget = rawDb.prepare(`
     DELETE FROM brain_relationship
     WHERE target_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
   `)
   const deleteFileTaints = rawDb.prepare(`
     DELETE FROM brain_taint_flow 
     WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
        OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
   `)
 
   const batchSize = ParallelIndexerConfig.dbBatchSize
 
   // Pre-prepare target resolution statement — reused for every relationship.
   // file_id is needed to compute the honest is_cross_file flag at insert time.
   // M49 #816: proximity-ordered and deterministic. The previous form was
   // `WHERE s.project_id = ? AND s.name = ? LIMIT 1` — no ORDER BY and no
   // language awareness, so among same-named symbols SQLite returned an
   // arbitrary row (row order is not a contract; it changes with inserts,
   // ANALYZE and VACUUM). Measured on a two-file TypeScript project that
   // DECLARES `name` in its own file (src/greeter.ts:name:2 exists as a
   // symbol): `greet --uses--> name` and `Greeter --contains--> name` both
   // resolved to the `name` KEY OF package.json, and were then stamped
   // is_cross_language=1 with bridge mechanism `name-resolution` — so a
   // same-file declared member lost to a JSON manifest key, and the stored
   // graph asserted a cross-language containment that does not exist.
   //
   // Prefer the nearest candidate: same file, then same language, then any;
   // ties broken by id so the same input always yields the same graph.
   //
   // #612: a DEFINITION beats a DECLARATION, ahead of every proximity rule.
   // Proximity alone is wrong in the one case this family exists to measure:
   // `math.c` holds both the CALLER (`main`) and a c prototype
   // (`extern int run_engine(void);`), while the definition lives in
   // `engine.cpp`. Same-file preference picked the prototype in the caller's
   // own file, so the c→cpp edge was stored `is_cross_file = 0`,
   // `is_cross_language = 0` and the M14.0.SC1 family gate could not see a
   // cross-language call that plainly exists. A declaration is a promise, a
   // definition is the thing itself; and when the definition is not in the
   // index at all (a libc prototype, an FFI symbol implemented elsewhere)
   // every candidate is still a declaration, so the remaining rules decide
   // exactly as before. `COALESCE` puts legacy NULL rows in the definition
   // tier — the pre-#612 behaviour for DBs that have not been re-indexed.
   const resolveTargetStmt = rawDb.prepare(
     `SELECT s.id, s.file_id, f.language FROM brain_symbol s
      LEFT JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND s.name = ?
      ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
      LIMIT 1`
   )

   // #612 follow-up: a `contains` edge names its TARGET by NAME only, and the
   // graph's most repeated names are exactly the ones containment is built from —
   // every constructor normalizes to `constructor` (the family contract), and a
   // member name recurs in every class that has it. Same-file, same-name
   // candidates therefore abound and the statement above picks between them by
   // `s.id` alone, which is `${fileId}:${name}:${line}` compared as TEXT — so it
   // is the LEXICOGRAPHICALLY smallest line that wins, not the intended symbol
   // (`constructor:22` beats `constructor:227`, but `constructor:227` beats
   // `constructor:25`).
   //
   // The edge already says which one it meant: a contains edge takes the CHILD's
   // own naming line as `line_number` (#921 — the same field this family's other
   // relationship types carry), so the intended target is the candidate written
   // on that line. MEASURED before landing, over the same-file containment edges
   // of the ten pinned heavy repos (record:
   // validation/m14/measurements/containment-612.before.json — the control arm; the
   // arm after this rule is validation/m14/measurements/containment-612.json. Those two
   // names, not `M14.0.*`: that namespace belongs to gates that call `emitEvidence`,
   // and a corpus sweep is a measurement, not a gate. They also sit outside
   // validation/m14/results/ itself, because the evidence harness validates every
   // JSON in that directory and a non-harness record there fails it. Probe
   // contains-line-hint-612;
   // `line pins 1` = the target name repeats AND exactly one same-file candidate
   // sits on the edge's own line. The table is the CONTROL arm, and a rule cannot
   // re-resolve a name it never sees, so the after arm's figures are identical on
   // the nine repos whose symbol selection did not move; only zig's index run did
   // (report §8.4), so its row and the totals appear once per arm):
   //
   //   repo / lang          ambiguous  line pins 1  pins none  old id-tier WRONG
   //   nlohmann-json cpp        3,199        3,151         48             2,422
   //   fmt cpp                  1,220        1,211          9               880
   //   sqlite c                 1,030        1,030          0               608
   //   ripgrep rust             1,905        1,905          0             1,434
   //   go-tools go              3,029        3,029          0             2,151
   //   zig zig                 27,068       27,068          0            20,440
   //   all ten repos           49,729       49,672         57            37,318
   //
   //   after arm only:
   //   zig zig                 35,444       35,444          0            28,327
   //   all ten repos           58,105       58,048         57            45,205
   //
   // `old id-tier WRONG` is the probe's counterfactual for the LAST tier of the
   // statement this one replaces: the id is `${projectId}:${path}:${name}:${line}`
   // compared as TEXT, so among candidates tied on the tiers above it the
   // lexicographically smallest LINE wins — `constructor:227` beats
   // `constructor:25`. The count of edges the WHOLE old statement would misresolve
   // is larger, and it is measured by replay for exactly that reason: 37,532 of the
   // control arm's 127,521 edges would resolve to a different symbol, 37,611 to a
   // symbol whose line the edge contradicts, and 437 to a symbol in ANOTHER FILE —
   // containment is intra-file, so those edges leave the file they describe. The
   // after arm's own replay reads 45,419 of its 135,922, 45,498, and the SAME 437
   // and 436 escapes: the escape counts are arm-invariant, which is how the change
   // is separated from the population it moved (records:
   // validation/m14/measurements/containment-old-rule-612.before.json and
   // validation/m14/measurements/containment-old-rule-612.json, probe
   // contains-old-rule-612, which replays the old ORDER BY against the same
   // candidate sets, so no pre-#612 build has to be resurrected to compare).
   // Every one of the 49,672 edges the line pins (58,048 on the after arm) resolves
   // to the candidate on that line (`ambiguousCurrentChoiceMatchesHint` ==
   // `ambiguousHintPinsExactlyOne` on all ten repos), and the 57 the line cannot pin
   // fall through to the remaining keys, so an edge the hint cannot place loses
   // nothing. 0 of the 127,521 edges carries a target in another file
   // (`containsTargetInAnotherFile`; 0 of the after arm's 135,922 too — the rule must
   // not lose a property the old one did not have either) and 0 is left unplaced
   // although its line pins one candidate (`contains-residual-612`: 0 rows on both
   // arms — every after row carries `residual: 0`, and the control record keeps the
   // same answer as unparsed stdout). The field means what this rule reads it to
   // mean, verified rather than assumed: 77,793 of the after arm's 77,817 edges
   // whose target name is unique — the case where the old choice is provably right —
   // store the target on the edge's own line (99.97%; the control arm reads the same
   // 24 exceptions as 77,768 of 77,792. Both pairs are the recorded gauges
   // `containsEdgesTotal` minus `ambiguousTargetName`, and `edgeLineEqualsTargetLine`
   // minus `ambiguousAndEdgeLineEqualsTargetLine`).
   //
   // "On the line" is exact equality of `line_start`, and those 24 rows are a SPAN
   // shape, not a wrong symbol: every one of them was listed and checked against the
   // source text (record: validation/m14/measurements/containment-inner-line-samples-612.json,
   // probe contains-inner-line-samples-612). In all 24 the edge's line IS a line the
   // name is written on, and the stored span simply OPENS EARLIER — either on the
   // line directly above (17 rows; nlohmann's `lexer::get_decimal_point`, span
   // 171-177 with the edge on 172, line 171 being `JSON_HEDLEY_PURE`; `basic_json::create`,
   // span 410-424, edge 411, line 410 being `JSON_HEDLEY_RETURNS_NON_NULL`) or further
   // up the file (7 rows; fmt's `write2digits`, span 1193-1218 with the edge on 1210,
   // a `typedef struct sha1nfo {…} sha1nfo;` whose edge names the trailing
   // declarator, and the `NLOHMANN_JSON_NAMESPACE_END` macro, whose span is a whole
   // namespace body). The target name is unique in the file by construction — that
   // is what selects these rows — so the same-file preference resolves them
   // correctly; only the equality test is strict, not the resolution.
   //
   // The key ORDER is part of the rule, and the first cut of it got this wrong:
   // `COALESCE(s.is_declaration, 0) ASC` — the definitions-over-declarations
   // preference added earlier in #612 — ran FIRST and outranked the line, so an
   // edge whose child is a PROTOTYPE resolved to the same-named DEFINITION below
   // it. The shape exists in this corpus by name: nlohmann-json's
   // tests/src/unit-class_lexer.cpp stores `scan_string` twice — the one-line
   // `void scan_string(...)` declaration at 18 (is_declaration = 1) and its
   // definition at 19-23 — and carries a `contains` edge from `anonymous@15` to
   // each, on lines 18 and 19. With the declaration preference first, the line-18
   // edge falls to the definition and the two edges collapse onto one symbol; with
   // the order below, each resolves to the symbol its own line names. The two
   // preferences do not conflict when the order is right, because
   // they answer different questions: declaration-vs-definition distinguishes two
   // CANDIDATES for one entity across files, while the line identifies WHICH
   // declaration the edge means — and a declaration and its definition are two
   // distinct stored symbols that the edge's own `line_number` already tells
   // apart. So proximity/identity first, and the declaration preference kept for
   // the case it was added for (the fallback where no candidate sits on the line).
   const resolveContainsTargetStmt = rawDb.prepare(
     `SELECT s.id, s.file_id, f.language FROM brain_symbol s
      LEFT JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = ? AND s.name = ?
      ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC, COALESCE(s.is_declaration, 0) ASC, (f.language = ?) DESC, s.id
      LIMIT 1`
   )

   // #737 diagnostics wiring: every batch call site runs through the `stmt`
   // map (originals kept in stmtOriginal) so the diagnose pass can swap in
   // capturing wrappers and restore them afterwards. The per-batch closure is
   // created inside the loop (it needs that batch's tx).
   const stmtOriginal = {
     insertFile,
     insertSymbol,
     insertImport,
     insertRelationship,
     insertTaintSource,
     deleteFileSymbols,
     deleteFileImports,
     deleteFileEmbeddings,
     deleteFileRelationships,
     deleteFileRelationshipsByTarget,
     deleteFileTaints,
   }
   const stmt: Record<string, any> = { ...stmtOriginal }


   for (let i: any = 0; i < results.length; i += batchSize) {
     const batch = results.slice(i, i + batchSize)
     let batchSymbols = 0, batchRelationships = 0, batchImports = 0
 
     const tx = rawDb.transaction((batch: any) => {
       for (const result of batch) {
         if (!result.success) continue
 
         // M68: the relative path is computed from REAL paths on BOTH sides.
         //
         // `projectPath` and `result.filePath` reach this line spelled two
         // different ways, and have done all along. `result.filePath` is the
         // caller's own string — `results.push({ filePath: file, ... })` at the
         // top of this loop, straight out of the `files` list — while
         // `projectPath` is whatever the CALLER passed to indexProjectParallel.
         // bb_edit is the one caller that realpath'd its project root, so for it
         // the pair was `/private/var/folders/X` against `/var/folders/X`: the
         // same directory, two spellings, and `path.relative` between them
         // returned `../../../../var/folders/X/src/a.ts` instead of `src/a.ts`.
         //
         // The consequence was the worst kind of silent. `fileId` below is built
         // from this value, so it matched no existing row, every DELETE ran
         // against zero rows, and the INSERT created a SECOND brain_file row for
         // a file that was already indexed. The file then appeared twice, its
         // symbols appeared twice, and the second bb_edit on that file failed
         // permanently with "symbol is ambiguous". MEASURED: bb_edit was usable
         // exactly ONCE per file on macOS.
         //
         // No bb_edit gate saw it, because every one of them edits each symbol
         // exactly once. A gate that only ever performs the happy path once
         // cannot see a defect that makes the SECOND attempt fail.
         //
         // Both sides are realpath'd HERE rather than at the call sites, because
         // this is the one place the two are combined and seven callers reach it.
         // The file side falls back to its own spelling when realpath throws,
         // which is the create-a-new-file case where the leaf does not exist yet;
         // for that the nearest existing ancestor's spelling is what matters and
         // it is already consistent with the project root.
         const realFilePath = (() => {
           try { return realpathSync(result.filePath) } catch { return result.filePath }
         })()
         let relativePath = path.relative(realpathSync(projectPath), realFilePath)
         const fileId = `${projectId}:${relativePath}`
         // #756: per-file buffer for auto-generated contains edges (see the
         // symbol loop below) — flushed after the file's symbol rows exist.
         const bufferedContains: unknown[][] = []
         // Trace: only log significant files to avoid terminal I/O bottleneck
         const symCount = result.symbols?.length || 0
         const relCount = result.relationships?.length || 0
         if (relCount > 50 || symCount > 20) {
           process.stderr.write(`[STORE] ${relativePath.split('/').pop()}: ${symCount}s ${relCount}r\n`)
         }         // NO per-file savepoint: a mid-file FK violation rolls back the whole
         // batch (per-batch transaction, skip-and-continue below). The deletes
         // run before every insert and REPLACE precisely so the batch should
         // never see one; if it does, diagnoseBatchFailure (#737) names the
         // exact file and offending statements in the catch.

         // Delete this file's prior rows (and edges touching them) BEFORE the
         // brain_file REPLACE below cascades — keeps REPLACE's ON DELETE
         // CASCADE reach empty, which is what makes FK-ON safe here.
         stmt.deleteFileRelationships.run(fileId)
         stmt.deleteFileRelationshipsByTarget.run(fileId)
         stmt.deleteFileTaints.run(fileId, fileId)
         // Must precede deleteFileSymbols — it resolves the file's symbol ids
         // through brain_symbol, so running it after would delete nothing.
         stmt.deleteFileEmbeddings.run(fileId)
         stmt.deleteFileSymbols.run(fileId)
         stmt.deleteFileImports.run(fileId)
 
         // M68: `relativePath` is NOT recomputed here. The line this replaces was
         //
         //   relativePath = result.filePath.replace(projectPath, "").replace(/^\//, "")
         //
         // which is a STRING replace standing in for a path operation, and it
         // OVERWROTE the correct `path.relative(projectPath, result.filePath)`
         // computed 25 lines above. It is only right when `result.filePath`
         // literally contains `projectPath` as a prefix — which is false on
         // macOS, where /var and /tmp are symlinks into /private. There
         // projectPath is the unresolved spelling and result.filePath is a
         // realpath, so the replace matches nothing and `relativePath` becomes
         // the absolute path with its leading "/" stripped.
         //
         // The two spellings then disagree inside the SAME row: `fileId` on line
         // 2191 came from the correct relative path, `relative_path` came from the
         // broken one. So reindexing an already-indexed file computed a fileId
         // that matched no existing row, every DELETE above hit zero rows, and the
         // INSERT created a SECOND brain_file row for the same file — filed under
         // the absolute path.
         //
         // MEASURED, through bb_edit, which is how this was found. Editing ONE
         // symbol in a fresh project left:
         //   brain_file    src/a.ts                  (the original)
         //                 var/folders/.../src/a.ts  (the duplicate)
         //   brain_symbol  alpha  x2
         // and the consequence is that THE SYMBOL COULD NEVER BE EDITED AGAIN —
         // the second edit failed with "symbol alpha is ambiguous; provide
         // filePath and lineStart", permanently, because the duplicate never goes
         // away. bb_edit was usable exactly once per file, on macOS.
         //
         // Not one bb_edit gate caught it, because every one of them edits each
         // symbol exactly once. A gate that only ever does the happy path once
         // cannot see a defect that makes the SECOND attempt fail.
         //
         // `path.relative` is the operation that was always meant here, and it is
         // already what the fileId above uses. If the two ever need to differ,
         // that deserves a loud failure rather than a second spelling.
         const pathLower = relativePath.toLowerCase()
 
         let fileLayer = "core"
         if (
           pathLower.includes("/ui/") ||
           pathLower.includes("/components/") ||
           pathLower.includes("/pages/") ||
           pathLower.includes("/views/")
         ) {
           fileLayer = "ui"
         } else if (
           pathLower.includes("/db/") ||
           pathLower.includes("/database/") ||
           pathLower.includes("/repository/") ||
           pathLower.includes("/storage/") ||
           pathLower.includes("/models/") ||
           pathLower.includes("/schema/")
         ) {
           fileLayer = "db"
         } else if (
           pathLower.includes("/services/") ||
           pathLower.includes("/api/") ||
           pathLower.includes("/controllers/")
         ) {
           fileLayer = "service"
         } else if (pathLower.includes("test") || pathLower.includes("spec")) {
           fileLayer = "test"
         }
 
         if (result.imports) {
           const hasReact = result.imports.some(
             (i: any) =>
               typeof i.module === "string" &&
               (i.module.includes("react") || i.module.includes("vue") || i.module.includes("svelte")),
           )
           if (hasReact) fileLayer = "ui"
         }
 
         const hasSyntaxErrors = result.errors && result.errors.some((e: any) => e.severity === "warning")
         const errorReport = hasSyntaxErrors ? JSON.stringify(result.errors) : null
 
        // M57.T1 (#789): a test file must be CODE. The old path-substring
        // classifier flagged directory segments with no file-type check — all 30
        // flagged files on the real index were JSON fixtures (M50 receipt:
        // validation/m50/results/A2-test-sources.json). ONE canonical predicate
        // (test-classification.ts) now gates on file type first; the path-shape
        // rules are unchanged and shared with AnalysisExclusions (T5).
        const isTestFile = isTestFileCandidate(relativePath, result.language) ? 1 : 0
 
         // Count lines — use max symbol endLine as estimate, fallback to 0
         let lineCount = 0
         if (result.symbols && result.symbols.length > 0) {
           for (const s of result.symbols) {
             const end = s.endLine ?? s.range?.endLine ?? 0
             if (end > lineCount) lineCount = end
           }
         }
 
         stmt.insertFile.run(
           fileId,
           projectId,
           result.filePath,
           relativePath,
           result.fileHash || "",
           result.sizeBytes || 0,
           lineCount,
           result.lastModified || 0,
           result.language || "unknown",
           result.framework || null,
           hasSyntaxErrors ? 1 : 0,
           errorReport,
           isTestFile,
           fileLayer,
           now,
           now,
           // The analyzer's FileMetadata, which every analyzer returns and this
           // table had nowhere to store. The framework_type column above is the
           // only field ever promoted out of it, so patterns, detectedFrameworks,
           // architecturalInsights, complexity, cyclomaticComplexity and
           // codeQuality were computed for all 29 languages and discarded on the
           // way in. Serialized whole rather than split into columns, matching
           // brain_relationship.metadata, so a field an analyzer adds later needs
           // no migration. See ensureFileMetadataColumn in schema-ddl.ts.
           result.metadata ? JSON.stringify(result.metadata) : null,
         )
 
         // Hoisted per-file index structures — used by both symbol storage and
         // relationship source resolution (which runs outside the symbols block).
         const fileLang = (result.language || "").toLowerCase()
         // JS-global names are only noise for JS-family languages; a Scala
         // `object Global` or `def process` is a legitimate declaration and
         // must survive indexing. Universal entries below are keywords and
         // synthetic tree-sitter artifacts — noise everywhere. Language-literal
         // words (None/True/False/nil/...) are NOT here: they are legitimate
         // identifiers in verified analyzer output (e.g. TypeScript/C# enum
         // members named `None`) and only the regex fallback path can pick
         // them up as noise (const None = ...), so they are gated on fallback.
         const JS_FAMILY = new Set(["javascript", "typescript", "tsx", "vue", "svelte"])
         const SYMBOL_NAME_DENYLIST = new Set([
           "this", "super", "self", "Self", "me", "My",
           "root", "program", "source_file", "module_declaration",
           "package_manifest", "GlobalScope", "SCSS_FILE_SCOPE",
         ])
         const isFallbackResult = !!result.fallback
         if (isFallbackResult) {
           SYMBOL_NAME_DENYLIST.add("true")
           SYMBOL_NAME_DENYLIST.add("false")
           SYMBOL_NAME_DENYLIST.add("null")
           SYMBOL_NAME_DENYLIST.add("nil")
           SYMBOL_NAME_DENYLIST.add("None")
           SYMBOL_NAME_DENYLIST.add("True")
           SYMBOL_NAME_DENYLIST.add("False")
           SYMBOL_NAME_DENYLIST.add("undefined")
           SYMBOL_NAME_DENYLIST.add("NaN")
           SYMBOL_NAME_DENYLIST.add("Infinity")
           // `unknown` moved here from the universal set, and it is the one entry
           // above that was not noise "everywhere" — it is noise from a REGEX
           // FALLBACK, which is exactly what this block is for. The rationale
           // three lines up already says it: language-literal words are legitimate
           // identifiers in verified analyzer output, and only the fallback path
           // picks them up as noise. `unknown` is a real method name — Ruby's
           // Logger has five standard severities and `unknown` is one of them, so
           // `ActiveSupport::Logger#unknown` (activesupport/lib/
           // active_support/colorize_logging.rb:46) was parsed, stored, and then
           // dropped here, and never reached the graph. Same for `Status.unknown`
           // in protobuf/graphql lanes and an `unknown` field in a schema. It also
           // matches the JS-family treatment right below: `undefined` is already
           // gated rather than universal for precisely this reason.
           SYMBOL_NAME_DENYLIST.add("unknown")
         }
         if (JS_FAMILY.has(fileLang)) {
           SYMBOL_NAME_DENYLIST.add("global")
           SYMBOL_NAME_DENYLIST.add("Global")
           SYMBOL_NAME_DENYLIST.add("window")
           SYMBOL_NAME_DENYLIST.add("Window")
           SYMBOL_NAME_DENYLIST.add("document")
           SYMBOL_NAME_DENYLIST.add("module")
           SYMBOL_NAME_DENYLIST.add("exports")
           SYMBOL_NAME_DENYLIST.add("default")
           SYMBOL_NAME_DENYLIST.add("globalThis")
         }
         const nameToSymbol = new Map<string, any>()
         const containersByStart: { name: string; start: number; end: number }[] = []
         // M59/#855: intervals of the symbols this file will ACTUALLY STORE, so
         // an edge whose analyzer source is a synthetic scope the store filters
         // reject (anonymous_*/block_N/lambda_N/object_N) can be attributed to
         // the innermost real enclosing symbol instead of losing attribution.
         // Filled in the symbol loop below (needs the storeableName replica).
         // `kind` was added for #879: the OWNER fallback below needs to know
         // whether an enclosing span is a container. The #855 edge path reads
         // only id/start/end, so the extra field changes nothing for it.
         const storeableSpans: { id: string; name: string; start: number; end: number; kind: string }[] = []
         // Hoisted out of the relationship loop: it closes over storeableSpans
         // only, so defining it per relationship would allocate a closure per
         // edge for no reason.
         const enclosingStoreableId = (line: number | null): string | null => {
           // THIN WRAPPER over the module-level scan, so the pass can use the same implementation.
           return enclosingSpanId(storeableSpans, line)
         }
         // #612 follow-up (the SOURCE half of the containment target rule): the
         // innermost STOREABLE span carrying this NAME whose extent covers
         // `line`. A `contains` edge names its container by name only, and the
         // in-memory lookups below are FIRST-WINS — so a name that repeats in the
         // file (cpp's synthetic `anonymous` namespaces, rust's `impl Foo` beside
         // `struct Foo`, zig's `Group`) resolves to the first candidate rather
         // than to the one the edge belongs to. The child's own naming line is a
         // point INSIDE the intended container, so among same-named candidates
         // the innermost one whose extent covers that line is the only reading the
         // edge supports. Scanned backwards over storeableSpans (sorted by start
         // ascending), so the first hit is the innermost. Returns null when NO
         // candidate of that name covers the line — the edge's own evidence cannot
         // place it, and the caller keeps the existing choice rather than inventing
         // one.
         const enclosingStoreableIdByName = (name: string, line: number | null): string | null => {
           // THIN WRAPPER over the module-level scan.
           return enclosingSpanIdByName(storeableSpans, name, line)
         }
         // M59 #879: the innermost storeable NON-container symbol enclosing a
         // span — the lexical owner a nested declaration executes under (a method
         // whose body holds the declaration). Scanned backwards over
         // storeableSpans (sorted by start ascending), so the first hit is the
         // innermost. `sp.start < start` is strict, which excludes the symbol
         // itself and any span sharing its start line, and makes an owner cycle
         // arithmetically impossible.
         const enclosingNonContainerSpanId = (start: number, end: number, selfId: string): string | null => {
           // THIN WRAPPER over the module-level scan.
           return enclosingNonContainerId(storeableSpans, start, end, selfId)
         }
         let firstContainerSymbol: any = undefined
 
         // M51.A1/A3 (#716/#718): the storeable-row replica used by BOTH the
         // owner-assignment path and the relationship-source path. Must stay an
         // exact mirror of the insert-time guards below (denylist, name length,
         // startLine >= 1, artifact-name filter honoring fallback mode).
         // Computing references against the RAW analyzer list is what produced
         // 134,073 orphan owner ids on this repo (whole-repo evidence in
         // docs/m51/PLAN.md): the owner row was skipped by a later filter,
         // leaving every child pointing at a ghost. Consumers JOIN on
         // owner_symbol_id, so a phantom value was already invisible — omitting
         // it removes the lie without changing any read path.
         const storeableName = (nm: string | undefined, startLine: number): boolean => {
           if (!nm || SYMBOL_NAME_DENYLIST.has(nm) || nm.length > 500) return false
           if (startLine < 1) return false
           return !(isFallbackResult
             ? isIndexArtifactNameStrict(nm)
             : isIndexArtifactName(nm))
         }
 
         // M59/#879: hoisted to the FUNCTION scope. The owner fallback helper is
         // defined ABOVE this block and calls it, and a block-scoped name used
         // inside a nested function compiles clean but throws on the call
         // ("CONTAINER_TYPES_LOOKUP is not defined") — the same silent-failure
         // shape this milestone keeps finding in its own instruments. Function
         // scope removes the ordering trap and the three call sites share one list.
         // CONTAINER_TYPES_LOOKUP is hoisted to module scope (mutation-free).

         if (result.symbols) {
           const insertedSymbolIds = new Set<string>()
           // Names that should NEVER become standalone symbols — language keywords,
           // scope objects, and root-level nodes that are always noise.
           // Sort symbols: container types first (class, interface, etc.) so FK
           // references from methods to their containers resolve successfully.
           // CONTAINER_PRIORITY is hoisted to module scope (mutation-free).
           result.symbols.sort((a: any, b: any) => {
             const pa = CONTAINER_PRIORITY[a.type || a.kind] ?? 3
             const pb = CONTAINER_PRIORITY[b.type || b.kind] ?? 3
             return pa - pb
           })
 
           // Pre-build fast lookup structures to eliminate per-symbol O(n) scans.
           // nameToSymbol: first symbol with each name (mirrors Array.find semantics).
           // containersByStart: container symbols sorted by startLine ascending for
           // line-containment lookups (replaces two full-array scans per symbol).
           for (const s of result.symbols) {
             const nm = s.name || ""
             if (nm && !nameToSymbol.has(nm)) nameToSymbol.set(nm, s)
             // #17 seam repair: elixir function-scope relationship sources carry
             // the arity-qualified identity (`Mod.fn/N` — scopeName = fnId), and
             // the store must resolve that spelling back to the SYMBOL. Without
             // this, every elixir function-sourced edge landed with
             // source_symbol_id NULL (caught by the pipeline e2e through the
             // REAL CLI: `calls` joined via the source symbol read 0 while
             // symbols and docstrings persisted). Register the exact spellings
             // the analyzers emit — `Scope.name` and `Scope.name/arity`.
             const sScope = s.scope || s.ownerName || ""
             if (nm && sScope) {
               const q = `${sScope}.${nm}`
               if (!nameToSymbol.has(q)) nameToSymbol.set(q, s)
               const sArity = s.metadata?.arity
               if (typeof sArity === "number" && !nameToSymbol.has(`${q}/${sArity}`)) nameToSymbol.set(`${q}/${sArity}`, s)
             }
             const k = s.type || s.kind || "unknown"
             if (CONTAINER_TYPES_LOOKUP.has(k)) {
               const cStart = s.startLine ?? s.range?.startLine ?? 0
               const cEnd = s.endLine ?? s.range?.endLine ?? cStart
               containersByStart.push({ name: nm, start: cStart, end: cEnd })
             }
           }
           containersByStart.sort((a, b) => a.start - b.start || b.end - a.end)

           // M59/#855: build the storeable-interval index used by the
           // relationship-source fallback below. Sorted by start ascending, so a
           // backwards scan returns the INNERMOST enclosing span first.
           // THE BUILD IS HOISTED, INCLUDING ITS SORT. `storeableName` is passed IN as the predicate
           // rather than read from module scope — see the note below: it is PER-CALL MUTABLE STATE and
           // a module-level denylist would leak the fallback entries across files.
           storeableSpans.push(...buildStoreableSpans(result.symbols, fileId, storeableName))
           // First container-kind symbol in sorted order (used for this/self resolution)
           const INTRA_CONTAINER_KINDS = new Set(["class", "interface", "struct", "trait", "enum", "object", "actor", "impl"])
           firstContainerSymbol = result.symbols.find((s: any) => INTRA_CONTAINER_KINDS.has(s.type || s.kind || "unknown"))
 
           // Pre-build contains-pair set for O(1) dedupe of auto-generated contains
           // relationships (replaces per-symbol O(rels) scan).
           const containsPairs = new Set<string>()
           if (result.relationships) {
             for (const r of result.relationships) {
               if ((r.type || r.relationshipType || "") !== "contains") continue
               const rSrc = r.source || r.sourceId || r.fromSymbol || r.from || ""
               const rTgt = r.target || r.targetId || r.toSymbol || r.to || ""
               const srcLeaf = rSrc.replace(/^.*:([^:]+):?\d*$/, "$1")
               const tgtLeaf = rTgt.replace(/^.*:([^:]+):?\d*$/, "$1")
               if (srcLeaf && tgtLeaf) {
                 // Space separator (deliberate): must match the has() lookup
                 // below. Symbol names containing spaces (e.g. F# backtick
                 // names) can only cause a benign false-positive dedupe that
                 // skips a redundant edge — never a missing relationship.
                 containsPairs.add(`${srcLeaf} ${tgtLeaf}`)
                 containsPairs.add(`${tgtLeaf} ${srcLeaf}`)
               }
             }
           }
 
           for (const symbol of result.symbols) {
             // Skip symbols that would cause SQL insert failures
             const symbolKind = symbol.type || symbol.kind || "unknown"
             const symbolName = symbol.name || ""
             // Denylist: filter language keywords and scope artifacts regardless of kind
             if (SYMBOL_NAME_DENYLIST.has(symbolName)) continue
             // Skip symbols with empty or extremely long names
             if (!symbolName || symbolName.length > 500) continue
             // Skip symbols with invalid start lines
             const ssLine = symbol.startLine ?? symbol.range?.startLine ?? 0
             if (ssLine < 0) continue
             const symbolStartLine = symbol.startLine ?? symbol.range?.startLine ?? 0
             const symbolEndLine = symbol.endLine ?? symbol.range?.endLine ?? symbolStartLine
             // Skip import-only symbols — external type references extracted from
             // import statements. These have line 0, no owner, and are never
             // project-declared classes. Examples: Boolean, File, PsiModifier, etc.
             // Top-level declarations (class/interface/enum/trait/struct) with
             // explicit kind are kept even at line 0 (e.g., Kotlin top-level classes).
             const TOP_LEVEL_CONTAINER_KINDS = new Set([
               "class", "interface", "enum", "trait", "struct", "module", "namespace", "type"
             ])
             const ownerName = symbol.ownerName || symbol.scope || ""
             if (symbolStartLine === 0 && !ownerName && !TOP_LEVEL_CONTAINER_KINDS.has(symbolKind)) continue
             const symbolStartIndex = symbol.startIndex ?? symbol.range?.startIndex ?? null
             const symbolEndIndex = symbol.endIndex ?? symbol.range?.endIndex ?? null
 
             if (symbol.snippet && symbol.snippet.length > 0) {
               const symbolId = `${fileId}:${symbol.name}:${symbolStartLine}`
               semanticBatch.push({
                 symbolId,
                 fileId,
                 name: symbol.name,
                 kind: symbolKind,
                 snippet: symbol.snippet,
               })
             }
 
             const symbolId = `${fileId}:${symbol.name}:${symbolStartLine}`
             let ownerSymbolId: string | null = null
             const _ownerName = symbol.ownerName || symbol.scope
             if (_ownerName) {
               const parentSymbol = nameToSymbol.get(_ownerName)
               const ownSymbolId = `${fileId}:${symbol.name}:${symbolStartLine}`
               // #612 (the structural twin of the containment source rule): the
               // lookup above is FIRST-WINS, so a file that repeats a container
               // name assigns this symbol's owner to whichever declaration the
               // analyzer emitted first — and the store then emits its OWN
               // `contains` edge from that owner, which asserts ENCLOSURE. An
               // owner whose extent does not cover the child's own naming line
               // therefore contradicts the edge it just emitted. Prefer the
               // innermost same-name candidate whose extent COVERS that line; a
               // name whose candidates all fail the enclosure test keeps the
               // historical choice rather than inventing one. MEASURED before
               // landing over the ten pinned heavy repos — owned symbols with a
               // line / owner name not unique in its file / owner does NOT enclose
               // its child / of those, a covering candidate of the same name
               // exists (records:
               // validation/m14/measurements/containment-owner-span-612.before.json and
               // validation/m14/measurements/containment-owner-span-612.json, probe
               // contains-owner-span-612):
               //   nlohmann-json cpp  5,621 / 2,024 /  1,661 / 1,156
               //   fmt cpp            1,968 /   840 /    535 /   532
               //   jq c                 521 /   228 /      0 /     0
               //   sqlite c           4,946 /   142 /     11 /    11
               //   ripgrep rust       3,773 / 2,888 /  2,135 / 2,135
               //   cargo rust         6,914 / 5,021 /  3,064 / 3,064
               //   go-tools go        9,354 / 1,068 /  3,290 /    51
               //   terraform go      20,312 / 1,444 / 10,450 /    10
               //   zls zig            1,706 /   196 /     24 /    24
               //   zig zig           71,957 / 12,421 / 8,097 / 7,153
               // The go rows are why the test is ENCLOSURE, not the name alone:
               // Go's owner contract is a receiver TYPE, and the language allows
               // that type in another file, so go-tools' 3,290 contradicted owners
               // (terraform's 10,450) are not name collisions at all — only 51
               // (resp. 10) have a covering same-name candidate to prefer, and the
               // rest keep the analyzer's owner rather than a nearer name that is
               // not it. Where the current owner DOES enclose but a deeper
               // same-name candidate also does, the innermost still wins — the
               // reading the edge-source rule uses (nlohmann-json: 1,170 rows
               // change owner, 1,156 of them contradicted).
               // Owner spellings reach here qualified in several languages
               // (`ns.Class`, cpp's `Class::member` scope, rust's impl-target
               // path). Try the exact spelling first — a same-file symbol really
               // can be named with dots — then its leaf, the same order the
               // edge-source rule uses.
               const ownerLeaf = String(_ownerName).split(/[:.]/).filter(Boolean).pop() ?? String(_ownerName)
               const coveringOwnerId =
                 enclosingStoreableIdByName(String(_ownerName), symbolStartLine) ??
                 (ownerLeaf !== String(_ownerName) ? enclosingStoreableIdByName(ownerLeaf, symbolStartLine) : null)
               if (coveringOwnerId && coveringOwnerId !== ownSymbolId && String(_ownerName) !== String(symbol.name)) {
                 ownerSymbolId = coveringOwnerId
               }
               // M51.A1: the old unconditional `${ownerName}:0` module fallback
               // wrote ids that can never resolve (no stored row can have line
               // 0 with an owner), and a same-named parent would self-own. If
               // the named parent is not a storeable row, leave the owner NULL.
               if (!ownerSymbolId && parentSymbol && parentSymbol.name !== symbol.name) {
                 const parentStartLine = parentSymbol.startLine ?? parentSymbol.range?.startLine ?? 0
                 if (storeableName(parentSymbol.name, parentStartLine)) {
                   ownerSymbolId = `${fileId}:${parentSymbol.name}:${parentStartLine}`
                 }
               }
             } else {
               // No ownerName/scope — derive from line-range containment.
               // Only assign owners to symbols that are typically contained
               // (methods, functions, constructors, fields). Top-level declarations
               // like classes, interfaces, enums should NOT get fallback owners.
               const OWNABLE_TYPES = new Set([
                 "method", "function", "constructor", "field", "property",
                 "variable", "prop", "rune", "reactive",
               ])
               const symbolType = symbol.type || symbol.kind || "unknown"
               if (OWNABLE_TYPES.has(symbolType)) {
                 // Tier 1: Exact line-range containment (tree-sitter parsed results).
                 // containersByStart is sorted ascending by start; the first
                 // container whose [start,end] encloses the symbol wins (widest
                 // container first on equal starts), preserving original scan order.
                 for (const c of containersByStart) {
                   if (c.start >= symbolStartLine) break // sorted: no later container starts earlier
                   if (c.name === symbol.name) continue
                   // M51.A1: a container the insert filters will skip is not an
                   // owner — keep searching for an outer storeable container.
                   if (!storeableName(c.name, c.start)) continue
                   // #612: containment must be STATED, not assumed. The loop
                   // guard above (`c.start >= symbolStartLine → break`) means
                   // every container reachable here starts BEFORE the symbol, so
                   // `c.end >= symbolEndLine` is the only test that can be
                   // satisfied by a container that actually encloses it. A
                   // degenerate container (`c.end === c.start`) used to be
                   // accepted outright — and it CANNOT be a container here: its
                   // whole extent is one line that begins before the symbol's
                   // first line, so the tree has already said it does not contain
                   // the symbol. Measured 2026-09-25 over five real systems
                   // corpora (go-tools 5,937 · nlohmann-json 1,575 · zls 606 ·
                   // fmt 322 · jq 39 = 8,479 assignments): every analyzer-path one
                   // was cross-line with respect to the symbol, and the only
                   // 5 fallback-path ones are handled by Tier 2 below. Not one
                   // was same-line containment, which is the case the clause
                   // would have had to serve to be truthful. It was handing
                   // every go package-clause symbol (`main:1-1`) ownership of
                   // every file-scope function below it, and every cpp type alias
                   // or one-line forward declaration (`json:32-32`) ownership of
                   // the functions that followed.
                   if (c.start > 0 && c.end >= symbolEndLine) {
                     ownerSymbolId = `${fileId}:${c.name}:${c.start}`
                     break
                   }
                 }
                 // Tier 2: Nearest preceding container.
                 //
                 // #612: this rule is gated on the REGEX FALLBACK path, which is
                 // the only path it was ever truthful for — and its own comment
                 // said so. The fallback emits flat single-line symbols with no
                 // containment information (`extractBasicSymbols` writes
                 // `startLine: i + 1, endLine: i + 1`), so nearest-preceding is
                 // the only available approximation. On the ANALYZER path the
                 // tree gives every container a real extent, and a container
                 // whose recorded `end` is before the symbol's `start` is a
                 // contradicted fact, not an approximation: the analysis says it
                 // does not contain the symbol. Assigning it anyway is how this
                 // lane fabricated ownership — measured 2026-09-25 across five
                 // real systems corpora (nlohmann-json 125, zls 78, fmt 84, jq 6,
                 // go-tools 2 = 295 assignments): EVERY one was analyzer-path and
                 // ended-before, and ZERO came from the fallback this rule was
                 // written for. The reported defect was `cpp engine.cpp
                 // run_engine` — a file-scope function owned by `Engine` merely
                 // because the class precedes it (`go Sqrt@main`, `zig
                 // render@Palette` had the same shape). Tier 1 above already
                 // accepts a degenerate single-line container (`c.end ===
                 // c.start`), so nothing the analyzer path could place is lost
                 // here; it is confined to the path whose ranges it was meant
                 // for. Unlike the earlier M59/#879 additive rule (which runs
                 // only when an owner is still NULL), this is corrected in place:
                 // the fabricated owners simply stop being written.
                 if (!ownerSymbolId && isFallbackResult) {
                   for (let ci = containersByStart.length - 1; ci >= 0; ci--) {
                     const c = containersByStart[ci]
                     if (c.start >= symbolStartLine) continue
                     if (c.name === symbol.name) continue
                     if (!storeableName(c.name, c.start)) continue
                     ownerSymbolId = `${fileId}:${c.name}:${c.start}`
                     break
                   }
                 }
               }
             }
 
             // M59 #879: a symbol every derivation above left OWNERLESS, whose
             // span sits inside a storeable NON-container symbol, gains that
             // symbol as its owner. #866 made an anonymous body's `val` member a
             // real symbol and attributed the initialiser's call to it, but the
             // member was stored with `owner_symbol_id = NULL` — so bb_graph's
             // answer named `a` and no owner chain connected it to the method the
             // agent asked about (the M59 "unrecognisable subject" defect).
             //
             // STRICTLY ADDITIVE, by construction: it runs only when ownerSymbolId
             // is still null, so NO existing owner can change — and it prefers the
             // innermost container-free holder over the container, so a member of a
             // body is owned by the body's enclosing method, not by an outer class.
             // Additions measured on the 150-file corpus slices before landing:
             // scala 514, java 128, kotlin 32, typescript 11, groovy 0 — dominated
             // by nested methods (388) and constants inside a method body (101).
             if (!ownerSymbolId && !CONTAINER_TYPES_LOOKUP.has(symbol.type || symbol.kind || "unknown")) {
               const enclosingNonContainer = enclosingNonContainerSpanId(symbolStartLine, symbolEndLine, symbolId)
               if (enclosingNonContainer) ownerSymbolId = enclosingNonContainer
             }

             // Verified analyzer output gets the narrow (hard-artifact) name
             // filter only — soft rules (quotes, parentheses, whitespace,
             // numeric prefixes, punctuation) are legitimate symbol contracts
             // (CSS selectors, Markdown headings, F# active patterns, YAML
             // merge keys). The regex fallback path gets the strict filter.
             const nameIsArtifact = isFallbackResult
               ? isIndexArtifactNameStrict(symbol.name)
               : isIndexArtifactName(symbol.name)
             if (symbolStartLine < 1 || nameIsArtifact) continue
             stmt.insertSymbol.run(
               symbolId,
               projectId,
               fileId,
               symbol.name,
               symbol.qualifiedName || symbol.name,
               symbolKind,
               symbolStartLine,
               symbolEndLine,
               symbolStartIndex,
               symbolEndIndex,
               symbol.visibility || "public",
               symbol.parameters ? JSON.stringify(symbol.parameters) : null,
               symbol.returnType || null,
               symbol.qualifiedCalls ? JSON.stringify(symbol.qualifiedCalls) : null,
               symbol.complexity || 1,
               symbol.apiContractPath || null,
               symbol.gravityScore ||
                 (symbol.complexity || 1) *
                   (symbol.visibility === "public" || symbol.visibility === "export" ? 1.5 : 1.0),
               symbol.layer || fileLayer,
               ownerSymbolId,
               // Use metadata in annotations if present, otherwise decorators
               symbol.metadata
                 ? JSON.stringify(symbol.metadata)
                 : symbol.decorators
                   ? JSON.stringify(symbol.decorators)
                   : null,
               symbol.isAsync ? 1 : 0,
               symbol.isStatic ? 1 : 0,
               symbol.isAbstract ? 1 : 0,
               symbol.genericParameters ? JSON.stringify(symbol.genericParameters) : null,
               // M35 pre-work: persist the analyzer-extracted docstring. The
               // column existed in the schema but was never bound here, so
               // every brain_symbol.docstring was NULL — silently disabling
               // docstring-based evidence matching in bb_doc (feature/api
               // lexical SQL) and degrading symbol-mode doc facts.
               symbol.docstring || null,
               // The symbol's own source text, bounded. Content search selects
               // name/qualified_name/docstring, so without this a word that
               // appears ONLY inside a function was unreachable by every
               // retrieval path — 27% of body-only words on rake, 38% on
               // ripgrep. The body was in the database only as a
               // 50-dimensional hash, which cannot be queried by word.
               boundSourceText(symbol.snippet, symbolStartLine, symbolEndLine),
               // #837: the DDL column (scope_kind) and the typed schema
               // existed for years while this INSERT silently omitted them —
               // every scope value every analyzer emitted died at the store
               // seam. Bound by the M60.P1 enumeration; the payload-seam
               // matrix's rot-check fails the moment this binding disappears.
               symbol.scope || null,
               // #612: the declaration/definition fact, the same seam class as
               // docstring (M35) and scope_kind (#837) — the analyzers publish
               // it, the worker carries it, and the resolver reads it. Unlike
               // those two this column is NEW, so the binding is the only
               // writer and a NULL means "definition or undistinguishing
               // language".
               symbol.isDeclaration ? 1 : null,
               // M60/SDJ-8: the type hierarchy, published by every analyzer on
               // symbol.metadata.superTypes and discarded here. Without it the
               // cross-file `overrides` retarget cannot run: brain_symbol held no
               // heritage data, so the post-index pass could only resolve an
               // override's target by NAME, which resolves the wrong parent
               // perfectly happily. Measured on scala3: 45.5% of low-confidence
               // override rows pointed at a supertype that does not declare the
               // overridden method. NULL means "declares no supertypes", which is
               // also the honest reading of a symbol with no heritage.
               Array.isArray(symbol.metadata?.superTypes) && symbol.metadata.superTypes.length > 0
                 ? JSON.stringify(symbol.metadata.superTypes)
                 : null,
               now,
               now,
             )
             batchSymbols++
             insertedSymbolIds.add(symbolId)
             // Universal contains relationship — owner→owned containment even
             // when analyzers have scope tracking bugs or when WASM fallback
             // skips the analyzer.
             // M51.A1 (#716): the storeable-replica guard above already proves
             // the owner id will exist as a row, so the old
             // insertedSymbolIds.has() check is gone — it also silently dropped
             // the edge for forward-declared containers (declared after their
             // members in the analyzer output). Both endpoints now resolve by
             // construction: owner via storeableName, child via the insert above.
             // An `Instance` symbol is named after the type it instantiates, so
            // containing it would assert the module DECLARES that type. The
            // relationship is already carried by `implements`; the containment is
            // not a fact about this module. Haskell publishes these; the KIND,
            // not the language, decides.
            if (ownerSymbolId && symbol.kind !== ASTEngine.SymbolKind.Instance) {
               // Dedup: skip if the engine already generated a contains for this (owner, child) pair
               //
               // THE KEYS DID NOT AGREE, and only on the CHILD half — found by xml-lane (2026-10-10,
               // `b92ea6fda`), repaired here with the fix it measured (`f0b9b15c9`). The set is built
               // with BOTH ends leaf-reduced (`${srcLeaf} ${tgtLeaf}`, `:3652-3659`) while this lookup
               // reduced only the owner and probed the child RAW. For any child name bearing a colon
               // the keys differ by construction, the guard never fires, and a containment edge the
               // analyzer already emitted is written a SECOND time. Proven exactly on one file:
               // analyzer 294 + synthesized 217 = store 511, and replaying the indexer's own two
               // regexes over the symbol table predicts 217, all colon-named.
               //
               // THE OWNER REGEX IS DELIBERATELY LEFT ALONE, and that is the whole of what a first,
               // "symmetric" repair got wrong. Applying the BUILD-SITE regex
               // (`/^.*:([^:]+):?\d*$/`) to an `ownerSymbolId` — which always ends `:<line>` —
               // captures the LINE NUMBER as the leaf: `.*:` is greedy to the last colon and `\d*$`
               // then matches empty, so `proj:…:xsl:stylesheet:1` yields `1`, not `stylesheet`. This
               // site's `:\d+$` anchors the digit run into a REQUIRED suffix, so it captures the NAME.
               // Measured on xml's own probe, same 300-file draw, `emitted` 4,375 in every arm:
               //     HEAD (the defect)                  stored  7,649   ratio  1.748x
               //     symmetric repair (both ends)       stored 55,734   ratio 12.74x   <- 7.3x WORSE
               //     CHILD-ONLY, owner untouched        stored  4,369   ratio  0.999x   <- this
               // and reproduced on a second repository (dbeaver, 300 files): emitted 23,742 = stored
               // 23,742, exactly 1.0.
               //
               // SO `containsPairs` IS NOT A LEAF-KEYED SET in the way its build site suggests: the
               // same regex yields a usable leaf from a NAME and a LINE NUMBER from an ID. No future
               // repair may reuse one regex on both sides; a shape-appropriate leaf (strip `:<digits>`
               // from ids, then take the last colon segment) or a key over resolved ids is what the
               // guard actually needs if it is ever generalised.
               const ownerLeaf = ownerSymbolId.replace(/^.*:([^:]+):\d+$/, "$1")
               const childLeaf = String(symbol.name).replace(/^.*:([^:]+):?\d*$/, "$1")
               const alreadyHasContains = containsPairs.has(`${ownerLeaf} ${childLeaf}`)
               if (!alreadyHasContains) {
                 const fileCount = (fileRelCounters.get(fileId) || 0) + 1
                 fileRelCounters.set(fileId, fileCount)
                 // #756: BUFFER, do not insert here. This loop may reference a
                 // container symbol whose row has not been inserted yet (same
                 // CONTAINER_PRIORITY class, raw analyzer order) — an immediate
                 // insert is an intra-transaction forward FK reference that
                 // rolls back the whole batch under FK-ON (22 diagnosed
                 // rollbacks on a cold repo index; years of FK-OFF hid this).
                 // All buffered edges flush AFTER the full symbol loop below,
                 // when every referenced row exists.
                 bufferedContains.push([
                   `${projectId}:rel:${ownerSymbolId}:${symbol.name}:contains:${fileCount}`,
                   projectId,
                   ownerSymbolId,
                   symbolId,
                   null,          // source_external
                   symbol.name,   // target_external
                   "contains",
                   1.0,
                   null,
                   // M59/#821: this auto-generated containment edge has no call
                   // site, but it does have a NAVIGABLE site — the member's own
                   // declaration line, which is exactly what the symbol row above
                   // got. It was a hardcoded 0, so 62 real rows (markdown
                   // headings, YAML keys, scala members) landed in the DB
                   // claiming line 0: a number that silently means "unknown" and
                   // that graph-engine's `row.lineNumber || node.line` turned into
                   // an unrelated line. Never 0 — the analyzer's line or NULL.
                   //
                   // M59/#825: a SYNTHESISED member carries no line at all. Its
                   // "range" is the enclosing declaration's (kotlin data-class
                   // copy/equals/hashCode/toString all carried the CLASS's line;
                   // measured as 16 rows of a small kotlin lane whose target name
                   // appears nowhere on the claimed line). NULL is the honest
                   // value: unknown is a state, not a placeholder.
                   symbol.metadata?.isPhantom === true ? null : symbolStartLine,
                   0,
                   0,
                   null,
                   null,
                   now,
                   now,
                 ])
               }
             }
 
             // Process taint sources and sinks
             if (symbol.taintSources || symbol.taintSinks) {
               const sources = symbol.taintSources || []
               const sinks = symbol.taintSinks || []
 
               // 1. Intra-symbol flows (Both exist)
               if (sources.length > 0 && sinks.length > 0) {
                 for (const source of sources) {
                   for (const sink of sinks) {
                     const taintId = `taint:${projectId}:${symbolId}:${source.type}:${sink.type}`
                     const severity =
                       sink.vulnerability_type === "sql_injection" || sink.vulnerability_type === "command_injection"
                         ? "critical"
                         : "high"
 
                     stmt.insertTaintSource.run(
                       taintId,
                       projectId,
                       symbolId, // source_symbol_id
                       symbolId, // sink_symbol_id
                       source.type,
                       sink.type,
                       sink.vulnerability_type,
                       severity,
                       0, // is_mitigated
                       JSON.stringify([symbolId]), // flow_path
                       0, // cross_language_boundaries
                       now,
                       now,
                     )
                   }
                 }
               }
               // 2. Isolated Sources
               else if (sources.length > 0) {
                 for (let i: any = 0; i < sources.length; i++) {
                   const source = sources[i]
                   const taintId = `taint_src:${projectId}:${symbolId}:${source.type}:${i}`
                   stmt.insertTaintSource.run(
                     taintId,
                     projectId,
                     symbolId, // source_symbol_id
                     null, // sink_symbol_id is NULL
                     source.type,
                     "unresolved", // sink_type
                     "unresolved", // vulnerability_type
                     "unknown", // severity
                     0,
                     JSON.stringify([symbolId]),
                     0,
                     now,
                     now,
                   )
                 }
               }
               // 3. Isolated Sinks
               else if (sinks.length > 0) {
                 for (let i: any = 0; i < sinks.length; i++) {
                   const sink = sinks[i]
                   const taintId = `taint_snk:${projectId}:${symbolId}:${sink.type}:${i}`
                   const severity =
                     sink.vulnerability_type === "sql_injection" || sink.vulnerability_type === "command_injection"
                       ? "critical"
                       : "high"
 
                   stmt.insertTaintSource.run(
                     taintId,
                     projectId,
                     null, // source_symbol_id is NULL
                     symbolId, // sink_symbol_id
                     "unresolved", // source_type
                     sink.type,
                     sink.vulnerability_type,
                     severity,
                     0,
                     JSON.stringify([symbolId]),
                     0,
                     now,
                     now,
                   )
                 }
               }
             }
 
             // BUG 6 FIX: Heuristic taint detection for languages without explicit taintSources/taintSinks
             // Only applied to languages that actually have SQL/command/HTML APIs.
             // XML, HTML, CSS, JSON, YAML, and config languages are excluded.
             const LANGUAGES_WITH_SQL = new Set([
               "java", "python", "go", "php", "ruby", "csharp", "kotlin", "scala",
               "typescript", "javascript", "tsx", "jsx", "rust", "swift", "dart",
               "perl", "lua", "groovy", "cpp", "c", "elixir", "clojure", "r",
             ])
             const fileLang = (result.language || "").toLowerCase()
 
             if (!symbol.taintSources && !symbol.taintSinks && symbolKind === "function" && LANGUAGES_WITH_SQL.has(fileLang)) {
               const snippet = symbol.snippet || ""
               const qualifiedCalls = symbol.qualifiedCalls || []
               const hasStringConcat = snippet.includes("+ ") || snippet.includes("concat")
               const callsPattern = [...qualifiedCalls, snippet].join(" ")
 
               if (hasStringConcat && /execute|query|find|insert|update|delete.*where|cursor/i.test(callsPattern)) {
                 const taintId = `taint_h:${projectId}:${symbolId}:sql_injection:0`
                 stmt.insertTaintSource.run(taintId, projectId, null, symbolId, "unresolved", "sql_query",
                   "sql_injection", "high", 0, JSON.stringify([symbolId]), 0, now, now)
               }
               if (/innerHTML|dangerouslySetInnerHTML|document\.write|eval\(/.test(callsPattern)) {
                 const taintId = `taint_h:${projectId}:${symbolId}:xss:0`
                 stmt.insertTaintSource.run(taintId, projectId, null, symbolId, "unresolved",
                   callsPattern.includes("innerHTML") ? "innerHTML" : "eval",
                   "xss", "high", 0, JSON.stringify([symbolId]), 0, now, now)
               }
               if (/exec\(|spawn\(|system\(|popen\(|subprocess/i.test(callsPattern)) {
                 const taintId = `taint_h:${projectId}:${symbolId}:cmd_injection:0`
                 stmt.insertTaintSource.run(taintId, projectId, null, symbolId, "unresolved", "command_exec",
                   "command_injection", "critical", 0, JSON.stringify([symbolId]), 0, now, now)
               }
             }
           }
         }
 
         if (result.imports) {
           for (const imp of result.imports) {
             // ImportInfo canonical fields are module/importType — analyzers
             // never set name/path/type, so those reads silently produced
             // undefined bindings and imports were never persisted for ANY
             // language. Map the real shape (M14.1 fix).
             const moduleName = imp.module ?? imp.path ?? imp.localName ?? ""
             if (!moduleName) continue
             // ROUND 17 — WHAT WAS IMPORTED IS NOT WHICH MODULE IT CAME FROM, and the column only ever
             // held the module. `imp.name` is the field the worker's per-item rows carry
             // (`{name, path, type, isExternal, line}`, one row per item — its own comment calls them
             // "the analyzer's per-file granularity ... so fidelity here directly determines audit
             // precision"), and it was NEVER READ here: the M14.1 fix mapped the ANALYZER shape
             // (`module`/`items`) into this variable and the worker's `name` was dropped with it.
             // Measured through the real pipeline on a four-file project: `from models import
             // ProductVariant as PV` stored `imported_name = "models"` (the module) with the item
             // nowhere in `brain_import`, and the same for typescript's `import { C } from "./a"`
             // (stored `"./a"`) — while java's `import java.util.List` is right by accident, because
             // there the imported name and the module ARE the same string.
             //
             // The correct value is the one M60's OWN verifier already asserts
             // (`script/m14/verify-import-alias.ts` writes `String(i.name)` into `imported_name` and
             // then looks up a row named `Cygdb`, the ITEM) — that check stayed green only because it
             // RE-IMPLEMENTS this insert instead of exercising it, which is the gap that let this
             // survive. `patterns.ts` is the production consumer: it searches the file for
             // `usedName = imported_as || imported_name`, so with the module stored it searched for
             // `models` and reported `ProductVariant` imports unused (or found the module by
             // accident) — the mirror of the aliasing defect M60 fixed one column over.
             //
             // NARROW BY CONSTRUCTION, in three named cases where `name` is NOT the imported name:
             //   `*`                 a star/namespace import asks for the MODULE itself (the rule the
             //                       star-import axis and `exporter` lanes already state), so the
             //                       module stays the imported name — this keeps `import os` at `os`
             //                       instead of inventing `*`.
             //   name === moduleName  nothing to distinguish (java, c includes): unchanged.
             //   name === boundName   the row states one spelling for both roles — the projection used
             //                       to do this for `X as Y` and no longer does (see pool-worker), so
             //                       this arm now only catches a producer that still conflates them.
             const boundName = imp.alias ?? imp.localName ?? null
             const impName = typeof imp.name === "string" ? imp.name : ""
             const importedName =
               impName && impName !== "*" && impName !== moduleName && impName !== boundName
                 ? impName
                 : moduleName
             const importType =
               imp.importType ??
               (imp.isDefault || imp.isDefaultImport ? "default" : imp.isNamespace || imp.isNamespaceImport ? "namespace" : "named")
             // M60/#910: `is_external` was HARDCODED 0, so every analyzer that
             // already classifies its dependencies — clojure (`isExternal`),
             // sql (`isExternal`), c/cpp (`metadata.isSystemInclude`: `<stdio.h>`
             // vs `"util.h"`) — had its declaration silently discarded, and
             // the one consumer that reads the flag (the file-dependency
             // engine, which keeps external packages out of internal
             // resolution and honours `includeExternal: false`) treated a
             // system header as a project-internal dependency candidate.
             // The analyzer's own classification is the evidence; an
             // undeclared dependency stays 0 (unknown ≠ external).
             const impMeta = (imp.metadata ?? {}) as Record<string, any>
             const impIsExternal =
               imp.isExternal === true || impMeta.isExternal === true ||               impMeta.isSystemInclude === true ? 1 : 0
             // M60/#910: the row's LINE was always 0 for every import that
             // arrived in the worker's BasicImport shape (`{name, path, type,
             // isExternal, line}`) — the worker carried the line, this read
             // looked only at the analyzer's `range.startLine`, so the column
             // was written as 0 for c's includes while the value sat one field
             // away. Read every shape the two producers use; an import whose
             // line is genuinely unknown stays 0 (never invented).
             const impLine =
               (typeof imp.range?.startLine === "number" && imp.range.startLine > 0 ? imp.range.startLine : 0) ||
               (typeof (imp.range as any)?.start?.line === "number" && (imp.range as any).start.line > 0 ? (imp.range as any).start.line : 0) ||
               (typeof imp.line === "number" && imp.line > 0 ? imp.line : 0)
             const importId = `${fileId}:import:${moduleName}:${impLine}`
             stmt.insertImport.run(
               importId,
               projectId,
               fileId,
               importedName,
               // M60: the alias the analyzers already publish on ImportInfo.alias /
               // ImportInfo.localName, and which brain_import.imported_as has carried
               // in the DDL and the TS type since before either had a writer. Three
               // consumers read it — patterns.ts computes unused imports from
               // `usedName = imp.imported_as || imp.imported_name`, so with the column
               // always NULL it silently fell back to the IMPORTED name and searched
               // for a name the file never writes. Measured: 35.9% of python import
               // specifiers and 14.6% of javascript's are aliased, so
               // `from x import Cygdb as cygdb` searched for `Cygdb` and reported a
               // used import as unused. NULL stays correct for a plain import.
               imp.alias ?? imp.localName ?? null,
               imp.path || moduleName,
               importType,
               impIsExternal,
               impLine,
               now,
               now,
             )
             batchImports++
           }
         }
 
         // #756: flush auto-generated contains edges NOW — every symbol row of
         // this file already exists (the symbol loop above completed), so no
         // edge can forward-reference a row that is not yet stored. INSERT OR
         // IGNORE keeps the historical dedup semantics for engine-provided
         // duplicates.
         if (bufferedContains.length > 0) {
           for (const args of bufferedContains) {
             stmt.insertRelationship.run(...args)
             batchRelationships++
           }
           bufferedContains.length = 0
         }

         if (result.relationships) {
           let fileRelCount = 0
           for (const rel of result.relationships) {
             const sourceName = rel.source || rel.sourceId || rel.fromSymbol || rel.from || "unknown"
             const targetName = rel.targetExternal || rel.targetId || rel.target || rel.toSymbol || rel.to || "unknown"
             const relType = rel.type || rel.relationshipType || "references"
 
             // Extract the leaf name: "file:scope:name:line" → "name", "a.b.c" → "c"
             const extractLeaf = (name: string) => {
               // Remove line number suffix ":123"
               const noLine = name.replace(/:\d+$/, "")
               // #17: elixir scope spellings end with "/N" (the arity-qualified
               // fnId) — strip it so the leaf fallbacks below see `Mod.fn`, not
               // `fn/0`. Exact spellings already hit via the nameToSymbol
               // aliases; this keeps the fallback path honest too.
               const noArity = noLine.replace(/\/\d+$/, "")
               // Split by ":" and take last (handles "file:scope:name")
               const byColon = noArity.split(":")
               const lastColon = byColon[byColon.length - 1]
               // Split by "." and take last (handles "a.b.c")
               // A PATH IS NOT A MEMBER CHAIN. `a.b.c` is member access and its leaf is `c`, but
               // `synthetic/main.zig` is a FILE PATH and splitting it on "." yields the EXTENSION:
               // the leaf becomes `zig`, `resolveTargetStmt` matches `s.name = 'zig'` LIMIT 1, and the
               // edge binds to whatever symbol is named after the extension.
               //
               // MEASURED (json-lane, c38defed6, ghostty, one run): of 4,579 bound file-shaped edges,
               // 4,490 (98.1%) bound to a symbol named after the EXTENSION and only 89 to the target
               // spelling — `references synthetic/main.zig -> name='zig' qname='Allocator.zig'`.
               //
               // THIRD APPEARANCE OF ONE DEFECT: hcl measured 30,194 of 33,297 bound references (90.7%)
               // binding only after LEAF REDUCTION; the `contains` dedup (140be2f01) built its key set
               // with both ends leaf-reduced while the lookup left the child raw, and the symmetric
               // repair measured 7.3x worse. Leaf reduction applied to something that is NOT A NAME is
               // the programme's central defect.
               //
               // THE FIX IS THE SEPARATOR TEST, deliberately narrow: a name carrying a path separator is
               // a path and is returned whole; everything else keeps the member behaviour that is correct
               // for `a.b.c`. `InitOpts.c` (a FIELD named `c`) still reduces to `c` — that reduction is
               // right, and the extension-based classifier over-counted by calling it a file.
               //
               // EXPECTED EFFECT, to be read the right way: these edges move from MIS-BOUND to UNBOUND, so
               // **`unresolved` will RISE** on lanes with path-shaped targets — and that is the fix
               // working. A file reference should be bound by a file claim (`fileClaimForTarget`), not by
               // a symbol named after its extension.
               if (lastColon.includes("/") || lastColon.includes("\\")) return lastColon
               const byDot = lastColon.split(".")
               return byDot[byDot.length - 1]
             }
             const sourceLeaf = extractLeaf(sourceName)
             const targetLeaf = extractLeaf(targetName)

             // #612 follow-up (the SOURCE half of the containment rule): a
             // `contains` edge carries the CHILD's naming line — a point INSIDE
             // the container it belongs to — so for a container name that repeats
             // in this file (cpp's synthetic `anonymous` namespaces, rust's
             // `impl Foo` beside `struct Foo`, zig's `Group`) the edge itself says
             // which candidate it means, while the name lookups below are
             // FIRST-WINS and land on whichever declaration the analyzer happened
             // to emit first. Pre-landing measurement, nlohmann-json (cpp), on the
             // 5,625 same-file containment edges: source name not unique in its
             // file 2,027; of those, exactly one candidate's extent covers the
             // child's line 2,004 (98.9%); stored source for which the enclosure
             // the edge asserts is FALSE (its span does not cover the child's
             // line) 1,161 of the ambiguous ones — the shape in which the current
             // choice cannot be right. A `contains` edge asserts ENCLOSURE, the
             // same reasoning that removed the degenerate-container owner clause
             // in #612. Where no candidate of that name covers the line, nothing
             // is invented: the existing choice stands (residual 2 of the 2,027
             // here, plus the unique-name cases no name rule can place). The two
             // corpus arms of this rule — the same gauges over all ten repos,
             // before and after — are
             // validation/m14/measurements/containment-612.before.json and
             // validation/m14/measurements/containment-612.json (probes
             // contains-source-hint-612 and contains-source-span-delta-612).
             const relLine =
               typeof rel.line_number === "number" && rel.line_number > 0 ? rel.line_number : null
             const sourceIdFromSpan =
               relType === "contains" && relLine !== null
                 ? (enclosingStoreableIdByName(String(sourceLeaf), relLine) ??
                    enclosingStoreableIdByName(String(sourceName), relLine))
                 : null

             // Find source symbol: O(1) name match first, then ends-with/qualified
             // fallbacks over a pre-built list (avoids Array.find closure per rel).
             let sourceSymbol: any = undefined
             if (sourceName && sourceName !== "unknown") {
               sourceSymbol = nameToSymbol.get(sourceName) ?? nameToSymbol.get(sourceLeaf)
               if (!sourceSymbol) {
                 for (const s of result.symbols) {
                   if (sourceName.endsWith(`:${s.name}`)) { sourceSymbol = s; break }
                   if (sourceName.endsWith(`.${s.name}`)) { sourceSymbol = s; break }
                   if (s.qualifiedName && sourceName === s.qualifiedName) { sourceSymbol = s; break }
                   if (s.qualifiedName && sourceName.endsWith(`:${s.qualifiedName}`)) { sourceSymbol = s; break }
                   if (s.qualifiedName && s.qualifiedName.endsWith(`.${sourceLeaf}`)) { sourceSymbol = s; break }
                 }
               }
             }
 
             let sourceId: string | null
             let sourceExternal: string | null = null
             if (sourceIdFromSpan) {
               // #612 source half: the edge's own line placed its container, and
               // that placement is the one the enclosure asserts. `sourceExternal`
               // stays null — the source IS resolved.
               sourceId = sourceIdFromSpan
             } else if (sourceSymbol) {
               // Defensive export filter: reject exports of non-public or package-decl symbols
               if (relType === "exports") {
                 const vis = sourceSymbol.visibility || sourceSymbol.modifiers
                 if (vis === "private" || vis === "protected") continue
                 const name = sourceSymbol.name || ""
                 if (/^[a-z][a-z0-9_.]*$/.test(name) && name.includes(".")) continue
                 if (sourceSymbol.type === "package" || sourceSymbol.kind === "package") continue
               }
               sourceId = `${fileId}:${sourceSymbol.name}:${sourceSymbol.startLine || 0}`
             } else {
               // Phase 4: No dummy symbols. Use source_external for relationships
               // where the source symbol isn't in the same file (top-level calls,
               // cross-file refs). source_symbol_id is nullable.
               if (relType === "exports") {
                 const dummyName = sourceLeaf || sourceName.replace(/[:.]/g, "_").replace(/:?\d+$/, "")
                 if (/^[a-z][a-z0-9_.]*$/.test(dummyName) && dummyName.includes(".")) continue
                 if (/^[a-z][a-z0-9_.]*$/.test(targetName) && targetName.includes(".")) continue
               }               sourceId = null
               sourceExternal = sourceName
             }

             // M60/#910: a FILE-LEVEL dependency is a module -> module edge, so
             // when its source did not resolve to a symbol it is the IMPORTING
             // FILE that is the importer — not the file-scope placeholder scope
             // name the analyzer had to spell (`global`). Without this the
             // stored row named no importer at all, which is why no surface
             // could answer "what does this file include": the row existed, the
             // dependency existed, and the only thing missing was who declared
             // it. The analyzer's own spelling is kept in metadata.scopeName
             // (nothing is discarded), and the row's `source_external` now
             // holds the project-relative path every reader keys on.
             if (!sourceSymbol && rel.metadata?.fileLevel === true) {
               rel.metadata = rel.metadata || {}
               rel.metadata.scopeName = rel.metadata.scopeName ?? sourceName
               sourceExternal = relativePath
             }

             // (the analyzer's own line — `relLine` — is declared far above: it
             // feeds the #612 source half, the #612 containment target rule
             // immediately below, and the source-attribution fallback further
             // down. NULL when the analyzer could not derive one — never a
             // fabricated 0.)
             // RESOLVE target_symbol_id at insert time — avoid expensive global UPDATE later.
             // #612 follow-up: a `contains` edge is resolved with the line it
             // carries (see resolveContainsTargetStmt), which is the only anchor
             // that distinguishes the many same-named members a C-family file
             // declares. Every other relationship type keeps line_number as a
             // SITE (where the call/read happened) and must NOT be resolved by it.
             // MEASUREMENT SWITCH, off by default: with BB_TEST_SKIP_EDGE_RESOLVE=1 the
             // per-edge resolve is skipped entirely, so the store phase can be measured
             // with and without it. It exists because the per-edge SELECT was believed
             // to dominate the store ("C did not disappear, it moved into the store"),
             // and a belief about where time goes is worth one experiment. Used by
             // script/perf/probe-store-phases.ts; it leaves target_symbol_id NULL, so the
             // graph is NOT correct in this mode and nothing but a measurement may use it.
             // MEASUREMENT SWITCH, off by default: with BB_TEST_SKIP_EDGE_RESOLVE=1 the
             // per-edge resolve is skipped entirely, so the store phase can be measured
             // with and without it. It leaves target_symbol_id NULL, so the graph is NOT
             // correct in this mode and nothing but a measurement may use it.
             //
             // Why it exists, and why it is only a switch: the per-edge SELECT was
             // believed to dominate the store ("C did not disappear, it moved into the
             // store"). Measured on n200 (62,085 relationships), it costs 2.7-9.8 s of a
             // 24-44 s store phase — real, but not dominant. Attempting to REMOVE it by
             // deferring to the resolution pass was tried and reverted twice, because the
             // resolution fingerprint showed the final graph changing:
             //   skip every non-contains edge   1,171 edges lost their target (dotted and
             //                                  qualified names have no other resolver in
             //                                  the pool path)
             //   skip only _i13_pick's rows       249 edges bound differently, because the
             //                                  pass's ranking is not this statement's
             // So removing it safely needs a dotted/qualified resolver in the pass AND a
             // reconciliation of those 249 bindings. Until then this switch measures the
             // cost and the eager resolve stays.
             const skipEdgeResolve =
               process.env.BB_TEST_SKIP_EDGE_RESOLVE === "1" ||
               // `skipResolution` means "a resolution pass will follow" — what the flag has
               // always meant to its CALLERS (the worker pool stores every chunk with it;
               // the in-process path clears it only on the final batch). It used to skip
               // only the block after this loop, so the eager SELECT ran anyway.
               //
               // It can be skipped now because the pass covers every shape a non-`contains`
               // edge can have: bare names by `_i13_pick`, dotted names by strategy 3 (added
               // for exactly this), `<module>:<item>` by the import resolver. The pass reads
               // the COMPLETE symbol set, so its answer does not depend on which worker
               // finished first — which is what makes the graph reproducible at all.
               //
               // `contains` keeps its eager resolve: strategy checks in the pass exclude it
               // and it has no other resolver.
               // BB_TEST_FORCE_EDGE_RESOLVE=1 is the A/B arm: it restores the old behaviour
               // so the store phase can be measured both ways in one session, on one machine,
               // interleaved. It changes nothing about the final graph (the pass resolves these
               // rows either way) — it only decides WHERE they are resolved.
               // `contains` IS NO LONGER EXCLUDED. It was the ONE TYPE THAT RESOLVED AT INSERT
               // TIME IN ALL THREE ARMS, so `resolveTargetStmt ... LIMIT 1` saw whatever the table
               // held when the edge was inserted: arm A inserts sorted, arm B reversed, and the
               // same edge met a DIFFERENT PARTIAL TABLE and took a different row. MEASURED
               // (r-lane, `e17595f9b`): `contains` A_vs_B 117 bound->bound in DIFFERENT FILES,
               // against A_vs_C 5 — ORDER, not eagerness, and 5 is the evidence because forcing the
               // eager arm changes nothing for a type that is already always eager.
               //
               // THE `:4438` COMMENT THAT JUSTIFIED THE EXCLUSION OVERSTATES IT. Strategy 1
               // (`:4741-4759`) is `WHERE target_external = _res_qname.qualified_name AND
               // target_symbol_id IS NULL AND project_id = ?` — THERE IS NO TYPE FILTER. The pass
               // skipped a contains row for exactly one reason: the eager select had already given
               // it a `target_symbol_id`. Stop resolving eagerly and Strategy 1 binds it against the
               // COMPLETE table, deterministically — `_res_qname` is built with `MIN(id)` and its
               // own header says why: "Deterministic winner for duplicate qualified names so
               // parallel indexing order can't change resolution results."
               //
               // The only contains exclusions in the pass are `:5590`/`:5632`, both inside
               // `_i13_pick` — the BARE-NAME strategy, which requires `instr(target_external,'.') = 0
               // AND instr(target_external,':') = 0`. A dotted target like `terraform.backend.s3`
               // NEVER REACHES IT, so the exclusion the comment described was never load-bearing.
               //
               // WHY THE `exports` FIX DOES NOT TRANSFER: that symbol is published as
               // `name="backend.s3"` / `qualifiedName="terraform.backend.s3"`, and `resolveTargetStmt`
               // matches `s.name` — so the full target matches no row and the leaf `s3` matches
               // OTHER FILES' `s3`. Strategy 1 matches `qualified_name`, WHICH IS THE FULL TARGET.
               //
               // RISK, STATED: `contains` now depends on the pass, and a miss UNBINDS rather than
               // mis-binds. The falsifier's completeness clause (`bound A/B/C >= 9,790`) is what
               // catches that — every other clause is a between-arms count, which a fix that merely
               // unbound the rows would satisfy.
               (process.env.BB_TEST_FORCE_EDGE_RESOLVE !== "1" &&
                 options.skipResolution === true)
             const resolvedRow = skipEdgeResolve
               ? null
               : relType === "contains" && relLine !== null
                 ? (resolveContainsTargetStmt.get(projectId, targetLeaf, fileId, relLine, fileLang) as any)
                 // KEY SELECTION, not key REDUCTION. `:4294` derives `targetLeaf` and this line
                 // USED it, so the eager select asked for `main` while the deferred pass asked for
                 // `aws_lambda_function.main`: `resolveTargetStmt` orders `(s.file_id = ?) DESC`
                 // over `WHERE s.name = ?`, so THE KEY IS THE QUESTION ASKED OF `s.name`.
                 // MEASURED (r-lane, 1c2aea5a4): `exports` differing rows are ZERO under file-order
                 // reversal and 100 under eager-vs-deferred, bound->bound — A binds the declaration
                 // in the edge's OWN file, C binds a bare `main` in ANOTHER file.
                 // The same-file preference cannot save a leaf-keyed lookup unless that file
                 // declares a symbol named exactly the key asked for; here it declares
                 // `aws_lambda_function.main`, so ASKING THE FULL NAME MAKES THE PREFERENCE DO ITS JOB.
                 // FULL NAME FIRST, LEAF ONLY AS A FALLBACK — never a replacement. Reversing the
                 // order reinstates the defect for every colliding leaf. `get()` returns undefined
                 // on no row, so `??` is the right operator. DO NOT FOLD `contains` IN: it is
                 // excluded from the skip, always eager, and its 113-116 order rows are a different
                 // mechanism with a different fix.
                 : ((resolveTargetStmt.get(projectId, targetName, fileId, fileLang) ??
                     resolveTargetStmt.get(projectId, targetLeaf, fileId, fileLang)) as any)
             const targetId = resolvedRow?.id || null
 
             // is_cross_file must be honest: 1 only when the resolved target
             // lives in a DIFFERENT file than the source (fileId is the current
             // file's id). Same-file edges must stay 0 — the resolution passes
             // below recompute this flag only for rows they resolve, so rows
             // resolved here would otherwise carry the wrong value forever.
             const relIsCrossFile = sourceId !== null && !!resolvedRow?.file_id && resolvedRow.file_id !== fileId ? 1 : 0
             // Cross-language: target resolved to a symbol whose file language
             // differs from the source file's. Previously this flag was only set
             // when analyzers self-declared it in metadata (only r did), so real
             // cross-language edges (groovy extends java etc.) stored 0.
             const targetLang = String(resolvedRow?.language ?? "").toLowerCase()
             const relIsCrossLanguage =
               relIsCrossFile && !!targetLang && !!fileLang && targetLang !== fileLang ? 1 : 0
 
             const MAX_SYMBOL_NAME_LENGTH = 255
             const GENERIC_SOURCE_NAMES = new Set([
               "unknown", "SCSS_FILE_SCOPE",
               "window", "exports", "default", "GlobalScope",
             ])
             // Intra-class receiver names that should be resolved to the enclosing class
             const INTRA_CLASS_RECEIVERS = new Set(["self", "this", "me", "Self"])
             // Check just the leaf name (after last : and .) for filtering
             const leafForCheck = extractLeaf(sourceName)
             const isBlockScopeName = /^[\w]+\.block_\d+/.test(leafForCheck) || /^block_\d+/.test(leafForCheck)
 
             // BUG 4 FIX: Resolve intra-class receivers (this/self/me) to the enclosing class
             if (INTRA_CLASS_RECEIVERS.has(leafForCheck)) {
               // First container-kind symbol in the sorted array — matches original find().
               const enclosingSymbol = firstContainerSymbol
               if (enclosingSymbol) {
                 const enclosingStartLine = enclosingSymbol.startLine ?? enclosingSymbol.range?.startLine ?? 0
                 sourceId = `${fileId}:${enclosingSymbol.name}:${enclosingStartLine}`
                 // Also update the relationship source metadata
                 rel.metadata = rel.metadata || {}
                 rel.metadata.resolvedReceiver = true
                 rel.metadata.originalSource = leafForCheck
               }
               // If no enclosing class found, fall through — this becomes a regular relationship
             }
 
             // M51.A3 (#718): a same-file endpoint that names a symbol this file
             // will NOT store must become an external edge (NULL id + name),
             // never a dangling id. Previously the id was written because the
             // raw symbol existed — but insert-time filters (artifact name,
             // startLine < 1, denylist) could skip the row, leaving dead edges
             // (observed: 32 anonymous-symbol edges in m14 fixtures). A source
             // that fails the storeable replica degrades to source_external.
             const sameFileIdOk = (cand: string | null): boolean => {
               if (cand === null) return true
               if (!cand.startsWith(`${fileId}:`)) return true
               const m = /:(\d+)$/.exec(cand)
               if (!m) return false
               const line = Number(m[1])
               // The symbol's NAME, recovered by removing the fileId prefix and
               // the trailing `:<line>` — NOT the last colon-segment.
               //
               // The distinction is load-bearing and was a real defect. A symbol
               // id is `${fileId}:${name}:${line}`, and a NAME MAY CONTAIN A
               // COLON: the CSS selector `:root` has id `…:a.css::root:1`. The
               // old `/^.*:([^:]+):\d+$/` took the last colon-segment, so it read
               // that name as `root` — and `"root"` is in SYMBOL_NAME_DENYLIST
               // ("root-level nodes that are always noise"). The check therefore
               // concluded the `:root` row would not be stored, and UN-BOUND
               // every `contains :root -> --x` edge to an external reference.
               // The row IS stored, because the insert-time guard tests the FULL
               // name (`:root`), which is not on the list.
               //
               // So this was a third implementation of the storeable test that
               // was not an exact mirror of the insert-time guards — the exact
               // failure M51.A1/A3 documents ("the storeable-row replica used by
               // BOTH the owner-assignment path and the relationship-source path
               // must stay an exact mirror"). It hit CSS hardest because `:root`
               // is the single most common custom-property scope in the language,
               // and it was invisible because the lane had no store-scale check.
               //
               // Any language with a symbol whose leaf is a denylisted scope word
               // was affected the same way — a class named `Root` in Java or
               // C#, a `global` in JavaScript.
               const name = cand.slice(fileId.length + 1, cand.length - m[0].length)
               return storeableName(name, line)
             }
             // (the analyzer's own line is hoisted far above — see the `relLine`
             // declaration next to the target resolution; it feeds both the
             // #612 containment target rule and the M59/#855 source fallback)
             // M59/#855: an edge whose analyzer source is a synthetic scope this
             // file will not store (anonymous_*/block_N/lambda_N/object_N) used to
             // be stored with a NULL source id — FK-legal, but UNATTRIBUTABLE, so
             // every symbol-joined consumer (bb_graph callers, impact, coupling)
             // silently lost the CALL SITE. Measured on cats-effect: TimeT.scala
             // line 148 sits in an anonymous Fiber body, so bb_graph answered 3 of
             // that file's 4 real `liftF` call sites and #855 was filed as an
             // analyzer emission gap — the analyzer DID emit the edge; the index
             // dropped the attribution.
             //
             // Attribute such an edge to the innermost STOREABLE symbol enclosing
             // its own call-site line: the lexical owner the call actually
             // executes under (for TimeT: the anonymous body's enclosing method
             // `fiberize`). The analyzer's synthetic spelling goes to
             // metadata.syntheticSource rather than source_external, so
             // `source_external IS NOT NULL` keeps meaning "unresolved caller".
             // #865, re-measured 2026-10-31: the note here used to say the
             // enrichment pass REPLACES the whole metadata object and these keys
             // therefore did not survive a full index. That was wrong, and the
             // merge is deliberate: `mergeMetadata` in brain-relationship-enrichment
             // spreads the STORED metadata and deletes only `ENRICHMENT_OWNED_KEYS`
             // (role, pattern, layerFlow, criticality, frequency, isTestCode,
             // isGeneratedCode, isFrameworkContract, isDependencyInjection,
             // inferredAt) before writing its own. Nothing else is dropped, so an
             // analyzer key survives an index the way any other does.
             //
             // Measured, not argued: `script/m59/probe-865-metadata-survival.ts`
             // indexes a two-file java fixture through the REAL pipeline and
             // reports `evidenceClass: 6` — an analyzer-emitted key, not an
             // enrichment key, on all 6 stored rows — alongside the enrichment
             // keys in the same objects (`layerFlow`, `criticality`, `frequency`).
             // The two sets coexist, which is the whole claim. `syntheticSource`
             // and `attributedToEnclosing` are in neither set, so they take the
             // same path; the resolved source id remains the durable attribution,
             // and these two keys stay as the explanation of how it was reached.
             // Falls back to the historical NULL-id external edge when the line
             // is unknown or no storeable symbol encloses it.
             if (!sameFileIdOk(sourceId)) {
               const enclosingId = enclosingStoreableId(relLine)
               if (enclosingId) {
                 sourceId = enclosingId
                 rel.metadata = rel.metadata || {}
                 rel.metadata.syntheticSource = sourceName
                 rel.metadata.attributedToEnclosing = true
               } else {
                 sourceExternal = sourceExternal ?? sourceName
                 sourceId = null
               }
             }
 
             if (
               leafForCheck.length > MAX_SYMBOL_NAME_LENGTH ||
               GENERIC_SOURCE_NAMES.has(leafForCheck) ||
               isBlockScopeName
             ) {
               continue
             }              // Deterministic relId. INSERT OR IGNORE skips duplicates, so the
              // identity decides what "a duplicate" even means.
              //
              // M59/#822: identity includes the call-site line WHEN the analyzer
              // derived one. The old `${projectId}:rel:${sourceId}:${targetName}:${relType}`
              // collapsed every genuine call site of one callee onto one row —
              // measured on a fixture with exactly 4 calls: 1 row survived, so
              // bb_graph could only ever report "one caller" for a method
              // invoked four times, and the agent had to fall back to grep for
              // the sites it could not see (script/m59/verify-rel-multiplicity.ts).
              // Line-less edges keep the previous identity exactly, so languages
              // whose analyzer emits no line are unchanged (their per-site rows
              // are unprovable until #825 lands — never fabricated here).
              const relId = `${projectId}:rel:${sourceId}:${targetName}:${relType}:${relLine ?? "?"}`

 
             stmt.insertRelationship.run(
               relId,
               projectId,
               sourceId,
               targetId,
               sourceExternal,  // source_external — non-null when source not found in file
               targetName,       // target_external
               relType,
               rel.confidence || 1.0,
               rel.context || null,
               // M59.O2: the analyzer's own call-site line — never a fabricated
               // 0. NULL when the analyzer could not derive one, so every
               // reader must handle "unknown" instead of a number that silently
               // meant "unknown" (graph-engine's `row.lineNumber || node.line`
               // turned that 0 into the caller symbol's declaration line).
               relLine,
               relIsCrossFile,
               rel.metadata?.isCrossLanguage || relIsCrossLanguage ? 1 : 0,
               rel.metadata?.bridgeMechanism || (relIsCrossLanguage ? "name-resolution" : null),
               rel.metadata ? JSON.stringify(rel.metadata) : null,
               now,
               now,
             )
             totalRelationships++
             fileRelCount++
           }
             if (fileRelCount === 0 && result.relationships.length > 5) {
               process.stderr.write(`[REL-LOSS] ${relativePath}: engine=${result.relationships.length} rels, stored=0\n`)
             }
         }
       }
     })
     // #737: per-batch diagnose closure bound to THIS batch's tx. On an FK
     // failure it re-runs the batch file-by-file under capturing wrappers
     // inside a transaction that ALWAYS rolls back (pure diagnostics), then
     // names the exact offending file + statements on stderr.
     const diagnoseBatchFailure = createStoreDiagnostics({
       rawDb,
       tx: (b: any[]) => tx(b),
       stmt,
       stmtOriginal,
       write: (s: string) => process.stderr.write(s),
       warn: (m: string, ctx: Record<string, unknown>) => log.warn(m, ctx),
     })
     try {
       // Injected failure for the verification gate (see failOnce above): the batch
       // rolls back exactly as a constraint violation or a full disk would.
       if (injectFailure()) {
         throw new Error(
           `injected store failure (BB_TEST_FAIL_STORE_${failAlways ? "ALWAYS" : "ONCE"}=1)`,
         )
       }
       tx(batch)
       totalSymbols += batchSymbols
       totalRelationships += batchRelationships
       totalImports += batchImports
     } catch (error) {
       rolledBackBatches++
       rolledBackFiles += batch.length
       // #737: before skipping, re-run the batch file-by-file under capturing
       // wrappers to identify the exact violating row (previous behavior printed
       // only the driver message, leaving the rollback undiagnosable).
       diagnoseBatchFailure(error, batch)
       process.stderr.write(`[storeResults] batch ${i}-${i+batchSize} ROLLED BACK: ${error instanceof Error ? error.message : String(error)}\n`)
       log.error("batch insert failed", {
         error: error instanceof Error ? error.message : String(error),
         batchStart: i,
         batchSize,
       })
       // Transaction rolled back — the counter increments inside it are invalid.
       // Skip to next batch; don't count these as stored.
     }
 
     await new Promise((r) => setTimeout(r, 1))
   }
 
   // ========================================================================
   // ASYNC SEMANTIC EMBEDDINGS (BACKGROUND QUEUE)
   // Embeddings are non-blocking for indexing: they are queued on a shared,
   // serialized background drainer and processed after the main indexing
   // completes, so users get usable code intelligence immediately while
   // semantic vectors populate lazily. See queueBackgroundEmbeddings above.
   // ========================================================================
   if (semanticBatch.length > 0) {
     // Copy, never reference: semanticBatch is cleared below and must not
     // take the queued items down with it.
     const items = [...semanticBatch]
     semanticBatch.length = 0 // Clear to prevent double-processing
     queueBackgroundEmbeddings(projectId, projectPath, items)
   }
 
   // ========================================================================
   // MULTI-STRATEGY RELATIONSHIP RESOLUTION (optimized with temp table)
   // Build a lookup table once, then UPDATE via JOIN — avoids O(N*M)
   // correlated subqueries that kill performance on 100K+ relationships.
   // ========================================================================
   if (!options.skipResolution) {
     const symbolCount = rawDb
       .prepare(`SELECT count(*) as c FROM brain_symbol WHERE project_id = ?`)
       .get(projectId) as any
     if (symbolCount && symbolCount.c > 0) { // Always run — now fast since most relationships resolved at insert time
       log.info("resolving external symbol references", { symbolCount: symbolCount.c })
       try {
         // Build lookup tables — use individual run() calls (compiled Bun doesn't support exec())
         rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qname (qualified_name TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, file_id TEXT)`)
         rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_name_unique (name TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, file_id TEXT)`)
         rawDb.run(`DELETE FROM _res_qname`)
         rawDb.run(`DELETE FROM _res_name_unique`)
         // Dedup on insert: duplicate qualified names across files must not
         // abort the whole resolution pass (PK conflict).
         // Deterministic winner for duplicate qualified names (MIN(id)) so
         // parallel indexing order can't change resolution results.
         rawDb.run(`INSERT OR IGNORE INTO _res_qname (qualified_name, symbol_id, file_id) SELECT qualified_name, MIN(id), MIN(file_id) FROM brain_symbol WHERE project_id = '${projectId}' AND qualified_name IS NOT NULL GROUP BY qualified_name`)
         rawDb.run(`INSERT OR IGNORE INTO _res_name_unique (name, symbol_id, file_id) SELECT name, MIN(id), MIN(file_id) FROM brain_symbol WHERE project_id = '${projectId}' GROUP BY name HAVING COUNT(*) = 1`)
 
         // Strategy 1: Qualified name exact match
         rawDb.run(`
           UPDATE brain_relationship
           SET target_symbol_id = _res_qname.symbol_id,
               is_cross_file = CASE WHEN _res_qname.file_id != (
                 SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1
               ) THEN 1 ELSE 0 END
           FROM _res_qname
           WHERE brain_relationship.target_external = _res_qname.qualified_name
             AND brain_relationship.target_symbol_id IS NULL
             AND brain_relationship.target_external IS NOT NULL
             AND brain_relationship.project_id = '${projectId}'
         `)
 
         // Strategy 2: Name-only match with uniqueness
         rawDb.run(`
           UPDATE brain_relationship
           SET target_symbol_id = _res_name_unique.symbol_id,
               is_cross_file = CASE WHEN _res_name_unique.file_id != (
                 SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1
               ) THEN 1 ELSE 0 END
           FROM _res_name_unique
           WHERE brain_relationship.target_external = _res_name_unique.name
             AND brain_relationship.target_symbol_id IS NULL
             AND brain_relationship.target_external IS NOT NULL
             AND brain_relationship.project_id = '${projectId}'
         `)
 
         // Strategy 3: Qualified name partial match for dotted names.
         //
         // MIN(sym.id), not `LIMIT 1`. Strategies 1 and 2 above both take MIN(id)
         // and say why: "Deterministic winner for duplicate names so parallel
         // indexing order can't change resolution results". Strategy 3 was the
         // one that did not, and `LIMIT 1` with no ORDER BY lets SQLite return
         // any matching row — so when a bare name matched several symbols the
         // winner was arbitrary.
         //
         // Measured on zod/src (324 real TypeScript files, 9,950 symbols),
         // indexing the SAME code into two separate roots:
         //
         //   43,347 relationships in each — identical COUNTS
         //   38,297 identical identity AND identical resolved target
         //        5,050 same identity, DIFFERENT resolved target
         //            calls 4,315 of 25,672 | references 550 | instantiates 107
         //        0 identities present in one index and not the other
         //
         // so no edge was found or lost — the same edges were found, and 12% of
         // them were attached to a different symbol depending on which run you
         // had. `bb_graph` and `bb_analyze callers/callees` therefore answered
         // differently for two people with identical code, and no cache key, diff
         // or audit trail was possible. The unattached count moved too: 14,359 vs
         // 14,450.
         //
         // `contains`, `overrides` and `implements` were stable, because they
         // resolve structurally (strategy 4 / explicit ids) rather than by name.
         // `calls`, the type real code produces most of, was the least stable.
         rawDb.run(`
           UPDATE brain_relationship
           SET target_symbol_id = (
               SELECT MIN(sym.id) FROM brain_symbol sym
               WHERE sym.name = SUBSTR(brain_relationship.target_external, INSTR(brain_relationship.target_external, '.') + 1)
                 AND sym.project_id = '${projectId}'
           )
           WHERE brain_relationship.target_symbol_id IS NULL
             AND brain_relationship.target_external IS NOT NULL
             AND brain_relationship.project_id = '${projectId}'
             AND INSTR(brain_relationship.target_external, '.') > 0
             -- A PATH IS NOT A MEMBER CHAIN, and this is the SECOND SITE of the same defect.
             -- extractLeaf (above) carried it in TypeScript: synthetic/main.zig split on '.'
             -- yields the EXTENSION zig, so a file reference binds to whatever symbol is named
             -- after its extension. json-lane measured 4,490 of 4,579 bound file-shaped edges
             -- (98.1%) bound to an extension-named symbol. The TypeScript separator test closed
             -- that rung AND THIS SQL RUNG RE-OPENED IT one step later: the SUBSTR below fires
             -- exactly where the repaired path now leaves NULL. Measured on the new store:
             -- 83,335 edges bound by this expression, 702 of them PATH-SHAPED.
             --
             -- The fix was CORRECT AND INSUFFICIENT, and the acceptance arms said so:
             --   ARM 1 FAILS  extension-named bindings 4,490 -> 4,490 (no movement)
             --   ARM 4 FAILS  bound/unbound            4,579/10 -> 4,579/10
             --   ARM 2 PASSES member paths still bind (not too wide)
             --   ARM 3 PASSES 2,259 member chains still reduce to their leaf (not too narrow)
             -- The guards mirror the TypeScript test exactly: a target carrying a path separator
             -- is left for a FILE CLAIM, never reduced to its extension.
             AND INSTR(brain_relationship.target_external, '/') = 0
         `)
 
         // Strategy 4 (M60, review JD2): the `<module>:<item>` import form.
         // See the standalone resolver for the full note. SAME shared
         // implementation as site 2 — the decision logic is unit tested in
         // src/ast/import-resolution.ts, so this is a call rather than a third
         // copy of the rules. Before the cross-language pass on purpose, for
         // the reason spelled out there.
         {
           const imp4 = resolveImportTargets(rawDb as any, projectId)
           if (imp4.resolved > 0) log.debug("import-target resolution (M60 JD2, inline)", { scanned: imp4.scanned, resolved: imp4.resolved })
         }

         // The OWNER CHANNEL's claim over the rows that state their own receiver.
         //
         // Placed here, immediately before the cross-language pass and after every
         // name-based strategy, for one reason: it RE-BINDS rows, so every pass below
         // has to see the final target rather than the ranking's guess. A member read
         // whose receiver the analyzer could name is a row a rule exists for, and the
         // ranking's answer for it is chosen by `s.id` TEXT order, which is a tie-break
         // and not a fact about PHP — see `claimOwnerCarryingTargets` for the full note,
         // the measurement on php's whole population, and the trade it makes.
         {
           const ownerClaim = claimOwnerCarryingTargets(rawDb as any, projectId)
           if (ownerClaim.withdrawn > 0) {
             log.debug("member owner resolution (owner channel authoritative)", {
               withdrawn: ownerClaim.withdrawn,
               scanned: ownerClaim.scanned,
               resolved: ownerClaim.resolved,
               inheritedResolved: ownerClaim.inheritedResolved,
               declined: ownerClaim.ownerAmbiguous + ownerClaim.ambiguousInChain + ownerClaim.notDeclared,
             })
           }
         }

         // Cross-language normalization (polyglot fixture finding, M26 addendum):
         // the strategies above recompute is_cross_file but left is_cross_language
         // and bridge_mechanism stale for rows they resolve — so a TS->JS edge
         // resolved here stored cross_file=1 but cross_lang=0 with no bridge,
         // silently hiding it from cross-language hover/graph. One authoritative
         // pass over every resolved row of the project; UPGRADE-ONLY (a row the
         // analyzer declared cross-language stays 1; a computed-0 row never
         // downgrades) and the bridge is filled only when NULL (never overwrites
         // a declared bridge mechanism).
         rawDb.run(`
           UPDATE brain_relationship
           SET is_cross_language = CASE WHEN EXISTS (
             SELECT 1 FROM brain_symbol ss
             LEFT JOIN brain_file sf ON sf.id = ss.file_id
             JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
             LEFT JOIN brain_file tf ON tf.id = ts.file_id
             WHERE ss.id = brain_relationship.source_symbol_id
               AND COALESCE(sf.language, '') <> ''
               AND COALESCE(tf.language, '') <> ''
               AND lower(sf.language) <> lower(tf.language)
           ) THEN 1 ELSE brain_relationship.is_cross_language END,
           bridge_mechanism = COALESCE(
             brain_relationship.bridge_mechanism,
             CASE WHEN EXISTS (
               SELECT 1 FROM brain_symbol ss
               LEFT JOIN brain_file sf ON sf.id = ss.file_id
               JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
               LEFT JOIN brain_file tf ON tf.id = ts.file_id
               WHERE ss.id = brain_relationship.source_symbol_id
                 AND COALESCE(sf.language, '') <> ''
                 AND COALESCE(tf.language, '') <> ''
                 AND lower(sf.language) <> lower(tf.language)
             ) THEN 'name-resolution' ELSE NULL END
           )
           WHERE brain_relationship.project_id = '${projectId}'
             AND brain_relationship.target_symbol_id IS NOT NULL
         `)
 
         // M60/SDJ-8: cross-file `overrides` retarget.
         //
         // The strategies above resolve a relationship's target_symbol_id BY NAME,
         // which is right for `calls` and `uses` — a name identifies the thing. It
         // is wrong for `overrides`, where the target is a DECLARING ANCESTOR rather
         // than the name the source mentions: an analyzer that cannot see past its
         // own file publishes its best guess (the first supertype), and name
         // resolution then resolves that guess perfectly happily. Measured on
         // scala3: 677 low-confidence `overrides` rows in a 400-file draw, of which
         // 308 (45.5%) pointed at a supertype that does NOT declare the overridden
         // method, and 0 of 677 were fixable from one file. With the project-wide
         // hierarchy persisted (brain_symbol.super_types), 486 of 656 (74.1%)
         // resolve to an ancestor that verifiably declares it and 329 rows move.
         //
         // This runs HERE, after every symbol is stored, because that is the first
         // point at which the hierarchy is complete — the alternative is a second
         // parse pass, which the measurement says is unnecessary (this step costs
         // ~0.02% of index time).
         //
         // It only ever re-points a row at an ancestor that provably DECLARES the
         // method, so it cannot invent an edge; a row whose method no ancestor
         // declares is left exactly as it was, which keeps it visible as declared
         // low-confidence suspicion rather than silently deleting a real override.
         retargetCrossFileOverrides(rawDb as any, projectId)

         // JULIA'S METHOD TABLE, the second landing site for the gate rule
         // (`script/m14/incoming-gate.ts --binding-collapse`, measured there as 1,489 edges moving
         // `amb -> resolved` with `unresolved` unchanged). The name strategies above bind a bare name
         // only when its count in the project is exactly 1, so every edge naming a multi-method
         // binding stays unbound — and the gate MODELS that rule, which is why the model and this pass
         // have to move together or the measurement and the store diverge silently.
         //
         // It is a NO-OP FOR EVERY OTHER LANGUAGE BY CONSTRUCTION: the language guard is a join on
         // `brain_file.language = 'julia'` inside the pass's own SQL, for the rows it may bind and for
         // the declarations that may form a binding, so a project of another language matches nothing.
         // It never re-points a row that already has a target and never rewrites a target's spelling.
         const juliaBind = retargetJuliaMethodTableBindings(rawDb as any, projectId)
         if (juliaBind.bound > 0 || juliaBind.foreignRowsSeen > 0) {
           log.info(
             `julia method-table bindings: ${juliaBind.bound} row(s) bound of ${juliaBind.scanned} ` +
             `unbound julia row(s) scanned, from ${juliaBind.keys} one-binding key(s) over ` +
             `${juliaBind.declarations} declaration(s); ${juliaBind.boundOwnFile} bound to a declaration ` +
             `in the row's own file; ${juliaBind.foreignRowsSeen} non-julia row(s) seen and untouched`,
           )
         }

         // Cleanup temp tables
         rawDb.run(`DROP TABLE IF EXISTS _res_qname`)
         rawDb.run(`DROP TABLE IF EXISTS _res_name_unique`)
       } catch (err) {
         log.warn("relationship resolution pass failed", { error: err })
       }
     } else {
       log.debug("skipping 2nd-pass relationship resolution for large dataset", { symbolCount: symbolCount?.c })
     }
 
     // FIX: Add retry for DELETE on locked database
     const maxRetries = 5
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       try {
         rawDb.prepare(`DELETE FROM brain_query_cache WHERE project_id = ?`).run(projectId)
         break
       } catch (err: any) {
         if (attempt === maxRetries) {
           log.warn("DELETE brain_query_cache failed after retries", { error: err })
         } else {
           const delay = 50 * attempt
           await new Promise((resolve) => setTimeout(resolve, delay))
         }
       }
     }
   } // Close the if (!options.skipResolution) block
 
   return { symbols: totalSymbols, relationships: totalRelationships, imports: totalImports, rolledBackBatches, rolledBackFiles }
  } finally {
    // M54.P1: restore the open-time FK policy on EVERY exit path (success,
    // throw, early return). The connection is process-cached and shared —
    // leaving it FK-OFF here would silently disable enforcement everywhere.
    if (process.env.BB_FK_ENFORCE === "0") {
      rawDb.run("PRAGMA foreign_keys = OFF")
    } else {
      rawDb.run("PRAGMA foreign_keys = ON")
    }
  }
}

// ============================================================================
// RELATIONSHIP RESOLUTION (run once at the end of indexing)
// ============================================================================

/**
 * What the name-resolution pass DID, in the terms the scaling gate measures.
 *
 * Reported from inside the pass on purpose. `script/perf/verify-scaling-linear.ts`
 * used to count candidates with its own SQL — a replica of the window plan's join —
 * so when the plan changed the gate kept measuring the old shape and the mismatch
 * read as an unexplained red. A gate may not certify a plan that is not the one
 * running; the number now comes from the table the live plan materialised.
 */
export interface ResolvePlanStats {
  /** Which plan the pass executed. */
  plan: "window" | "linear"
  /**
   * Rows in the largest intermediate the plan materialised. For the window plan
   * that is the ranked (relationship × same-named-symbol) relation — the `R × C`
   * fan-out; for the linear plan it is a per-name aggregate, bounded by the symbol
   * table. Comparable across plans by construction, which is what lets one check
   * bound both.
   */
  largestIntermediate: number
}

async function resolveRelationships(projectId: ProjectID): Promise<ResolvePlanStats | null> {
  const { BrainDatabase } = await import("../brain/database")
  const rawDb = await BrainDatabase.getRawInstance(projectId)

  log.debug("starting final relationship resolution")

  const unresolved = (rawDb.prepare(
    `SELECT count(*) as c FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL AND project_id = ?`
  ).get(projectId) as any)?.c || 0

  if (unresolved === 0) {
    // `null`, not a zero: a pass that did not run must not report the best
    // possible measurement, and the gate throws on an absent one.
    log.debug("no unresolved relationships to resolve")
    return null
  }

  let stats: ResolvePlanStats | null = null

  try {
    // Build temp lookup tables once — avoids O(n*m) correlated subqueries
    rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qname (qualified_name TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, file_id TEXT)`)
    rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_name (name TEXT, symbol_id TEXT NOT NULL, file_id TEXT, cnt INTEGER)`)
    rawDb.run(`DELETE FROM _res_qname`)
    rawDb.run(`DELETE FROM _res_name`)

    // Populate qualified names (exact matches)
    rawDb.prepare(
      `INSERT OR IGNORE INTO _res_qname (qualified_name, symbol_id, file_id)
       SELECT qualified_name, MIN(id), MIN(file_id) FROM brain_symbol
       WHERE project_id = ? AND qualified_name IS NOT NULL GROUP BY qualified_name`
    ).run(projectId)

    // Populate names with uniqueness count
    rawDb.prepare(
      `INSERT OR IGNORE INTO _res_name (name, symbol_id, file_id, cnt)
       SELECT name, id, file_id, COUNT(*) OVER (PARTITION BY name)
       FROM brain_symbol WHERE project_id = ?`
    ).run(projectId)

    // Create indexes on temp tables
    rawDb.run(`CREATE INDEX IF NOT EXISTS _res_name_idx ON _res_name(name)`)
    rawDb.run(`CREATE INDEX IF NOT EXISTS _res_name_uniq_idx ON _res_name(name, cnt)`)

    // ── OWN-FILE PREFERENCE (M14 clause 4). Both lookup tables below collapse every name
    // and every dotted suffix to ONE global winner via `MIN(id)` — the lexicographically
    // smallest symbol id in the PROJECT. File paths sort, so an edge written in
    // `tests/docbook/html/admon.xsl` binds to the same-named template declared in the
    // PARALLEL tree `tests/docbook/fo/admon.xsl`: measured on libxslt, 138 of 388 `calls`
    // edges did exactly that, every one of them classified `in-document` by the analyzer
    // (i.e. the declaration IS in the edge's own file). The two statements below run FIRST
    // and bind only edges whose target is declared in the edge's OWN file; the project-wide
    // statements that follow are untouched and still fire for every row they fired for
    // before, because they require `target_symbol_id IS NULL`.
    rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qname_own (qualified_name TEXT, file_id TEXT, symbol_id TEXT NOT NULL)`)
    rawDb.run(`DELETE FROM _res_qname_own`)
    rawDb.prepare(
      `INSERT INTO _res_qname_own (qualified_name, file_id, symbol_id)
       SELECT qualified_name, file_id, MIN(id) FROM brain_symbol
       WHERE project_id = ? AND qualified_name IS NOT NULL GROUP BY qualified_name, file_id`
    ).run(projectId)
    rawDb.run(`CREATE INDEX IF NOT EXISTS _res_qname_own_idx ON _res_qname_own(qualified_name, file_id)`)
    const r0own = rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_qname_own.symbol_id,
          is_cross_file = 0
      FROM _res_qname_own
      WHERE brain_relationship.target_external = _res_qname_own.qualified_name
        AND _res_qname_own.file_id = (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1)
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'
    `)

    // ── OWN-FILE NAME PREFERENCE (arm B). The 15 `calls` rows arm A could not reach are bound by
    // strategy 1's PROJECT-WIDE qualified-name match to a symbol in another file whose qualified
    // name happens to equal the edge's target — measured shape: `colspec.colnum` binds to an
    // attribute symbol in `tests/docbook/test/article2.xml` (qualified_name exactly
    // `colspec.colnum`) while the edge's own file declares `colspec.colnum` as a template. The
    // analyzer's class for those edges is `in-document`, i.e. the declaration IS in the own file,
    // so the own file's NAME match is the intended target and the cross-file qualified-name match
    // is a coincidence. This runs after the own-file qualified-name pass (a stronger signal within
    // the same file) and before the project-wide statements.
    rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_name_own (name TEXT, file_id TEXT, symbol_id TEXT NOT NULL)`)
    rawDb.run(`DELETE FROM _res_name_own`)
    rawDb.prepare(
      `INSERT INTO _res_name_own (name, file_id, symbol_id)
       SELECT name, file_id, MIN(id) FROM brain_symbol
       WHERE project_id = ? GROUP BY name, file_id`
    ).run(projectId)
    rawDb.run(`CREATE INDEX IF NOT EXISTS _res_name_own_idx ON _res_name_own(name, file_id)`)
    const r0ownName = rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_name_own.symbol_id,
          is_cross_file = 0
      FROM _res_name_own
      WHERE brain_relationship.target_external = _res_name_own.name
        AND _res_name_own.file_id = (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1)
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'
    `)

    // Strategy 1: Qualified name exact match (fast JOIN)
    const r1 = rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_qname.symbol_id,
          is_cross_file = CASE WHEN _res_qname.file_id != COALESCE(
            (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
          ) THEN 1 ELSE 0 END
      FROM _res_qname
      WHERE brain_relationship.target_external = _res_qname.qualified_name
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'
    `)

    // Strategy 2: Unambiguous name match (only if unique)
    const r2 = rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_name.symbol_id,
          is_cross_file = CASE WHEN _res_name.file_id != COALESCE(
            (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
          ) THEN 1 ELSE 0 END
      FROM _res_name
      WHERE brain_relationship.target_external = _res_name.name
        AND _res_name.cnt = 1
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'
    `)

    const resolvedBeforeDotted = (r0own?.changes || 0) + (r0ownName?.changes || 0) + (r1?.changes || 0) + (r2?.changes || 0)

    // Strategy 3 (M60 determinism fix): a DOTTED target, by SUFFIX on qualified_name.
    //
    // An edge written `ASTEngine.LanguageAnalyzer` could not be matched by strategy 1,
    // because a stored `qualified_name` is prefixed with the file stem:
    //
    //     edge says      ASTEngine.LanguageAnalyzer
    //     symbol holds   t0128_engine.ASTEngine.LanguageAnalyzer
    //
    // so the exact comparison can never be true for those rows, and the `_i13_*` plan
    // excludes dots and colons by construction. The ONLY resolver for a dotted target was
    // therefore the eager one at INSERT time, which reads a partially-populated database
    // and binds whatever file happened to be stored first. Measured on n200 before this
    // strategy: 1,200 dotted edges unattached and 322 of 62,085 bindings differing between
    // two identical runs, every one of them this shape.
    //
    // The lookup table is built the same way strategies 1 and 2 build theirs — one pass over
    // the symbols, indexed once — rather than a correlated `substr()` per relationship. The
    // correlated form was tried first and worked (dotted unattached 1,200 -> 424) but cost
    // 68 s of post-processing (13 s -> 82 s on n200), because a function on the column cannot
    // use an index. MIN(id) keeps the tie-break deterministic, as in strategies 1 and 2.
    rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qsuffix (suffix TEXT, symbol_id TEXT NOT NULL, file_id TEXT)`)
    rawDb.run(`DELETE FROM _res_qsuffix`)
    rawDb.run(
      `
      WITH RECURSIVE suffixes(suffix, rest, id, file_id) AS (
        SELECT qualified_name, qualified_name, id, file_id
        FROM brain_symbol
        WHERE project_id = ? AND qualified_name IS NOT NULL
        UNION ALL
        SELECT substr(rest, instr(rest, '.') + 1), substr(rest, instr(rest, '.') + 1), id, file_id
        FROM suffixes WHERE instr(rest, '.') > 0
      )
      INSERT INTO _res_qsuffix (suffix, symbol_id, file_id)
      SELECT suffix, MIN(id), MIN(file_id) FROM suffixes WHERE instr(suffix, '.') > 0 GROUP BY suffix
    `,
      projectId,
    )
    rawDb.run(`CREATE INDEX IF NOT EXISTS _res_qsuffix_idx ON _res_qsuffix(suffix)`)

    // ── OWN-FILE PREFERENCE for the suffix table (see the note above strategy 1): the table
    // above keeps ONE symbol per suffix for the whole project, so a caller in `html/` gets the
    // `fo/` declaration. This per-(suffix, file) table keeps the own-file candidate reachable,
    // and binds it first; the global statement below is unchanged.
    rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qsuffix_own (suffix TEXT, file_id TEXT, symbol_id TEXT NOT NULL)`)
    rawDb.run(`DELETE FROM _res_qsuffix_own`)
    rawDb.run(
      `
      WITH RECURSIVE suffixes(suffix, rest, id, file_id) AS (
        SELECT qualified_name, qualified_name, id, file_id
        FROM brain_symbol
        WHERE project_id = ? AND qualified_name IS NOT NULL
        UNION ALL
        SELECT substr(rest, instr(rest, '.') + 1), substr(rest, instr(rest, '.') + 1), id, file_id
        FROM suffixes WHERE instr(rest, '.') > 0
      )
      INSERT INTO _res_qsuffix_own (suffix, file_id, symbol_id)
      SELECT suffix, file_id, MIN(id) FROM suffixes WHERE instr(suffix, '.') > 0 GROUP BY suffix, file_id
    `,
      projectId,
    )
    rawDb.run(`CREATE INDEX IF NOT EXISTS _res_qsuffix_own_idx ON _res_qsuffix_own(suffix, file_id)`)
    const r3own = rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_qsuffix_own.symbol_id,
          is_cross_file = 0
      FROM _res_qsuffix_own
      WHERE brain_relationship.target_external = _res_qsuffix_own.suffix
        AND _res_qsuffix_own.file_id = (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1)
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND instr(brain_relationship.target_external, '.') > 0
        AND brain_relationship.project_id = '${projectId}'
    `)

    const r3 = rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_qsuffix.symbol_id,
          is_cross_file = CASE WHEN _res_qsuffix.file_id != COALESCE(
            (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
          ) THEN 1 ELSE 0 END
      FROM _res_qsuffix
      WHERE brain_relationship.target_external = _res_qsuffix.suffix
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND instr(brain_relationship.target_external, '.') > 0
        AND brain_relationship.project_id = '${projectId}'
    `)
    // Strategy 3b: the LEAF of a dotted or qualified target, when that leaf is unique
    // in the project.
    //
    // Strategy 3 matches the dot-path, which is precise but fails whenever the referring
    // analyzer writes a module the symbol's `qualified_name` does not carry — measured: a
    // target `ASTEngine.SymbolKind` whose symbol is stored as `t0172_types.SymbolKind`.
    // The eager resolve used to catch those by matching the leaf name (with a proximity
    // ranking that depended on which file was stored first). This restores the coverage
    // without the ordering dependence, and it keeps strategy 2's contract: bind only when
    // the name is UNAMBIGUOUS (`cnt = 1`), so a qualified reference never silently lands
    // on one of several same-named symbols elsewhere in the project.
    //
    // The leaf is computed in JS over the DISTINCT unresolved target names (a few hundred),
    // not per row: SQLite has no "substring after the last occurrence" function, and a
    // correlated expression here is precisely the shape that made the first version of
    // strategy 3 cost 68 s of post-processing.
    const leafUpdate = rawDb.prepare(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_name.symbol_id,
          is_cross_file = CASE WHEN _res_name.file_id != COALESCE(
            (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
          ) THEN 1 ELSE 0 END
      FROM _res_name
      WHERE _res_name.name = ?
        AND _res_name.cnt = 1
        AND brain_relationship.target_external = ?
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.project_id = '${projectId}'
    `)
    const dottedStillNull = rawDb.prepare(`
      SELECT DISTINCT target_external AS t FROM brain_relationship
      WHERE target_symbol_id IS NULL AND target_external IS NOT NULL AND project_id = ?
        AND (instr(target_external, '.') > 0 OR instr(target_external, ':') > 0)
    `).all(projectId) as Array<{ t: string }>
    let resolvedByLeaf = 0
    for (const { t } of dottedStillNull) {
      const leaf = t.split(/[.:]/).pop()
      if (!leaf) continue
      const res = leafUpdate.run(leaf, t)
      resolvedByLeaf += res?.changes || 0
    }

    // Strategy 3c: the SAME ranking the eager resolve used, applied in the pass.
    //
    // Strategy 3b binds a leaf only when it is UNAMBIGUOUS (`cnt = 1`), which is right for a
    // bare name but far too strict for a dotted one: in this repository (200,574 symbols)
    // almost no leaf is unique, so 3b barely fires. Measured on a full index: the eager resolve
    // attached 3,257 MORE edges than the pass did (+2,049 dotted, +2,244 colon), because it was
    // RANKING candidates (definition first, then same file, then same language, then lowest id)
    // and taking the best. The pass has to rank the same way, or removing it is a coverage
    // regression — which is exactly what the full-index comparison caught.
    //
    // It can, and deterministically: the eager resolve ranked against the symbols stored SO FAR,
    // so its answer depended on which worker finished first. This runs after the load over the
    // complete symbol set with the same ORDER BY, so the winner is a function of the corpus.
    //
    // The ranking is computed once into a temp table with ROW_NUMBER() (window functions are
    // already used elsewhere in this file — `_res_name` is built with COUNT(*) OVER), keyed by
    // (target name, source symbol). The UPDATE then joins on that key. The obvious form — a
    // correlated ORDER BY ... LIMIT 1 inside the SET — does NOT work here: SQLite answers
    // `no such column: brain_relationship.source_symbol_id` three levels deep, which aborted the
    // whole phase and left 45,037 attachments at 33,464 (measured).
    if (dottedStillNull.length > 0) {
      rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _res_leafmap (full TEXT PRIMARY KEY, leaf TEXT NOT NULL)`)
      rawDb.run(`DELETE FROM _res_leafmap`)
      const insertLeaf = rawDb.prepare(`INSERT OR IGNORE INTO _res_leafmap (full, leaf) VALUES (?, ?)`)
      for (const { t } of dottedStillNull) {
        // A PATH IS NOT A MEMBER CHAIN — the THIRD site of this defect, and the one that
        // actually bound ghostty's edges. A path-shaped target gets NO leaf entry, so no
        // global name can claim it through the join below. Deliberately narrow: `InitOpts.c`
        // (a field) and `a.b.c` (a member chain) keep the reduction that is CORRECT for them.
        if (t.includes("/") || t.includes("\\")) continue
        const leaf = t.split(/[.:]/).pop()
        if (leaf) insertLeaf.run(t, leaf)
      }
      rawDb.run(`DROP TABLE IF EXISTS temp._res_best`)
      rawDb.run(
        `
        CREATE TEMP TABLE _res_best AS
        SELECT full, src_id, symbol_id, symbol_file FROM (
          SELECT r.target_external AS full,
                 r.source_symbol_id AS src_id,
                 s.id AS symbol_id,
                 s.file_id AS symbol_file,
                 ROW_NUMBER() OVER (
                   PARTITION BY r.target_external, r.source_symbol_id
                   ORDER BY (s.name = m.full) DESC,
                            COALESCE(s.is_declaration, 0) ASC,
                            (s.file_id = (SELECT b.file_id FROM brain_symbol b WHERE b.id = r.source_symbol_id)) DESC,
                            (f.language = (SELECT f2.language FROM brain_file f2
                                            WHERE f2.id = (SELECT b2.file_id FROM brain_symbol b2 WHERE b2.id = r.source_symbol_id))) DESC,
                            s.id ASC
                 ) AS rn
          FROM brain_relationship r
          JOIN _res_leafmap m ON m.full = r.target_external
          JOIN brain_symbol s ON s.project_id = ? AND (s.name = m.full OR s.name = m.leaf)
          LEFT JOIN brain_file f ON f.id = s.file_id
          WHERE r.project_id = ? AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL
        ) WHERE rn = 1
      `,
        projectId,
        projectId,
      )
      rawDb.run(`CREATE INDEX IF NOT EXISTS _res_best_idx ON _res_best(full, src_id)`)
      const r3c = rawDb.run(`
        UPDATE brain_relationship
        SET target_symbol_id = b.symbol_id,
            is_cross_file = CASE WHEN b.symbol_file != COALESCE(
              (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id), ''
            ) THEN 1 ELSE 0 END
        FROM _res_best b
        WHERE b.full = brain_relationship.target_external
          AND b.src_id IS brain_relationship.source_symbol_id
          AND brain_relationship.target_symbol_id IS NULL
          AND brain_relationship.target_external IS NOT NULL
          AND brain_relationship.project_id = '${projectId}'
      `)
      resolvedByLeaf += r3c?.changes || 0
    }

    const resolved = resolvedBeforeDotted + (r3?.changes || 0) + (r3own?.changes || 0) + resolvedByLeaf
    log.debug("relationship resolution completed", {
      resolved,
      resolvedByQualifiedExact: r1?.changes || 0,
      resolvedByUniqueName: r2?.changes || 0,
      resolvedByDottedSuffix: r3?.changes || 0,
      resolvedByOwnFilePreference: (r0own?.changes || 0) + (r0ownName?.changes || 0) + (r3own?.changes || 0),
      resolvedByLeafFallback: resolvedByLeaf,
      unresolved,
    })

    // Strategy 4 (M60, review JD2): the `<module>:<item>` import form.
    //
    // Strategies 1-3 match a bare `name`, a `qualified_name` (`Owner.member`),
    // or — for a dotted target — everything after the first `.`. None of them
    // can match `./util.js:helper`, which is what every analyzer emitting the
    // `module:item` convention actually writes: javascript, typescript,
    // python, dart, and vue/svelte by delegation. Measured end to end on a
    // 2-file project: 4 of 4 `imports` edges UNRESOLVED while `exports` edges
    // (a bare name) and cross-file `calls`/`instantiates` all resolved — the
    // `path:item` FORM is what failed, not the targets.
    //
    // The decision logic lives in src/ast/import-resolution.ts and is unit
    // tested there (30 assertions, including every shape it must refuse), so
    // this is a call, not a fourth copy. It runs BEFORE the cross-language
    // normalization below on purpose: an edge resolved after that pass would
    // store cross_file=1 with cross_lang=0 and no bridge, which is the exact
    // silent-invisibility bug that pass exists to prevent.
    {
      const imp = resolveImportTargets(rawDb as any, projectId)
      if (imp.resolved > 0) {
        log.debug("import-target resolution (M60 JD2)", {
          scanned: imp.scanned, resolved: imp.resolved, remaining: imp.byReason,
        })
      }
    }

    // ── The authoritative name-resolution pass (review I13) ──
    //
    // Strategies 1, 2 and 4 above only fill `target_symbol_id IS NULL`, and that is
    // the whole problem. `storeResults` already resolved most edges at INSERT time,
    // and it could not do it correctly: the relationship loop there sits INSIDE
    // `for (const result of batch)`, so a file's edges are matched against only the
    // symbols stored SO FAR — its own, plus earlier files in the same batch. Which
    // of two same-named symbols an edge binds to therefore depended on the order
    // batches happened to be stored, and because every strategy above requires IS
    // NULL, a wrong attachment made at insert time was never revisited. This
    // function is the first point at which the symbol table is complete, so it is
    // the only place a correction can be correct.
    //
    // MEASURED on zod/src (324 real TypeScript files, 9,950 symbols, 43,347
    // relationships), indexing ONE root twice with a fresh store each time so every
    // id is identical by construction:
    //
    //   brain_file / brain_symbol / brain_import   0 differing rows
    //   resolution agreement   6-12% of edges disagree, varying with scheduling
    //   unattached             14,090 vs 14,139 — a different NUMBER resolve each run
    //
    //   run1 v4/classic/compat.ts:getErrorMap:51
    //   run2 v3/errors.ts:getErrorMap:11
    //
    // Two files exporting a same-named function is everyday, and which one an edge
    // binds to was a function of store order. The counts never move, so every
    // count-based check passed while the graph underneath differed: bb_graph and
    // bb_analyze callers/callees answered differently for two people with identical
    // code, and a bug that reproduced locally but not in CI had no explanation.
    //
    // `contains` and `overrides` were EXACTLY stable, and that is the diagnosis
    // rather than a coincidence: they resolve structurally — by explicit id, and by
    // the edge's own line_number inside its own file — so they never consult a name
    // that could have several candidates.
    //
    // The population is read off the data rather than guessed. Measured over one
    // clean index of that corpus, the attached target's `name` EQUALS
    // `target_external` for 100% of calls, exports, uses, extends, instantiates,
    // implements and contains, 69% of references, and 0% of overrides and imports
    // (those resolve structurally and by the `module:item` form). So the guard below
    // — a bare name, i.e. no `.` and no `:`, which is what strategies 1-4 and this
    // pass between them own — is exactly the name-resolved population, and it leaves
    // dotted `module:item` and structural edges to the strategies above.
    //
    // `contains` is excluded because its target is pinned to the edge's own line
    // rather than to a name, so recomputing it by name would discard the pin.
    //
    // SET-BASED, and that is the whole trick. The obvious formulation is a
    // correlated subquery per row; measured, it takes 167 s for these 43,347
    // relationships, of which 164 s is the apply step alone rescanning the pick
    // table once per relationship. A window function over a join resolves every
    // relationship in one pass: 5.3 s total (109 ms source table, 2.6 s pick,
    // 2.6 s apply). The ranking is `resolveTargetStmt`'s, deliberately — a
    // definition ahead of a declaration (#612), then same-file, then
    // same-language — with `s.id` making the choice total.
    //
    // IDEMPOTENCE is the property that makes this a fix rather than another
    // opinion, and it is checked: the pass is a fixed point, so running it twice
    // assigns identical targets (attachment count 32,082 and a content fingerprint
    // of all 43,347 assignments unchanged). An earlier attempt placed this in
    // `storeResults`, where it resolved against a partial table and could not work;
    // an earlier SQL spelling correlated the UPDATE target from a subquery's ORDER
    // BY, which does not resolve and threw SQLITE_ERROR inside a catch that hid it.
    // Both are why the location and the set-based shape are load-bearing.
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_src`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_tier`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_best_file`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_best_lang`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_best_any`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_pick`)
    // ── THIS IS THE LINEAR PLAN: THREE PER-NAME AGGREGATES, THREE LOOKUPS ──
    //
    // Same ranking as the window function it replaces — definition ahead of
    // declaration, then same-file, then same-language, then lowest id. What changed
    // is how it is computed. The window function joined EVERY relationship to EVERY
    // symbol sharing its target name, materialised all R × C pairs and sorted them to
    // keep R of them, and C is not constant in project size: a popular name
    // accumulates one candidate per file (`constructor`: 104 at 200 files, 329 at
    // 800), so the pass was O(rels × N). Measured on nested pools of this
    // repository's own files (script/perf/make-pools.sh), fresh index per tier:
    //
    //   files  relationships  candidate pairs  pairs/rel   resolve ms
    //      47          7,920           8,598         1.09           246
    //     196         61,333         175,869         2.87         4,335
    //     396         90,971         620,821         6.82        10,846
    //     796        121,782       1,518,309        12.47        20,395
    //
    // pairs/relationship is the term that grows, and it is counted from the written
    // index rather than timed, so it is a property of the DATA and not a load
    // artifact. `script/perf/verify-scaling-linear.ts` bounds it, and its before-arm
    // record (validation/m60/results/scaling-linear.before-linux.json) fails at
    // 2.50× over a 4× tier increase.
    //
    // Three observations make the expensive part unnecessary — and they are CHECKED,
    // not argued. script/perf/probe-i13-equivalence.mjs computes both plans on the
    // same index and compares every `(rel_id → target_symbol_id)` assignment at all
    // four tiers: 0 disagreements, same row count, plus a negative control (a plan
    // that drops the tier term) that is CAUGHT rather than reported clean:
    //
    //   1. `COALESCE(s.is_declaration, 0) ASC` depends on the NAME, not on the
    //      relationship: every candidate at a higher tier loses to every candidate at
    //      the minimum tier, so one GROUP BY fixes the tier per name.
    //   2. Within one file the language term is CONSTANT (`f.language` is a column of
    //      brain_file, and brain_file.id is the primary key), so the third key cannot
    //      reorder same-file candidates and the winner among them is the lowest id.
    //   3. Therefore the winner is one of exactly three candidates, in order: lowest
    //      id at the minimum tier in the relationship's own file; failing that, in
    //      the relationship's own language; failing both, lowest id at the minimum
    //      tier anywhere.
    //
    // Each of the three joins below is a lookup on a UNIQUE index, so the cost per
    // relationship is O(log symbols) instead of O(candidates for its name), and the
    // aggregates are O(symbols) to build. Ported from `rescue/perf-index-scaling`,
    // which measured 8.6× at n800 (14,484 → 1,685 ms) with the equivalence digest
    // unchanged.
    //
    // The gate that bounds this reads the number the plan reports about itself (see
    // `ResolvePlanStats` above), cross-checked against the written index. That is a
    // repair, not a preference: the gate used to count candidates with its own SQL —
    // a copy of the window plan's join — which kept returning the window shape after
    // the join was gone, and the mismatch was reported as unexplained.
    //
    // (History that still constrains the shape: a correlated subquery per row took
    // 167 s, of which 164 s was the apply step alone; and an earlier attempt lived in
    // `storeResults`, where it resolved against a partial table. Both are why nothing
    // here is per-row correlated and why the UPDATE stays `FROM _i13_pick`.)
    //
    // The source file and language the ranking depends on, materialised once
    // because they cannot be correlated out of a subquery's ORDER BY here.
    rawDb.run(`
      CREATE TEMP TABLE _i13_src AS
      SELECT r.id AS rel_id, src.file_id AS src_file, COALESCE(sf.language, '') AS src_lang
      FROM brain_relationship r
      LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
      LEFT JOIN brain_file sf ON sf.id = src.file_id
      WHERE r.project_id = '${projectId}'
    `)
    // ── THE JOIN KEY NEEDS AN INDEX, AND ITS ABSENCE COST 260× ──
    //
    // Without this, the pick's plan depends on whether `sqlite_stat1` exists, and
    // on a FRESH index it does not: the pipeline runs ANALYZE at the END, after
    // resolution. Measured on the n50 pool, no statistics, this exact query:
    //
    //   without this index   `SEARCH r USING INDEX brain_rel_project_idx` then
    //                        `SCAN t` — one full scan of _i13_src per relationship
    //                        row (7,968 × 7,968 here), 15.6 s
    //   with it              `SEARCH t USING INDEX _src_rel (rel_id=?)`, 0.060 s
    //
    // The index is on the join key, so it makes EITHER order cheap rather than
    // forcing one, and it does not depend on statistics that do not exist yet at
    // this point in the pipeline. This is also the likely cause of the "resolve
    // 889,631 ms at n200" that docs/UNMERGED-WORK.md recorded as unexplained while
    // the same branch's own numbers said 712 ms: same SQL, planner chose per
    // statistics that were not there.
    rawDb.run(`CREATE UNIQUE INDEX temp._i13_src_rel ON _i13_src(rel_id)`)
    // (1) The winning declaration tier per name. Observation 1.
    rawDb.run(`
      CREATE TEMP TABLE _i13_tier AS
      SELECT name, MIN(COALESCE(is_declaration, 0)) AS tier
      FROM brain_symbol WHERE project_id = '${projectId}'
      GROUP BY name
    `)
    rawDb.run(`CREATE UNIQUE INDEX temp._i13_tier_name ON _i13_tier(name)`)
    // (2a) Observation 2 + 3a: lowest id at the minimum tier, within one file. The
    // join on `t.tier` is what restricts candidates to the tier that can win, so a
    // higher-tier symbol cannot occupy a best_* row even when it is the lowest id in
    // its file.
    rawDb.run(`
      CREATE TEMP TABLE _i13_best_file AS
      SELECT s.name AS name, s.file_id AS file_id, MIN(s.id) AS symbol_id
      FROM brain_symbol s
      JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
      WHERE s.project_id = '${projectId}'
      GROUP BY s.name, s.file_id
    `)
    rawDb.run(`CREATE UNIQUE INDEX temp._i13_best_file_key ON _i13_best_file(name, file_id)`)
    // (2b) Observation 3b: lowest id at the minimum tier, within one language. The
    // key is the COALESCEd language, so the '' bucket exists and '' matches '' — the
    // same comparison the window key made.
    rawDb.run(`
      CREATE TEMP TABLE _i13_best_lang AS
      SELECT s.name AS name, COALESCE(f.language, '') AS lang, MIN(s.id) AS symbol_id
      FROM brain_symbol s
      JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
      LEFT JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_id = '${projectId}'
      GROUP BY s.name, COALESCE(f.language, '')
    `)
    rawDb.run(`CREATE UNIQUE INDEX temp._i13_best_lang_key ON _i13_best_lang(name, lang)`)
    // (2c) Observation 3c: lowest id at the minimum tier, no further preference.
    rawDb.run(`
      CREATE TEMP TABLE _i13_best_any AS
      SELECT s.name AS name, MIN(s.id) AS symbol_id
      FROM brain_symbol s
      JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
      WHERE s.project_id = '${projectId}'
      GROUP BY s.name
    `)
    rawDb.run(`CREATE UNIQUE INDEX temp._i13_best_any_key ON _i13_best_any(name)`)
    // The three LEFT JOINs are the plan, and the `IS NOT NULL` filter on the pick is
    // load-bearing: the window plan emitted a row only when a candidate MATCHED, and
    // the apply step is `UPDATE … FROM _i13_pick`, so a row carrying a NULL target
    // would write NULL over a target strategies 1/2/4 had already resolved and
    // un-bind a live edge. `_i13_best_any` is populated for every name that has at
    // least one symbol, so the COALESCE is NULL exactly when no symbol carries the
    // target name — which is precisely the no-candidate case.
    //
    // `bf.file_id = t.src_file` cannot match when `t.src_file IS NULL` (the source
    // symbol is missing — 26,522 rows on the n800 index), and that is the right
    // answer rather than an accident: the window key compared `s.file_id = NULL`,
    // which is NULL, and SQLite sorts NULL last under DESC, so no candidate claimed
    // the same-file tier there either.
    rawDb.run(`
      CREATE TEMP TABLE _i13_pick AS
      SELECT t.rel_id AS rel_id,
             COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) AS target_symbol_id
      FROM _i13_src t
      JOIN brain_relationship r ON r.id = t.rel_id
      LEFT JOIN _i13_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
      LEFT JOIN _i13_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
      LEFT JOIN _i13_best_any  ba ON ba.name = r.target_external
      WHERE r.project_id = '${projectId}'
        AND r.target_external IS NOT NULL
        AND r.relationship_type <> 'contains'
        AND instr(r.target_external, '.') = 0
        AND instr(r.target_external, ':') = 0
        AND COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) IS NOT NULL
    `)
    // The number this plan reports: the largest intermediate it materialised, counted
    // from the tables it built rather than from an expression restated in a second
    // query — a restatement is a copy that can drift from the plan it describes.
    // Bounded by the stored-relationship count, which is the linear claim itself.
    const _i13Largest = (rawDb.prepare(`
      SELECT MAX(c) AS m FROM (
        SELECT COUNT(*) AS c FROM _i13_tier
        UNION ALL SELECT COUNT(*) FROM _i13_best_file
        UNION ALL SELECT COUNT(*) FROM _i13_best_lang
        UNION ALL SELECT COUNT(*) FROM _i13_best_any
        UNION ALL SELECT COUNT(*) FROM _i13_pick
      )
    `).get() as any).m as number
    stats = { plan: "linear", largestIntermediate: _i13Largest }
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_tier`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_best_file`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_best_lang`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_best_any`)
    // Without this the apply step degrades to a scan per row — the 164 s above.
    rawDb.run(`CREATE UNIQUE INDEX temp._i13_pick_rel ON _i13_pick(rel_id)`)
    rawDb.run(`
      UPDATE brain_relationship
      SET target_symbol_id = p.target_symbol_id
      FROM _i13_pick p
      WHERE brain_relationship.id = p.rel_id
    `)
    // The target these rows now hold is not necessarily the one insert-time picked,
    // so the cross-FILE flag is recomputed for the same population. Before the
    // cross-language pass below on purpose: that pass is upgrade-only, so it has to
    // see the final target to fill its bridge.
    rawDb.run(`
      UPDATE brain_relationship
      SET is_cross_file = CASE WHEN t.file_id <> s.file_id THEN 1 ELSE 0 END
      FROM brain_symbol t, brain_symbol s
      WHERE t.id = brain_relationship.target_symbol_id
        AND s.id = brain_relationship.source_symbol_id
        AND brain_relationship.project_id = '${projectId}'
        AND brain_relationship.relationship_type <> 'contains'
        AND instr(brain_relationship.target_external, '.') = 0
        AND instr(brain_relationship.target_external, ':') = 0
    `)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_src`)
    rawDb.run(`DROP TABLE IF EXISTS temp._i13_pick`)

    // The OWNER CHANNEL's claim over the rows that state their own receiver, for the
    // same reason and in the same position as the call in `storeResults`: after every
    // name-based strategy (including this pass's own plan, which is the one that binds
    // the deferred population in the worker-pool flow) and before the cross-language
    // pass, so that pass sees the target this channel chose. See
    // `claimOwnerCarryingTargets` in `member-owner-resolution.ts`.
    {
      const ownerClaim = claimOwnerCarryingTargets(rawDb as any, projectId)
      if (ownerClaim.withdrawn > 0) {
        log.debug("member owner resolution (owner channel authoritative)", {
          withdrawn: ownerClaim.withdrawn,
          scanned: ownerClaim.scanned,
          resolved: ownerClaim.resolved,
          inheritedResolved: ownerClaim.inheritedResolved,
          declined: ownerClaim.ownerAmbiguous + ownerClaim.ambiguousInChain + ownerClaim.notDeclared,
        })
      }
    }

    // Cross-language normalization (polyglot fixture finding, M26 addendum):
    // this pass is the one that resolves forward references in the default
    // worker-pool flow (batches are stored with skipResolution=true, so a TS
    // file whose JS target is parsed later resolves HERE) — but the strategies
    // above only recompute is_cross_file. Without this, late-resolved
    // cross-language edges store cross_file=1 with cross_lang=0 and no bridge,
    // silently invisible to cross-language hover/graph. UPGRADE-ONLY: an
    // analyzer-declared flag is never downgraded; the bridge is filled only
    // when NULL.
    rawDb.run(`
      UPDATE brain_relationship
      SET is_cross_language = CASE WHEN EXISTS (
        SELECT 1 FROM brain_symbol ss
        LEFT JOIN brain_file sf ON sf.id = ss.file_id
        JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
        LEFT JOIN brain_file tf ON tf.id = ts.file_id
        WHERE ss.id = brain_relationship.source_symbol_id
          AND COALESCE(sf.language, '') <> ''
          AND COALESCE(tf.language, '') <> ''
          AND lower(sf.language) <> lower(tf.language)
      ) THEN 1 ELSE brain_relationship.is_cross_language END,
      bridge_mechanism = COALESCE(
        brain_relationship.bridge_mechanism,
        CASE WHEN EXISTS (
          SELECT 1 FROM brain_symbol ss
          LEFT JOIN brain_file sf ON sf.id = ss.file_id
          JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
          LEFT JOIN brain_file tf ON tf.id = ts.file_id
          WHERE ss.id = brain_relationship.source_symbol_id
            AND COALESCE(sf.language, '') <> ''
            AND COALESCE(tf.language, '') <> ''
            AND lower(sf.language) <> lower(tf.language)
        ) THEN 'name-resolution' ELSE NULL END
      )
      WHERE brain_relationship.project_id = '${projectId}'
        AND brain_relationship.target_symbol_id IS NOT NULL
    `)

    // Cleanup
    rawDb.run(`DROP TABLE IF EXISTS _res_qname`)
    rawDb.run(`DROP TABLE IF EXISTS _res_name`)
  } catch (err) {
    // Rethrow. This catch used to swallow, and swallowing here is what made a
    // FAILED resolution indistinguishable from a successful one at every
    // structured surface — see the note at the throw.
    log.warn("relationship resolution failed", { error: err })
    throw err
  }

  return stats
}

// ============================================================================
// CROSS-SYMBOL TAINT RESOLUTION (called from worker)
// ============================================================================

/**
 * The cross-symbol taint statement, exported so the measurement that guards its
 * plan (`script/perf/probe-taint-plan-stats.ts`) runs THIS text rather than a
 * hand-copied replica of it.
 *
 * That is not a style preference. `script/perf/verify-scaling-linear.ts` counted
 * candidates with a replica of the plan it was supposed to be measuring, so
 * replacing the plan changed nothing in its number and the gate stayed red on
 * code that no longer performed the join. A probe that re-types the statement it
 * reports on measures the probe.
 */
export const CROSS_SYMBOL_TAINT_QUERY = `
    WITH Sources AS (
      SELECT id, source_symbol_id
      FROM brain_taint_flow
      WHERE project_id = ? AND sink_symbol_id IS NULL AND source_type != 'unresolved'
    ),
    Sinks AS (
      SELECT id, sink_symbol_id
      FROM brain_taint_flow
      WHERE project_id = ? AND source_symbol_id IS NULL AND sink_type != 'unresolved'
    ),
    ResolvedFlows AS (
      SELECT 
        src.id AS flow_source_id,
        snk.id AS flow_sink_id,
        snk.sink_symbol_id AS target_symbol_id,
        src.source_symbol_id || '|||' AS path
      FROM Sources src
      JOIN Sinks snk ON src.source_symbol_id = snk.sink_symbol_id
      
      UNION ALL
      
      SELECT 
        src.id AS flow_source_id,
        snk.id AS flow_sink_id,
        snk.sink_symbol_id AS target_symbol_id,
        src.source_symbol_id || '|||' || r.target_symbol_id || '|||' AS path
      FROM Sources src
      JOIN brain_relationship r ON src.source_symbol_id = r.source_symbol_id
      JOIN Sinks snk ON r.target_symbol_id = snk.sink_symbol_id
    )
    SELECT flow_source_id, flow_sink_id, target_symbol_id, MIN(LENGTH(path)) as depth, path
    FROM ResolvedFlows
    GROUP BY flow_source_id, flow_sink_id, target_symbol_id
    LIMIT 10000
  `

export async function resolveCrossSymbolTaints(projectId: ProjectID): Promise<number> {
  log.debug("starting cross-symbol taint resolution", { projectId })
  const { BrainDatabase } = await import("../brain/database")
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const now = Date.now()

  // ── THIS STATEMENT IS PLANNED BLIND ON A FRESH INDEX, AND THE BLIND PLAN IS 600× ──
  //
  // The query below joins brain_taint_flow (both CTEs) to brain_relationship, and
  // SQLite chooses its join order when the statement is PREPARED. On a fresh index
  // there are no statistics to choose with: the pipeline's `ANALYZE` runs at the
  // END, after this phase, so the planner is looking at two tables whose sizes it
  // has never measured. It then scans the taint table once per source row instead
  // of probing it.
  //
  // MEASURED on the ASP.NET Core index (12,177 files, 1,134,292 relationships,
  // 19,903 taint rows, 16,343 sources / 1,963 sinks), same data, same statement:
  //
  //   sqlite_stat1 absent — the state during a cold run    546.1 s → 1,530 flows
  //   sqlite_stat1 present — the state after ANALYZE         0.9 s → 1,530 flows
  //
  // Same rows out, 600× the time, and 507 s of that 546 s was CPU (user+sys) — the
  // planner doing work, not IO or a lock wait. That is the whole of the
  // `taint(440793ms)` a 37-minute cold index reported: nothing in this pass is
  // slow, the plan was. Same defect class as the `_i13_src` index note above:
  // ANALYZE at the end of the pipeline means every derived phase plans against
  // statistics that do not yet describe what it joins.
  //
  // These four are the indexes the measured-good plan uses. Analyzing just them
  // costs 0.98 s on that index, measured in a fresh process (0.01 + 0.00 + 0.50 +
  // 0.47 s) against the 25.4-27.6 s the whole-database ANALYZE reports from the
  // same pipeline: the plan is bought for a fraction of a cost the run already
  // pays. They are looked up first so a database whose schema
  // predates one of them analyzes what it has instead of throwing: a missing index
  // must not fail the phase, it must only fail to help it. Best-effort for the same
  // reason — a statistics refresh that cannot run must not lose the flows.
  try {
    const wanted = ["brain_taint_source_idx", "brain_taint_sink_idx", "brain_rel_source_cross_idx", "brain_rel_target_idx"]
    const present = new Set(
      (
        rawDb
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${wanted.map(() => "?").join(", ")})`)
          .all(...wanted) as any[]
      ).map((r) => String(r.name)),
    )
    for (const idx of wanted) if (present.has(idx)) rawDb.exec(`ANALYZE ${idx}`)
  } catch (err: any) {
    log.warn("taint planner-statistics refresh failed", { error: err?.message })
  }

  const query = CROSS_SYMBOL_TAINT_QUERY

  try {
    const flows = rawDb.prepare(query).all(projectId, projectId) as any[]

    const updateFlow = rawDb.prepare(`
      UPDATE brain_taint_flow
      SET sink_symbol_id = ?, cross_language_boundaries = 1, flow_path = ?
      WHERE id = ? AND sink_symbol_id IS NULL
    `)

    const tx = rawDb.transaction((flows: any[]) => {
      for (const flow of flows) {
        // flow.path is a '|||'-delimited symbol-id list built in SQL; the
        // column is declared text({ mode: "json" }), so store a JSON array.
        const pathArr = String(flow.path ?? "").split("|||").filter(Boolean)
        updateFlow.run(flow.target_symbol_id, JSON.stringify(pathArr), flow.flow_source_id)
      }
    })

    tx(flows)
    log.debug("cross-symbol taints resolved", { count: flows.length, duration: Date.now() - now })
    return flows.length
  } catch (err) {
    log.warn("cross-symbol taint resolution failed", { error: err })
    return 0
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * How many stored relationships are NOT attached to a stored symbol:
 * `target_symbol_id IS NULL AND target_external IS NOT NULL`.
 *
 * The row is present and counted, but it is not an edge — every traversal reads
 * it as absent, so it under-reports, and the relationship count does not show it.
 *
 * This is the measurement `summary.derivedPass` is not. `derivedPass` says which
 * pass ran; nothing said whether the index ended up CONSISTENT, and the noop
 * path's own note claimed "untouched and still consistent" on the strength of
 * nothing. Measured, in the case a user meets it: cancel a 60-file index
 * mid-run (leaving 16 unresolved relationships), then `bb index --resume`, which
 * parses nothing so its pass is `skipped-unchanged` — and leaves all 16.
 * `bb index --post` resolves them.
 *
 * Best-effort: a failure to measure is logged and leaves the field absent, which
 * callers render as "not measured" rather than as a clean bill.
 */
/**
 * Relationships that SHOULD have been attached to an internal symbol but were
 * not — the real inconsistency, and the only kind `bb index --post` can fix.
 *
 * The previous query was `target_symbol_id IS NULL AND target_external IS NOT
 * NULL`, which counts EXTERNAL references — calls into third-party libraries —
 * as failures. On this repository that reported 28,139 "unresolved
 * relationships" and told the user to run `bb index --post` for them.
 *
 * Measured against the same index: 20,966 were `calls` with an external target
 * and 7,174 were imports, all with `target_external` set. Zero internal edges
 * had failed to resolve. Every one of those 28,139 rows is CORRECT — an
 * external symbol has no row in brain_symbol to point at, so a null
 * target_symbol_id is the accurate representation, not a defect.
 *
 * So the warning was not merely noisy, it was false: it named a remediation
 * that cannot help and implied a broken index on a healthy one. This now counts
 * only rows with no external fallback either — those really are unattached.
 */
async function measureUnresolvedRelationships(projectId: ProjectID): Promise<number | undefined> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    // Unattached on BOTH ends and with no external identity on either side.
    // An external target/source is a legitimate, correctly-recorded edge.
    return Number(
      (raw
        .prepare(
          `SELECT COUNT(*) c FROM brain_relationship
           WHERE project_id = ?
             AND target_symbol_id IS NULL
             AND (target_external IS NULL OR target_external = '')
             AND (source_external IS NULL OR source_external = '')`,
        )
        .get(projectId) as any)?.c ?? 0,
    )
  } catch (e: any) {
    log.warn("could not measure unresolved relationships", { error: e?.message })
    return undefined
  }
}

export async function indexProjectParallel(
  projectId: ProjectID,
  projectPath: string,
  options: {
    onProgress?: (stats: ParallelIndexingStats) => void
    files?: string[]
    // M40.A9: plumbed through to discoverAndFilterFiles but no in-tree caller
    // passes it today — the discovery default (gitignore + extension filter)
    // is the contract. Reserved for future external/MCP consumers; marked
    // internal until one exists.
    excludePatterns?: string[]
    isIncremental?: boolean
    skipPostProcessing?: boolean // M19: defer heavy resolution/enrichment for bounded slice timing
    skipDiscovery?: boolean // @backbencher: skip discoverAndFilterFiles entirely
    // M21.R3: cooperative cancellation. When aborted, the run stops dispatching
    // new parse batches, drains in-flight work, writes live status phase
    // "cancelled", and returns stats normally (no throw) so the DB stays
    // consistent and `bb index --resume` can continue from what was stored.
    signal?: AbortSignal
    logger?: { log: (...args: any[]) => void; write: (s: string) => void }
    // M43.P1 (#656): pass a lock the CALLER already holds (reindexFilesParallel,
    // CLI --force) so this run shares that scope instead of re-acquiring. The
    // caller remains responsible for releasing it.
    lock?: IndexLockHandle
  } = {},
): Promise<ParallelIndexingStats> {
  const _log = options.logger ?? { log: (...args: any[]) => console.log(...args), write: (s: string) => process.stdout.write(s) }
  const signal = options.signal
  const stats: ParallelIndexingStats = {
    totalFiles: 0,
    processedFiles: 0,
    successFiles: 0,
    timeoutFiles: 0,
    errorFiles: 0,
    skippedFiles: 0,
    symbolsExtracted: 0,
    relationshipsFound: 0,
    importsFound: 0,
    startTime: Date.now(),
    errors: [],
  }

  log.debug("starting parallel indexing", {
    projectId,
    projectPath,
    concurrency: ParallelIndexerConfig.concurrency,
    timeout: ParallelIndexerConfig.fileTimeoutMs,
    cpuCores: cpus().length,
  })

  Bus.publishSafe(BrainService.Event.IndexingStarted, { projectId })

  // M43.P1 (#656): single-flight per project — a second PROCESS is refused
  // with the holder named; same-process callers serialize on the module queue.
  const externalLock = options.lock ?? null
  const lock = externalLock ?? await acquireIndexLock(projectId, { kind: "index" })

  const phases: IndexPhaseTimings = {
    discoveryMs: 0,
    workerStartupMs: 0,
    parseMs: 0,
    dbFlushMs: 0,
    finalAccountingMs: 0,
    mode: "worker-pool",
    workerCount: 0,
    parsedFiles: 0,
    workerBatchSize: ParallelIndexerConfig.workerBatchSize,
    dbBatchSize: ParallelIndexerConfig.dbBatchSize,
    retries: 0,
    // Set here, not only where the pool reports them (parallel-indexer.ts:5195).
    // The interface calls both REQUIRED, and that promise was being broken on a
    // real path: the no-op branch assigns `stats.phases = phases` and returns at
    // :5007, which is BEFORE the pool's unconditional assignments at :5195 — so a
    // run that found nothing to index returned `undefined` for both counters.
    //
    // Measured consequence: `script/m21/verify-w1-worker-lifecycle.ts:111-112`
    // asserts `d.phases?.workerStartupFailures === 0` — strict equality, not
    // `?? 0` — so `undefined` fails a check that is asking "were there any?".
    // Zero is the true answer for a no-op run: no worker was started, so none
    // failed and none was poisoned. Overwritten with the real values on the main
    // path; this makes the early return honest rather than merely convenient.
    workerStartupFailures: 0,
    poisonFiles: 0,
    noop: false,
  }

  try {
    const discoveryStart = Date.now()
    const files = options.skipDiscovery && options.files
      ? options.files.filter(f => !shouldSkipCli(f) && hasValidExtension(f))
      : await discoverAndFilterFiles(projectId, projectPath, stats, options.files, options.excludePatterns)
    phases.discoveryMs = Date.now() - discoveryStart

    // M40.A2: on incremental runs, capture cross-file edges INTO the files
    // about to re-parse — storeResults deletes them, the bounded pass restores
    // them. Snapshot time folds into discoveryMs (same pre-parse window) so
    // M21.I1 phase reconciliation stays exact.
    const m40Bounded = options.isIncremental && !options.skipPostProcessing
    let inEdgeSnapshot: InEdgeSnapshotRow[] = []
    if (m40Bounded && files.length > 0) {
      const snapStart = Date.now()
      const touchedFileIds = files.map((f) => `${projectId}:${path.relative(projectPath, f)}`)
      inEdgeSnapshot = await snapshotInEdges(projectId, touchedFileIds)
      if (inEdgeSnapshot.length > 0) log.debug("m40 bounded: captured in-edges", { count: inEdgeSnapshot.length })
      phases.discoveryMs += Date.now() - snapStart
    }

    // const files = await discoverAndFilterFiles(projectId, projectPath, stats, options.files)
    stats.totalFiles = files.length + stats.skippedFiles
    phases.parsedFiles = files.length

    if (files.length === 0) {
      log.warn("no files to index (all skipped or none found)")
      phases.noop = true
      stats.phases = phases

      // Get global stats so they aren't 0
      const dbStats = await getIndexingStats(projectId)
      stats.symbolsExtracted = dbStats.symbols
      stats.relationshipsFound = dbStats.relationships
      stats.endTime = Date.now()
      stats.processedFiles = stats.skippedFiles
      phases.finalAccountingMs = Date.now() - discoveryStart - phases.discoveryMs
      phases.totalWallMs = Date.now() - stats.startTime

      // M22.V5: even the noop path must carry an honest summary so callers
      // always have a complete bucket breakdown regardless of run type.
      stats.summary = {
        totalCandidates: stats.totalFiles,
        newlyParsed: 0,
        unchanged: stats.skippedFiles,
        skipped: 0,
        symbolLoss: 0,
        errors: 0,
        timeouts: 0,
        cancelled: 0,
        derivedPass: "skipped-unchanged",
        // Measured here too, because this is the path `--resume` takes and it is
        // the one that can carry a previous run's unfinished work. Measured 16 on
        // a cancel-then-resume, and 0 after `bb index --post`.
        unresolvedRelationships: await measureUnresolvedRelationships(projectId),
        // Embedding state is reported on EVERY summary, including this no-op
        // path: an index that already holds a MIX of models still does after a
        // run that parses nothing, and that is exactly the condition a user
        // needs told about.
        embedModels: await surveyEmbeddingModels(projectId),
        // The full census, not just the model list: a corrupt vector is invisible
        // to every other number because vector_dimension is self-describing.
        embeddingIntegrity: await surveyEmbeddingIntegrity(projectId),
        // Nothing was parsed, so there was no parse mode to choose. Declared
        // rather than left undefined so "no parse ran" is a value and not a gap.
        parseMode: "worker-pool",
      }

      // Report here too, not only on the derived-pass path. A no-op incremental
      // run is exactly the case where an index already holds defects and the
      // user is told nothing happened — so the defects must still be surfaced.
      // Sourced from the summary rather than duplicated: one computation, two
      // renderings, so the logger and the CLI cannot disagree.
      reportEmbeddingIntegrity(_log, stats.summary.embeddingIntegrity)

      // M40.A2: an incremental noop run can still observe DELETIONS —
      // discovery only walks files present on disk, so a removed file leaves
      // ghost rows unless purged. Bounded by the brain_file row count.
      if (options.isIncremental) {
        try {
          const purged = await purgeDeletedFiles(projectId, projectPath)
          if (purged > 0) {
            stats.m40Bounded = { repairedInEdges: 0, purgedDeletedFiles: purged, touchedSymbols: 0 }
            stats.summary.derivedPass = "bounded"
            _log.log(`  bounded: purged ${purged} deleted file(s) from the index`)
          }
        } catch (e: any) {
          log.warn("noop-run deleted-purge failed", { error: e?.message })
        }
      }

      // M21.R3: if this noop run was a resume that finished a cancelled
      // checkpoint (everything already stored), finalize the live status to
      // "complete" so the stale "cancelled" phase doesn't linger forever.
      const { readLiveStatus } = await import("./index-status")
      if (readLiveStatus(projectId)?.phase === "cancelled") {
        writeLiveStatus(projectId, {
          projectId,
          phase: "complete",
          processedFiles: stats.processedFiles,
          totalFiles: stats.totalFiles,
          startedAt: stats.startTime,
          updatedAt: Date.now(),
        })
      }

      await BrainDatabase.updateIndexStatus(projectId, {
        lastIndexed: Date.now(),
        filesIndexed: stats.totalFiles,
        filesParsed: 0, // noop: nothing parsed this run
        symbolsIndexed: stats.symbolsExtracted,
        relationshipsIndexed: stats.relationshipsFound,
        status: "complete",
        errors: [],
        codebaseFingerprintProjectPath: projectPath,
        performanceStats: {
          schemaVersion: 1,
          runs: [
            {
              generatedAt: Date.now(),
              mode: "worker-pool",
              noop: true,
              phases: { discoveryMs: phases.discoveryMs, workerStartupMs: 0, parseMs: 0, dbFlushMs: 0, finalAccountingMs: phases.finalAccountingMs, totalWallMs: phases.totalWallMs, workerStartupFailures: 0, poisonFiles: 0 },
              counts: { totalFiles: stats.totalFiles, processedFiles: stats.skippedFiles, successFiles: 0, timeoutFiles: 0, errorFiles: 0, skippedFiles: stats.skippedFiles, workerCount: 0, parsedFiles: 0, retries: 0 },
            },
          ],
        },
      })

      Bus.publishSafe(BrainService.Event.IndexingCompleted, {
        projectId,
        stats: {
          files: stats.totalFiles,
          symbols: stats.symbolsExtracted,
          relationships: stats.relationshipsFound,
          errors: stats.errors.length,
          duration: stats.endTime - stats.startTime,
          filesPerSecond: 0,
          skippedFiles: stats.skippedFiles,
        },
      })

      return stats
    }

    let lastProgressUpdate = 0

    // Try worker pool first (real process isolation with fork + 45s timeouts)
    // Falls back to in-process only if fork() is unavailable
    let processFn = processWithWorkerPool
    // Test if fork works by spawning the binary with BB_POOL_WORKER=1
    const workerStartupStart = Date.now()
    try {
      const { fork } = await import("child_process")
      // Use the diagnosing resolver (pool-diagnostics.ts) rather than the raw
      // one: it returns a discriminated union, so "no tsx" / "compiled entry
      // missing" / "disabled by env" are each named with a fix instead of all
      // collapsing into one indistinguishable pool failure.
      const resolution = resolvePoolWorkerForkSafe()
      if (!resolution.ok) {
        throw new Error(poolFailureLine(resolution))
      }
      const { workerPath: testWorkerPath, workerArgs: testWorkerArgs } = resolution
      const testWorker = fork(testWorkerPath, testWorkerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      await new Promise<void>((resolve, reject) => {
        // Was hardcoded 60s while the pool's own startup watchdog used
        // BB_WORKER_STARTUP_TIMEOUT_MS (default 30s) — so a slow machine could
        // fail the real pool at 30s and then wait another 60s for a probe that
        // was never going to pass. One knob, one value, both paths.
        const startupMs = poolStartupTimeoutMs()
        const timeout = setTimeout(() => {
          testWorker.kill()
          reject(new Error(`worker fork test timed out after ${Math.round(startupMs / 1000)}s`))
        }, startupMs)
        testWorker.on("message", (msg: any) => {
          if (msg?.type === "ready") {
            clearTimeout(timeout)
            testWorker.kill()
            resolve()
          }
        })
        testWorker.on("error", (err: Error) => {
          clearTimeout(timeout)
          reject(err)
        })
        testWorker.on("exit", (code: number | null) => {
          if (code !== null && code !== 0) {
            clearTimeout(timeout)
            reject(new Error(`worker exited with code ${code}`))
          }
        })
        // Send warmup so the worker initializes and responds with "ready"
        testWorker.send({ type: "warmup", workerId: 0 })
      })
      _log.log("[brain] ✓ worker pool available — using parallel indexing with 45s timeouts")
      log.info("worker pool fork test passed — using parallel workers")
    } catch (e: any) {
      _log.log(`[brain] ⚠ worker pool unavailable — falling back to serial in-process indexing`)
      // Name the cause, not just the fact. Users reported "workers don't start"
      // with nothing actionable; the underlying reason (usually a missing tsx)
      // was previously swallowed into a generic message.
      _log.log(`[brain]   reason: ${e?.message}`)
      _log.log(`[brain]   this run is correct but serial, so it will be slower`)
      log.warn("worker pool fork unavailable, falling back to in-process", { error: e?.message })
      processFn = processInProcess
    }
    phases.workerStartupMs = Date.now() - workerStartupStart
    phases.mode = processFn === processInProcess ? "in-process" : "worker-pool"
    // Carried onto the summary as well, because the summary is what callers and
    // the CLI read and `phases` is what nobody reads. On the main path the
    // summary is built later from `phases.mode`; this covers a path that already
    // has one.
    if (stats.summary) stats.summary.parseMode = phases.mode

    const parseStart = Date.now()
    const poolTelemetry = { dbFlushMs: 0, retries: 0, workerCount: 0, workerStartupFailures: 0, poisonFiles: 0 }
    const results = await processFn(
      projectId,
      projectPath,
      files,
      (processed, total, file) => {
        stats.processedFiles = processed + stats.skippedFiles

      const now = Date.now()
      if (now - lastProgressUpdate > ParallelIndexerConfig.progressUpdateMs || processed === total) {
        lastProgressUpdate = now
        const elapsed = (now - stats.startTime) / 1000
        const fps = processed / elapsed

        Bus.publishSafe(BrainService.Event.IndexingProgress, {
          projectId,
          progress: (stats.processedFiles / stats.totalFiles) * 98,
          message: `${path.basename(file)} (${stats.processedFiles}/${stats.totalFiles})`,
          stats: {
            filesProcessed: stats.processedFiles,
            symbolsExtracted: stats.symbolsExtracted, // will be 0 during indexing
            relationshipsFound: stats.relationshipsFound,
            filesPerSecond: fps,
            skippedFiles: stats.skippedFiles,
          },
        })

        if (options.onProgress) {
          // M22.V1: enrich the public progress payload with the live fields the
          // CLI renders (files/s, current file, overall %, elapsed) so callers
          // can draw a live progress line without recomputing them. These are
          // additive and do not change the internal Bus contract consumed by
          // BrainService.
          options.onProgress({
            ...stats,
            currentFile: path.basename(file),
            progress: (stats.processedFiles / stats.totalFiles) * 98,
            filesPerSecond: fps,
            elapsedSeconds: now - stats.startTime, // ms; /1000 for seconds
            phase: processFn === processInProcess ? "in-process" : "worker-pool",
          })
        }
        // M22.V2: persist a live cross-process status sample so `bb status` in
        // another shell shows this run's progress/totals while it is in flight.
        writeLiveStatus(projectId, {
          projectId,
          phase: "indexing",
          processedFiles: stats.processedFiles,
          totalFiles: stats.totalFiles,
          filesPerSecond: fps,
          currentFile: path.basename(file),
          startedAt: stats.startTime,
          updatedAt: now,
        })
      }
    }, poolTelemetry, signal)
    if (signal?.aborted) stats.cancelled = true

    // PERL-MR15. Populate the cross-file override companion from the symbols this
    // run already holds, then re-analyze the files whose `overrides` edges depend
    // on a base declared in ANOTHER file.
    //
    // It has to run HERE, between the parse and the store: `FileResult.symbols`
    // is the project's method-name space and it is only in memory inside this
    // function. Running it later would mean a second parse of every file to
    // rebuild an index this run already computed.
    //
    // 75.6% of perl's `overrides` edges are false -- measured over 5,774 corpus
    // files, the base is in the project and does not declare the method. The
    // differential cannot see that class of defect, so nothing else in the run
    // will ever correct it.
    //
    // Failures are swallowed on purpose: a re-analysis that throws leaves the
    // first run's result in place, which is the pre-MR15 behaviour. A companion
    // that cannot be built must never turn a completed index into a failed one.
    {
      const { populateOverrideCompanion } = await import("./override-companion-pass")
      const poolWorker = (await import("./pool-worker")) as any
      const reparse = poolWorker.parseFile
      if (reparse) {
        // Both lanes that CONSUME the companion. Perl has read it since MR14;
        // python's resolver existed and read a channel nothing populated, so it
        // ran with no companion and every cross-file base stayed a first-parent
        // guess. The pass is already language-parameterised end to end (it scopes
        // its symbols and its affected files by `r.language === language`), so
        // running it twice is not a second design — it is the same pass under the
        // other lane's name. Sequential on purpose: each builds its companion from
        // the same `results` and re-parses its own subset, and interleaving two
        // re-parse waves over one results array is a race nobody needs.
        // JAVASCRIPT ADDED 2026-10-12. The third lane, and python's gap exactly: the analyzer emits
        // `first-parent-guess` at 0.5 ONLY when `context.overrideCompanion` is absent
        // (`real-javascript-analyzer.ts:1606`), while `:1585` already asks the right question —
        // "does the base declare this member?" — of the map this pass builds. Measured over the
        // whole JS population (13,162 files, 0 degraded, 0 threw): 6,268 of 6,820 `overrides` edges
        // are guesses; with the companion, 571 are confirmed at 0.95, **1,163 false ones are never
        // emitted at all**, and 4,534 whose base is outside the project keep guessing — a boundary
        // that is real, so this reaches 1,734 rows and not 6,268. TYPESCRIPT IS DELIBERATELY NOT
        // ADDED: `real-typescript-analyzer.ts` has zero `overrideCompanion` references, so the token
        // would be a no-op that looks like a fix.
        for (const companionLang of ["perl", "python", "javascript"] as const) {
          const passStats = await populateOverrideCompanion({
            projectPath,
            results,
            language: companionLang,
            reparse: (f, p, ctx) => reparse(f, p, ctx),
          })
          if (passStats.owners > 0) {
            log.info(
              `override companion (${companionLang}): ${passStats.owners} owners, ` +
                `${passStats.refiles} file(s) re-analyzed, ${passStats.reapplied} reapplied, ` +
                `${passStats.confirmed} confirmed, ${passStats.stillGuess} still a guess, ` +
                `${passStats.failed} failed`,
            )
          }
          // ── THE WRITE-BACK (r-lane, 2026-10-12) ────────────────────────────────────────────────
          //
          // WHY THIS EXISTS, MEASURED RATHER THAN READ: the pass re-analyzes into an IN-MEMORY array and
          // its confirmations were DISCARDED. On python the pass reported `1301 confirmed` and the store's
          // `overrides` confidence census was `0.5=2204 0.95=507` BEFORE the pass and IDENTICAL AFTER it —
          // not by 1301, not by one. On ruby, `53 confirmed` against `0.5=732 0.95=3`, unchanged across a
          // two-arm A/B. So the companion tier — "read by fifteen lanes and populated by nobody in
          // production" — was never persisted, in any lane, in any round.
          //
          // WHY HERE AND NOT EARLIER: the pass needs the COMPLETE symbol table, but `processInProcess`
          // STREAMS batches to `storeResults` DURING parsing (`:1313`). Moving the pass before the store
          // would mean holding every batch in memory until parsing ends — a change to the streaming
          // design, not a move. So the pass stays and the store is updated after it.
          //
          // WHY A TARGETED UPDATE AND NOT A RE-STORE, which is the whole design: a re-store REPLACES a
          // batch's rows with a newly parsed set, and any row the re-parse did not reproduce disappears
          // silently. THIS IS THE FIRST CHANGE IN THIS PROGRAMME THAT CAN DELETE STORED DATA, so the merge
          // shape is chosen to make that impossible BY CONSTRUCTION rather than to pass a test:
          //
          //   A ROW THE PASS COULD NOT CONFIRM IS NEVER NAMED BY THE WRITE-BACK. It keeps its stored
          //   confidence, its reasonCode and its target_symbol_id, because only `UPDATE … WHERE id = ?`
          //   statements are built, and only from the CONFIRMED set. An unconfirmed row is not merely
          //   preserved — it is never the subject of a statement that could change or remove it.
          //
          // The identity comes from the pass itself (`confirmedKeys`), NOT from re-matching here: a second
          // computation of the same predicate is a second answer.
          if (passStats.confirmedKeys?.length) {
            try {
              const wbDb: any = await BrainDatabase.getRawInstance(projectId)
              const upd = wbDb.prepare(
                "UPDATE brain_relationship SET confidence = ? " +
                  "WHERE project_id = ? AND relationship_type = 'overrides' " +
                  "AND target_external = ? AND line_number IS ?",
              )
              const apply = wbDb.transaction((keys: any[]) => {
                let n = 0
                for (const k of keys) n += upd.run(k.confidence, String(projectId), k.target, k.line).changes
                return n
              })
              const moved = apply(passStats.confirmedKeys)
              log.info(`override companion (${companionLang}) write-back: ${moved} of ${passStats.confirmedKeys.length} confirmed rows persisted`)
            } catch (e: any) {
              // The write-back must never turn a completed index into a failed one.
              log.warn(`override companion (${companionLang}) write-back failed: ${e?.message ?? e}`)
            }
          }
        }
      }
    }

    phases.parseMs = Date.now() - parseStart
    phases.dbFlushMs = poolTelemetry.dbFlushMs
    phases.retries = poolTelemetry.retries
    phases.workerCount = poolTelemetry.workerCount
    phases.workerStartupFailures = poolTelemetry.workerStartupFailures
    phases.poisonFiles = poolTelemetry.poisonFiles
    stats.phases = phases

    // M21.I1: final accounting spans outcome aggregation, missed-file fallback,
    // DB stats read, and status update — everything between parse end and endTime.
    const finalAccountingStart = Date.now()

    // Aggregate one final outcome per input file. Worker retries can append a
    // failure and then a later success for the same path; counting the raw
    // result array over-reports successes and makes the public stats exceed
    // totalFiles. A later successful parse is the authoritative outcome.
    const finalOutcomes = new Map<string, FileResult>()
    for (const result of results) {
      const previous = finalOutcomes.get(result.filePath)
      if (!previous || result.success || !previous.success) finalOutcomes.set(result.filePath, result)
    }
    stats.structuredErrors = []
    // No `cancelled` member, which is what the type used to declare.
    //
    // It was declared required here, omitted by BOTH `??=` initializers
    // (:5212, :5302), and absent from the exported summary type too (:606) —
    // three shapes for one field. Nothing in the repository reads or writes it:
    // a cancelled file takes the `result.error === "cancelled by user"` branch,
    // which bumps the separate `cancelledCount` scalar and `continue`s, so the
    // per-language accumulator is never touched for a cancellation.
    //
    // So the field was a promise the code never kept: every language bucket that
    // existed had `cancelled === undefined`, on a type that said it was a number.
    // Dropping it aligns all three shapes with what the code actually does.
    // Populating it instead would change reported output, which is not this task.
    const byLanguage: Record<string, { files: number; success: number; error: number; timeout: number; fallback: number }> = {}
    // M21.R3: cancelled files are a distinct bucket — they were never parsed,
    // so counting them as "errors" misrepresents a cancelled run as broken.
    let cancelledCount = 0
    for (const result of finalOutcomes.values()) {
      if (result.error === "cancelled by user") {
        cancelledCount++
        continue
      }
      // detectLanguageFromPath returns the language string directly (not an
      // object) — never use `.language` on it.
      const lang = detectLanguageFromPath(result.filePath) ?? "unknown"
      const acc = (byLanguage[lang] ??= { files: 0, success: 0, error: 0, timeout: 0, fallback: 0 })
      acc.files++
      if (result.success) {
        stats.successFiles++
        acc.success++
        if ((result as any).fallback) acc.fallback++
      } else if (result.timeout) {
        stats.timeoutFiles++
        acc.timeout++
        stats.errors.push({ file: result.filePath, error: "Timeout" })
        stats.structuredErrors.push({
          phase: "parse",
          message: "Timeout",
          file: result.filePath,
          language: detectLanguageFromPath(result.filePath) ?? null,
          retry: 0,
          timestamp: Date.now(),
        })
      } else {
        stats.errorFiles++
        acc.error++
        stats.errors.push({ file: result.filePath, error: result.error || "Unknown error" })
        stats.structuredErrors.push({
          phase: "parse",
          message: result.error || "Unknown error",
          file: result.filePath,
          language: detectLanguageFromPath(result.filePath) ?? null,
          retry: 0,
          fallback: (result as any).fallback ?? undefined,
          timestamp: Date.now(),
        })
      }
    }

    // M22.V5: honest per-bucket summary. symbolLoss = parsed OK but zero
    // symbols (ENGINE_EMPTY bypass) — the silent-loss class the probe exposed
    // on element-plus SCSS (~250 files parsed to nothing with no user signal).
    let symbolLoss = 0
    for (const r of finalOutcomes.values()) {
      if (r.success && (!r.symbols || r.symbols.length === 0)) symbolLoss++
    }
    stats.summary = {
      totalCandidates: stats.totalFiles,
      newlyParsed: stats.successFiles,
      unchanged: stats.skippedFiles,
      skipped: Math.max(0, stats.totalFiles - files.length - stats.skippedFiles),
      symbolLoss,
      errors: stats.errorFiles,
      timeouts: stats.timeoutFiles,
      cancelled: cancelledCount,
      derivedPass: "deferred", // set to full/bounded below when a pass actually runs
      // The fork test has already resolved by the time this literal is built, so
      // `phases.mode` is known here. An earlier version tried to assign it after
      // the fact and silently did nothing, because on this path `stats.summary`
      // does not exist yet — which is exactly how a measurement goes missing
      // without an error.
      parseMode: phases.mode,
    }

    // Post-processing fallback: re-process files that may have been lost
    // during worker pool batch rollbacks. StoreResults uses INSERT OR REPLACE
    // so re-processing already-stored files is safe (idempotent).
    // M21.R3: skipped entirely on a cancelled run — the ~2,000 files queued
    // behind the cancel are "not in DB" by design (user stopped on purpose);
    // re-processing them would undo the cancel and keep indexing for minutes.
    if (!stats.cancelled) try {
      const rawDb = await BrainDatabase.getRawInstance(projectId)
      const stored = new Set(
        (rawDb.prepare(`SELECT path FROM brain_file WHERE project_id = ?`).all(projectId) as any[])
          .map((r: any) => r.path)
      )
      const missed = files.filter(f => !stored.has(f) && !shouldSkipCli(f))
      if (missed.length > 0) {
        process.stderr.write(`[brain] ⚠ ${missed.length} files missed, re-processing via worker pool...\n`)
        // Retry through the ISOLATED worker pool, never in-process. A file that
        // hangs the tree-sitter parser must die inside a worker (the parent
        // SIGKILLs it after the per-file timeout and retries), not in this
        // process — an in-process parse lets the engine's 120s self-destruct
        // timer call process.exit(1) on pathological inputs (e.g.
        // dotnet/fsharp's Cancellable.fs), taking the whole index run and any
        // unsaved evidence down with it. processWithWorkerPool stores successes
        // itself, so no extra storeResults call is needed here.
        // `undefined, signal` — not `signal`.
        //
        // processWithWorkerPool's signature is (projectId, projectPath, files,
        // onProgress, telemetry?, signal?), so passing `signal` fifth handed an
        // AbortSignal to the TELEMETRY parameter and left the real signal
        // undefined. Two consequences, both silent:
        //
        //   1. this retry pass could not be cancelled. The whole block is
        //      skipped when `stats.cancelled` is already set, so a cancel that
        //      arrives DURING the retry does nothing — the pool ran to
        //      completion, which is precisely when a user who pressed Ctrl-C
        //      expects the run to stop;
        //   2. the pool then mutated the AbortSignal as if it were its metrics
        //      object: `telemetry.dbFlushMs += …` and
        //      `telemetry.workerStartupFailures = …` (parallel-indexer.ts:1496,
        //      :1509) wrote numeric fields onto a signal, producing `NaN` and
        //      junk properties.
        //
        // `undefined` is the right value, not a fresh telemetry object: nothing
        // reads this call's telemetry (its return value is the FileResult list),
        // and the enclosing run already keeps its own accumulator.
        const reprocessed = await processWithWorkerPool(projectId, projectPath, missed, () => {},
                                                        undefined, signal)
        // Map of files already tallied in the main pass, so a file that failed
        // there but recovered here is counted ONCE (as a success), not twice.
        const mainOutcomes = new Map<string, { success: boolean; timeout: boolean }>()
        for (const r of results) mainOutcomes.set(r.filePath, { success: r.success, timeout: !!r.timeout })
        for (const r of reprocessed) {
          const lang = detectLanguageFromPath(r.filePath) ?? "unknown"
          const acc = (byLanguage[lang] ??= { files: 0, success: 0, error: 0, timeout: 0, fallback: 0 })
          if (r.success) {
            const prev = mainOutcomes.get(r.filePath)
            if (prev) {
              if (!prev.success) {
                // Recovery: move the stale failure tally to success.
                if (prev.timeout) { stats.timeoutFiles = Math.max(0, stats.timeoutFiles - 1); acc.timeout = Math.max(0, acc.timeout - 1) }
                else { stats.errorFiles = Math.max(0, stats.errorFiles - 1); acc.error = Math.max(0, acc.error - 1) }
                stats.successFiles++
                acc.success++
                if ((r as any).fallback) acc.fallback++
              }
              // prev.success: already counted as success — don't count again
            } else {
              stats.successFiles++
              acc.files++
              acc.success++
              if ((r as any).fallback) acc.fallback++
            }
            process.stderr.write(`  ✓ ${r.filePath.split('/').pop()}\n`)
          } else {
            // One final outcome per file: a file that already failed in the
            // main pass keeps its single failure tally. Only count a fallback
            // failure when the file was never tallied before (e.g. it was lost
            // in a batch rollback without any result).
            if (!mainOutcomes.has(r.filePath)) {
              stats.errorFiles++
              acc.files++
              if (r.timeout) acc.timeout++
              else acc.error++
            }
            process.stderr.write(`  ✗ ${r.filePath.split('/').pop()}\n`)
          }
        }
      }
    } catch (e: any) {
      process.stderr.write(`[brain] fallback error: ${e?.message}\n`)
    }

    phases.byLanguage = byLanguage

    log.debug("storing results in database", { successFiles: stats.successFiles })

    Bus.publishSafe(BrainService.Event.IndexingProgress, {
      projectId,
      progress: 99,
      message: "Saving AST to SQLite database...",
      stats: {
        filesProcessed: stats.processedFiles,
        symbolsExtracted: stats.symbolsExtracted,
        relationshipsFound: stats.relationshipsFound,
        filesPerSecond: 0,
        skippedFiles: stats.skippedFiles,
      },
    })

    const stored = (results as any)._dbStats || { symbols: 0, relationships: 0, imports: 0 }
    // Clean up memory by clearing full results
    results.length = 0

    // ── the run's final honesty check ─────────────────────────────────────────
    // A store batch can roll back (constraint violation, a full disk) and be skipped.
    // The recovery pass above usually rescues those files; when it cannot — the disk
    // is still full — nothing used to say so, and the run reported success with a
    // status of "complete". So the FINAL STATE is measured rather than assumed: which
    // of the files this run discovered are absent from brain_file? Measured after a
    // cancelled run this is non-zero by design, which is why the status rule below
    // treats cancellation as its own outcome rather than as incompleteness.
    let missingAfterRecovery = 0
    if (!stats.cancelled) {
      try {
        const rawDb = await BrainDatabase.getRawInstance(projectId)
        const storedPaths = new Set(
          (rawDb.prepare(`SELECT path FROM brain_file WHERE project_id = ?`).all(projectId) as any[]).map(
            (r: any) => r.path,
          ),
        )
        missingAfterRecovery = files.filter((f) => !storedPaths.has(f) && !shouldSkipCli(f)).length
      } catch {
        // Best-effort: this check must never break a run that would otherwise finish.
      }
    }
    if (stats.summary) {
      stats.summary.storeFailures = stored.storeFailures ?? 0
      stats.summary.storeFailureFiles = stored.storeFailureFiles ?? 0
      stats.summary.missingAfterRecovery = missingAfterRecovery
    }
    if (missingAfterRecovery > 0 || (stored.storeFailures ?? 0) > 0) {
      log.error("index is INCOMPLETE", {
        storeFailures: stored.storeFailures ?? 0,
        storeFailureFiles: stored.storeFailureFiles ?? 0,
        missingAfterRecovery,
        discoveredFiles: files.length,
      })
    }

    // Get total global stats including previously indexed ones to return correct totals
    const dbStats = await getIndexingStats(projectId)
    stats.symbolsExtracted = dbStats.symbols
    stats.relationshipsFound = dbStats.relationships
    stats.importsFound = stored.imports // We don't have total imports in dbStats yet

    stats.endTime = Date.now()
    phases.finalAccountingMs = Date.now() - finalAccountingStart
    const duration = (stats.endTime - stats.startTime) / 1000
    stats.filesPerSecond = stats.processedFiles / duration

    log.debug("parallel indexing completed", {
      ...stats,
      duration: `${duration.toFixed(1)}s`,
      filesPerSecond: stats.filesPerSecond.toFixed(1),
    })

    // M21.I3: versioned performance stats for this run (bounded history kept
    // by updateIndexStatus so a later run never erases prior evidence).
    const perfStats: BrainDatabase.IndexPerformanceStats = {
      schemaVersion: 1,
      runs: [
        {
          generatedAt: Date.now(),
          mode: phases.mode,
          noop: false,
          phases: {
            discoveryMs: phases.discoveryMs,
            workerStartupMs: phases.workerStartupMs,
            parseMs: phases.parseMs,
            dbFlushMs: phases.dbFlushMs,
            finalAccountingMs: phases.finalAccountingMs,
            postProcessingMs: phases.postProcessingMs,
            totalWallMs: phases.totalWallMs,
          },
          counts: {
            totalFiles: stats.totalFiles,
            processedFiles: stats.processedFiles,
            successFiles: stats.successFiles,
            timeoutFiles: stats.timeoutFiles,
            errorFiles: stats.errorFiles,
            skippedFiles: stats.skippedFiles,
            workerCount: phases.workerCount,
            parsedFiles: phases.parsedFiles,
            retries: phases.retries,
            // M21.W1: startup-failure and poison-pill accounting, persisted so
            // a run that silently degraded is visible after the fact.
            workerStartupFailures: phases.workerStartupFailures,
            poisonFiles: phases.poisonFiles,
          },
        },
      ],
    }

    await BrainDatabase.updateIndexStatus(projectId, {
      lastIndexed: Date.now(),
      filesIndexed: stats.successFiles + stats.skippedFiles,
      filesParsed: stats.successFiles,
      symbolsIndexed: stats.symbolsExtracted,
      relationshipsIndexed: stats.relationshipsFound,
      // "complete" is a claim about the INDEX, so it is decided by the index: parse
      // errors, or files this run discovered that are still absent after recovery.
      // A batch that rolled back and WAS recovered does not make the index partial —
      // it is reported separately as storeFailures.
      status:
        stats.errorFiles > 0 || (stats.summary?.missingAfterRecovery ?? 0) > 0 ? "partial" : "complete",
      errors: stats.structuredErrors,
      performanceStats: perfStats,
      codebaseFingerprintProjectPath: projectPath,
    })

    // M21.R3: a cancelled run skips heavy post-processing entirely — a user
    // who pressed Ctrl+C wants a fast stop, and every post-processing phase
    // (resolution, enrichment, taints, health) rewrites DB rows that the
    // checkpoint contract assumes are untouched after the cancel point.
    if (stats.cancelled) {
      log.info("index cancelled — skipping post-processing (resume to continue)")
    } else if (!options.isIncremental && !options.skipPostProcessing) {
      const postProcessingStart = Date.now()
      log.debug("running heavy cross-symbol taints and health metrics (full index only)")

      // FIX: Run relationship resolution ONCE at the end, not after every batch
      Bus.publishSafe(BrainService.Event.IndexingProgress, {
        projectId,
        progress: 99.2,
        message: "Resolving symbol relationships...",
        stats: {
          filesProcessed: stats.processedFiles,
          symbolsExtracted: stats.symbolsExtracted,
          relationshipsFound: stats.relationshipsFound,
          filesPerSecond: 0,
          skippedFiles: stats.skippedFiles,
        },
      })

      // M40.A1: the five heavy phases + integrity check now live in the ONE
      // public entry (runPostProcessing below), shared by the full index,
      // `bb index --post`, and MCP bb_index mode=post. Same phases, same
      // timing/outcome contract (M21.I2), zero duplicated phase logic.
      // M43.P1: this call is inside an indexProjectParallel run that already
      // holds the project lock — lockHeld=true prevents a self-deadlock.
      let post: Awaited<ReturnType<typeof runPostProcessing>>
      try {
        post = await runPostProcessing(projectId, { logger: _log, lockHeld: true })
      } catch (postErr: any) {
        // "no index for project … run bb index first" is the right message for a project
        // that was never indexed, and the WRONG one for this run: if we discovered files
        // and stored none of them, the index is empty because the STORE failed — a full
        // disk, a read-only database — and the user needs that cause, not an instruction
        // to run the command they just ran. Measured: with every batch failing, the CLI
        // printed "error: no index for project aff3f165 — … run bb index first" and the
        // real reason appeared only in a log line.
        if (missingAfterRecovery > 0) {
          throw new Error(
            `${missingAfterRecovery} of ${files.length} discovered file(s) could NOT be stored ` +
              `(${stored.storeFailures ?? 0} store batch(es) rolled back), so there is nothing to derive ` +
              `from and the index is INCOMPLETE. This is a write failure, not a parse failure: check free ` +
              `disk space and that the database is writable, then re-run. (underlying: ${postErr?.message ?? postErr})`,
          )
        }
        throw postErr
      }
      phases.postProcessingMs = Date.now() - postProcessingStart
      phases.postProcessingPhases = post.phases

      // M21.I2: a failed post-processing phase must not silently leave the
      // project status as "complete". Persist a visible partial status.
      const failedPhases = post.phases.filter((p) => p.outcome === "failed")
      if (failedPhases.length > 0) {
        try {
          await BrainDatabase.updateIndexStatus(projectId, { status: "partial" })
          _log.log("  ⚠ index marked partial: a post-processing phase failed")
        } catch (statusErr) {
          log.warn("failed to persist partial post-processing status", { error: statusErr })
        }
      }
      phases.totalWallMs = Date.now() - stats.startTime
      // `derivedPass` is what the CLI turns into "derived: <pass> (<note>)", and it
      // was set to "full" unconditionally — so a run whose resolution had thrown
      // printed "derived: full (derived data fully re-processed)" while the log
      // carried a WARN. It could not be derived from the phase outcomes before,
      // because `resolveRelationships` swallowed its own errors and the phase was
      // recorded "ok"; with that fixed the measurement is available and this is it.
      if (stats.summary) stats.summary.derivedPass = failedPhases.length > 0 ? "partial" : "full"
    } else if (options.isIncremental && !options.skipPostProcessing && !stats.cancelled) {
      // M40.A2: bounded incremental post-pass — derived data stays consistent
      // at write-cost proportional to what THIS run touched, never O(project).
      const postProcessingStart = Date.now()
      const bounded = await runBoundedPostProcessing(projectId, {
        projectPath,
        touchedFiles: files,
        snapshot: inEdgeSnapshot,
        logger: _log,
      })
      phases.postProcessingMs = Date.now() - postProcessingStart
      phases.postProcessingPhases = bounded.phases
      stats.m40Bounded = {
        repairedInEdges: bounded.repairedInEdges,
        purgedDeletedFiles: bounded.purgedDeletedFiles,
        touchedSymbols: bounded.touchedSymbols,
      }
      if (bounded.phases.some((p) => p.outcome === "failed")) {
        try {
          await BrainDatabase.updateIndexStatus(projectId, { status: "partial" })
          _log.log("  ⚠ index marked partial: a bounded post-processing phase failed")
        } catch (statusErr) {
          log.warn("failed to persist partial bounded post-processing status", { error: statusErr })
        }
      }
      phases.totalWallMs = Date.now() - stats.startTime
      if (stats.summary) stats.summary.derivedPass = "bounded"
    } else {
      phases.totalWallMs = Date.now() - stats.startTime
      if (stats.summary) stats.summary.derivedPass = stats.cancelled ? "deferred" : "deferred"
      log.debug(options.skipPostProcessing
        ? "skipping heavy post-processing because the caller requested deferred finalization"
        : stats.cancelled
          ? "post-processing deferred: run cancelled (resume to continue)"
          : "post-processing deferred (full-index-only path)")
    }

    // Measured after every derived path has run, so the number describes the index
    // as handed back rather than the pass that produced it.
    //
    // The perf-stats write above (updateIndexStatus with `performanceStats`)
    // happens BEFORE post-processing, so `phases.totalWallMs` was still unset
    // when it was persisted — `bb status` therefore printed "total n/a" after
    // every FULL run while incremental runs showed a real number.
    //
    // Re-persist now that the total is known. It repeats the SAME counter values
    // the first call wrote rather than omitting them: `updateIndexStatus` binds
    // `?? 0` for absent counters, so a call carrying only `performanceStats`
    // RESET total_files/total_symbols to 0 and the status row read as empty for
    // a fully indexed project (caught by store-integrity). Passing them again
    // makes this idempotent and needs no nullability tricks on NOT NULL columns.
    // Built as an ANNOTATED LOCAL rather than an inline literal, which is the
    // whole mechanism: a fresh object literal is excess-property-checked against
    // the declared run type, and that type has no `poolTelemetry` key (see
    // PersistedRun). A variable is checked for assignability only, so the sixth
    // key — which is genuinely what gets written to the JSON column — is part of
    // the shape instead of a violation of it.
    const persistedRun: PersistedRun = {
      generatedAt: perfStats.runs[0].generatedAt,
      mode: phases.mode,
      noop: false,
      phases: {
        discoveryMs: phases.discoveryMs,
        workerStartupMs: phases.workerStartupMs,
        parseMs: phases.parseMs,
        dbFlushMs: phases.dbFlushMs,
        finalAccountingMs: phases.finalAccountingMs,
        postProcessingMs: phases.postProcessingMs,
        totalWallMs: phases.totalWallMs,
      },
      counts: perfStats.runs[0].counts,
      poolTelemetry: {
        dbFlushMs: phases.dbFlushMs,
        retries: phases.retries,
        workerCount: poolTelemetry.workerCount,
        workerStartupFailures: phases.workerStartupFailures,
        poisonFiles: phases.poisonFiles,
      },
    }
    try {
      await BrainDatabase.updateIndexStatus(projectId, {
        filesIndexed: stats.successFiles + stats.skippedFiles,
        filesParsed: stats.successFiles,
        symbolsIndexed: stats.symbolsExtracted,
        relationshipsIndexed: stats.relationshipsFound,
        // "complete" is a claim about the INDEX, so it is decided by the index: parse
      // errors, or files this run discovered that are still absent after recovery.
      // A batch that rolled back and WAS recovered does not make the index partial —
      // it is reported separately as storeFailures.
      status:
        stats.errorFiles > 0 || (stats.summary?.missingAfterRecovery ?? 0) > 0 ? "partial" : "complete",
        errors: stats.structuredErrors,
        performanceStats: {
          schemaVersion: 1,
          runs: [persistedRun],
        },
      })
    } catch (e: any) {
      // The totals are a convenience for `bb status`. Failing to refresh them
      // must not fail the run that has already indexed everything.
      log.warn("could not persist final phase timings", { error: e?.message })
    }

    if (stats.summary) {
      stats.summary.unresolvedRelationships = await measureUnresolvedRelationships(projectId)
      // Measured here, after the derived pass, because that is when the final
      // vector population is known. A provider that died mid-run leaves the
      // index holding two models, and the search path will read it with one.
      stats.summary.embedModels = await surveyEmbeddingModels(projectId)
      stats.summary.embeddingIntegrity = await surveyEmbeddingIntegrity(projectId)
      stats.summary.embedOutcome = {
        queued: backgroundEmbedMetrics.queued,
        embedded: backgroundEmbedMetrics.embedded,
        failed: backgroundEmbedMetrics.failed,
        skipped: backgroundEmbedMetrics.skipped,
        dropped: backgroundEmbedMetrics.dropped,
        invalid: backgroundEmbedMetrics.invalid,
      }
    }

    // Say it through the indexer's own logger too, not only via the summary.
    // Every other honesty line on this path does this, and a library consumer
    // (an MCP host, an embedding library) never sees the CLI — so a defect
    // reported only in `cli/index.ts` is silent for everyone else. Bounded on
    // `mixed`/defects so a healthy index adds nothing.
    reportEmbeddingIntegrity(_log, stats.summary?.embeddingIntegrity)

    Bus.publishSafe(BrainService.Event.IndexingCompleted, {
      projectId,
      stats: {
        files: stats.totalFiles,
        symbols: stats.symbolsExtracted,
        relationships: stats.relationshipsFound,
        errors: stats.errors.length,
        duration: stats.endTime - stats.startTime,
        filesPerSecond: stats.filesPerSecond,
        skippedFiles: stats.skippedFiles,
      },
    })
    // M21.R3: a cancelled run writes its own terminal phase so --resume can
    // distinguish "user stopped it on purpose" from "process died".
    if (stats.cancelled) {
      writeLiveStatus(projectId, {
        projectId,
        phase: "cancelled",
        processedFiles: stats.processedFiles,
        totalFiles: stats.totalFiles,
        startedAt: stats.startTime,
        updatedAt: Date.now(),
      })
    }
    // M22.V2: finalize the live status sample with full phase telemetry so
    // `bb status` shows the complete per-phase breakdown (incl. the co-dominant
    // dbFlush line) and worker count after the run. A cancelled run keeps its
    // "cancelled" phase — it must not be silently re-labelled "complete".
    if (!stats.cancelled) {
      try {
        writeLiveStatus(projectId, {
          projectId,
          phase: stats.errorFiles > 0 ? "failed" : "complete",
          processedFiles: stats.processedFiles,
          totalFiles: stats.totalFiles,
          filesPerSecond: stats.filesPerSecond,
          workerCount: phases.workerCount,
          startedAt: stats.startTime,
          updatedAt: Date.now(),
          error: stats.errorFiles > 0 ? `${stats.errorFiles} files errored` : undefined,
        })
      } catch {}
    }

    return stats
  } catch (error) {
    stats.endTime = Date.now()
    writeLiveStatus(projectId, { projectId, phase: "failed", processedFiles: stats.processedFiles, totalFiles: stats.totalFiles, startedAt: stats.startTime, updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) })
    const errorMsg = error instanceof Error ? error.message : String(error)

    log.error("parallel indexing failed", { projectId, error: errorMsg })

    Bus.publishSafe(BrainService.Event.IndexingFailed, {
      projectId,
      error: errorMsg,
    })

    throw error
  } finally {
    // Every exit path (both returns + the rethrow above) releases the lock.
    // Externally-held locks belong to the caller — never released here.
    if (!externalLock) await lock.release().catch(() => {})
  }
}

// ============================================================================
// INCREMENTAL REINDEXING (for git hooks and file watcher)
// ============================================================================

export interface FileChange {
  path: string
  type: "added" | "modified" | "deleted"
}

/**
 * Wipe a project's data IN PLACE — same DB file, never delete/recreate it.
 * Deleting + recreating the file orphans any process that has it open (e.g.
 * a running MCP server) into a stale handle. An in-place wipe keeps the file
 * (and inode) intact, so every open connection sees the fresh index right
 * away with no restart needed.
 */
export function wipeProjectData(rawDb: any): { rowsDeleted: number } {
  // M54.P1: bulk destructive op — FK OFF avoids any dependency-ordering
  // surprise mid-wipe, then the open-time policy is restored per the
  // BB_FK_ENFORCE seam (same contract as storeResults' finally).
  rawDb.run("PRAGMA foreign_keys = OFF")
  const tables = [
    "brain_semantic_embedding",
    "brain_taint_flow",
    "brain_relationship",
    "brain_import",
    "brain_symbol",
    "brain_query_cache",
    "brain_project_health",
    "brain_index_status",
    "brain_file",
  ]
  // The count is RETURNED because the caller cannot otherwise tell a wipe that
  // emptied a 3 GB file from one that ran on an already-empty database — and
  // `freelist_count` is not a substitute: measured on the real 3.33 GB project
  // database, it still read 0 pages free immediately after every row was deleted.
  let rowsDeleted = 0
  for (const t of tables) {
    try {
      const info = rawDb.run(`DELETE FROM ${t}`)
      rowsDeleted += Number(info?.changes ?? 0)
    } catch {}
  }
  // temp resolution tables (per-connection; safe to clear if present)
  for (const t of ["_res_qname", "_res_name", "_res_name_unique"]) {
    try {
      rawDb.run(`DELETE FROM ${t}`)
    } catch {}
  }
  // M54.P1: restore the open-time FK policy (connection is process-cached).
  if (process.env.BB_FK_ENFORCE === "0") {
    rawDb.run("PRAGMA foreign_keys = OFF")
  } else {
    rawDb.run("PRAGMA foreign_keys = ON")
  }
  return { rowsDeleted }
}

// ═══════════════════════════════════════════════════════════════════════════
// M50.A2 (#764): dense-vector accelerator backfill.
//
// The indexer writes the float32 blob for every dense vector it embeds, so
// fresh indexes never need this. Legacy rows (written before this column
// existed, or by writers that INSERT explicit column lists) keep a NULL blob
// and stay readable through the JSON path — this pass promotes them in place so
// bb_ask stops re-parsing 260MB of JSON digits per call.
//
// Bounded by construction:
//  - keyset pagination on rowid visits each row at most once per call;
//  - a wall-clock budget (default 30s, BB_VECTOR_BLOB_BACKFILL_BUDGET_MS)
//    stops the phase and DECLARES the remaining count instead of blocking a
//    full index for minutes on a multi-GB embedding table;
//  - only rows whose JSON scans to exactly vector_dimension dense numbers are
//    promoted; sparse token lists (tfidf-v1) and malformed rows are skipped
//    and never marked done, so no data is rewritten with a wrong shape.
// ═══════════════════════════════════════════════════════════════════════════
export async function backfillEmbeddingBlobs(
  projectId: ProjectID,
  opts: { budgetMs?: number; batch?: number } = {},
): Promise<{ scanned: number; promoted: number; remaining: number; budgetExhausted: boolean }> {
  const budgetMs = opts.budgetMs ?? Number(process.env.BB_VECTOR_BLOB_BACKFILL_BUDGET_MS || 30_000)
  const batch = Math.max(1, opts.batch ?? 500)
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const select = rawDb.prepare(
    "SELECT rowid AS rowid, embedding_vector AS vector, vector_dimension AS dim FROM brain_semantic_embedding " +
      "WHERE project_id = ? AND embedding_blob IS NULL AND embedding_model != 'tfidf-v1' AND rowid > ? " +
      "ORDER BY rowid LIMIT ?",
  )
  const update = rawDb.prepare("UPDATE brain_semantic_embedding SET embedding_blob = ? WHERE rowid = ?")
  const t0 = Date.now()
  let scanned = 0
  let promoted = 0
  let lastRowid = 0
  let budgetExhausted = false
  const scratchByDim = new Map<number, Float32Array>()

  for (;;) {
    if (Date.now() - t0 > budgetMs) {
      budgetExhausted = true
      break
    }
    const rows = select.all(projectId, lastRowid, batch) as Array<{ rowid: number; vector: string; dim: number }>
    if (rows.length === 0) break
    lastRowid = rows[rows.length - 1].rowid
    scanned += rows.length
    let promotedInBatch = 0
    const items: Array<{ rowid: number; blob: Buffer }> = []
    for (const r of rows) {
      const dim = Number(r.dim)
      if (!Number.isInteger(dim) || dim <= 0 || dim > 8192) continue
      let scratch = scratchByDim.get(dim)
      if (!scratch) {
        scratch = new Float32Array(dim)
        scratchByDim.set(dim, scratch)
      }
      const n = scanJsonVectorInto(typeof r.vector === "string" ? r.vector : "", scratch)
      if (n !== dim) continue
      items.push({ rowid: r.rowid, blob: encodeVectorBlob(scratch) })
    }
    if (items.length > 0) {
      const tx = rawDb.transaction((batchItems: Array<{ rowid: number; blob: Buffer }>) => {
        for (const it of batchItems) update.run(it.blob, it.rowid)
      })
      tx(items)
      promotedInBatch = items.length
    }
    promoted += promotedInBatch
    if (rows.length < batch) break
  }

  const remaining =
    ((rawDb
      .prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? AND embedding_blob IS NULL AND embedding_model != 'tfidf-v1'")
      .get(projectId) as any)?.c as number) ?? 0
  return { scanned, promoted, remaining, budgetExhausted }
}

// ═══════════════════════════════════════════════════════════════════════════
// M40.A1: THE post-processing entry.
//
// The five heavy phases (relationship resolution, enrichment, gravity, taints,
// health) plus the lightweight integrity check used to exist only inline in
// the full-index branch — meaning every incremental path (bb index --changed,
// --resume, adoption, bb_edit, LSP, MCP bb_index) left derived data stale with
// no remediation short of a full re-index. This function is now the ONE shared
// entry: the full index calls it (above), `bb index --post` calls it directly
// (no re-parse), and MCP bb_index mode=post exposes it to agents.
//
// Contract (M21.I2 shape, unchanged):
//  - every phase records ms + outcome (ok|failed); a failed phase never
//    silently reports "complete"
//  - requires a prior index: with zero brain_file rows this throws — callers
//    surface it as an error, never as a quiet no-op
//  - parseEvents: --post never parsed anything, so enrichment/history events
//    carry parseFiles=0 (honest telemetry)
// ═══════════════════════════════════════════════════════════════════════════
export interface PostProcessingResult {
  phases: PostProcessingPhaseTiming[]
  totalMs: number
  integrityHealth: number | null
}

export async function runPostProcessing(
  projectId: ProjectID,
  opts: {
    /** stderr/stdio-safe logger; defaults to console (CLI). LSP/MCP pass a safe logger. */
    logger?: { log: (...args: any[]) => void; write: (s: string) => void }
    /** M40.A2 hook: skip specific phases in the bounded incremental pass. */
    skipPhases?: Array<PostProcessingPhaseTiming["name"]>
    /** M43.P1 (#656): true when the CALLER already holds the project lock
     * (indexProjectParallel's internal bounded/full pass). No re-acquire. */
    lockHeld?: boolean
  } = {},
): Promise<PostProcessingResult> {
  const _log = opts.logger ?? { log: (...args: any[]) => console.log(...args), write: (s: string) => process.stdout.write(s) }
  const skip = new Set(opts.skipPhases ?? [])

  // Requires a prior index: zero files means there is nothing to derive from.
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const fileCount = (rawDb.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as any)?.c ?? 0
  if (fileCount === 0) {
    throw new Error(`no index for project ${String(projectId).slice(0, 8)} — post-processing derives from indexed symbols; run bb index first`)
  }

  // M43.P1: post-processing mutates derived data, so it takes the same
  // single-flight lock. Standalone entry points (CLI `bb index --post`, MCP
  // bb_index mode=post) acquire here; internal callers pass lockHeld=true.
  const lock = opts.lockHeld === true ? null : await acquireIndexLock(projectId, { kind: "post" })

  try {
  const start = Date.now()
  const phases: PostProcessingPhaseTiming[] = []
  const recordPhase = (name: PostProcessingPhaseTiming["name"], ms: number, outcome: PostProcessingPhaseTiming["outcome"]) => {
    phases.push({ name, ms, outcome })
  }
  let integrityHealth: number | null = null

  try {
    _log.log("  Resolving cross-file relationships...")
    let _t = Date.now()
    try {
      const relStats = await resolveRelationships(projectId)
      recordPhase("relationships", Date.now() - _t, "ok")
      // The plan's own numbers ride the phase line because the scaling gate
      // (`script/perf/verify-scaling-linear.ts`) parses THIS line: it has to read
      // what the pass did, not a replica of what some plan was expected to do.
      // `plan=none` and `largest-intermediate=-1` report the pass not running —
      // absent evidence, which the gate rejects, never a zero that reads as a
      // perfect score.
      _log.log(`  ✓ resolved in ${Date.now()-_t}ms [plan=${relStats?.plan ?? "none"} largest-intermediate=${relStats ? relStats.largestIntermediate : -1}]`)
    } catch (relErr: any) {
      recordPhase("relationships", Date.now() - _t, "failed")
      log.warn("relationship resolution failed", { error: relErr?.message })
    }

    // Enrich relationships with architectural reasoning (Phase 1+2)
    try {
      const { enrichRelationships } = await import("../brain/brain-relationship-enrichment")
      _log.log("  Enriching relationships with architectural context...")
      _t = Date.now()
      const enrichResult = await enrichRelationships(projectId, (step: string, pct: number) => {
        // `\r` + erase-code only rewrites a line on a real terminal. Written to a
        // pipe or log file it emits one unerasable fragment per step — the
        // "Enriching: reading 0%[KEnriching: counting 0%[K..." smear. Off a TTY,
        // report only at meaningful milestones so the log stays readable.
        const isTTY = Boolean(process.stderr.isTTY)
        if (isTTY) {
          _log.write(`\r  Enriching: ${step} ${pct}%\x1b[K`)
        } else if (pct === 100 || pct % 25 === 0) {
          _log.write(`  enriching ${step} ${pct}%\n`)
        }
      })
      recordPhase("enrichment", Date.now() - _t, "ok")
      _log.log(`  ✅ Enriched ${enrichResult.enriched.toLocaleString()} relationships (${enrichResult.patternsFound.toLocaleString()} patterns) in ${Date.now()-_t}ms`)
    } catch (enrichErr) {
      recordPhase("enrichment", Date.now() - _t, "failed")
      log.warn("relationship enrichment failed", { error: enrichErr })
    }

    _log.log("  Computing gravity scores...")
    _t = Date.now()
    try {
      await calculateGravityScores(projectId)
      recordPhase("gravity", Date.now() - _t, "ok")
      _log.log(`  ✓ gravity in ${Date.now()-_t}ms`)
    } catch (gravityErr: any) {
      recordPhase("gravity", Date.now() - _t, "failed")
      log.warn("gravity scores failed", { error: gravityErr?.message })
    }

    // Taint and health are independent phases: each records its own timing
    // and outcome so a failure in one never mislabels the other.
    _log.log("  Analyzing taint flows & security...")
    _t = Date.now()
    try {
      await resolveCrossSymbolTaints(projectId)
      recordPhase("taint", Date.now() - _t, "ok")
    } catch (postErr: any) {
      recordPhase("taint", Date.now() - _t, "failed")
      log.warn("post-indexing taint analysis failed", { error: postErr?.message })
    }
    const taintMs = Date.now() - _t
    _t = Date.now()
    try {
      await (await import("./project-health")).computeAndStoreProjectHealth(projectId)
      recordPhase("health", Date.now() - _t, "ok")
    } catch (healthErr: any) {
      recordPhase("health", Date.now() - _t, "failed")
      log.warn("post-indexing health computation failed", { error: healthErr?.message })
    }
    _log.log(`  ✓ taint(${taintMs}ms) + health(${Date.now()-_t}ms)`)

    // Lightweight post-index integrity validation (4 fast checks)
    try {
      _t = Date.now()
      const { runIndexHealthCheck } = await import("../brain/brain-index-health")
      const health = await runIndexHealthCheck(projectId)
      recordPhase("integrity", Date.now() - _t, "ok")
      integrityHealth = health.overallHealth
      _log.log(`  ✓ health check in ${Date.now()-_t}ms`)
      const warnCount = health.checks.filter((c) => c.status !== "ok").length
      if (warnCount > 0) {
        _log.log(`  ⚠️  Index health: ${health.overallHealth}% — ${warnCount} warnings (run bb_health(integrity=true) for details)`)
        for (const c of health.checks.filter((c) => c.status === "error")) {
          _log.log(`    ❌ ${c.name}: ${c.description}`)
        }
      } else {
        _log.log(`  ✅ Index health: 100% — all checks passed`)
      }
    } catch (healthErr) {
      recordPhase("integrity", Date.now() - _t, "failed")
      log.warn("post-index health check failed", { error: healthErr })
    }

    // M50.A2 (#764): promote legacy dense vectors to their binary form before
    // ANALYZE (the update is a write, so stats must be refreshed after it).
    // Bounded by a wall-clock budget: a huge legacy index is completed over
    // successive post runs instead of blocking this one, and the remaining
    // count is always declared. Rows whose JSON is not a dense numeric vector
    // are never touched (they keep working through the JSON path).
    _t = Date.now()
    try {
      const vb = await backfillEmbeddingBlobs(projectId)
      recordPhase("vectorBlobs", Date.now() - _t, "ok")
      _log.log(
        `  ✓ vector blobs: ${vb.promoted.toLocaleString()}/${vb.scanned.toLocaleString()} promoted in ${Date.now()-_t}ms` +
          (vb.remaining > 0 ? ` (${vb.remaining.toLocaleString()} legacy rows remain${vb.budgetExhausted ? "; budget reached, continues next post run" : ""})` : ""),
      )
    } catch (vbErr: any) {
      recordPhase("vectorBlobs", Date.now() - _t, "failed")
      log.warn("vector blob backfill failed", { error: vbErr?.message })
    }

    // M50.A2 (#764): refresh planner statistics after every full post-pass.
    // All bulk writes are done by this point, so the stats describe the final
    // row counts. Without this, the query planner guesses — and the measured
    // guess on real DBs was a full brain_symbol scan per graph hop (~15s per
    // bb_graph call; bb_patterns timed out at 45s). With sqlite_stat1 present
    // the same hops are sub-millisecond. Measured one-time cost: ~8s on a
    // 4.8GB/168k-symbol DB, fully covered by the single-flight index lock.
    _t = Date.now()
    try {
      rawDb.exec("ANALYZE")
      recordPhase("analyze", Date.now() - _t, "ok")
      _log.log(`  ✓ planner stats (ANALYZE) in ${Date.now()-_t}ms`)
    } catch (analyzeErr: any) {
      recordPhase("analyze", Date.now() - _t, "failed")
      log.warn("planner stats (ANALYZE) failed", { error: analyzeErr?.message })
    }
  } catch (err) {
    log.warn("failed to compute project health or resolve taints", { error: err })
  }

  return { phases, totalMs: Date.now() - start, integrityHealth }
  } finally {
    if (lock) await lock.release().catch(() => {})
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// M40.A2: BOUNDED post-processing for incremental runs.
//
// The full post-pass rewrites every relationship/symbol row — O(project) —
// which is why incremental runs skipped it and left derived data stale
// (or worse: INSERT OR REPLACE resets re-parsed symbols' gravity_score, and
// storeResults deletes cross-file edges TARGETING re-parsed files without a
// way to rebuild them). This pass fixes exactly what the incremental run
// touched, and nothing else:
//
//   1. in-edge repair   — edges from OTHER files into re-parsed files were
//                         deleted by storeResults; restore them from the
//                         pre-parse snapshot and re-resolve their targets.
//   2. relationships    — resolve only rows still unresolved (re-parsed +
//                         repaired rows). Full-scan temp tables, targeted updates.
//   3. enrichment       — scoped: only relationships SOURCING from touched
//                         symbols. Global in-degree stays exact.
//   4. gravity          — scoped: touched symbols (INSERT OR REPLACE reset
//                         their scores) + edge targets whose in-degree changed.
//   5. taint            — unresolved flows only (full query, targeted updates).
//   6. health           — SQL aggregates (no row rewrites); measured, documented.
//   7. deleted purge    — DB rows for files no longer on disk (incremental
//                         discovery never learns about deletions otherwise).
//
// Boundedness: the WRITE cost (the dominant O(project) term of the full pass)
// scales with touched symbols/edges, not project size. Read-only aggregates
// are measured and reported per-phase so the gate can verify the claim.
// ═══════════════════════════════════════════════════════════════════════════

/** One cross-file edge INTO a to-be-re-parsed file, captured before storeResults deletes it. */
export interface InEdgeSnapshotRow {
  source_symbol_id: string
  target_name: string
  relationship_type: string
  confidence: number
  context: string | null
  line_number: number | null
  /** Pre-computed enrichment (layerFlow/criticality/pattern/...). Global in-degree is preserved by the scoped pass, so restoring verbatim is exact. */
  metadata: string | null
}

/**
 * Capture every relationship whose TARGET lives in one of the given files
 * (source is in a different file — those edges die when the file re-parses).
 * Must run BEFORE parsing: storeResults deletes them.
 */
export async function snapshotInEdges(projectId: ProjectID, fileIds: string[]): Promise<InEdgeSnapshotRow[]> {
  if (fileIds.length === 0) return []
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const rows: InEdgeSnapshotRow[] = []
  const CHUNK = 500
  for (let i = 0; i < fileIds.length; i += CHUNK) {
    const chunk = fileIds.slice(i, i + CHUNK)
    const placeholders = chunk.map(() => "?").join(",")
    const part = rawDb.prepare(`
      SELECT r.source_symbol_id, r.target_external AS target_name, r.relationship_type,
             r.confidence, r.context, r.line_number, r.metadata
      FROM brain_relationship r
      JOIN brain_symbol t ON t.id = r.target_symbol_id
      WHERE r.project_id = ?
        AND t.file_id IN (${placeholders})
        AND r.source_symbol_id NOT IN (SELECT id FROM brain_symbol WHERE file_id IN (${placeholders}))
        AND r.target_external IS NOT NULL AND r.target_external != ''
    `).all(projectId, ...chunk, ...chunk) as any[]
    for (const r of part) {
      rows.push({
        source_symbol_id: r.source_symbol_id,
        target_name: r.target_name,
        relationship_type: r.relationship_type,
        confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
        context: r.context ?? null,
        line_number: r.line_number ?? null,
        metadata: typeof r.metadata === "string" ? r.metadata : null,
      })
    }
  }
  return rows
}

/**
 * Restore snapshot edges as unresolved rows (target_external set, target NULL)
 * so the resolution phase re-resolves them against the fresh symbol table.
 * Deterministic ids make re-runs idempotent (INSERT OR IGNORE).
 */
// M59/#821: exported for the legacy-zero-heal gate (verify-legacy-zero-heal.ts) —
// the repair path is the one place a pre-M59 index's stored 0 can re-enter the DB.
export async function repairInEdges(projectId: ProjectID, snapshot: InEdgeSnapshotRow[]): Promise<number> {
  if (snapshot.length === 0) return 0
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const now = Date.now()
  const insert = rawDb.prepare(`
    INSERT OR IGNORE INTO brain_relationship
    (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external, relationship_type, confidence, context, line_number, is_cross_file, is_cross_language, bridge_mechanism, metadata, time_created, time_updated)
    VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?, ?)
  `)
  let repaired = 0
  const tx = rawDb.transaction((rows: InEdgeSnapshotRow[]) => {
    // Batched multi-row INSERT (50 rows/statement): the per-run() overhead of
    // single-row binds measured ~700ms for 12K rows on the A2 fixture — this
    // pass sits on bb_edit/LSP's interactive path, so bind overhead matters.
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50)
      const valuesSql = batch.map(() => "(?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?, ?)").join(",")
      const params: any[] = []
      for (const r of batch) {
        // M59/#821: snapshot rows from a LEGACY index may carry the old stored
        // 0 ("unknown" written as a number). Re-storing it verbatim would let
        // the class survive every reindex. Heal at the boundary: > 0 keeps the
        // analyzer's line; 0/NULL/undefined becomes NULL. The id keeps the
        // legacy `?? 0` component so re-runs stay idempotent with existing rows.
        const ln = typeof r.line_number === "number" && r.line_number > 0 ? r.line_number : null
        const id = `${r.source_symbol_id}:${r.relationship_type}:${r.target_name}:${r.line_number ?? 0}:m40`
        // Idempotency: deterministic id + INSERT OR IGNORE (PK dedup).
        params.push(id, projectId, r.source_symbol_id, r.target_name, r.relationship_type, r.confidence, r.context, ln, r.metadata, now, now)
      }
      rawDb.prepare(`
        INSERT OR IGNORE INTO brain_relationship
        (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external, relationship_type, confidence, context, line_number, is_cross_file, is_cross_language, bridge_mechanism, metadata, time_created, time_updated)
        VALUES ${valuesSql}
      `).run(...params)
      repaired += batch.length
    }
  })
  tx(snapshot)
  return repaired
}

/**
 * Purge DB rows for files that no longer exist on disk. Incremental discovery
 * only sees files present on disk — a deleted file's rows would otherwise
 * linger forever as orphans (symbols/relationships/taints pointing nowhere).
 * Returns the number of files purged.
 */
export async function purgeDeletedFiles(projectId: ProjectID, projectPath: string): Promise<number> {
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const rows = rawDb.prepare(`SELECT id, path FROM brain_file WHERE project_id = ?`).all(projectId) as any[]
  const { existsSync } = await import("fs")
  const deadIds: string[] = []
  for (const r of rows) {
    // brain_file.path stores the absolute path at index time.
    if (typeof r.path === "string" && !existsSync(r.path)) deadIds.push(r.id)
  }
  if (deadIds.length === 0) return 0
  const deleteRelBySource = rawDb.prepare(`DELETE FROM brain_relationship WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)`)
  const deleteRelByTarget = rawDb.prepare(`DELETE FROM brain_relationship WHERE target_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)`)
  const deleteTaints = rawDb.prepare(`DELETE FROM brain_taint_flow WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?) OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)`)
  const deleteSymbols = rawDb.prepare(`DELETE FROM brain_symbol WHERE file_id = ?`)
  const deleteImports = rawDb.prepare(`DELETE FROM brain_import WHERE file_id = ?`)
  const deleteFile = rawDb.prepare(`DELETE FROM brain_file WHERE id = ?`)
  const tx = rawDb.transaction((ids: string[]) => {
    for (const id of ids) {
      deleteRelBySource.run(id)
      deleteRelByTarget.run(id)
      deleteTaints.run(id, id)
      deleteSymbols.run(id)
      deleteImports.run(id)
      deleteFile.run(id)
    }
  })
  tx(deadIds)
  return deadIds.length
}

export interface BoundedPostProcessingResult {
  phases: PostProcessingPhaseTiming[]
  totalMs: number
  repairedInEdges: number
  purgedDeletedFiles: number
  touchedSymbols: number
}

/**
 * The bounded incremental post-pass. `snapshot` must come from snapshotInEdges
 * taken BEFORE the parse; `touchedFiles` are the absolute paths re-parsed this run.
 */
export async function runBoundedPostProcessing(
  projectId: ProjectID,
  opts: {
    projectPath: string
    touchedFiles: string[]
    snapshot: InEdgeSnapshotRow[]
    logger?: { log: (...args: any[]) => void; write: (s: string) => void }
  },
): Promise<BoundedPostProcessingResult> {
  const _log = opts.logger ?? { log: (...args: any[]) => console.log(...args), write: (s: string) => process.stdout.write(s) }
  const start = Date.now()
  const phases: PostProcessingPhaseTiming[] = []
  const recordPhase = (name: PostProcessingPhaseTiming["name"], ms: number, outcome: PostProcessingPhaseTiming["outcome"]) => {
    phases.push({ name, ms, outcome })
  }

  const touchedFileIds = opts.touchedFiles.map((f) => `${projectId}:${path.relative(opts.projectPath, f)}`)
  const rawDb = await BrainDatabase.getRawInstance(projectId)

  // Touched symbol ids (post-parse, deterministic) + edge targets whose
  // in-degree changed (gravity scope must include them).
  let touchedSymbols: string[] = []
  for (let i = 0; i < touchedFileIds.length; i += 500) {
    const chunk = touchedFileIds.slice(i, i + 500)
    const placeholders = chunk.map(() => "?").join(",")
    const rows = rawDb.prepare(`SELECT id FROM brain_symbol WHERE project_id = ? AND file_id IN (${placeholders})`).all(projectId, ...chunk) as any[]
    touchedSymbols.push(...rows.map((r) => r.id))
  }
  const targets: string[] = []
  for (let i = 0; i < touchedSymbols.length; i += 500) {
    const chunk = touchedSymbols.slice(i, i + 500)
    const placeholders = chunk.map(() => "?").join(",")
    const rows = rawDb.prepare(`SELECT DISTINCT target_symbol_id AS t FROM brain_relationship WHERE project_id = ? AND source_symbol_id IN (${placeholders}) AND target_symbol_id IS NOT NULL`).all(projectId, ...chunk) as any[]
    targets.push(...rows.map((r) => r.t))
  }
  const gravityScope = Array.from(new Set([...touchedSymbols, ...targets]))

  // 1. in-edge repair
  let repairedInEdges = 0
  {
    const _t = Date.now()
    try {
      repairedInEdges = await repairInEdges(projectId, opts.snapshot)
      recordPhase("relationships", Date.now() - _t, "ok")
      if (repairedInEdges > 0) _log.log(`  bounded: restored ${repairedInEdges} cross-file edge(s) into re-parsed files`)
    } catch (e: any) {
      recordPhase("relationships", Date.now() - _t, "failed")
      log.warn("bounded in-edge repair failed", { error: e?.message })
    }
  }

  // 2. relationship resolution — SCOPED: repaired in-edges target symbols in
  // touched files by construction, so a temp table of just those symbols
  // resolves them in O(touched). storeResults' final flush already resolved
  // the re-parsed file's own new edges (skipResolution=false on the last batch).
  {
    const _t = Date.now()
    try {
      if (touchedFileIds.length > 0) {
        rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _m40_touched (id TEXT PRIMARY KEY, name TEXT, qualified_name TEXT)`)
        rawDb.run(`DELETE FROM _m40_touched`)
        for (let i = 0; i < touchedFileIds.length; i += 500) {
          const chunk = touchedFileIds.slice(i, i + 500)
          const placeholders = chunk.map(() => "?").join(",")
          rawDb.prepare(`INSERT OR IGNORE INTO _m40_touched (id, name, qualified_name) SELECT id, name, qualified_name FROM brain_symbol WHERE project_id = ? AND file_id IN (${placeholders})`).run(projectId, ...chunk)
        }
        // M40.A4 portable + set-based. #738 root cause: the original single
        // correlated INSERT..SELECT referenced the outer column r.target_external
        // inside the subquery's ORDER BY. Bun's SQLite 3.53 accepts that; Node's
        // better-sqlite3 bundles 3.49.2, which REJECTS it ("no such column:
        // r.target_external") — and production `bin/bb` runs under Node, so every
        // CLI index failed this phase and marked itself partial. All verifier
        // gates ran under bun, which is how it survived. Replacement (proven
        // equivalent on BOTH runtimes by script/m54/probe-738-sqlite.ts):
        // two-pass JOIN + INSERT OR IGNORE — pass A matches qualified_name (its
        // rows win via OR IGNORE), pass B fills bare-name matches; MIN(t.id)
        // preserves the original's deterministic lowest-id tie-break. No
        // correlated subquery, no outer-column reference anywhere.
        rawDb.run(`CREATE TEMP TABLE IF NOT EXISTS _m40_match (rel_id TEXT PRIMARY KEY, symbol_id TEXT)`)
        rawDb.run(`DELETE FROM _m40_match`)
        const m40RelFilter = `r.project_id = ?
            AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.target_external != ''
            AND r.id LIKE '%:m40'`
        rawDb.prepare(`INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)
          SELECT j.rel_id, MIN(j.symbol_id) FROM (
            SELECT r.id AS rel_id, t.id AS symbol_id
            FROM brain_relationship r JOIN _m40_touched t ON t.qualified_name = r.target_external
            WHERE ${m40RelFilter}
          ) j GROUP BY j.rel_id`).run(projectId)
        rawDb.prepare(`INSERT OR IGNORE INTO _m40_match (rel_id, symbol_id)
          SELECT j.rel_id, MIN(j.symbol_id) FROM (
            SELECT r.id AS rel_id, t.id AS symbol_id
            FROM brain_relationship r JOIN _m40_touched t ON t.name = r.target_external
            WHERE ${m40RelFilter}
          ) j GROUP BY j.rel_id`).run(projectId)
        rawDb.prepare(`
          UPDATE brain_relationship
          SET target_symbol_id = m.symbol_id,
              time_updated = strftime('%s','now') * 1000
          FROM _m40_match m
          WHERE brain_relationship.id = m.rel_id
            AND brain_relationship.project_id = ?
            AND m.symbol_id IS NOT NULL
        `).run(projectId)
      }
      recordPhase("relationships", Date.now() - _t, "ok")
    } catch (e: any) {
      recordPhase("relationships", Date.now() - _t, "failed")
      log.warn("bounded relationship resolution failed", { error: e?.message })
    }
  }

  // 3. enrichment — scoped to touched sources
  {
    const _t = Date.now()
    try {
      const { enrichRelationships } = await import("../brain/brain-relationship-enrichment")
      await enrichRelationships(projectId, undefined, { sourceSymbolIds: touchedSymbols })
      recordPhase("enrichment", Date.now() - _t, "ok")
    } catch (e: any) {
      recordPhase("enrichment", Date.now() - _t, "failed")
      log.warn("bounded enrichment failed", { error: e?.message })
    }
  }

  // 4. gravity — scoped to touched symbols + changed in-degree targets
  {
    const _t = Date.now()
    try {
      await calculateGravityScores(projectId, { symbolIds: gravityScope })
      recordPhase("gravity", Date.now() - _t, "ok")
    } catch (e: any) {
      recordPhase("gravity", Date.now() - _t, "failed")
      log.warn("bounded gravity failed", { error: e?.message })
    }
  }

  // 5. taint — resolution processes only unresolved flows
  {
    const _t = Date.now()
    try {
      await resolveCrossSymbolTaints(projectId)
      recordPhase("taint", Date.now() - _t, "ok")
    } catch (e: any) {
      recordPhase("taint", Date.now() - _t, "failed")
      log.warn("bounded taint resolution failed", { error: e?.message })
    }
  }

  // 6. health — SQL aggregates, no per-row rewrites (measured, not assumed)
  {
    const _t = Date.now()
    try {
      await (await import("./project-health")).computeAndStoreProjectHealth(projectId)
      recordPhase("health", Date.now() - _t, "ok")
    } catch (e: any) {
      recordPhase("health", Date.now() - _t, "failed")
      log.warn("bounded health computation failed", { error: e?.message })
    }
  }

  // 7. deleted-file purge
  let purgedDeletedFiles = 0
  {
    const _t = Date.now()
    try {
      purgedDeletedFiles = await purgeDeletedFiles(projectId, opts.projectPath)
      recordPhase("integrity", Date.now() - _t, "ok")
      if (purgedDeletedFiles > 0) _log.log(`  bounded: purged ${purgedDeletedFiles} deleted file(s) from the index`)
    } catch (e: any) {
      recordPhase("integrity", Date.now() - _t, "failed")
      log.warn("bounded deleted-purge failed", { error: e?.message })
    }
  }

  return { phases, totalMs: Date.now() - start, repairedInEdges, purgedDeletedFiles, touchedSymbols: touchedSymbols.length }
}

// M48.C2 (#700): dir-mode change detection scoped to a subdirectory, computed
// against the PROJECT ROOT so file keys never move. The old dir path indexed
// with the subdir itself as projectPath, re-keying every row ("mod.ts" instead
// of "src/mod.ts") — duplicate rows, lost symbols, and reads that resolved
// against a corrupted index. Comparison matches the discovery fast path
// exactly: Math.floor(mtimeMs) + size_bytes; files discovery would skip
// (>5MB) are skipped here too, and the same heavyweight directories
// discovery never indexes are excluded, so there is no correctness gap
// against a full `bb index`.
const DIR_WALK_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", "target", "vendor", "__pycache__", ".venv", "venv"])
const DIR_WALK_SIZE_LIMIT = 5 * 1024 * 1024

export async function collectDirChanges(
  projectId: ProjectID,
  root: string,
  dir: string,
): Promise<FileChange[]> {
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const rows = rawDb
    .prepare(`SELECT path, last_modified, size_bytes FROM brain_file WHERE project_id = ?`)
    .all(projectId) as { path: string; last_modified: number; size_bytes: number }[]
  const stored = new Map(rows.map((r) => [r.path, r]))
  const changes: FileChange[] = []
  const seen = new Set<string>()
  const walk = async (d: string): Promise<void> => {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (DIR_WALK_SKIP_DIRS.has(e.name)) continue
        await walk(path.join(d, e.name))
        continue
      }
      if (!e.isFile()) continue
      const p = path.join(d, e.name)
      let st
      try { st = await stat(p) } catch { continue }
      if (st.size > DIR_WALK_SIZE_LIMIT) continue
      seen.add(p)
      const row = stored.get(p)
      if (!row) changes.push({ path: p, type: "added" })
      else if (Math.floor(row.last_modified) !== Math.floor(st.mtimeMs) || row.size_bytes !== st.size) changes.push({ path: p, type: "modified" })
    }
  }
  const base = path.resolve(dir)
  await walk(base)
  const basePrefix = base.endsWith(path.sep) ? base : base + path.sep
  for (const p of stored.keys()) if (p.startsWith(basePrefix) && !seen.has(p)) changes.push({ path: p, type: "deleted" })
  return changes
}

export async function reindexFilesParallel(
  projectId: ProjectID,
  projectPath: string,
  changes: FileChange[],
  // Optional logger forwarded to indexProjectParallel. LSP-safety-critical:
  // the DEFAULT logger writes progress to process.stdout, which corrupts
  // JSON-RPC framing on any stdio server embedding the indexer (the editor
  // client dies with "Header must provide a Content-Length property" —
  // found live by M25.E5). stdio callers MUST pass a stderr logger.
  options?: { logger?: { log: (...args: any[]) => void; write: (s: string) => void } },
): Promise<{ indexed: number; deleted: number; errors: number; /** Files the caller named that the indexer declined — unsupported or binary
   *  types, and files whose parse produced nothing. It used to be indistinguishable
   *  from a file that was indexed: a binary file answered `indexed: 0, deleted: 0,
   *  errors: 0`, which to a caller is indistinguishable from "already current". */
  skipped: number; skippedReason?: string; /** WHICH files failed and WHY. The delegated
   *  `indexProjectParallel` has always collected `{ file, error }` per failure and
   *  returned it; reindexFilesParallel counted them and dropped them. A write tool
   *  reporting "3 errors" tells its caller nothing it can act on — not which file,
   *  not whether to retry, and not whether the failure is transient. Bounded, so a
   *  large failure cannot become a large payload. */
  errorDetail: Array<{ file: string; error: string }>; derived?: { pass: string; phases: PostProcessingPhaseTiming[]; repairedInEdges: number; touchedSymbols: number } }> {
  // M68: normalise the project root ONCE, here, so every `path.relative` in this
  // function and in storeResults agrees with what the INITIAL index wrote.
  //
  // The defect this fixes was found through bb_edit and is the worst in this file.
  // A caller may spell the project root either way — `/var/folders/X` or
  // `/private/var/folders/X` are the same directory on macOS — and the initial
  // index and the incremental reindex were being handed DIFFERENT spellings by
  // different callers. `storeResults` then computed
  //
  //   fileId        = `${projectId}:${path.relative(projectPath, filePath)}`   (correct)
  //   relative_path = filePath.replace(projectPath, "").replace(/^\//, "")     (broken)
  //
  // so a reindex of an already-indexed file produced a fileId matching no
  // existing row: every DELETE hit zero rows and the INSERT created a SECOND
  // brain_file row filed under the absolute path. The file then appeared twice,
  // its symbols appeared twice, and the second bb_edit on that file failed for
  // good with "symbol is ambiguous". MEASURED: editing one symbol left
  //
  //   brain_file    src/a.ts                  (original)
  //                var/folders/.../src/a.ts  (duplicate)
  //   brain_symbol  alpha  x2
  //
  // and no bb_edit gate saw it, because every one of them edits each symbol once.
  //
  // `realpathSync` is the operation that collapses the two spellings to one. It
  // is applied HERE rather than at each call site because seven callers pass this
  // path and one of them passing it differently is all it takes — bb_edit was the
  // only one that realpath'd it, and it was enough to break the whole incremental
  // path for that project.
  const realProjectPath = realpathSync(projectPath)
  const result: { indexed: number; deleted: number; errors: number; skipped: number; skippedReason?: string; errorDetail: Array<{ file: string; error: string }>; derived?: { pass: string; phases: PostProcessingPhaseTiming[]; repairedInEdges: number; touchedSymbols: number } } = { indexed: 0, deleted: 0, errors: 0, skipped: 0, errorDetail: [] }

  // M43.P1 (#656): deletion writes AND the delegated parse+post run are ONE
  // lock scope — a concurrent indexer must never interleave between our
  // deletes and the re-parse. indexProjectParallel gets the handle so it does
  // not re-acquire (no deadlock); we release in the finally below.
  const lock = await acquireIndexLock(projectId, { kind: "reindex" })
  try {
  const deleted = changes.filter((c) => c?.type === "deleted")
  if (deleted.length > 0) {
    try {
      const rawDb = await BrainDatabase.getRawInstance(projectId)
      rawDb.prepare(`DELETE FROM brain_query_cache WHERE project_id = ?`).run(projectId)
      const deleteSymbols = rawDb.prepare(`DELETE FROM brain_symbol WHERE file_id = ?`)
      const deleteImports = rawDb.prepare(`DELETE FROM brain_import WHERE file_id = ?`)
      const deleteFile = rawDb.prepare(`DELETE FROM brain_file WHERE id = ?`)
      const deleteRelationships = rawDb.prepare(`
        DELETE FROM brain_relationship 
        WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
      `)
      const deleteTaints = rawDb.prepare(`
        DELETE FROM brain_taint_flow 
        WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
           OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
      `)

      const tx = rawDb.transaction(() => {
        for (const change of deleted) {
          const relativePath = path.relative(realProjectPath, change.path)
          const fileId = `${projectId}:${relativePath}`
          deleteRelationships.run(fileId)
          deleteTaints.run(fileId, fileId)
          deleteSymbols.run(fileId)
          deleteImports.run(fileId)
          deleteFile.run(fileId)
          result.deleted++
        }
      })
      tx()
    } catch (error) {
      log.error("failed to delete files from index", { error })
      result.errors++
    }
  }

  const toIndex = changes
    .filter((c) => c?.type !== "deleted")
    .filter((c) => hasValidExtension(c.path))
    .filter((c) => !shouldSkip("/" + path.relative(realProjectPath, c.path)))
    .map((c) => c.path)

  if (toIndex.length > 0) {
    try {
      const rawDb = await BrainDatabase.getRawInstance(projectId)
      rawDb.prepare(`DELETE FROM brain_query_cache WHERE project_id = ?`).run(projectId)
      // M40.A3: capture in-edges BEFORE parsing (storeResults deletes them),
      // then the incremental run inside applies the bounded post-pass — so
      // bb_edit / LSP / MCP file-mode leave derived data consistent, not just
      // re-parsed. Snapshot cost folds into this call (pre-parse window).
      const touchedFileIds = toIndex.map((f) => `${projectId}:${path.relative(realProjectPath, f)}`)
      const snapshot = await snapshotInEdges(projectId, touchedFileIds)
      const indexResult = await indexProjectParallel(projectId, realProjectPath, {
        files: toIndex,
        isIncremental: true,
        skipDiscovery: true,
        lock,
        ...(options?.logger ? { logger: options.logger } : {}),
      })
      result.indexed = indexResult.successFiles
      result.errors += indexResult.errorFiles
      // `skippedFiles` was being computed by the delegated run and thrown away.
      // It is the difference between "this file is not indexable" and "this file
      // is already current", and the report could not tell them apart.
      result.skipped += indexResult.skippedFiles ?? 0
      // The per-file failures the delegated run already collected. Bounded at 20
      // with the true total still in `errors`, so a caller learns which file to
      // look at without a pathological failure becoming a huge answer.
      for (const e of indexResult.errors ?? []) {
        if (result.errorDetail.length >= 20) break
        result.errorDetail.push({ file: String(e.file ?? "?"), error: String(e.error ?? "unknown") })
      }
      if ((indexResult.skippedFiles ?? 0) > 0 && result.indexed === 0) {
        result.skippedReason = `${indexResult.skippedFiles} of the requested file(s) hold nothing the indexer extracts (binary or unsupported type)`
      }
      // Bounded-pass telemetry (surfaced to tool callers; never silent).
      result.derived = {
        pass: indexResult.summary?.derivedPass ?? "deferred",
        phases: indexResult.phases?.postProcessingPhases ?? [],
        repairedInEdges: indexResult.m40Bounded?.repairedInEdges ?? 0,
        touchedSymbols: indexResult.m40Bounded?.touchedSymbols ?? 0,
      }
      // `deferred` means the heavy phases were not run for this call. It is
      // published in `derived.pass` and there is nothing to count, so the
      // `result.errors += 0` that used to stand here was a statement about
      // intent dressed as a statement about the count.
    } catch (error) {
      log.error("failed to reindex files", { error })
      result.errors++
    }
  }
  } finally {
    await lock.release().catch(() => {})
  }

  return result
}

// ============================================================================
// STATISTICS
// ============================================================================

export async function getIndexingStats(projectId: ProjectID) {
  const { eq, sql } = await import("drizzle-orm")
  const { BrainFileTable, BrainSymbolTable, BrainRelationshipTable } = await import("../brain/brain.sql")

  const db = await BrainDatabase.getInstance(projectId)

  const [fileCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(BrainFileTable)
    .where(eq(BrainFileTable.project_id, projectId))

  const [symbolCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(BrainSymbolTable)
    .where(eq(BrainSymbolTable.project_id, projectId))

  const [relationshipCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(BrainRelationshipTable)
    .where(eq(BrainRelationshipTable.project_id, projectId))

  return {
    files: Number(fileCount?.count || 0),
    symbols: Number(symbolCount?.count || 0),
    relationships: Number(relationshipCount?.count || 0),
  }
}
