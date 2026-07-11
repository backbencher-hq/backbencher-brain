// Shims — Drop-in replacements for backbencher modules
// These make the ported backbencher code work with our standalone modules

import type Database from "better-sqlite3"

export { BrainDatabase } from "./shims-db.js"

const dbCache = new Map<string, Database.Database>()

export const Bus = {
  publishSafe(_event: string, _data: any) {},
}

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

export type ProjectID = string

export const SemanticEngine = {
  async getEmbeddingModel() { return null },
}

export const BrainWorkerClient = {
  async resolveTaints(_projectId: string) {},
  async computeHealth(_projectId: string) {},
}
