// src/lsp/freshness.ts — M24.P2 (blood-tested foundation #1).
//
// Freshness for the LSP surface: the server reads a persisted index while the
// user edits files. This component owns the watch → debounce → incremental
// reindex loop and the machine-readable stale marker for every response
// (IDE Honesty Contract §4).
//
// Declared guarantees (gated by script/m24/verify-freshness.ts):
//   debounce:     file events are debounced 300 ms before reindex starts
//   catch-up:     after a debounced burst settles, reindex completes before
//                 the affected files are reported fresh again
//   event loss:   a full freshness scan (mtime+size fast path, hash fallback)
//                 runs on startup and can be forced at any time — the watcher
//                 is an optimization, never the sole correctness mechanism
//   stale truth:  a result whose file is stale carries a machine-readable
//                 marker; a stale result shown without a marker is a defect
//                 of the same severity as a wrong result
//
// This component is self-contained for M24: it composes the existing
// freshness + indexer primitives; it does not touch M14/M20/M21 code.

import { watch, statSync, existsSync, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { checkFileFreshness, type FileFreshness } from "../brain/freshness"
import type { CoreDatabase } from "../brain/database"

/** Declared debounce window (ms) before a debounced reindex starts. */
export const DEBOUNCE_MS = 300

export type StaleMarker = {
  /** machine-readable; the UI must render this visibly, never silently */
  stale: boolean
  status: "fresh" | "stale" | "missing" | "unknown"
  /** true when the watcher saw the change but the reindex has not landed yet */
  pendingReindex: boolean
  /** ISO timestamp of the last completed reindex covering this file, if any */
  lastReindexAt?: string
}

export interface FreshnessMonitor {
  /** start watching the workspace root (idempotent) */
  start(): void
  /** stop watching and flush pending timers */
  stop(): Promise<void>
  /**
   * Machine-readable marker for a file id. Never throws: unknown files report
   * status "unknown" with stale=true (we cannot claim freshness for a file we
   * cannot check — silence is guilt).
   */
  marker(fileId: string): Promise<StaleMarker>
  /** force a full freshness scan now (event-loss recovery path) */
  fullScan(): Promise<{ checked: number; stale: number; missing: number }>
  /** files the watcher saw change since the last completed reindex */
  pendingFiles(): string[]
  /** wait until no reindex is pending (test/drain helper) */
  drain(): Promise<void>
}

export interface FreshnessMonitorDeps {
  projectId: string
  projectPath: string
  /** raw brain.db handle for freshness checks */
  raw: CoreDatabase
  /** file ids indexed by absolute path (from brain_file) */
  fileIdForPath(path: string): string | null
  /** incremental reindex primitive (existing parallel-indexer) */
  reindex(changes: Array<{ path: string; type: "modified" | "deleted" }>): Promise<{ indexed: number; deleted: number; errors: number }>
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

export function createFreshnessMonitor(deps: FreshnessMonitorDeps): FreshnessMonitor {
  const { projectId, projectPath, raw } = deps
  const log = deps.log ?? (() => {})

  let watcher: FSWatcher | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let reindexInFlight: Promise<void> = Promise.resolve()
  let stopped = false

  /** path -> change type, awaiting the debounce window */
  const pending = new Map<string, "modified" | "deleted">()
  /** path -> ISO timestamp of last completed reindex */
  const lastReindex = new Map<string, string>()
  /** paths seen changed but whose reindex has not completed */
  const inFlight = new Set<string>()

  function fileIdFor(path: string): string | null {
    return deps.fileIdForPath(path)
  }

  function scheduleReindex(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (pending.size === 0) return
      const changes = Array.from(pending.entries()).map(([p, type]) => ({ path: p, type }))
      pending.clear()
      for (const c of changes) inFlight.add(c.path)
      log("freshness: reindex starting", { count: changes.length })
      reindexInFlight = (async () => {
        try {
          await reindexInFlight
        } catch {}
        try {
          const res = await deps.reindex(changes)
          const at = new Date().toISOString()
          for (const c of changes) {
            inFlight.delete(c.path)
            lastReindex.set(c.path, at)
          }
          log("freshness: reindex completed", { ...res })
        } catch (error) {
          // Reindex failure must not silently mark files fresh: keep them
          // in-flight so markers keep reporting pendingReindex=true.
          log("freshness: reindex failed", { error: String(error) })
        }
      })()
    }, DEBOUNCE_MS)
  }

  function onWatchEvent(path: string): void {
    if (stopped) return
    let type: "modified" | "deleted"
    try {
      type = existsSync(path) ? "modified" : "deleted"
    } catch {
      type = "deleted"
    }
    pending.set(path, type)
    scheduleReindex()
  }

  return {
    start() {
      if (watcher || stopped) return
      try {
        watcher = watch(projectPath, { persistent: false, recursive: true }, (_event, filename) => {
          if (!filename) {
            // Filename-less events (some platforms): force a scan instead of
            // guessing which file changed.
            void this.fullScan()
            return
          }
          onWatchEvent(join(projectPath, filename))
        })
        watcher.on("error", (err) => {
          log("freshness: watcher error, falling back to scan-on-read", { error: String(err) })
          // Watcher failure degrades to the scan path, never to silent staleness.
          try { watcher?.close() } catch {}
          watcher = null
        })
        log("freshness: watching", { projectPath, debounceMs: DEBOUNCE_MS })
      } catch (error) {
        log("freshness: watch unavailable, falling back to scan-on-read", { error: String(error) })
        watcher = null
      }
    },

    async stop() {
      stopped = true
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
      try { watcher?.close() } catch {}
      watcher = null
      await reindexInFlight.catch(() => {})
    },

    async marker(fileId: string): Promise<StaleMarker> {
      // Fast path: if the watcher already knows this file reindexed, we can
      // still verify against disk (the index is the claim; disk is the truth).
      let f: FileFreshness | null = null
      try {
        f = checkFileFreshness(raw, fileId)
      } catch {}
      const path = f?.path
      const pendingReindex = path ? inFlight.has(path) || pending.has(path) : false
      const status: StaleMarker["status"] = f ? f.status : "unknown"
      return {
        // unknown counts as stale: we cannot claim freshness for a file we
        // cannot check. Silence is guilt (contract §4.3).
        stale: status !== "fresh" || pendingReindex,
        status,
        pendingReindex,
        lastReindexAt: path ? lastReindex.get(path) : undefined,
      }
    },

    async fullScan() {
      const rows = raw
        .prepare("SELECT id, path FROM brain_file")
        .all() as Array<{ id: string; path: string }>
      let stale = 0
      let missing = 0
      const changes: Array<{ path: string; type: "modified" | "deleted" }> = []
      for (const row of rows) {
        const f = checkFileFreshness(raw, row.id)
        if (!f) continue
        if (f.status === "stale") { stale++; changes.push({ path: row.path, type: "modified" }) }
        if (f.status === "missing") { missing++; changes.push({ path: row.path, type: "deleted" }) }
      }
      if (changes.length > 0) {
        for (const c of changes) inFlight.add(c.path)
        const res = await deps.reindex(changes)
        const at = new Date().toISOString()
        for (const c of changes) {
          inFlight.delete(c.path)
          lastReindex.set(c.path, at)
        }
        log("freshness: full scan reindex", { ...res })
      }
      return { checked: rows.length, stale, missing }
    },

    pendingFiles() {
      return Array.from(new Set([...pending.keys(), ...inFlight]))
    },

    async drain() {
      // Wait for any pending debounce to fire and the reindex to land.
      // The watcher callback is asynchronous relative to the write syscall:
      // give it one tick + a short grace period to land before deciding the
      // queue is empty, otherwise drain() can exit before the event arrives.
      // Bounded: a failed reindex keeps files inFlight by design (markers must
      // stay stale), so drain() would spin forever on them. After one full
      // settle round with no progress, accept the stuck-but-honest state.
      const settle = () => new Promise((r) => setTimeout(r, 50))
      await settle()
      // Bounded total wait: a failed reindex keeps files inFlight by design
      // (markers must stay stale), so the queue may never empty. Wait long
      // enough for the debounce + one reindex round, then accept the
      // stuck-but-honest state instead of spinning forever.
      const deadline = Date.now() + DEBOUNCE_MS * 4 + 2000
      while (Date.now() < deadline && (debounceTimer || pending.size > 0 || inFlight.size > 0)) {
        if (debounceTimer) await new Promise((r) => setTimeout(r, Math.min(DEBOUNCE_MS, 100)))
        await reindexInFlight.catch(() => {})
        if (pending.size === 0 && inFlight.size === 0 && !debounceTimer) {
          await settle()
          if (pending.size === 0 && inFlight.size === 0 && !debounceTimer) break
        }
        await new Promise((r) => setTimeout(r, 25))
      }
      await reindexInFlight.catch(() => {})
    },
  }
}
