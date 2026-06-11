// SQLite Database — Connection management, schema migration, WAL mode
// Uses better-sqlite3 for synchronous, fast SQLite access
// One database per project at ~/.bb/db/<sha256(projectPath)>.db

import Database from "better-sqlite3"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { MIGRATIONS, SCHEMA_VERSION } from "./sql/schema.js"

export { Database }

// ============================================================================
// PROJECT HASH — Deterministic ID from absolute path
// ============================================================================

export function computeProjectHash(projectPath: string): string {
  return createHash("sha256")
    .update(projectPath)
    .digest("hex")
    .slice(0, 16)
}

// ============================================================================
// DIRECTORY MANAGEMENT
// ============================================================================

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function getBrainDir(): string {
  const dir = join(homedir(), ".bb")
  ensureDir(dir)
  return dir
}

function getDbDir(): string {
  const dir = join(getBrainDir(), "db")
  ensureDir(dir)
  return dir
}

function getDbPath(projectHash: string): string {
  return join(getDbDir(), `${projectHash}.db`)
}

function getIndexPath(): string {
  return join(getDbDir(), "index.json")
}

// ============================================================================
// PROJECT INDEX — Maps hashes to project names/paths
// ============================================================================

export interface ProjectIndexEntry {
  name: string
  path: string
  lastIndexed: string | null
  files: number
  symbols: number
}

export function loadProjectIndex(): Record<string, ProjectIndexEntry> {
  const indexPath = getIndexPath()
  if (!existsSync(indexPath)) return {}
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"))
  } catch {
    return {}
  }
}

export function saveProjectIndex(index: Record<string, ProjectIndexEntry>): void {
  writeFileSync(getIndexPath(), JSON.stringify(index, null, 2))
}

export function updateProjectIndex(hash: string, entry: Partial<ProjectIndexEntry>): void {
  const index = loadProjectIndex()
  index[hash] = { ...index[hash], ...entry } as ProjectIndexEntry
  saveProjectIndex(index)
}

// ============================================================================
// DATABASE OPEN / CLOSE
// ============================================================================

export interface DatabaseInstance {
  db: Database.Database
  projectPath: string
  projectHash: string
}

/**
 * Open (or create) the SQLite database for a project.
 * Handles schema migration automatically.
 */
export function openDatabase(projectPath: string): DatabaseInstance {
  const hash = computeProjectHash(projectPath)
  const dbPath = getDbPath(hash)
  const isNew = !existsSync(dbPath)

  // Create the database
  const db = new Database(dbPath)

  // Configure PRAGMAs for performance and safety
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.pragma("synchronous = NORMAL")
  db.pragma("cache_size = -64000") // 64MB cache
  db.pragma("busy_timeout = 5000") // 5 second busy wait
  db.pragma("wal_autocheckpoint = 1000") // Checkpoint every 1000 pages

  // Run schema migrations
  runMigrations(db, isNew)

  // Register project in index
  const name = projectPath.split("/").pop() || projectPath
  updateProjectIndex(hash, {
    name,
    path: projectPath,
    lastIndexed: null,
    files: 0,
    symbols: 0,
  })

  return { db, projectPath, projectHash: hash }
}

/**
 * Close the database cleanly — WAL checkpoint and close.
 */
export function closeDatabase(instance: DatabaseInstance): void {
  try {
    instance.db.pragma("wal_checkpoint(TRUNCATE)")
    instance.db.close()
  } catch {
    // Best effort
  }
}

/**
 * Run database health checks.
 */
export function checkDatabaseHealth(db: Database.Database): { ok: boolean; issues: string[] } {
  const issues: string[] = []

  try {
    const integrity = db.pragma("integrity_check") as any[]
    if (integrity.length > 0 && integrity[0] && integrity[0].integrity_check !== "ok") {
      issues.push(`Integrity check: ${JSON.stringify(integrity)}`)
    }
  } catch (e: any) {
    issues.push(`Integrity check failed: ${e.message}`)
  }

  try {
    // Check WAL size
    const walInfo = db.pragma("wal_checkpoint(PASSIVE)") as any[]
    if (walInfo.length > 0) {
      const blocked = walInfo[0]?.busy || 0
      if (blocked > 0) issues.push(`WAL has ${blocked} blocked pages`)
    }
  } catch {}

  return { ok: issues.length === 0, issues }
}

/**
 * Remove a project's database entirely.
 */
export function cleanDatabase(projectPath: string): boolean {
  const hash = computeProjectHash(projectPath)
  const dbPath = getDbPath(hash)

  try {
    if (existsSync(dbPath)) {
      const { unlinkSync } = require("fs")
      unlinkSync(dbPath)
      // Remove WAL and SHM files if they exist
      try { unlinkSync(dbPath + "-wal") } catch {}
      try { unlinkSync(dbPath + "-shm") } catch {}
    }
    // Remove from index
    const index = loadProjectIndex()
    delete index[hash]
    saveProjectIndex(index)
    return true
  } catch {
    return false
  }
}

/**
 * List all indexed projects.
 */
export function listProjects(): Record<string, ProjectIndexEntry> {
  return loadProjectIndex()
}

// ============================================================================
// SCHEMA MIGRATIONS
// ============================================================================

function runMigrations(db: Database.Database, isNew: boolean): void {
  // Create schema version table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Get current version (0 if new database)
  const currentVersion = isNew
    ? 0
    : (db.prepare("SELECT MAX(version) as v FROM schema_version").get() as any)?.v || 0

  // Apply any pending migrations
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v]
    if (!sql) {
      throw new Error(`Migration version ${v} not found`)
    }

    try {
      db.exec(sql)
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(v)
    } catch (err) {
      throw new Error(
        `Schema migration v${v} failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
