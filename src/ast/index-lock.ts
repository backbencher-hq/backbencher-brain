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
//      (`<bbProjectsDir>/<projectId>/.index.lock`) holding { schemaVersion,
//      pid, host, token, startedAt, kind }. A second PROCESS is REFUSED with
//      `IndexLockHeldError` naming the holder — never silently interleaved.
//      A lock whose holder pid is dead locally (crash, power loss, SIGKILL) is
//      reclaimed automatically on the next acquire; the pid check is
//      host-scoped, so a lock written by a DIFFERENT machine on a shared
//      BB_DATA_DIR is never judged by a pid that means nothing here.
//
// The lock is scoped to the project DB directory (per machine), never to a
// source checkout: one project can be indexed from several checkouts of the
// same path only through the same project id.

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  linkSync,
  statSync,
  readdirSync,
} from "node:fs"
import { hostname } from "node:os"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { bbProjectsDir } from "../util/bb-data-dir"

/**
 * Lock payload schema version. Bumped from the pre-versioned lockfile (which
 * had no version field and is read as v0) when the payload gained `host` and
 * `token`. Readers accept v0 and v1; a HIGHER version is refused, not
 * guessed at — a future writer may have added a field whose absence here would
 * mean something different.
 */
export const INDEX_LOCK_SCHEMA_VERSION = 1

export interface IndexLockHandle {
  projectId: string
  kind: string
  pid: number
  startedAt: number
  /** Unique per acquire; `release()` matches on this, never on pid alone. */
  token: string
  /** Remove the lockfile only if it still names THIS holder (never another's). */
  release(): Promise<void>
}

export interface LockHolderInfo {
  pid: number | null
  startedAt: number | null
  kind: string
  /** Host that wrote the lockfile. `null` for a pre-versioned (v0) file. */
  host: string | null
  /** Writer's per-acquire token. `null` for a v0 file. */
  token: string | null
  /** Payload version: 0 = pre-versioned file, 1 = current. */
  version: number
}

/**
 * Why a lockfile was reclaimed. Kept for the message a user sees, so the
 * refusal text can say what was actually done instead of asserting a general
 * policy that does not hold for every case.
 */
export type StaleReason =
  | "holder-dead" // same host, pid confirmed gone
  | "holder-zombie" // same host, pid is a reaped-pending zombie
  | "unreadable-payload" // no readable pid at all, and older than the grace window
  | "foreign-host-expired" // written by another host and older than the expiry
  | "future-schema" // written by a newer bb; reclaimed only after the expiry

/** Thrown when another LIVE process holds the project's index lock. */
export class IndexLockHeldError extends Error {
  readonly holder: LockHolderInfo
  readonly projectId: string
  readonly lockPath: string
  /** Set when the file on disk names no process we can judge. */
  readonly unexplained: boolean
  constructor(projectId: string, lockPath: string, holder: LockHolderInfo) {
    const started = holder.startedAt
      ? `, started ${new Date(holder.startedAt).toISOString()}`
      : ""
    const host = holder.host ? ` on host ${holder.host}` : ""
    const name = holder.pid !== null ? `pid ${holder.pid}` : "no readable pid"
    // The wording is per-case, because the blanket claim this used to make —
    // "the stale lock is reclaimed automatically on the next run" — was false
    // for exactly the case a user is most likely to hit: a lockfile whose
    // payload cannot be parsed (a 0-byte file from a kill between create and
    // write, or a full disk). Such a file named no live process, so the
    // liveness branch was skipped and the refusal was issued forever.
    const remedy =
      holder.pid === null
        ? `the lock file names no process, so nothing can be proven to be running. Remove it by hand: rm ${lockPath}`
        : holder.host && holder.host !== hostname()
          ? `it was written on host ${holder.host}, where pid ${holder.pid} means nothing here, so it is reclaimed only after ${Math.round(crossHostExpiryMs() / 3_600_000)}h. If that run is gone, remove it by hand: rm ${lockPath}`
          : "wait for it to finish, or if it crashed the stale lock is reclaimed automatically on the next run"
    super(
      `another index run is already active for this project (${name}${host}${started}, kind=${holder.kind ?? "index"}); ${remedy}`,
    )
    this.projectId = projectId
    this.lockPath = lockPath
    this.holder = holder
    this.unexplained = holder.pid === null
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
    if (holder.pid === null) return null // no pid to judge — not ours to call live
    if (holder.host && holder.host !== hostname()) return null // pid is meaningless here
    return pidIsAliveLocally(holder.pid) ? holder : null
  } catch {
    return null
  }
}

/**
 * A lockfile whose payload cannot be read is reclaimed only after it has been
 * unchanged for this long. The window exists because a creator can be between
 * "file exists" and "payload written" — with the atomic create below our own
 * writer never exposes that state, but a lockfile from an older bb, a full
 * disk, or a SIGKILL during an older build can be on disk in exactly it. After
 * the grace window no live holder can still be mid-write, because a write that
 * long unfinished either completed or lost its process.
 */
