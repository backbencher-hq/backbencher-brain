// @ts-nocheck — ported; verified by tests. Restored incrementally in Phase 3.
import { SemanticEngine } from "../brain/semantic/engine"
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
import { isIndexArtifactName } from "./analysis-exclusions"
import { Bus } from "../bus"
import { BrainService } from "../brain/service"
import { readdir, stat } from "fs/promises"
import { computeAndStoreProjectHealth } from "./project-health"
import { CrossLanguageIntelligencePersister } from "./cross-language-intelligence-persister"

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

  // Hard timeout per file in ms - worker gets KILLED if exceeded
  fileTimeoutMs: 45000, // 45s — fast enough to skip hung files, long enough for large AST parsing

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
    /\/\.vscode\//,
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

function shouldSkipCli(filePath: string): boolean {
  return cliSkipPatterns.some((p) => p.test(filePath))
}

function hasValidExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (filePath.endsWith("source")) return true
  return ParallelIndexerConfig.extensions.has(ext)
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
  const structuralExtensions = new Set([".json", ".yaml", ".yml", ".toml", ".xml", ".md", ".proto"])

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
          // Skip hidden directories (but allow dot-prefixed files like .eslintrc.json)
          if (entry.name.startsWith(".")) {
            if (entry.isDirectory()) continue
          }
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

          if (shouldSkip(fullPath)) continue

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
): Promise<FileResult[]> {
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
      try {
        await storeResults(projectId as any, projectPath, batch, { skipResolution: true })
        log.info(`stored ${batch.length} file results in DB`)
      } catch (e: any) {
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
    try {
      await storeResults(projectId as any, projectPath, results, { skipResolution: false })
      log.info(`stored final ${results.length} file results in DB`)
    } catch (e: any) {
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
): Promise<FileResult[]> {
  const concurrency = ParallelIndexerConfig.concurrency
  const batchSize = ParallelIndexerConfig.workerBatchSize
  const numWorkers = Math.min(concurrency, Math.ceil(files.length / batchSize) || 1)
  const timeoutMs = ParallelIndexerConfig.fileTimeoutMs

  log.debug("starting worker pool", { numWorkers, files: files.length, batchSize })

  // Streaming DB batch
  let pendingDbBatch: FileResult[] = []
  const dbPromises: Array<Promise<{ symbols: number; relationships: number; imports: number; failed?: boolean }>> = []

  const flushDbBatch = async (
    batchToStore: FileResult[],
  ): Promise<{ symbols: number; relationships: number; imports: number; failed?: boolean }> => {
    if (batchToStore.length === 0) return { symbols: 0, relationships: 0, imports: 0 }
    try {
      const stats = await storeResults(projectId, projectPath, batchToStore, { skipResolution: true })
      return stats
    } catch (e: any) {
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
                fileQueue.unshift(f)
              }
            }
          }
        } else {
          // Worker died BEFORE reporting file_start. This is a Poison Pill batch.
          log.warn("Worker crashed before file_start. Dropping suspected poison pill.", { droppedFile: batch.files[0] })
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

    function createWorker(workerId: number) {
      // Worker pool: fork a child process that enters pool-worker IPC mode.
      const { workerPath, workerArgs } = resolvePoolWorkerFork()
      if (!workerPath) {
        log.error("worker pool unavailable — no tsx binary found (dev mode)")
        return
      }

      const worker = fork(workerPath, workerArgs, {
        env: { ...process.env, BB_POOL_WORKER: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      })
      workers.add(worker)

      worker.stderr?.on("data", (data: Buffer) => {
        process.stderr.write(`[WORKER-ERR] ${data.toString()}`)
      })
      worker.stdout?.on("data", (data: Buffer) => {
        process.stderr.write(`[WORKER-OUT] ${data.toString()}`)
      })

      worker.on("message", (msg: any) => {
        try {
          if (msg.type === "ready") {
            idleWorkers.push(worker)
            scheduleNext()
          } else if (msg.type === "engine_fail") {
            process.stderr.write(`[brain] worker ${msg.workerId} engine load FAILED: ${msg.error}\n`)
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
            // Spawn replacement immediately — do NOT use setTimeout.
            // If the event loop is blocked by a DB transaction (flushDbBatch),
            // the timer never fires and the pool permanently stalls.
            createWorker(Date.now())
            scheduleNext()
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
  // @backbencher: embedding_model from SemanticEngine directly (Config.get() is Effect-only)
  let embeddingModel = await SemanticEngine.getEmbeddingModel()

  const insertFile = rawDb.prepare(`
    INSERT OR REPLACE INTO brain_file 
    (id, project_id, path, relative_path, file_hash, size_bytes, line_count, last_modified, language, framework_type, has_syntax_errors, error_report, is_test_file, layer, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertSymbol = rawDb.prepare(`
    INSERT OR REPLACE INTO brain_symbol
    (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, byte_start, byte_end, visibility, parameters, return_type, qualified_calls, complexity, api_contract_path, gravity_score, layer, owner_symbol_id, annotations, is_async, is_static, is_abstract, generic_parameters, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  // Pre-prepare target resolution statement — reused for every relationship
  const resolveTargetStmt = rawDb.prepare(
    `SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1`
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

        if (result.symbols) {
          const insertedSymbolIds = new Set<string>()
          // Names that should NEVER become standalone symbols — language keywords,
          // scope objects, and root-level nodes that are always noise.
          const SYMBOL_NAME_DENYLIST = new Set([
            // Language keywords (cross-language)
            "this", "super", "self", "Self", "me", "My",
            "true", "false", "null", "nil", "None", "True", "False",
            "undefined", "NaN", "Infinity",
            // Scope/introspection objects
            "global", "Global", "window", "Window", "document",
            "module", "exports", "default", "globalThis",
            // Root-level file artifacts (tree-sitter program/module nodes)
            "root", "program", "source_file", "module_declaration",
            "package_manifest", "GlobalScope", "SCSS_FILE_SCOPE",
            // Unknown classifier default
            "unknown",
          ])
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
              const parentSymbol = result.symbols.find((s: any) => s.name === _ownerName)
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
                const CONTAINER_TYPES = new Set([
                  "class", "interface", "struct", "trait", "enum", "object", "actor",
                  "module", "namespace", "package", "impl", "type",
                ])
                // Tier 1: Exact line-range containment (tree-sitter parsed results)
                for (const candidate of result.symbols) {
                  const cKind = candidate.type || candidate.kind || "unknown"
                  if (!CONTAINER_TYPES.has(cKind)) continue
                  const cName = candidate.name || ""
                  if (cName === symbol.name) continue
                  const cStart = candidate.startLine ?? candidate.range?.startLine ?? 0
                  const cEnd = candidate.endLine ?? candidate.range?.endLine ?? cStart
                  if (cStart < symbolStartLine && (cEnd >= symbolEndLine || cEnd === cStart) && cStart > 0) {
                    ownerSymbolId = `${fileId}:${cName}:${cStart}`
                    break
                  }
                }
                // Tier 2: Nearest preceding container (regex fallback — single-line symbols)
                if (!ownerSymbolId) {
                  let bestCandidate: any = null
                  let bestLine = 0
                  for (const candidate of result.symbols) {
                    const cKind = candidate.type || candidate.kind || "unknown"
                    if (!CONTAINER_TYPES.has(cKind)) continue
                    const cName = candidate.name || ""
                    if (cName === symbol.name) continue
                    const cStart = candidate.startLine ?? candidate.range?.startLine ?? 0
                    if (cStart < symbolStartLine && cStart > bestLine) {
                      bestLine = cStart
                      bestCandidate = candidate
                    }
                  }
                  if (bestCandidate) {
                    ownerSymbolId = `${fileId}:${bestCandidate.name}:${bestLine}`
                  }
                }
              }
            }

            if (symbolStartLine < 1 || isIndexArtifactName(symbol.name)) continue
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
              const alreadyHasContains = result.relationships?.some((r: any) => {
                if ((r.type || r.relationshipType || "") !== "contains") return false
                const rSrc = r.source || r.sourceId || r.fromSymbol || r.from || ""
                const rTgt = r.target || r.targetId || r.toSymbol || r.to || ""
                const srcLeaf = rSrc.replace(/^.*:([^:]+):?\d*$/, "$1")
                const tgtLeaf = rTgt.replace(/^.*:([^:]+):?\d*$/, "$1")
                return (srcLeaf === ownerLeaf && tgtLeaf === symbol.name) ||
                       (tgtLeaf === ownerLeaf && srcLeaf === symbol.name)
              })
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
            const importId = `${fileId}:import:${imp.name}:${imp.line || 0}`
            insertImport.run(
              importId,
              projectId,
              fileId,
              imp.name,
              imp.path || "",
              imp.type || "named",
              imp.isExternal ? 1 : 0,
              imp.line || 0,
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

            // Find source symbol: try exact match, ends-with, leaf match, qualified name
            const sourceSymbol = result.symbols?.find((s: any) => {
              if (!sourceName || sourceName === "unknown") return false
              if (s.name === sourceName) return true
              if (s.name === sourceLeaf) return true
              if (sourceName.endsWith(`:${s.name}`)) return true
              if (sourceName.endsWith(`.${s.name}`)) return true
              if (s.qualifiedName && sourceName === s.qualifiedName) return true
              if (s.qualifiedName && sourceName.endsWith(`:${s.qualifiedName}`)) return true
              if (s.qualifiedName && s.qualifiedName.endsWith(`.${sourceLeaf}`)) return true
              return false
            })

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
              const enclosingSymbol = result.symbols?.find((s: any) => {
                const kind = s.type || s.kind || "unknown"
                return ["class", "interface", "struct", "trait", "enum", "object", "actor", "impl"].includes(kind)
              })
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
              1,
              rel.metadata?.isCrossLanguage ? 1 : 0,
              rel.metadata?.bridgeMechanism || null,
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

  // Generate and store semantic embeddings for symbols (skip for large batches)
  // @backbencher: skip embedding when called with skipResolution (compiled binary)
  // BUG 7 FIX: Use TF-IDF fallback when ML model is skipped or batch is too large
  if (semanticBatch.length > 0) {
    // Embeddings are independent of skipResolution (which only gates
    // relationship resolution): real API or local vectors for small projects,
    // tfidf-v1 for huge ones.
    let useMLModel = semanticBatch.length < 5000
    try {
      if (useMLModel) {
        const { SemanticEngine } = await import("../brain/semantic/engine")
        const maxBatch = 100

        const insertEmbed = rawDb.prepare(`
          INSERT OR REPLACE INTO brain_semantic_embedding
          (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const { Instance } = await import("../project/instance")
        const { createHash } = await import("crypto")
        for (let j = 0; j < semanticBatch.length; j += maxBatch) {
          const chunk: any[] = semanticBatch.slice(j, j + maxBatch)
          const docs = chunk.map((i: any) => i.snippet)

          const embeddings: any = await Instance.provide({
            directory: projectPath,
            fn: () => SemanticEngine.embedMany(docs),
          })
          if (!embeddings) continue

          const txEmbed = rawDb.transaction((rows: any) => {
            for (let k = 0; k < rows.length; k++) {
              const item = chunk[k]
              const vec = embeddings[k]
              if (!vec) continue
              const contentHash = createHash("sha256").update(item.snippet).digest("hex")
              const embedId = `${item.symbolId}:embed`
              insertEmbed.run(
                embedId,
                projectId,
                item.symbolId,
                item.kind || "symbol",
                embeddingModel,
                JSON.stringify(vec),
                vec.length,
                contentHash,
                JSON.stringify({ name: item.name, kind: item.kind }),
                0.7,
                now,
                now,
                now,
              )
            }
          })
          txEmbed(chunk)
        }
      } else {
        // TF-IDF fallback: lightweight token-weight vectors stored as JSON
        // Works for any project size, no external ML dependency
        const tfidfInsert = rawDb.prepare(`
          INSERT OR REPLACE INTO brain_semantic_embedding
          (id, project_id, entity_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, semantic_context, similarity_threshold, last_updated, time_created, time_updated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const { createHash } = await import("crypto")

        for (const item of semanticBatch) {
          const tokens = tokenizeCodeForEmbedding(item.snippet, item.name)
          if (tokens.length === 0) continue
          const contentHash = createHash("sha256").update(item.snippet).digest("hex")
          const embedId = `${item.symbolId}:tfidf`
          tfidfInsert.run(
            embedId, projectId, item.symbolId, item.kind || "symbol",
            "tfidf-v1",
            JSON.stringify(tokens),
            tokens.length,
            contentHash,
            JSON.stringify({ name: item.name, kind: item.kind }),
            0.15,
            now, now, now,
          )
        }
      }
    } catch (e: any) {
      log.warn("semantic embedding generation failed", { error: e?.message })
    }
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
        rawDb.run(`INSERT OR IGNORE INTO _res_qname (qualified_name, symbol_id, file_id) SELECT qualified_name, id, file_id FROM brain_symbol WHERE project_id = '${projectId}' AND qualified_name IS NOT NULL`)
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
       SELECT qualified_name, id, file_id FROM brain_symbol
       WHERE project_id = ? AND qualified_name IS NOT NULL`
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
        updateFlow.run(flow.target_symbol_id, flow.path, flow.flow_source_id)
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
    skipDiscovery?: boolean // @backbencher: skip discoverAndFilterFiles entirely
  } = {},
): Promise<ParallelIndexingStats> {
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


  try {
    const files = options.skipDiscovery && options.files
      ? options.files.filter(f => !shouldSkipCli(f) && hasValidExtension(f))
      : await discoverAndFilterFiles(projectId, projectPath, stats, options.files, options.excludePatterns)

    // const files = await discoverAndFilterFiles(projectId, projectPath, stats, options.files)
    stats.totalFiles = files.length + stats.skippedFiles

    if (files.length === 0) {
      log.warn("no files to index (all skipped or none found)")

      // Get global stats so they aren't 0
      const dbStats = await getIndexingStats(projectId)
      stats.symbolsExtracted = dbStats.symbols
      stats.relationshipsFound = dbStats.relationships
      stats.endTime = Date.now()
      stats.processedFiles = stats.skippedFiles

      await BrainDatabase.updateIndexStatus(projectId, {
        lastIndexed: Date.now(),
        filesIndexed: stats.totalFiles,
        symbolsIndexed: stats.symbolsExtracted,
        status: "complete",
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
      console.log("[brain] ✓ worker pool available — using parallel indexing with 45s timeouts")
      log.info("worker pool fork test passed — using parallel workers")
    } catch (e: any) {
      console.log(`[brain] ⚠ worker pool unavailable (${e?.message}), falling back to in-process indexing`)
      log.warn("worker pool fork unavailable, falling back to in-process", { error: e?.message })
      processFn = processInProcess
    }

    const results = await processFn(projectId, projectPath, files, (processed, total, file) => {
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
          options.onProgress({ ...stats })
        }
      }
    })

    // Aggregate results
    for (const result of results) {
      if (result.success) {
        stats.successFiles++
      } else if (result.timeout) {
        stats.timeoutFiles++
        stats.errors.push({ file: result.filePath, error: "Timeout" })
      } else {
        stats.errorFiles++
        stats.errors.push({ file: result.filePath, error: result.error || "Unknown error" })
      }
    }

    // Post-processing fallback: re-process files that may have been lost
    // during worker pool batch rollbacks. StoreResults uses INSERT OR REPLACE
    // so re-processing already-stored files is safe (idempotent).
    try {
      const rawDb = await BrainDatabase.getRawInstance(projectId)
      const stored = new Set(
        (rawDb.prepare(`SELECT path FROM brain_file WHERE project_id = ?`).all(projectId) as any[])
          .map((r: any) => r.path)
      )
      const missed = files.filter(f => !stored.has(f) && !shouldSkipCli(f))
      if (missed.length > 0) {
        process.stderr.write(`[brain] ⚠ ${missed.length} files missed, re-processing...\n`)
        const { parseFile } = await import("./pool-worker")
        for (const file of missed) {
          try {
            const result = await parseFile(file as any, projectPath) as any
            if (result?.success) {
              await storeResults(projectId, projectPath, [{ filePath: file, success: true, ...result }], { skipResolution: true })
              process.stderr.write(`  ✓ ${file.split('/').pop()}\n`)
            }
          } catch (e: any) { process.stderr.write(`  ✗ ${file.split('/').pop()}\n`) }
        }
      }
    } catch (e: any) {
      process.stderr.write(`[brain] fallback error: ${e?.message}\n`)
    }

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
    const duration = (stats.endTime - stats.startTime) / 1000
    stats.filesPerSecond = stats.processedFiles / duration

    log.debug("parallel indexing completed", {
      ...stats,
      duration: `${duration.toFixed(1)}s`,
      filesPerSecond: stats.filesPerSecond.toFixed(1),
    })

    await BrainDatabase.updateIndexStatus(projectId, {
      lastIndexed: Date.now(),
      filesIndexed: stats.successFiles + stats.skippedFiles,
      symbolsIndexed: stats.symbolsExtracted,
      status: stats.errorFiles > 0 ? "partial" : "complete",
    })

    if (!options.isIncremental) {
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
        console.log("  Resolving cross-file relationships...")
        let _t = Date.now()
        await resolveRelationships(projectId)
        console.log(`  ✓ resolved in ${Date.now()-_t}ms`)

        // Enrich relationships with architectural reasoning (Phase 1+2)
        try {
          const { enrichRelationships } = await import("../brain/brain-relationship-enrichment")
          console.log("  Enriching relationships with architectural context...")
          _t = Date.now()
          const enrichResult = await enrichRelationships(projectId, (step: string, pct: number) => {
            process.stdout.write(`\r  Enriching: ${step} ${pct}%\x1b[K`)
          })
          console.log(`  ✅ Enriched ${enrichResult.enriched.toLocaleString()} relationships (${enrichResult.patternsFound.toLocaleString()} patterns) in ${Date.now()-_t}ms`)
        } catch (enrichErr) {
          log.warn("relationship enrichment failed", { error: enrichErr })
        }

        console.log("  Computing gravity scores...")
        _t = Date.now()
        await calculateGravityScores(projectId)
        console.log(`  ✓ gravity in ${Date.now()-_t}ms`)

        console.log("  Analyzing taint flows & security...")
        _t = Date.now()
        try {
          const taints = await resolveCrossSymbolTaints(projectId)
          const _t2 = Date.now()
          await (await import("./project-health")).computeAndStoreProjectHealth(projectId)
          console.log(`  ✓ taint(${Date.now()-_t2}ms) + health(${_t2-_t}ms) in ${Date.now()-_t}ms`)
        } catch (postErr: any) {
          log.warn("post-indexing taint/health failed", { error: postErr?.message })
          console.log(`  ⚠ taint/health failed in ${Date.now()-_t}ms`)
        }

        // Lightweight post-index integrity validation (4 fast checks)
        try {
          _t = Date.now()
          const { runIndexHealthCheck } = await import("../brain/brain-index-health")
          const health = await runIndexHealthCheck(projectId)
          console.log(`  ✓ health check in ${Date.now()-_t}ms`)
          const warnCount = health.checks.filter((c) => c.status !== "ok").length
          if (warnCount > 0) {
            console.log(`  ⚠️  Index health: ${health.overallHealth}% — ${warnCount} warnings (run bb_health(integrity=true) for details)`)
            for (const c of health.checks.filter((c) => c.status === "error")) {
              console.log(`    ❌ ${c.name}: ${c.description}`)
            }
          } else {
            console.log(`  ✅ Index health: 100% — all checks passed`)
          }
        } catch (healthErr) {
          log.warn("post-index health check failed", { error: healthErr })
        }
      } catch (err) {
        log.warn("failed to compute project health or resolve taints", { error: err })
      }
    } else {
      log.debug("skipping heavy cross-symbol taints and health metrics for incremental run")
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

    return stats
  } catch (error) {
    stats.endTime = Date.now()
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
    .filter((c) => !shouldSkip(c.path))
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
