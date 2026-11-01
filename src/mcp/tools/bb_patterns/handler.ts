// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_patterns — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_patterns (see src/mcp/tools/bb_patterns/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_patterns.md, docs/BB_*.md for its guide page, validation/tools/bb_patterns/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_patterns/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_patterns.md, and its gate scripts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler, ToolContext, ToolResult, ToolArguments } from "../shared"
import { derivedStaleness, SECURITY_FINDINGS_WINDOW, SECURITY_SUSPICIOUS_WINDOW, SECURITY_SCAN_CAP, SECURITY_RECORD_RUN_CENSUS_CAP, ANALYZE_GRAPH_WALK_CEILING_MS, textResult, autoRefreshFile, readSnippet, resolveProjectPath, ensureWithinProject, resolveSafeReadPath, readIndexedFile, describeUnknownFilters, canonicalImpactReport } from "../shared"
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../brain/database"
import { annotationId, annotationReachability, canonicalFilePath } from "../../../brain/annotation-store"
import { BrainTools, PatternBrainTools } from "../../../ast/tools"
import { quickAnswer } from "../../../intelligence/search/quick-answer"
import { detectOrphans } from "../../../intelligence/patterns/orphans"
import { ASTEngine } from "../../../ast/engine"
import { checkResultsFreshness, fileUnchangedSince, resolveRowsFreshnessDetailed, buildStalenessEnvelope, FRESHNESS_REMEDIATION, FRESHNESS_REMEDIATION_MANUAL_ONLY, type FreshnessSummary } from "../../../brain/freshness"
import { CrossLanguageSecurityAnalysis } from "../../../security/cross-language-security"
import { DependencyGraphVisualizer } from "../../../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../../../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../../../ast/cross-language-migration-assistant"
import { indexProjectParallel, reindexFilesParallel, wipeProjectData } from "../../../ast/parallel-indexer"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../../../ast/auto-refresh"
import { TOOL_DESCRIPTORS } from "../../tool-registry"
import { testQuality } from "../../../intelligence/testing/quality"
import { executeEdit, type EditRequest } from "../../../intelligence/edit/edit-engine"
import { getUnifiedHealth, formatUnifiedHealth } from "../../../intelligence/health/health-provider"
import { getAnalysisHistory, executeAnalysis } from "../../../intelligence/analysis/run-history"
import { generateDocumentation, formatDocumentation, type DocRequest } from "../../../intelligence/documentation/doc-engine"
import { visualizeProject, formatVisualization, renderVisualizationStudio, type VisualizationRequest, type VisualizationScope, type VisualizationLayout } from "../../../intelligence/visualization/visualization-engine"
import { generateMigrationPlans, formatMigrationPlans } from "../../../intelligence/migration/migration-engine"
import { graphTraversal } from "../../../intelligence/graph/graph-engine"
// M28.T1 (issue #624): the agent door reuses the EXACT components the IDE
// door uses — one truth, two doors (M28 decision D-1). No reimplementation.
// M48.P1 (#696): bb_analyze impact aggregates the SAME canonical calculator
// (computeImpact + its declared budget) so the two doors cannot disagree.
import { computeImpact, IMPACT_BUDGET } from "../../../lsp/impact"
// M55.T5 / §15.1: the ONE owner of the evidence-tier vocabulary and derivation.
// The agent door CALLS it. It used to carry a drifted copy of the rule — see the
// `tierFor` delegation in bb_graph below and docs/m63/CL1.md for the shape of
// defect a copy-projection is.
import { classifyTier } from "../../../lsp/evidence_tier"
import { tierForCrossLanguageEdge, factsFromRows, storedCrossLanguageRows, storedCrossLanguageFactsByName, CROSS_LANGUAGE_DEFAULT_LIMIT, CROSS_LANGUAGE_MAX_LIMIT } from "../../../lsp/cross_language_hover"
import { getProjectStats } from "../../../intelligence/analysis/project-stats"
import { getFileDependencies, dependencyProvenance, dependencyPageProvenance, normalizeScopePath, scopeFileCount } from "../../../intelligence/analysis/dependencies"
import { analyzeComplexity } from "../../../intelligence/analysis/complexity"
import { testMapping, testGaps, testImpact } from "../../../intelligence/testing/test-intel"
import { makeProvenance } from "../../../intelligence/evidence"
import type { AnalysisFindingInput } from "../../../intelligence/contracts"

