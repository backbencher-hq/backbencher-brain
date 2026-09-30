// Freshness utility: compare indexed file_hash against the on-disk file so
// read paths can flag stale rows instead of returning confident wrong data.
import { createHash } from "crypto"
import { readFileSync, existsSync, statSync } from "fs"
import type { CoreDatabase } from "../brain/database"
import type { StalenessEnvelope } from "../intelligence/contracts"

export interface FileFreshness {
  fileId: string
  path: string
  indexedHash: string
  /** file absent, hash identical, or hash differs */
  status: "missing" | "fresh" | "stale"
}

/** SHA-256 (16 hex chars) — must match the indexer's file_hash computation. */
export function hashFileContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/** mtime+size fast path: if both match, the file is fresh without hashing. */
export function fileUnchangedSince(path: string, indexedHash: string, indexedSize?: number | null, indexedMtime?: number | null): boolean {
  try {
    const stat = statSync(path)
    // The indexer records both values from the same stat operation used for
    // discovery. This is the normal read-path fast path: unchanged metadata
    // means the file is fresh without reopening and hashing source content.
    // Hash remains the authoritative fallback when metadata is unavailable or
    // differs, preserving correctness for edited files.
    //
    // KNOWN LIMITATION (accepted trade-off, not a defect): an edit that leaves
    // BOTH size and mtime unchanged (same-length edit within timestamp
    // granularity, or mtime deliberately preserved) is reported fresh without
    // a hash read. Closing this gap would mean hashing every file on every
    // read, destroying the fast path. Same trade-off as git's index
    // stat-cache. Hash stays authoritative whenever metadata differs.
    if (indexedSize !== null && indexedSize !== undefined && indexedMtime !== null && indexedMtime !== undefined &&
      stat.size === indexedSize && Math.floor(stat.mtimeMs) === Math.floor(indexedMtime)) return true
    const content = readFileSync(path)
    return hashFileContent(content) === indexedHash
  } catch {
    return false
  }
}

/**
 * Check one indexed file for freshness. Returns the status without throwing.
 */
export function checkFileFreshness(raw: CoreDatabase, fileId: string): FileFreshness | null {
  try {
    const row = raw
      .prepare("SELECT path, file_hash, size_bytes, last_modified FROM brain_file WHERE id = ?")
      .get(fileId) as { path: string; file_hash: string; size_bytes?: number | null; last_modified?: number | null } | undefined
    if (!row) return null
    if (!existsSync(row.path)) return { fileId, path: row.path, indexedHash: row.file_hash, status: "missing" }
    const fresh = fileUnchangedSince(row.path, row.file_hash, row.size_bytes, row.last_modified)
    return { fileId, path: row.path, indexedHash: row.file_hash, status: fresh ? "fresh" : "stale" }
  } catch {
    return null
  }
}

/**
 * Batch freshness check for the files behind a set of results. Returns a map
 * fileId -> status. Files checked once even when many symbols share the file.
 */
export function checkResultsFreshness(
  raw: CoreDatabase,
  rows: Array<{ fileId?: string }>,
): Map<string, "fresh" | "stale" | "missing"> {
  const result = new Map<string, "fresh" | "stale" | "missing">()
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.fileId || seen.has(r.fileId)) continue
    seen.add(r.fileId)
    const f = checkFileFreshness(raw, r.fileId)
    if (f) result.set(r.fileId, f.status)
  }
  return result
}

/** Convenience for a single symbol id: look up its file and check freshness. */
export function checkSymbolFreshness(raw: CoreDatabase, symbolId: string): FileFreshness | null {
  try {
    const row = raw
      .prepare("SELECT file_id FROM brain_symbol WHERE id = ?")
      .get(symbolId) as { file_id: string } | undefined
    if (!row) return null
    return checkFileFreshness(raw, row.file_id)
  } catch {
    return null
  }
}

export function statSizeMtime(path: string): { size: number; mtime: number } | null {
  try {
    const s = statSync(path)
    return { size: s.size, mtime: s.mtimeMs }
  } catch {
    return null
  }
}

// ══ M35.F1: batch row-level freshness resolution ════════════════════════════
// One resolver every read tool can consume: O(unique files touched), never
// O(rows). mtime+size fast path per file (one stat per unique file, memoized
// per call), hash fallback only on metadata mismatch, missing-file detection.
// Honest boundary: this reports truth about the index vs disk; it never
// silently re-indexes and never writes.

export type RowFreshnessStatus = "fresh" | "stale" | "missing"
export type FreshnessMode = "sampled" | "complete"

