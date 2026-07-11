// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import * as Log from "../tool/brain-log.js"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"
import path from "path"
import { readdir, stat } from "fs/promises"
import { eq, and, sql, inArray } from "drizzle-orm"
import {
  BrainFileTable,
  BrainSymbolTable,
  BrainRelationshipTable,
  BrainImportTable,
  BrainTaintFlowTable,
} from "../brain/brain.sql.js"

const log = Log.create({ service: "brain-indexer" })

// Universal Brain Indexer - Connects AST Engine to Brain Database
// This is the intelligence pipeline that transforms code into brain knowledge

export namespace BrainIndexer {
  export interface IndexingOptions {
    incremental?: boolean // Only index changed files
    extensions?: string[] // File extensions to include
    excludePaths?: string[] // Paths to exclude
    maxFileSize?: number // Max file size in bytes
    batchSize?: number // Files to process in each batch
    strictRelationshipErrors?: boolean // Fail indexing when relationship insertions fail
    relationshipErrorThreshold?: number // Maximum allowed failed relationship insertions
  }

  export interface IndexingProgress {
    totalFiles: number
    processedFiles: number
    currentFile?: string
    errors: IndexingError[]
    startTime: number
    estimatedCompletion?: number
  }

  export interface IndexingError {
    filePath: string
    error: string
    timestamp: number
  }

  export interface IndexingResult {
    filesProcessed: number
    symbolsExtracted: number
    relationshipsFound: number
    relationshipInsertFailures: number
    errors: IndexingError[]
    duration: number
  }

  // Problematic file patterns that may cause hangs - ENHANCED AGGRESSIVE MODE
  const PROBLEMATIC_PATTERNS = [
    /\.min\.(js|css)$/, // Minified files
    /\.bundle\.(js|css)$/, // Bundle files
    /\.chunk\.\w+\.js$/, // Webpack chunks
    /node_modules.*\.d\.ts$/, // Large TypeScript declaration files
    /\.generated\./, // Generated files
    /\.spec\.large\./, // Large test files
    /\.test\.large\./, // Large test files
    /vendor.*\.(js|ts)$/, // Vendor files
    // NEW: Additional problematic patterns
    /.*\.min\./, // Any minified file
    /.*-min\./, // Alternative minified naming
    /.*\.obfuscated\./, // Obfuscated files
    /.*\.compiled\./, // Compiled files
    /.*\.transpiled\./, // Transpiled files
    /.*\.polyfill\./, // Polyfill files
    /.*\.shim\./, // Shim files
    /lib\/.*\.js$/, // Library files
    /libs\/.*\.js$/, // Library files alternative
    /third[-_]party/, // Third party directories
    /external/, // External directories
    /packages\/.*\/dist\//, // Package dist directories
    /packages\/.*\/build\//, // Package build directories
    /packages\/.*\/lib\//, // Package lib directories
    /.*\.worker\.(js|ts)$/, // Web workers (can hang)
    /.*\.sw\.(js|ts)$/, // Service workers (can hang)
    /.*\.webworker\.(js|ts)$/, // Web workers alternative naming
    /.*\.umd\.(js|ts)$/, // UMD bundles
    /.*\.iife\.(js|ts)$/, // IIFE bundles
    /.*\.cjs\.(js|ts)$/, // CommonJS bundles
    /.*\.esm\.(js|ts)$/, // ESM bundles
    /.*\.global\.(js|ts)$/, // Global bundles
    /socket\.io.*\.js$/, // Socket.io files (can be large)
    /three(\.min)?\.js$/, // Three.js (very large)
    /d3(\.min)?\.js$/, // D3.js (can be large)
    /chart.*\.js$/, // Chart libraries
    /.*\.map$/, // Source maps
    /\.map\.js$/, // Source map JS files
    // NEW AGGRESSIVE PATTERNS based on hang analysis
    /.*\.test\.js$/, // Test files can be problematic
    /.*\.spec\.js$/, // Spec files can be problematic
    /.*electron.*\.js$/, // Electron-related files
    /.*\/fixtures\//, // Test fixtures
    /.*\/mocks?\//, // Mock files
    /.*\/stubs?\//, // Stub files
    /.*\/examples?\//, // Example files
    /.*\/demo/, // Demo files
    /.*\/docs?\//, // Documentation files with code
    /.*\.stories\.(js|ts)$/, // Storybook files
    /.*\.config\.(js|ts)$/, // Large config files
    /.*webpack.*\.(js|ts)$/, // Webpack configs
    /.*rollup.*\.(js|ts)$/, // Rollup configs
    /.*babel.*\.(js|ts)$/, // Babel configs
    /.*eslint.*\.(js|ts)$/, // ESLint configs
    /.*postcss.*\.(js|ts)$/, // PostCSS configs
    /.*tailwind.*\.(js|ts)$/, // Tailwind configs
    /webview.*\.(ts|js)$/, // Webview files (known to cause hangs)
    /sst-env\.d\.ts$/, // SST generated environment types (causes severe hangs)
    /.*-env\.d\.ts$/, // Generic environment types (often generated and massive)
    /vite-env\.d\.ts$/, // Vite generated environment types
    // NEW: Generated code files that cause hangs
    /\.gen\.(ts|js|tsx|jsx)$/, // Generated TypeScript/JavaScript files (OpenAPI, GraphQL, etc.)
    /\.generated\.(ts|js|tsx|jsx)$/, // Alternative generated file naming
    /openapi\.json$/, // OpenAPI spec files (can be massive)
    /swagger\.json$/, // Swagger spec files
    /schema\.json$/, // JSON schema files (often large)
    /Az\..*\.json$/, // Azure Telemetry generated data dumps
    /.*DataLake.*\.json$/,
    /.*PowerBI.*\.json$/,
    /.*Sftp.*\.json$/,
    /\/gen\/.*\.(ts|js)$/, // Files in /gen/ directories
    /\/generated\/.*\.(ts|js)$/, // Files in /generated/ directories
    /\.d\.ts$/, // ALL declaration files - they're for types only, not runtime code
  ]

  // Maximum file size for processing (2MB - reduced for better safety and WASM stability)
  const MAX_SAFE_FILE_SIZE = 2 * 1024 * 1024

  // Default indexing configuration
  // ALL 26 SUPPORTED LANGUAGES!
  const DEFAULT_OPTIONS: Required<IndexingOptions> = {
    incremental: true,
    extensions: [
      // Web Technologies
      ".js",
      ".ps1",
      ".psm1",
      ".psd1",
      ".jsx",
      ".ts",
      ".tsx",
      ".html",
      ".css",
      ".scss",
      ".sass",
      ".vue",
      ".svelte",

      ".yaml",
      ".yml",
      // Systems Programming
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cc",
      ".cxx",
      ".rs",
      ".go",
      // Enterprise & JVM
      ".java",
      ".kt",
      ".kts",
      ".scala",
      ".sc",
      ".groovy",
      ".gsp",
      // Scripting & Dynamic
      ".py",
      ".pyw",
      ".rb",
      ".php",
      ".lua",
      ".pl",
      ".pm",
      ".t",
      ".ex",
      ".exs",
      ".erl",
      ".hrl",
      // Functional Programming
      ".hs",
      ".lhs",
      ".clj",
      ".cljs",
      ".cljc",
      ".edn",
      ".icl",
      ".dcl",
      // F# and .NET
      ".fs",
      ".fsi",
      ".fsx",
      // Mobile & Modern
      ".swift",
      ".dart",
      // Microsoft Ecosystem
      ".cs",
      ".csx",
      // Data Science & Stats
      ".r",
      ".R",

      // Shell & System
      ".sh",
      ".bash",
      ".zsh",

      // Systems Programming (Zig)
      ".zig",
      ".graphql",
      // Infrastructure as Code (HCL / Terraform / OpenTofu)
      ".tf",
      ".tfvars",
      ".tofu",
      ".hcl",
    ],
    excludePaths: [
      "node_modules",
      ".bun",
      ".git",
      "dist",
      "build",
      ".next",
      "target",
      "vendor",
      "__pycache__",
      ".cache",
      "coverage",
      ".dart_tool",
      ".pub-cache",
      "Pods",
      ".gradle",
      ".idea",
      ".vscode",
      ".vs",
      "out",
      ".turbo",
      ".vercel",
      ".netlify",
      ".sst",
      "temp",
      "tmp",
      ".temp",
      ".tmp",
    ],
    maxFileSize: 1024 * 1024, // 1MB
    batchSize: 25, // Reduced from 50 for better memory management
    strictRelationshipErrors: false,
    relationshipErrorThreshold: 0,
  }

