// Parallel Indexer — Master orchestrator for project indexing
// Ported from backbencher's parallel-indexer.ts indexProjectParallel()
// Ties together: file discovery → worker pool → batch storage → post-processing

import { cpus } from "os"
import { fork, type ChildProcess } from "child_process"
import { basename, join, dirname } from "path"
import { fileURLToPath } from "url"
import type Database from "better-sqlite3"
import { createLogger, setVerbose } from "../util/log.js"
import { discoverFiles } from "./discover.js"
import { storeResults, type FileResult, type StoreStats } from "./store.js"

const log = createLogger("indexer")

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONCURRENCY = Math.max(2, Math.min(cpus().length - 1, 12))
const FILE_TIMEOUT_MS = 45000
const WORKER_BATCH_SIZE = 10
const DB_BATCH_SIZE = 100
const PROGRESS_MS = 100
const MAX_HEAP_MB = 4096 // 4GB warning threshold
const MEMORY_CHECK_INTERVAL = 50 // Check memory every N brain_file

// ============================================================================
// TYPES
// ============================================================================

export interface IndexingStats {
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
  errors: Array<{ file: string; error: string; retryable?: boolean }>
}

export interface IndexingOptions {
  onProgress?: (stats: IndexingStats) => void
  files?: string[]
  excludePatterns?: string[]
  isIncremental?: boolean
  verbose?: boolean
}

// ============================================================================
// PROGRESS REPORTER
// ============================================================================

class ProgressReporter {
  private lastEmit = 0
  private symbolCount = 0
  private relCount = 0
  private langStats = new Map<string, number>()

  constructor(private onProgress?: (stats: IndexingStats) => void) {}

  emit(stats: IndexingStats, currentFile: string, force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmit < PROGRESS_MS) return
    this.lastEmit = now

    const elapsed = (now - stats.startTime) / 1000
    const fps = elapsed > 0 ? stats.processedFiles / elapsed : 0
    const eta = fps > 0 ? Math.round((stats.totalFiles - stats.processedFiles) / fps) : 0

    stats.filesPerSecond = fps

    if (this.onProgress) {
      this.onProgress(stats)
    }

    log.info(`indexing: ${stats.processedFiles}/${stats.totalFiles} (${fps.toFixed(0)}/s, ETA ${eta}s) — ${basename(currentFile)}`)
  }

  checkMemory(processed: number) {
    if (processed % MEMORY_CHECK_INTERVAL !== 0) return
    const usage = process.memoryUsage()
    const heapMB = Math.round(usage.heapUsed / 1024 / 1024)

    if (heapMB > MAX_HEAP_MB) {
      log.warn("high memory usage", { heapMB, limitMB: MAX_HEAP_MB })
      if (global.gc) { global.gc(); log.debug("forced GC") }
    }
  }
}

export interface IndexingOptions {
  onProgress?: (stats: IndexingStats) => void
  files?: string[]
  excludePatterns?: string[]
  isIncremental?: boolean
  verbose?: boolean
}

// ============================================================================
// POST-PROCESSING
// ============================================================================

function resolveRelationships(db: Database.Database, projectHash: string): void {
  log.debug("resolving cross-file brain_relationship")

  // Strategy 1: Full symbol ID match
  db.prepare(`
    UPDATE brain_relationship SET target_symbol_id = (SELECT id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.target_external AND brain_symbol.project_hash = brain_relationship.project_hash LIMIT 1)
    WHERE project_hash = ? AND target_symbol_id IS NULL AND target_external IS NOT NULL
  `).run(projectHash)

  // Strategy 2: Qualified name match
  db.prepare(`
    UPDATE brain_relationship SET target_symbol_id = (SELECT id FROM brain_symbol WHERE qualified_name = brain_relationship.target_external AND project_hash = brain_relationship.project_hash LIMIT 1)
    WHERE project_hash = ? AND target_symbol_id IS NULL AND target_external IS NOT NULL
  `).run(projectHash)

  // Strategy 3: Name-only match (if unique)
  db.prepare(`
    UPDATE brain_relationship SET target_symbol_id = (SELECT id FROM brain_symbol WHERE name = brain_relationship.target_external AND project_hash = brain_relationship.project_hash LIMIT 1)
    WHERE project_hash = ? AND target_symbol_id IS NULL AND target_external IS NOT NULL
      AND (SELECT COUNT(*) FROM brain_symbol WHERE name = brain_relationship.target_external AND project_hash = brain_relationship.project_hash) = 1
  `).run(projectHash)

  // Mark cross-file brain_relationship
  db.prepare(`
    UPDATE brain_relationship SET is_cross_file = 1
    WHERE project_hash = ? AND target_symbol_id IS NOT NULL
      AND source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id != (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.target_symbol_id))
  `).run(projectHash)
}

