// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_migrate — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_migrate (see src/mcp/tools/bb_migrate/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_migrate.md, docs/BB_*.md for its guide page, validation/tools/bb_migrate/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_migrate/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_migrate.md, and its gate scripts.
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

export const handler: ToolHandler = async (args, { projectId, projectPath }) => {
    const symbolNames = Array.isArray(args.symbolNames) ? args.symbolNames.map(String) : args.symbolName ? [String(args.symbolName)] : []
    // A file or directory path joins the request, so a whole module can be
    // planned in one call. Union with symbolNames, not a replacement: naming a
    // symbol AND a path that contains it plans it once.
    // A path inside the project is accepted however the caller spells it. An
    // agent holding an absolute path is not wrong, and rejecting it taught
    // nothing except that the tool wants a different string than the one that
    // works everywhere else. A path OUTSIDE the project is still refused by the
    // resolver, which is where the project boundary actually lives.
    const projectRoot = path.resolve(String(projectPath ?? "."))
    const normalizeCohortPath = (raw: string): string => {
      const value = String(raw ?? "").trim().replace(/\\/g, "/")
      if (!value) return value
      const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value)
      const relative = path.relative(projectRoot, absolute).replace(/\\/g, "/")
      return relative === "" ? "." : relative.startsWith("..") ? value : relative
    }
    const paths = Array.isArray(args.paths) ? args.paths.map(normalizeCohortPath) : []
    // An indexed symbol id is the only unambiguous way to name a component, and
    // it is what the ambiguity refusal points at. Accepting it is what makes
    // that advice true instead of aspirational.
    const symbolIds = Array.isArray(args.symbolIds) ? args.symbolIds.map(String).map((id) => id.trim()).filter(Boolean) : []
    if (!symbolNames.length && !paths.length && !symbolIds.length) return textResult("bb_migrate requires one of symbolNames (or symbolName), symbolIds, or paths, and targetLanguage", true)
    if (!args.targetLanguage) return textResult("bb_migrate requires targetLanguage", true)
    const result = await generateMigrationPlans(projectId, { symbolNames, symbolIds, paths, targetLanguage: String(args.targetLanguage) })
    // A path that matched no indexed file is reported by name. Without this a
    // typo'd path is indistinguishable from a directory with no symbols in it,
    // and both look like a clean empty answer.
    const unmatchedIds = (result.unsupported ?? []).filter((u: any) => u.unsupportedReason === "missing-symbol").map((u: any) => u.symbolName)
    // ANY unmatched id refuses, matching how an unmatched path behaves: a
    // partially-resolved request reads like a complete answer otherwise.
    if (symbolIds.length && unmatchedIds.length > 0) {
      return textResult(`bb_migrate: no indexed symbol carries the id(s) ${unmatchedIds.map((id: string) => `"${id}"`).join(", ")}. Ids come from an earlier result's plans or from an ambiguity refusal's candidates.`, true)
    }
    if (paths.length && result.cohort?.pathsUnmatched?.length) {
      return textResult(`bb_migrate: no indexed file matches ${result.cohort.pathsUnmatched.map((p: string) => `"${p}"`).join(", ")}. Paths are project-relative; check the spelling against the project root.`, true)
    }
    // M35.S3: a migration plan is a claim about CURRENT code. Resolve each
    // plan's source file and flag plans whose file changed since the index —
    // a stale plan says so up front instead of silently planning against
    // outdated symbols.
    //
    // M53: the file now comes from the plan's OWN symbol, which the planner
    // records. The previous code re-queried `brain_symbol` by lower-cased NAME
    // and kept the first matching row, so when two symbols shared a name the
    // plan was computed for one symbol while the staleness verdict came from
    // whichever file that name query happened to hit first.
    const migRaw = await BrainDatabase.getRawInstance(projectId as any)
    const planFiles = new Set<string>()
    for (const p of result.plans as any[]) {
      const file = typeof p.sourceFile === "string" ? p.sourceFile : ""
      if (file && file !== "unknown") planFiles.add(file)
    }
    const migFiles = [...planFiles]
    const migRelToId = new Map<string, string>()
    if (migFiles.length) {
      for (const r of migRaw.prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${migFiles.map(() => "?").join(",")})`).all(projectId, ...migFiles) as Array<{ id: string; relative_path: string }>) {
        migRelToId.set(r.relative_path, r.id)
      }
    }
    const migRows = migFiles.map((p) => ({ fileId: migRelToId.get(p) ?? null }))
    const migDetail = migRows.length ? resolveRowsFreshnessDetailed(migRaw, projectId as any, migRows) : null
    const migStatuses = migDetail?.statuses ?? new Map<string, string>()
    const migStatus = (rel: string | undefined) => (rel ? migStatuses.get(migRelToId.get(rel) ?? "") ?? "missing" : "missing")
    for (const p of result.plans as any[]) {
      p.stale = migStatus(typeof p.sourceFile === "string" ? p.sourceFile : undefined) === "stale"
    }
    // A plan whose source file could not be resolved counts as `missing`, not
    // `fresh`. Previously such plans were dropped from the envelope entirely, so
    // a request whose files were all unresolvable reported a clean 0/0/0.
    const unresolvedPlans = (result.plans as any[]).filter((p) => !p.sourceFile || p.sourceFile === "unknown").length
    const migSummary = {
      fresh: migRows.filter((r) => migStatuses.get(r.fileId ?? "") === "fresh").length,
      stale: migRows.filter((r) => migStatuses.get(r.fileId ?? "") === "stale").length,
      missing: migRows.filter((r) => migStatuses.get(r.fileId ?? "") !== "fresh" && migStatuses.get(r.fileId ?? "") !== "stale").length + unresolvedPlans,
    }
    const migEnvelopeSource = { ...migSummary, staleRatio: migRows.length ? (migSummary.stale + migSummary.missing) / migRows.length : 0, freshnessMode: "complete" as const }
    const stalePlans = (result.plans as any[]).filter((p) => p.stale).length
    if (args.format === "json") {
      const parsed = JSON.parse(formatMigrationPlans(result, "json"))
      parsed.freshness = buildStalenessEnvelope(migEnvelopeSource, { kind: "dir" })
      return textResult(JSON.stringify(parsed, null, 2))
    }
    const migOut = formatMigrationPlans(result, "text")
    const migNotice = stalePlans > 0 ? `⚠ ${stalePlans} of ${result.plans.length} plans reference files changed since the last index — reindex before acting on these plans.\n\n` : ""
    const migFooter = migSummary.stale + migSummary.missing > 0 ? `\n\n${migSummary.stale} stale, ${migSummary.missing} missing of ${migRows.length} plan files — ${FRESHNESS_REMEDIATION.dir}` : ""
    return textResult(migNotice + migOut + migFooter)
}