  // Memory limits and monitoring
  const MAX_HEAP_SIZE_MB = 8192 // 2GB maximum heap size
  const MAX_FILES_TO_INDEX = 50000 // Maximum files to prevent runaway indexing
  const MEMORY_CHECK_FREQUENCY = 10 // Check memory every N files
  const GC_FREQUENCY = 50 // Force GC every N files if available

  /**
   * Dynamic memory and file limits based on project size
   */
  function getProjectLimits(totalFiles: number): {
    maxHeapSize: number
    maxFiles: number
    batchSize: number
    checkpointFreq: number
  } {
    if (totalFiles > 100000) {
      // Very large projects (100k+ files)
      return {
        maxHeapSize: 6 * 1024, // 6GB for very large projects
        maxFiles: 500000,
        batchSize: 10, // Smaller batches for safety
        checkpointFreq: 25, // More frequent checkpoints
      }
    } else if (totalFiles > 50000) {
      // Large projects (50k+ files)
      return {
        maxHeapSize: 4 * 1024, // 4GB for large projects
        maxFiles: 200000,
        batchSize: 15,
        checkpointFreq: 35,
      }
    } else if (totalFiles > 10000) {
      // Medium projects (10k+ files)
      return {
        maxHeapSize: 3 * 1024, // 3GB for medium projects
        maxFiles: 100000,
        batchSize: 20,
        checkpointFreq: 50,
      }
    } else {
      // Small projects
      return {
        maxHeapSize: MAX_HEAP_SIZE_MB, // Default 2GB
        maxFiles: MAX_FILES_TO_INDEX, // Default 50k
        batchSize: MAX_TRANSACTION_SIZE, // Default 25
        checkpointFreq: CHECKPOINT_FREQUENCY, // Default 50
      }
    }
  }

  /**
   * Force garbage collection to prevent memory buildup during long indexing sessions
   */
  function maybeGarbageCollect(fileCount: number): void {
    if (fileCount % GC_FREQUENCY === 0) {
      if (global.gc) {
        const before = process.memoryUsage().heapUsed
        global.gc()
        const after = process.memoryUsage().heapUsed
        const freed = before - after
        log.debug("forced garbage collection", {
          fileCount,
          freedMB: Math.round(freed / 1024 / 1024),
          heapUsedMB: Math.round(after / 1024 / 1024),
        })
      }
    }
  }

  /**
   * Check memory usage and throw error if limits exceeded
   */
  function checkMemoryLimits(fileCount: number, customMaxHeap?: number, customMaxFiles?: number): void {
    const memUsage = process.memoryUsage()
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024
    const maxHeapMB = customMaxHeap || MAX_HEAP_SIZE_MB
    const maxFiles = customMaxFiles || MAX_FILES_TO_INDEX

    if (heapUsedMB > maxHeapMB) {
      throw new Error(
        `Memory limit exceeded: ${Math.round(heapUsedMB)}MB > ${maxHeapMB}MB. ` +
          `Consider indexing smaller projects or increasing memory limits. ` +
          `Large projects will automatically resume from checkpoint.`,
      )
    }

    if (fileCount > maxFiles) {
      throw new Error(
        `File count limit exceeded: ${fileCount} > ${maxFiles}. ` +
          `This project is very large. Indexing will use checkpoints for safe resumption.`,
      )
    }

    log.debug("memory check", {
      heapUsedMB: Math.round(heapUsedMB),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      fileCount,
      limit: maxHeapMB,
    })
  }

  // Checkpoint system for large project indexing resilience
  interface IndexingCheckpoint {
    projectId: ProjectID
    totalFiles: number
    processedFiles: number
    lastProcessedFile: string | null
    completedFiles: string[]
    sessionStartTime: number
    lastCheckpointTime: number
    isComplete: boolean
  }

  const CHECKPOINT_FREQUENCY = 50 // Save checkpoint every 50 files
  const MAX_TRANSACTION_SIZE = 25 // Smaller transactions for better resilience

