// src/ast/index-status.ts — M22.V2
// Cross-process, disk-backed view of an index run, and the RESUME CHECKPOINT
// that `bb index --resume` reads.
//
// Why a disk file for the LIVE part: an index run (and the Bus events that
// describe it) lives inside one process, but `bb status` is meant to run from a
// different shell/process. So the indexer writes a small JSON status file per
// project (~/.bb/status/<projectId>.json or $BB_DATA_DIR/status/...), keeping
// the newest sample, and `bb status` reads it. The LAST-RUN part comes from the
// durable brain_index_status.performance_stats (already persisted with
// per-phase timings incl. the co-dominant dbFlush line and worker count).
//
// ── The resume contract, stated precisely ──────────────────────────────────
//
// `bb index --resume` (src/cli/index.ts:225) reads THIS file, decides whether
// a checkpoint exists, and then ALWAYS runs the indexer in incremental mode.
// Three facts about that are load-bearing and were previously undocumented:
//
//   1. THE CHECKPOINT IS A PROGRESS REPORT, NOT A WORKLIST. It records
//      `processedFiles`/`totalFiles` COUNTS. It does not record WHICH files
//      completed, and nothing replays a list — because resume does not need
//      one. `isIncremental` re-discovers the corpus from disk and skips a file
//      whose mtime+size still match its stored row, so the skip set is derived
//      from the STORE, not from this file. That is why the counts here can be
//      wrong without corrupting a resume, and why a corrupt file here degrades
//      the MESSAGE ("checkpoint: 412/900 files done") rather than the WORK.
//
//   2. Therefore the durable part of a resume is SQLite, and this file is
//      disposable. A lost or unreadable checkpoint costs the user a sentence
//      of context; it never costs them a file. This is the property that makes
//      an abrupt `kill -9` survivable, and it is why the reads below report a
//      corrupt file as `corrupt` instead of pretending there was none.
//
//   3. BECAUSE IT IS DISPOSABLE IT MUST NEVER BE THE FAILURE MODE OF A WRITE.
//      The file used to be written with a bare `writeFileSync`, which creates
//      and fills in one step: a kill -9 in that window (or a full disk) left
//      half a JSON document, `JSON.parse` threw, the catch returned
//      `undefined`, and `--resume` announced "no in-progress checkpoint" for a
//      run that was plainly resumable. Writes are now temp-file + `rename`,
//      which is atomic on POSIX within a filesystem: a reader sees either the
//      whole previous checkpoint or the whole new one, never a splice.
//
// SCHEMA VERSIONING. `schemaVersion` is 2. A file without the field is v1 (the
// pre-versioned shape this module started with) and is read as such — the
// fields it does have are unchanged, so there is nothing to migrate. A file
// from a FUTURE version is refused (`foreign-schema`), not parsed: a newer
// writer may have given a field a meaning that does not hold here, and
// silently reading it would be the exact class of bug versioning exists to
// stop. Readers therefore accept {absent, 1, 2} and nothing else.
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { BrainDatabase } from "../brain/database"

/**
 * Current status-file schema. 2 = the versioned format introduced alongside the
 * atomic write. Files written before versioning carry no `schemaVersion` and
 * are read as v1.
 */
export const INDEX_STATUS_SCHEMA_VERSION = 2

/**
 * Every phase a run's status file is written with. Declared as a set of
 * literals because the writer is spread across three files (the indexer writes
 * `indexing`/`cancelled`/`complete`/`failed`, the registry copies a sample
 * across projects) and an undeclared phase was previously invisible to both
 * the compiler and the reader.
 *
 * Note what this list does NOT contain: there is no `"idle"` phase anywhere in
 * the product. A project that was never indexed has NO status file at all,
 * which is how "no run yet" is represented. A reader that looked for `"idle"`
 * would never find it.
 */
export const INDEX_RUN_PHASES = ["indexing", "post-processing", "complete", "failed", "cancelled"] as const
export type IndexRunPhase = (typeof INDEX_RUN_PHASES)[number]

