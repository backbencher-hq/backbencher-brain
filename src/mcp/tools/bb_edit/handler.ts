// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_edit — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_edit (see src/mcp/tools/bb_edit/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_edit.md, docs/BB_*.md for its guide page, validation/tools/bb_edit/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_edit/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_edit.md, and its gate scripts.
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
    const request = args as EditRequest
    if (!(["write", "update", "insert", "delete", "refactor", "batch"] as const).includes(request.mode as any)) return textResult("bb_edit requires mode: write|update|insert|delete|refactor|batch", true)
    try {
      const result = await executeEdit(projectPath, projectId, request)
      return textResult(JSON.stringify(result, null, 2))
    } catch (e: any) {
      // M48.C2 (#700): a refused edit returns a rollback envelope instead of
      // throwing — the engine restores the pre-edit bytes before raising, and
      // a throw out of the handler crashes hosts that do not wrap errors.
      //
      // M66: `rolledBack` was HARDCODED true, which is a claim the handler cannot
      // support. The engine's rollback restores each file in its own try/catch so
      // that one unwritable file cannot abandon the rest, and when any restore
      // fails it attaches the list to the error and says so in the message —
      // which this handler then reported next to `rolledBack: true`. The same JSON
      // object asserted both "these files were NOT restored" and "rolledBack:
      // true". A boolean that is always true is not a status; it is decoration,
      // and it is the field a caller would use to decide whether their working
      // tree is safe.
      //
      // The honest reading: the tree is in its pre-edit state either because the
      // rollback succeeded or because no write had been attempted yet, so `true`
      // is right for the ordinary refusal. It is wrong exactly when a restore
      // failed, and that is now read from the error rather than assumed.
      const rollbackFailures: string[] = Array.isArray(e?.rollbackFailures) ? e.rollbackFailures : []
      return textResult(JSON.stringify({
        ok: false,
        mode: request.mode,
        error: e?.message ?? String(e),
        rolledBack: rollbackFailures.length === 0,
        ...(rollbackFailures.length > 0 ? { rollbackFailures } : {}),
        // M71.D13: the per-file answer to "is my working tree back?". The engine
        // attaches it to the error, measured from disk after the restore loop; a
        // single boolean over a batch of files cannot answer it, and this is the
        // field a caller holding a half-applied batch needs first.
        ...(e?.envelope ? { envelope: e.envelope } : {}),
      }, null, 2), true)
    }
}
