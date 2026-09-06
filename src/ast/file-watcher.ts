// src/ast/file-watcher.ts — M44.W3.1 (#673)
// Shared resident watcher: watch -> debounce -> incremental reindex for CLI
// and MCP sessions. Mirrors the M24 LSP loop (src/lsp/freshness.ts) — 300 ms
// debounce, in-flight honesty, full-scan catch-up, "the watcher is an
// optimization, never the sole correctness mechanism" — WITHOUT sharing code
// with it (parity is proven by the W3.1 gate, M24 files untouched).
//
// Declared guarantees (gated by script/m44/verify-w31-watcher.ts):
//   debounce:    events are debounced WATCH_DEBOUNCE_MS before reindex
//   catch-up:    after a burst settles, reindex completes before reads are
//                served from stale rows; the read paths' own repair remains
//                the backstop (watcher never the sole correctness mechanism)
//   P1 lock:     when ANOTHER PROCESS holds the project lock the watcher
//                DECLINES (never interleaves), records the deferral, and
//                retries with a bounded backoff until the lock is free; a
//                same-process indexer serializes on the in-process queue
//   crash/stop:  startup runs a bounded full scan (rows vs disk + W2 new-file
//                probes, capped) so a restart reconciles what a dead watcher
//                missed before serving claims freshness
//   storms:      bursts coalesce into one reindex per debounce window; a
//                pathological burst (or a filename-less event) falls back to
//                the probe-driven scan — the reindex is bounded
//   honesty:     a failed/declined reindex keeps its files in-flight (status
//                never silently claims freshness) and records lastError for
//                `bb watch --status`
//
// Coverage boundary (honest): directory-level events (a whole new dir, a
// whole dir deleted) carry no per-file signals on some platforms — new files
// in brand-new directories and whole-directory deletions are caught by the
// read-side W2 probes / row freshness repair, exactly the "watcher is an
// optimization" contract.
import { watch, statSync, existsSync, type FSWatcher } from "node:fs"
import path from "node:path"
import { checkFileFreshness } from "../brain/freshness"
import { reindexFilesParallel } from "./parallel-indexer"
import { liveIndexLockHolder } from "./index-lock"
import { readWatchIntent, writeWatchRuntime } from "./watch-state"
import { BrainDatabase, type CoreDatabase } from "../brain/database"

/** Declared debounce window (ms) before a debounced reindex starts. */
export const WATCH_DEBOUNCE_MS = 300
/** How long a declined flush waits before retrying (P1 catch-up). */
export const WATCH_RETRY_MS = 1000
/** Retry cap per flush batch — beyond it the batch is left to the probes. */
export const WATCH_MAX_RETRIES = 10
/** Cap on new-file catch-up per startup scan / storm fallback (bounded). */
export const WATCH_STARTUP_CAP = 500

export type WatchChangeType = "added" | "modified" | "deleted"

export interface ProjectWatcherStatus {
  projectId: string
  projectPath: string
  /** desired from the durable index-time intent. */
  desired: boolean
  running: boolean
  watchingSince: number | null
  pending: number
  inFlight: number
  startupScan: "none" | "running" | "done" | "failed"
  lastError: string | null
  lastReindexAt: number | null
  /** how many flushes declined (cross-process lock held) since start. */
  declined: number
}

export interface ProjectWatcher {
  start(): void
  stop(): Promise<void>
  status(): ProjectWatcherStatus
  /** wait until pending/in-flight/startup work settles (test/drain helper). */
  drain(): Promise<void>
}

type WatcherLogger = (msg: string, meta?: Record<string, unknown>) => void

/** In-process registry so `bb watch --status` and MCP can share watchers. */
const registry = new Map<string, ProjectWatcher>()

export function runningWatchers(): Array<{ projectId: string; watcher: ProjectWatcher }> {
  return Array.from(registry.entries()).map(([projectId, watcher]) => ({ projectId, watcher }))
}

export function watcherFor(projectId: string): ProjectWatcher | undefined {
  return registry.get(projectId)
}

/**
 * Start (or return the existing) resident watcher for a project. Honors the
 * durable watch-intent: when `force` is false and no intent was recorded at
 * index time, the watcher is NOT started (the user's index-time choice is
 * never overridden). `force` is for `bb watch <dir>` / tests.
 */
