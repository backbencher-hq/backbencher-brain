// Portable brain database layer. Resolves the sqlite driver per runtime
// (#db: bun:sqlite under Bun, better-sqlite3 under Node) and exposes the same
// API surface the ported indexer/engine expect: getInstance returns a drizzle
// database (chain API), getRawInstance returns the raw driver handle.
import { openDatabase } from "#db"
import type { CoreDatabase } from "#db"
import path from "path"
import { mkdirSync, existsSync } from "fs"
import * as BrainSchema from "./brain.sql"
import { ensureSchema } from "./schema-ddl"
import { bbProjectsDir } from "../util/bb-data-dir"

export type { CoreDatabase, CoreStatement } from "#db"

export interface BrainStats {
  files: number
  symbols: number
  relationships: number
  imports: number
}

const rawInstances = new Map<string, CoreDatabase>()
const drizzleInstances = new Map<string, any>()
const pathOverrides = new Map<string, string>()

/**
 * If a cached raw handle's database file no longer exists on disk, the handle
 * points at an unlinked inode: writing through it raises
 * SQLITE_READONLY_DBMOVED (e.g. after a project's DB was reset or recreated
 * under a long-running process, like re-indexing a project whose old index
 * was deleted). Drop the cache entry so the next access opens the current
 * file fresh instead of reusing a dead handle.
 *
 * Deliberately NOT closed here: the handle may still be referenced by long-
 * lived callers (the indexer worker pool, the background embedding queue,
 * or any code that captured it earlier), and closing it under them would
 * raise "Cannot use a closed database". Unregistering only lets those
 * existing uses finish (their writes go to the unlinked inode and are
 * safely ignored) while future lookups get a fresh handle.
 */
function evictStaleRawHandle(cacheKey: string): void {
  if (rawInstances.has(cacheKey)) rawInstances.delete(cacheKey)
}

function resolveDbPath(projectId: string): string {
  return pathOverrides.get(projectId) ?? BrainDatabase.getDbPath(projectId)
}

function isBun(): boolean {
  return typeof (globalThis as any).Bun !== "undefined"
}

async function buildDrizzle(raw: CoreDatabase): Promise<any> {
  // drizzle rc.2 takes { client }, not the raw driver — passing the driver
  // object directly silently opens a NEW empty in-memory database.
  if (isBun()) {
    const { drizzle } = await import("drizzle-orm/bun-sqlite")
    return (drizzle as any)({ client: raw.native as any }, { schema: BrainSchema })
  }
  const { drizzle } = await import("drizzle-orm/better-sqlite3")
  return (drizzle as any)({ client: raw.native as any }, { schema: BrainSchema })
}

  function ensureSchemaIfNew(raw: CoreDatabase): void {
    const hasFile = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brain_file'").get()
    if (!hasFile) ensureSchema(raw)
  }

export namespace BrainDatabase {
  /**
   * Point a project id at an explicit DB path (used by the opencode adapter
   * to query opencode's own brain DB at ~/.local/share/opencode/brain/<id>/).
   */
  export function registerPath(projectId: string, dbPath: string): void {
    pathOverrides.set(projectId, dbPath)
  }

  export function clearPathOverrides(): void {
    pathOverrides.clear()
  }

  export function getDbPath(projectId: string): string {
    return path.join(bbProjectsDir(), projectId, "brain.db")
  }

  export function getDbDirectory(projectId: string): string {
    return path.dirname(getDbPath(projectId))
  }

  export function getPath(projectId: string): string {
    return getDbPath(projectId)
  }

  export function getDirectory(projectId: string): string {
    return getDbDirectory(projectId)
  }

  /** Open a brain DB by explicit path (any runtime). Read-only option guards existing indexes. */
  export function openByPath(dbPath: string, options: { readonly?: boolean } = {}): CoreDatabase {
    const key = `${options.readonly ? "ro:" : "rw:"}${dbPath}`
    const cached = rawInstances.get(key)
    if (cached && !existsSync(dbPath)) evictStaleRawHandle(key)
    const fresh = rawInstances.get(key)
    if (fresh) return fresh
    const db = openDatabase(dbPath, options)
    if (!options.readonly) ensureSchemaIfNew(db)
    rawInstances.set(key, db)
    return db
  }

