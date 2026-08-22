import { existsSync } from "node:fs"
import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { runIndexHealthCheck, type IndexHealthReport } from "../../brain/brain-index-health"
import { indexProjectParallel, wipeProjectData } from "../../ast/parallel-indexer"
import { getAnalysisHistory } from "../analysis/run-history"

export interface HealthWarning { code: string; message: string; severity: "warning" | "error" }
export interface UnifiedHealthOptions {
  refresh?: boolean
  force?: boolean
  wait?: boolean
  freshness?: "sampled" | "complete"
  sampleSize?: number
  integrity?: boolean
  includeAnalysisRuns?: boolean
  /** Advertised in the registry: verbose=true adds a per-language breakdown and stale/missing file names. */
  verbose?: boolean
  logger?: { log: (...args: any[]) => void; write: (s: string) => void }
}
export interface UnifiedHealthReport {
  projectId: string
  projectPath: string
  timestamp: number
  counts: { files: number; symbols: number; relationships: number; imports: number; syntaxErrors: number }
  indexStatus: { lastFullIndex: number | null; lastIncrementalIndex: number | null; indexedFiles: number; indexingVersion: string | null; errors: unknown[] }
  freshness: { mode: "sampled" | "complete"; checked: number; total: number; fresh: number; stale: number; missing: number; staleFiles: string[]; missingFiles: string[] }
  embeddings: { total: number; embeddedEntities: number; symbolCoveragePercent: number; models: Array<{ model: string; count: number; dimensions: number[] }> }
  schema: { version: number | null; migration: string | null; tables: number }
  runtime: { runtime: "bun" | "node"; version: string; database: string; parserStatus: "available" | "unknown" }
  integrity: IndexHealthReport | null
  analysisRuns: { runs: number; findings: number; byState: Record<string, number> } | null
  refresh: { requested: boolean; force: boolean; wait: boolean; completed: boolean; durationMs: number | null; processedFiles: number | null } 
  /** Per-language file+symbol counts; always collected, printed only when verbose. */
  languages: Array<{ language: string; files: number; symbols: number }>
  /** Mirrors the request; the formatter prints the verbose sections only when true. */
  verbose: boolean
  warnings: HealthWarning[]
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

const refreshQueues = new Map<string, Promise<unknown>>()

function queueRefresh(
  projectId: string,
  projectPath: string,
  force: boolean,
  logger?: UnifiedHealthOptions["logger"],
): Promise<any> {
  const previous = refreshQueues.get(projectId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    const database = await BrainDatabase.getRawInstance(projectId)
    if (force) wipeProjectData(database)
    return indexProjectParallel(projectId as any, projectPath, logger ? { logger } : {})
  })
  refreshQueues.set(projectId, current)
  void current.finally(() => {
    if (refreshQueues.get(projectId) === current) refreshQueues.delete(projectId)
  }).catch(() => undefined)
  return current
}


