// @ts-nocheck — ported; verified by tests. Restored incrementally in Phase 3.
// Parallel Indexer v4 - Batch Processing to Avoid Event Loop Blocking
// Scales gracefully and avoids 500ms setup overhead per file

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

import { cpus } from "os"
import * as path from "path"
import { fork, type ChildProcess } from "child_process"
import * as Log from "../tool/brain-log"
import type { ProjectID } from "../project/schema"
import { BrainDatabase } from "../brain/database"
import { isIndexArtifactName, isIndexArtifactNameStrict } from "./analysis-exclusions"
import { Bus } from "../bus"
import { BrainService } from "../brain/service"
import { readdir, stat } from "fs/promises"
import { computeAndStoreProjectHealth } from "./project-health"
import { CrossLanguageIntelligencePersister } from "./cross-language-intelligence-persister"
import { detectLanguageFromPath } from "./language-detection"
import { writeLiveStatus } from "./index-status"

const log = Log.create({ service: "parallel-indexer" })

// ============================================================================
// PILLAR 3: LAYER-AWARE PAGERANK
// ============================================================================

export async function calculateGravityScores(projectId: ProjectID) {
  const { BrainDatabase } = await import("../brain/database")
  const rawDb = await BrainDatabase.getRawInstance(projectId)

  // 1. Reset gravity scores to base complexity + visibility (fallback if needed)
  rawDb
    .prepare(
      `
     UPDATE brain_symbol
     SET gravity_score = (complexity * (CASE WHEN visibility = 'public' THEN 1.5 ELSE 1.0 END))
  `,
    )
    .run()

  // 2. PageRank increment (In-degree calculation)
  // Give highly-referenced symbols massive gravity boosts
  rawDb
    .prepare(
      `
     UPDATE brain_symbol
     SET gravity_score = gravity_score + (
        SELECT COUNT(*) * 5.0 
        FROM brain_relationship r 
        WHERE r.target_symbol_id = brain_symbol.id
     )
     WHERE EXISTS (
        SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id
     )
  `,
    )
    .run()

  // 3. Architectural Weighting (Layers)
  rawDb
    .prepare(
      `
     UPDATE brain_symbol
     SET gravity_score = gravity_score * 2.0
     WHERE layer = 'core'
  `,
    )
    .run()

  rawDb
    .prepare(
      `
     UPDATE brain_symbol
     SET gravity_score = gravity_score * 1.5
     WHERE layer = 'service' OR layer = 'db'
  `,
    )
    .run()

  // 4. Test intelligence weighting (Tests themselves are lower gravity, but tested code is higher)
  rawDb
    .prepare(
      `
     UPDATE brain_symbol
     SET gravity_score = gravity_score * 0.5
     WHERE layer = 'test'
  `,
    )
    .run()
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
    ".gsp",
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
    /\/vendor\//,
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
    /\/perf\//,
    /\/Microbenchmarks\//,
    /\/wwwroot\//,
    /\/testassets\//,
    /\/benchmarkapps\//,
    /\/test\//,
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
  /** M21.R3: true when the run ended because options.signal was aborted. */
  cancelled?: boolean
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
  name: "relationships" | "enrichment" | "gravity" | "taint" | "health" | "integrity"
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

export function hasValidExtension(filePath: string): boolean {
  return detectLanguageFromPath(filePath) !== null
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

async function discoverAndFilterFiles(
  projectId: ProjectID,
  projectPath: string,
  stats: ParallelIndexingStats,
  filesOverride?: string[],
  excludePatterns?: string[],
): Promise<string[]> {
  const files: string[] = []
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

  // Fetch existing stats for incremental checking
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  let existingRecords = []

  if (filesOverride && filesOverride.length > 0) {
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

      // Incremental check: skip unchanged files
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
    const walk = async (dir: string, ig: ReturnType<typeof ignore>, depth = 0) => {
      if (depth > 50) return
      try {
        const entries = await readdir(dir, { withFileTypes: true })

        // Stop if we find a .git folder in a subdirectory (nested project boundary)
        if (dir !== projectPath && entries.some((e) => e.isDirectory() && e.name === ".git")) {
          return
        }

        // Parse local .gitignore if exists
        let localIg = ig
        const gitignoreEntry = entries.find((e) => e.isFile() && e.name === ".gitignore")
        if (gitignoreEntry) {
          try {
            const gitignoreContent = await readFile(path.join(dir, ".gitignore"), "utf8")
            localIg = ignore().add(ig).add(gitignoreContent)
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

          // === COMPILED-MODE SAFE DIRECTORY FILTER (v2) ===
          // This runs BEFORE shouldSkip and localIg checks.
          // Uses simple string checks guaranteed to survive minification.
          if (
            relativePath.includes("/perf/") ||
            relativePath.includes("/Microbenchmarks/") ||
            relativePath.includes("/wwwroot/") ||
            relativePath.includes("/coverage/") ||
            relativePath.includes("/node_modules/") ||
            relativePath.includes("/dist/") ||
            relativePath.includes("/build/") ||
            relativePath.includes("/.git/") ||
            relativePath.includes("/obj/") ||
            relativePath.includes("/obj/") ||
            relativePath.includes("/bin/") ||
            relativePath.includes("/testData/")
          ) {
            continue
          }

          // Skip patterns are project-relative: a skip dir must be INSIDE the
          // project. Matching the absolute path would also skip any project
          // rooted under a skipped directory (e.g. ~/.vscode/tmp fixtures).
          if (shouldSkip("/" + relativePath)) continue

          if (localIg.ignores(relativePath + (entry.isDirectory() ? "/" : ""))) continue
          if (localIg.ignores(relativePath + (entry.isDirectory() ? "/" : ""))) continue

          if (entry.isDirectory()) {
            promises.push(walk(fullPath, localIg, depth + 1))
          } else if (entry.isFile() && hasValidExtension(fullPath)) {
            promises.push(processFile(fullPath))
          }
        }
        await Promise.all(promises)
      } catch {
        // Skip
      }
    }

    const rootIg = ignore()
    // User-controlled ignore list + performance/benchmark directories
    rootIg.add([
      "**/perf/**",
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
  // Only do this for a full run (when there are no filesOverride)
  if (!filesOverride || filesOverride.length === 0) {
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
      stats.cancelled = true
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
            ? parseFile(file, projectPath)
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

  log.debug("starting worker pool", { numWorkers, files: files.length, batchSize })

  // Streaming DB batch
  let pendingDbBatch: FileResult[] = []
  const dbPromises: Array<Promise<{ symbols: number; relationships: number; imports: number; failed?: boolean }>> = []

  const flushDbBatch = async (
    batchToStore: FileResult[],
  ): Promise<{ symbols: number; relationships: number; imports: number; failed?: boolean }> => {
    if (batchToStore.length === 0) return { symbols: 0, relationships: 0, imports: 0 }
    const flushStart = Date.now()
    try {
      const stats = await storeResults(projectId, projectPath, batchToStore, { skipResolution: true })
      if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
      return stats
    } catch (e: any) {
      if (telemetry) telemetry.dbFlushMs += Date.now() - flushStart
      log.error("storeResults failed", { error: e?.message, batchSize: batchToStore.length })
      return { symbols: -1, relationships: -1, imports: -1, failed: true }
    }
  }

  return new Promise((resolve) => {
    const results: FileResult[] = []

    let processed = 0

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
      }
    >()
    let batchCounter = 0
    // M21.R3: cooperative cancellation. Once aborted, stop dispatching new
    // batches; in-flight batches drain and the pool resolves normally so the
    // DB keeps only fully-stored files (the durable checkpoint).
    const aborted = () => signal?.aborted ?? false

    const workers = new Set<ChildProcess>()
    const idleWorkers: ChildProcess[] = []

    function handleWorkerTimeout(worker: ChildProcess, batchId: number) {
      try {
        const batch = pendingBatches.get(batchId)
        if (!batch) return

        clearTimeout(batch.timeout)
        pendingBatches.delete(batchId)

        log.warn("Worker timed out or crashed, killing process", { batchId, currentFile: batch.currentFile })

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
        onStartupFailure()
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

      worker.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(`[WORKER-ERR] ${data.toString()}`)
      })
      worker.stdout?.on("data", (data: Buffer) => {
        process.stderr.write(`[WORKER-OUT] ${data.toString()}`)
      })

      worker.on("message", (msg: any) => {
        try {
          if (msg.type === "ready") {
            clearStartupTimer(worker)
            idleWorkers.push(worker)
            scheduleNext()
          } else if (msg.type === "engine_fail") {
            process.stderr.write(`[brain] worker ${msg.workerId} engine load FAILED: ${msg.error}\n`)
            clearStartupTimer(worker)
            // Still add to idle — regex fallback can handle files without engine
            idleWorkers.push(worker)
            scheduleNext()
          } else if (msg.type === "file_start") {
            const batch = pendingBatches.get(msg.batchId)
            if (batch) {
              batch.currentFile = msg.filePath
              clearTimeout(batch.timeout)
              batch.timeout = setTimeout(() => handleWorkerTimeout(worker, msg.batchId), timeoutMs)
            }
          } else if (msg.type === "file_done") {
            const fileResult = { filePath: msg.filePath, ...msg.result }
            // DEBUG
            if (!msg.result || !msg.result.symbols) process.stderr.write(`[BB-NO-RESULT] ${msg.filePath}: result=${!!msg.result} symCount=${msg.symCount}\n`)
            results.push({ filePath: msg.filePath, success: true, timeout: false, error: undefined })
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
            idleWorkers.push(worker)
            scheduleNext()
          }
        } catch (err) {
          log.error("Error handling worker message", { error: err, msg })
        }
      })

      worker.on("exit", (code, signal) => {
        try {
          clearStartupTimer(worker)
          workers.delete(worker)
          const idx = idleWorkers.indexOf(worker)
          if (idx !== -1) idleWorkers.splice(idx, 1)

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

      worker.send({ type: "warmup", workerId })
    }

    function scheduleNext() {
      if (fileQueue.length === 0 && pendingBatches.size === 0) {
        workers.forEach((w) => w.kill())
        if (pendingDbBatch.length > 0) {
          dbPromises.push(flushDbBatch(pendingDbBatch))
          pendingDbBatch = []
        }
        Promise.all(dbPromises).then((storedStats) => {
          const finalStored: { symbols: number; relationships: number; imports: number; failed?: boolean } = {
            symbols: 0,
            relationships: 0,
            imports: 0,
          }
          for (const s of storedStats) {
            // FIX: Handle failed batches - don't add negative values
            if (s.failed) {
              log.error("a batch failed to store, some files may be missing from DB", {
                symbols: s.symbols,
                relationships: s.relationships,
              })
              continue
            }
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
        const batchFiles = fileQueue.splice(0, batchSize)
        const batchId = ++batchCounter

        pendingBatches.set(batchId, {
          files: batchFiles,
          worker,
          timeout: setTimeout(() => handleWorkerTimeout(worker, batchId), timeoutMs),
          attempts: 1,
        })

        worker.send({ type: "parse_batch", batchId, files: batchFiles, projectPath })
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

export const backgroundEmbedMetrics = {
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
        let insertEmbed = rawDb.prepare(`
          INSERT OR REPLACE INTO brain_semantic_embedding
          (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const maxBatch = 100
        for (let j = 0; j < job.items.length; j += maxBatch) {
          const chunk: any[] = job.items.slice(j, j + maxBatch)
          const docs = chunk.map((i: any) => i.snippet)

          const embeddings: any = await Instance.provide({
            directory: job.projectPath,
            fn: () => withTimeout(
              SemanticEngine.embedMany(docs),
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
            (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          let missingInChunk = 0
          const txEmbed = rawDb.transaction((rows: any) => {
            for (let k = 0; k < rows.length; k++) {
              const item = chunk[k]
              const vec = embeddings[k]
              // M21.E2: a missing vector inside a non-empty result is a
              // partial provider failure — accounted as `failed`, never
              // silently skipped. Counts are applied AFTER the transaction
              // commits so a rolled-back batch is never counted as embedded.
              if (!vec) { missingInChunk++; continue }
              const contentHash = createHash("sha256").update(item.snippet).digest("hex")
              insertEmbed.run(
                `${item.symbolId}:embed`,
                job.projectId,
                item.symbolId,
                item.kind || "symbol",
                modelLabel,
                JSON.stringify(vec),
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
            backgroundEmbedMetrics.embedded += chunk.length - missingInChunk
            backgroundEmbedMetrics.failed += missingInChunk
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

export async function storeResults(
  projectId: ProjectID,
  projectPath: string,
  results: FileResult[],
  options: { skipResolution?: boolean } = {},
): Promise<{ symbols: number; relationships: number; imports: number }> {
  let totalSymbols = 0
  let totalRelationships = 0
  let totalImports = 0

  const rawDb = await BrainDatabase.getRawInstance(projectId)
  // Disable FK checks during bulk store — compiled binary's SQLite can spuriously
  // reject valid data. Pool-worker denylist already validates all symbols/rels.
  rawDb.run("PRAGMA foreign_keys = OFF")
  const now = Date.now()

  const semanticBatch: any[] = []

  const insertFile = rawDb.prepare(`
    INSERT OR REPLACE INTO brain_file 
    (id, project_id, path, relative_path, file_hash, size_bytes, line_count, last_modified, language, framework_type, has_syntax_errors, error_report, is_test_file, layer, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertSymbol = rawDb.prepare(`
    INSERT OR REPLACE INTO brain_symbol
    (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, byte_start, byte_end, visibility, parameters, return_type, qualified_calls, complexity, api_contract_path, gravity_score, layer, owner_symbol_id, annotations, is_async, is_static, is_abstract, generic_parameters, docstring, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertImport = rawDb.prepare(`
    INSERT OR REPLACE INTO brain_import
    (id, project_id, file_id, imported_name, import_path, import_type, is_external, line_number, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const resolveTargetStmt = rawDb.prepare(
    `SELECT s.id, s.file_id, f.language FROM brain_symbol s
     LEFT JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.name = ? LIMIT 1`
  )


  for (let i: any = 0; i < results.length; i += batchSize) {
    const batch = results.slice(i, i + batchSize)
    let batchSymbols = 0, batchRelationships = 0, batchImports = 0

    const tx = rawDb.transaction((batch: any) => {
      for (const result of batch) {
        if (!result.success) continue

        let relativePath = path.relative(projectPath, result.filePath)
        const fileId = `${projectId}:${relativePath}`
        // Trace: only log significant files to avoid terminal I/O bottleneck
        const symCount = result.symbols?.length || 0
        const relCount = result.relationships?.length || 0
        if (relCount > 50 || symCount > 20) {
          process.stderr.write(`[STORE] ${relativePath.split('/').pop()}: ${symCount}s ${relCount}r\n`)
        }

        // Per-file SAVEPOINT — if this file's data causes an FK violation,
        // roll back only this file, not the entire batch.


        // Only delete file relationships if this is an INCREMENTAL run
        // We removed this because in a parallel batch insert it can cause racing bugs
        // If the same project file is processed concurrently, or we accidentally cascade.
        // Wait, fileId is unique per file... but just to be sure we comment it out temporarily.
        deleteFileRelationships.run(fileId)
        deleteFileRelationshipsByTarget.run(fileId)
        deleteFileTaints.run(fileId, fileId)
        deleteFileSymbols.run(fileId)
        deleteFileImports.run(fileId)

        relativePath = result.filePath.replace(projectPath, "").replace(/^\//, "")
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

        const isTestFile = 
          pathLower.includes("/test/") || pathLower.includes("/tests/") ||
          pathLower.includes("/__tests__/") || pathLower.includes("/spec/") ||
          pathLower.includes(".test.") || pathLower.includes(".spec.") ? 1 : 0

        // Count lines — use max symbol endLine as estimate, fallback to 0
        let lineCount = 0
        if (result.symbols && result.symbols.length > 0) {
          for (const s of result.symbols) {
            const end = s.endLine ?? s.range?.endLine ?? 0
            if (end > lineCount) lineCount = end
          }
        }

        insertFile.run(
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
          "unknown",
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
        let firstContainerSymbol: any = undefined

        if (result.symbols) {
          const insertedSymbolIds = new Set<string>()
          // Names that should NEVER become standalone symbols — language keywords,
          // scope objects, and root-level nodes that are always noise.
          // Sort symbols: container types first (class, interface, etc.) so FK
          // references from methods to their containers resolve successfully.
          const CONTAINER_PRIORITY: Record<string, number> = {
            class: 0, interface: 0, struct: 0, trait: 0, enum: 0, object: 0,
            module: 0, namespace: 0, package: 0, impl: 0, type: 0,
            method: 1, function: 1, constructor: 1, field: 2, property: 2,
            variable: 2,
          }
          result.symbols.sort((a: any, b: any) => {
            const pa = CONTAINER_PRIORITY[a.type || a.kind] ?? 3
            const pb = CONTAINER_PRIORITY[b.type || b.kind] ?? 3
            return pa - pb
          })

          // Pre-build fast lookup structures to eliminate per-symbol O(n) scans.
          // nameToSymbol: first symbol with each name (mirrors Array.find semantics).
          // containersByStart: container symbols sorted by startLine ascending for
          // line-containment lookups (replaces two full-array scans per symbol).
          const CONTAINER_TYPES_LOOKUP = new Set([
            "class", "interface", "struct", "trait", "enum", "object", "actor",
            "module", "namespace", "package", "impl", "type",
          ])
          for (const s of result.symbols) {
            const nm = s.name || ""
            if (nm && !nameToSymbol.has(nm)) nameToSymbol.set(nm, s)
            const k = s.type || s.kind || "unknown"
            if (CONTAINER_TYPES_LOOKUP.has(k)) {
              const cStart = s.startLine ?? s.range?.startLine ?? 0
              const cEnd = s.endLine ?? s.range?.endLine ?? cStart
              containersByStart.push({ name: nm, start: cStart, end: cEnd })
            }
          }
          containersByStart.sort((a, b) => a.start - b.start || b.end - a.end)
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
            let ownerSymbolId = null
            const _ownerName = symbol.ownerName || symbol.scope
            if (_ownerName) {
              ownerSymbolId = `${fileId}:${_ownerName}:0`
              const parentSymbol = nameToSymbol.get(_ownerName)
              if (parentSymbol) {
                const parentStartLine = parentSymbol.startLine ?? parentSymbol.range?.startLine ?? 0
                ownerSymbolId = `${fileId}:${parentSymbol.name}:${parentStartLine}`
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
                  if (c.start > 0 && (c.end >= symbolEndLine || c.end === c.start)) {
                    ownerSymbolId = `${fileId}:${c.name}:${c.start}`
                    break
                  }
                }
                // Tier 2: Nearest preceding container (regex fallback — single-line symbols)
                if (!ownerSymbolId) {
                  for (let ci = containersByStart.length - 1; ci >= 0; ci--) {
                    const c = containersByStart[ci]
                    if (c.start >= symbolStartLine) continue
                    if (c.name === symbol.name) continue
                    ownerSymbolId = `${fileId}:${c.name}:${c.start}`
                    break
                  }
                }
              }
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
            insertSymbol.run(
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
              now,
              now,
            )
            batchSymbols++
            insertedSymbolIds.add(symbolId)
            // Universal contains relationship — only if owner was actually inserted
            // regardless of whether the language analyzer produced one.
            // Guarantees owner→owned containment even when analyzers have
            // scope tracking bugs or when WASM fallback skips the analyzer.
            if (ownerSymbolId && insertedSymbolIds.has(ownerSymbolId)) {
              // Dedup: skip if the engine already generated a contains for this (owner, child) pair
              const ownerLeaf = ownerSymbolId.replace(/^.*:([^:]+):\d+$/, "$1")
              const alreadyHasContains = containsPairs.has(`${ownerLeaf} ${symbol.name}`)
              if (!alreadyHasContains) {
                const fileCount = (fileRelCounters.get(fileId) || 0) + 1
                fileRelCounters.set(fileId, fileCount)
                const containsId = `${projectId}:rel:${ownerSymbolId}:${symbol.name}:contains:${fileCount}`
                insertRelationship.run(
                  containsId,
                  projectId,
                  ownerSymbolId,
                  symbolId,
                  null,          // source_external
                  symbol.name,   // target_external
                  "contains",
                  1.0,
                  null,
                  0,
                  0,
                  0,
                  null,
                  null,
                  now,
                  now,
                )
                batchRelationships++
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

                    insertTaintSource.run(
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
                  insertTaintSource.run(
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

                  insertTaintSource.run(
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
                insertTaintSource.run(taintId, projectId, null, symbolId, "unresolved", "sql_query",
                  "sql_injection", "high", 0, JSON.stringify([symbolId]), 0, now, now)
              }
              if (/innerHTML|dangerouslySetInnerHTML|document\.write|eval\(/.test(callsPattern)) {
                const taintId = `taint_h:${projectId}:${symbolId}:xss:0`
                insertTaintSource.run(taintId, projectId, null, symbolId, "unresolved",
                  callsPattern.includes("innerHTML") ? "innerHTML" : "eval",
                  "xss", "high", 0, JSON.stringify([symbolId]), 0, now, now)
              }
              if (/exec\(|spawn\(|system\(|popen\(|subprocess/i.test(callsPattern)) {
                const taintId = `taint_h:${projectId}:${symbolId}:cmd_injection:0`
                insertTaintSource.run(taintId, projectId, null, symbolId, "unresolved", "command_exec",
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
            const importType =
              imp.importType ??
              (imp.isDefault || imp.isDefaultImport ? "default" : imp.isNamespace || imp.isNamespaceImport ? "namespace" : "named")
            const importId = `${fileId}:import:${moduleName}:${imp.range?.startLine ?? 0}`
            insertImport.run(
              importId,
              projectId,
              fileId,
              moduleName,
              imp.path || moduleName,
              importType,
              0,
              imp.range?.startLine ?? 0,
              now,
              now,
            )
            batchImports++
          }
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
              // Split by ":" and take last (handles "file:scope:name")
              const byColon = noLine.split(":")
              const lastColon = byColon[byColon.length - 1]
              // Split by "." and take last (handles "a.b.c")
              const byDot = lastColon.split(".")
              return byDot[byDot.length - 1]
            }
            const sourceLeaf = extractLeaf(sourceName)
            const targetLeaf = extractLeaf(targetName)

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
            if (sourceSymbol) {
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
              }
              sourceId = null
              sourceExternal = sourceName
            }

            // RESOLVE target_symbol_id at insert time — avoid expensive global UPDATE later
            const resolvedRow = resolveTargetStmt.get(projectId, targetLeaf) as any
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

            if (
              leafForCheck.length > MAX_SYMBOL_NAME_LENGTH ||
              GENERIC_SOURCE_NAMES.has(leafForCheck) ||
              isBlockScopeName
            ) {
              continue
            }

            // Deterministic relId — same (source, target, type) shares one row.
            // INSERT OR IGNORE silently skips duplicates; no more 7× dupes.
            const relId = `${projectId}:rel:${sourceId}:${targetName}:${relType}`

            insertRelationship.run(
              relId,
              projectId,
              sourceId,
              targetId,
              sourceExternal,  // source_external — non-null when source not found in file
              targetName,       // target_external
              relType,
              rel.confidence || 1.0,
              rel.context || null,
              0,
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
    try {
      tx(batch)
      totalSymbols += batchSymbols
      totalRelationships += batchRelationships
      totalImports += batchImports
    } catch (error) {
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

        // Strategy 3: Qualified name partial match for dotted names
        rawDb.run(`
          UPDATE brain_relationship
          SET target_symbol_id = (
              SELECT sym.id FROM brain_symbol sym
              WHERE sym.name = SUBSTR(brain_relationship.target_external, INSTR(brain_relationship.target_external, '.') + 1)
                AND sym.project_id = '${projectId}'
              LIMIT 1
          )
          WHERE brain_relationship.target_symbol_id IS NULL
            AND brain_relationship.target_external IS NOT NULL
            AND brain_relationship.project_id = '${projectId}'
            AND INSTR(brain_relationship.target_external, '.') > 0
        `)

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

  rawDb.run("PRAGMA foreign_keys = ON")
  return { symbols: totalSymbols, relationships: totalRelationships, imports: totalImports }
}

// ============================================================================
// RELATIONSHIP RESOLUTION (run once at the end of indexing)
// ============================================================================

async function resolveRelationships(projectId: ProjectID): Promise<void> {
  const { BrainDatabase } = await import("../brain/database")
  const rawDb = await BrainDatabase.getRawInstance(projectId)

  log.debug("starting final relationship resolution")

  const unresolved = (rawDb.prepare(
    `SELECT count(*) as c FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL AND project_id = ?`
  ).get(projectId) as any)?.c || 0

  if (unresolved === 0) {
    log.debug("no unresolved relationships to resolve")
    return
  }

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

    const resolved = (r1?.changes || 0) + (r2?.changes || 0)
    log.debug("relationship resolution completed", { resolved, unresolved })

    // Cleanup
    rawDb.run(`DROP TABLE IF EXISTS _res_qname`)
    rawDb.run(`DROP TABLE IF EXISTS _res_name`)
  } catch (err) {
    log.warn("relationship resolution failed", { error: err })
  }
}

// ============================================================================
// CROSS-SYMBOL TAINT RESOLUTION (called from worker)
// ============================================================================

export async function resolveCrossSymbolTaints(projectId: ProjectID): Promise<number> {
  log.debug("starting cross-symbol taint resolution", { projectId })
  const { BrainDatabase } = await import("../brain/database")
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const now = Date.now()

  const query = `
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

export async function indexProjectParallel(
  projectId: ProjectID,
  projectPath: string,
  options: {
    onProgress?: (stats: ParallelIndexingStats) => void
    files?: string[]
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
    noop: false,
  }

  try {
    const discoveryStart = Date.now()
    const files = options.skipDiscovery && options.files
      ? options.files.filter(f => !shouldSkipCli(f) && hasValidExtension(f))
      : await discoverAndFilterFiles(projectId, projectPath, stats, options.files, options.excludePatterns)
    phases.discoveryMs = Date.now() - discoveryStart

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
      const { workerPath: testWorkerPath, workerArgs: testWorkerArgs } = resolvePoolWorkerFork()
      const testWorker = fork(testWorkerPath, testWorkerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          testWorker.kill()
          reject(new Error("worker fork test timed out after 60s"))
        }, 60000)
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
      _log.log(`[brain] ⚠ worker pool unavailable (${e?.message}), falling back to in-process indexing`)
      log.warn("worker pool fork unavailable, falling back to in-process", { error: e?.message })
      processFn = processInProcess
    }
    phases.workerStartupMs = Date.now() - workerStartupStart
    phases.mode = processFn === processInProcess ? "in-process" : "worker-pool"

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
    const byLanguage: Record<string, { files: number; success: number; error: number; timeout: number; fallback: number; cancelled: number }> = {}
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
        const reprocessed = await processWithWorkerPool(projectId, projectPath, missed, () => {},
                                                        signal)
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
      status: stats.errorFiles > 0 ? "partial" : "complete",
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
      // M21.I2: every phase records its own start/end timing and outcome so a
      // failed phase stays visible and never silently reports "complete".
      const postPhases: PostProcessingPhaseTiming[] = []
      const recordPhase = (name: PostProcessingPhaseTiming["name"], ms: number, outcome: PostProcessingPhaseTiming["outcome"]) => {
        postPhases.push({ name, ms, outcome })
      }
      try {
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
        _log.log("  Resolving cross-file relationships...")
        let _t = Date.now()
        try {
          await resolveRelationships(projectId)
          recordPhase("relationships", Date.now() - _t, "ok")
          _log.log(`  ✓ resolved in ${Date.now()-_t}ms`)
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
            _log.write(`\r  Enriching: ${step} ${pct}%\x1b[K`)
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
      } catch (err) {
        log.warn("failed to compute project health or resolve taints", { error: err })
      }
      phases.postProcessingMs = Date.now() - postProcessingStart
      phases.postProcessingPhases = postPhases

      // M21.I2: a failed post-processing phase must not silently leave the
      // project status as "complete". Persist a visible partial status.
      if (postPhases.some((p) => p.outcome === "failed")) {
        try {
          await BrainDatabase.updateIndexStatus(projectId, { status: "partial" })
          _log.log("  ⚠ index marked partial: a post-processing phase failed")
        } catch (statusErr) {
          log.warn("failed to persist partial post-processing status", { error: statusErr })
        }
      }
      phases.totalWallMs = Date.now() - stats.startTime
    } else {
      phases.totalWallMs = Date.now() - stats.startTime
      log.debug(options.skipPostProcessing
        ? "skipping heavy post-processing because the caller requested deferred finalization"
        : "skipping heavy cross-symbol taints and health metrics for incremental run")
    }

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
export function wipeProjectData(rawDb: any): void {
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
  for (const t of tables) {
    try {
      rawDb.run(`DELETE FROM ${t}`)
    } catch {}
  }
  // temp resolution tables (per-connection; safe to clear if present)
  for (const t of ["_res_qname", "_res_name", "_res_name_unique"]) {
    try {
      rawDb.run(`DELETE FROM ${t}`)
    } catch {}
  }
}

export async function reindexFilesParallel(
  projectId: ProjectID,
  projectPath: string,
  changes: FileChange[],
): Promise<{ indexed: number; deleted: number; errors: number }> {
  const result = { indexed: 0, deleted: 0, errors: 0 }

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
          const relativePath = path.relative(projectPath, change.path)
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
    .filter((c) => !shouldSkip("/" + path.relative(projectPath, c.path)))
    .map((c) => c.path)

  if (toIndex.length > 0) {
    try {
      const rawDb = await BrainDatabase.getRawInstance(projectId)
      rawDb.prepare(`DELETE FROM brain_query_cache WHERE project_id = ?`).run(projectId)
      const indexResult = await indexProjectParallel(projectId, projectPath, {
        files: toIndex,
        isIncremental: true,
      })
      result.indexed = indexResult.successFiles
      result.errors += indexResult.errorFiles
    } catch (error) {
      log.error("failed to reindex files", { error })
      result.errors++
    }
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