  async function saveCheckpoint(checkpoint: IndexingCheckpoint, db: any): Promise<void> {
    try {
      await db.run(sql`
        INSERT OR REPLACE INTO indexing_checkpoints
        (project_id, checkpoint_data, created_at)
        VALUES (${checkpoint.projectId}, ${JSON.stringify(checkpoint)}, ${new Date().toISOString()})
      `)
      log.debug("checkpoint saved", {
        projectId: checkpoint.projectId,
        processedFiles: checkpoint.processedFiles,
        totalFiles: checkpoint.totalFiles,
      })
    } catch (error) {
      log.warn("failed to save checkpoint", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  async function loadCheckpoint(projectId: ProjectID, db: any): Promise<IndexingCheckpoint | null> {
    try {
      const rows = (await db.all(sql`
        SELECT checkpoint_data FROM indexing_checkpoints
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC
        LIMIT 1
      `)) as any[]

      if (rows && rows.length > 0) {
        const checkpoint = JSON.parse(rows[0].checkpoint_data) as IndexingCheckpoint
        log.info("checkpoint loaded", {
          projectId,
          processedFiles: checkpoint.processedFiles,
          totalFiles: checkpoint.totalFiles,
          isComplete: checkpoint.isComplete,
        })
        return checkpoint
      }
    } catch (error) {
      log.warn("failed to load checkpoint", { error: error instanceof Error ? error.message : String(error) })
    }
    return null
  }

  async function clearCheckpoint(projectId: ProjectID, db: any): Promise<void> {
    try {
      await db.run(sql`DELETE FROM indexing_checkpoints WHERE project_id = ${projectId}`)
      log.debug("checkpoint cleared", { projectId })
    } catch (error) {
      log.warn("failed to clear checkpoint", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  async function ensureCheckpointTable(db: any): Promise<void> {
    try {
      await db.run(sql`
        CREATE TABLE IF NOT EXISTS indexing_checkpoints (
          project_id TEXT PRIMARY KEY,
          checkpoint_data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `)
    } catch (error) {
      log.warn("failed to create checkpoint table", { error: error instanceof Error ? error.message : String(error) })
    }
  }

  // Index entire project directory
  export async function indexProject(
    projectId: ProjectID,
    projectPath: string,
    options: IndexingOptions = {},
  ): Promise<IndexingResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    const startTime = Date.now()

    log.info("starting project indexing", { projectId, projectPath, options: opts })

    // Initialize brain database
    const db = await BrainDatabase.getInstance(projectId)

    // Emit indexing started event
    Bus.publishSafe(BrainService.Event.IndexingStarted, { projectId })

    const progress: IndexingProgress = {
      totalFiles: 0,
      processedFiles: 0,
      errors: [],
      startTime,
    }

    try {
      // Ensure checkpoint table exists
      await ensureCheckpointTable(db)

      // Check for existing checkpoint (resume capability)
      let checkpoint = await loadCheckpoint(projectId, db)
      let filesToIndex: string[] = []
      let resuming = false

      if (checkpoint && !checkpoint.isComplete) {
        log.info("resuming from checkpoint", {
          projectId,
          processedFiles: checkpoint.processedFiles,
          totalFiles: checkpoint.totalFiles,
          lastFile: checkpoint.lastProcessedFile,
        })

        // Rediscover files in case project changed
        const allFiles = await discoverFiles(projectPath, opts)

        // Resume from where we left off - skip completed files
        filesToIndex = allFiles.filter((file) => !checkpoint!.completedFiles.includes(file))
        progress.totalFiles = allFiles.length
        progress.processedFiles = checkpoint!.processedFiles
        resuming = true

        log.info("resuming indexing", {
          previouslyProcessed: checkpoint.processedFiles,
          remainingFiles: filesToIndex.length,
          totalFiles: progress.totalFiles,
        })
      } else {
        // Fresh indexing - discover all files
        filesToIndex = await discoverFiles(projectPath, opts)
        progress.totalFiles = filesToIndex.length

        // Create new checkpoint
        checkpoint = {
          projectId,
          totalFiles: progress.totalFiles,
          processedFiles: 0,
          lastProcessedFile: null,
          completedFiles: [],
          sessionStartTime: startTime,
          lastCheckpointTime: startTime,
          isComplete: false,
        }
        await saveCheckpoint(checkpoint, db)
      }

      // Get dynamic limits based on project size
      const limits = getProjectLimits(progress.totalFiles)
      const dynamicBatchSize = limits.batchSize
      const dynamicCheckpointFreq = limits.checkpointFreq

      // Check file count limit before starting with dynamic limits
      checkMemoryLimits(progress.totalFiles, limits.maxHeapSize, limits.maxFiles)

      log.info("files ready for indexing", {
        projectId,
        totalFiles: progress.totalFiles,
        filesToProcess: filesToIndex.length,
        resuming,
        extensions: opts.extensions,
        dynamicLimits: limits,
        memoryLimitMB: limits.maxHeapSize,
        fileLimitMB: limits.maxFiles,
      })

      let symbolsExtracted = 0
      let relationshipsFound = 0
      let relationshipInsertFailures = 0

      // CRITICAL: Add database integrity monitoring for large projects
      const DB_INTEGRITY_CHECK_FREQUENCY = 1000 // Check every 1000 files
      const performDatabaseIntegrityCheck = async (fileCount: number) => {
        if (fileCount % DB_INTEGRITY_CHECK_FREQUENCY === 0 && fileCount > 0) {
          try {
            // Quick integrity check using raw SQLite instance
            const rawDb = await BrainDatabase.getRawInstance(projectId)
            const integrityResult = rawDb.prepare("PRAGMA quick_check(10)").all() as Array<{ [key: string]: any }>
            if (integrityResult.length === 0 || integrityResult[0]["quick_check"] !== "ok") {
              throw new Error("Database integrity check failed")
            }

            // Check WAL size and checkpoint if needed (prevent excessive WAL growth)
            const walInfo = rawDb.prepare("PRAGMA wal_checkpoint(PASSIVE)").all()
            log.debug("database integrity check passed", {
              projectId,
              fileCount,
              walCheckpointed: walInfo,
            })
          } catch (error) {
            log.error("CRITICAL: database integrity issue detected", {
              projectId,
              fileCount,
              error: error instanceof Error ? error.message : String(error),
            })
            // Force WAL checkpoint and continue
            try {
              const rawDb = await BrainDatabase.getRawInstance(projectId)
              rawDb.prepare("PRAGMA wal_checkpoint(TRUNCATE)").run()
            } catch {
              // Ignore checkpoint errors
            }
          }
        }
      }

      // Process files in smaller batches with checkpoint resilience
      let lastProgressEmit = 0
      let lastProgressUpdate = Date.now()
      const PROGRESS_EMIT_THROTTLE = 500 // Only emit progress every 500ms
      const DEADLOCK_DETECTION_TIMEOUT = 30000 // 30 seconds without progress = potential deadlock

      for (let i = 0; i < filesToIndex.length; i += dynamicBatchSize) {
        const batch = filesToIndex.slice(i, i + dynamicBatchSize)

        // Deadlock detection
        const now = Date.now()
        if (now - lastProgressUpdate > DEADLOCK_DETECTION_TIMEOUT) {
          log.error("potential deadlock detected", {
            projectId,
            currentIndex: i,
            totalFiles: filesToIndex.length,
            timeSinceLastUpdate: now - lastProgressUpdate,
            currentBatch: batch.map((f) => path.basename(f)),
          })

          // Save emergency checkpoint before continuing
          checkpoint.lastProcessedFile = batch[0] || null
          checkpoint.lastCheckpointTime = now
          await saveCheckpoint(checkpoint, db)

          // Skip current batch and continue
          progress.processedFiles = (resuming ? checkpoint.processedFiles : 0) + i
          continue
        }

        // Check memory before each batch with dynamic limits
        if (i % (dynamicBatchSize * 2) === 0) {
          checkMemoryLimits(progress.processedFiles, limits.maxHeapSize, limits.maxFiles)
        }

        // CRITICAL: Database integrity monitoring for large projects
        await performDatabaseIntegrityCheck(progress.processedFiles)

        // FIX: Process files in parallel with controlled concurrency
        // Instead of sequential 1 file at a time, process 10 files simultaneously
        const PARALLEL_CONCURRENCY = 10 // Process 10 files at a time
        let batchSymbols = 0
        let batchRelationships = 0
        let batchFailures = 0
        const batchSkippedFiles: string[] = []

        // Helper: Process a single file and return results
        const processFile = async (
          filePath: string,
          fileIndex: number,
        ): Promise<{
          filePath: string
          success: boolean
          symbolCount: number
          relationshipCount: number
          relationshipInsertFailures: number
          error?: IndexingError
        }> => {
          const batchOffset = resuming ? checkpoint.processedFiles : 0
          const currentIndex = Math.min(batchOffset + i + fileIndex + 1, progress.totalFiles)
          const startFileTime = Date.now()

          try {
            let result = null
            let attempts = 0
            const maxAttempts = 3
            const timeouts = [30000, 10000, 5000]

            while (attempts < maxAttempts && result === null) {
              attempts++
              const timeoutMs = timeouts[attempts - 1]

              log.debug(`indexing file attempt ${attempts}/${maxAttempts}`, {
                projectId,
                filePath,
                timeout: timeoutMs,
              })

              const indexingPromise = indexSingleFile(projectId, projectPath, filePath, db)

              let timeoutId: NodeJS.Timeout
              const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  log.warn(`file indexing timeout attempt ${attempts}/${maxAttempts}`, {
                    projectId,
                    filePath,
                    processingTime: Date.now() - startFileTime,
                    timeout: timeoutMs,
                  })
                  reject(new Error(`File indexing timeout attempt ${attempts}: ${filePath}`))
                }, timeoutMs)
              })

              try {
                result = await Promise.race([indexingPromise, timeoutPromise])
                clearTimeout(timeoutId!)

                const fileProcessTime = Date.now() - startFileTime
                if (fileProcessTime > 5000) {
                  log.warn("slow file processing", {
                    projectId,
                    filePath,
                    processingTime: fileProcessTime,
                    symbols: result.symbolCount,
                    relationships: result.relationshipCount,
                    attempt: attempts,
                  })
                }
                break
              } catch (error) {
                clearTimeout(timeoutId!)
                if (attempts < maxAttempts) {
                  log.warn(`file indexing failed attempt ${attempts}/${maxAttempts}, retrying`, {
                    projectId,
                    filePath,
                    error: error instanceof Error ? error.message : String(error),
                    nextTimeout: attempts < maxAttempts ? timeouts[attempts] : null,
                  })
                  continue
                } else {
                  const indexingError: IndexingError = {
                    filePath,
                    error: `ALL ATTEMPTS FAILED after ${maxAttempts} tries: ${error instanceof Error ? error.message : String(error)}`,
                    timestamp: Date.now(),
                  }
                  log.error("CRITICAL: file completely failed indexing after all attempts", {
                    projectId,
                    filePath,
                    error: indexingError.error,
                    attempts: maxAttempts,
                    fileSize: await getFileSize(filePath),
                    progress: (currentIndex / progress.totalFiles) * 100,
                  })
                  return {
                    filePath,
                    success: false,
                    symbolCount: 0,
                    relationshipCount: 0,
                    relationshipInsertFailures: 1,
                    error: indexingError,
                  }
                }
              }
            }

            return {
              filePath,
              success: true,
              symbolCount: result?.symbolCount || 0,
              relationshipCount: result?.relationshipCount || 0,
              relationshipInsertFailures: result?.relationshipInsertFailures || 0,
            }
          } catch (error) {
            const indexingError: IndexingError = {
              filePath,
              error: `UNEXPECTED ERROR: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: Date.now(),
            }
            log.error("CRITICAL: unexpected error during file indexing", {
              projectId,
              filePath,
              error: indexingError.error,
            })
            return {
              filePath,
              success: false,
              symbolCount: 0,
              relationshipCount: 0,
              relationshipInsertFailures: 1,
              error: indexingError,
            }
          }
        }

        // FIX: Process files in parallel chunks
        for (let chunkStart = 0; chunkStart < batch.length; chunkStart += PARALLEL_CONCURRENCY) {
          const chunkEnd = Math.min(chunkStart + PARALLEL_CONCURRENCY, batch.length)
          const chunk = batch.slice(chunkStart, chunkEnd)

          // Process chunk in parallel
          const chunkResults = await Promise.all(chunk.map((filePath, idx) => processFile(filePath, chunkStart + idx)))

          // Aggregate results from parallel processing
          for (const result of chunkResults) {
            progress.processedFiles = Math.min(
              (resuming ? checkpoint.processedFiles : 0) + i + batch.indexOf(result.filePath) + 1,
              progress.totalFiles,
            )
            progress.currentFile = result.filePath

            if (result.success) {
              batchSymbols += result.symbolCount
              batchRelationships += result.relationshipCount
              batchFailures += result.relationshipInsertFailures
              checkpoint.completedFiles.push(result.filePath)
              checkpoint.lastProcessedFile = result.filePath
            } else {
              progress.errors.push(result.error!)
              batchSkippedFiles.push(result.filePath)
              checkpoint.completedFiles.push(result.filePath)
              checkpoint.lastProcessedFile = result.filePath
            }

            // Throttled progress updates
            const now = Date.now()
            if (now - lastProgressEmit > PROGRESS_EMIT_THROTTLE) {
              Bus.publishSafe(BrainService.Event.IndexingProgress, {
                projectId,
                progress: (progress.processedFiles / progress.totalFiles) * 100,
                message: `Processing ${path.basename(result.filePath)} (${progress.processedFiles}/${progress.totalFiles})`,
                stats: {
                  filesProcessed: progress.processedFiles,
                  symbolsExtracted: symbolsExtracted + batchSymbols,
                  relationshipsFound: relationshipsFound + batchRelationships,
                  errors: progress.errors.length,
                  skippedFiles: batchSkippedFiles.length,
                },
              })
              lastProgressEmit = now
            }

            // Periodic memory check
            if (progress.processedFiles % MEMORY_CHECK_FREQUENCY === 0) {
              checkMemoryLimits(progress.processedFiles)
            }
            maybeGarbageCollect(progress.processedFiles)
          }

          // Small yield between chunks to prevent blocking
          await new Promise((resolve) => setImmediate(resolve))
        }

        // Update totals after batch completion
        symbolsExtracted += batchSymbols
        relationshipsFound += batchRelationships
        relationshipInsertFailures += batchFailures

        // Save checkpoint periodically (dynamic frequency based on project size)
        if ((i + dynamicBatchSize) % dynamicCheckpointFreq === 0 || i + dynamicBatchSize >= filesToIndex.length) {
          checkpoint.processedFiles = (resuming ? checkpoint.processedFiles : 0) + i + batch.length
          checkpoint.lastCheckpointTime = Date.now()
          await saveCheckpoint(checkpoint, db)

          log.debug("checkpoint updated", {
            projectId,
            processedFiles: checkpoint.processedFiles,
            totalFiles: checkpoint.totalFiles,
            progress: ((checkpoint.processedFiles / checkpoint.totalFiles) * 100).toFixed(1) + "%",
            checkpointFreq: dynamicCheckpointFreq,
          })
        }

        // Small delay between batches to prevent overwhelming the system
        if (i + dynamicBatchSize < filesToIndex.length) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }

      const duration = Date.now() - startTime
      const result: IndexingResult = {
        filesProcessed: progress.processedFiles,
        symbolsExtracted,
        relationshipsFound,
        relationshipInsertFailures,
        errors: progress.errors,
        duration,
      }

      // CRITICAL: Validate indexing completeness - ensure NO files were skipped inappropriately
      const expectedFiles = progress.totalFiles
      const actuallyProcessed = checkpoint.completedFiles.length
      const filesTotalFromResult = result.filesProcessed

      if (actuallyProcessed < expectedFiles) {
        const missingCount = expectedFiles - actuallyProcessed
        log.error("CRITICAL: indexing completeness check failed", {
          projectId,
          expectedFiles,
          actuallyProcessed,
          missingFiles: missingCount,
          errorCount: result.errors.length,
        })

        // This is a CRITICAL issue - some files were not processed at all
        log.warn(`\n⚠️  INDEXING INTEGRITY WARNING`)
        log.warn(`   Expected files: ${expectedFiles.toLocaleString()}`)
        log.warn(`   Actually processed: ${actuallyProcessed.toLocaleString()}`)
        log.warn(`   Missing files: ${missingCount.toLocaleString()}`)
        log.warn(`   This indicates potential file discovery or processing issues`)
      }

      // Log comprehensive completion statistics
      log.info("indexing integrity report", {
        projectId,
        totalDiscovered: expectedFiles,
        totalProcessed: actuallyProcessed,
        successfulFiles: actuallyProcessed - result.errors.length,
        errorFiles: result.errors.length,
        symbolsExtracted: result.symbolsExtracted,
        relationshipsFound: result.relationshipsFound,
        completenessPercentage: ((actuallyProcessed / expectedFiles) * 100).toFixed(2),
      })

      if (opts.strictRelationshipErrors && result.relationshipInsertFailures > opts.relationshipErrorThreshold) {
        const msg =
          `relationship insertion failures exceeded threshold: ` +
          `${result.relationshipInsertFailures} > ${opts.relationshipErrorThreshold}`
        log.error("strict relationship indexing gate failed", {
          projectId,
          relationshipInsertFailures: result.relationshipInsertFailures,
          threshold: opts.relationshipErrorThreshold,
        })
        throw new Error(msg)
      }

      // Mark checkpoint as complete and clear it
      checkpoint.isComplete = true
      checkpoint.processedFiles = progress.processedFiles
      await saveCheckpoint(checkpoint, db)
      await clearCheckpoint(projectId, db)

      log.info("indexing completed successfully", {
        projectId,
        filesProcessed: result.filesProcessed,
        symbolsExtracted: result.symbolsExtracted,
        relationshipsFound: result.relationshipsFound,
        errors: result.errors.length,
        duration: result.duration,
        checkpointCleared: true,
      })

      // Update brain index status
      await BrainDatabase.updateIndexStatus(projectId, {
        lastIndexed: new Date(),
        filesIndexed: result.filesProcessed,
        symbolsIndexed: result.symbolsExtracted,
        status: progress.errors.length > 0 ? "partial" : "complete",
      })

      // Step 2: Qualify calls (resolve qualified_calls to fully resolved symbols)
      log.info("starting call qualification", { projectId })
      try {
        const qualificationStats = await qualifyProjectCalls(projectId, db)
        log.info("call qualification completed", {
          projectId,
          stats: qualificationStats,
        })
      } catch (error) {
        log.error("call qualification failed", {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Don't fail the entire indexing if qualification fails
      }

      // Step 3: Resolve extends/implements relationships to actual symbol IDs
      log.info("starting heritage resolution", { projectId })
      try {
        const heritageStats = await resolveProjectHeritage(projectId, db)
        log.info("heritage resolution completed", {
          projectId,
          stats: heritageStats,
        })
      } catch (error) {
        log.error("heritage resolution failed", {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        })
        // Don't fail the entire indexing if heritage resolution fails
      }

      // Emit completion event
      Bus.publishSafe(BrainService.Event.IndexingCompleted, {
        projectId,
        stats: {
          files: result.filesProcessed,
          symbols: result.symbolsExtracted,
          relationships: result.relationshipsFound,
          relationshipInsertFailures: result.relationshipInsertFailures,
          errors: result.errors.length,
          duration: result.duration,
        },
      })

      log.info("project indexing completed", { projectId, result })
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Save emergency checkpoint on failure to preserve progress
      try {
        const db = await BrainDatabase.getInstance(projectId)
        await ensureCheckpointTable(db)

        const emergencyCheckpoint: IndexingCheckpoint = {
          projectId,
          totalFiles: progress.totalFiles,
          processedFiles: progress.processedFiles,
          lastProcessedFile: progress.currentFile || null,
          completedFiles: [], // We'll rebuild this from database on resume
          sessionStartTime: startTime,
          lastCheckpointTime: Date.now(),
          isComplete: false,
        }

        await saveCheckpoint(emergencyCheckpoint, db)
        log.warn("emergency checkpoint saved after failure", {
          projectId,
          processedFiles: progress.processedFiles,
          totalFiles: progress.totalFiles,
        })
      } catch (checkpointError) {
        log.error("failed to save emergency checkpoint", {
          error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
        })
      }

      Bus.publishSafe(BrainService.Event.IndexingFailed, {
        projectId,
        error: errorMessage,
      })

      log.error("project indexing failed", { projectId, error: errorMessage })
      throw error
    }
  }

  export interface FileChange {
    path: string
    type: "added" | "modified" | "deleted"
  }

  /**
   * Reindex specific files (used by file watcher for incremental updates)
   */
  export async function reindexFiles(
    projectId: ProjectID,
    projectPath: string,
    fileChanges: FileChange[],
  ): Promise<IndexingResult> {
    const startTime = Date.now()

    log.info("starting incremental reindex", { projectId, fileCount: fileChanges.length })

    const db = await BrainDatabase.getInstance(projectId)
    const progress: IndexingProgress = {
      totalFiles: fileChanges.length,
      processedFiles: 0,
      errors: [],
      startTime,
    }

    let symbolsExtracted = 0
    let relationshipsFound = 0
    let relationshipInsertFailures = 0

    // Process each file
    for (const change of fileChanges) {
      try {
        progress.currentFile = change.path
        progress.processedFiles++

        if (change.type === "deleted") {
          await deleteFileFromIndex(projectId, projectPath, change.path, db)
        } else {
          const result = await indexSingleFile(projectId, projectPath, change.path, db)
          symbolsExtracted += result.symbolCount
          relationshipsFound += result.relationshipCount
          relationshipInsertFailures += result.relationshipInsertFailures
        }
      } catch (error) {
        log.warn("failed to reindex file", {
          projectId,
          filePath: change.path,
          error: error instanceof Error ? error.message : String(error),
        })
        progress.errors.push({
          filePath: change.path,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        })
      }
    }

    const duration = Date.now() - startTime

    const result: IndexingResult = {
      filesProcessed: progress.processedFiles,
      symbolsExtracted,
      relationshipsFound,
      relationshipInsertFailures,
      errors: progress.errors,
      duration,
    }

    log.info("incremental reindex completed", { projectId, result })
    return result
  }

  async function deleteFileFromIndex(
    projectId: ProjectID,
    projectPath: string,
    filePath: string,
    db: any,
  ): Promise<void> {
    const relativePath = path.relative(projectPath, filePath)
    const fileId = generateFileId(projectId, relativePath)

    await db.transaction(async (tx: any) => {
      // 1. Delete relationships where this file's symbols are the source
      const fileSymbols = await tx
        .select({ id: BrainSymbolTable.id })
        .from(BrainSymbolTable)
        .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.file_id, fileId)))

      const symbolIds = fileSymbols.map((s: any) => s.id)

      if (symbolIds.length > 0) {
        await tx
          .delete(BrainRelationshipTable)
          .where(
            and(
              eq(BrainRelationshipTable.project_id, projectId),
              inArray(BrainRelationshipTable.source_symbol_id, symbolIds),
            ),
          )

        // Phase 2 Optimization: Bidirectional Purging
        // Prevent ghost edges by also deleting relationships where this file's symbols were the target
        await tx
          .delete(BrainRelationshipTable)
          .where(
            and(
              eq(BrainRelationshipTable.project_id, projectId),
              inArray(BrainRelationshipTable.target_symbol_id, symbolIds),
            ),
          )
      }

      // 2. Delete symbols for this file
      await tx
        .delete(BrainSymbolTable)
        .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.file_id, fileId)))

      // 3. Delete imports for this file
      await tx
        .delete(BrainImportTable)
        .where(and(eq(BrainImportTable.project_id, projectId), eq(BrainImportTable.file_id, fileId)))

      // 3.5 Delete taint flows involving this file
      if (symbolIds.length > 0) {
        await tx
          .delete(BrainTaintFlowTable)
          .where(
            and(
              eq(BrainTaintFlowTable.project_id, projectId),
              inArray(BrainTaintFlowTable.source_symbol_id, symbolIds),
            ),
          )
        await tx
          .delete(BrainTaintFlowTable)
          .where(
            and(eq(BrainTaintFlowTable.project_id, projectId), inArray(BrainTaintFlowTable.sink_symbol_id, symbolIds)),
          )
      }

      // 3.5 Delete taint flows where this file's symbols were source or sink
      if (symbolIds.length > 0) {
        // We use raw SQL or query builder. To avoid importing BrainTaintFlowTable if not present, let's just do it directly.
        // Wait, we need to make sure we have access to BrainTaintFlowTable.
      }

      // 4. Delete the file record itself
      await tx
        .delete(BrainFileTable)
        .where(and(eq(BrainFileTable.project_id, projectId), eq(BrainFileTable.id, fileId)))
    })

    log.debug("deleted file from index", { projectId, filePath: relativePath })
  }

  // Index a single file and store in brain database
  export async function indexSingleFile(
    projectId: ProjectID,
    projectPath: string,
    filePath: string,
    db: any, // BunSQLiteDatabase type
  ): Promise<{ symbolCount: number; relationshipCount: number; relationshipInsertFailures: number }> {
    // Check file size first
    const stats = await stat(filePath)
    if (stats && stats.size > MAX_SAFE_FILE_SIZE) {
      log.warn("skipping large file to prevent hang", {
        filePath,
        size: stats.size,
        maxSize: MAX_SAFE_FILE_SIZE,
      })
      return { symbolCount: 0, relationshipCount: 0, relationshipInsertFailures: 0 }
    }

    // Check for problematic patterns - ENHANCED
    const relativePath = path.relative(projectPath, filePath)
    if (PROBLEMATIC_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      log.debug("skipping problematic file pattern", { filePath: relativePath })
      return { symbolCount: 0, relationshipCount: 0, relationshipInsertFailures: 0 }
    }

    // Additional hanging detection based on file characteristics
    const fileName = path.basename(filePath)
    const isLikelyProblematic =
      fileName.includes(".min.") ||
      fileName.includes("-min.") ||
      fileName.includes(".bundle.") ||
      fileName.includes(".dist.") ||
      fileName.length > 50 || // Very long filenames often indicate generated files
      (stats && stats.size > 500000 && fileName.endsWith(".js")) || // Large JS files
      (stats && stats.size > 200000 && fileName.endsWith(".ts")) || // Large TS files
      (stats && stats.size > 100000 && fileName.endsWith(".d.ts")) // Large declaration files

    if (isLikelyProblematic) {
      log.warn("skipping potentially problematic file based on characteristics", {
        filePath: relativePath,
        size: stats?.size,
        fileName,
        reason: "likely to cause parsing hang",
      })
      return { symbolCount: 0, relationshipCount: 0, relationshipInsertFailures: 0 }
    }

    // Original size check (keeping for backward compatibility)
    if (stats && stats.size > DEFAULT_OPTIONS.maxFileSize) {
      throw new Error(`File too large: ${stats.size} bytes`)
    }

    // Read file content
    const content = await Filesystem.readText(filePath)

    // Parse with AST engine
    const parseResult = await ASTEngine.parseFile(filePath, content)

    // Calculate file hash for change detection
    const fileHash = await calculateFileHash(content)

    // Check if file needs reindexing (incremental mode)
    const existingFile = await db
      .select()
      .from(BrainFileTable)
      .where(and(eq(BrainFileTable.project_id, projectId), eq(BrainFileTable.path, filePath)))
      .limit(1)

    const needsReindex = !existingFile[0] || existingFile[0].file_hash !== fileHash

    if (!needsReindex) {
      log.debug("file unchanged, skipping", { projectId, filePath })

      // Still return the existing symbol count for progress tracking
      const existingSymbols = await db
        .select({ count: sql`count(*)` })
        .from(BrainSymbolTable)
        .where(
          and(
            eq(BrainSymbolTable.project_id, projectId),
            eq(BrainSymbolTable.file_id, generateFileId(projectId, relativePath)),
          ),
        )

      // Get the symbol IDs for this file to count relationships correctly
      const fileSymbols = await db
        .select({ id: BrainSymbolTable.id })
        .from(BrainSymbolTable)
        .where(
          and(
            eq(BrainSymbolTable.project_id, projectId),
            eq(BrainSymbolTable.file_id, generateFileId(projectId, relativePath)),
          ),
        )

      const symbolIds = fileSymbols.map((s: any) => s.id)

      let relCount = 0
      if (symbolIds.length > 0) {
        const existingRelationships = await db
          .select({ count: sql`count(*)` })
          .from(BrainRelationshipTable)
          .where(
            and(
              eq(BrainRelationshipTable.project_id, projectId),
              inArray(BrainRelationshipTable.source_symbol_id, symbolIds),
            ),
          )
        relCount = (existingRelationships[0]?.count as number) || 0
      }

      return {
        symbolCount: (existingSymbols[0]?.count as number) || 0,
        relationshipCount: relCount,
        relationshipInsertFailures: 0,
      }
    }

    // Start database transaction
    return await db.transaction(async (tx: any) => {
      // Generate file ID
      const fileId = generateFileId(projectId, relativePath)

      // Upsert file record
      await tx
        .insert(BrainFileTable)
        .values({
          id: fileId,
          project_id: projectId,
          path: filePath,
          relative_path: relativePath,
          file_hash: fileHash,
          size_bytes: stats?.size || 0,
          line_count: content.split("\n").length,
          language: parseResult.language,
          last_modified: stats?.mtime?.getTime() || Date.now(),
          indexed_at: new Date().toISOString(),
          content,
          framework_type: parseResult.metadata.framework,
          is_test_file: isTestFile(filePath),
          is_config_file: isConfigFile(filePath),
          is_documentation: isDocumentationFile(filePath),
          has_syntax_errors:
            parseResult.errors && parseResult.errors.some((e) => e.severity === "warning") ? true : false,
          error_report:
            parseResult.errors && parseResult.errors.some((e) => e.severity === "warning")
              ? JSON.stringify(parseResult.errors)
              : null,
        })
        .onConflictDoUpdate({
          target: [BrainFileTable.id],
          set: {
            file_hash: fileHash,
            size_bytes: stats?.size || 0,
            line_count: content.split("\n").length,
            last_modified: stats?.mtime?.getTime() || Date.now(),
            indexed_at: new Date().toISOString(),
            content,
            has_syntax_errors:
              parseResult.errors && parseResult.errors.some((e) => e.severity === "warning") ? true : false,
            error_report:
              parseResult.errors && parseResult.errors.some((e) => e.severity === "warning")
                ? JSON.stringify(parseResult.errors)
                : null,
          },
        })

      // Delete existing taint flows for this file (for clean re-indexing)
      const existingFileSymbols = await tx
        .select({ id: BrainSymbolTable.id })
        .from(BrainSymbolTable)
        .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.file_id, fileId)))

      const existingSymbolIds = existingFileSymbols.map((s: { id: string }) => s.id)

      if (existingSymbolIds.length > 0) {
        await tx
          .delete(BrainTaintFlowTable)
          .where(
            and(
              eq(BrainTaintFlowTable.project_id, projectId),
              inArray(BrainTaintFlowTable.source_symbol_id, existingSymbolIds),
            ),
          )
        await tx
          .delete(BrainTaintFlowTable)
          .where(
            and(
              eq(BrainTaintFlowTable.project_id, projectId),
              inArray(BrainTaintFlowTable.sink_symbol_id, existingSymbolIds),
            ),
          )
      }

      // Delete existing symbols for this file (for clean re-indexing)
      await tx
        .delete(BrainSymbolTable)
        .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.file_id, fileId)))

      // Insert symbols in batches
      let symbolCount = 0
      const symbolBatches = []
      let currentBatch = []

      for (const symbol of parseResult.symbols) {
        let ownerSymbolId: string | null = null
        if (symbol.ownerName && symbol.ownerKind) {
          ownerSymbolId = generateSymbolId(projectId, relativePath, symbol.ownerName, symbol.ownerKind)
        }

        currentBatch.push({
          id: generateSymbolId(
            projectId,
            relativePath,
            symbol.name,
            symbol.kind,
            symbol.kind === "variable" ? symbol.range.startIndex : undefined,
          ),
          project_id: projectId,
          file_id: fileId,
          name: symbol.name,
          symbol_type: symbol.kind,
          scope_kind: symbol.scope,
          visibility: symbol.visibility,
          is_static: symbol.isStatic || false,
          is_async: symbol.isAsync || false,
          is_abstract: symbol.isAbstract || false,
          parameters: symbol.parameters ? JSON.stringify(symbol.parameters) : null,
          return_type: symbol.returnType,
          annotations: symbol.decorators ? JSON.stringify(symbol.decorators) : null,
          docstring: symbol.comments ? symbol.comments.join("\n") : null,
          line_start: symbol.range.startLine,
          line_end: symbol.range.endLine,
          byte_start: symbol.range.startIndex ?? null,
          byte_end: symbol.range.endIndex ?? null,
          complexity: calculateSymbolComplexity(symbol),
          qualified_calls: symbol.qualified_calls ? JSON.stringify(symbol.qualified_calls) : null,
          owner_symbol_id: ownerSymbolId,
          gravity_score: symbol.gravityScore || 0,
          layer: symbol.layer || "core",
          metadata: JSON.stringify(symbol.metadata),
        })

        if (currentBatch.length >= 100) {
          symbolBatches.push(currentBatch)
          currentBatch = []
        }
        symbolCount++
      }
      if (currentBatch.length > 0) symbolBatches.push(currentBatch)

      for (const batch of symbolBatches) {
        if (batch.length > 0) {
          await tx.insert(BrainSymbolTable).values(batch).onConflictDoNothing()
          await new Promise((resolve) => setImmediate(resolve))
        }
      }

      for (const symbol of parseResult.symbols) {
        // Semantic Embedding for key symbols
        if (["function", "class", "method", "interface"].includes(symbol.kind)) {
          try {
            // Extract text snippet
            const lines = content.split("\n")
            const snippet = lines.slice(Math.max(0, symbol.range.startLine - 1), symbol.range.endLine).join("\n")

            if (snippet.length > 0 && snippet.length < 10000) {
              // Avoid massive snippets
              const embedding: number[] = await SemanticEngine.embed(snippet).catch(() => [])
              const contentHash = SemanticEngine.hashContent(snippet)
              const symbolId = generateSymbolId(
                projectId,
                relativePath,
                symbol.name,
                symbol.kind,
                symbol.kind === "variable" ? symbol.range.startIndex : undefined,
              )
              const embeddingModel = await SemanticEngine.getEmbeddingModel()

              await tx
                .insert(BrainSemanticEmbeddingTable)
                .values({
                  id: `${symbolId}_semantic`,
                  project_id: projectId,
                  entity_id: symbolId,
                  entity_type: "symbol",
                  embedding_model: embeddingModel,
                  embedding_vector: JSON.stringify(embedding),
                  vector_dimension: embedding.length,
                  content_hash: contentHash,
                  semantic_context: JSON.stringify({ name: symbol.name, kind: symbol.kind, file: relativePath }),
                  last_updated: Date.now(),
                })
                .onConflictDoUpdate({
                  target: [BrainSemanticEmbeddingTable.id],
                  set: {
                    embedding_vector: JSON.stringify(embedding),
                    content_hash: contentHash,
                    semantic_context: JSON.stringify({ name: symbol.name, kind: symbol.kind, file: relativePath }),
                    last_updated: Date.now(),
                  },
                })
            }
          } catch (e) {
            log.warn("failed to generate semantic embedding for symbol", { symbol: symbol.name, error: e })
          }
        }

        symbolCount++
      }

      // Delete existing relationships for symbols in this file
      const fileSymbols = await tx
        .select({ id: BrainSymbolTable.id })
        .from(BrainSymbolTable)
        .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.file_id, fileId)))

      const symbolIds = fileSymbols.map((s: any) => s.id)

      if (symbolIds.length > 0) {
        await tx
          .delete(BrainRelationshipTable)
          .where(
            and(
              eq(BrainRelationshipTable.project_id, projectId),
              inArray(BrainRelationshipTable.source_symbol_id, symbolIds),
            ),
          )
      }

      // Insert relationships in batches
      let relationshipCount = 0
      let relationshipInsertFailures = 0
      const MAX_RELATIONSHIPS_PER_FILE = 1000

      const processedRelationships = parseResult.relationships.slice(0, MAX_RELATIONSHIPS_PER_FILE)
      const relBatches = []
      let currentRelBatch = []

      for (let i = 0; i < processedRelationships.length; i++) {
        const relationship = processedRelationships[i]

        const sourceSymbol = parseResult.symbols.find((s: any) => s.name === relationship.source)
        let sourceId: string

        if (sourceSymbol) {
          sourceId = generateSymbolId(
            projectId,
            relativePath,
            sourceSymbol.name,
            sourceSymbol.kind,
            sourceSymbol.kind === "variable" ? sourceSymbol.range.startIndex : undefined,
          )
        } else {
          const fakeName = relationship.source || relationship.fromSymbol || relationship.from || "unknown"
          sourceId = generateSymbolId(projectId, relativePath, fakeName, "unknown")

          try {
            await tx
              .insert(BrainSymbolTable)
              .values({
                id: sourceId,
                project_id: projectId,
                file_id: fileId,
                name: fakeName,
                symbol_type: "unknown",
                scope_kind: "global",
                visibility: "public",
                line_start: 0,
                line_end: 0,
                byte_start: null,
                byte_end: null,
              })
              .onConflictDoNothing()
          } catch (e) {}
        }

        const targetSymbol = parseResult.symbols.find((s: any) => s.name === relationship.target)
        const targetId = targetSymbol
          ? generateSymbolId(
              projectId,
              relativePath,
              targetSymbol.name,
              targetSymbol.kind,
              targetSymbol.kind === "variable" ? targetSymbol.range.startIndex : undefined,
            )
          : null

        currentRelBatch.push({
          id: generateRelationshipId(
            projectId,
            sourceId,
            targetId || `external:${relationship.target}`,
            relationship.type || relationship.relationshipType || RelationshipType.References,
          ),
          project_id: projectId,
          source_symbol_id: sourceId,
          target_symbol_id: targetId,
          target_external: targetSymbol
            ? null
            : relationship.target || relationship.toSymbol || relationship.to || null,
          relationship_type:
            relationship.type || relationship.relationshipType || RelationshipType.References,
          confidence: relationship.confidence || 1.0,
          context: JSON.stringify(relationship.metadata || {}),
          line_number: null,
          metadata: JSON.stringify(relationship.metadata || {}),
        })

        if (currentRelBatch.length >= 100) {
          relBatches.push(currentRelBatch)
          currentRelBatch = []
        }
        relationshipCount++
      }
      if (currentRelBatch.length > 0) relBatches.push(currentRelBatch)

      for (const batch of relBatches) {
        if (batch.length > 0) {
          try {
            await tx.insert(BrainRelationshipTable).values(batch).onConflictDoNothing()
            await new Promise((resolve) => setImmediate(resolve))
          } catch (error) {
            relationshipInsertFailures += batch.length
          }
        }
      }

      if (parseResult.relationships.length > MAX_RELATIONSHIPS_PER_FILE) {
        log.warn("too many relationships, truncated", { projectId, filePath: relativePath })
      }

      // Delete existing imports for this file
      await tx
        .delete(BrainImportTable)
        .where(and(eq(BrainImportTable.project_id, projectId), eq(BrainImportTable.file_id, fileId)))

      // Insert imports in batches
      const importBatches = []
      let currentImportBatch = []

      for (const importInfo of parseResult.imports) {
        const mod = importInfo.module || importInfo.path || ""
        const items = importInfo.items || importInfo.importedNames || []

        if (items.length === 0) {
          currentImportBatch.push({
            id: generateImportId(projectId, relativePath, mod, mod),
            project_id: projectId,
            file_id: fileId,
            imported_name: mod,
            imported_as: importInfo.alias,
            import_path: mod,
            import_type: "side_effect",
            is_external: !mod.startsWith("."),
            line_number: importInfo.range?.startLine,
          })
        } else {
          for (const item of items) {
            currentImportBatch.push({
              id: generateImportId(projectId, relativePath, mod, item),
              project_id: projectId,
              file_id: fileId,
              imported_name: item,
              imported_as: importInfo.alias,
              import_path: mod,
              import_type: importInfo.isDefault ? "default" : "named",
              is_external: !mod.startsWith("."),
              line_number: importInfo.range?.startLine,
            })

            if (currentImportBatch.length >= 100) {
              importBatches.push(currentImportBatch)
              currentImportBatch = []
            }
          }
        }

        if (currentImportBatch.length >= 100) {
          importBatches.push(currentImportBatch)
          currentImportBatch = []
        }
      }
      if (currentImportBatch.length > 0) importBatches.push(currentImportBatch)

      for (const batch of importBatches) {
        if (batch.length > 0) {
          await tx.insert(BrainImportTable).values(batch).onConflictDoNothing()
        }
      }

      log.debug("indexed file successfully", {
        projectId,
        filePath: relativePath,
        symbols: symbolCount,
        relationships: relationshipCount,
        language: parseResult.language,
      })

      return { symbolCount, relationshipCount, relationshipInsertFailures }
    })
  }

  // Discover files to index in project
  // Discover files to index in project
  async function discoverFiles(projectPath: string, options: Required<IndexingOptions>): Promise<string[]> {
    const files: string[] = []

    async function scanDirectory(dirPath: string) {
      const entries = await readdir(dirPath)

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry)
        const relativePath = path.relative(projectPath, fullPath)

        if (options.excludePaths.some((excluded) => relativePath.includes(excluded))) {
          continue
        }

        if (
          relativePath.includes("node_modules") ||
          relativePath.includes(".git") ||
          relativePath.includes("dist/") ||
          relativePath.includes("build/") ||
          relativePath.includes(".next/") ||
          relativePath.startsWith("target/")
        ) {
          continue
        }

        const stats = await stat(fullPath)

        if (stats?.isDirectory()) {
          await scanDirectory(fullPath)
        } else if (stats?.isFile()) {
          const ext = path.extname(fullPath)

          if (options.extensions.includes(ext) || entry === "source") {
            if (!PROBLEMATIC_PATTERNS.some((pattern) => pattern.test(relativePath))) {
              files.push(fullPath)
            }
          }
        }
      }
    }

    await scanDirectory(projectPath)

    return files.sort()
  }

  // Utility functions
  function generateFileId(projectId: ProjectID, relativePath: string): string {
    return `${projectId}:file:${relativePath}`
  }

  function generateSymbolId(
    projectId: ProjectID,
    relativePath: string,
    name: string,
    kind: string,
    extra?: string | number,
  ): string {
    return `${projectId}:symbol:${relativePath}:${kind}:${name}${extra !== undefined ? ":" + extra : ""}`
  }

  function generateRelationshipId(projectId: ProjectID, source: string, target: string, type: string): string {
    return `${projectId}:rel:${source}:${type}:${target}`
  }

  function generateImportId(projectId: ProjectID, relativePath: string, module: string, item: string): string {
    return `${projectId}:import:${relativePath}:${module}:${item}`
  }

  async function calculateFileHash(content: string): Promise<string> {
    const crypto = require("crypto")
    return crypto.createHash("sha256").update(content).digest("hex").substring(0, 40)
  }

  function calculateSymbolComplexity(symbol: UniversalSymbol): number {
    // First check if the parser already calculated complexity
    if (symbol.metadata?.complexity && symbol.metadata.complexity > 1) {
      return Math.min(symbol.metadata.complexity, 50)
    }

    let complexity = 1

    // Add complexity for parameters
    if (symbol.parameters) {
      complexity += symbol.parameters.length
    }

    // Add complexity for decorators/annotations
    if (symbol.decorators) {
      complexity += symbol.decorators.length
    }

    // Add complexity for async/abstract modifiers
    if (symbol.isAsync) complexity += 1
    if (symbol.isAbstract) complexity += 1

    return Math.min(complexity, 20) // Cap at reasonable value
  }

  function isTestFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase()
    return (
      fileName.includes(".test.") ||
      fileName.includes(".spec.") ||
      fileName.includes("_test.") ||
      filePath.includes("/tests/") ||
      filePath.includes("/__tests__/")
    )
  }

  function isConfigFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase()
    const configFiles = [
      "package.json",
      "tsconfig.json",
      "webpack.config.js",
      "babel.config.js",
      ".eslintrc",
      "jest.config.js",
      "go.mod",
      "Cargo.toml",
      "pom.xml",
      "build.gradle",
    ]
    return configFiles.some((config) => fileName.includes(config))
  }

  function isDocumentationFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase()
    return (
      ext === ".md" ||
      ext === ".txt" ||
      ext === ".rst" ||
      filePath.toLowerCase().includes("readme") ||
      filePath.toLowerCase().includes("/docs/")
    )
  }

  /**
   * Get file size safely
   */
  async function getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await stat(filePath)
      return stats?.size || 0
    } catch {
      return 0
    }
  }

  // Get indexing statistics for a project
  export async function getIndexingStats(projectId: ProjectID) {
    const db = await BrainDatabase.getInstance(projectId)

    const [fileCount] = await db
      .select({ count: sql`count(*)` })
      .from(BrainFileTable)
      .where(eq(BrainFileTable.project_id, projectId))

    const [symbolCount] = await db
      .select({ count: sql`count(*)` })
      .from(BrainSymbolTable)
      .where(eq(BrainSymbolTable.project_id, projectId))

    const [relationshipCount] = await db
      .select({ count: sql`count(*)` })
      .from(BrainRelationshipTable)
      .where(eq(BrainRelationshipTable.project_id, projectId))

    return {
      files: fileCount?.count || 0,
      symbols: symbolCount?.count || 0,
      relationships: relationshipCount?.count || 0,
    }
  }
}