export async function getUnifiedHealth(projectId: string, projectPath: string, options: UnifiedHealthOptions = {}): Promise<UnifiedHealthReport> {
  const warnings: HealthWarning[] = []
  const refresh = { requested: options.refresh === true || options.force === true, force: options.force === true, wait: options.wait !== false, completed: false, durationMs: null as number | null, processedFiles: null as number | null }
  let raw = await BrainDatabase.getRawInstance(projectId)
  if (options.refresh === true || options.force === true) {
    const started = Date.now()
    const refreshPromise = queueRefresh(projectId, projectPath, options.force === true, options.logger)
    if (options.wait === false) {
      refresh.wait = false
      warnings.push({ code: "REFRESH_STARTED", message: "refresh started in the background; returning the current snapshot", severity: "warning" })
      void refreshPromise.catch(() => undefined)
    } else {
      try {
        const stats: any = await refreshPromise
        refresh.completed = true
        refresh.durationMs = Date.now() - started
        refresh.processedFiles = stats.processedFiles ?? stats.totalFiles ?? 0
        raw = await BrainDatabase.getRawInstance(projectId)
      } catch (error) {
        warnings.push({ code: "REFRESH_FAILED", message: error instanceof Error ? error.message : String(error), severity: "error" })
        refresh.durationMs = Date.now() - started
      }
    }
  }

  const count = (table: string) => (raw.prepare(`SELECT COUNT(*) c FROM ${table} WHERE project_id=?`).get(projectId) as any)?.c ?? 0
  const files = count("brain_file"), symbols = count("brain_symbol"), relationships = count("brain_relationship"), imports = count("brain_import")
  const syntaxErrors = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(has_syntax_errors,0)=1").get(projectId) as any)?.c ?? 0
  const status = raw.prepare("SELECT * FROM brain_index_status WHERE project_id=?").get(projectId) as any
  const freshnessMode = options.freshness ?? "sampled"
  const sampleSize = Math.max(1, options.sampleSize ?? 200)
  const fileRows = (freshnessMode === "complete"
    ? raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id=? ORDER BY relative_path").all(projectId)
    : raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id=? ORDER BY relative_path LIMIT ?").all(projectId, sampleSize)) as Array<{ id: string; relative_path: string }>
  const statuses = checkResultsFreshness(raw, fileRows.map((row) => ({ fileId: row.id })))
  let fresh = 0, stale = 0, missing = 0
  const staleFiles: string[] = [], missingFiles: string[] = []
  for (const row of fileRows) {
    const value = statuses.get(row.id)
    if (value === "fresh") fresh++
    else if (value === "missing") { missing++; missingFiles.push(row.relative_path) }
    else { stale++; staleFiles.push(row.relative_path) }
  }

  const languageRows = raw.prepare(
    "SELECT f.language AS language, COUNT(DISTINCT f.id) files, COUNT(DISTINCT s.id) symbols " +
      "FROM brain_file f LEFT JOIN brain_symbol s ON s.file_id = f.id AND s.project_id = ? " +
      "WHERE f.project_id = ? GROUP BY f.language ORDER BY files DESC",
  ).all(projectId, projectId) as Array<{ language: string; files: number; symbols: number }>
  const modelRows = raw.prepare("SELECT embedding_model AS model, COUNT(*) c, GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model ORDER BY c DESC").all(projectId) as any[]
  const embeddingTotal = modelRows.reduce((sum, row) => sum + Number(row.c ?? 0), 0)
  const embeddedEntities = (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?").get(projectId) as any)?.c ?? 0
  const schema = raw.prepare("SELECT version, migration_name FROM brain_schema_version ORDER BY version DESC LIMIT 1").get() as any
  const tableCount = (raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'brain_%'").get() as any)?.c ?? 0

  let integrity: IndexHealthReport | null = null
  if (options.integrity === true) {
    try { integrity = await runIndexHealthCheck(projectId as any) }
    catch (error) { warnings.push({ code: "INTEGRITY_FAILED", message: error instanceof Error ? error.message : String(error), severity: "error" }) }
  }
  let analysisRuns: UnifiedHealthReport["analysisRuns"] = null
  if (options.includeAnalysisRuns === true) {
    try {
      const history = await getAnalysisHistory(projectId, undefined, 100)
      analysisRuns = { runs: history.runs.length, findings: history.findings.length, byState: history.summary }
    } catch (error) { warnings.push({ code: "ANALYSIS_HISTORY_FAILED", message: error instanceof Error ? error.message : String(error), severity: "warning" }) }
  }
  if (syntaxErrors > 0) warnings.push({ code: "SYNTAX_ERRORS", message: `${syntaxErrors} indexed files have syntax errors`, severity: "warning" })
  if (stale + missing > 0) warnings.push({ code: "STALE_FILES", message: `${stale} stale and ${missing} missing files in ${freshnessMode} check`, severity: "warning" })
  const indexingErrors = parseArray(status?.indexing_errors)
  if (indexingErrors.length > 0) warnings.push({ code: "INDEXING_ERRORS", message: `${indexingErrors.length} indexing errors recorded`, severity: "warning" })

  return {
    projectId, projectPath, timestamp: Date.now(),
    counts: { files, symbols, relationships, imports, syntaxErrors },
    indexStatus: { lastFullIndex: status?.last_full_index ?? null, lastIncrementalIndex: status?.last_incremental_index ?? null, indexedFiles: status?.indexed_files ?? 0, indexingVersion: status?.indexing_version ?? null, errors: indexingErrors },
    freshness: { mode: freshnessMode, checked: fileRows.length, total: files, fresh, stale, missing, staleFiles, missingFiles },
    embeddings: { total: embeddingTotal, embeddedEntities, symbolCoveragePercent: symbols > 0 ? Math.round((embeddedEntities / symbols) * 1000) / 10 : 0, models: modelRows.map((row) => ({ model: row.model, count: Number(row.c), dimensions: String(row.dims ?? "").split(",").filter(Boolean).map(Number) })) },
    schema: { version: schema?.version ?? null, migration: schema?.migration_name ?? null, tables: tableCount },
    runtime: { runtime: typeof Bun !== "undefined" ? "bun" : "node", version: process.version, database: (raw as any).driver ?? "sqlite", parserStatus: "unknown" },
    integrity, analysisRuns, refresh,
    languages: languageRows,
    verbose: options.verbose === true,
    warnings,
  }
}

export function formatUnifiedHealth(report: UnifiedHealthReport): string {
  const c = report.counts, f = report.freshness, e = report.embeddings
  const lines = [
    `project: ${report.projectPath}`,
    `projectId: ${report.projectId}`,
    `files=${c.files} symbols=${c.symbols} relationships=${c.relationships} imports=${c.imports} syntaxErrors=${c.syntaxErrors}`,
    `freshness: ${f.fresh} fresh / ${f.stale} stale / ${f.missing} missing (${f.checked}/${f.total}, ${f.mode})`,
    `embeddings: ${e.total} rows / ${e.embeddedEntities} entities / ${e.symbolCoveragePercent}% symbol coverage`,
    `models: ${e.models.map((model) => `${model.model}:${model.count}[${model.dimensions.join(",")}]`).join(" ") || "none"}`,
    `schema: ${report.schema.version ?? "unknown"} (${report.schema.migration ?? "no migration record"}), ${report.schema.tables} tables`,
    `index: version=${report.indexStatus.indexingVersion ?? "unknown"} indexedFiles=${report.indexStatus.indexedFiles} errors=${report.indexStatus.errors.length}`,
    `runtime: ${report.runtime.runtime} ${report.runtime.version} / ${report.runtime.database}`,
  ]
  if (report.refresh.requested) lines.push(`refresh: ${report.refresh.completed ? "completed" : report.refresh.wait ? "failed" : "started (pending)"} force=${report.refresh.force} wait=${report.refresh.wait} durationMs=${report.refresh.durationMs}`)
  if (report.analysisRuns) lines.push(`analysis: ${report.analysisRuns.runs} runs / ${report.analysisRuns.findings} findings`)
  if (report.integrity) lines.push(`integrity: ${report.integrity.overallHealth}% (${report.integrity.summary.warn} warnings, ${report.integrity.summary.error} errors)`)
  // Verbose sections: per-language breakdown and stale/missing file names — the
  // advertised verbose contract. Omitted entirely unless verbose=true.
  if (report.verbose) {
    if (report.languages.length) lines.push(`languages: ${report.languages.map((l) => `${l.language}:${l.files}f/${l.symbols}s`).join(" ")}`)
    lines.push(`stale files: ${report.freshness.staleFiles.join(", ") || "none"}`)
    lines.push(`missing files: ${report.freshness.missingFiles.join(", ") || "none"}`)
  }
  for (const warning of report.warnings) lines.push(`${warning.severity}: [${warning.code}] ${warning.message}`)
  return lines.join("\n")
}