/**
 * Phases a run can be RESUMED from. `cli/index.ts` hard-codes this set; it is
 * exported so the two cannot drift, and the reasons are load-bearing:
 *
 *   "indexing"  the process died mid-run (kill -9, power loss, OOM). This is
 *               the case with no graceful exit: the last tick wrote it and
 *               nothing overwrote it.
 *   "cancelled" the user pressed Ctrl+C and the indexer drained cooperatively
 *               and wrote this itself (parallel-indexer.ts, "a cancelled run
 *               writes its own terminal phase so --resume can distinguish
 *               'user stopped it on purpose' from 'process died'"). It is
 *               resumable on identical terms to "indexing" — both mean work
 *               remains — which is the contract that comment asserts and that
 *               the phase list here makes checkable.
 *
 * "complete"/"failed" are terminal; there is nothing to continue.
 */
export const RESUMABLE_PHASES: readonly string[] = ["indexing", "cancelled"]

/** Phases that mean a run is over. */
export const TERMINAL_PHASES: readonly string[] = ["complete", "failed", "cancelled"]

export interface LiveIndexStatus {
  /** Absent on files written before versioning (read as v1). */
  schemaVersion?: number
  /** Correlates every write of one run; absent on v1 files. */
  runId?: string
  projectId: string
  /**
   * One of INDEX_RUN_PHASES. Typed as `string` rather than the union because
   * this value comes off DISK: a file written by a different build can hold
   * anything, and casting it to a union would make the reader's unchecked
   * assumption invisible. Use `isRunPhase()` before relying on it.
   */
  phase: string
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

/**
 * How much of a checkpoint could actually be read. This distinction did not
 * exist before: every unreadable file returned `undefined`, which reads as
 * "there was no checkpoint", and that is how a half-written file became
 * indistinguishable from a project that was never interrupted.
 */
export type CheckpointIntegrity =
  | "ok" // parsed and schema-recognised
  | "missing" // no status file at all — the project has never run
  | "corrupt" // a file exists but is not a status document
  | "future-schema" // written by a newer bb; deliberately not interpreted
  | "incomplete" // parsed, but a field resume depends on is absent

export interface IndexCheckpoint {
  integrity: CheckpointIntegrity
  /** Present only when `integrity === "ok"`. */
  status?: LiveIndexStatus
  /** Human-readable explanation; present for every non-"ok" integrity. */
  problem?: string
  /** Absolute path of the file that was (or would be) read. */
  file: string
}

export interface ComposedIndexStatus {
  hasIndex: boolean
  live?: LiveIndexStatus
  lastRun?: LastRunStatus
  isRunning: boolean
  /** What `--resume` would do about this checkpoint, with the reason. */
  checkpoint: IndexCheckpoint
  dbStats: { files: number; symbols: number; relationships: number }
}

export function statusPath(projectId: string): string {
  return path.join(bbDataDir(), "status", `${projectId}.json`)
}

/** Temp path for the atomic write. Deterministic, so a kill leaks at most one. */
function statusTempPath(projectId: string): string {
  return `${statusPath(projectId)}.tmp`
}

/**
 * Replace the status file atomically: write a sibling temp file, then rename.
 *
 * `rename(2)` within a filesystem is atomic, so a concurrent reader — and the
 * indexer's own crash — observes either the entire previous status or the
 * entire new one. `writeFileSync` on the target does not: it truncates first,
 * so a crash mid-write publishes a partial document that no JSON parser will
 * accept and that `readLiveStatus` used to turn into "no run in progress".
 *
 * `fsync` covers a DIFFERENT threat — the machine losing power between the
 * rename and the data reaching the platter — and is off by default because
 * this is called on a 100ms progress tick (ParallelIndexerConfig
 * .progressUpdateMs) and an fsync can block for tens of milliseconds. Rename
 * alone already makes `kill -9` survivable, which is the case this file exists
 * for; `BB_STATUS_FSYNC=1` opts into power-loss durability.
 */
function writeStatusAtomically(projectId: string, contents: string): void {
  const target = statusPath(projectId)
  const tmp = statusTempPath(projectId)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(tmp, contents)
  if (process.env.BB_STATUS_FSYNC === "1") {
    try {
      const fd = openSync(tmp, "r")
      try { fsyncSync(fd) } finally { closeSync(fd) }
    } catch { /* durability is best-effort; never fail the indexer for it */ }
  }
  renameSync(tmp, target)
}

/** Called by the indexer on each progress tick (throttled) and at completion. */
export function writeLiveStatus(projectId: string, live: LiveIndexStatus): void {
  try {
    writeStatusAtomically(projectId, JSON.stringify({ ...live, schemaVersion: INDEX_STATUS_SCHEMA_VERSION, updatedAt: Date.now() }))
  } catch {
    // Observability must never crash the indexer.
  }
}

/**
 * Full read with an explicit verdict. Use this when the difference between "no
 * checkpoint" and "a checkpoint I could not read" matters — which is exactly
 * when resume must decide whether to tell the user something.
 */
export function readIndexCheckpoint(projectId: string): IndexCheckpoint {
  const file = statusPath(projectId)
  let raw: string
  try {
    if (!existsSync(file)) {
      return { integrity: "missing", file, problem: "no status file: this project has no recorded index run" }
    }
    raw = readFileSync(file, "utf8")
  } catch (e: any) {
    return { integrity: "corrupt", file, problem: `status file could not be read: ${e?.message ?? e}` }
  }

  if (raw.trim() === "") {
    return { integrity: "corrupt", file, problem: "status file is empty — a run was interrupted while writing it" }
  }

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e: any) {
    return { integrity: "corrupt", file, problem: `status file is not valid JSON (${e?.message ?? e}) — a run was interrupted while writing it` }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { integrity: "corrupt", file, problem: "status file is not a status document" }
  }

