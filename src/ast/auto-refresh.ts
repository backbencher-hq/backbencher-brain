// src/ast/auto-refresh.ts — M43.A1/A2 (#657/#658)
// Shared inline auto-refresh for read paths.
//
// WHY: before this module, a read tool that detected stale/missing indexed
// files (M35) could only SAY so — the FRESHNESS_REMEDIATION footer named the
// manual repair command but nothing ever DID it. A user who edits with their
// own editor (not bb_edit) got stale answers until someone ran
// `bb index --changed` by hand.
//
// This module closes that last mile INLINE and BOUNDED: when a read path finds
// stale files within budget, it repairs exactly those files with
// reindexFilesParallel (the M40.A3-proven mechanism: deletion writes +
// re-parse + bounded derived pass) BEFORE the handler answers, and the answer
// declares "auto-refreshed N files in Xms". When the repair is not within
// budget — too many files, too many bytes, disabled, or another indexer
// active under the P1 lock — it declines HONESTLY with the reason, and the
// read answers from existing data with the staleness envelope (never silently
// stale, never blocking on another indexer).
//
// Budget: counts only files the read actually touched (the rows it resolved),
// so cost scales with the answer, never the project. Env-tunable:
//   BB_NO_AUTO_REFRESH=1          opt out entirely (also per-call opt-out)
//   BB_AUTO_REFRESH_MAX_FILES=N   default 25 stale+missing files
//   BB_AUTO_REFRESH_MAX_BYTES=N   default 2 MiB of modified-file bytes
import { statSync } from "node:fs"
import type { CoreDatabase } from "../brain/database"
import { reindexFilesParallel } from "./parallel-indexer"
import { liveIndexLockHolder, IndexLockHeldError } from "./index-lock"

export interface AutoRefreshFile {
  /** Absolute path as stored in brain_file.path. */
  absolutePath: string
  /** stale (hash differs) => modified; missing (file gone) => deleted. */
  type: "modified" | "deleted"
}

export type AutoRefreshDecision =
  | { action: "refreshed"; files: number; deleted: number; errors: number; tookMs: number; derivedPass?: string }
  | { action: "clean" }
  | {
      action: "declined"
      reason: "disabled" | "no-index" | "budget-files" | "budget-bytes" | "indexer-active" | "error"
      detail: string
    }

/** Documented defaults — the honest small bounds for an inline repair. */
export const AUTO_REFRESH_DEFAULTS = { maxFiles: 25, maxBytes: 2 * 1024 * 1024 }

/**
 * M43.A3 (#659) whitelist: every environment variable this module reads.
 * The A3 gate parses the module's actual process.env reads and asserts they
 * equal this allowlist — a new env knob cannot land without being declared
 * (and documented) here.
 */
export const AUTO_REFRESH_ENV_ALLOWLIST = ["BB_NO_AUTO_REFRESH", "BB_AUTO_REFRESH_MAX_FILES", "BB_AUTO_REFRESH_MAX_BYTES"] as const

export function autoRefreshEnabled(perCallOptOut: boolean | undefined): boolean {
  if (perCallOptOut === true) return false
  if (process.env.BB_NO_AUTO_REFRESH === "1") return false
  return true
}

export function autoRefreshBudget(): { maxFiles: number; maxBytes: number } {
  const n = Number(process.env.BB_AUTO_REFRESH_MAX_FILES)
  const b = Number(process.env.BB_AUTO_REFRESH_MAX_BYTES)
  return {
    maxFiles: Number.isInteger(n) && n >= 1 ? n : AUTO_REFRESH_DEFAULTS.maxFiles,
    maxBytes: Number.isFinite(b) && b >= 1 ? b : AUTO_REFRESH_DEFAULTS.maxBytes,
  }
}

/**
 * Build the auto-refresh file set from the rows a read path just resolved.
 * `rows` and `statuses` are the same pair passed to/returned from
 * resolveRowsFreshnessDetailed. Only confidently-mappable files are included:
 *  - fileId keys -> resolved to brain_file.path (one chunked query).
 *  - filePath keys are used AS-IS when absolute (the resolver keyed them by
 *    brain_file.path, which is absolute). A relative/unknown key that the
 *    resolver could not map contributes to the staleness envelope but is not
 *    auto-refreshable — it stays honestly flagged in the answer.
 * Cost is O(unique stale rows), never O(project).
 */