// ══ M64: deterministic UNBIASED file selection ══════════════════════════════
//
// bb_health and the integrity battery both need to check a bounded number of
// files while (a) returning the same answer for identical state, and (b) not
// systematically missing part of the index.
//
// The history, because both requirements are easier to break than they look:
//
//   `ORDER BY relative_path LIMIT n`   a PREFIX. On this repo's 1,654-file
//       index the first 200 were 189 docs/ files and ZERO of 166 src/ files —
//       the first src/ file is at rank 1452. The default freshness answer was
//       structurally an answer about Markdown. Deterministic, biased, useless.
//
//   `ORDER BY RANDOM() LIMIT n`        unbiased but NOT reproducible. Five
//       integrity calls on one unchanging index answered 21, 17, 22, 19, 16 of
//       200 for a true value of 40, and the warn/error threshold sits at 10% —
//       so the same index flipped severity from one second to the next.
//
//   `ROW_NUMBER() ... WHERE (rn-1) % k = 0`   deterministic and spread across
//       the whole range, but ALIASES with any periodic structure in the sort
//       order. Measured against a corpus where every 10th file was edited: the
//       stride reported a 20% drift rate against a true 10%, because every 10th
//       index is also every 5th sampled index. A stride is a deterministic
//       sample of positions, and a corpus with a period in its file names (one
//       generated file per k, numbered fixtures, any repeated basename pattern)
//       defeats it.
//
// What is left is a deterministic pseudo-random sample: rank the files by a
// stable hash of their id and take the lowest N. That is uniform over the set
// and independent of the sort order, so it cannot alias with a period, and it
// is a pure function of the id set, so identical state gives an identical
// answer. FNV-1a with a murmur finalizer — chosen over sha256 because this
// runs over the whole file list and the only requirement is uniformity, not
// cryptographic quality.
//
// The row read is one indexed query; the selection is in JS so no window
// function is required and no ORDER BY has to be stable.