function calculateGravityScores(db: Database.Database, projectHash: string): void {
  // Base: complexity × visibility
  db.prepare(`
    UPDATE brain_symbol SET gravity_score = (complexity * (CASE WHEN visibility = 'public' THEN 1.5 ELSE 1.0 END))
    WHERE project_hash = ?
  `).run(projectHash)

  // PageRank: in-degree boost
  db.prepare(`
    UPDATE brain_symbol SET gravity_score = gravity_score + (
      SELECT COUNT(*) * 5.0 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id
    )
    WHERE project_hash = ? AND EXISTS (SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id)
  `).run(projectHash)

  // Layer weighting
  db.prepare(`UPDATE brain_symbol SET gravity_score = gravity_score * 2.0 WHERE project_hash = ? AND layer = 'core'`).run(projectHash)
  db.prepare(`UPDATE brain_symbol SET gravity_score = gravity_score * 1.5 WHERE project_hash = ? AND (layer = 'service' OR layer = 'db')`).run(projectHash)
  db.prepare(`UPDATE brain_symbol SET gravity_score = gravity_score * 0.5 WHERE project_hash = ? AND layer = 'test'`).run(projectHash)
}

function resolveCrossSymbolTaints(db: Database.Database, projectHash: string): void {
  db.prepare(`
    UPDATE brain_taint_flow SET sink_symbol_id = (
      SELECT r.target_symbol_id FROM brain_relationship r
      WHERE r.source_symbol_id = brain_taint_flow.source_symbol_id AND r.project_hash = brain_taint_flow.project_hash
      LIMIT 1
    )
    WHERE project_hash = ? AND sink_symbol_id IS NULL AND source_symbol_id IS NOT NULL
  `).run(projectHash)
}

// ============================================================================
// WORKER POOL
// ============================================================================

