// src/ast/project-registry.ts — M23.P1/P2
// Registry of every indexed project under the bb data dir: list with DB path,
// DB size, counts, last-indexed time, and a human path (longest common prefix
// of indexed file paths); plus safe removal.
import { readdirSync, statSync, existsSync, rmSync } from "node:fs"
import path from "node:path"
import { bbProjectsDir } from "../util/bb-data-dir"
import { BrainDatabase } from "../brain/database"
import { readLiveStatus, writeLiveStatus, clearStatus } from "./index-status"

export interface ProjectEntry {
  id: string
  dbPath: string
  dbSizeBytes: number
  files: number
  symbols: number
  lastIndexed: number | null
  status: string | null
  humanPath: string | null
}

/** Longest common prefix of absolute paths (project root as indexed). */
function commonRoot(paths: string[]): string | null {
  if (paths.length === 0) return null
  let prefix = paths[0]
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix)) {
      const idx = prefix.lastIndexOf("/")
      if (idx <= 0) return "/"
      prefix = prefix.slice(0, idx)
    }
  }
  return prefix
}

export function listProjects(): ProjectEntry[] {
  const dir = bbProjectsDir()
  if (!existsSync(dir)) return []
  const entries: ProjectEntry[] = []
  for (const id of readdirSync(dir)) {
    if (!/^[0-9a-f]{40}$/.test(id)) continue // only sha1 project dirs
    const dbPath = path.join(dir, id, "brain.db")
    if (!existsSync(dbPath)) continue
    let sizeBytes = 0
    try { sizeBytes = statSync(dbPath).size } catch {}
    let files = 0, symbols = 0, lastIndexed: number | null = null, status: string | null = null, humanPath: string | null = null
    try {
      // prefer the persisted meta (no full scan); fall back to direct counts
      const row = (BrainDatabase.openByPath(dbPath, { readonly: true }) as any)
      const meta = row.prepare("SELECT total_files, total_symbols, time_updated, status FROM brain_index_status WHERE project_id = ?").get(id) as
        | { total_files: number; total_symbols: number; time_updated: number; status: string | null }
        | undefined
      if (meta) {
        files = Number(meta.total_files ?? 0)
        symbols = Number(meta.total_symbols ?? 0)
        lastIndexed = meta.time_updated ? Number(meta.time_updated) : null
        status = meta.status ?? null
        // M23.P1 honesty: legacy DBs (indexed before total_files was persisted)
        // report 0 meta counts — never show a fabricated zero; count directly.
        if (files === 0 && symbols === 0) {
          files = Number((row.prepare("SELECT COUNT(*) c FROM brain_file").get() as any)?.c ?? 0)
          symbols = Number((row.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any)?.c ?? 0)
        }
      } else {
        files = Number((row.prepare("SELECT COUNT(*) c FROM brain_file").get() as any)?.c ?? 0)
        symbols = Number((row.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any)?.c ?? 0)
      }
      // human path: longest common prefix of a bounded sample of indexed paths
      const sample = (row.prepare("SELECT path FROM brain_file LIMIT 300").all() as any[]).map((r: any) => String(r.path))
      humanPath = commonRoot(sample)
    } catch {
      // unreadable/corrupt DB — still list it with what we have (size + id)
    }
    entries.push({ id, dbPath, dbSizeBytes: sizeBytes, files, symbols, lastIndexed, status, humanPath })
  }
  return entries
}

export interface RemoveResult {
  id: string
  removed: boolean
  reason?: string
}

/**
 * Safe removal. Refuses when a live status file shows an in-flight run unless
 * force is true (deleting a brain.db under a running index/MCP handle gives a
 * stale view). Returns {removed:false, reason} instead of throwing.
 */
export function removeProject(id: string, force: boolean): RemoveResult {
  const dir = path.join(bbProjectsDir(), id)
  if (!/^[0-9a-f]{40}$/.test(id) || !existsSync(dir)) {
    return { id, removed: false, reason: `no project with id ${id.slice(0, 8)}` }
  }
  const live = readLiveStatus(id)
  const inFlight = !!live && live.phase === "indexing" && Date.now() - live.updatedAt < 3_600_000
  if (inFlight && !force) {
    return { id, removed: false, reason: `project is being indexed (in-flight); use --force to remove anyway` }
  }
  try {
    // Prefer in-place wipe semantics for the DB file, then remove the dir.
    try {
      const raw = BrainDatabase.openByPath(path.join(dir, "brain.db"))
      const { wipeProjectData } = require("./parallel-indexer")
      wipeProjectData(raw as any)
      raw.close()
    } catch {}
    rmSync(dir, { recursive: true, force: true })
    // M23.P2: a removed project must be fully gone — including its live-status
    // file, otherwise bb status/stats still report hasIndex with zero counts.
    clearStatus(id)
    return { id, removed: !existsSync(dir) }
  } catch (e: any) {
    return { id, removed: false, reason: e?.message ?? String(e) }
  }
}

