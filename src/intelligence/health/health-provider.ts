import { existsSync } from "node:fs"
import { BrainDatabase } from "../../brain/database"
import { checkResultsFreshness } from "../../brain/freshness"
import { runIndexHealthCheck, type IndexHealthReport } from "../../brain/brain-index-health"
import { indexProjectParallel, wipeProjectData } from "../../ast/parallel-indexer"
import { getAnalysisHistory } from "../analysis/run-history"
import { Config } from "../../config/config"

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
  indexStatus: { lastFullIndex: number | null; lastIncrementalIndex: number | null; indexedFiles: number; indexingVersion: string | null; status: string | null; errors: unknown[] }
  /** M21.I3: versioned performance stats from the durable index status. */
  performanceStats: { schemaVersion: number | null; runs: any[]; latestRun: any | null }
  freshness: { mode: "sampled" | "complete"; checked: number; total: number; fresh: number; stale: number; missing: number; staleFiles: string[]; missingFiles: string[] }
  embeddings: { total: number; embeddedEntities: number; symbolCoveragePercent: number; models: Array<{ model: string; count: number; dimensions: number[] }> }
  schema: { version: number | null; migration: string | null; tables: number }
  runtime: { runtime: "bun" | "node"; version: string; database: string; parserStatus: "available" | "unknown" }
  integrity: IndexHealthReport | null
  analysisRuns: { runs: number; findings: number; byState: Record<string, number> } | null
  refresh: { requested: boolean; force: boolean; wait: boolean; completed: boolean; durationMs: number | null; processedFiles: number | null; derived: string | null }
  /** M40.A8: effective embedding config + per-field source, per the single documented precedence. */
  effectiveConfig: { baseURL: string; model: string; configured: boolean; sources: { baseURL: string; model: string; apiKey: string } } | null
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
    // M22.D2: a non-force refresh must NOT be as expensive as a first index.
    // Incremental skips unchanged files (mtime/size). M40.A6: the heavy
    // post-processing is NO LONGER force-only — incremental runs carry the
    // A2 bounded pass, so a user who asked to refresh never gets health
    // computed from never-rebuilt derived data. An unchanged repo stays a
    // near-no-op (derivedPass "skipped-unchanged"); a forced refresh still
    // wipes and does the full run.
    return indexProjectParallel(projectId as any, projectPath, {
      isIncremental: !force,
      ...(logger ? { logger } : {}),
    })
  })
  refreshQueues.set(projectId, current)
  void current.finally(() => {
    if (refreshQueues.get(projectId) === current) refreshQueues.delete(projectId)
  }).catch(() => undefined)
  return current
}