/** 32-bit FNV-1a + murmur3 finalizer. Stable across runs and processes. */
export function stableFileHash(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export interface FileSelectionRow { id: string; relative_path: string }

/**
 * Choose up to `limit` files from `rows` deterministically and without bias
 * toward any region of the sort order. Returns the selection ordered by
 * relative_path so the rendered report is stable between calls.
 *
 * M64.P2 (cost): this first shipped as `rows.map(...).sort().slice()`, which
 * ranks the WHOLE file set — O(n log n) time and O(n) allocations. Measured at
 * 2,448 ms for 264,000 files (the size this repo's own schema comments cite for
 * "too expensive to full-scan"). That is not a selection cost, that is the
 * dominant cost of a default health call, and it would have blown the 2,000 ms
 * warm-`bb_health` budget the latency work is holding on a large repository.
 *
 * The fix is a pure complexity change with IDENTICAL output: keep only the `k`
 * smallest hashes, in a `k`-length array held in ascending order, and reject
 * each candidate against the current worst in O(1). Only a candidate that
 * beats the worst is inserted, and for a uniform hash that happens about
 * k·ln(n/k) times over the whole scan — roughly 1,000 insertions for
 * n=264,000, k=200 — so the allocation and the work both stop scaling with the
 * corpus. Ties break on `id` so the selected SET is a total order, not
 * hash-collision dependent.
 *
 * Nothing about the selection changes: the same rows give the same k files, so
 * every property the gate asserts (whole-range coverage, determinism,
 * order-independence, unbiasedness) holds for the fast path unchanged.
 */
export function selectSampleFiles<T extends FileSelectionRow>(rows: T[], limit: number): T[] {
  const k = Math.min(limit, rows.length)
  if (k <= 0) return []
  // "Take everything" is not a selection: no hash is needed, and the caller
  // only wants a stable order.
  if (k >= rows.length) {
    return [...rows].sort((a, b) => cmpPath(a.relative_path, b.relative_path) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  const kept: Array<{ r: T; h: number; i: number }> = []
  // `precedes(a, b)` — is a strictly before b in the total order
  // (hash, id, original index)? The index term only matters when two rows share
  // a hash AND an id, which the real caller cannot produce because
  // brain_file.id is the PRIMARY KEY — but an accidental tie-break is worse than
  // a defined one, and with this term the selection is provably identical to a
  // STABLE sort by (hash, id) truncated to k, whatever the input.
  //
  // Getting the operand order right here is not a detail. An earlier version of
  // this wrote the reject as `if (!precedes(worst, candidate)) continue`, which
  // skips a candidate that is SMALLER than the incumbent — so the first
  // incumbent was never displaced and the "sample" was whatever the scan saw
  // first among the rows that happened to arrive early. The equivalence
  // assertion at the bottom of the m64 gate caught it; nothing else would have.
  const precedes = (ah: number, aid: string, ai: number, bh: number, bid: string, bi: number) =>
    ah < bh || (ah === bh && (aid < bid || (aid === bid && ai < bi)))
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const h = stableFileHash(r.id)
    if (kept.length === k) {
      const worst = kept[k - 1]
      // Reject without allocating: the fast path is taken by almost every row,
      // so it costs one comparison and no allocation.
      if (!precedes(h, r.id, i, worst.h, worst.r.id, worst.i)) continue
    }
    let lo = 0, hi = kept.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (precedes(kept[mid].h, kept[mid].r.id, kept[mid].i, h, r.id, i)) lo = mid + 1
      else hi = mid
    }
    kept.splice(lo, 0, { r, h, i })
    if (kept.length > k) kept.pop()
  }
  return kept
    .map((x) => x.r)
    .sort((a, b) => cmpPath(a.relative_path, b.relative_path) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** `, id` as a tiebreak: relative_path alone is not a total order. */
export function cmpPath(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}


export interface FreshnessSummary {
  fresh: number
  stale: number
  missing: number
  /** (stale + missing) / checked — 0 when nothing was checked. */
  staleRatio: number
  freshnessMode: FreshnessMode
}

/** Observable instrumentation: disk work done since the last resolver call. */
export const freshnessStats = { statCalls: 0, hashReads: 0 }

interface StatInfo {
  exists: boolean
  size: number | null
  mtime: number | null
}

function rawStat(p: string): StatInfo {
  freshnessStats.statCalls++
  try {
    const s = statSync(p)
    return { exists: true, size: s.size, mtime: Math.floor(s.mtimeMs) }
  } catch {
    return { exists: false, size: null, mtime: null }
  }
}

interface FileRow {
  id: string
  path: string
  file_hash: string
  size_bytes: number | null
  last_modified: number | null
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function batchLoadRows(raw: CoreDatabase, ids: string[], paths: string[]): Map<string, FileRow> {
  const rows = new Map<string, FileRow>()
  const COLS = "id, path, file_hash, size_bytes, last_modified"
  for (const c of chunk(ids, 500)) {
    const rs = raw
      .prepare(`SELECT ${COLS} FROM brain_file WHERE id IN (${c.map(() => "?").join(",")})`)
      .all(...c) as unknown as FileRow[]
    for (const r of rs) rows.set(r.id, r)
  }
  for (const c of chunk(paths, 500)) {
    const rs = raw
      .prepare(`SELECT ${COLS} FROM brain_file WHERE path IN (${c.map(() => "?").join(",")})`)
      .all(...c) as unknown as FileRow[]
    for (const r of rs) if (!rows.has(r.id)) rows.set(r.id, r)
  }
  return rows
}

function classifyRow(row: FileRow, statFor: (p: string) => StatInfo): { status: RowFreshnessStatus; reason: string } {
  const stat = statFor(row.path)
  if (!stat.exists) return { status: "missing", reason: "file-gone" }
  // mtime+size fast path (must match the indexer's stat convention).
  if (
    row.size_bytes !== null && row.size_bytes !== undefined &&
    row.last_modified !== null && row.last_modified !== undefined &&
    stat.size === row.size_bytes && stat.mtime === Math.floor(row.last_modified)
  ) {
    return { status: "fresh", reason: "metadata-fast-path" }
  }
  // Hash is the authoritative fallback when metadata differs.
  freshnessStats.hashReads++
  try {
    const content = readFileSync(row.path)
    return hashFileContent(content) === row.file_hash
      ? { status: "fresh", reason: "hash-match" }
      : { status: "stale", reason: "hash-differs" }
  } catch {
    return { status: "missing", reason: "unreadable" }
  }
}

export interface RowsFreshnessResult {
  /** fileId (or filePath when the row had no fileId) -> status. */
  statuses: Map<string, RowFreshnessStatus>
  /** same keys -> why ("no-row" | "file-gone" | "unreadable" | "metadata-fast-path" | "hash-match" | "hash-differs") */
  reasons: Map<string, string>
  summary: FreshnessSummary
}

/**
 * Batch row-level freshness resolution (M35.F1 core).
 *
 * `projectId` is accepted per the M35 contract; the raw handle is already
 * project-scoped (per-project SQLite file), so it is not queried again.
 * Rows may carry `fileId` (DB row id) or `filePath` (as stored in brain_file).
 * Cost is O(unique files touched), not O(rows): one stat per unique file per
 * call (memoized), hash only on metadata mismatch, two chunked IN queries.
 */
export function resolveRowsFreshnessDetailed(
  raw: CoreDatabase,
  projectId: string,
  rows: Array<{ fileId?: string | null; filePath?: string | null }>,
  opts: { freshnessMode?: FreshnessMode } = {},
): RowsFreshnessResult {
  void projectId
  freshnessStats.statCalls = 0
  freshnessStats.hashReads = 0
  const statCache = new Map<string, StatInfo>()
  function memoStat(p: string): StatInfo {
    const hit = statCache.get(p)
    if (hit) return hit
    const s = rawStat(p)
    statCache.set(p, s)
    return s
  }
  // The self-test's batch-cost mutation plants `return rawStat(p)` here:
  function statFor(p: string): StatInfo {
    return memoStat(p)
  }

  const uniqueIds = new Set<string>()
  const uniquePaths = new Set<string>()
  for (const r of rows) {
    if (r.fileId) uniqueIds.add(r.fileId)
    else if (r.filePath) uniquePaths.add(r.filePath)
  }
  const byId = batchLoadRows(raw, [...uniqueIds], [...uniquePaths])

  const statuses = new Map<string, RowFreshnessStatus>()
  const reasons = new Map<string, string>()
  for (const id of uniqueIds) {
    const row = byId.get(id)
    if (!row) {
      statuses.set(id, "missing")
      reasons.set(id, "no-row")
      continue
    }
    const c = classifyRow(row, statFor)
    statuses.set(id, c.status)
    reasons.set(id, c.reason)
  }
  const byPath = new Map<string, FileRow>()
  for (const r of byId.values()) if (!byPath.has(r.path)) byPath.set(r.path, r)
  for (const p of uniquePaths) {
    const row = byPath.get(p)
    if (!row) {
      statuses.set(p, "missing")
      reasons.set(p, "no-row")
      continue
    }
    const c = classifyRow(row, statFor)
    statuses.set(p, c.status)
    reasons.set(p, c.reason)
  }

  let fresh = 0, stale = 0, missing = 0
  for (const s of statuses.values()) {
    if (s === "fresh") fresh++
    else if (s === "stale") stale++
    else missing++
  }
  const checked = fresh + stale + missing
  const summary: FreshnessSummary = {
    fresh,
    stale,
    missing,
    staleRatio: checked === 0 ? 0 : (stale + missing) / checked,
    freshnessMode: opts.freshnessMode ?? "complete",
  }
  return { statuses, reasons, summary }
}

/** Contract shape (M35 issue #580): Map<id, "fresh" | "stale" | "missing">. */
export function resolveRowsFreshness(
  raw: CoreDatabase,
  projectId: string,
  rows: Array<{ fileId?: string | null; filePath?: string | null }>,
  opts: { freshnessMode?: FreshnessMode } = {},
): Map<string, RowFreshnessStatus> {
  return resolveRowsFreshnessDetailed(raw, projectId, rows, opts).statuses
}

// ══ M35.E1 (#581): staleness envelope + machine-stable remediation ══════════
// Single source of truth for the wire block every read tool attaches.
// remediation strings name the REAL reindex interfaces:
//   CLI:      bb index --changed | bb index "<file>"
//   MCP tool: bb_index { path } (file path reindexes that file; a dir runs
//             incremental changed-only indexing)
export const FRESHNESS_REMEDIATION = {
  // M43.A1/A2: read tools now AUTO-refresh stale files within budget before
  // answering and declare it; the strings name that automatic behavior and
  // keep the manual interface for opt-out/over-budget cases. Substring
  // contract (asserted by the M35 envelope gate): dir names "bb index
  // --changed" and "bb_index"; file matches /bb index "/ and names bb_index.
  dir: 'reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)',
  file: 'reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)',
} as const

/**
 * Build the registered staleness envelope from a resolver result.
 * remediation is "" while nothing is stale (silence when fresh), otherwise
 * names the concrete reindex interface with the exact stale count.
 * `scope` is the human-stable target for file-level remediation (relative
 * path for single-file reads, project root path for multi-file reads).
 */
export function buildStalenessEnvelope(
  summary: FreshnessSummary,
  scope: { kind: "file" | "dir"; path?: string },
): StalenessEnvelope {
  const staleish = summary.stale + summary.missing
  const remediation = staleish === 0
    ? ""
    : scope.kind === "file"
      ? `${staleish} stale in this file — ${FRESHNESS_REMEDIATION.file.replace("<file>", scope.path ?? "this file")}`
      : `${staleish} stale/missing — ${FRESHNESS_REMEDIATION.dir}`
  return {
    fresh: summary.fresh,
    stale: summary.stale,
    missing: summary.missing,
    staleRatio: summary.staleRatio,
    mode: summary.freshnessMode === "sampled" ? "sampled" : "complete",
    remediation,
  }
}
