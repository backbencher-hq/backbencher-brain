// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_patterns: it parses the arguments,
// enforces the page and confidence bounds, calls the two canonical pattern engines,
// renders the bounded answer with its census and staleness truth, and (only when
// asked) persists the run.
// WHICH TOOL IT SERVES — bb_patterns (read, requiresIndex true, modes: orphaned, all).
// WHY IT IS SHAPED THIS WAY — every number in the answer must be named: the census is
//   separate from the displayed page, a suppressed candidate is counted, a refused
//   usage row is counted, and a stale finding is flagged without claiming the read
//   repaired it. The tool opens the index byte-read-only; an unindexed project is a
//   named refusal, never a clean zero. `limit` is a bounded page (maximum 500), and a
//   requested class keeps one slot on that page even when a higher-ranked class fills
//   it, because a caller that asked for framework findings must not receive none.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_patterns.md, docs/BB_PATTERNS.md,
//   validation/tools/bb_patterns/**; gates: `bun run script/m13/verify-patterns-handler-contract.ts`,
//   `bun run script/m13/verify-patterns-contract.ts`,
//   `bun run script/m20/verify-patterns-pagination-history.ts`.
// EDIT TOGETHER WHEN THIS FILE CHANGES — descriptor.ts (schema/defaults/bounds),
//   script/tool-docs/curation/bb_patterns.ts, the generated page, and the gates above.
// CONTRACTS IT MUST NOT BREAK — byte-read-only reads (only an explicit recordRun
//   writes, and only analysis-history records), bounded page with a named maximum,
//   declared census, per-finding [stale] markers with manual-only remediation, and
//   no fabricated evidence: the answer reports what the index says.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { derivedStaleness, textResult } from "../shared"
import { BrainDatabase } from "../../../brain/database"
import { PatternBrainTools } from "../../../ast/tools"
import { detectOrphans } from "../../../intelligence/patterns/orphans"
import { getAnalysisHistory, executeAnalysis } from "../../../intelligence/analysis/run-history"
import { FRESHNESS_REMEDIATION_MANUAL_ONLY, type FreshnessSummary } from "../../../brain/freshness"
import type { AnalysisFindingInput } from "../../../intelligence/contracts"

/** The documented default page size. */
const DEFAULT_LIMIT = 20
/**
 * The largest page the tool answers. Above this the answer is refused by name: the
 * census in the answer already names the whole population and its per-rule split, so
 * a caller never needs an unbounded page to learn what exists.
 */
const MAX_LIMIT = 500
/** Findings returned in a `history` answer; the total is always declared. */
const HISTORY_FINDINGS_WINDOW = 200
/**
 * Ceiling on the census an explicit `recordRun` persists. A run records the whole
 * analysed set (never the displayed page), so the next run cannot auto-resolve a live
 * finding that was merely off-page; when the census is larger than this, the answer
 * says how many findings were not recorded rather than truncating silently.
 */
const RECORD_RUN_CENSUS_CAP = 50_000

type Opened = { rawDb: any } | { error: string }

/** Open the index byte-read-only, turning a missing index into a named refusal. */
async function openReadOnly(projectId: string): Promise<Opened> {
  try {
    return { rawDb: await BrainDatabase.getRawInstance(projectId as any, { readonly: true }) }
  } catch (error: any) {
    return { error: String(error?.message ?? error) }
  }
}

/** Resolve and bound `limit`; a refusal is returned as text rather than thrown. */
function resolveLimit(value: unknown): { limit: number } | { error: string } {
  if (value === undefined || value === null) return { limit: DEFAULT_LIMIT }
  const limit = Number(value)
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 0) {
    return { error: `bb_patterns: limit must be a whole number >= 0 (got ${String(value)})` }
  }
  if (limit > MAX_LIMIT) {
    return {
      error:
        `bb_patterns: limit ${limit} exceeds the maximum page size ${MAX_LIMIT} — this tool answers one bounded page. ` +
        `The answer's [scan: …] line names the full census and the per-rule breakdown, so a smaller page still tells you what exists.`,
    }
  }
  return { limit }
}

/** Resolve `confidenceThreshold`; the argument boundary also enforces 0..1. */
function resolveThreshold(value: unknown): { threshold: number } | { error: string } {
  if (value === undefined || value === null) return { threshold: 0 }
  const threshold = Number(value)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return { error: `bb_patterns: confidenceThreshold must be between 0 and 1 (got ${String(value)})` }
  }
  return { threshold }
}

/**
 * Staleness footer for a read that does not refresh. The tool only REPORTS that a
 * finding's file changed after indexing; it never reindexes, so the remediation must
 * be the manual one and must not name an option this schema does not publish.
 */
