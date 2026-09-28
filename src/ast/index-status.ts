// src/ast/index-status.ts — M22.V2
// Cross-process, disk-backed view of an index run.
//
// Why a disk file for the LIVE part: an index run (and the Bus events that
// describe it) lives inside one process, but `bb status` is meant to run from a
// different shell/process. So the indexer writes a small JSON status file per
// project (~/.bb/status/<projectId>.json or $BB_DATA_DIR/status/...), keeping
// the newest sample, and `bb status` reads it. The LAST-RUN part comes from the
// durable brain_index_status.performance_stats (already persisted with
// per-phase timings incl. the co-dominant dbFlush line and worker count).
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { BrainDatabase } from "../brain/database"

export interface LiveIndexStatus {
  projectId: string
  phase: string // "indexing" (during parse) | "post-processing" | "complete" | "failed"
  processedFiles: number
  totalFiles: number
  filesPerSecond?: number
  currentFile?: string
  workerCount?: number
  startedAt: number
  updatedAt: number
  error?: string
}

export interface LastRunStatus {
  mode?: string
  phaseTimings?: Record<string, number>
  workerCount?: number
  counts?: Record<string, number>
  totalWallMs?: number
  postProcessing?: Array<{ phase?: string; ms?: number }>
  generatedAt?: number
  noop?: boolean
}

export interface ComposedIndexStatus {
  hasIndex: boolean
  live?: LiveIndexStatus
  lastRun?: LastRunStatus
  isRunning: boolean
  dbStats: { files: number; symbols: number; relationships: number }
}

export function statusPath(projectId: string): string {
  return path.join(bbDataDir(), "status", `${projectId}.json`)
}

/** Called by the indexer on each progress tick (throttled) and at completion. */
export function writeLiveStatus(projectId: string, live: LiveIndexStatus): void {
  try {
    const p = statusPath(projectId)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify({ ...live, updatedAt: Date.now() }))
  } catch {
    // Observability must never crash the indexer.
  }
}

export function readLiveStatus(projectId: string): LiveIndexStatus | undefined {
  try {
    const p = statusPath(projectId)
    if (!existsSync(p)) return undefined
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return undefined
  }
}

/** Last-run data from the durable performance_stats (already persisted). */
export async function readLastRun(projectId: string): Promise<LastRunStatus | undefined> {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const row = raw.prepare("SELECT performance_stats FROM brain_index_status WHERE project_id = ?").get(projectId) as
      | { performance_stats: string | null }
      | undefined
    const perf = row?.performance_stats ? JSON.parse(String(row.performance_stats)) : null
    if (!perf || !Array.isArray(perf.runs) || perf.runs.length === 0) return undefined
    const r = perf.runs[perf.runs.length - 1]
    if (!r || typeof r !== "object") return undefined
    return {
      mode: r.mode,
      phaseTimings: r.phases ?? undefined,
      workerCount: r.counts?.workerCount ?? undefined,
      counts: r.counts ?? undefined,
      totalWallMs: r.phases?.totalWallMs ?? undefined,
      postProcessing: r.postProcessingPhases ?? undefined,
      generatedAt: r.generatedAt ?? undefined,
      noop: r.noop ?? undefined,
    }
  } catch {
    return undefined
  }
}

export async function composeStatus(projectId: string): Promise<ComposedIndexStatus> {
  const [live, lastRun] = [readLiveStatus(projectId), await readLastRun(projectId)]
  const isRunning = !!live && live.phase !== "complete" && live.phase !== "failed" && Date.now() - live.updatedAt < 30_000
  const dbStats =
    live || lastRun ? await (async () => {
      try {
        const { BrainDatabase: DB } = await import("../brain/database")
        const r = await DB.getRawInstance(projectId)
        const one = (sql: string) => (r.prepare(sql).get() as any)?.c ?? 0
        return { files: one("SELECT COUNT(*) c FROM brain_file"), symbols: one("SELECT COUNT(*) c FROM brain_symbol"), relationships: one("SELECT COUNT(*) c FROM brain_relationship") }
      } catch { return { files: 0, symbols: 0, relationships: 0 } }
    })() : { files: 0, symbols: 0, relationships: 0 }
  return { hasIndex: !!(live || lastRun) || dbStats.files > 0, live, lastRun, isRunning, dbStats }
}

export function clearStatus(projectId: string): void {
  try { const p = statusPath(projectId); if (existsSync(p)) rmSync(p) } catch {}
}