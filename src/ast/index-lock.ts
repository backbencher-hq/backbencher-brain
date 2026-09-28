// src/ast/index-lock.ts — M43.P1 (#656)
// Single-flight index lock, per project.
//
// WHY: before this module nothing prevented two index runs from racing on one
// project DB — `bb index` in two terminals, or a CLI run racing an MCP
// refresh, could interleave worker-pool writes. Two serialization layers:
//
//   1. IN-PROCESS (same process): a module-level promise queue per projectId.
//      Concurrent callers in one process (bb_health refresh queue, concurrent
//      library calls, the m11 lifecycle's Promise.all probe) SERIALIZE — each
//      waits for the previous holder, matching the health-refresh precedent.
//      This is required because SQLite WAL + busy_timeout only arbitrate
//      individual statements, not multi-batch index runs.
//
//   2. CROSS-PROCESS: an O_EXCL lockfile next to the project DB
//      (`<bbProjectsDir>/<projectId>/.index.lock`) holding { pid, startedAt,
//      kind }. A second PROCESS is REFUSED with `IndexLockHeldError` naming
//      the holder — never silently interleaved. A lock whose holder pid is
//      dead locally (crash, power loss, SIGKILL) is reclaimed automatically
//      on the next acquire; the pid check is local-only, which is correct
//      because the DB (and therefore the lock) is per-machine under the
//      BB_DATA_DIR.
//
// The lock is scoped to the project DB directory (per machine), never to a
// source checkout: one project can be indexed from several checkouts of the
// same path only through the same project id.

