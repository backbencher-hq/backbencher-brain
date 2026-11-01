// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_impact — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_impact (see src/mcp/tools/bb_impact/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_impact.md, docs/BB_*.md for its guide page, validation/tools/bb_impact/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_impact/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_impact.md, and its gate scripts.
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
    const symbol = String(args.symbol ?? "")
    if (!symbol) return textResult("bb_impact requires symbol", true)
    const relationshipTypes: string[] | undefined =
      Array.isArray(args.relationshipTypes) ? args.relationshipTypes.map((t: unknown) => String(t)) : undefined
    // The caller's defining-file hint, when it sent one. Optional, and a REFUSAL
    // input rather than a preference: the component either resolves the name at
    // this identity or rejects the hint, so a same-named copy is never silently
    // substituted.
    const memberFile = typeof args.file === "string" && args.file.trim().length > 0 ? args.file : undefined
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    try {
      // M63.T2: ONE list, handed to the component, which hands it to BOTH its
      // walks. The engine's default is every stored kind, so a filter is a real
      // choice rather than an accident of a default — and the answer states
      // which rule it applied.
      // Freshness is resolved over the files the answer is actually ABOUT — the
      // dependents' files plus the root's own. An answer about a symbol
      // describes a set of files, and those are the files that can be stale.
      // The path->id map is a property of the PROJECT, so it is built once and
      // both passes read it; building it per pass would make a refresh change
      // the map a stale answer was measured against.
      const idByPath = new Map<string, string>()
      for (const f of raw.prepare("SELECT id, path, COALESCE(relative_path,'') AS rel FROM brain_file WHERE project_id = ?").all(projectId) as Array<{
        id: string
        path: string
        rel: string
      }>) {
        idByPath.set(f.path, f.id)
        if (f.rel.length > 0) idByPath.set(f.rel, f.id)
      }
      const runPass = async (): Promise<{ impact: Awaited<ReturnType<typeof computeImpact>>; detail: ReturnType<typeof resolveRowsFreshnessDetailed>; rows: Array<{ fileId: string | null; filePath: string | null }> }> => {
        const impact = await computeImpact(raw, projectId as string, symbol, {}, memberFile, relationshipTypes ? { relationshipTypes } : {})
        const rows = [
          ...impact.impact.map((d) => ({ fileId: idByPath.get(d.filePath || d.file) ?? null, filePath: d.filePath || d.file || null })),
          { fileId: idByPath.get(impact.root.filePath || impact.root.file) ?? null, filePath: impact.root.filePath || impact.root.file || null },
        ]
        return { impact, detail: resolveRowsFreshnessDetailed(raw, projectId as any, rows), rows }
      }
      const first = await runPass()
      // The root's file is part of the question — "what breaks if I change
      // THIS" — so `runPass` already includes it in the rows, and the repair
      // set and the envelope both see it. Without that, a stale root with
      // fresh dependents renders as a clean answer.
      const staleFiles = collectStaleFiles(raw, first.rows, first.detail.statuses)
      let autoRefreshText = ""
      let pass = first
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        autoRefreshText = autoRefreshLine(decision)
        if (decision.action === "refreshed") {
          // Re-run so the answer is not built from the rows the repair just
          // replaced — the walk itself reads the index, so a refresh without a
          // second pass would report the pre-refresh graph.
          pass = await runPass()
        }
      }
      const impact = pass.impact
      const detail = pass.detail
      // M63.T1: the payload IS the component's result, plus the freshness of
      // the files it is about. Four things were missing, and all four are
      // load-bearing for a refactoring decision:
      //
      //   budget   was a literal `{maxNodes: 200, maxDepth: 5}` typed HERE
      //            while the component owned IMPACT_BUDGET. The numbers
      //            agreed and nothing kept them agreeing — the next person to
      //            change the budget would have changed this file too, or
      //            shipped a payload that lies about its own limits. It is
      //            the component's budget now, its ceilings included.
      //   counts   `directCount` is the depth-0 count (exact, or null when the
      //            counting walk hit a declared ceiling), and `traversal`
      //            carries what the answer was bounded by: the depth actually
      //            reached, the engine's own truncation state and reason, its
      //            per-query site limit, how many of its queries hit it, and
      //            the root's uncapped count when it could be computed. A
      //            reader can no longer mistake a 5-node prefix for a 200-node
      //            one, or `caller-budget-exhausted` for a per-symbol cap.
      //   identity `rootMatch` (requested / via / nameMatches) and the
      //            component's `resolution` ride the wire. The member→owner
      //            substitution that the editor panel renders has been
      //            invisible to every agent since M44.U5, and a containment
      //            match was invisible to everyone.
      //   stale    this surface reported NO freshness at all, on the one tool
      //            whose answer is acted on. "4 reverse dependencies" derived
      //            from a weeks-old index is a wrong number with no signal on
      //            it. Every dependent is flagged, the root's own file is
      //            declared (`rootStale`), and the envelope is attached — the
      //            same shape bb_analyze and the graph modes already use.
      //
      // A stale dependent is `true`/`false`; one whose file is not in the
      // index at all is `null`, which is a THIRD state and deliberately not
      // folded into the other two: "we could not check" is not "fresh".
      const dependents = impact.impact
      const rootRow = { fileId: idByPath.get(impact.root.filePath || impact.root.file) ?? null, filePath: impact.root.filePath || impact.root.file || null }
      for (let i = 0; i < dependents.length; i++) {
        const id = idByPath.get(dependents[i]!.filePath || dependents[i]!.file) ?? null
        dependents[i]!.stale = id ? detail.statuses.get(id) !== "fresh" : null
      }
      const rootStatus = rootRow.fileId ? (detail.statuses.get(rootRow.fileId) ?? "missing") : null
      const rootIsStale = rootStatus !== null && rootStatus !== "fresh"
      return textResult(
        JSON.stringify(
          {
            symbol,
            root: impact.root,
            rootStale: rootIsStale ? rootStatus : false,
            rootMatch: impact.rootMatch,
            resolution: impact.resolution,
            rule: impact.rule,
            budget: impact.budget,
            traversal: impact.traversal,
            cascade: impact.cascade,
            countVerification: impact.countVerification,
            reproducible: impact.reproducible,
            ...(autoRefreshText ? { autoRefresh: autoRefreshText } : {}),
            // The component's own bookkeeping does not ride the wire. `tracedId`
            // is the walk node a cascade row was found at — deciding `via` needs
            // it and a reader has no use for an opaque id, so the payload
            // publishes the DECLARED fact (`via`, `viaMember`) and not the
            // intermediate it was derived from. Everything else on a dependent is
            // a fact about the stored row or about the file.
            impact: dependents.map(({ tracedId: _internal, ...declared }) => declared),
            shownCount: impact.shownCount,
            directCount: impact.directCount,
            totalCountIfKnown: impact.totalCountIfKnown,
            truncated: impact.truncated,
            truncationReason: impact.truncationReason,
            freshness: buildStalenessEnvelope(detail.summary, { kind: "dir" }),
          },
          null,
          2,
        ),
      )
    } catch (error) {
      // The component's declared errors already carry the `bb/impact:` wire
      // prefix (the LSP twin's contract). This door names itself once, so the
      // message a caller reads has ONE prefix, not two.
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = rawMessage.startsWith("bb/impact:") ? rawMessage.slice("bb/impact:".length).trimStart() : rawMessage
      return textResult(`bb_impact: ${message}`, true)
    }
}