export function totalProjectsBytes(entries: ProjectEntry[]): number {
  return entries.reduce((a, e) => a + e.dbSizeBytes, 0)
}

// ===========================================================================
// M23.P3 — INDEX PORTABILITY
// project id = sha1(realpath), so moving a project orphans its DB. Adoption
// finds the orphaned DB by codebase fingerprint and re-homes it under the new
// id, so `bb index` at the moved path reuses the existing index.
// ===========================================================================

export interface AdoptionCandidate {
  id: string
  dbPath: string
  fingerprint: string
  git: string | null
  files: number
}

/**
 * Scan every indexed project DB for one whose codebase fingerprint matches
 * this checkout. Prefers the persisted codebase_fingerprint column (indexed
 * after M23.P3); for DBs that predate the column but already store
 * relative_path, recomputes from the file rows. Never guesses for a DB with
 * no recoverable fingerprint.
 */
export function findAdoptableDb(checkoutFingerprint: string): AdoptionCandidate | null {
  const { computeDbFingerprint, readStoredFingerprint } = require("./fingerprint")
  const dir = bbProjectsDir()
  if (!existsSync(dir)) return null
  for (const id of readdirSync(dir)) {
    if (!/^[0-9a-f]{40}$/.test(id)) continue
    const dbPath = path.join(dir, id, "brain.db")
    if (!existsSync(dbPath)) continue
    try {
      const raw = BrainDatabase.openByPath(dbPath, { readonly: true })
      const stored = readStoredFingerprint(raw, id)
      let fp = stored
      let git: string | null = null
      try {
        const row = raw.prepare("SELECT codebase_git FROM brain_index_status WHERE project_id = ?").get(id) as
          | { codebase_git: string | null }
          | undefined
        git = row?.codebase_git ?? null
      } catch {}
      if (!fp) {
        try { fp = computeDbFingerprint(raw, git) } catch { continue }
      }
      if (fp && fp === checkoutFingerprint) {
        const files = Number((raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any)?.c ?? 0)
        return { id, dbPath, fingerprint: fp, git, files }
      }
    } catch {
      continue
    }
  }
  return null
}

export interface AdoptResult {
  adopted: boolean
  fromId?: string
  toId: string
  reason?: string
}

/**
 * Re-home an existing project DB to a new project id: copy the DB file into
 * the new id's directory, rewrite every project_id row reference inside it,
 * rewrite brain_file.path prefixes from the old root to the new root, then
 * remove the old directory. The new id's dir must not already exist.
 */
export function adoptProject(fromId: string, toId: string, newPath: string): AdoptResult {
  if (!/^[0-9a-f]{40}$/.test(fromId) || !/^[0-9a-f]{40}$/.test(toId)) {
    return { adopted: false, toId, reason: "invalid project id" }
  }
  if (fromId === toId) {
    return { adopted: false, toId, reason: "source and target ids are identical" }
  }
  const srcDb = path.join(bbProjectsDir(), fromId, "brain.db")
  return importDbFile(srcDb, toId, newPath, { fromId, dropSource: true })
}

/**
 * M23.P3: `bb index --import <db>` — adopt a brain.db FILE directly (a moved
 * project or one carried over from another machine). Validates the file is a
 * real brain DB (has the brain_file table), re-homes it under toId, rewrites
 * project_id rows and brain_file.path prefixes to the new checkout root.
 */
