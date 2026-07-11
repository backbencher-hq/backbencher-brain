// Shims — Drop-in replacements for backbencher modules
// These make the ported backbencher code work with our standalone modules
// Without modifying the backbencher code at all

import { openDatabase as ourOpenDb } from "../database.js"
import type Database from "better-sqlite3"

// ============================================================================
// BrainDatabase → our database module
// ============================================================================

const dbCache = new Map<string, Database.Database>()

export const BrainDatabase = {
  async getInstance(projectId: string) {
    // projectId is the projectHash
    return {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  offset: () => ({
                    all: () => [],
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      run: () => {},
      all: () => [],
      get: () => null,
    }
  },

  async getRawInstance(projectId: string): Promise<Database.Database> {
    if (!dbCache.has(projectId)) {
      const { openDatabase } = await import("../database.js")
      // projectId IS the projectHash in our system
      // We need to find the project path from the hash
      const { loadProjectIndex } = await import("../database.js")
      const index = loadProjectIndex()
      const entry = index[projectId]
      if (entry) {
        const db = openDatabase(entry.path)
        dbCache.set(projectId, db.db)
        return db.db
      }
      throw new Error(`Project not found for hash: ${projectId}`)
    }
    return dbCache.get(projectId)!
  },

  async getStats(projectId: string) {
    const db = await this.getRawInstance(projectId)
    const files = (db.prepare("SELECT count(*) as c FROM files WHERE project_hash = ?").get(projectId) as any)?.c || 0
    const symbols = (db.prepare("SELECT count(*) as c FROM symbols WHERE project_hash = ?").get(projectId) as any)?.c || 0
    const relationships = (db.prepare("SELECT count(*) as c FROM relationships WHERE project_hash = ?").get(projectId) as any)?.c || 0
    const imports = (db.prepare("SELECT count(*) as c FROM imports WHERE project_hash = ?").get(projectId) as any)?.c || 0
    return { symbols, files, relationships, imports }
  },

  async updateIndexStatus(projectId: string, data: any) {
    try {
      const db = await this.getRawInstance(projectId)
      db.prepare(`UPDATE index_status SET status = ?, files_indexed = ?, symbols_indexed = ?, last_indexed_at = ? WHERE project_hash = ?`)
        .run(data.status || "complete", data.filesIndexed || 0, data.symbolsIndexed || 0, Date.now(), projectId)
    } catch {}
  },
}

// ============================================================================
// Bus → no-op (mcp-brain doesn't have a bus)
// ============================================================================

export const Bus = {
  publishSafe(event: string, data: any) {
    // Backbencher uses a pub/sub bus for progress events.
    // mcp-brain uses direct callbacks. This is a no-op shim.
  },
}

// ============================================================================
// BrainService.Event → event name strings
// ============================================================================

export const BrainService = {
  Event: {
    IndexingStarted: "indexing-started",
    IndexingProgress: "indexing-progress",
    IndexingCompleted: "indexing-completed",
    IndexingFailed: "indexing-failed",
  },
  async getStatus(_projectId: string) {
    return { isInitialized: true, isIndexing: false, lastError: null, stats: {} }
  },
}

// ============================================================================
// ProjectID → string alias
// ============================================================================

export type ProjectID = string

// ============================================================================
// SemanticEngine → basic TF-IDF
// ============================================================================

export const SemanticEngine = {
  async getEmbeddingModel() {
    return null // No embeddings in mcp-brain v1
  },
}

// ============================================================================
// BrainWorkerClient → no-op (we don't have a dedicated worker client)
// ============================================================================

export const BrainWorkerClient = {
  async resolveTaints(_projectId: string) {
    // Taint resolution is handled in our post-processing
  },
  async computeHealth(_projectId: string) {
    // Health is computed in our post-processing
  },
}
