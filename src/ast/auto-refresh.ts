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
import { statSync, readFileSync } from "node:fs"
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

export interface ReadRepairOutcome {
  /** The decision: clean (nothing stale), refreshed (repaired), or declined (with reason). */
  decision: AutoRefreshDecision
  /** The files the read resolved as stale/missing (empty when clean). */
  staleFiles: AutoRefreshFile[]
}

/**
 * M44.W1.1 shared read-repair entry: every row-resolving read handler calls
 * ONE helper — collect the stale files its resolved rows touched, then decide
 * within budget (or decline honestly). The handler reruns its pass when
 * `decision.action === "refreshed"` so the answer reflects the repair, and
 * appends `autoRefreshLine(decision)` on any non-clean outcome. No per-tool
 * forks: bb_search's M43 inline path and every tool wired under W1.1 share
 * this exact code.
 */
export async function repairRead(
  raw: CoreDatabase,
  projectId: string,
  projectPath: string,
  rows: Array<{ fileId?: string | null; filePath?: string | null }>,
  statuses: Map<string, string>,
  opts: { perCallOptOut?: boolean } = {},
): Promise<ReadRepairOutcome> {
  const staleFiles = collectStaleFiles(raw, rows, statuses)
  if (staleFiles.length === 0) return { decision: { action: "clean" }, staleFiles }
  const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, opts)
  return { decision, staleFiles }
}

/**
 * Render the decision for an answer envelope / text footer.
 * M44.W1.2 (#670): every rendered line ends with the SAME machine-readable
 * reason code ([refresh:refreshed] | [refresh:declined:<reason>]) so a CLI
 * or text consumer can machine-check why a read did or did not repair — no
 * free-text parsing, identical vocabulary on every read tool.
 */
export function autoRefreshLine(decision: AutoRefreshDecision): string {
  if (decision.action === "refreshed") {
    return `auto-refreshed ${decision.files} file${decision.files === 1 ? "" : "s"}${decision.deleted ? `, removed ${decision.deleted} deleted` : ""} in ${decision.tookMs}ms${decision.derivedPass ? ` (derived pass: ${decision.derivedPass})` : ""} [refresh:refreshed]`
  }
  if (decision.action === "declined") return `${decision.detail} [refresh:declined:${decision.reason}]`
  return ""
}

// ══ M44.W1.2 (#670): one machine-readable refresh/decline wire shape ════════
// Every read tool carries the SAME structured block on non-clean outcomes
// (`autoRefresh` keeps the human text; `refresh` is its structured sibling)
// so an agent can machine-check action + reason + counters without parsing
// prose. `reason` is exactly AutoRefreshDecision's decline vocabulary:
// disabled | no-index | budget-files | budget-bytes | indexer-active | error.
export interface RefreshReport {
  action: "refreshed" | "declined"
  reason: string | null
  detail: string
  files: number | null
  deleted: number | null
  errors: number | null
  tookMs: number | null
  derivedPass: string | null
}

/** Build the shared machine-readable block from a decision (non-clean only). */
export function refreshReport(decision: AutoRefreshDecision): RefreshReport | null {
  if (decision.action === "clean") return null
  if (decision.action === "refreshed") {
    return {
      action: "refreshed",
      reason: null,
      detail: autoRefreshLine(decision),
      files: decision.files,
      deleted: decision.deleted,
      errors: decision.errors,
      tookMs: decision.tookMs,
      derivedPass: decision.derivedPass ?? null,
    }
  }
  return {
    action: "declined",
    reason: decision.reason,
    detail: decision.detail,
    files: null,
    deleted: null,
    errors: null,
    tookMs: null,
    derivedPass: null,
  }
}

// ══ M44.W2.1 (#671): added-file probe (git worktree layer) ══════════════════
// A read can only repair files that have index rows — a brand-new file has
// none, so every row-based repair is blind to it and the read silently
// answers from a world without the file (the worst agent hallucination
// case). This probe closes it for git worktrees: `git ls-files --others
// --exclude-standard` lists untracked-but-not-ignored files (respecting
// .gitignore and the repo's ignore rules exactly), the brain_file diff drops
// files already indexed (e.g. just-created + already indexed between probe
// and read), and valid-extension + skip filters keep the candidate set to
// files the indexer would actually accept. Non-git trees return [] (W2.2
// adds the snapshot layer). Cost: one `git` call (bounded by changed files,
// never the whole tree) + an O(candidates) DB diff.

export interface AddedFileProbe {
  /** true when the project is a git worktree and the probe ran. */
  available: boolean
  /** absolute paths of untracked, indexable, not-yet-indexed files. */
  files: string[]
  /** probe wall time in ms (0 when not a git worktree). */
  tookMs: number
  /** explicit reason when the probe is unavailable/failed. */
  reason: "no-git" | "ok" | "error"
}

