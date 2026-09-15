// script/lib/lock.ts — M61.V2 (issue #843): the ONE gate serialization lock.
//
// The defect this pins (audited at HEAD eec76d37): 34 evidence files are
// written by 2+ distinct gates, and the concurrent-run cascade that cost an
// afternoon was fixed procedurally ("run things sequentially"), not
// mechanically. Two gates writing one results dir at the same time could
// clobber each other's records, and nothing in the machinery noticed.
//
// The law (docs/m61/M61-MASTER-PLAN.md D-2):
//   declared lock:   one lock file per results dir (`.bb-gate.lock`). A gate
//                    that cannot take it waits a BOUNDED time, then refuses
//                    LOUDLY with the holder's identity — it never proceeds
//                    and never interleaves writes.
//   stale:           a lock whose holder process is dead, or whose age
//                    exceeds the declared threshold, is REPORTED as stale and
//                    refused — never silently stolen. Breaking a stale lock
//                    is a deliberate, declared owner action
//                    (BB_GATE_BREAK_STALE_LOCK=1) and is logged loudly.
//   reentrancy:      a lock already held by THIS process is re-entered
//                    (nested adoption — a gate that takes the dir lock around
//                    several writes). Sync fs makes same-process writes
//                    sequential by construction, so re-entry is safe; the
//                    file lock exists for OTHER processes.
//   integration:     writeSealed() takes the dir lock around its temp+rename,
//                    so every evidence write in the lane is serialized with
//                    no per-gate adoption burden (one write path, one lock).
//
// Import-time purity (the M55 lesson): this module runs NOTHING at import.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"
import os from "node:os"
import path from "node:path"

/** The lock file name inside a results dir (declared constant). */
export const LOCK_FILE = ".bb-gate.lock"

/** Declared bounded wait before a contended acquisition refuses. */
export const DEFAULT_WAIT_MS = 5_000

/** Declared age after which a held lock is reported stale (writes are
 *  millisecond-scale; a lock held for ten minutes means a hung process). */
export const DEFAULT_STALE_MS = 10 * 60 * 1000

/** The lock's recorded holder — the identity a refusal names. */
export interface LockHolder {
  pid: number
  host: string
  /** the gate that took it (declared by the caller; defaults to argv[1]) */
  gate: string
  token: string
  startedAt: string
  startedAtMs: number
}

export interface LockHandle {
  /** absolute path of the lock file */
  lockPath: string
  holder: LockHolder
  /** true when this acquisition deliberately broke a reported stale lock */
  brokeStale: boolean
  /** release; idempotent, and never deletes a lock this handle no longer owns */
  release: () => void
}

/** The refusal type — carries a machine-greppable reason. Every refusal is a
 *  thrown error so a gate fails LOUDLY rather than proceeding unlocked. */
export class GateLockError extends Error {
  readonly reason: string
  readonly lockPath: string
  readonly holder: LockHolder | null
  constructor(reason: string, lockPath: string, holder: LockHolder | null) {
    super(`M61 gate lock refused: ${reason} (${lockPath})`)
    this.name = "GateLockError"
    this.reason = reason
    this.lockPath = lockPath
    this.holder = holder
  }
}

export interface AcquireOptions {
  /** bounded wait in ms (default DEFAULT_WAIT_MS) */
  waitMs?: number
  /** stale age in ms (default DEFAULT_STALE_MS) */
  staleMs?: number
  /** the gate name recorded in the lock (default: process.argv[1] basename) */
  gate?: string
  /** injectable for deterministic tests */
  now?: () => number
}

/** A sync sleep that never touches the wall clock (a monotonic wait — this
 *  machine's wall clock has been observed to jump mid-run). */
function sleepSync(ms: number): void {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM means the process exists but we may not signal it.
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockHolder>
    if (typeof parsed.pid !== "number" || typeof parsed.token !== "string") return null
    return {
      pid: parsed.pid,
      host: typeof parsed.host === "string" ? parsed.host : "unknown",
      gate: typeof parsed.gate === "string" ? parsed.gate : "unknown",
      token: parsed.token,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown",
      startedAtMs: typeof parsed.startedAtMs === "number" ? parsed.startedAtMs : 0,
    }
  } catch {
    // An unreadable lock file is not a holder we can trust; treated as null so
    // the caller reports it as an unexplained lock rather than stealing it.
    return null
  }
}

function describe(holder: LockHolder | null): string {
  if (holder === null) return "an unreadable lock file (no holder identity recorded)"
  return `pid ${holder.pid} on ${holder.host} (gate ${holder.gate}, held since ${holder.startedAt})`
}

/** same-process re-entrancy: dir -> depth. */
const heldByThisProcess = new Map<string, { depth: number; handle: LockHandle }>()

export function isDirectlyHeld(resultsDir: string): boolean {
  return heldByThisProcess.has(path.resolve(resultsDir))
}

/** Take the declared lock for a results dir. Bounded wait, then a loud
 *  refusal; a stale lock is reported and refused (or deliberately broken when
 *  BB_GATE_BREAK_STALE_LOCK=1). Re-entered by the same process. */
