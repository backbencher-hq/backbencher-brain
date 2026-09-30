// M64.H7: `existsSync` was imported here and never called — the one dead
// binding in this module.
import { BrainDatabase } from "../../brain/database"
import { resolveRowsFreshnessDetailed, selectSampleFiles, type RowFreshnessReason } from "../../brain/freshness"
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
  /**
   * M64.R4: `recordPresent` exists because every field below it can be null for
   * two different reasons — "recorded as null" and "never recorded". Only the
   * first is a measurement. `indexedFiles` is `number | null`, not `number`,
   * so a consumer cannot read a missing record as a count of zero.
   *
   * M64.P1: `isIncomplete` / `indexShortfall` / `totalFilesDiscovered` expose
   * the one signal that survives the process that wrote the index dying: the
   * walk found more files than the run wrote.
   */
  indexStatus: {
    lastFullIndex: number | null
    lastIncrementalIndex: number | null
    indexedFiles: number | null
    totalFilesDiscovered: number | null
    indexShortfall: number
    isIncomplete: boolean
    indexingVersion: string | null
    status: string | null
    errors: unknown[]
    recordPresent: boolean
  }
  /** M21.I3: versioned performance stats from the durable index status. */
  performanceStats: { schemaVersion: number | null; runs: any[]; latestRun: any | null }
  /**
   * M64.H1: `mode` is what was actually checked, not what was requested —
   * `requestedMode` keeps the distinction. `isComplete` is the boolean a
   * consumer should branch on before reading `stale` as a project total.
   */
  freshness: {
    mode: "sampled" | "complete"
    requestedMode: "sampled" | "complete"
    checked: number
    total: number
    fresh: number
    stale: number
    missing: number
    staleFiles: string[]
    missingFiles: string[]
    /** Rows with no index record; counted as neither fresh nor stale (M64.H5). */
    unresolved: number
    isComplete: boolean
    /**
     * M64.R: WHY each file was classified as it was, counted. The resolver
     * always computed this; the provider discarded it, so "215 stale" shipped
     * as one undifferentiated number for three conditions that need three
     * different fixes.
     *
     * Every key is always present (0 rather than absent) so a consumer never
     * has to tell "zero" from "not measured".
     *
     * The two fresh-verdict kinds are separated in the formatter because they
     * are DIFFERENT CLAIMS: `hash-match` compared the content, while
     * `metadata-fast-path` accepted an mtime+size match and never opened the
     * file. A file can be reported fresh by the second and still have been
     * edited, if the edit preserved both its size and its mtime.
     */
    reasons: {
      byKind: Record<RowFreshnessReason, number>
      /** Content was read and hashed to reach this verdict. */
      freshVerifiedByContent: number
      /** Accepted from mtime+size; the file was NOT read. */
      freshVerifiedByMetadata: number
      /** This tally covers the sample when `mode` is "sampled". */
      isSample: boolean
    }
  }
  embeddings: {
    total: number
    embeddedEntities: number
    symbolCoveragePercent: number
    models: Array<{ model: string; count: number; dimensions: number[] }>
    /** M64.R5: entity kinds that have embeddings, so the % can be read. */
    embeddedByEntityType: Array<{ entityType: string; count: number }>
    /** M64.R5: symbol kinds with zero embeddings — unattempted, not partial. */
    unembeddedKinds: Array<{ kind: string; count: number }>
  }
  schema: { version: number | null; migration: string | null; tables: number }
  /** M64.H7: `parserStatus` was removed — hardcoded "unknown", printed by nothing. */
  runtime: { runtime: "bun" | "node"; version: string; database: string }
  integrity: IndexHealthReport | null
  /** M64.H9: `runs` is a COUNT(*), not the length of a 100-row page. */
  analysisRuns: { runs: number; findings: number; byState: Record<string, number>; runTotalKnown: boolean } | null
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

/**
 * M64.R5: symbol kinds present in the index that have NO embedding at all.
 *
 * The "N% symbol coverage" figure is `embeddedEntities / symbols`, which reads
 * as "this share of my code is semantically searchable". What it actually
 * measures is the share of the corpus made of the kinds the embedder supports.
 * The gap between those two readings is invisible unless the tool says which
 * kinds were skipped — a kind with zero embeddings is not a partially-covered
 * kind, it is an unattempted one, and `bb_ask` will never return it.
 *
 * Bounded: one grouped query over brain_symbol.symbol_type, so the result is as
 * long as the vocabulary of kinds (tens), never the corpus size.
 */
