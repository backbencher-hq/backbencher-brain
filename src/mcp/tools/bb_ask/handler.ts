// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_ask — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_ask (see src/mcp/tools/bb_ask/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_ask.md, docs/BB_*.md for its guide page, validation/tools/bb_ask/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_ask.md, and its gate scripts.
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
    const limit = Number(args.limit ?? 5)
    const result = await quickAnswer(projectId, String(args.query), { limit })

    // HONESTY FIX (critical; measured on 9 real repositories). This handler
    // appended `no semantic matches for "<query>"` whenever `sources` was empty
    // — and `sources` is empty BY DESIGN on every verified-aggregate path, so
    // the tool printed a correct count and then denied it two lines later:
    //
    //   answer: There are 786 symbols in this project
    //   no semantic matches for "how many symbols are in this project?"
    //
    // "No matches" is a true statement only about a RETRIEVAL answer that found
    // nothing. It is false about an exact aggregate, and also false for
    // `limit: 0`, where the caller explicitly asked for no rows. The route is
    // what makes the difference, and quickAnswer declares it.
    const retrievalAnswer = result.route === "retrieval" || result.route === "symbol-name"
    const parts: string[] = []
    if (result.answer) parts.push(`answer: ${result.answer}`)

    // Confidence was computed on every path and thrown away. Surface it: an
    // aggregate is exact, a retrieval answer is bounded well below certainty,
    // an unknown is 0.1. A reader can now tell them apart.
    parts.push(`confidence: ${result.confidence}`)

    const shown = result.sources.slice(0, limit)
    if (shown.length) {
      parts.push(shown.map((source, index) => `${index + 1}. ${source.file}:${source.line}\n   ${source.context ?? ""}`).join("\n"))
    } else if (retrievalAnswer) {
      parts.push(limit > 0
        ? `no matches for "${args.query}" in the index`
        : `limit was 0, so no matches were requested or returned`)
    }

    // Retrieval facts the engine already computed. Without these the caller
    // cannot tell a production embedding's cosine from the offline
    // 50-dimension word-vector one — the difference between "semantic" and
    // "lexical with a decimal point".
    if (result.retrieval) {
      const r = result.retrieval
      const bits = [`method=${r.method}`, `queryModel=${r.queryModel}`, `indexModel=${r.indexModel}`]
      if (r.dimension > 0) bits.push(`dimension=${r.dimension}`)
      bits.push(`embeddingCoverage=${Math.round(r.embeddingCoverage.ratio * 100)}% (${r.embeddingCoverage.embedded}/${r.embeddingCoverage.symbols} symbols embedded)`)
      if (r.fallbackReason) bits.push(`reason=${r.fallbackReason}`)
      if (r.discriminative === false) bits.push(`ranking=non-discriminative (${r.nonDiscriminativeCompetitors ?? 0} within the margin of the best)`)
      parts.push(`[retrieval: ${bits.join(", ")}]`)
    }

    const prov = `[provenance: ${result.provenance.evidenceClass} via ${result.provenance.engine} (${result.route})${result.provenance.unknowns.length ? `; unknowns: ${result.provenance.unknowns.join("; ")}` : ""}]`
    parts.push(prov)
    return textResult(parts.join("\n\n"))
}