function stalenessFooter(summary: FreshnessSummary): string {
  const staleish = summary.stale + summary.missing
  if (staleish === 0) return ""
  const total = summary.fresh + summary.stale + summary.missing
  return `\n${summary.stale} stale, ${summary.missing} missing of ${total} findings' files — ${FRESHNESS_REMEDIATION_MANUAL_ONLY.dir}`
}

type PersistablePattern = {
  type?: string
  description?: string
  severity?: string
  confidence?: number
  evidence?: unknown[]
  location?: { file?: string; line?: number; symbol?: string }
  fingerprint?: string
}

/** Map engine findings onto the analysis-history record shape (the whole census). */
function toFindingInputs(patternFindings: PersistablePattern[]): AnalysisFindingInput[] {
  return patternFindings.map((item) => ({
    fingerprint: item.fingerprint ?? `${item.type ?? "pattern"}:${item.location?.file ?? "?"}:${item.location?.line ?? "?"}`,
    rule: item.type ?? "pattern",
    title: item.description ?? item.type ?? "pattern finding",
    severity: (item.severity ?? "info") as AnalysisFindingInput["severity"],
    confidence: item.confidence ?? null,
    evidence: (item.evidence ?? []) as AnalysisFindingInput["evidence"],
    location: item.location?.file ? `${item.location.file}:${item.location.line ?? "?"}` : null,
  }))
}

/** Persist a scan as an analysis run. Only reached when the caller asked (recordRun). */
async function recordPatternRun(projectId: string, args: Record<string, unknown>, patternFindings: PersistablePattern[], found: number) {
  const recorded = await executeAnalysis({
    projectId: projectId as any,
    kind: "patterns",
    input: { options: args },
    // The FULL analysed set, never the display slice: a recorded run that stored only
    // the page would mark every off-page live finding as resolved on the next run.
    persist: () => toFindingInputs(patternFindings),
  })
  const capped = found > patternFindings.length
  const capNote = capped
    ? ` — CAPPED at ${RECORD_RUN_CENSUS_CAP}; ${found} findings exist and ${found - patternFindings.length} were not recorded, so they will be auto-resolved on the next run`
    : ""
  return { recorded, capNote }
}