function kindsWithNoEmbeddings(raw: any, projectId: string): Array<{ kind: string; count: number }> {
  try {
    const rows = raw.prepare(
      "SELECT s.symbol_type AS kind, COUNT(*) AS c FROM brain_symbol s " +
      "WHERE s.project_id = ? AND NOT EXISTS (SELECT 1 FROM brain_semantic_embedding e WHERE e.project_id = ? AND e.entity_id = s.id) " +
      "GROUP BY s.symbol_type ORDER BY c DESC",
    ).all(projectId, projectId) as any[]
    return rows.map((row) => ({ kind: String(row.kind), count: Number(row.c) }))
  } catch {
    return []
  }
}

const refreshQueues = new Map<string, Promise<unknown>>()

/**
 * M64.N3: the outcome of a DETACHED refresh (`wait: false`), kept so the next
 * bb_health call can report it.
 *
 * The probe this came from, run against a 20-file fixture:
 *
 *   bb_health({refresh:true, force:true, wait:false})  -> isError=false,
 *       "refresh: started (pending) force=true wait=false"
 *   ...the background job wipes the index, then the reindex throws...
 *   next call -> files=0 symbols=0, warnings: []
 *
 * `force` wipes before it indexes, so a detached force-refresh that fails does
 * not leave the index stale — it leaves it GONE. The old code attached
 * `.catch(() => undefined)` to the detached promise, so the error was collected
 * by nobody, and every later call read the empty index as a clean report. The
 * tool whose entire purpose is "is the index healthy?" answered "yes" about a
 * destroyed index.
 *
 * Why an in-process map and not the database: the job itself is in-process, so
 * an outcome this map cannot see is an outcome of a job that is not running.
 * The cross-process case (a process died between the wipe and the reindex) is
 * covered independently by the EMPTY_INDEX warning, which is a statement about
 * the data rather than about an event.
 *
 * A terminal record is surfaced once and then cleared: the event is reported,
 * and if the index is still broken the EMPTY_INDEX warning keeps saying so
 * without this map becoming a per-project nag that never clears.
 */