import { writeFileSync, readFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs"
import { hostname } from "node:os"
import path from "node:path"
import { bbProjectsDir } from "../util/bb-data-dir"

export interface IndexLockHandle {
  projectId: string
  kind: string
  pid: number
  startedAt: number
  /** Remove the lockfile only if it still names THIS holder (never another's). */
  release(): Promise<void>
}

export interface LockHolderInfo {
  pid: number | null
  startedAt: number | null
  kind: string
}

/** Thrown when another LIVE process holds the project's index lock. */
export class IndexLockHeldError extends Error {
  readonly holder: LockHolderInfo
  readonly projectId: string
  readonly lockPath: string
  constructor(projectId: string, lockPath: string, holder: LockHolderInfo) {
    const started = holder.startedAt
      ? `, started ${new Date(holder.startedAt).toISOString()}`
      : ""
    super(
      `another index run is already active for this project (pid ${holder.pid ?? "unknown"}${started}, kind=${holder.kind ?? "index"}); ` +
      `wait for it to finish, or if it crashed the stale lock at ${path.basename(lockPath)} is reclaimed automatically on the next run`,
    )
    this.projectId = projectId
    this.lockPath = lockPath
    this.holder = holder
    this.name = "IndexLockHeldError"
  }
}

export function indexLockPath(projectId: string): string {
  return path.join(bbProjectsDir(), projectId, ".index.lock")
}

/**
 * Read-only probe: who (if anyone) currently holds the project's index lock?
 * Returns holder info when a lockfile exists AND names a live local process.
 * Returns null when there is no lock or the holder is dead (reclaimable).
 * Used by destructive paths (project removal) that must not run mid-index.
 */
export function liveIndexLockHolder(projectId: string): LockHolderInfo | null {
  const lockPath = indexLockPath(projectId)
  try {
    if (!existsSync(lockPath)) return null
    const holder = parseHolder(readFileSync(lockPath, "utf8"))
    if (holder.pid === null) return null // corrupt/foreign file — not ours to judge
    return pidIsAliveLocally(holder.pid) ? holder : null
  } catch {
    return null
  }
}

// In-process serialization: a chain of "previous holder finished" promises,
// so same-process callers queue (they must never be refused — the m11
// lifecycle gate runs two concurrent indexers on one project and both must
// complete).
const inProcessQueues = new Map<string, Promise<void>>()

function pidIsAliveLocally(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  // /proc/<pid>/stat state: 'Z' (zombie) / 'X' (dead) mean the process has
  // exited but is not yet reaped. Such a process can never hold the lock
  // again, so treat it as dead — kill(pid, 0) reports zombies as alive,
  // which would wedge stale-lock reclaim forever after a holder crash.
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3)
    if (state === "Z" || state === "X") return false
    return true
  } catch {
    // No /proc (non-Linux) or pid already gone entirely — fall through.
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    // ESRCH = no such process (dead/reclaimed); EPERM = exists, not ours (alive).
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

function parseHolder(content: string | undefined): LockHolderInfo {
  if (!content) return { pid: null, startedAt: null, kind: "index" }
  try {
    const parsed = JSON.parse(content) as { pid?: unknown; startedAt?: unknown; kind?: unknown }
    return {
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
      kind: typeof parsed.kind === "string" ? parsed.kind : "index",
    }
  } catch {
    return { pid: null, startedAt: null, kind: "index" }
  }
}

/**
 * Acquire the project index lock.
 *
 * @param waitMs how long (ms) to poll a lockfile held by a LIVE process before
 *   refusing. Default 0 = refuse immediately with the holder named.
 * @throws IndexLockHeldError when another live process holds the lock past
 *   the wait window.
 */
export async function acquireIndexLock(
  projectId: string,
  opts: { kind?: string; waitMs?: number; pollIntervalMs?: number } = {},
): Promise<IndexLockHandle> {
  const kind = opts.kind ?? "index"
  const waitMs = opts.waitMs ?? 0
  const pollIntervalMs = opts.pollIntervalMs ?? 150
  const lockPath = indexLockPath(projectId)

  // ── 1. In-process queue: same-process indexers serialize, never refuse. ──
  // Each caller awaits the previous tail and publishes its own; `done` runs
  // EXACTLY ONCE (release or failed acquire), so a refused caller can never
  // strand later same-process waiters.
  const prev = inProcessQueues.get(projectId) ?? Promise.resolve()
  let done!: () => void
  const tail = new Promise<void>((resolve) => { done = resolve })
  inProcessQueues.set(projectId, tail)
  await prev

  let released = false
  const finish = () => { if (!released) { released = true; done() } }

  // M43.A8 quarantine rule: a test seam may exist, but only behind
  // BB_TEST_HOOKS=1 (a stray env var in production must change nothing).
  const testHooksEnabled = process.env.BB_TEST_HOOKS === "1"
  const lockDisabledForTest = testHooksEnabled && process.env.BB_TEST_INDEX_LOCK_OFF === "1"

  const holder: IndexLockHandle = {
    projectId,
    kind,
    pid: process.pid,
    startedAt: Date.now(),
    release: async () => {
      try {
        // Only remove OUR lockfile. If a newer holder replaced it (stale
        // reclaim raced us), their file survives untouched.
        if (existsSync(lockPath)) {
          const current = parseHolder(readFileSync(lockPath, "utf8"))
          if (current.pid === process.pid) unlinkSync(lockPath)
        }
      } catch { /* file already gone — fine */ }
      finish()
    },
  }

  try {
    if (lockDisabledForTest) return holder // mutation seam: no file lock
    const payload = JSON.stringify({ pid: process.pid, startedAt: holder.startedAt, kind })
    const deadline = waitMs > 0 ? Date.now() + waitMs : 0
    for (;;) {
      try {
        mkdirSync(path.dirname(lockPath), { recursive: true })
        writeFileSync(lockPath, payload, { flag: "wx" })
        return holder
      } catch (e: any) {
        if (e?.code !== "EEXIST") throw e
        // Held by someone: stale (dead holder) → reclaim; live → wait/refuse.
        const current = parseHolder(existsSync(lockPath) ? readFileSync(lockPath, "utf8") : undefined)
        if (current.pid !== null && !pidIsAliveLocally(current.pid)) {
          try { unlinkSync(lockPath) } catch { /* raced another reclaim */ }
          continue // retry immediately with the stale file gone
        }
        if (deadline === 0) throw new IndexLockHeldError(projectId, lockPath, current)
        if (Date.now() >= deadline) throw new IndexLockHeldError(projectId, lockPath, current)
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
    }
  } catch (err) {
    // Never leave the in-process queue blocked by a failed acquire.
    finish()
    throw err
  }
}
