// src/ast/project-registry.ts — M23.P1/P2
// Registry of every indexed project under the bb data dir: list with DB path,
// DB size, counts, last-indexed time, and a human path (longest common prefix
// of indexed file paths); plus safe removal.
import { readdirSync, statSync, existsSync, rmSync } from "node:fs"
import path from "node:path"
import { bbProjectsDir } from "../util/bb-data-dir"
import { BrainDatabase } from "../brain/database"
import { readLiveStatus, clearStatus } from "./index-status"

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