interface DetachedRefresh {
  startedAt: number
  force: boolean
  state: "running" | "completed" | "failed"
  error?: string
  durationMs?: number
  processedFiles?: number
  derived?: string
}
const detachedRefreshes = new Map<string, DetachedRefresh>()

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
  // M64.N3: a previous detached refresh's outcome is reported BEFORE this
  // call's own work, so the reading of the index below is never presented as a
  // clean snapshot while a wipe is still in flight or has just failed.
  const priorDetached = detachedRefreshes.get(projectId)
  if (priorDetached) {
    if (priorDetached.state === "running") {
      warnings.push({ code: "REFRESH_IN_PROGRESS", message: `a detached refresh started ${Math.round((Date.now() - priorDetached.startedAt) / 1000)}s ago is still running${priorDetached.force ? " AFTER A FORCE WIPE — the index is mid-rebuild and every count below is transient" : ""}`, severity: "warning" })
    } else if (priorDetached.state === "failed") {
      // severity "error": this is the case the probe found — a forced wipe that
      // did not put the index back. The caller asked for a destructive
      // operation, it did not finish, and the index may be empty because of it.
      warnings.push({ code: "REFRESH_FAILED_ASYNC", message: `the detached refresh started ${Math.round((Date.now() - priorDetached.startedAt) / 1000)}s ago FAILED${priorDetached.force ? " after a force wipe, so the index may be empty" : ""}: ${priorDetached.error ?? "unknown error"}. Re-run with refresh=true, wait=true.`, severity: "error" })
      detachedRefreshes.delete(projectId)
    } else {
      detachedRefreshes.delete(projectId)
    }
  }
  if (options.refresh === true || options.force === true) {
    const started = Date.now()
    const refreshPromise = queueRefresh(projectId, projectPath, options.force === true, options.logger)
    if (options.wait === false) {
      refresh.wait = false
      const record: DetachedRefresh = { startedAt: started, force: options.force === true, state: "running" }
      detachedRefreshes.set(projectId, record)
      warnings.push({
        code: "REFRESH_STARTED",
        message: `refresh started in the background; returning the current snapshot${record.force ? ". force=true WIPES the index before rebuilding, so these counts are transient and the next call will report whether it finished" : ""}`,
        severity: "warning",
      })
      // M64.N3: this used to be `void refreshPromise.catch(() => undefined)` —
      // the failure of a destructive detached operation was collected by nobody.
      // Both terminal states are now recorded so the next call can report them.
      void refreshPromise.then(
        (stats: any) => {
          if (detachedRefreshes.get(projectId) !== record) return
          record.durationMs = Date.now() - started
          record.processedFiles = stats?.processedFiles ?? stats?.totalFiles ?? 0
          record.derived = typeof stats?.summary?.derivedPass === "string" ? stats.summary.derivedPass : "unknown"
          // M64.N3: a refresh that RESOLVES is not automatically a success. The
          // probe found the worse half of this defect: the background job did
          // not throw, it completed — having wiped 20 files and indexed 0
          // ("no files to index (all skipped or none found)"). So the failure
          // never became an exception and there was nothing to catch.
          //
          // The discrimination is force, not the file count: an INCREMENTAL
          // refresh over an unchanged tree legitimately processes 0 files
          // (derivedPass "skipped-unchanged"), and calling that a failure would
          // cry wolf on every idempotent refresh. A FORCED refresh that
          // processes 0 files has just deleted the index and put nothing back,
          // which is a failure whatever the promise said.
          if (record.force && record.processedFiles === 0) {
            record.state = "failed"
            record.error = "the forced rebuild completed but indexed 0 files — force=true wiped the index and the rebuild put nothing back, so the index is now empty"
          } else {
            record.state = "completed"
          }
        },
        (error: unknown) => {
          if (detachedRefreshes.get(projectId) !== record) return
          record.state = "failed"
          record.durationMs = Date.now() - started
          record.error = error instanceof Error ? error.message : String(error)
        },
      )
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
  const sampleSize = options.sampleSize ?? 200
  // M64.H1: the "sample" was `ORDER BY relative_path LIMIT ?` — the
  // alphabetically-FIRST N files, every call, forever. It is a prefix, not a
  // sample, and on a real repo that is a hole shaped like the file tree.
  // Measured on this repo (1,654 indexed files, 200 default):
  //
  //   whole index   script=913 docs=225 reviews=191 src=166 grammars=78 ...
  //   default sample docs=189 .github=3 .vscode=1 + 7 top-level .md/json files
  //
  // Zero of 166 src/ files, and the first src/ file is at rank 1452 of 1654 —
  // so the DEFAULT freshness answer was an answer about Markdown, structurally
  // unable to see a single line of the project's own source. Ground truth was
  // 215 stale files; the default call reported 42, every one of them under
  // docs/. Six identical calls returned the identical sample, so this was
  // structural, not unlucky.
  //
  // The replacement is a deterministic pseudo-random sample over the whole
  // index (selectSampleFiles in src/brain/freshness.ts). A stride was tried
  // first and REJECTED by its own gate: a stride is a sample of positions, so
  // it aliases with any period in the file ordering. Against a corpus where
  // every 10th file was edited it reported a 20% drift rate for a true 10%,
  // because every 10th index is also every 5th sampled index. Hash ranking
  // cannot alias — it is independent of the sort order — and it is a pure
  // function of the id set, so identical state still gives an identical answer.
  const allFileRows = raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id=?").all(projectId) as Array<{ id: string; relative_path: string }>
  const fileRows = freshnessMode === "complete" ? selectSampleFiles(allFileRows, Number.MAX_SAFE_INTEGER) : selectSampleFiles(allFileRows, sampleSize)
  // M64.H4: the old call was `checkResultsFreshness`, which runs one
  // `SELECT ... FROM brain_file WHERE id = ?` PER FILE — measured 1.02
  // .prepare() per checked file, 1,681 round-trips for 1,654 files, growing
  // linearly with the repo. `resolveRowsFreshness` already existed in
  // src/brain/freshness.ts for exactly this: one chunked IN query, one stat per
  // unique file, and it also returns the REASON per file, so "stale" can say
  // whether the hash differs or the file is gone.
  const resolved = resolveRowsFreshnessDetailed(raw, projectId, fileRows.map((row) => ({ fileId: row.id })), { freshnessMode })
  const statuses = resolved.statuses
  let fresh = 0, stale = 0, missing = 0
  const staleFiles: string[] = [], missingFiles: string[] = []
  // M64.R: the resolver classifies every row as to WHY, and this function used
  // to read only `.statuses` and throw the reasons away. So a report could say
  // "215 stale" and nothing more — and "stale" is not one condition. Measured
  // on a 6-file fixture with one edit, one delete and one permission loss, the
  // discarded map was:
  //
  //   hash-differs  src/f0.ts, src/f2.ts     (edited — fix: reindex those two)
  //   file-gone     src/f1.ts                (deleted — fix: a pruning refresh)
  //   metadata-fast-path src/f3..f5.ts       (unchanged, never content-read)
  //
  // Three conditions, three different commands, and the tool reported "2 stale,
  // 1 missing" and offered one remedy for all of them. Every category is
  // initialised to 0 below so a consumer never has to distinguish "zero" from
  // "absent", which is the same class of defect as `errors=0` meaning "no
  // record exists".
  const reasonCounts: Record<RowFreshnessReason, number> = {
    "metadata-fast-path": 0,
    "hash-match": 0,
    "hash-differs": 0,
    "file-gone": 0,
    unreadable: 0,
    "no-row": 0,
  }
  for (const row of fileRows) {
    const value = statuses.get(row.id)
    const why = resolved.reasons.get(row.id)
    if (why) reasonCounts[why]++
    if (value === "fresh") fresh++
    else if (value === "missing") { missing++; missingFiles.push(row.relative_path) }
    // M64.H5: an unresolvable row used to fall into the `else` and be counted
    // as STALE. "I could not determine this file's state" is not "this file
    // changed" — conflating them inflates the stale count with unknown rows and
    // sends the caller to reindex files that are fine.
    else if (value === "stale") { stale++; staleFiles.push(row.relative_path) }
  }
  // M64.H5: the resolver can report a row it had no DB record for. Those are
  // counted, named, and never silently folded into stale. Note that the
  // resolver maps `no-row` to status "missing", so those files are inside the
  // `missing` count above AND inside `reasonCounts["no-row"]` — the two are
  // nested, not additive, and the reconciliation assertion below is what keeps
  // that from becoming a double count.
  const unresolved = fileRows.length - (fresh + stale + missing)
  // The arithmetic that must hold, checked rather than assumed. Reasons nest
  // under statuses (fresh = fast-path + hash-match, stale = hash-differs,
  // missing = file-gone + unreadable + no-row), so they partition `checked`
  // exactly once. A published breakdown that does not sum to the headline is
  // the precise failure this whole review has been about, so it is asserted in
  // the gate rather than left to inspection.
  const reasonTotal = Object.values(reasonCounts).reduce((a, b) => a + b, 0) + unresolved

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
  // M64.R5: which kinds the embedder actually touched. Bounded by the number of
  // distinct entity_type values (4 on this repo), not by the row count, and read
  // off the same covering index the M52.P1 aggregate uses.
  const entityTypeRows = raw.prepare("SELECT entity_type, COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY entity_type ORDER BY c DESC").all(projectId) as any[]
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
    // M64.N1: `integrity: true` is the opt-in DEEP check, so it runs the two
    // disk-touching checks over EVERY indexed file instead of a sample. This is
    // what makes the two staleness numbers in one report agree: with both
    // complete, the integrity check and `freshness: "complete"` measure the same
    // population by the same method and cannot report different counts. The
    // indexer's own call keeps the default sampled mode, so its per-index cost
    // is unchanged.
    try { integrity = await runIndexHealthCheck(projectId as any, { diskScan: "complete" }) }
    catch (error) { warnings.push({ code: "INTEGRITY_FAILED", message: error instanceof Error ? error.message : String(error), severity: "error" }) }
  }
  let analysisRuns: UnifiedHealthReport["analysisRuns"] = null
  if (options.includeAnalysisRuns === true) {
    // M64.H9: this asked getAnalysisHistory for 100 rows and then reported
    // `history.runs.length` as if it were the project's run count. Proven on a
    // fixture holding 1,374 runs: the tool printed `analysis: 100 runs /
    // 321 findings`. 100 is the SQL LIMIT, not a measurement — and it is a
    // number that looks exactly like a plausible small count, so nothing in the
    // output tells the reader it was truncated. The 321 beside it WAS a true
    // census (getAnalysisHistory does not page findings), so one line was mixing
    // a capped page with a real count and formatting them identically.
    // The census is now counted, not measured off a page.
    try {
      const history = await getAnalysisHistory(projectId, undefined, 100)
      const runTotal = (raw.prepare("SELECT COUNT(*) c FROM brain_analysis_run WHERE project_id=?").get(projectId) as any)?.c ?? null
      analysisRuns = { runs: runTotal ?? history.runs.length, findings: history.findings.length, byState: history.summary, runTotalKnown: runTotal !== null }
    } catch (error) { warnings.push({ code: "ANALYSIS_HISTORY_FAILED", message: error instanceof Error ? error.message : String(error), severity: "warning" }) }
  }
  if (syntaxErrors > 0) warnings.push({ code: "SYNTAX_ERRORS", message: `${syntaxErrors} indexed files have syntax errors`, severity: "warning" })
  // M64.H5: a row the resolver had no DB record for used to fall into the
  // `else` and be counted as STALE. Named, counted, and never folded into stale.
  if (unresolved > 0) warnings.push({ code: "UNRESOLVED_FILES", message: `${unresolved} indexed files could not be classified and are counted as neither fresh nor stale`, severity: "warning" })
  if (stale + missing > 0) {
    // M64.H1: in sampled mode the counts describe the SAMPLE and the project
    // total is at least this large. The old text ("42 stale and 0 missing
    // files in sampled check") let a reader take 42 as the project's number.
    // M64.R: the mix is named here too, because this is the line a caller reads
    // to decide WHAT TO DO, and the remedy differs per kind: a content change
    // wants a targeted reindex, a deletion wants a pruning refresh, and an
    // unreadable file wants its permissions fixed. One undifferentiated number
    // plus one remedy is what this used to offer.
    const edited = reasonCounts["hash-differs"]
    const deleted = reasonCounts["file-gone"]
    const denied = reasonCounts["unreadable"] + reasonCounts["no-row"]
    const mix = [edited ? `${edited} changed on disk` : "", deleted ? `${deleted} deleted from disk` : "", denied ? `${denied} unreadable or unindexed` : ""].filter(Boolean).join(", ")
    const scope = fileRows.length >= files
      ? `of ${files} indexed files`
      : `in a ${fileRows.length}-file sample of ${files} — a LOWER BOUND on the project, not a total (freshness="complete" counts them all)`
    warnings.push({
      code: "STALE_FILES",
      message: `${stale} stale and ${missing} missing ${scope}${mix ? ` (${mix})` : ""}`,
      severity: "warning",
    })
  }
  // M64.R4: brain_index_status had no row for this project and the report
  // rendered that absence as `indexedFiles=0 status=unknown errors=0` — a zero,
  // printed directly under `files=1654`, with no warning. `errors=0` is the
  // most reassuring possible reading of "no record exists", and the two
  // adjacent lines contradict each other with nothing flagging it.
  const statusRecordPresent = status != null
  // M64.N3: an index with zero files is not a healthy index, and this tool
  // answers even when no index exists (requiresIndex: false), so "0 files,
  // 0 symbols" was reachable as a clean, warning-free report. That is the
  // resting state of a force-wipe whose rebuild failed, and of an index that
  // was never built. Either way the caller has to be told, because the numbers
  // look identical to a healthy project whose project directory is empty.
  if (files === 0) {
    warnings.push({
      code: "EMPTY_INDEX",
      message: "the index holds 0 files and 0 symbols — this is either an unindexed project or an index whose rebuild did not finish (a forced refresh wipes before it rebuilds). Run refresh=true, wait=true to (re)build it.",
      severity: "error",
    })
  }
  // M64.P1: the half-built index. EMPTY_INDEX and the detached-refresh record
  // both only see an index that reached ZERO files, or a failure that happened
  // in this process. Neither can see the state that actually happens when a
  // rebuild is interrupted partway: a process killed between the wipe and the
  // end of the walk leaves 800 of 1,654 files, no in-memory record to consult,
  // and every other check reads as a merely-stale index that a refresh will
  // fix. Nothing in the report could say "this index is INCOMPLETE".
  //
  // The signal is already stored: brain_index_status records both total_files
  // (what the walk found) and indexed_files (what it wrote). A run that ended
  // having written fewer files than it found is a run that did not finish —
  // independent of any in-process memory, which is what makes this the one
  // check that survives the process dying.
  //
  // `status` of "complete" alongside the shortfall is the specific contradiction
  // worth naming: the record claims the run finished and the counts say it did
  // not.
  const recordedTotal = typeof status?.total_files === "number" ? status.total_files : null
  const recordedIndexed = typeof status?.indexed_files === "number" ? status.indexed_files : null
  const indexShortfall = recordedTotal !== null && recordedIndexed !== null && recordedIndexed < recordedTotal
    ? { missing: recordedTotal - recordedIndexed, total: recordedTotal, indexed: recordedIndexed }
    : null
  if (indexShortfall) {
    const contradicted = status?.status === "complete"
    warnings.push({
      code: "INCOMPLETE_INDEX",
      message: `the last index run recorded ${indexShortfall.indexed} of ${indexShortfall.total} files as indexed — ${indexShortfall.missing} file(s) were found by the walk but never written, so the index is INCOMPLETE${contradicted ? " even though the status field says \"complete\"" : ""}. counts below describe a partial index and any answer derived from it covers only what was indexed. Run refresh=true, force=true to rebuild from scratch.`,
      severity: "error",
    })
  }
  if (!statusRecordPresent) {
    warnings.push({
      code: "NO_INDEX_STATUS",
      message: "no brain_index_status row for this project — indexedFiles/status/errors/lastFullIndex are UNRECORDED, not zero. counts.files is measured from brain_file. Reindex (refresh=true) to restore the record.",
      severity: "warning",
    })
  }
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
    indexStatus: {
      lastFullIndex: status?.last_full_index ?? null,
      lastIncrementalIndex: status?.last_incremental_index ?? null,
      indexedFiles: status?.indexed_files ?? null,
      // M64.P1: the walk-vs-write shortfall, exposed as data. A consumer can
      // branch on this without parsing a warning message.
      totalFilesDiscovered: recordedTotal,
      indexShortfall: indexShortfall ? indexShortfall.missing : 0,
      isIncomplete: indexShortfall !== null,
      indexingVersion: status?.indexing_version ?? null,
      status: status?.status ?? null,
      errors: indexingErrors,
      recordPresent: statusRecordPresent,
    },
    performanceStats: { schemaVersion: performanceStats?.schemaVersion ?? null, runs: perfRuns, latestRun: latestPerfRun },
    // M64.H1: `mode` reports what was ACTUALLY checked, not what was asked
    // for. A caller passing sampleSize >= the file count gets every file, and
    // saying "sampled" about a complete check is the mirror image of the bug
    // this replaced. `isComplete` lets a JSON consumer refuse to read an
    // estimate as a census.
    freshness: {
      mode: fileRows.length >= files ? "complete" : "sampled",
      requestedMode: freshnessMode,
      checked: fileRows.length,
      total: files,
      fresh, stale, missing,
      staleFiles, missingFiles,
      unresolved,
      isComplete: fileRows.length >= files,
      reasons: {
        byKind: reasonCounts,
        freshVerifiedByContent: reasonCounts["hash-match"],
        freshVerifiedByMetadata: reasonCounts["metadata-fast-path"],
        isSample: fileRows.length < files,
      },
    },
    embeddings: {
      total: embeddingTotal,
      embeddedEntities,
      symbolCoveragePercent: symbols > 0 ? Math.round((embeddedEntities / symbols) * 1000) / 10 : 0,
      models: modelRows.map((row) => ({ model: row.model, count: Number(row.c), dimensions: String(row.dims ?? "").split(",").filter(Boolean).map(Number) })),
      // M64.R5: the percentage above is a ratio of two counts, and what it
      // measures is narrower than the label admits. On this repo: 4,569
      // function + 2,836 class + 1,838 method + 652 interface = 9,895 embedded
      // entities against 45,018 symbols = "22%". All 9,895 are real
      // brain_symbol rows (0 orphans), so the arithmetic is sound — but 22% is
      // the share of the corpus made of the four kinds the embedder supports,
      // not the share of the corpus that is semantically searchable. The other
      // kinds are not partially covered; they are not attempted at all, and
      // that is a fact the reader could not see.
      embeddedByEntityType: entityTypeRows.map((row) => ({ entityType: String(row.entity_type), count: Number(row.c) })),
      unembeddedKinds: kindsWithNoEmbeddings(raw, projectId),
    },
    schema: { version: schema?.version ?? null, migration: schema?.migration_name ?? null, tables: tableCount },
    // M64.H7: `parserStatus` was typed `"available" | "unknown"`, hardcoded to
    // "unknown", and read by no code path in any mode. A field that cannot
    // vary and is never printed is not a measurement; it is a claim in a type.
    runtime: { runtime: typeof Bun !== "undefined" ? "bun" : "node", version: process.version, database: (raw as any).driver ?? "sqlite" },
    integrity, analysisRuns, refresh,
    effectiveConfig,
    languages: languageRows,
    verbose: options.verbose === true,
    warnings,
  }
}