export function importDbFile(dbFilePath: string, toId: string, newPath: string,
                             opts: { fromId?: string; dropSource?: boolean } = {}): AdoptResult {
  const { copyFileSync, mkdirSync } = require("node:fs")
  if (!/^[0-9a-f]{40}$/.test(toId)) {
    return { adopted: false, toId, reason: "invalid project id" }
  }
  const src = path.resolve(dbFilePath)
  if (!existsSync(src)) {
    return { adopted: false, toId, reason: `no such DB file: ${src}` }
  }
  const dstDir = path.join(bbProjectsDir(), toId)
  const dstDb = path.join(dstDir, "brain.db")
  if (existsSync(dstDir)) {
    return { adopted: false, toId, reason: `target project ${toId.slice(0, 8)} already has an index` }
  }
  const fromId = opts.fromId ?? projectIdFromDbFile(src)
  try {
    // Validate BEFORE touching anything: this must be a brain DB. Any failure
    // here (missing table, unreadable file, driver init error on non-SQLite
    // content) means "not a brain DB". The probe handle may be left closed by
    // a failed driver init while still cached, so always evict via closeByPath
    // — otherwise the next openByPath throws "Cannot use a closed database".
    let isBrainDb = false
    try {
      const probe = BrainDatabase.openByPath(src, { readonly: true })
      try {
        const t = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_file'").get()
        isBrainDb = !!t
      } finally {
        BrainDatabase.closeByPath(src)
      }
    } catch {
      BrainDatabase.closeByPath(src)
    }
    if (!isBrainDb) return { adopted: false, toId, reason: `not a brain DB (no brain_file table): ${src}` }

    mkdirSync(dstDir, { recursive: true })
    copyFileSync(src, dstDb)
    const raw = BrainDatabase.openByPath(dstDb)
    if (fromId && fromId !== toId) {
      for (const table of ["brain_file", "brain_symbol", "brain_relationship", "brain_import",
                           "brain_query_cache", "brain_project_health", "brain_taint_flow",
                           "brain_semantic_embedding", "brain_analysis_run", "brain_analysis_finding",
                           "brain_analysis_occurrence", "brain_index_status"] as const) {
        try { raw.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`).run(toId, fromId) } catch {}
      }
    }
    rewriteBrainFilePaths(raw, newPath)
    raw.close()
    // Re-key the live status file so in-flight/last-run views follow the move.
    if (fromId) {
      const live = readLiveStatus(fromId)
      if (live) {
        writeLiveStatus(toId, { ...live, projectId: toId })
        clearStatus(fromId)
      }
    }
    if (opts.dropSource) {
      rmSync(path.dirname(src), { recursive: true, force: true })
    }
    return { adopted: true, fromId: fromId ?? undefined, toId }
  } catch (e: any) {
    try { rmSync(dstDir, { recursive: true, force: true }) } catch {}
    return { adopted: false, toId, reason: e?.message ?? String(e) }
  }
}

/**
 * Best-effort project id for a DB file: its parent directory name if 40-hex.
 * Falls back to deriving the id from the rows themselves — a DB copied to a
 * backup folder (parent not 40-hex) still carries its project_id in every row.
 */
function projectIdFromDbFile(dbFilePath: string): string | null {
  const parent = path.basename(path.dirname(path.resolve(dbFilePath)))
  if (/^[0-9a-f]{40}$/.test(parent)) return parent
  // Deep-review fix (S1): fall back to reading the id from the rows so a
  // backup/nested copy still gets its project_id rewritten on import.
  try {
    const probe = BrainDatabase.openByPath(dbFilePath, { readonly: true })
    try {
      const row = probe.prepare("SELECT project_id FROM brain_file LIMIT 1").get() as { project_id?: string } | undefined
      if (row?.project_id && /^[0-9a-f]{40}$/.test(row.project_id)) return row.project_id
    } finally {
      // Must evict, not bare-close: the handle is cached, and a closed-but-
      // cached handle makes the next openByPath throw "Cannot use a closed
      // database" (which then makes importDbFile wrongly refuse the file).
      BrainDatabase.closeByPath(dbFilePath)
    }
  } catch {}
  return null
}

/**
 * Rewrite absolute brain_file.path prefixes after a move: old root = longest
 * common prefix of stored paths; new root = the moved checkout. relative_path
 * stays untouched (it is already root-relative). LIKE special chars in the old
 * root are escaped and ESCAPE '\\' is declared so paths containing _ or %
 * still match (a bare LIKE would silently rewrite nothing).
 */
function rewriteBrainFilePaths(raw: any, newPath: string): void {
  try {
    // Deep-review fix (S2): infer the old root from ALL rows, not a 500-row
    // sample. A sample that happens to sit under one subdir yields a wrong
    // common prefix, leaving every row outside that subdir unrewritten
    // (verified: 101/701 paths left stale after a move).
    const sample = (raw.prepare("SELECT path FROM brain_file").all() as any[]).map((r: any) => String(r.path))
    const oldRoot = commonRoot(sample)
    if (oldRoot && oldRoot !== "/" && newPath) {
      const escaped = oldRoot.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"
      raw.prepare(
        "UPDATE brain_file SET path = ? || SUBSTR(path, LENGTH(?) + 1) WHERE path LIKE ? ESCAPE '\\'",
      ).run(newPath, oldRoot, escaped)
    }
  } catch {}
}