function processWithWorkers(
  projectHash: string,
  projectPath: string,
  brain_file: string[],
  onProgress: (processed: number, total: number, currentFile: string) => void,
): Promise<FileResult[]> {
  const numWorkers = Math.min(CONCURRENCY, Math.ceil(brain_file.length / WORKER_BATCH_SIZE) || 1)

  log.debug("starting worker pool", { numWorkers, brain_file: brain_file.length })

  return new Promise((resolve) => {
    const results: FileResult[] = []
    let processed = 0
    const fileQueue = [...brain_file]
    const pendingBatches = new Map<number, { brain_file: string[]; worker: ChildProcess; timeout: NodeJS.Timeout; currentFile?: string }>()
    let batchCounter = 0

    const workers = new Set<ChildProcess>()
    const idleWorkers: ChildProcess[] = []

    function handleWorkerTimeout(worker: ChildProcess, batchId: number) {
      const batch = pendingBatches.get(batchId)
      if (!batch) return

      clearTimeout(batch.timeout)
      pendingBatches.delete(batchId)

      try { worker.kill("SIGKILL") } catch {}

      // Mark remaining brain_file in batch as timed out
      const idx = batch.brain_file.indexOf(batch.currentFile || batch.brain_file[0]!)
      const remaining = batch.brain_file.slice(idx >= 0 ? idx : 0)
      for (const f of remaining) {
        results.push({ filePath: f, success: false, timeout: true, error: "Worker timeout" })
        processed++
        onProgress(processed, brain_file.length, f)
      }
    }

    function createWorker(workerId: number) {
      const workerPath = join(dirname(fileURLToPath(import.meta.url)), "worker.js")
      const worker = fork(workerPath, [], {
        env: { ...process.env, BB_SUBPROCESS: "1" },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      })

      workers.add(worker)

      worker.on("message", (msg: any) => {
        if (msg.type === "ready") {
          idleWorkers.push(worker)
          scheduleNext()
        } else if (msg.type === "file_start") {
          const batch = pendingBatches.get(msg.batchId)
          if (batch) {
            batch.currentFile = msg.filePath
            clearTimeout(batch.timeout)
            batch.timeout = setTimeout(() => handleWorkerTimeout(worker, msg.batchId), FILE_TIMEOUT_MS)
          }
        } else if (msg.type === "file_done") {
          results.push({ filePath: msg.filePath, ...msg.result, success: true })
          processed++
          onProgress(processed, brain_file.length, msg.filePath)
        } else if (msg.type === "file_error") {
          results.push({ filePath: msg.filePath, success: false, error: msg.error })
          processed++
          onProgress(processed, brain_file.length, msg.filePath)
        } else if (msg.type === "batch_done") {
          const batch = pendingBatches.get(msg.batchId)
          if (batch) {
            clearTimeout(batch.timeout)
            pendingBatches.delete(msg.batchId)
          }
          idleWorkers.push(worker)
          scheduleNext()
        }
      })

      worker.on("exit", (code) => {
        workers.delete(worker)
        const idx = idleWorkers.indexOf(worker)
        if (idx !== -1) idleWorkers.splice(idx, 1)

        // Handle batches assigned to dead worker
        for (const [batchId, batch] of pendingBatches) {
          if (batch.worker === worker) {
            handleWorkerTimeout(worker, batchId)
          }
        }

        // Respawn if needed
        if (workers.size < numWorkers && (fileQueue.length > 0 || pendingBatches.size > 0)) {
          setTimeout(() => {
            if (workers.size < numWorkers) {
              createWorker(Date.now())
              scheduleNext()
            }
          }, 500)
        }
      })

      // Send warmup
      worker.send({ type: "warmup", workerId })
    }

    function scheduleNext() {
      if (fileQueue.length === 0 && pendingBatches.size === 0) {
        // All done — kill remaining workers
        for (const w of workers) w.kill()
        resolve(results)
        return
      }

      while (idleWorkers.length > 0 && fileQueue.length > 0) {
        const worker = idleWorkers.shift()!
        const batchFiles = fileQueue.splice(0, WORKER_BATCH_SIZE)
        const batchId = ++batchCounter

        pendingBatches.set(batchId, {
          brain_file: batchFiles,
          worker,
          timeout: setTimeout(() => handleWorkerTimeout(worker, batchId), FILE_TIMEOUT_MS),
        })

        worker.send({ type: "parse_batch", batchId, brain_file: batchFiles, projectPath })
      }
    }

    // Spawn initial workers
    for (let i = 0; i < numWorkers; i++) {
      createWorker(i)
    }
  })
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

export async function indexProject(
  projectPath: string,
  db: Database.Database,
  options: IndexingOptions = {},
): Promise<IndexingStats> {
  if (options.verbose) setVerbose(true)

  let projectHash = (db.prepare("SELECT project_hash FROM brain_file LIMIT 1").get() as any)?.project_hash ||
    (db.prepare("SELECT project_hash FROM index_status LIMIT 1").get() as any)?.project_hash

  if (!projectHash) {
    const { createHash } = await import("crypto")
    projectHash = createHash("sha256").update(projectPath).digest("hex").slice(0, 16)
    db.prepare("INSERT OR REPLACE INTO index_status (project_hash, status) VALUES (?, 'indexing')").run(projectHash)
  }

  const stats: IndexingStats = {
    totalFiles: 0, processedFiles: 0, successFiles: 0,
    timeoutFiles: 0, errorFiles: 0, skippedFiles: 0,
    symbolsExtracted: 0, relationshipsFound: 0, importsFound: 0,
    startTime: Date.now(), errors: [],
  }

  const reporter = new ProgressReporter(options.onProgress)

  log.info("starting indexing", { projectPath, concurrency: CONCURRENCY })

  try {
    const files = options.files && options.files.length > 0
      ? options.files
      : await discoverFiles(projectPath, db, { excludePatterns: options.excludePatterns })

    stats.totalFiles = files.length
    log.info("files discovered", { count: files.length })

    if (files.length === 0) {
      stats.endTime = Date.now()
      db.prepare("UPDATE index_status SET status = 'complete', files_indexed = 0, last_indexed_at = ? WHERE project_hash = ?")
        .run(Date.now(), projectHash)
      return stats
    }

    // Skip worker pool — always use in-process parsing (worker pool needs IPC fixes)
    const results: FileResult[] = []
    const { parseFile: workerParse } = await import("../ast/pool-worker.js")
    
    for (const file of files) {
      try {
        const r = await workerParse(file, projectPath)
        results.push({ filePath: file, success: r.success !== false, symbols: r.symbols, relationships: r.relationships, imports: r.imports, language: r.language, framework: r.framework, fileHash: r.fileHash, sizeBytes: r.sizeBytes, lastModified: r.lastModified })
      } catch (err: any) {
        results.push({ filePath: file, success: false, error: err?.message || String(err) })
      }
      stats.processedFiles++
      reporter.emit(stats, file)
    }

    // Store with retry for transient errors
    log.info("storing results", { fileCount: results.length })
    let storedStats: StoreStats = { symbols: 0, relationships: 0, imports: 0 }

    for (let i = 0; i < results.length; i += DB_BATCH_SIZE) {
      const batch = results.slice(i, i + DB_BATCH_SIZE)
      const s = storeResults(db, projectHash, projectPath, batch)
      storedStats.symbols += s.symbols
      storedStats.relationships += s.relationships
      storedStats.imports += s.imports
    }

    // Count results with error classification
    for (const r of results) {
      if (r.success) stats.successFiles++
      else if (r.timeout) {
        stats.timeoutFiles++
        stats.errors.push({ file: r.filePath, error: "Timeout", retryable: true })
      }
      else {
        stats.errorFiles++
        const retryable = r.error?.includes("timeout") || r.error?.includes("busy") || r.error?.includes("ETIMEDOUT")
        stats.errors.push({ file: r.filePath, error: r.error || "Unknown", retryable })
      }
    }

    stats.symbolsExtracted = (db.prepare("SELECT count(*) as c FROM brain_symbol WHERE project_hash = ?").get(projectHash) as any)?.c || 0
    stats.relationshipsFound = (db.prepare("SELECT count(*) as c FROM brain_relationship WHERE project_hash = ?").get(projectHash) as any)?.c || 0
    stats.importsFound = storedStats.imports

    // Phase 4: Post-processing (full index only)
    if (!options.isIncremental) {
      log.info("post-processing: resolving brain_relationship")
      resolveRelationships(db, projectHash)

      log.info("post-processing: calculating gravity scores")
      calculateGravityScores(db, projectHash)

      log.info("post-processing: resolving taint flows")
      resolveCrossSymbolTaints(db, projectHash)
    }

    stats.endTime = Date.now()
    const duration = (stats.endTime - stats.startTime) / 1000
    stats.filesPerSecond = duration > 0 ? stats.processedFiles / duration : 0

    // Update index status
    db.prepare("UPDATE index_status SET status = ?, files_indexed = ?, symbols_indexed = ?, last_indexed_at = ? WHERE project_hash = ?")
      .run(stats.errorFiles > 0 ? "partial" : "complete", stats.successFiles, stats.symbolsExtracted, Date.now(), projectHash)

    log.info("indexing complete", {
      brain_file: stats.successFiles,
      brain_symbol: stats.symbolsExtracted,
      brain_relationship: stats.relationshipsFound,
      duration: `${duration.toFixed(1)}s`,
      fps: stats.filesPerSecond?.toFixed(1),
    })
  } catch (err: any) {
    log.error("indexing failed", { error: err?.message })
    stats.endTime = Date.now()
    db.prepare("UPDATE index_status SET status = 'error', error_message = ?, last_indexed_at = ? WHERE project_hash = ?")
      .run(err?.message || "Unknown error", Date.now(), projectHash)
    throw err
  }

  return stats
}

// ============================================================================
// INCREMENTAL REINDEX
// ============================================================================

export interface FileChange {
  path: string
  type: "added" | "modified" | "deleted"
}

export async function reindexFiles(
  projectPath: string,
  db: Database.Database,
  changes: FileChange[],
): Promise<{ indexed: number; deleted: number; errors: number }> {
  const result = { indexed: 0, deleted: 0, errors: 0 }
  const projectHash = (db.prepare("SELECT project_hash FROM index_status LIMIT 1").get() as any)?.project_hash
  if (!projectHash) return result

  // Handle deletions
  const deleted = changes.filter((c) => c.type === "deleted")
  if (deleted.length > 0) {
    const tx = db.transaction(() => {
      for (const change of deleted) {
        const fileId = `${projectHash}:${change.path}`
        db.prepare("DELETE FROM brain_relationship WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)").run(fileId)
        db.prepare("DELETE FROM brain_taint_flow WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)").run(fileId)
        db.prepare("DELETE FROM brain_symbol WHERE file_id = ?").run(fileId)
        db.prepare("DELETE FROM brain_import WHERE file_id = ?").run(fileId)
        db.prepare("DELETE FROM brain_file WHERE id = ?").run(fileId)
        result.deleted++
      }
    })
    try { tx() } catch (err: any) { result.errors++ }
  }

  // Handle adds/modifies
  const toIndex = changes.filter((c) => c.type !== "deleted").map((c) => c.path)
  if (toIndex.length > 0) {
    try {
      const stats = await indexProject(projectPath, db, { brain_file: toIndex, isIncremental: true })
      result.indexed = stats.successFiles
      result.errors += stats.errorFiles
    } catch { result.errors++ }
  }

  return result
}
