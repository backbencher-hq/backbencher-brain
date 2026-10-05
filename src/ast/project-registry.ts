// src/ast/project-registry.ts — M23.P1/P2
// Registry of every indexed project under the bb data dir: list with DB path,
// DB size, counts, last-indexed time, and a human path (longest common prefix
// of indexed file paths); plus safe removal.
import { readdirSync, statSync, existsSync, rmSync, copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
// M40.A5: fingerprint helpers were require()'d lazily; bare require throws
// under Node ESM (M21.D2 dual-runtime). createRequire is the sanctioned
// pattern (parallel-indexer.ts does the same). No cycle: fingerprint.ts
// never imports project-registry.ts.
import { computeDbFingerprint, readStoredFingerprint } from "./fingerprint"
const require = createRequire(import.meta.url)
import path from "node:path"
import { bbProjectsDir } from "../util/bb-data-dir"
import { BrainDatabase } from "../brain/database"
import { readLiveStatus, writeLiveStatus, clearStatus } from "./index-status"
import { liveIndexLockHolder } from "./index-lock"

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

/**
 * M43.A4: infer the checkout root a DB was indexed from — longest common
 * prefix of its stored absolute brain_file.path rows (same inference as
 * rewriteBrainFilePaths). Null when the rows carry no absolute paths.
 */
function dbIndexedRoot(raw: any): string | null {
  try {
    const rows = raw.prepare("SELECT path FROM brain_file").all() as Array<{ path: unknown }>
    const abs = rows.map((r) => String(r.path)).filter((p) => p.startsWith("/"))
    if (abs.length === 0) return null
    const root = commonRoot(abs)
    return root && root !== "/" ? root : null
  } catch {
    return null
  }
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
/**
 * Resolve a possibly-abbreviated project id to the full 40-hex id.
 *
 * `bb projects` PRINTS the short 8-character form, and the `--remove` help
 * documents `1a2b3c4d` — but removal required exactly 40 hex characters, so
 * following the product's own instructions failed:
 *
 *   $ bb projects --remove 0163b5ff
 *   ✗ no project with id 0163b5ff
 *
 * A prefix is accepted only when it is UNAMBIGUOUS. If two projects share a
 * prefix the answer lists the candidates rather than picking one — silently
 * deleting the wrong project's index would be far worse than refusing.
 *
 * Returns null when the prefix matches nothing or more than one project.
 */
export function resolveProjectId(prefix: string): string | null {
  const p = prefix.trim().toLowerCase()
  if (!/^[0-9a-f]{1,40}$/.test(p)) return null
  if (p.length === 40) return existsSync(path.join(bbProjectsDir(), p)) ? p : null
  let match: string | null = null
  let ambiguous = false
  try {
    for (const entry of readdirSync(bbProjectsDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith(p)) continue
      if (match) { ambiguous = true; break }
      match = entry.name
    }
  } catch {
    return null
  }
  return ambiguous ? null : match
}

export function removeProject(id: string, force: boolean): RemoveResult {
  const resolved = resolveProjectId(id)
  if (!resolved) {
    // Distinguish "no such prefix" from "ambiguous prefix" — the fixes differ.
    const p = id.trim().toLowerCase()
    if (/^[0-9a-f]{1,40}$/.test(p)) {
      let hits = 0
      try {
        for (const entry of readdirSync(bbProjectsDir(), { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith(p)) hits++
        }
      } catch {}
      if (hits > 1) {
        return { id, removed: false, reason: `project id ${p} is ambiguous (${hits} matches) — use more characters` }
      }
    }
    return { id, removed: false, reason: `no project with id ${id.slice(0, 8)}` }
  }
  const id2 = resolved
  const dir = path.join(bbProjectsDir(), id2)
  const live = readLiveStatus(id2)
  const inFlight = !!live && live.phase === "indexing" && Date.now() - live.updatedAt < 3_600_000
  // M43.P1 (#656): the real single-flight lock is authoritative — a live lock
  // holder means a second process is writing RIGHT NOW (the soft live-status
  // heuristic only catches in-process runs). Refuse unless force.
  const lockHolder = liveIndexLockHolder(id2)
  if ((inFlight || lockHolder) && !force) {
    const reason = lockHolder
      ? `project is being indexed by pid ${lockHolder.pid} (index lock held); use --force to remove anyway`
      : `project is being indexed (in-flight); use --force to remove anyway`
    return { id: id2, removed: false, reason }
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
    clearStatus(id2)
    return { id: id2, removed: !existsSync(dir) }
  } catch (e: any) {
    return { id: id2, removed: false, reason: e?.message ?? String(e) }
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
  // computeDbFingerprint/readStoredFingerprint come from the static import above.
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
        // M43.A4 (#660): never adopt a LIVE sibling. Two simultaneous
        // checkouts of the same codebase (two clones, a fork + its upstream,
        // an editor working copy + a CI clone) have identical fingerprints —
        // adoption is for a MOVED project, i.e. its original checkout is GONE.
        // When the candidate's own recorded root still exists on disk it is
        // still in use; adopting it would steal (and dropSource-delete) the
        // other checkout's index and duplicate every row under a second id
        // prefix. Verified against live copies: clone B's index adopted and
        // deleted clone A's DB, leaving 114 rows under two prefixes.
        const live = dbIndexedRoot(raw)
        if (live && existsSync(live)) continue
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
      // M43.A4: run the re-key with FK enforcement OFF on this fresh copy.
      // The composite ids are rewritten child-before-parent regardless (see
      // rekeyEmbeddedIds), but the PRAGMA guarantees a partial re-key can
      // never abort on a transient FK window — the whole rewrite is one
      // coherent move. The handle closes below; the next open re-enables.
      try { raw.prepare("PRAGMA foreign_keys = OFF").run() } catch {}
      const projectScoped = ["brain_file", "brain_symbol", "brain_relationship", "brain_import",
                             "brain_query_cache", "brain_project_health", "brain_taint_flow",
                             "brain_semantic_embedding", "brain_analysis_run", "brain_analysis_finding",
                             "brain_analysis_occurrence", "brain_index_status", "brain_annotation"]
      for (const table of projectScoped) {
        try { raw.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`).run(toId, fromId) } catch {}
      }
      // M43.A4 (#660): the project_id COLUMN rewrite above is not enough —
      // every composite id VALUE embeds the old project id (brain_file.id =
      // "<pid>:<relpath>", brain_symbol.id / file_id / owner_symbol_id =
      // "<pid>:<relpath>:<name>:<line>", relationship/taint/import refs point
      // at those ids). Without re-keying them, the next incremental top-up at
      // the moved path INSERTs rows under the NEW prefix alongside the stale
      // foreign-prefixed ones (INSERT OR REPLACE cannot collide on a
      // different PK) — every re-parsed file duplicated under two prefixes.
      // Rewrite the leading "<fromId>:" prefix to "<toId>:" in every
      // id-shaped column of every project-scoped table; the LIKE guard makes
      // this a no-op for values that never embed the project id (bare 40-hex
      // project_id values, plain uuids, external refs).
      rekeyEmbeddedIds(raw, fromId, toId, projectScoped)
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
 * M43.A4 (#660): re-key every composite id that embeds `fromId` as its
 * leading "<fromId>:" prefix across all project-scoped tables, so a
 * re-homed DB carries ids consistent with its new project id. Tables missing
 * from an older DB are tolerated (per-table try/catch). Child-before-parent
 * ordering keeps the rewrite correct even without the FK-off PRAGMA:
 * relationship/taint refs (→ brain_symbol) and import/symbol file_id refs
 * (→ brain_file) are re-keyed before the parent keys they reference move.
 */
function rekeyEmbeddedIds(raw: any, fromId: string, toId: string, tables: string[]): void {
  // id-shaped column names that embed "<pid>:..." values. project_id is
  // excluded: it holds the bare 40-hex (already rewritten to toId) and must
  // never be treated as a composite id.
  const isIdColumn = (name: string): boolean =>
    name !== "project_id" && (name === "id" || name === "entity_id" || name.endsWith("_id"))
  for (const table of tables) {
    try {
      const cols = (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map((c) => c.name)
        .filter(isIdColumn)
      for (const col of cols) {
        try {
          // Update each row whose value starts with exactly "<fromId>:".
          // LIKE '%' cannot appear in a 40-hex id, but ESCAPE is declared so
          // future id formats containing _ or % still match literally.
          raw.prepare(
            `UPDATE ${table} SET ${col} = ? || substr(${col}, length(?) + 1) WHERE ${col} LIKE ? ESCAPE '\\'`,
          ).run(toId, fromId, `${fromId}:%`)
        } catch {
          // Column present but not rewritable — leave untouched rather than abort.
        }
      }
    } catch {
      // Table absent on an older DB — nothing to re-key.
    }
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