/**
 * M64.N2: a bounded, counted rendering of a file list.
 *
 * The verbose contract printed every stale path on ONE line with no cap. Proven
 * on a 300-file fixture with all 300 stale: that single line was 3,911 chars of
 * comma-separated paths, with no count, no cap, and nothing saying more existed.
 * A line that grows with the repository is a line that eventually does not fit
 * the reader — and a silently truncated list is worse than an absent one,
 * because it looks complete.
 */
function renderFileList(label: string, files: string[], cap = 20): string {
  if (files.length === 0) return `${label}: none`
  if (files.length <= cap) return `${label}: ${files.join(", ")}`
  return `${label}: ${files.length} total, first ${cap}: ${files.slice(0, cap).join(", ")} — raise \`limit\`/use freshness="complete" and read freshness.staleFiles in the JSON for the rest`
}

/**
 * M64.R: the reason mix, with the limitation stated at the point of use.
 *
 * The limitation is not decoration. `metadata-fast-path` reaches "fresh"
 * without reading the file, so a same-size edit that preserves the mtime is
 * reported fresh — the same trade-off git's stat-cache makes, documented in
 * `fileUnchangedSince`. Publishing that number without publishing the caveat
 * would be publishing a count whose error bound is invisible, which is the
 * defect class this whole report exists to remove. The caveat is therefore part
 * of the LINE, not a comment in the source.
 */