  // Absent schemaVersion == v1 == this module's original shape. Read it: every
  // field resume and `bb status` use means the same thing there. A HIGHER
  // version is refused rather than interpreted.
  const version = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1
  if (version > INDEX_STATUS_SCHEMA_VERSION) {
    return {
      integrity: "future-schema",
      file,
      problem: `status file schema v${version} is newer than this bb understands (v${INDEX_STATUS_SCHEMA_VERSION}); not interpreted`,
    }
  }

  if (typeof parsed.phase !== "string" || typeof parsed.updatedAt !== "number") {
    return { integrity: "incomplete", file, problem: "status file has no phase/update timestamp" }
  }

  const status: LiveIndexStatus = {
    ...parsed,
    schemaVersion: version,
    phase: parsed.phase,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : projectId,
    processedFiles: typeof parsed.processedFiles === "number" ? parsed.processedFiles : 0,
    totalFiles: typeof parsed.totalFiles === "number" ? parsed.totalFiles : 0,
    startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : parsed.updatedAt,
    updatedAt: parsed.updatedAt,
  }
  return { integrity: "ok", status, file }
}

/**
 * The checkpoint, or `undefined` when there is nothing usable to resume from.
 * Back-compatible shape for existing callers; `readIndexCheckpoint` is the
 * form that can tell a user WHY there is nothing to resume.
 */
export function readLiveStatus(projectId: string): LiveIndexStatus | undefined {
  const cp = readIndexCheckpoint(projectId)
  return cp.integrity === "ok" ? cp.status : undefined
}

/** Narrow an untrusted phase string to a phase this build declares. */
export function isRunPhase(phase: unknown): phase is IndexRunPhase {
  return typeof phase === "string" && (INDEX_RUN_PHASES as readonly string[]).includes(phase)
}

/** Would `--resume` act on this checkpoint, and why? */
export interface ResumeDecision {
  resumable: boolean
  reason: string
}

/**
 * The single place the resume contract is decided.
 *
 * `maxAgeMs` bounds how stale a checkpoint may be and still be called
 * resumable. The default is 1 hour, matching what `bb index --resume` has
 * always used. An EXPIRED checkpoint is not a failure: the corpus has almost
 * certainly moved since, and resume re-discovers from disk either way, so the
 * correct action is a plain incremental run — the counts in an hour-old
 * checkpoint would be describing a tree the user has since edited.
 */
