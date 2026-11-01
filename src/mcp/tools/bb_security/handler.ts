// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_security — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_security (see src/mcp/tools/bb_security/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_security.md, docs/BB_*.md for its guide page, validation/tools/bb_security/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_security/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_security.md, and its gate scripts.
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
      const history = await getAnalysisHistory(projectId, "security", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    // A1: `recordRun` persists a SNAPSHOT whose completeness decides whether
    // still-real findings are auto-resolved. `completeAnalysisRun` marks every
    // prior `open` finding that is absent from the persisted set as `resolved`,
    // so a scan capped at the engine default (500) silently resolved everything
    // past 500 on a project that really had them. `bb_patterns` already guards
    // this with a census cap + a cap note (tool-handlers.ts:1174-1224); the
    // security path had no guard at all. Recording asks for a census-sized
    // scan; the DISPLAY still renders the ordinary window.
    const recordRun = args.recordRun === true
    const result: any = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(
      projectId,
      { maxResults: recordRun ? SECURITY_RECORD_RUN_CENSUS_CAP : SECURITY_SCAN_CAP },
    )
    const findings = result?.findings ?? []
    const suspicious = result?.suspiciousSources ?? []
    const summary = result?.summary
    // M35.S2: a stale taint/flow finding says so — security honesty. History
    // paths (above) keep their recorded state; this is the live read.
    //
    // B3: the unvalidated-source rows are ALSO derived from indexed files, so
    // they are resolved for freshness too. They were left out, which presented
    // stale observations as current fact. `derivedStaleness` filters null, and
    // `file` is now honestly `null` when neither endpoint resolved (it was the
    // `"?"` sentinel, which resolved to nothing and counted as `missing`).
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    const derived = derivedStaleness(rawDb, projectId as any, [...findings, ...suspicious].map((f: any) => f.file))
    // A1: the engine's own census vs. what is on screen. Silence here is what
    // made a 5000-flow project read as "20 findings" with no indication that
    // 4980 were unseen — the same contract bb_visualize and bb_search use.
    const capNote = result?.truncatedFindings > 0
      ? ` — CAPPED at ${(recordRun ? SECURITY_RECORD_RUN_CENSUS_CAP : SECURITY_SCAN_CAP).toLocaleString("en-US")}; ${result.deduplicatedFlows} findings exist and ${result.truncatedFindings} were not examined`
      : ""
    const countLine =
      `\n[scan: ${result?.scannedFlows ?? 0} taint flow(s) indexed → ${result?.deduplicatedFlows ?? 0} finding(s)` +
      `${result?.truncatedFindings ? ` (${result.truncatedFindings} beyond the cap)` : ""};` +
      ` showing ${Math.min(findings.length, SECURITY_FINDINGS_WINDOW)} finding(s)` +
      `${suspicious.length ? ` and ${Math.min(suspicious.length, SECURITY_SUSPICIOUS_WINDOW)} of ${suspicious.length} unvalidated observation(s)` : ""}]`
    // B2: the severity counts are the indexer's, and `taint.ts` now normalizes
    // severity into exactly these five buckets, so the head line cannot print
    // "0 critical" above a list of critical findings.
    const head = summary
      ? `security: ${summary.critical} critical / ${summary.high} high / ${summary.medium} medium / ${summary.low} low${summary.unknown ? ` / ${summary.unknown} unknown` : ""} (${summary.resolved} resolved flows, ${summary.unresolvedSources} unvalidated sources, ${summary.mitigated} mitigated)`
      : `security findings (${findings.length})`
    const where = (f: any) => (f.file ? `${f.file}:${f.line ?? "?"}` : "<unresolved location>")
    const lines = findings.slice(0, SECURITY_FINDINGS_WINDOW).map(
      (finding: any) => `  [${finding.severity}] ${finding.label ?? finding.type}${finding.symbol ? ` (${finding.symbol})` : ""} @ ${where(finding)}${finding.sourceType ? ` <- ${finding.sourceType}` : ""}${finding.sinkType ? ` -> ${finding.sinkType}` : ""}${finding.mitigated ? " [mitigated]" : ""}${finding.file && derived.isStale(finding.file) ? " [stale]" : ""}`,
    )
    // B1: the two observation states are DIFFERENT facts and were rendered with
    // one sentence. `source_only` genuinely has no sink ("no sink reached").
    // `unresolved` has a RESOLVED SINK and is missing the source — the old
    // text claimed the opposite for it, on the exact rows the indexer's
    // heuristic detectors produce (they write `source_symbol_id = NULL`).
    // B2 again: these rows carry the indexer's real severity (an isolated
    // command-injection sink is `critical`) and were all printed as `[info]`.
    const sourceLines = suspicious.slice(0, SECURITY_SUSPICIOUS_WINDOW).map((source: any) => {
      const isSourceOnly = source.state === "source_only"
      return `  [${source.severity}] unvalidated ${isSourceOnly ? "input source" : "sink"}: ${source.label ?? source.type}${source.symbol ? ` ${source.symbol}` : ""} @ ${where(source)} (${isSourceOnly ? "no sink reached" : "sink found; source endpoint not resolved to an indexed symbol"})${source.file && derived.isStale(source.file) ? " [stale]" : ""}`
    })
    if (recordRun) {
      const findingCount = findings.length
      const recorded = await executeAnalysis({
        projectId,
        kind: "security",
        input: { options: args },
        persist: () => findings.map((finding: any): AnalysisFindingInput => ({
          // A7: the persisted identity must be stable across runs AND distinct
          // per sink. The old key was `file:line:label`, which put a DISPLAY
          // label in the identity: re-labelling a vulnerability type would
          // resolve the old finding and mint a new one for a flow that never
          // changed. The key is now the normalized type + sink type + location,
          // so re-grading `severity` is a repeat and only a genuine move or
          // change of vulnerability type produces a new row.
          fingerprint: `taint:${finding.type}:${finding.sinkType ?? "?"}:${finding.file ?? "?"}:${finding.line ?? "?"}`,
          rule: finding.type ?? "security",
          title: finding.label ?? finding.type ?? "security finding",
          severity: finding.severity ?? "medium",
          // A7: the engine calibrates 0.7/0.4/0.3 by state; the legacy mapping
          // dropped it, so this read `?? null` and every persisted security
          // finding recorded NULL confidence.
          confidence: typeof finding.confidence === "number" ? finding.confidence : null,
          // A7: likewise `evidence` was always `[]` — history recorded security
          // findings with no evidence at all.
          evidence: finding.evidence ?? [],
          limitations: finding.limitations ?? [],
          evidenceClass: "static_finding",
          engine: "taint@intelligence",
          location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
          state: finding.mitigated ? "mitigated" : undefined,
        })),
      })
      return textResult(head + `\nrecorded run: ${recorded.report.run.id}\nnew=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}` + "\n" + `${findingCount} findings recorded${capNote}` + (lines.length ? "\n" + lines.join("\n") : "") + countLine + (sourceLines.length ? `\n\nunvalidated sources (not persisted):\n${sourceLines.join("\n")}` : "") + (derived.footer ? `\n${derived.footer}` : ""))
    }
    // The zero-findings case still states the census. "clean" alone is
    // indistinguishable from "found nothing" when the scan was capped or the
    // index has no taint rows at all, and those are very different facts.
    return textResult(head + "\n" + (lines.length ? lines.join("\n") : "  no findings with both endpoints resolved") + countLine + (sourceLines.length ? `\n\nunvalidated observations (leads, not confirmed exploitable paths):\n${sourceLines.join("\n")}` : "") + (derived.footer ? `\n\n${derived.footer}` : ""))
}