function renderReasonMix(f: UnifiedHealthReport["freshness"]): string {
  const r = f.reasons.byKind
  const parts: string[] = []
  if (r["hash-match"]) parts.push(`${r["hash-match"]} fresh by content hash`)
  if (r["metadata-fast-path"]) parts.push(`${r["metadata-fast-path"]} fresh by mtime+size only (file not read — a same-size edit preserving the mtime reads as fresh)`)
  if (r["hash-differs"]) parts.push(`${r["hash-differs"]} stale: content changed (reindex these)`)
  if (r["file-gone"]) parts.push(`${r["file-gone"]} missing: deleted from disk (a refresh prunes them)`)
  if (r.unreadable) parts.push(`${r.unreadable} missing: unreadable (permissions or a non-file — these will fail every read)`)
  if (r["no-row"]) parts.push(`${r["no-row"]} missing: no index row for the id`)
  if (f.unresolved) parts.push(`${f.unresolved} unclassified`)
  if (!parts.length) return "nothing checked"
  return `${parts.join("; ")}${f.reasons.isSample ? ` — over the ${f.checked}-file SAMPLE, not the project` : ""}`
}

export function formatUnifiedHealth(report: UnifiedHealthReport): string {
  const c = report.counts, f = report.freshness, e = report.embeddings
  // M64.H1: the freshness line is the one number a caller acts on, so it now
  // names the coverage. A sample of 200 of 1,654 printed as
  // "158 fresh / 42 stale / 0 missing (200/1654, sampled)" could be read as
  // "the project is 158/42" — it is 158 of 200 CHECKED, and the project total
  // is at least that stale. `~N of M stale (extrapolated)` is stated as an
  // estimate; a complete check states an exact count and says so.
  const staleIsEstimate = !f.isComplete
  const staleShown = staleIsEstimate
    ? `${f.stale} of ${f.checked} sampled stale (~${Math.round((f.stale / Math.max(1, f.checked)) * f.total)} of ${f.total} estimated)`
    : `${f.stale} of ${f.total} stale`
  const lines = [
    `project: ${report.projectPath}`,
    `projectId: ${report.projectId}`,
    `files=${c.files} symbols=${c.symbols} relationships=${c.relationships} imports=${c.imports} syntaxErrors=${c.syntaxErrors}`,
    `freshness: ${f.fresh} fresh / ${staleShown} / ${f.missing} missing (${f.checked}/${f.total} checked, ${f.mode}${f.mode === "sampled" ? " — SAMPLE, not a census" : ""})`,
    // M64.R: the breakdown is in the DEFAULT output, not verbose, because the
    // defect is that "215 stale" is not actionable. "stale" is three conditions
    // with three different fixes, and a caller who has to opt in to learn which
    // one they have will not learn it.
    //
    // The two fresh kinds are named apart because they are different claims:
    // `hash-match` read the bytes, `metadata-fast-path` accepted an mtime+size
    // match and never opened the file. Collapsing them into "fresh" hides the
    // error bound of the whole verdict.
    `freshness why: ${renderReasonMix(f)}`,
    // M64.R5: the percentage is a ratio of two counts, so the two counts and
    // what they divide are all named. "22% symbol coverage" alone reads as
    // "22% of my code is semantically searchable"; 9,895 of 45,018 says the
    // share of the corpus that consists of the four kinds the embedder writes.
    `embeddings: ${e.total} rows / ${e.embeddedEntities} entities / ${e.symbolCoveragePercent}% of symbols`,
    `models: ${e.models.map((model) => `${model.model}:${model.count}[${model.dimensions.join(",")}]`).join(" ") || "none"}`,
    `schema: ${report.schema.version ?? "unknown"} (${report.schema.migration ?? "no migration record"}), ${report.schema.tables} tables`,
    // M64.R4: `indexedFiles=0 errors=0` for a project with no status record is
    // two zeros that are not measurements. Absence now prints as absence, so
    // the line cannot be read as a healthy zero next to files=1654.
    // M64.P1: a recorded shortfall prints as INCOMPLETE, so a half-built index
    // cannot be skimmed as a normal one.
    `index: version=${report.indexStatus.indexingVersion ?? "unrecorded"} indexedFiles=${report.indexStatus.indexedFiles ?? "unrecorded"}/${report.indexStatus.totalFilesDiscovered ?? "unrecorded"}${report.indexStatus.isIncomplete ? ` — INCOMPLETE, ${report.indexStatus.indexShortfall} file(s) found by the walk were never written` : ""} status=${report.indexStatus.status ?? "unrecorded"} errors=${report.indexStatus.recordPresent ? report.indexStatus.errors.length : "unrecorded"}${report.indexStatus.recordPresent ? "" : " (no brain_index_status row for this project)"}`,
    `perf: schemaVersion=${report.performanceStats.schemaVersion ?? "none"} runs=${report.performanceStats.runs.length} latestWallMs=${report.performanceStats.latestRun?.phases?.totalWallMs ?? "n/a"}`,
    `runtime: ${report.runtime.runtime} ${report.runtime.version} / ${report.runtime.database}`,
  ]
  if (report.refresh.requested) {
    const d = report.refresh.derived
    const dNote = d === "deferred" ? " — derived data DEFERRED; run: bb index --post" : d === "bounded" ? " (bounded pass)" : d === "full" ? " (full pass)" : d === "skipped-unchanged" ? " (unchanged — derived data still consistent)" : ""
    lines.push(`refresh: ${report.refresh.completed ? "completed" : report.refresh.wait ? "failed" : "started (pending)"} force=${report.refresh.force} wait=${report.refresh.wait} durationMs=${report.refresh.durationMs} derived=${d ?? "n/a (pending/failed)"}${dNote}`)
  }
  // M64.H9: `runs` is a COUNT(*) now, so the number is the project's total
  // rather than the length of a 100-row page. The suffix is kept for readers
  // that want to know which method produced it.
  if (report.analysisRuns) lines.push(`analysis: ${report.analysisRuns.runs} runs / ${report.analysisRuns.findings} findings (both are full-table counts, not page lengths)`)
  if (report.integrity) lines.push(`integrity: ${report.integrity.overallHealth}% (${report.integrity.summary.warn} warnings, ${report.integrity.summary.error} errors, ${report.integrity.checks.length} checks)`)
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
    // M64.R5: which kinds were embedded and which were never attempted.
    if (report.embeddings.embeddedByEntityType.length) {
      lines.push(`embedded kinds: ${report.embeddings.embeddedByEntityType.map((k) => `${k.entityType}=${k.count}`).join(" ")}`)
    }
    if (report.embeddings.unembeddedKinds.length) {
      lines.push(`unembedded kinds: ${report.embeddings.unembeddedKinds.map((k) => `${k.kind}=${k.count}`).join(" ")} — these symbols are NOT semantically searchable (never attempted, not partially covered)`)
    }
    // M64.N2: counted and capped instead of one unbounded line.
    lines.push(renderFileList("stale files", report.freshness.staleFiles))
    lines.push(renderFileList("missing files", report.freshness.missingFiles))
  }
  for (const warning of report.warnings) lines.push(`${warning.severity}: [${warning.code}] ${warning.message}`)
  return lines.join("\n")
}