function unreadableGraceMs(): number {
  const raw = Number(process.env.BB_INDEX_LOCK_GRACE_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 10_000
}

/** How long a lock from ANOTHER host is honoured before we reclaim it. */
function crossHostExpiryMs(): number {
  const raw = Number(process.env.BB_INDEX_LOCK_CROSS_HOST_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 3_600_000
}

function fileAgeMs(lockPath: string, now: number): number {
  try {
    return Math.max(0, now - statSync(lockPath).mtimeMs)
  } catch {
    return Number.POSITIVE_INFINITY
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
  if (!content || content.trim() === "") {
    return { pid: null, startedAt: null, kind: "index", host: null, token: null, version: 0 }
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return {
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
      kind: typeof parsed.kind === "string" ? parsed.kind : "index",
      // A pre-versioned file has no host. Treating "absent" as local keeps
      // every lock written before this change reclaimable by pid exactly as
      // it was; only an EXPLICIT foreign host is treated as foreign.
      host: typeof parsed.host === "string" && parsed.host !== "" ? parsed.host : null,
      token: typeof parsed.token === "string" && parsed.token !== "" ? parsed.token : null,
      version: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
    }
  } catch {
    return { pid: null, startedAt: null, kind: "index", host: null, token: null, version: 0 }
  }
}

/**
 * Classify an existing lockfile: is its holder alive (so we must wait/refuse),
 * or is the file reclaimable now?
 */
function classify(lockPath: string, holder: LockHolderInfo, now: number): { stale: StaleReason | null } {
  // A payload from a NEWER bb may carry a field whose absence would mean
  // something different here. Never reclaim it on a guess; it ages out.
  if (holder.version > INDEX_LOCK_SCHEMA_VERSION) {
    const age = fileAgeMs(lockPath, now)
    return { stale: age >= crossHostExpiryMs() ? "future-schema" : null }
  }
  if (holder.pid === null) {
    // THE WEDGE THIS REPLACES. A payload with no readable pid named no
    // process, so the liveness branch below could never fire and the file
    // survived every acquire attempt — `bb index` refused forever on a
    // project whose data directory held one stray byte. Reclaim it once it is
    // old enough that no creator can still be mid-write.
    const age = fileAgeMs(lockPath, now)
    return { stale: age >= unreadableGraceMs() ? "unreadable-payload" : null }
  }
  if (holder.host && holder.host !== hostname()) {
    // pid is a LOCAL number. Judging a remote pid against this machine's
    // process table produces both false refusals (a pid that exists here for
    // an unrelated process) and false reclaims (stomping a live remote run).
    const age = fileAgeMs(lockPath, now)
    return { stale: age >= crossHostExpiryMs() ? "foreign-host-expired" : null }
  }
  if (!pidIsAliveLocally(holder.pid)) return { stale: "holder-dead" }
  return { stale: null }
}

/**
 * Acquire the project index lock.
 *
 * The lockfile is created ATOMICALLY and EXCLUSIVELY: the payload is written
 * to a sibling temp file and then hard-linked into place, so a reader never
 * observes a lockfile that exists but whose pid has not landed yet. The
 * previous `writeFileSync(lockPath, payload, {flag:"wx"})` created the file
 * first and filled it second, so a kill -9 (or a full disk) in that window
 * left a 0-byte `.index.lock` — which the reader parsed as "no pid", which the
 * reclaim skipped, and which refused every future index of that project
 * forever. `link()` keeps the O_EXCL semantics that made this a lock at all.
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
  //
  // MEASURED HAZARD, bounded below. The queue is unbounded: if the holder never
  // calls `release()` — a caller that forgets, or an early `return` between
  // acquire and release — every later same-process acquire for that project
  // waits forever, with no error and no timeout, and the process appears to
  // hang on an index that holds nothing. So when the caller states a tolerance
  // (`waitMs > 0`), the in-process wait is bounded by it too and then refuses
  // with the same error, naming the same-process holder. The DEFAULT (waitMs
  // absent/0) keeps the "queue, never refuse" contract the m11 lifecycle gate
  // depends on, so no existing caller changes behaviour.
  const prev = inProcessQueues.get(projectId) ?? Promise.resolve()
  let done!: () => void
  const tail = new Promise<void>((resolve) => { done = resolve })
  inProcessQueues.set(projectId, tail)
  if (waitMs > 0 && prev !== undefined) {
    let timedOut = false
    await Promise.race([prev, new Promise<void>((r) => setTimeout(() => { timedOut = true; r() }, waitMs))])
    if (timedOut) {
      done()
      throw new IndexLockHeldError(projectId, lockPath, {
        pid: process.pid, startedAt: null, kind,
        host: hostname(), token: null, version: INDEX_LOCK_SCHEMA_VERSION,
      })
    }
  } else {
    await prev
  }

  let released = false
  const finish = () => { if (!released) { released = true; done() } }

  // M43.A8 quarantine rule: a test seam may exist, but only behind
  // BB_TEST_HOOKS=1 (a stray env var in production must change nothing).
  const testHooksEnabled = process.env.BB_TEST_HOOKS === "1"
  const lockDisabledForTest = testHooksEnabled && process.env.BB_TEST_INDEX_LOCK_OFF === "1"

  const token = randomUUID()
  const holder: IndexLockHandle = {
    projectId,
    kind,
    pid: process.pid,
    startedAt: Date.now(),
    token,
    release: async () => {
      try {
        // Remove ONLY our own lock, matched on the token. Matching on pid was
        // enough only while pid implied uniqueness: after a stale reclaim
        // replaced the file, the OLD handle's release() saw a pid equal to its
        // own (same process re-acquired) and deleted the NEW holder's lock,
        // silently dropping mutual exclusion. The token is per-acquire, so it
        // cannot match.
        if (existsSync(lockPath)) {
          const current = parseHolder(readFileSync(lockPath, "utf8"))
          if (current.token !== null && current.token === token) unlinkSync(lockPath)
          else if (current.token === null && current.pid === process.pid) unlinkSync(lockPath)
        }
      } catch { /* file already gone — fine */ }
      finish()
    },
  }

  try {
    if (lockDisabledForTest) return holder // mutation seam: no file lock
    const payload = JSON.stringify({
      schemaVersion: INDEX_LOCK_SCHEMA_VERSION,
      pid: process.pid,
      host: hostname(),
      token,
      startedAt: holder.startedAt,
      kind,
    })
    const deadline = waitMs > 0 ? Date.now() + waitMs : 0
    for (;;) {
      try {
        mkdirSync(path.dirname(lockPath), { recursive: true })
        createLockfileExclusive(lockPath, payload)
        return holder
      } catch (e: any) {
        if (e?.code !== "EEXIST") throw e
        // Held by someone: stale (dead holder) → reclaim; live → wait/refuse.
        const now = Date.now()
        const current = parseHolder(existsSync(lockPath) ? readFileSync(lockPath, "utf8") : undefined)
        const { stale } = classify(lockPath, current, now)
        if (stale) {
          try { unlinkSync(lockPath) } catch { /* raced another reclaim */ }
          sweepLockTemps(lockPath, now)
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

/**
 * Create `lockPath` holding `payload`, atomically and exclusively.
 *
 * `link()` is the primitive that gives both properties at once: the temp file
 * is already complete when it is linked, and `link` fails with EEXIST if the
 * destination exists, which is the O_EXCL guarantee the lock depends on. A
 * `rename` would have been atomic but NOT exclusive — it would silently
 * overwrite a live holder's lock, which is precisely the bug this module
 * exists to prevent.
 *
 * Falls back to the classic `wx` create where hard links are unsupported; on
 * that path the lockfile can again be observed empty, and `classify` reclaims
 * it once the grace window passes.
 */
function createLockfileExclusive(lockPath: string, payload: string): void {
  const tmp = `${lockPath}.${process.pid}.${randomUUID().slice(0, 12)}.tmp`
  // The temp name carries a fresh uuid, so this write cannot lose a race and
  // MUST NOT be exclusive: an EEXIST from here would be indistinguishable from
  // a held lock, and the caller's contention branch would then poll a lockfile
  // that does not exist and refuse a project nobody was using. The one EEXIST
  // that escapes this function comes from `link`, which is the real test.
  writeFileSync(tmp, payload)
  try {
    try {
      linkSync(tmp, lockPath)
    } catch (e: any) {
      // CONTENDED — the caller must see this. Swallowing it here (an earlier
      // draft of this function did, because the `catch` only handled the
      // no-hard-link case and then fell through) makes the WHOLE LOCK A NO-OP:
      // `createLockfileExclusive` returns normally, `acquireIndexLock` returns
      // a handle it does not hold, and every process walks straight past a live
      // holder. A lock that cannot refuse is worse than no lock, because it is
      // reported as held.
      if (e?.code === "EEXIST") throw e
      // No hard-link support on this filesystem (some network mounts). Fall
      // back to the create-exclusive write the module started with; that path
      // can also throw EEXIST, and for the same reason it must propagate.
      writeFileSync(lockPath, payload, { flag: "wx" })
    }
  } finally {
    try { unlinkSync(tmp) } catch { /* already gone */ }
  }
}

/**
 * Drop temp files an interrupted create left behind. Only called on the rare
 * reclaim path, because a readdir per progress tick is not affordable; a kill
 * between writing the temp file and linking it leaves one ~200 byte file that
 * nothing ever reads.
 */
function sweepLockTemps(lockPath: string, now: number): void {
  const dir = path.dirname(lockPath)
  let names: string[]
  try { names = readdirSync(dir) } catch { return }
  const base = path.basename(lockPath)
  for (const name of names) {
    if (!name.startsWith(`${base}.`) || !name.endsWith(".tmp")) continue
    const full = path.join(dir, name)
    try { if (now - statSync(full).mtimeMs > 3_600_000) unlinkSync(full) } catch { /* raced */ }
  }
}