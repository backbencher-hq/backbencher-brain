// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_annotations — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_annotations (see src/mcp/tools/bb_annotations/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotations.md, docs/BB_*.md for its guide page, validation/tools/bb_annotations/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotations/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_annotations.md, and its gate scripts.
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

  // M28.A1 read door: every row carries its provenance; absence is declared.
  //
  // `path` mirrors the write's disambiguation. It used to be write-only, so a
  // symbol that lives in several files (measured on a real corpus: `force` in 8
  // files, `toString` in 6) returned every file's notes mixed together with no
  // way to ask for one file's note — and the editor hover, which also keyed on
  // symbol_name alone, showed another file's note as if it belonged to the file
  // under the cursor. A path filter here returns the notes for THAT file's copy
  // of the symbol together with any NAME-level notes (written with no path),
  // because a name-level note applies wherever the name appears. Every row
  // still carries its own `symbol_path`, so a caller that wants the raw set can
  // always narrow further.
export const handler: ToolHandler = async (args, { projectId }) => {
    const symbol = args.symbol === undefined || args.symbol === null || String(args.symbol).trim() === "" ? null : String(args.symbol).trim()
    const givenPath = args.path === undefined || args.path === null || String(args.path).trim() === "" ? null : String(args.path)
    // A `path` filter with no symbol asks "what has been said about this file".
    // The predicate also matched every NAME-LEVEL note in the project, because a
    // name-level note does apply wherever the name appears — but that made the
    // narrow question answer mostly-global: measured on cobra, a path read
    // returned 2 notes for the file and 48 name-level notes from the whole
    // project, and under the default limit the file's own notes were nearly cut
    // off. The file's own notes are now the default answer, and the name-level
    // set is one explicit flag away rather than an unrequested mixture.
    const includeNameLevel = args.includeNameLevel === true
    const limitRaw = args.limit === undefined || args.limit === null ? 50 : Number(args.limit)
    if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > 200) return textResult("bb_annotations: limit must be a number between 1 and 200", true)
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    const limit = Math.floor(limitRaw)
    // The same canonicalization the write door applies, so a reader that filters
    // by `./src/a.ts` finds the note a writer stored as `src/a.ts`.
    const canonicalPath = givenPath === null ? null : canonicalFilePath(raw, projectId, givenPath).path
    // A reader asking for a symbol finds notes written under EITHER name form the
    // editor accepts, and in BOTH directions: the requested name is resolved to
    // the set of stored names of every symbol it names (its simple name AND its
    // qualified name), and a note matches when its symbol_name is in that set.
    // This is exactly the set the hover selects, so the reader and the editor can
    // never disagree about which notes exist. Asking for the qualified name finds
    // the simple-name note, and vice versa.
    const matchingNames = symbol
      ? (raw.prepare(
          `SELECT DISTINCT name AS n FROM brain_symbol WHERE project_id = ? AND (name = ? OR qualified_name = ?)`,
        ).all(projectId, symbol, symbol) as Array<{ n: string }>).map((r) => r.n)
      : []
    // No indexed symbol carries the name at all: fall back to a literal match so a
    // note stored under an arbitrary name is still findable by that name.
    const namePredicate = symbol
      ? (matchingNames.length > 0
        ? `symbol_name IN (${matchingNames.map(() => "?").join(",")})`
        : "symbol_name = ?")
      : null
    const nameParams: unknown[] = symbol
      ? (matchingNames.length > 0 ? [...matchingNames] : [symbol])
      : []
    const COLUMNS = "id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated"
    // The ORDER BY carries a deterministic tiebreak: several agents writing in
    // the same millisecond share a time_updated, and without a second key their
    // relative order is whatever SQLite happens to produce, so "read back what
    // I just wrote" is not reproducible.
    const ORDER = "ORDER BY time_updated DESC, id"
    // The flag governs the PATH-ONLY shape only. With a symbol as well, a
    // name-level note about THAT symbol genuinely applies — it is about the symbol
    // the caller asked for, not a global answer — so the symbol+path shape keeps
    // including it regardless of the flag. Applying the flag to both shapes
    // silently changed that already-correct behaviour, and the round-1 suite
    // caught the regression.
    const pathOnlyClause = includeNameLevel ? "(symbol_path = ? OR symbol_path IS NULL)" : "symbol_path = ?"
    const symbolPathClause = "(symbol_path = ? OR symbol_path IS NULL)"
    let where: string
    let params: unknown[]
    if (symbol && canonicalPath !== null) {
      where = `project_id = ? AND ${namePredicate} AND ${symbolPathClause}`
      params = [projectId, ...nameParams, canonicalPath]
    } else if (symbol) {
      where = `project_id = ? AND ${namePredicate}`
      params = [projectId, ...nameParams]
    } else if (canonicalPath !== null) {
      where = `project_id = ? AND ${pathOnlyClause}`
      params = [projectId, canonicalPath]
    } else {
      where = `project_id = ?`
      params = [projectId]
    }
    const rows = raw.prepare(`SELECT ${COLUMNS} FROM brain_annotation WHERE ${where} ${ORDER} LIMIT ?`).all(...params, limit) as any[]
    // M48/M63 house rule for every bounded read: a short page is never mistaken
    // for a complete one. This door returned only `count` (the page size), so a
    // project with 300 notes and the default limit answered a flat `count: 50`
    // with no way to know 250 more existed. Declared here the same way bb_search
    // and bb_graph declare it.
    const totalCountIfKnown = (raw.prepare(`SELECT COUNT(*) AS c FROM brain_annotation WHERE ${where}`).get(...params) as any).c
    const truncated = totalCountIfKnown > rows.length
    return textResult(JSON.stringify({
      symbol,
      path: canonicalPath,
      includeNameLevel: symbol !== null || includeNameLevel,
      annotations: rows,
      count: rows.length,
      totalCountIfKnown,
      truncated,
      truncationReason: truncated ? `limit ${limit} reached; ${totalCountIfKnown} annotations match this query. Raise limit (max 200) or narrow the filter.` : null,
      declaredAbsent: rows.length === 0,
      absenceNote: rows.length === 0
        ? (symbol && canonicalPath !== null
          ? `no annotations stored for '${symbol}' in '${canonicalPath}' — absence declared, never guessed`
          : symbol
            ? `no annotations stored for '${symbol}' — absence declared, never guessed`
            : canonicalPath !== null
              ? `no annotations stored for '${canonicalPath}' — absence declared, never guessed`
              : "no annotations stored for this project yet")
        : null,
    }, null, 2))
}
