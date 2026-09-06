// src/ast/watch-state.ts — M44.W3.1 (#673)
// Durable per-project watch intent + watcher state.
//
// WHY a separate disk file (not a brain.db row): the intent must outlive any
// single process AND any re-index of the project — a user indexes once and
// every later resident session (MCP server) must honor it without the user
// asking again. The index DB is wiped/rebuilt by design; the CLI-side state
// dir is not. Pattern follows index-status.ts (bbDataDir()/status/...) and
// index-lock.ts (.index.lock): cross-process, per-machine, JSON file.
//
// The intent is written by the indexer at every completed run (full, no-op
// and incremental — see parallel-indexer completion hooks) and read by any
// resident session at startup. The live half (is the watcher actually running
// in THIS process) lives in the file-watcher registry; this module persists
// only the durable intent and the last-known state for `bb watch --status`.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"

export interface WatchIntent {
  projectId: string
  /** the checkout root the index was recorded for (server context root). */
  projectPath: string
  /** durable user intent: a resident session should watch this project. */
  desired: boolean
  /** when the intent was (re)recorded by the indexer. */
  recordedAt: number
}

export interface WatchRuntimeState {
  /** last time a resident watcher started (or null = never in this session). */
  watchingSince: number | null
  /** last watcher error message, if the loop degraded. */
  lastError: string | null
  /** last completed reindex count, if any. */
  lastReindexAt: number | null
  /** true when the watcher believes it is live in some process. */
  running: boolean
  updatedAt: number
}

export function watchStatePath(projectId: string): string {
  return path.join(bbDataDir(), "watch", `${projectId}.json`)
}

function readState(projectId: string): { intent?: WatchIntent; runtime?: WatchRuntimeState } {
  try {
    const p = watchStatePath(projectId)
    if (!existsSync(p)) return {}
    const parsed = JSON.parse(readFileSync(p, "utf8")) as { intent?: WatchIntent; runtime?: WatchRuntimeState }
    return parsed ?? {}
  } catch {
    return {}
  }
}

/** Indexer completion hook: record durable watch intent for this project. */
export function recordWatchIntent(projectId: string, projectPath: string): void {
  try {
    const p = watchStatePath(projectId)
    mkdirSync(path.dirname(p), { recursive: true })
    const prev = readState(projectId)
    const next: { intent: WatchIntent; runtime?: WatchRuntimeState } = {
      intent: { projectId, projectPath, desired: true, recordedAt: Date.now() },
      ...(prev.runtime ? { runtime: prev.runtime } : {}),
    }
    writeFileSync(p, JSON.stringify(next, null, 2))
  } catch {
    // Observability/metadata must never crash the indexer.
  }
}

/** Read the durable intent (undefined when never indexed or never desired). */
export function readWatchIntent(projectId: string): WatchIntent | undefined {
  return readState(projectId).intent
}

/** Update the runtime half (called by the file-watcher on start/stop/error). */
export function writeWatchRuntime(projectId: string, runtime: Partial<WatchRuntimeState>): void {
  try {
    const p = watchStatePath(projectId)
    mkdirSync(path.dirname(p), { recursive: true })
    const prev = readState(projectId)
    const merged: { intent?: WatchIntent; runtime: WatchRuntimeState } = {
      ...(prev.intent ? { intent: prev.intent } : {}),
      runtime: {
        watchingSince: null,
        lastError: null,
        lastReindexAt: null,
        running: false,
        ...(prev.runtime ?? {}),
        ...runtime,
        updatedAt: Date.now(),
      },
    }
    writeFileSync(p, JSON.stringify(merged, null, 2))
  } catch {
    // never crash the watcher on a state write failure
  }
}

/** Full state for `bb watch --status` / status composition. */
export function readWatchState(projectId: string): { intent?: WatchIntent; runtime?: WatchRuntimeState } {
  return readState(projectId)
}

/** CLI/status control: clear the durable intent for a project. */
export function clearWatchIntent(projectId: string): void {
  try {
    const p = watchStatePath(projectId)
    if (existsSync(p)) rmSync(p, { force: true })
  } catch {
    // best effort
  }
}