  /** Open the standalone ~/.bb/projects/<projectId>/brain.db and return a drizzle handle. */
  export async function getInstance(projectId: string): Promise<any> {
    const dbPath = resolveDbPath(projectId)
    if (!existsSync(path.dirname(dbPath))) mkdirSync(path.dirname(dbPath), { recursive: true })
    if (!existsSync(dbPath)) {
      // DB file was deleted/recreated: drop both cache layers so a fresh
      // drizzle wrapper is built on the new file.
      drizzleInstances.delete(projectId)
      evictStaleRawHandle(dbPath)
    }
    if (drizzleInstances.has(projectId)) return drizzleInstances.get(projectId)
    const raw = rawInstances.get(dbPath) ?? openDatabase(dbPath)
    ensureSchemaIfNew(raw)
    rawInstances.set(dbPath, raw)
    const drizzleDb = await buildDrizzle(raw)
    drizzleInstances.set(projectId, drizzleDb)
    return drizzleDb
  }

  export const initialize = getInstance

  /** Raw driver handle (CoreDatabase: prepare/exec/transaction). */
  export async function getRawInstance(projectId: string): Promise<CoreDatabase> {
    const dbPath = resolveDbPath(projectId)
    if (!existsSync(path.dirname(dbPath))) mkdirSync(path.dirname(dbPath), { recursive: true })
    if (!existsSync(dbPath)) evictStaleRawHandle(dbPath)
    const raw = rawInstances.get(dbPath) ?? openDatabase(dbPath)
    ensureSchemaIfNew(raw)
    rawInstances.set(dbPath, raw)
    return raw
  }

  export function getMemoryStats() {
    const mem = process.memoryUsage()
    return { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal }
  }

  export function close(projectId: string): void {
    const dbPath = resolveDbPath(projectId)
    drizzleInstances.delete(projectId)
    const raw = rawInstances.get(dbPath)
    if (raw) {
      try {
        raw.close()
      } catch {}
      rawInstances.delete(dbPath)
    }
  }

  export function closeAll(): void {
    for (const db of rawInstances.values()) {
      try {
        db.close()
      } catch {}
    }
    rawInstances.clear()
    drizzleInstances.clear()
  }

  export async function getStats(projectId: string): Promise<BrainStats> {
    const raw = await getRawInstance(projectId)
    const files = (raw.prepare("SELECT COUNT(*) as c FROM brain_file WHERE project_id = ?").get(projectId) as any)?.c ?? 0
    const symbols = (raw.prepare("SELECT COUNT(*) as c FROM brain_symbol WHERE project_id = ?").get(projectId) as any)?.c ?? 0
    const relationships = (raw.prepare("SELECT COUNT(*) as c FROM brain_relationship WHERE project_id = ?").get(projectId) as any)?.c ?? 0
    const imports = (raw.prepare("SELECT COUNT(*) as c FROM brain_import WHERE project_id = ?").get(projectId) as any)?.c ?? 0
    return { files, symbols, relationships, imports }
  }

  export async function updateIndexStatus(
    projectId: string,
    data: { status?: string; symbols?: number; files?: number; lastIndexed?: number; error?: string },
  ): Promise<void> {
    const raw = await getRawInstance(projectId)
    raw
      .prepare(
        `INSERT INTO brain_index_status (project_id, indexing_version, status, last_full_index, total_files, total_symbols, indexing_errors, time_created, time_updated)
         VALUES (?, 'v1.0.0', ?, ?, ?, ?, ?, strftime('%s','now') * 1000, strftime('%s','now') * 1000)
         ON CONFLICT(project_id) DO UPDATE SET
           status = COALESCE(excluded.status, status),
           last_full_index = excluded.last_full_index,
           total_files = excluded.total_files,
           total_symbols = excluded.total_symbols,
           indexing_errors = excluded.indexing_errors,
           time_updated = excluded.time_updated`,
      )
      .run(
        projectId,
        data.status ?? null,
        data.lastIndexed ?? Date.now(),
        data.files ?? 0,
        data.symbols ?? 0,
        data.error ? JSON.stringify([data.error]) : "[]",
      )
  }

  /** M21.I2: read the persisted index status (complete/partial/…) for a project. */
  export async function getIndexStatus(projectId: string): Promise<{ status: string | null }> {
    const raw = await getRawInstance(projectId)
    try {
      const row = raw.prepare("SELECT status FROM brain_index_status WHERE project_id = ?").get(projectId) as { status: string | null } | undefined
      return { status: row?.status ?? null }
    } catch {
      return { status: null }
    }
  }
}