export function decideResume(
  projectId: string,
  opts: { maxAgeMs?: number; now?: number } = {},
): ResumeDecision {
  const now = opts.now ?? Date.now()
  const maxAgeMs = opts.maxAgeMs ?? 3_600_000
  const cp = readIndexCheckpoint(projectId)

  if (cp.integrity === "missing") {
    return { resumable: false, reason: "no in-progress checkpoint; running incremental (only missing/changed files)" }
  }
  if (cp.integrity !== "ok" || !cp.status) {
    return {
      resumable: false,
      // Said plainly rather than as "no checkpoint": the file is there, and a
      // user who was told "none" cannot tell that from a project that was
      // never interrupted. The work is unaffected (resume is derived from the
      // store either way), but the report should not hide a damaged file.
      reason: `checkpoint unreadable (${cp.integrity}): ${cp.problem ?? "unknown problem"}; running incremental (only missing/changed files)`,
    }
  }
  const s = cp.status
  if (!RESUMABLE_PHASES.includes(s.phase)) {
    return { resumable: false, reason: `checkpoint phase is "${s.phase}", not resumable; running incremental (only missing/changed files)` }
  }
  const age = now - s.updatedAt
  if (age >= maxAgeMs) {
    return {
      resumable: false,
      reason: `checkpoint is ${Math.round(age / 60_000)} min old (> ${Math.round(maxAgeMs / 60_000)} min), so its counts describe a tree that has since moved; running incremental (only missing/changed files)`,
    }
  }
  return { resumable: true, reason: `resuming interrupted index (checkpoint: ${s.processedFiles}/${s.totalFiles} files done)` }
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
  const checkpoint = readIndexCheckpoint(projectId)
  const live = checkpoint.integrity === "ok" ? checkpoint.status : undefined
  const lastRun = await readLastRun(projectId)
  // A "cancelled" run is OVER — the indexer drained and wrote that phase on its
  // way out. It was not in this table before, so a cancelled checkpoint made
  // `bb status` report `isRunning: true` for the next 30 seconds after the run
  // had finished, which is the one phase a user is most likely to be looking
  // at when they ask whether something is still going.
  const isRunning =
    !!live && !TERMINAL_PHASES.includes(live.phase) && Date.now() - live.updatedAt < 30_000

  // M22.V3: dbStats used to be computed only when a live sample OR a last run
  // existed, and hardcoded to zeros otherwise. That made `hasIndex` false for a
  // project that IS fully indexed but has no status file and no performance
  // stats — after `clearStatus`, after adopting a DB, or after importing one.
  // `bb status` then told a user with a complete index that they had none.
  // The measurement is only skipped when the DB FILE is absent, so this never
  // creates a database as a side effect of asking about one.
  const dbFileExists = existsSync(BrainDatabase.getPath(projectId))
  const dbStats = (live || lastRun || dbFileExists)
    ? await (async () => {
      try {
        const { BrainDatabase: DB } = await import("../brain/database")
        const r = await DB.getRawInstance(projectId)
        const one = (sql: string) => (r.prepare(sql).get() as any)?.c ?? 0
        return { files: one("SELECT COUNT(*) c FROM brain_file"), symbols: one("SELECT COUNT(*) c FROM brain_symbol"), relationships: one("SELECT COUNT(*) c FROM brain_relationship") }
      } catch { return { files: 0, symbols: 0, relationships: 0 } }
    })()
    : { files: 0, symbols: 0, relationships: 0 }
  return { hasIndex: !!(live || lastRun) || dbStats.files > 0, live, lastRun, isRunning, checkpoint, dbStats }
}

export function clearStatus(projectId: string): void {
  // The temp file is removed too: `clearStatus` runs on project removal and on
  // registry moves, and a temp file left behind would be the only thing in the
  // status directory for a project that no longer exists.
  for (const p of [statusPath(projectId), statusTempPath(projectId)]) {
    try { if (existsSync(p)) rmSync(p) } catch { /* best effort */ }
  }
}