export function collectStaleFiles(
  raw: CoreDatabase,
  rows: Array<{ fileId?: string | null; filePath?: string | null }>,
  statuses: Map<string, string>,
): AutoRefreshFile[] {
  const staleIds = [...new Set(rows.filter((r) => r.fileId && statuses.get(r.fileId) !== "fresh").map((r) => r.fileId as string))]
  const pathById = new Map<string, string>()
  for (let i = 0; i < staleIds.length; i += 500) {
    const slice = staleIds.slice(i, i + 500)
    for (const r of raw
      .prepare(`SELECT id, path FROM brain_file WHERE id IN (${slice.map(() => "?").join(",")})`)
      .all(...slice) as Array<{ id: string; path: string }>) {
      pathById.set(r.id, r.path)
    }
  }
  const out: AutoRefreshFile[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const key = r.fileId ?? r.filePath ?? ""
    const status = statuses.get(key)
    if (!key || !status || status === "fresh") continue
    let abs: string | undefined
    if (r.fileId) abs = pathById.get(r.fileId)
    else if (r.filePath && r.filePath.startsWith("/")) abs = r.filePath
    if (!abs || seen.has(abs)) continue
    seen.add(abs)
    out.push({ absolutePath: abs, type: status === "missing" ? "deleted" : "modified" })
  }
  return out
}

/**
 * Decide and, when within budget, perform the inline repair.
 * NEVER blocks: if another indexer holds the P1 lock (live lockfile holder),
 * declines "indexer-active" immediately; reindexFilesParallel's own acquire
 * refuses instantly (waitMs 0), so a lock that appears between probe and
 * acquire also declines instead of waiting.
 */
export async function maybeAutoRefresh(
  projectId: string,
  projectPath: string,
  files: AutoRefreshFile[],
  opts: { perCallOptOut?: boolean } = {},
): Promise<AutoRefreshDecision> {
  const modified = files.filter((f) => f.type === "modified")
  const deleted = files.filter((f) => f.type === "deleted")
  if (modified.length + deleted.length === 0) return { action: "clean" }
  if (!autoRefreshEnabled(opts.perCallOptOut)) {
    return { action: "declined", reason: "disabled", detail: "auto-refresh disabled (BB_NO_AUTO_REFRESH or refresh=false)" }
  }
  const { maxFiles, maxBytes } = autoRefreshBudget()
  const total = modified.length + deleted.length
  if (total > maxFiles) {
    return {
      action: "declined",
      reason: "budget-files",
      detail: `auto-refresh declined: ${total} stale/missing files exceeds the ${maxFiles}-file budget (BB_AUTO_REFRESH_MAX_FILES)`,
    }
  }
  // Byte budget over the files that still exist on disk (deleted files count
  // toward the file budget; their bytes are gone). Never more stats than the
  // file budget allows.
  let bytes = 0
  for (const f of modified) {
    try {
      bytes += statSync(f.absolutePath).size
    } catch {
      /* vanished between resolution and decision — the reindex treats a gone
         file as a delete; its bytes are zero, not a budget charge */
    }
  }
  if (bytes > maxBytes) {
    return {
      action: "declined",
      reason: "budget-bytes",
      detail: `auto-refresh declined: ${bytes} bytes of modified files exceeds the ${maxBytes}-byte budget (BB_AUTO_REFRESH_MAX_BYTES)`,
    }
  }
  // P1 non-blocking: another LIVE indexer -> honest decline, answer stays
  // declared-stale. (A same-process indexer holds the lockfile too.)
  const holder = liveIndexLockHolder(projectId)
  if (holder) {
    return {
      action: "declined",
      reason: "indexer-active",
      detail: `auto-refresh declined: another index run is active (pid ${holder.pid}, kind=${holder.kind}); answering from existing data with the staleness envelope`,
    }
  }
  const t0 = performance.now()
  try {
    const r = await reindexFilesParallel(projectId as any, projectPath, files.map((f) => ({ path: f.absolutePath, type: f.type })))
    return {
      action: "refreshed",
      files: r.indexed,
      deleted: r.deleted,
      errors: r.errors,
      tookMs: Math.round(performance.now() - t0),
      derivedPass: r.derived?.pass,
    }
  } catch (e: any) {
    if (e instanceof IndexLockHeldError) {
      return {
        action: "declined",
        reason: "indexer-active",
        detail: `auto-refresh declined: another index run is active (pid ${e.holder.pid}); answering from existing data with the staleness envelope`,
      }
    }
    // Any other failure: decline honestly rather than mask it as refreshed.
    return {
      action: "declined",
      reason: "error",
      detail: `auto-refresh failed: ${String(e?.message ?? e).slice(0, 200)}; answering from existing data with the staleness envelope`,
    }
  }
}

/** Render the decision for an answer envelope / text footer. */
export function autoRefreshLine(decision: AutoRefreshDecision): string {
  if (decision.action === "refreshed") {
    return `auto-refreshed ${decision.files} file${decision.files === 1 ? "" : "s"}${decision.deleted ? `, removed ${decision.deleted} deleted` : ""} in ${decision.tookMs}ms${decision.derivedPass ? ` (derived pass: ${decision.derivedPass})` : ""}`
  }
  if (decision.action === "declined") return decision.detail
  return ""
}
