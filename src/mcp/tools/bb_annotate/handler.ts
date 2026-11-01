// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_annotate — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_annotate (see src/mcp/tools/bb_annotate/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotate.md, docs/BB_*.md for its guide page, validation/tools/bb_annotate/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_annotate.md, and its gate scripts.
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

  // M28.A1 (issue #626, decision D-3): the agent's write door. Provenance is
  // enforced HERE, in code: author_class is always 'agent' for tool writes —
  // no argument can override it, so an agent note can never masquerade as a
  // human note. One note per author per location is enforced twice over: the id
  // is an INJECTIVE length-delimited hash of the location (the single owner is
  // src/brain/annotation-store.ts — the old '_'-flattening key aliased
  // `Foo.Bar` with `Foo_Bar` and silently destroyed the first note), and a
  // UNIQUE expression index on (project, symbol, author, COALESCE(path,''))
  // declares the same rule in the schema. The upsert targets the NATURAL key,
  // so a row written before the id scheme changed updates in place instead of
  // being duplicated.
export const handler: ToolHandler = async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "").trim()
    const body = String(args.body ?? "")
    const givenPath = args.path === undefined || args.path === null || String(args.path).trim() === "" ? null : String(args.path)
    const toolIdentity = String(args.toolIdentity ?? "bb_annotate(mcp)")
    if (!symbol) return textResult("bb_annotate requires symbol", true)
    if (!body.trim()) return textResult("bb_annotate requires a non-empty body — an empty note is a refusal, not a silent no-op", true)
    // Counted in code points, not UTF-16 units. The declared limit is "2000
    // chars", and String.length counts an astral character (an emoji, a CJK
    // extension glyph) as TWO, so a 1001-glyph note was refused under a limit
    // documented as 2000 characters. Measured against what a reader calls a
    // character, the limit is now the limit.
    const bodyChars = [...body].length
    if (bodyChars > 2000) return textResult(`bb_annotate: body exceeds the declared limit of 2000 chars (got ${bodyChars}) — declared refusal, not silent truncation`, true)
    // toolIdentity is recorded verbatim (an existing gate depends on that), but it
    // is a self-declared LABEL, not evidence, and it is returned beside the
    // ENFORCED author class as though the two carried equal weight. It is also
    // unbounded, so it is an unbounded row. A declared bound, not a truncation.
    if ([...toolIdentity].length > 200) return textResult(`bb_annotate: toolIdentity exceeds the declared limit of 200 chars (got ${[...toolIdentity].length}) — declared refusal`, true)
    // A tool identity is a NAME, not a document. Refusing line breaks and other
    // control characters keeps "recorded verbatim" honest (verbatim never meant "may
    // contain a newline") and keeps the stored label safe for every reader of it —
    // the editor hover, the graph badge, and bb_annotations. Measured: a newline in
    // this field rendered as a second provenance line that claimed to be a human note.
    if (/[\u0000-\u001F\u007F]/.test(toolIdentity)) return textResult("bb_annotate: toolIdentity must not contain control characters or line breaks — it is a name, not a document (declared refusal)", true)
    const now = Date.now()
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    // The path is resolved to the ONE spelling the index stores, so `./x` and
    // `/abs/project/x` land on the same row the editor selects. Stored verbatim,
    // they each created a note that never rendered.
    const canonical = canonicalFilePath(raw, projectId, givenPath)
    const annotationPath = givenPath === null ? null : canonical.path
    // Reachability is MEASURED against the index, not promised. The old reply
    // claimed the note "renders in the editor hover section and graph badge" for
    // EVERY note; measured on a real corpus, 100% of the qualified-name notes
    // matched no symbol name at all, so that claim was false exactly where it
    // sounded most confident.
    const reach = annotationReachability(raw, projectId, symbol)
    // The name matching is necessary but NOT sufficient: the editor also
    // requires the PATH to match, or to be absent. A note on a symbol the index
    // holds, written against a file it has never seen, can never be selected by
    // a file-scoped hover — so the two halves are combined here rather than
    // reported side by side while contradicting each other.
    const pathKnown = givenPath === null || canonical.matched
    const surfaced = reach.surfaced && pathKnown
    const statement = !reach.surfaced
      ? reach.statement
      : !pathKnown
        ? `'${symbol}' matches ${reach.matchedNames.length} indexed symbol name(s), but no indexed file matches the path '${givenPath}', so NO editor surface will show this note: the hover scopes notes to the file under the cursor. It is stored under that spelling and readable through bb_annotations.`
        : reach.statement
    const id = annotationId({ projectId, symbol, path: annotationPath, authorClass: "agent" })
    // Read what currently holds this location BEFORE the upsert. One note per
    // location is the right model (the location UNIQUE index enforces it), but
    // "last writer wins, silently" is not: measured on a real corpus, two agents
    // writing the same symbol+path left ONE row, the first agent's note gone,
    // and NEITHER agent told. The second writer now learns whose note it is
    // replacing — and receives the previous body, so it can merge instead of
    // clobbering.
    const prior = raw.prepare(
      "SELECT author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = ? AND symbol_name = ? AND author_class = 'agent' AND COALESCE(symbol_path, '') = COALESCE(?, '')",
    ).get(projectId, symbol, annotationPath) as { author_class: string; tool_identity: string; body: string; time_created: number; time_updated: number } | undefined
    // `!= null`, not `!== undefined`: the two drivers disagree about the shape of
    // "no row". better-sqlite3 (Node) returns undefined; bun:sqlite returns
    // NULL. The strict-undefined test therefore read a bun:sqlite miss as a hit
    // and crashed on `prior.body` the first time a note was written to a symbol
    // under Bun — measured by script/verify-tool-page-claims.ts, which probes
    // every tool through the real door on a fresh index and reported
    // "null is not an object (evaluating 'prior.body')".
    const isReplacement = prior != null && prior.body !== body
    raw.prepare(
      `INSERT INTO brain_annotation (id, project_id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated)
       VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?)
       ON CONFLICT(project_id, symbol_name, author_class, COALESCE(symbol_path, '')) DO UPDATE
         SET body = excluded.body, tool_identity = excluded.tool_identity, time_updated = excluded.time_updated`,
    ).run(id, projectId, symbol, annotationPath, toolIdentity, body, now, now)
    // Re-read by the NATURAL key, not by id: when the upsert updated a row that
    // predates the current id scheme, that row keeps its original id, and
    // reading by id would report a row that does not exist.
    const updated = raw.prepare("SELECT id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated FROM brain_annotation WHERE project_id = ? AND symbol_name = ? AND author_class = 'agent' AND COALESCE(symbol_path, '') = COALESCE(?, '')").get(projectId, symbol, annotationPath) as any
    return textResult(JSON.stringify({
      stored: true,
      annotation: updated,
      provenance: "author_class is enforced 'agent' for tool writes — recorded, not claimed; tool_identity is the caller's own label, recorded verbatim and never verified",
      ...(isReplacement
        ? {
            // A note is kept per location, so a second writer REPLACES the first.
            // That is the declared model, but the replacement is now on the
            // record: whose note it was, when it was written, and what it said,
            // so the writer can merge instead of silently clobbering a
            // colleague's finding — and so an agent that lost a note can see that
            // it was replaced rather than never stored.
            replaced: {
              authorClass: prior.author_class,
              toolIdentity: prior.tool_identity,
              previousBody: prior.body,
              previousCreatedAt: prior.time_created,
              previousUpdatedAt: prior.time_updated,
              note: `this location already held a note written by '${prior.tool_identity}'; it has been replaced. Read it above and merge if both matter — only one note is kept per location by design.`,
            },
          }
        : {}),
      surfacing: {
        editor: surfaced,
        nameMatched: reach.surfaced,
        pathMatched: pathKnown,
        matchedAs: reach.matchedAs,
        matchedNames: reach.matchedNames,
        statement,
        ...(givenPath === null
          ? { pathNote: "no path given — a NAME-level note, shown for the symbol wherever it appears" }
          : canonical.matched
            ? { pathNote: `path resolved to the indexed spelling '${canonical.path}'` }
            : { pathWarning: `no indexed file matches '${givenPath}', so no editor surface will scope this note to a file; it is stored under that spelling and readable through bb_annotations` }),
      },
    }, null, 2))
}