export const handler: ToolHandler = async (args, { projectId }) => {
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, "patterns", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    // M48.C2 (#700): unknown scope strings are refused, never silently
    // re-interpreted as "all" — a typo'd scope must not masquerade as a
    // different (much larger) scan.
    const scopeArg = String(args.scope ?? "all")
    if (!["all", "orphaned"].includes(scopeArg)) return textResult(`bb_patterns: unknown scope: ${scopeArg} (expected all|orphaned)`, true)
    const scope = scopeArg as "all" | "orphaned"
    const limit = Number(args.limit ?? 20)
    // M35.S2: live derived findings carry staleness truth — flagged per
    // finding, never silently presented as current. History (above) keeps its
    // recorded state; staleness applies to live reads only.
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    if (scope === "orphaned") {
      // Default 0, not 0.6. Orphan confidence is now EVIDENCE-DERIVED and spans
      // [0.30, 0.70] for symbols and [0.30, 0.55] for files, so a 0.6 default
      // would drop most symbol findings AND every single file finding — the
      // silent whole-rule loss this tool had before, re-created because the
      // number was left in place while the scale underneath it changed. With
      // 0, everything the scan found is reported and the ranking decides the
      // order; a caller who wants only the strongest passes 0.6 and gets them.
      const threshold = args.confidenceThreshold == null ? 0 : Number(args.confidenceThreshold)
      const report = await detectOrphans(projectId, { minConfidence: threshold, maxResults: Math.max(limit, 100) })
      const items = report.findings.slice(0, limit)
      const derived = derivedStaleness(rawDb, projectId as any, items.map((f) => f.location.file))
      const lines = items.map((f) => `  ${f.rule} ${f.location.symbol || f.location.file} — ${f.location.file}:${f.location.line} (${Math.round(f.confidence * 100)}%)${derived.isStale(f.location.file) ? " [stale]" : ""}`)
      // The census, not the page. This used to print summary.total, which IS
      // the engine's page length (100), while printing 20 lines: "orphaned code
      // (100)" above twenty findings, with nothing saying where the other 80
      // went or how many existed. Every number is now named, including what
      // the scan suppressed and why — a report of 0 is only honest if the
      // reader can see that it was not caused by suppression.
      const census = Number(report.summary?.candidatesTotal ?? items.length)
      const byRule = Object.entries(report.summary?.candidatesByRule ?? {} as Record<string, number>)
        .sort((a: any, b: any) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")
      const suppressed = (report.summary as any)?.suppressedByReason as Record<string, number> | undefined
      const suppressedLine = suppressed
        ? `\n[suppressed: ${Object.entries(suppressed).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(" ") || "nothing"}]`
        : ""
      const prov = `\n[provenance: ${report.provenance.evidenceClass} via ${report.provenance.engine}; scanned ${report.summary?.scannedSymbols ?? 0} symbol(s) in ${report.summary?.scannedFiles ?? 0} file(s); limitations: ${report.provenance.limitations.length}]`
      const countLine = `\n[scan: ${census} orphan candidate(s) ${byRule ? `(${byRule})` : ""}; showing ${items.length}${census > items.length ? ` — raise \`limit\` to see more` : ""}]`
      const footer = derived.footer ? `\n${derived.footer}` : ""
      return textResult(`orphaned code (${census} found):\n${lines.join("\n") || "  none"}${countLine}${suppressedLine}${prov}${footer}`)
    }
    const result: any = await PatternBrainTools.detectPatterns(projectId, {
      includeOrphaned: args.includeOrphaned !== false,
      includeFramework: args.includeFramework !== false,
      includeAntiPatterns: args.includeAntiPatterns !== false,
      confidenceThreshold: args.confidenceThreshold == null ? 0 : Number(args.confidenceThreshold),
      maxResults: Math.max(limit, 100),
    })
    const allPatterns = result?.patterns ?? []
    const items = allPatterns.slice(0, limit)
    const derived = derivedStaleness(rawDb, projectId as any, items.map((item: any) => item.location?.file))
    const lines = items.map((item: any) => `  [${item.severity}] ${item.type} @ ${item.location?.file}:${item.location?.line} (${Math.round(item.confidence * 100)}%)${derived.isStale(item.location?.file) ? " [stale]" : ""}`)
    const stalenessFooter = derived.footer ? `\n${derived.footer}` : ""
    // The census and the page are different numbers and the header used to
    // print neither: it printed statistics.totalFound, which was the page
    // length, under the words "patterns (N)". With the default limit of 20 the
    // tool fetched 100, printed 20 and said 100. All three numbers are now
    // named.
    const census = Number(result?.scan?.findingsBeforeDisplayLimit ?? result?.statistics?.totalFound ?? allPatterns.length)
    const typeCounts = Object.entries(result?.statistics?.byType ?? {} as Record<string, number>)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([t, n]) => `${t}=${n}`)
    const countLine = `\n[scan: ${census} finding(s) across ${typeCounts.join(" ") || "no"} rule(s); showing ${items.length}${census > items.length ? ` — raise \`limit\` to see more` : ""}]`
    if (args.recordRun === true) {
      // The comment below used to claim the FULL analyzed set was persisted.
      // It was not: M57.T3 bounded the page inside detectPatterns, so
      // allPatterns was min(census, max(limit,100)) and the auto-resolve pass
      // would mark every finding past the page as resolved on the next run —
      // the exact failure the comment said it prevented. recordRun therefore
      // re-scans for the whole census. The cost is one finding object per
      // census entry, which is why it is only paid on this path; the cap keeps
      // a pathological project from exhausting memory, and the response says so
      // if the cap was hit.
      const RECORD_RUN_CENSUS_CAP = 50_000
      const full: any = await PatternBrainTools.detectPatterns(projectId, {
        includeOrphaned: args.includeOrphaned !== false,
        includeFramework: args.includeFramework !== false,
        includeAntiPatterns: args.includeAntiPatterns !== false,
        confidenceThreshold: args.confidenceThreshold == null ? 0 : Number(args.confidenceThreshold),
        maxResults: RECORD_RUN_CENSUS_CAP,
      })
      const censusPatterns: any[] = full?.patterns ?? []
      const recorded = await executeAnalysis({
        projectId,
        kind: "patterns",
        input: { options: args },
        // Persist the FULL analyzed set, never the display slice: recorded
        // history must reflect the run, not the truncated preview. Otherwise
        // findings past `limit` would be silently auto-resolved on the next
        // run even though they still exist.
        persist: () => censusPatterns.map((item: any): AnalysisFindingInput => ({
          fingerprint: item.fingerprint ?? `${item.type}:${item.location?.file ?? "?"}:${item.location?.line ?? "?"}`,
          rule: item.type ?? "pattern",
          title: item.description ?? item.type ?? "pattern finding",
          severity: item.severity ?? "info",
          confidence: item.confidence ?? null,
          evidence: item.evidence ?? [],
          location: item.location?.file ? `${item.location.file}:${item.location.line ?? "?"}` : null,
        })),
      })
      const found = full?.statistics?.totalFound ?? censusPatterns.length
      const capped = found > RECORD_RUN_CENSUS_CAP
      const capNote = capped ? ` — CAPPED at ${RECORD_RUN_CENSUS_CAP}; ${found} findings exist and ${found - RECORD_RUN_CENSUS_CAP} were not recorded, so they will be auto-resolved on the next run` : ""
      return textResult(`patterns (${found} found, ${recorded.report.run.findingCount} recorded) recorded run ${recorded.report.run.id}: new=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}${capNote}\n${lines.join("\n") || "  none"}${countLine}${stalenessFooter}`)
    }
    return textResult(`patterns (${census} found):\n${lines.join("\n") || "  none"}${countLine}${stalenessFooter}`)
}
