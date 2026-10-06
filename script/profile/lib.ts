// script/profile/lib.ts — shared machinery for the index-time profiling scripts.
//
// WHY A SQL-LEVEL PROFILER. `runPostProcessing` already reports wall-clock per
// phase (`PostProcessingPhaseTiming[]`), which answers "which phase" but not
// "which statement inside it". Since this work may not edit
// src/ast/parallel-indexer.ts, the second level is obtained by wrapping
// `BrainDatabase.getRawInstance` — a static method on a plain class object, so
// it is writable — and timing every `prepare`/`exec`/`run`/`transaction` that
// passes through it. Nothing in the product is modified on disk.
//
// WHAT IT DOES NOT DO. It cannot attribute non-SQL time (JS loops, JSON
// serialisation in enrichment, tree-sitter parsing). The gap is reported
// explicitly as `unsqlMs` per phase rather than folded into the SQL numbers, so
// a phase that is 90% JavaScript cannot be mistaken for a slow query.

import { copyFileSync, existsSync, mkdirSync, rmSync, statfsSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/** sha1 project id, matching src/cli/index.ts getProjectId. */
export function projectIdFor(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  let canonical = resolved
  try {
    canonical = realpathSync.native(resolved)
  } catch {
    /* nonexistent paths keep lexical identity */
  }
  return createHash("sha1").update(canonical).digest("hex").substring(0, 40)
}

/** Free space on the volume holding `p`, in MiB. */
export function freeMiB(p: string): number {
  try {
    const s = statfsSync(p)
    return Math.floor((s.bavail * s.bsize) / 1024 / 1024)
  } catch {
    return Number.NaN
  }
}

/**
 * Copy a project's index into an ISOLATED data dir.
 *
 * Post-processing REWRITES rows (gravity on every symbol, enrichment metadata on
 * every relationship, ANALYZE repopulates sqlite_stat1), so profiling it in
 * place would mutate the user's real index. Every profiled run works on a copy.
 */
export function stageCorpus(srcProjectId: string, destDataDir: string): string {
  const srcDir = path.join(process.env.HOME!, ".bb", "projects", srcProjectId)
  const dstDir = path.join(destDataDir, "projects", srcProjectId)
  mkdirSync(dstDir, { recursive: true })
  for (const suffix of ["brain.db", "brain.db-wal", "brain.db-shm"]) {
    const from = path.join(srcDir, suffix)
    if (existsSync(from)) copyFileSync(from, path.join(dstDir, suffix))
  }
  return dstDir
}

export function rmrf(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

// ─── SQL profiler ───────────────────────────────────────────────────────────

export interface StmtStat {
  /** One verbatim statement, whitespace-normalised, kept as the group key. */
  sql: string
  /** Verbatim, trimmed, for printing. */
  sample: string
  calls: number
  ms: number
  rows: number
}

export interface SqlProfile {
  /** Wall-clock of the whole instrumented region. */
  wallMs: number
  /** Time attributable to a timed SQL call. */
  sqlMs: number
  /** wallMs - sqlMs: JavaScript, file I/O, child-process waits. */
  unsqlMs: number
  stmts: StmtStat[]
  /** Every timed call, with its offset from profile start, for window attribution. */
  events: SqlEvent[]
}

export interface SqlEvent {
  /** Milliseconds since `markStart()`. */
  at: number
  ms: number
  sql: string
  rows: number
}

export function newProfile(): SqlProfile {
  return { wallMs: 0, sqlMs: 0, unsqlMs: 0, stmts: [], events: [] }
}

/** Collapse whitespace so the same statement shape aggregates into one row. */
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim()
}

/**
 * Wrap a CoreDatabase so every statement is timed.
 *
 * Statement identity is the NORMALISED SQL, so the same statement issued once
 * per page (enrichment issues its page SELECT 32 times over 630k rows) collapses
 * into one row carrying its true aggregate cost. Aggregating by SQL text is safe
 * here because these queries are built from constants and `?` placeholders, not
 * interpolated literals — except the two resolution UPDATEs that interpolate
 * the projectId, and those differ by project, not within a run.
 */
export interface Instrumented {
  /** The proxy to hand to callers as the CoreDatabase. */
  db: any
  /** Freeze the per-statement rollup. Call after the instrumented region. */
  finish(): SqlProfile
  /** Offset every subsequent event's `at` is measured from. */
  markStart(): void
}

export function instrument(raw: any, acc: SqlProfile): Instrumented {
  const byKey = new Map<string, StmtStat>()
  let origin = process.hrtime.bigint()
  const sinceOriginMs = () => Number(process.hrtime.bigint() - origin) / 1e6

  const bump = (sql: string, ms: number, rows: number, at: number) => {
    const key = normalizeSql(sql)
    let s = byKey.get(key)
    if (!s) {
      s = { sql: key, sample: sql.replace(/\s+/g, " ").trim().slice(0, 300), calls: 0, ms: 0, rows: 0 }
      byKey.set(key, s)
    }
    s.calls++
    s.ms += ms
    s.rows += rows
    acc.sqlMs += ms
    // Skip zero-time bookkeeping entries so the event list stays about real work.
    if (ms >= 0.05) acc.events.push({ at, ms, sql: key, rows })
  }

  const wrapStatement = (sql: string, stmt: any): any => ({
    get: (...p: unknown[]) => {
      const at = sinceOriginMs()
      const t = process.hrtime.bigint()
      const r = stmt.get(...(p as never[]))
      bump(sql, Number(process.hrtime.bigint() - t) / 1e6, 1, at)
      return r
    },
    all: (...p: unknown[]) => {
      const at = sinceOriginMs()
      const t = process.hrtime.bigint()
      const r = stmt.all(...(p as never[])) as unknown[]
      bump(sql, Number(process.hrtime.bigint() - t) / 1e6, Array.isArray(r) ? r.length : 0, at)
      return r
    },
    run: (...p: unknown[]) => {
      const at = sinceOriginMs()
      const t = process.hrtime.bigint()
      const r = stmt.run(...(p as never[]))
      bump(sql, Number(process.hrtime.bigint() - t) / 1e6, Number((r as any)?.changes ?? 0), at)
      return r
    },
  })

  const db = new Proxy(raw, {
    get(t, prop) {
      if (prop === "prepare") return (sql: string) => wrapStatement(sql, (t as any).prepare(sql))
      if (prop === "exec") {
        return (sql: string) => {
          const at = sinceOriginMs()
          const started = process.hrtime.bigint()
          ;(t as any).exec(sql)
          bump(sql, Number(process.hrtime.bigint() - started) / 1e6, 0, at)
        }
      }
      if (prop === "run") {
        return (sql: string, ...p: unknown[]) => {
          const at = sinceOriginMs()
          const started = process.hrtime.bigint()
          const r = (t as any).run(sql, ...p)
          bump(sql, Number(process.hrtime.bigint() - started) / 1e6, Number((r as any)?.changes ?? 0), at)
          return r
        }
      }
      if (prop === "transaction") {
        return (fn: (...a: any[]) => any) => {
          const wrapped = (t as any).transaction(fn)
          return (...args: any[]) => {
            // The body's own statements are timed individually, so this entry
            // records COMMIT time (fsync of the WAL) only — timing the whole
            // body as well would double-count every UPDATE inside it.
            const at = sinceOriginMs()
            const started = process.hrtime.bigint()
            const r = wrapped(...args)
            bump("<transaction COMMIT>", Number(process.hrtime.bigint() - started) / 1e6, 0, at)
            return r
          }
        }
      }
      const v = (t as any)[prop]
      return typeof v === "function" ? v.bind(t) : v
    },
  })

  return {
    db,
    markStart: () => { origin = process.hrtime.bigint(); acc.events.length = 0; acc.sqlMs = 0 },
    finish: () => {
      acc.stmts = [...byKey.values()].sort((a, b) => b.ms - a.ms)
      return acc
    },
  }
}

// ─── phase attribution ──────────────────────────────────────────────────────

/**
 * Reconstruct absolute phase windows from the phase timings plus the logger
 * lines `runPostProcessing` emits as it ENTERS each phase.
 *
 * The phases run sequentially, and the function logs a recognisable line on
 * entry to four of them:
 *
 *   "  Resolving cross-file relationships..."            -> relationships
 *   "  Enriching relationships with architectural..."    -> enrichment
 *   "  Computing gravity scores..."                      -> gravity
 *   "  Analyzing taint flows & security..."              -> taint
 *
 * `integrity`, `health` and `vectorBlobs` have no entry line, so their windows
 * are derived by walking the phases in declared order and continuing from
 * where the previous one ended. That is exact for every phase after the last
 * anchored one, and depends on "no other work happens between phases" for the
 * two unanchored phases before it.
 *
 * The reconstruction is only USED when the phase ms account for the measured
 * wall-clock to within `driftTolerance`; otherwise it is reported as unreliable
 * rather than quietly presented as measured.
 */
export interface PhaseWindow {
  name: string
  startMs: number
  endMs: number
  ms: number
  /** True when the start came from an explicit log line rather than by continuation. */
  anchored: boolean
}

const START_LOG: Array<[RegExp, string]> = [
  [/Resolving cross-file relationships/, "relationships"],
  [/Enriching relationships with architectural/, "enrichment"],
  [/Computing gravity scores/, "gravity"],
  [/Analyzing taint flows & security/, "taint"],
]

export function reconstructWindows(
  phases: Array<{ name: string; ms: number }>,
  logEvents: Array<{ at: number; text: string }>,
  runStart: number,
  runEnd: number,
  driftTolerance = 0.02,
): { windows: PhaseWindow[]; reliable: boolean; drift: number } {
  const total = runEnd - runStart
  const sum = phases.reduce((a, p) => a + p.ms, 0)
  const drift = sum > 0 ? Math.abs(total - sum) / sum : 1

  const anchors = new Map<string, number>()
  for (const e of logEvents) {
    for (const [re, name] of START_LOG) {
      if (!anchors.has(name) && re.test(e.text)) anchors.set(name, e.at - runStart)
    }
  }

  const windows: PhaseWindow[] = []
  let cursor = 0
  for (const p of phases) {
    const anchored = anchors.has(p.name)
    const start = anchored
      ? Math.max(cursor, Math.min(anchors.get(p.name)!, total))
      : cursor
    const end = Math.min(total, start + p.ms)
    windows.push({ name: p.name, startMs: start, endMs: end, ms: end - start, anchored })
    cursor = end
  }
  return { windows, reliable: drift < driftTolerance, drift }
}

/** Sum SQL time whose start falls inside a window. */
export function sqlMsInWindow(events: SqlEvent[], w: PhaseWindow): number {
  let ms = 0
  for (const e of events) if (e.at >= w.startMs && e.at < w.endMs) ms += e.ms
  return ms
}