export async function getUnifiedHealth(projectId: string, projectPath: string, options: UnifiedHealthOptions = {}): Promise<UnifiedHealthReport> {
  const warnings: HealthWarning[] = []
  const refresh = { requested: options.refresh === true || options.force === true, force: options.force === true, wait: options.wait !== false, completed: false, durationMs: null as number | null, processedFiles: null as number | null, derived: null as string | null }
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
        // M40.A6: honest derived-data signal from the refresh run itself —
        // never imply derived data is current when the pass did not run.
        refresh.derived = typeof stats?.summary?.derivedPass === "string" ? stats.summary.derivedPass : "unknown"
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

  // M52.P2 (#722): the joined GROUP BY with two COUNT(DISTINCT) scanned the
  // whole file×symbol fan-out (measured 3.7s at this repo's size). The
  // symbol-side DISTINCT was redundant; the file-side one is load-bearing —
  // so instead of a rewrite, split into two bounded grouped queries and merge
  // in code. LEFT-JOIN semantics preserved: languages with zero symbols still
  // appear (from the file-side query) with symbols=0. V1 parity proves
  // byte-equality against the legacy query on the real index.
  const fileLangRows = raw.prepare(
    "SELECT language, COUNT(DISTINCT id) AS files FROM brain_file WHERE project_id = ? GROUP BY language",
  ).all(projectId) as Array<{ language: string | null; files: number }>
  const symLangRows = raw.prepare(
    "SELECT f.language AS language, COUNT(*) AS symbols FROM brain_symbol s " +
      "JOIN brain_file f ON f.id = s.file_id AND f.project_id = ? " +
      "WHERE s.project_id = ? GROUP BY f.language",
  ).all(projectId, projectId) as Array<{ language: string | null; symbols: number }>
  const langMap = new Map<string, { language: string | null; files: number; symbols: number }>()
  for (const fr of fileLangRows) langMap.set(String(fr.language), { language: fr.language, files: Number(fr.files), symbols: 0 })
  for (const sr of symLangRows) {
    const bucket = langMap.get(String(sr.language))
    if (bucket) bucket.symbols = Number(sr.symbols)
  }
  // Runtime note: `language TEXT` is nullable in the schema, so a null can
  // reach this row in both the legacy query and this merge — the boundary cast
  // mirrors the legacy code exactly (no normalization), keeping V1 parity
  // byte-equal even in the null case.
  // Sort is a total order: files DESC (the legacy query's only guaranteed
  // ordering), then language ASC with NULL first — M52 DEFINES the tie order
  // because legacy left it to SQLite's unspecified sorter behavior (observed
  // to flip between lexicographic directions), so output is now deterministic.
  const languageRows = [...langMap.values()].sort((a, b) => {
    if (b.files !== a.files) return b.files - a.files
    if (a.language === b.language) return 0
    if (a.language == null) return -1
    if (b.language == null) return 1
    return String(a.language) < String(b.language) ? -1 : 1
  }) as Array<{ language: string; files: number; symbols: number }>
  const modelRows = raw.prepare("SELECT embedding_model AS model, COUNT(*) c, GROUP_CONCAT(DISTINCT vector_dimension) dims FROM brain_semantic_embedding WHERE project_id=? GROUP BY embedding_model ORDER BY c DESC").all(projectId) as any[]
  const embeddingTotal = modelRows.reduce((sum, row) => sum + Number(row.c ?? 0), 0)
  const embeddedEntities = (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?").get(projectId) as any)?.c ?? 0
  const schema = raw.prepare("SELECT version, migration_name FROM brain_schema_version ORDER BY version DESC LIMIT 1").get() as any
  const tableCount = (raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE 'brain_%'").get() as any)?.c ?? 0

  // M40.A8: effective embedding config surfaced in verbose mode — with the
  // source of each field, per the single documented precedence (env > file >
  // default). API key value is never printed, only its source.
  let effectiveConfig: UnifiedHealthReport["effectiveConfig"] = null
  if (options.verbose === true) {
    try {
      const { resolveEmbeddingConfig } = await import("../../config/config")
      const fileCfg = await Config.get()
      const effFull = resolveEmbeddingConfig(fileCfg)
      effectiveConfig = { baseURL: effFull.baseURL, model: effFull.model, configured: effFull.configured, sources: effFull.sources }
    } catch { effectiveConfig = null }
  }
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
  // M21.I3: parse the versioned performance stats and expose them alongside
  // errors so health output reflects the same recorded state as the DB.
  const perfRaw = status?.performance_stats
  const performanceStats = typeof perfRaw === "string" && perfRaw ? (() => { try { const p = JSON.parse(perfRaw); return Array.isArray(p?.runs) ? p : null } catch { return null } })() : null
  const perfRuns = performanceStats?.runs ?? []
  const latestPerfRun = perfRuns.length > 0 ? perfRuns[perfRuns.length - 1] : null

  return {
    projectId, projectPath, timestamp: Date.now(),
    counts: { files, symbols, relationships, imports, syntaxErrors },
    indexStatus: { lastFullIndex: status?.last_full_index ?? null, lastIncrementalIndex: status?.last_incremental_index ?? null, indexedFiles: status?.indexed_files ?? 0, indexingVersion: status?.indexing_version ?? null, status: status?.status ?? null, errors: indexingErrors },
    performanceStats: { schemaVersion: performanceStats?.schemaVersion ?? null, runs: perfRuns, latestRun: latestPerfRun },
    freshness: { mode: freshnessMode, checked: fileRows.length, total: files, fresh, stale, missing, staleFiles, missingFiles },
    embeddings: { total: embeddingTotal, embeddedEntities, symbolCoveragePercent: symbols > 0 ? Math.round((embeddedEntities / symbols) * 1000) / 10 : 0, models: modelRows.map((row) => ({ model: row.model, count: Number(row.c), dimensions: String(row.dims ?? "").split(",").filter(Boolean).map(Number) })) },
    schema: { version: schema?.version ?? null, migration: schema?.migration_name ?? null, tables: tableCount },
    runtime: { runtime: typeof Bun !== "undefined" ? "bun" : "node", version: process.version, database: (raw as any).driver ?? "sqlite", parserStatus: "unknown" },
    integrity, analysisRuns, refresh,
    effectiveConfig,
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
    `index: version=${report.indexStatus.indexingVersion ?? "unknown"} indexedFiles=${report.indexStatus.indexedFiles} status=${report.indexStatus.status ?? "unknown"} errors=${report.indexStatus.errors.length}`,
    `perf: schemaVersion=${report.performanceStats.schemaVersion ?? "none"} runs=${report.performanceStats.runs.length} latestWallMs=${report.performanceStats.latestRun?.phases?.totalWallMs ?? "n/a"}`,
    `runtime: ${report.runtime.runtime} ${report.runtime.version} / ${report.runtime.database}`,
  ]
  if (report.refresh.requested) {
    const d = report.refresh.derived
    const dNote = d === "deferred" ? " — derived data DEFERRED; run: bb index --post" : d === "bounded" ? " (bounded pass)" : d === "full" ? " (full pass)" : d === "skipped-unchanged" ? " (unchanged — derived data still consistent)" : ""
    lines.push(`refresh: ${report.refresh.completed ? "completed" : report.refresh.wait ? "failed" : "started (pending)"} force=${report.refresh.force} wait=${report.refresh.wait} durationMs=${report.refresh.durationMs} derived=${d ?? "n/a (pending/failed)"}${dNote}`)
  }
  if (report.analysisRuns) lines.push(`analysis: ${report.analysisRuns.runs} runs / ${report.analysisRuns.findings} findings`)
  if (report.integrity) lines.push(`integrity: ${report.integrity.overallHealth}% (${report.integrity.summary.warn} warnings, ${report.integrity.summary.error} errors)`)
  // M40.A8: effective embedding config with per-field source (verbose only).
  if (report.verbose && report.effectiveConfig) {
    const ec = report.effectiveConfig
    lines.push(`embedding config: ${ec.configured ? "remote provider" : "not configured (local/tfidf fallback)"} — base-url=${ec.baseURL} (source: ${ec.sources.baseURL}), model=${ec.model} (source: ${ec.sources.model}), api-key source: ${ec.sources.apiKey}${ec.configured ? "" : ""}`)
    lines.push(`embedding precedence: env BB_EMBEDDING_* > config file (BB_CONFIG_FILE > bb.json > config.json) > default`)
  }
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
