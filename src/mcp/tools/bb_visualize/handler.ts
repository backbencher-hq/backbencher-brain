// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_visualize — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_visualize (see src/mcp/tools/bb_visualize/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_visualize.md, docs/BB_*.md for its guide page, validation/tools/bb_visualize/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_visualize/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_visualize.md, and its gate scripts.
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
    // M31.T1: no silent scope/target fallback. The validation layer rejects
    // scoped calls without a target; unknown scope strings here are a handler
    // bug and must fail loudly rather than masquerade as a project graph.
    const scope = String(args.scope ?? "project")
    if (!["project", "file", "module", "symbol", "feature"].includes(scope)) return textResult(`bb_visualize: unknown scope: ${scope}`, true)
    // M48.C2 (#700): every non-project scope needs a target — without one the
    // old path silently rendered a project-wide graph for a scoped request.
    if (scope !== "project" && !args.target) return textResult(`bb_visualize scope=${scope} requires a target`, true)
    // M13.F5 (#701): a bound is REFUSED, never quietly raised.
    //
    // MEASURED before: `maxNodes: 0` returned 1 node and echoed `truncation.maxNodes: 1` —
    // the caller asked for no nodes and was handed one. The project has already ruled on this
    // shape twice: `bb_health sampleSize: 0` was called out as "the caller asked to check no
    // files and was told one file was checked and clean", and `bb_analyze` REFUSES `limit: 0`
    // "because a returned page must mean the page that was asked for". The refusal names the
    // accepted range, so an over-budget caller learns the ceiling instead of silently
    // receiving a different page.
    const VIZ_MAX_NODES = 2000, VIZ_MAX_LINKS = 20000
    const boundRefusal = (name: "maxNodes" | "maxLinks", raw: unknown, ceiling: number, fallback: number): string | null => {
      if (raw == null) return null
      const asked = Number(raw)
      if (!Number.isInteger(asked) || asked < 1 || asked > ceiling) {
        return `bb_visualize: ${name} must be an integer between 1 and ${ceiling} (received ${JSON.stringify(raw)}) — a returned page must mean the page that was asked for, so an out-of-range budget is refused rather than clamped; omit ${name} for the default ${fallback}`
      }
      return null
    }
    const nodeRefusal = boundRefusal("maxNodes", args.maxNodes, VIZ_MAX_NODES, 200)
    if (nodeRefusal) return textResult(nodeRefusal, true)
    const linkRefusal = boundRefusal("maxLinks", args.maxLinks, VIZ_MAX_LINKS, 5000)
    if (linkRefusal) return textResult(linkRefusal, true)
    // A PAGE CURSOR is held to the same rule as a bound: whole and non-negative, refused
    // rather than normalised. A page that is not the page the caller asked for is the exact
    // defect `offset` exists to remove — and on a project larger than one page it is also how
    // a caller silently re-reads page 1 while believing they advanced.
    if (args.offset != null) {
      const asked = Number(args.offset)
      if (!Number.isInteger(asked) || asked < 0) {
        return textResult(`bb_visualize: offset must be a whole number >= 0 (received ${JSON.stringify(args.offset)}) — a page must mean the page that was asked for; omit offset to start at the first symbol`, true)
      }
    }

    // M13.F6/F7 (#701): a filter VALUE is checked against the index, and folded.
    //
    // MEASURED before: `languages: ["TypeScript"]` returned 0 nodes and declared "no indexed
    // symbol matches scope=project languages=[TypeScript]" while the index stored
    // `typescript`; and `relationshipTypes: ["call"]` (a typo for `calls`) left the nodes in
    // place and emptied the edge set, and the answer still described itself as "complete for
    // this node set" without naming the filter that had produced it. `bb_search` states the
    // rule for itself — "language and symbolKind are matched case-insensitively … and a value
    // the index does not contain is reported as an error rather than as zero results" — and
    // this now agrees with it.
    const vizVocabRaw = await BrainDatabase.getRawInstance(projectId as any)
    const storedLanguages = (vizVocabRaw.prepare("SELECT DISTINCT language AS v FROM brain_file WHERE project_id=? AND language IS NOT NULL AND language<>'' ORDER BY v").all(projectId) as any[]).map((r) => String(r.v))
    const storedRelationshipTypes = (vizVocabRaw.prepare("SELECT DISTINCT relationship_type AS v FROM brain_relationship WHERE project_id=? AND relationship_type IS NOT NULL AND relationship_type<>'' ORDER BY v").all(projectId) as any[]).map((r) => String(r.v))
    const storedSymbolKinds = (vizVocabRaw.prepare("SELECT DISTINCT symbol_type AS v FROM brain_symbol WHERE project_id=? AND symbol_type IS NOT NULL AND symbol_type<>'' ORDER BY v").all(projectId) as any[]).map((r) => String(r.v))
    const foldFilter = (label: string, values: unknown, stored: string[]): { folded?: string[]; refusal?: string } => {
      if (!Array.isArray(values) || values.length === 0) return {}
      const storedByLower = new Map(stored.map((value) => [value.toLowerCase(), value]))
      const folded: string[] = []
      const unknown: string[] = []
      for (const asked of values.map(String)) {
        const storedForm = storedByLower.get(asked.toLowerCase())
        if (!storedForm) unknown.push(asked)
        else if (!folded.includes(storedForm)) folded.push(storedForm)
      }
      if (unknown.length > 0) {
        return {
          refusal: `bb_visualize: unknown ${label}: ${unknown.join(", ")} — this index stores ${stored.length > 0 ? stored.join(", ") : "(no values recorded yet; index the project first)"}. ${label} are matched case-insensitively, and a value the index does not contain is reported as an error rather than as zero results.`,
        }
      }
      return { folded }
    }
    const languageFilter = foldFilter("languages", args.languages, storedLanguages)
    if (languageFilter.refusal) return textResult(languageFilter.refusal, true)
    const relationshipFilter = foldFilter("relationshipTypes", args.relationshipTypes, storedRelationshipTypes)
    if (relationshipFilter.refusal) return textResult(relationshipFilter.refusal, true)
    // M13.F17 (#701): the kinds a caller can ask for, checked against the index like every
    // other filter value. Without this the tool could only return whatever the index's ranking
    // put first — measured on this repository, 124 of 200 nodes are `constant` or `property`
    // and exactly one is a class, so "the architecture map" was a map of string constants with
    // no way to ask for the architecture and (before the census below) nothing saying so.
    const symbolKindFilter = foldFilter("symbolKinds", args.symbolKinds, storedSymbolKinds)
    if (symbolKindFilter.refusal) return textResult(symbolKindFilter.refusal, true)
    // The dependency graph is the only picture this tool draws. An unknown view is
    // REFUSED rather than silently answered as the graph — a caller asking for a
    // picture this tool does not draw must not receive a different picture.
    if (args.view != null && String(args.view) !== "graph") {
      return textResult(`bb_visualize draws only the dependency graph: unknown view ${JSON.stringify(String(args.view))}. Omit view or pass view "graph".`, true)
    }

    // M13.F1 (#701): the request drops NO published option. `excludePatterns` and
    // `includeTests` are in the descriptor, the schema and the docs, the engine
    // reads both and the renderer implements both — and this line used to build
    // the request from eight fields, so a caller who passed `excludePatterns`
    // got a bigger, differently-selected graph than they asked for, with an
    // `excluded` block whose `patterns` list contradicted their argument.
    // MEASURED through this handler: `excludePatterns:["src"]` left every src/
    // symbol in the answer, and `includeTests:false` still returned
    // test/app.test.ts with `includesTestFiles:true`. A filter the caller believes
    // is scoping results, and which does not, is worse than a rejection.
    const request: VisualizationRequest = { scope: scope as VisualizationScope, target: args.target ? String(args.target) : undefined, format: ["text", "json", "html"].includes(String(args.format)) ? args.format : "text", view: "graph", layout: ["regions", "force"].includes(String(args.layout)) ? (String(args.layout) as VisualizationLayout) : "regions", maxNodes: args.maxNodes == null ? undefined : Number(args.maxNodes), maxLinks: args.maxLinks == null ? undefined : Number(args.maxLinks), offset: args.offset == null ? undefined : Number(args.offset), relationshipTypes: relationshipFilter.folded, languages: languageFilter.folded, symbolKinds: symbolKindFilter.folded, excludePatterns: Array.isArray(args.excludePatterns) ? args.excludePatterns.map(String) : undefined, includeTests: typeof args.includeTests === "boolean" ? args.includeTests : undefined }
    const result = await visualizeProject(projectId, request)
    const htmlResults = [result]
    // M35.S3: per-node stale flags (node file changed since index); links
    // inherit worst-of-endpoints — a link is stale if EITHER endpoint's file
    // is stale (the edge crosses changed code on either side). Truncation
    // metadata is untouched so truncated AND stale are both visible.
    const vizRaw = await BrainDatabase.getRawInstance(projectId as any)
    const vizFiles = [...new Set(htmlResults.flatMap((viewResult) => (viewResult.nodes as any[]).map((n) => n.filePath)).filter((p: unknown): p is string => typeof p === "string" && p.length > 0 && p !== "unknown"))]
    const vizRelToId = new Map<string, string>()
    if (vizFiles.length) {
      for (const r of vizRaw.prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${vizFiles.map(() => "?").join(",")})`).all(projectId, ...vizFiles) as Array<{ id: string; relative_path: string }>) {
        vizRelToId.set(r.relative_path, r.id)
      }
    }
    const vizRows = vizFiles.map((p) => ({ fileId: vizRelToId.get(p) ?? null }))
    const vizDetail = vizRows.length ? resolveRowsFreshnessDetailed(vizRaw, projectId as any, vizRows) : null
    const vizStatuses = vizDetail?.statuses ?? new Map<string, string>()
    const vizStatus = (rel: string | undefined) => (rel ? vizStatuses.get(vizRelToId.get(rel) ?? "") ?? "missing" : "missing")
    const vizSummary = {
      fresh: vizRows.filter((r) => vizStatuses.get(r.fileId ?? "") === "fresh").length,
      stale: vizRows.filter((r) => vizStatuses.get(r.fileId ?? "") === "stale").length,
      missing: vizRows.filter((r) => vizStatuses.get(r.fileId ?? "") !== "fresh" && vizStatuses.get(r.fileId ?? "") !== "stale").length,
    }
    for (const viewResult of htmlResults) {
      for (const n of viewResult.nodes as any[]) n.stale = vizStatus(n.filePath) === "stale"
      const nodeById = new Map((viewResult.nodes as any[]).map((n) => [n.id, n]))
      for (const l of viewResult.links as any[]) {
        const s = nodeById.get(l.source)
        const t = nodeById.get(l.target)
        l.stale = (!!s && vizStatus(s.filePath) === "stale") || (!!t && vizStatus(t.filePath) === "stale")
      }
    }
    const vizEnvelopeSource = { ...vizSummary, staleRatio: vizRows.length ? (vizSummary.stale + vizSummary.missing) / vizRows.length : 0, freshnessMode: "complete" as const }
    // M13.F8 (#701): the envelope describes the index, and says so.
    //
    // MEASURED before: this handler hardcoded `{ kind: "dir" }` for all five scopes, so
    // `scope: "file"` emitted the PROJECT remediation while the generated page promised the
    // file one — and the string it emitted (the registered one) said reads "auto-refresh stale
    // files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false",
    // advertising a behaviour this path does not have (`maybeAutoRefresh` is never called
    // here) and an option its schema does not publish and validation rejects. The scope is now
    // the caller's, and `autoRefresh: false` selects the manual-only wording, which is what
    // this tool actually does.
    const vizEnvelopeScope = scope === "file"
      ? { kind: "file" as const, path: request.target, autoRefresh: false as const }
      : { kind: "dir" as const, autoRefresh: false as const }
    if (request.format === "json") {
      const parsed = JSON.parse(formatVisualization(result))
      parsed.freshness = buildStalenessEnvelope(vizEnvelopeSource, vizEnvelopeScope)
      return textResult(JSON.stringify(parsed, null, 2))
    }
    if (request.format === "html") {
      return textResult(renderVisualizationStudio({
        graph: formatVisualization(result),
      }))
    }
    const vizOut = formatVisualization(result)
    // The footer names the same scope and the same (manual) interface the envelope does.
    const vizFooter = vizSummary.stale + vizSummary.missing > 0
      ? `\n\n${vizSummary.stale} stale, ${vizSummary.missing} missing of ${vizRows.length} graph files — ${(scope === "file" ? FRESHNESS_REMEDIATION_MANUAL_ONLY.file.replace("<file>", request.target ?? "this file") : FRESHNESS_REMEDIATION_MANUAL_ONLY.dir)}`
      : ""
    return textResult(vizOut + vizFooter)
}