function isLikelyText(content: string): boolean {
  // Reject NUL-heavy binary content without reading the whole buffer twice.
  let nul = 0
  const len = Math.min(content.length, 4096)
  for (let i = 0; i < len; i++) if (content.charCodeAt(i) === 0) nul++
  return nul === 0
}

/**
 * Probe a git worktree for files that exist on disk but have no index row.
 * Returns [] (available=false) when the project is not a git worktree so
 * callers fall back to W2.2 semantics or honest silence.
 */
export async function probeAddedFiles(raw: CoreDatabase, projectId: string, projectPath: string): Promise<AddedFileProbe> {
  const t0 = performance.now()
  const { execFile } = await import("node:child_process")
  const { statSync } = await import("node:fs")
  const { hasValidExtension, shouldSkipCli } = await import("./parallel-indexer")
  try {
    const root = await new Promise<string>((resolve) => {
      execFile("git", ["-C", projectPath, "rev-parse", "--show-toplevel"], { timeout: 4000 }, (err, stdout) => {
        resolve(err ? "" : stdout.toString().trim())
      })
    })
    if (!root) return { available: false, files: [], tookMs: Math.round(performance.now() - t0), reason: "no-git" }
    const listed = await new Promise<string>((resolve) => {
      execFile("git", ["-C", root, "ls-files", "--others", "--exclude-standard", "-z"], { timeout: 10000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
        resolve(err ? "" : stdout.toString())
      })
    })
    if (!listed) return { available: true, files: [], tookMs: Math.round(performance.now() - t0), reason: "ok" }
    // Only files under the INDEXED root are candidates (a nested git repo or
    // sibling checkout must never leak in). Relative to the indexed root.
    const relRoot = root.replace(/[\/\\]+$/, "")
    const candidates: string[] = []
    for (const rel of listed.split("\0")) {
      if (!rel) continue
      const abs = relRoot + "/" + rel
      // Mirror the indexer's own filters: indexable extension and not on the
      // CLI skip list (node_modules/dist/build/.git/…). Never claim a file
      // the indexer itself would skip.
      if (!hasValidExtension(abs) || shouldSkipCli(abs)) continue
      try {
        if (!statSync(abs).isFile()) continue
      } catch { continue }
      candidates.push(abs)
    }
    if (candidates.length === 0) return { available: true, files: [], tookMs: Math.round(performance.now() - t0), reason: "ok" }
    // Drop files already indexed (created between the probe and this diff, or
    // previously indexed under another probe layer). One chunked query.
    const indexed = new Set<string>()
    const rels = candidates.map((c) => c.slice(relRoot.length + 1))
    for (let i = 0; i < rels.length; i += 500) {
      const slice = rels.slice(i, i + 500)
      const idSlice = slice.map((r) => `${projectId}:${r}`)
      for (const r of raw
        .prepare(`SELECT id FROM brain_file WHERE project_id = ? AND id IN (${slice.map(() => "?").join(",")})`)
        .all(projectId, ...idSlice) as Array<{ id: string }>) {
        indexed.add(r.id)
      }
    }
    const out = candidates.filter((c) => !indexed.has(`${projectId}:${c.slice(relRoot.length + 1)}`))
    return { available: true, files: out, tookMs: Math.round(performance.now() - t0), reason: "ok" }
  } catch {
    return { available: false, files: [], tookMs: Math.round(performance.now() - t0), reason: "error" }
  }
}

/**
 * Cheap, honest relevance gate for query-driven reads: does any NEW file
 * plausibly bear on the question? Token overlap between the query and the
 * file's identifier-like content (first 32 KiB). Reading N new files is
 * bounded by the probe's own candidate list; a mismatch costs one small read
 * per new file. Only text-ish content is matched (binary is never claimed).
 */
export function addedFilesRelevantToQuery(files: string[], query: string): string[] {
  if (files.length === 0 || !query.trim()) return []
  const tokens = new Set<string>()
  for (const raw of query.toLowerCase().split(/[^a-z0-9_]+/)) {
    const t = raw.trim()
    // Skip stop-word-ish single chars and the most generic glue words — they
    // would match every file and make the gate useless.
    if (t.length >= 3 && !["the", "and", "how", "what", "does", "this", "that", "with", "from", "file", "code"].includes(t)) tokens.add(t)
  }
  if (tokens.size === 0) return []
  const hits: string[] = []
  for (const f of files) {
    try {
      const content = readFileSync(f, "utf8").slice(0, 32 * 1024).toLowerCase()
      if (!isLikelyText(content)) continue
      for (const t of tokens) {
        // Token as an identifier-ish boundary match: the query term appears as
        // a real code identifier, not inside an unrelated longer word.
        if (new RegExp(`(^|[^a-z0-9_])${t}([^a-z0-9_]|$)`, "i").test(content)) {
          hits.push(f)
          break
        }
      }
    } catch {
      // Read race (file deleted mid-probe) — the file is not claimed.
    }
  }
  return hits
}