export const handler: ToolHandler = async (args, { projectId }) => {
  // ---- bounds and refusals -------------------------------------------------
  const limitResult = resolveLimit(args.limit)
  if ("error" in limitResult) return textResult(limitResult.error, true)
  const limit = limitResult.limit
  const thresholdResult = resolveThreshold(args.confidenceThreshold)
  if ("error" in thresholdResult) return textResult(thresholdResult.error, true)
  // `all` is the only silent default; a typo must not become a bigger scan.
  const scopeArg = String(args.scope ?? "all")
  if (scopeArg !== "all" && scopeArg !== "orphaned") {
    return textResult(`bb_patterns: unknown scope: ${scopeArg} (expected all|orphaned)`, true)
  }
  const scope = scopeArg as "all" | "orphaned"

  const opened = await openReadOnly(projectId)
  if ("error" in opened) return textResult(`bb_patterns: ${opened.error}`, true)
  const rawDb = opened.rawDb

  // ---- history: a bounded read of persisted runs ---------------------------
  if (args.history === true) {
    try {
      const history = await getAnalysisHistory(projectId, "patterns", limit)
      const findingsTotal = history.findings.length
      const findings = history.findings.slice(0, HISTORY_FINDINGS_WINDOW)
      return textResult(JSON.stringify({
        runs: history.runs,
        summary: history.summary,
        findings,
        findingsTotal,
        findingsReturned: findings.length,
        findingsWindow: HISTORY_FINDINGS_WINDOW,
        findingsTruncated: findingsTotal > findings.length,
      }, null, 2))
    } catch (error: any) {
      return textResult(`bb_patterns: ${String(error?.message ?? error)}`, true)
    }
  }

  // A recording call asks the engines for the census (bounded by the cap) and
  // displays a slice of it; a plain call asks only for the page it will show.
  const enginePage = args.recordRun === true ? RECORD_RUN_CENSUS_CAP : limit

  try {
    // ---- orphaned scope ----------------------------------------------------
    if (scope === "orphaned") {
      const report = await detectOrphans(projectId as any, { minConfidence: thresholdResult.threshold, maxResults: enginePage })
      const items = report.findings.slice(0, limit)
      const derived = derivedStaleness(rawDb, projectId as any, items.map((finding) => finding.location.file))
      const lines = items.map((finding) => {
        const where = finding.location.symbol || finding.location.file
        const stale = derived.isStale(finding.location.file) ? " [stale]" : ""
        return `  ${finding.rule} ${where} — ${finding.location.file}:${finding.location.line} (${Math.round(finding.confidence * 100)}%)${stale}`
      })
      const census = Number(report.summary?.candidatesTotal ?? items.length)
      const byRule = Object.entries(report.summary?.candidatesByRule ?? {} as Record<string, number>)
        .sort((a: any, b: any) => b[1] - a[1]).map(([rule, count]) => `${rule}=${count}`).join(" ")
      const suppressed = (report.summary as any)?.suppressedByReason as Record<string, number> | undefined
      const suppressedLine = suppressed
        ? `\n[suppressed: ${Object.entries(suppressed).filter(([, count]) => count > 0).map(([key, count]) => `${key}=${count}`).join(" ") || "nothing"}]`
        : ""
      const usageEvidence = (report.summary as any)?.unverifiedUsageEdges
      const importResolution = (report.summary as any)?.importResolution
      // The evidence channels are part of the answer, not decoration: refused usage
      // rows are why a candidate can be reported, and import resolution states how far
      // the file-clearance channel could be carried.
      const evidenceLine = usageEvidence && importResolution
        ? `\n[usage-evidence: refused ${usageEvidence.total} row(s) (selfLoop=${usageEvidence.byReason?.selfLoop ?? 0}, inferred=${usageEvidence.byReason?.inferred ?? 0}, lowConfidence=${usageEvidence.byReason?.lowConfidence ?? 0}); ` +
          `imports: ${importResolution.rowsSeen} row(s), ${importResolution.attributedToASourceFile} attributed to a file, ${importResolution.resolvedToAFile} resolved, ${importResolution.filesClearedByImport} file(s) cleared]`
        : ""
      const provenance = `\n[provenance: ${report.provenance.evidenceClass} via ${report.provenance.engine}; scanned ${report.summary?.scannedSymbols ?? 0} symbol(s) in ${report.summary?.scannedFiles ?? 0} file(s); limitations: ${report.provenance.limitations.length}]`
      const countLine = `\n[scan: ${census} orphan candidate(s) ${byRule ? `(${byRule})` : ""}; showing ${items.length}${census > items.length ? ` — raise \`limit\` to see more (maximum ${MAX_LIMIT})` : ""}]`
      const footer = stalenessFooter(derived.summary)
      if (args.recordRun === true) {
        const { recorded, capNote } = await recordPatternRun(projectId, args, report.findings as PersistablePattern[], census)
        return textResult(
          `orphaned code (${census} found, ${recorded.report.run.findingCount} recorded) recorded run ${recorded.report.run.id}: ` +
          `new=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}${capNote}\n` +
          `${lines.join("\n") || "  none"}${countLine}${suppressedLine}${evidenceLine}${provenance}${footer}`,
        )
      }
      return textResult(`orphaned code (${census} found):\n${lines.join("\n") || "  none"}${countLine}${suppressedLine}${evidenceLine}${provenance}${footer}`)
    }

    // ---- all scope ---------------------------------------------------------
    const result: any = await PatternBrainTools.detectPatterns(projectId as any, {
      includeOrphaned: args.includeOrphaned !== false,
      includeFramework: args.includeFramework !== false,
      includeAntiPatterns: args.includeAntiPatterns !== false,
      confidenceThreshold: thresholdResult.threshold,
      // The DISPLAYED page is bounded by the caller's limit, not by a larger internal
      // page: the engine keeps one slot per requested class on the page it is asked
      // for, and slicing a bigger page afterwards would discard exactly that promotion.
      maxResults: enginePage,
    })
    const allPatterns: any[] = result?.patterns ?? []
    const items = allPatterns.slice(0, limit)
    const derived = derivedStaleness(rawDb, projectId as any, items.map((item: any) => item.location?.file))
    const lines = items.map((item: any) => {
      const stale = derived.isStale(item.location?.file) ? " [stale]" : ""
      return `  [${item.severity}] ${item.type} @ ${item.location?.file}:${item.location?.line} (${Math.round(item.confidence * 100)}%)${stale}`
    })
    const census = Number(result?.scan?.findingsBeforeDisplayLimit ?? result?.statistics?.totalFound ?? allPatterns.length)
    const typeCounts = Object.entries(result?.statistics?.byType ?? {} as Record<string, number>)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([type, count]) => `${type}=${count}`)
    const countLine = `\n[scan: ${census} finding(s) across ${typeCounts.join(" ") || "no rules"}; showing ${items.length}${census > items.length ? ` — raise \`limit\` to see more (maximum ${MAX_LIMIT})` : ""}]`
    const footer = stalenessFooter(derived.summary)
    if (args.recordRun === true) {
      const { recorded, capNote } = await recordPatternRun(projectId, args, allPatterns as PersistablePattern[], census)
      return textResult(
        `patterns (${census} found, ${recorded.report.run.findingCount} recorded) recorded run ${recorded.report.run.id}: ` +
        `new=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}${capNote}\n` +
        `${lines.join("\n") || "  none"}${countLine}${footer}`,
      )
    }
    return textResult(`patterns (${census} found):\n${lines.join("\n") || "  none"}${countLine}${footer}`)
  } catch (error: any) {
    return textResult(`bb_patterns: ${String(error?.message ?? error)}`, true)
  }
}
