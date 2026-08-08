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
  warnings: HealthWarning[]
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return []
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
}

export async function getUnifiedHealth(projectId: string, projectPath: string, options: UnifiedHealthOptions = {}): Promise<UnifiedHealthReport> {
  const warnings: HealthWarning[] = []
  const refresh = { requested: options.refresh === true, force: options.force === true, wait: options.wait !== false, completed: false, durationMs: null as number | null, processedFiles: null as number | null }
  let raw = await BrainDatabase.getRawInstance(projectId)
  if (options.refresh === true) {
    const started = Date.now()
    try {
      if (options.force === true) wipeProjectData(raw)
      const stats: any = await indexProjectParallel(projectId as any, projectPath, {})
      refresh.completed = true
      refresh.durationMs = Date.now() - started
      refresh.processedFiles = stats.processedFiles ?? stats.totalFiles ?? 0
      raw = await BrainDatabase.getRawInstance(projectId)
    } catch (error) {
      warnings.push({ code: "REFRESH_FAILED", message: error instanceof Error ? error.message : String(error), severity: "error" })
      refresh.durationMs = Date.now() - started
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
    integrity, analysisRuns, refresh, warnings,
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
  if (report.refresh.requested) lines.push(`refresh: ${report.refresh.completed ? "completed" : "failed"} force=${report.refresh.force} wait=${report.refresh.wait} durationMs=${report.refresh.durationMs}`)
  if (report.analysisRuns) lines.push(`analysis: ${report.analysisRuns.runs} runs / ${report.analysisRuns.findings} findings`)
  if (report.integrity) lines.push(`integrity: ${report.integrity.overallHealth}% (${report.integrity.summary.warn} warnings, ${report.integrity.summary.error} errors)`)
  for (const warning of report.warnings) lines.push(`${warning.severity}: [${warning.code}] ${warning.message}`)
  return lines.join("\n")
}