export function startProjectWatcher(
  projectId: string,
  projectPath: string,
  opts: {
    force?: boolean
    log?: WatcherLogger
  } = {},
): ProjectWatcher {
  const existing = registry.get(projectId)
  if (existing) return existing

  const log: WatcherLogger = opts.log ?? ((msg, meta) => console.error(`[bb-watch] ${msg}`, meta ?? ""))

  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let started = false
  let watchingSince: number | null = null
  let lastError: string | null = null
  let lastReindexAt: number | null = null
  let declined = 0
  let startupState: ProjectWatcherStatus["startupScan"] = "none"
  let reindexChain: Promise<void> = Promise.resolve()

  /** relative path (from the indexed root) -> change type, awaiting debounce. */
  const pending = new Map<string, WatchChangeType>()
  /** absolute paths whose reindex has not completed (never claimed fresh). */
  const inFlight = new Set<string>()
  /** lazily-opened raw handle for freshness checks + W2 probes. */
  let raw: CoreDatabase | null = null
  async function rawDb(): Promise<CoreDatabase> {
    if (!raw) raw = await BrainDatabase.getRawInstance(projectId)
    return raw
  }
  /** Returns null for directory events (per-file events are what matter). */
  function classify(abs: string): WatchChangeType | null {
    try {
      if (!statSync(abs).isFile()) return null
    } catch {
      return "deleted"
    }
    // Type only feeds reindexFilesParallel's deleted-vs-rest split; a file
    // without a row is "added" (label is cosmetic — both index the file).
    try {
      const row = raw?.prepare("SELECT 1 FROM brain_file WHERE project_id = ? AND path = ?").get(projectId, abs)
      return row ? "modified" : "added"
    } catch {
      return "modified"
    }
  }

  /** Run one reindex batch. Returns true when it fully landed. */
  async function flushOnce(changes: Array<{ path: string; type: WatchChangeType }>): Promise<boolean> {
    // P1: never interleave with another PROCESS's indexer — decline + retry.
    const holder = liveIndexLockHolder(projectId)
    if (holder) {
      declined++
      lastError = `declined: another indexer is active (pid ${holder.pid}, kind=${holder.kind}) — retrying`
      writeWatchRuntime(projectId, { running: true, lastError })
      log("watch: index lock held by another process — declining flush", { holder })
      return false
    }
    try {
      const res = await reindexFilesParallel(projectId as any, projectPath, changes, {
        // stdio-resident safety: indexer progress must never corrupt JSON-RPC
        // framing, so watcher-driven reindexes log to nowhere by default.
        logger: { log: () => {}, write: () => {} },
      })
      lastReindexAt = Date.now()
      writeWatchRuntime(projectId, { running: true, lastReindexAt, lastError: null })
      if (res.errors > 0) log("watch: reindex completed with errors", { ...res })
      return true
    } catch (error: any) {
      lastError = String(error?.message ?? error)
      log("watch: reindex failed — files stay in-flight (never claimed fresh)", { error: lastError })
      writeWatchRuntime(projectId, { running: false, lastError })
      return false
    }
  }

  async function retryBatch(changes: Array<{ path: string; type: WatchChangeType }>, attempts: number): Promise<void> {
    if (stopped || attempts >= WATCH_MAX_RETRIES) return
    await new Promise((r) => setTimeout(r, WATCH_RETRY_MS))
    if (stopped) return
    if (await flushOnce(changes)) return
    await retryBatch(changes, attempts + 1)
  }

  function settleInFlight(changes: Array<{ path: string; type: WatchChangeType }>): void {
    for (const c of changes) {
      // Only drop in-flight marks for files that are back on disk indexed; a
      // still-failing file keeps its honest in-flight marker.
      try {
        if (existsSync(c.path) && c.type !== "deleted") {
          const row = raw?.prepare("SELECT 1 FROM brain_file WHERE project_id = ? AND path = ?").get(projectId, c.path)
          if (row) inFlight.delete(c.path)
        } else if (c.type === "deleted") {
          inFlight.delete(c.path)
        }
      } catch {
        inFlight.delete(c.path)
      }
    }
  }

  function scheduleReindex(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (stopped || pending.size === 0) return
      const changes = Array.from(pending.entries()).map(([rel, type]) => ({ path: path.join(projectPath, rel), type }))
      pending.clear()
      for (const c of changes) inFlight.add(c.path)
      const run = async () => {
        if (await flushOnce(changes)) {
          settleInFlight(changes)
          return
        }
        await retryBatch(changes, 0)
        settleInFlight(changes)
      }
      reindexChain = reindexChain.then(run).catch(() => {})
    }, WATCH_DEBOUNCE_MS)
  }

  function onEvent(_event: string, filename: string | null): void {
    if (stopped) return
    if (!filename) {
      // Filename-less events (some platforms): scan instead of guessing.
      void startupScan("filename-less event")
      return
    }
    const abs = path.join(projectPath, filename)
    const rel = path.relative(projectPath, abs)
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") return
    const type = classify(abs)
    if (!type) return
    pending.set(rel, type)
    // Event-storm bound: beyond a pathological burst, coalesce into the
    // probe-driven scan instead of a giant single reindex call.
    if (pending.size > WATCH_STARTUP_CAP) {
      pending.clear()
      void startupScan("event storm")
      return
    }
    scheduleReindex()
  }

  /** Bounded startup/catch-up scan: rows vs disk + W2 new-file probes. */
  async function startupScan(reason: string): Promise<void> {
    if (stopped || startupState === "running") return
    startupState = "running"
    log("watch: startup/catch-up scan", { reason })
    try {
      const db = await rawDb()
      const rows = db.prepare("SELECT id, path FROM brain_file WHERE project_id = ?").all(projectId) as Array<{ id: string; path: string }>
      const changes: Array<{ path: string; type: WatchChangeType }> = []
      for (const row of rows) {
        let f = null
        try { f = checkFileFreshness(db, row.id) } catch { continue }
        if (!f) continue
        if (f.status === "stale") changes.push({ path: row.path, type: "modified" })
        else if (f.status === "missing") changes.push({ path: row.path, type: "deleted" })
      }
      // New files while the watcher was dead (W2 probes, capped — bounded).
      try {
        const { probeAddedFiles, probeAddedFilesSnapshot } = await import("./auto-refresh")
        const gitProbe = await probeAddedFiles(db, projectId, projectPath)
        const newFiles = gitProbe.available
          ? gitProbe.files
          : (await probeAddedFilesSnapshot(db, projectId, projectPath)).files
        for (const f of newFiles.slice(0, WATCH_STARTUP_CAP)) changes.push({ path: f, type: "added" })
      } catch {
        // Probes are best-effort at startup; the read-side repair remains.
      }
      if (changes.length > 0) {
        for (const c of changes) inFlight.add(c.path)
        let ok = await flushOnce(changes)
        if (!ok) {
          await retryBatch(changes, 0)
          ok = changes.every((c) => {
            try { return existsSync(c.path) && (raw?.prepare("SELECT 1 FROM brain_file WHERE project_id = ? AND path = ?").get(projectId, c.path)) !== undefined } catch { return true }
          })
        }
        settleInFlight(changes)
        if (!ok) lastError = "startup scan: some files could not be reindexed (read-side repair remains the backstop)"
      }
      startupState = "done"
      writeWatchRuntime(projectId, { running: true, watchingSince, lastError: lastError ?? null })
    } catch (error: any) {
      startupState = "failed"
      lastError = String(error?.message ?? error)
      writeWatchRuntime(projectId, { running: false, lastError })
      log("watch: startup scan failed", { error: lastError })
    }
  }

  const handle: ProjectWatcher = {
    start() {
      if (started || stopped) return
      started = true
      const intent = readWatchIntent(projectId)
      if (!opts.force && !intent?.desired) {
        log("watch: no watch-intent recorded — not starting (recorded at index time; use bb watch to force)")
        return
      }
      watchingSince = Date.now()
      writeWatchRuntime(projectId, { running: true, watchingSince, lastError: null })
      try {
        watcher = watch(projectPath, { persistent: false, recursive: true }, onEvent)
        watcher.on("error", (err) => {
          lastError = String(err)
          log("watch: watcher error — degrading to scan-on-read", { error: lastError })
          try { watcher?.close() } catch {}
          watcher = null
          writeWatchRuntime(projectId, { running: false, lastError })
        })
        log("watch: watching", { projectPath, debounceMs: WATCH_DEBOUNCE_MS })
      } catch (error: any) {
        lastError = String(error?.message ?? error)
        watcher = null
        writeWatchRuntime(projectId, { running: false, lastError })
        log("watch: fs.watch unavailable — scan-on-read remains the backstop", { error: lastError })
      }
      // Startup reconciliation (M24 guarantee): catch up what a dead watcher
      // missed. Non-blocking — reads before it lands are covered by the read
      // paths' own repair, so serving is never blocked on the scan.
      void startupScan("startup")
    },

    async stop() {
      stopped = true
      registry.delete(projectId)
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
      try { watcher?.close() } catch {}
      watcher = null
      await reindexChain.catch(() => {})
      writeWatchRuntime(projectId, { running: false, lastError: null })
    },

    status() {
      const intent = readWatchIntent(projectId)
      return {
        projectId,
        projectPath,
        desired: intent?.desired ?? false,
        running: started && !stopped && watcher !== null,
        watchingSince,
        pending: pending.size,
        inFlight: inFlight.size,
        startupScan: startupState,
        lastError,
        lastReindexAt,
        declined,
      }
    },

    async drain() {
      const settle = () => new Promise((r) => setTimeout(r, 60))
      await settle() // let the debounce/scan callbacks land after the write
      const deadline = Date.now() + WATCH_DEBOUNCE_MS * 4 + 2500 + WATCH_RETRY_MS * (WATCH_MAX_RETRIES + 1)
      while (Date.now() < deadline) {
        const busy = debounceTimer !== null || pending.size > 0 || inFlight.size > 0 || startupState === "running"
        if (!busy) {
          await settle()
          const still = debounceTimer !== null || pending.size > 0 || inFlight.size > 0 || startupState === "running"
          if (!still) break
        }
        if (debounceTimer) await new Promise((r) => setTimeout(r, Math.min(WATCH_DEBOUNCE_MS, 120)))
        await reindexChain.catch(() => {})
        await new Promise((r) => setTimeout(r, 30))
      }
      await reindexChain.catch(() => {})
    },
  }

  registry.set(projectId, handle)
  // Start immediately: `bb watch <dir>` and the MCP auto-start both want a
  // live watcher from this call (the intent guard inside start() declines
  // when no intent was recorded and no force was given). stop() removes it.
  handle.start()
  return handle
}

export async function stopProjectWatcher(projectId: string): Promise<void> {
  const w = registry.get(projectId)
  if (w) await w.stop()
}