export function acquireLock(resultsDir: string, opts: AcquireOptions = {}): LockHandle {
  const dir = path.resolve(resultsDir)
  const existing = heldByThisProcess.get(dir)
  if (existing) {
    // Same-process re-entry: the depth counter keeps the single file lock
    // alive until the outermost release.
    existing.depth++
    return {
      lockPath: existing.handle.lockPath,
      holder: existing.handle.holder,
      brokeStale: existing.handle.brokeStale,
      release: () => releaseHandle(dir),
    }
  }

  const lockPath = path.join(dir, LOCK_FILE)
  // The dir may not exist yet (first run of a fresh results dir).
  mkdirSync(dir, { recursive: true })
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const now = opts.now ?? (() => Date.now())
  const deadline = now() + waitMs

  for (;;) {
    // mkdir the dir so the lock file can be created (callers write evidence
    // into fresh dirs on first run).
    try {
      const fd = openSync(lockPath, "wx") // atomic create-exclusive
      const holder: LockHolder = {
        pid: process.pid,
        host: os.hostname(),
        gate: opts.gate ?? path.basename(process.argv[1] ?? "unknown"),
        token: `${process.pid}-${now()}-${Math.floor(Math.random() * 1e9).toString(36)}`,
        startedAt: new Date(now()).toISOString(),
        startedAtMs: now(),
      }
      writeSync(fd, `${JSON.stringify(holder, null, 2)}\n`)
      closeSync(fd)
      const handle: LockHandle = {
        lockPath,
        holder,
        brokeStale: false,
        release: () => releaseHandle(dir),
      }
      heldByThisProcess.set(dir, { depth: 1, handle })
      return handle
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
    }

    const holder = readHolder(lockPath)
    const ageMs = holder ? now() - holder.startedAtMs : 0
    const deadHolder = holder !== null && !pidAlive(holder.pid)
    const tooOld = holder !== null && ageMs > staleMs
    const stale = holder === null ? false : deadHolder || tooOld

    if (stale) {
      const why = deadHolder
        ? `stale lock: holder ${describe(holder)} is no longer running (age ${ageMs}ms)`
        : `stale lock: holder ${describe(holder)} has exceeded the declared stale age (${ageMs}ms > ${staleMs}ms)`
      if (process.env.BB_GATE_BREAK_STALE_LOCK === "1") {
        // Deliberate, declared owner action — logged loudly, never silent.
        console.error(`warn: BB_GATE_BREAK_STALE_LOCK=1 — breaking ${why}`)
        try {
          unlinkSync(lockPath)
        } catch {
          // another process may have broken it first; the retry below decides
        }
        const retaken = takeExclusive(lockPath, dir, opts, now)
        if (retaken) return { ...retaken, brokeStale: true }
        continue
      }
      throw new GateLockError(
        `${why} — refusing to proceed and refusing to steal it silently; ` +
          `remove ${lockPath} deliberately, or set BB_GATE_BREAK_STALE_LOCK=1 to break it`,
        lockPath,
        holder,
      )
    }

    if (now() >= deadline) {
      throw new GateLockError(
        `waited ${waitMs}ms for the lock and the holder is still running: ${describe(holder)}`,
        lockPath,
        holder,
      )
    }
    sleepSync(Math.min(25, Math.max(1, deadline - now())))
  }
}

function takeExclusive(
  lockPath: string,
  dir: string,
  opts: AcquireOptions,
  now: () => number,
): LockHandle | null {
  try {
    const fd = openSync(lockPath, "wx")
    const holder: LockHolder = {
      pid: process.pid,
      host: os.hostname(),
      gate: opts.gate ?? path.basename(process.argv[1] ?? "unknown"),
      token: `${process.pid}-${now()}-${Math.floor(Math.random() * 1e9).toString(36)}`,
      startedAt: new Date(now()).toISOString(),
      startedAtMs: now(),
    }
    writeSync(fd, `${JSON.stringify(holder, null, 2)}\n`)
    closeSync(fd)
    const handle: LockHandle = { lockPath, holder, brokeStale: false, release: () => releaseHandle(dir) }
    heldByThisProcess.set(dir, { depth: 1, handle })
    return handle
  } catch {
    return null
  }
}

function releaseHandle(dir: string): void {
  const entry = heldByThisProcess.get(dir)
  if (!entry) return
  entry.depth--
  if (entry.depth > 0) return
  heldByThisProcess.delete(dir)
  // Only delete a lock this process still owns (token match): a lock stolen
  // or broken by someone else must never be deleted by our release.
  const current = readHolder(entry.handle.lockPath)
  if (current === null || current.token !== entry.handle.holder.token) return
  try {
    unlinkSync(entry.handle.lockPath)
  } catch {
    // already gone — release stays idempotent
  }
}

/** Run `fn` holding the dir lock; the lock is released even when `fn` throws. */
export function withLock<T>(resultsDir: string, fn: () => T, opts: AcquireOptions = {}): T {
  const handle = acquireLock(resultsDir, opts)
  try {
    return fn()
  } finally {
    handle.release()
  }
}

/** Test/report helper: the declared lock file path for a results dir. */
export function lockPathFor(resultsDir: string): string {
  return path.join(path.resolve(resultsDir), LOCK_FILE)
}

/** Test/report helper: is a lock file present (regardless of staleness)? */
export function lockExists(resultsDir: string): boolean {
  return existsSync(lockPathFor(resultsDir))
}
