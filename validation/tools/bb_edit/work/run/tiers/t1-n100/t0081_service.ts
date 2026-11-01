import { BrainDatabase, type BrainStats } from "./database"
import type { ProjectID } from "../project/schema"
import * as Log from "../tool/brain-log"
import { GlobalBus } from "../bus/global"
import { BusEvent } from "../bus/bus-event"

const log = Log.create({ service: "brain-service" })

export const Event = {
  Initialized: { type: "brain.initialized", ...BusEvent },
  IndexingStarted: { type: "brain.indexing.started", ...BusEvent },
  IndexingProgress: { type: "brain.indexing.progress", ...BusEvent },
  IndexingCompleted: { type: "brain.indexing.completed", ...BusEvent },
  IndexingFailed: { type: "brain.indexing.failed", ...BusEvent },
}

export interface BrainProjectStatus {
  projectId: string
  isInitialized: boolean
  isIndexing: boolean
  stats: BrainStats
  lastError?: string
}

export namespace BrainService {
  export const Event = {
    Initialized: "brain.initialized",
    IndexingStarted: "brain.indexing.started",
    IndexingProgress: "brain.indexing.progress",
    IndexingCompleted: "brain.indexing.completed",
    IndexingFailed: "brain.indexing.failed",
  }

  const brainStatus = new Map<string, BrainProjectStatus>()

  export async function initialize(projectId: string): Promise<BrainStats> {
    log.debug("initializing brain for project", { projectId })
    try {
      await BrainDatabase.initialize(projectId)
      const stats = await BrainDatabase.getStats(projectId)
      brainStatus.set(projectId, {
        projectId,
        isInitialized: true,
        isIndexing: false,
        stats,
        lastError: undefined,
      })
      return stats
    } catch (error) {
      log.error("failed to initialize brain", { projectId, error })
      brainStatus.set(projectId, {
        projectId,
        isInitialized: false,
        isIndexing: false,
        stats: { files: 0, symbols: 0, relationships: 0, imports: 0 },
        lastError: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  export async function getStatus(projectId: string): Promise<BrainProjectStatus> {
    if (brainStatus.has(projectId)) {
      const cached = brainStatus.get(projectId)!
      try {
        const freshStats = await BrainDatabase.getStats(projectId)
        cached.stats = freshStats
      } catch {}
      return cached
    }
    try {
      await initialize(projectId)
      return brainStatus.get(projectId)!
    } catch (error) {
      return {
        projectId,
        isInitialized: false,
        isIndexing: false,
        stats: { files: 0, symbols: 0, relationships: 0, imports: 0 },
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  export async function startIndexing(
    projectId: string,
    targetPath?: string,
    rootPathOverride?: string,
  ): Promise<void> {
    const projectPath = rootPathOverride || process.cwd()
    log.debug("starting brain indexing", { projectId, projectPath })

    const status = await getStatus(projectId)
    if (status.isIndexing) {
      log.warn("indexing already in progress", { projectId })
      return
    }

    brainStatus.set(projectId, {
      ...status,
      isIndexing: true,
      lastError: undefined,
    })

    try {
      const { indexProjectParallel } = await import("../ast/parallel-indexer")
      if (targetPath) {
        await indexProjectParallel(projectId, projectPath, { files: [targetPath], isIncremental: true })
      } else {
        await indexProjectParallel(projectId, projectPath)
      }

      const finalStats = await BrainDatabase.getStats(projectId)
      brainStatus.set(projectId, {
        projectId,
        isInitialized: true,
        isIndexing: false,
        stats: finalStats,
        lastError: undefined,
      })
      log.debug("brain indexing completed", { projectId, stats: finalStats })
    } catch (error) {
      log.error("brain indexing failed", { projectId, error })
      const currentStatus = brainStatus.get(projectId)!
      brainStatus.set(projectId, {
        ...currentStatus,
        isIndexing: false,
        lastError: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  export async function isInitialized(projectId: string): Promise<boolean> {
    try {
      const stats = await BrainDatabase.getStats(projectId)
      return stats.files > 0
    } catch {
      return false
    }
  }

  export function closeBrain(projectId: string): void {
    BrainDatabase.close(projectId)
    brainStatus.delete(projectId)
  }

  export function closeAllBrains(): void {
    BrainDatabase.closeAll()
    brainStatus.clear()
  }

  export function forceSetStatus(projectId: string, status: BrainProjectStatus): void {
    brainStatus.set(projectId, status)
  }

  export function getStatusSync(projectId: string): BrainProjectStatus | undefined {
    return brainStatus.get(projectId)
  }
}

export async function forceRefreshStats(projectId: string): Promise<BrainStats> {
  const freshStats = await BrainDatabase.getStats(projectId)
  const existing = BrainService.getStatusSync(projectId)
  BrainService.forceSetStatus(projectId, {
    projectId,
    isInitialized: existing?.isInitialized ?? freshStats.files > 0,
    isIndexing: existing?.isIndexing ?? false,
    stats: freshStats,
    lastError: existing?.lastError,
  })
  return freshStats
}
