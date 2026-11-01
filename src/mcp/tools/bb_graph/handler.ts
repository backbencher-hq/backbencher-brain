// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_graph — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_graph (see src/mcp/tools/bb_graph/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_graph.md, docs/BB_*.md for its guide page, validation/tools/bb_graph/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_graph/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_graph.md, and its gate scripts.
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

  // --- M28.T1 (issue #624): the agent door to the graph surface ------------
  // Decision D-1: these handlers call the same functions the LSP handlers
  // call. The union differential gate (M28.U1) proves the two doors agree.
export const handler: ToolHandler = async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "")
    if (!symbol) return textResult("bb_graph requires symbol", true)
    const maxDepth = Number(args.maxDepth ?? 3)
    if (!Number.isFinite(maxDepth) || maxDepth < 1 || maxDepth > 10) {
      return textResult("bb_graph maxDepth must be a number between 1 and 10", true)
    }
    // M59.A12 (#888): a caller may ask for a larger per-symbol site limit
    // instead of receiving a declared 200 and guessing what was missing. The
    // engine clamps to its own maximum and always declares what it applied.
    const edgeLimitArg = args.edgeLimit === undefined ? undefined : Number(args.edgeLimit)
    if (edgeLimitArg !== undefined && (!Number.isFinite(edgeLimitArg) || edgeLimitArg < 1)) {
      return textResult("bb_graph edgeLimit must be a positive number", true)
    }
    // Validated here rather than trusted: an unknown direction or a non-string
    // entry in relationshipTypes would otherwise reach the SQL and produce a
    // silently wrong traversal instead of an error.
    const directionArg = args.direction === undefined ? undefined : String(args.direction)
    if (directionArg !== undefined && !["callers", "callees", "both"].includes(directionArg)) {
      return textResult("bb_graph direction must be one of: callers, callees, both", true)
    }
    const relTypesArg = args.relationshipTypes === undefined ? undefined : (args.relationshipTypes as unknown[]).map((t) => String(t))
    if (relTypesArg !== undefined && relTypesArg.length === 0) {
      return textResult("bb_graph relationshipTypes must name at least one relationship kind", true)
    }
    const crossLangArg = args.includeCrossLanguage === undefined ? undefined : args.includeCrossLanguage !== false
    // The one bound that is a function of the clock. It is exposed precisely
    // because it is the one that can be turned off: `0` is how a caller says
    // "I accept the runtime and I need a reproducible answer".
    const timeBudgetArg = args.timeBudgetMs === undefined ? undefined : Number(args.timeBudgetMs)
    if (timeBudgetArg !== undefined && (!Number.isFinite(timeBudgetArg) || timeBudgetArg < 0)) {
      return textResult("bb_graph timeBudgetMs must be a non-negative number (0 disables the bound)", true)
    }
    const maxEdgesArg = args.maxEdges === undefined ? undefined : Number(args.maxEdges)
    if (maxEdgesArg !== undefined && (!Number.isFinite(maxEdgesArg) || maxEdgesArg < 1)) {
      return textResult("bb_graph maxEdges must be a positive number", true)
    }
    let result
    try {
      result = await graphTraversal(projectId as any, symbol, {
        maxDepth,
        edgeLimit: edgeLimitArg,
        maxEdges: maxEdgesArg,
        timeBudgetMs: timeBudgetArg,
        direction: directionArg as any,
        relationshipTypes: relTypesArg,
        includeCrossLanguage: crossLangArg,
      })
    } catch (error) {
      return textResult(`bb_graph: ${error instanceof Error ? error.message : String(error)}`, true)
    }
    // M55.T5 / §15.1: the tier derivation is the ONE owner's (src/lsp/
    // evidence_tier.ts). It used to be a COPY living here, and the copy had
    // drifted: its structural set held four kinds where the owner holds ten
    // (call, extends, override, contains, exports, instantiates all fell
    // through to `inferred`), it had no usage/reference branch at all
    // (reference/references/use/uses/usage read `inferred` here and
    // `usage_contextual` everywhere else), and it did not trim or lowercase the
    // stored kind, so a row written `CALLS` read `inferred` here and
    // `structural` on every other surface.
    //
    // Measured on the three largest indexes on this machine, streaming EVERY
    // stored relationship row through both derivations (script/m28/
    // verify-surface-parity.ts U2, and the counts in the lane report):
    //   484,508 of 766,227 rows disagreed on one 18-language corpus (63.2%),
    //   1,433 of 145,511 (1.0%) and 3,850 of 160,007 (2.4%) on two others.
    //
    // The reason nobody saw it is the m63 CL1 shape: `script/m28/verify-union.ts`
    // derived this door's expectation with a COPY OF THE SAME COPY, so the two
    // agreed by construction. Two doors, one bug. That gate is now anchored to
    // the owner (M28.U2).
    const tierFor = (e: { relationshipType: string; confidence: number | null; metadata?: { evidenceClass?: string | null } }): string =>
      classifyTier({ relationshipType: e.relationshipType, confidence: e.confidence ?? null, evidenceClass: e.metadata?.evidenceClass ?? null })
    // Every edge names its two endpoints by symbol id, and a symbol id is
    // `<projectId>:<file>:<name>:<line>`. That is decodable, but an agent
    // reading 36 callee edges should not have to parse a string to learn that
    // one of them is `ext:Errorf`, and must never have to guess which file a
    // caller lives in. `describe` renders one endpoint out of the engine's own
    // node map — already computed by the traversal, previously discarded here
    // — so each edge is self-contained and needs no second call.
    // A symbol id is `<projectHash40>:<path>:<name>:<line>`, and the hash is the
    // same for every symbol in one answer — so it is repeated on BOTH endpoints
    // of every edge, twice per edge, to say something the payload already states
    // once in `root.id`. Measured: a median id is 65-80 characters of which 40
    // is that hash, and `from.id` + `to.id` is 28.6% of every edge's bytes.
    //
    // So the per-edge copy drops the hash. It stays a plain string and stays
    // resolvable: prepend the hash from `root.id` to get the stored id back.
    // `root.id` itself is left FULL, deliberately — it appears once, so it costs
    // ~80 bytes, and it is the one place a reader can find the hash this
    // compaction depends on. Stripping it would save nothing and remove the only
    // way to undo the rest.
    //
    // Conservative by construction: only a first segment that is exactly 40 hex
    // characters is dropped, so an `ext:` node, a foreign id shape, and anything
    // this lane has not seen come back untouched rather than guessed at.
    const compactId = (id: string): string => {
      if (typeof id !== "string" || id.length <= 41) return id
      const at = id.indexOf(":")
      if (at !== 40) return id
      if (!/^[0-9a-f]{40}$/.test(id.slice(0, at))) return id
      return id.slice(at + 1)
    }
    const describe = (id: string) => {
      const n = (result.nodes as Record<string, any> | undefined)?.[id]
      if (!n) return null
      return { id: compactId(n.id), name: n.name, symbolType: n.symbolType, file: n.file, line: n.line, isExternal: n.isExternal === true }
    }
    // A stored relationship id is
    //   `<projectHash>:rel:<projectHash>:<sourceSymbolId>:<kind>:<occurrence>`
    // and the first two segments are constant across one answer: the hash is the
    // same for every row, and it is already the segment before the first `:` of
    // every symbol id in this payload. Dropping them leaves a string that is
    // still a complete handle — prepend `<projectHash>:rel:` to get the stored id
    // back — and shortens it by 45 of 127-134 characters.
    //
    // Idempotent and conservative: anything not shaped like the stored form is
    // returned untouched, so an id this lane has not seen is reported rather than
    // guessed at. `rel` cannot be a path segment's first token in practice, and
    // the second occurrence of the hash is what makes the match unambiguous.
    const compactRowId = (rowId: unknown): string | null => {
      if (typeof rowId !== "string" || rowId.length === 0) return null
      const marker = ":rel:"
      const at = rowId.indexOf(marker)
      if (at <= 0) return rowId
      const projectHash = rowId.slice(0, at)
      const rest = rowId.slice(at + marker.length)
      if (!rest.startsWith(projectHash + ":")) return rowId
      return rest
    }
    const edgesOf = (list: any[], direction: "caller" | "callee") =>
      list.map((e) => ({
        direction,
        from: describe(e.from),
        to: describe(e.to),
        relationshipType: e.relationshipType,
        confidence: e.confidence,
        tier: tierFor(e),
        isCrossLanguage: e.isCrossLanguage === true,
        bridgeMechanism: e.bridge ?? e.bridgeMechanism ?? null,
        depth: e.depth,
        callSite: e.callSite ?? null,
        // Whether this edge is about the symbol that was asked for, or about
        // one of its members folded on by the owner cascade. Surfacing it is
        // what makes the documented superset usable: an agent can count the
        // exact callers without issuing a second, differently-shaped query.
        match: e.targetMatch ?? e.sourceMatch ?? null,
        matchedMember: e.matchedMember ?? null,
        // M26.W2 / GraphEdge.rowId: the stored brain_relationship row this edge
        // came from. The engine emits it and the contract calls it mandatory
        // ("an edge without one must never be emitted, never rendered"), but
        // this handler dropped it — so the tool's own description ("every edge
        // still traces to a stored relationship row") was a claim the payload
        // gave an agent no way to check. An edge nobody can audit is an edge
        // they have to take on faith.
        //
        // The stored id is `<projectHash>:rel:<projectHash>:<sourceId>:<kind>:<n>`
        // — 127-134 characters on the corpora measured, 149 on average and 248 at
        // the worst. The leading `<projectHash>:rel:` is a constant within one
        // answer, and the project hash is already the segment before the first
        // `:` of every `id` in this payload, so those 45 characters repeat what
        // the payload already says. At 28-31% of every edge's bytes on every
        // corpus measured, that redundancy was the single largest item in the
        // answer.
        //
        // So the rendered id drops the prefix and stays a COMPLETE handle: the
        // stored id is `<projectHash>:rel:` followed by exactly this string, and
        // `<projectHash>` is readable from any `id` here. Nothing is lost, and the
        // engine's own rowId — which the traversal uses as its dedup key and the
        // IDE door returns in full — is untouched.
        rowId: compactRowId(e.rowId),
      }))
    return textResult(JSON.stringify({
      symbol,
      root: {
        id: result.root?.id,
        name: result.root?.name,
        symbolType: result.root?.symbolType ?? null,
        file: result.root?.file ?? null,
        line: result.root?.line ?? null,
        filePath: result.root?.filePath ?? null,
        // How many stored symbols this name resolved among. A name is not a
        // unique identifier — measured: `build` in lodash resolves among 7,
        // `code_block.go` in cobra among 50, `Command` among 1 — and when this
        // is > 1 the graph below is about ONE of them, so `root` is the thing
        // to confirm before reading the edges.
        candidates: result.rootCandidates ?? 1,
        // WHICH step resolved the name. `containment` means the answer is about
        // a symbol whose name CONTAINS the one asked for — measured on the
        // atlas corpus, `target: "ub"` answers about `hub` and `target: "_"`
        // about `build_registry`, with nothing else in the payload saying the
        // name was not itself a symbol.
        match: result.rootMatch ?? null,
      },
      callers: edgesOf(result.callers as any[], "caller"),
      callees: edgesOf(result.callees as any[], "callee"),
      summary: {
        // M59.A12 (#888): these are the RETURNED counts. `truncated`, the
        // declared `edgeLimit`, and `callersIfUncapped` are what tell a reader
        // whether they hold the whole set — the previous shape reported 200 as
        // "totalCallers" for a symbol with 3,437 sites and said nothing.
        totalCallers: result.summary?.totalCallers ?? result.callers.length,
        totalCallees: result.summary?.totalCallees ?? result.callees.length,
        // `maxDepthReached` is what the traversal actually walked, not what it
        // was allowed to walk. The previous fallback reported the REQUESTED
        // maxDepth whenever the summary was absent, so a graph that stopped at
        // depth 0 (a leaf with no edges) claimed to have reached depth 3. A
        // fallback that upgrades a measured fact into a permitted one is worse
        // than an explicit unknown, so the unknown is what ships.
        maxDepthReached: result.summary?.maxDepthReached ?? null,
        // The depth bound this run actually used, paired with
        // `maxDepthReached`. The engine computes and declares it; the agent
        // surface dropped it, so a reader holding `maxDepthReached: 2` could
        // not tell "the walk finished at depth 2" from "the walk was stopped at
        // depth 2" — which is the distinction the engine added this field for.
        maxDepth: result.summary?.maxDepth ?? null,
        crossLanguageEdges: result.summary?.crossLanguageEdges ?? 0,
        // ── the two filters that leave a number, not just a prose note ─────
        // The engine has counted both of these for a while; the handler
        // published neither, so the machine-readable side of the answer said
        // `truncated: false` beside a provenance note that said 1 caller row
        // was removed by policy (measured: a fixture with one caller in
        // `vendor/` answered `callers: 0 · truncated: false` with a
        // `noise-policy:` unknown — two channels disagreeing).
        noiseFiltered: result.summary?.noiseFiltered ?? { callers: 0, callees: 0 },
        // Rows that name this symbol but carry no source symbol, so no
        // traversal can show them in either direction. `null` = not counted
        // (never zero — see the engine's field comment). Published because
        // before this the answer was a three-row list with a depth-bound reason
        // and no field at all for the 38 stored rows a JOIN had dropped.
        unattributed: result.summary?.unattributed ?? null,
        crossLanguageExcluded: result.summary?.crossLanguageExcluded ?? { callers: 0, callees: 0 },
        // A DECLARED BOUND, and nothing else (bb_graph review D5). A caller's
        // `relationshipTypes` filter no longer sets this: measured at HEAD,
        // `relationshipTypes:["calls"]` answered 7 edges with
        // `truncated: true, truncationReason: "relationshipTypes:calls"`, so a
        // consumer could not tell "the walk stopped" from "a subset was
        // requested" — and an empty subset (`["implements"]`, 0 edges) was
        // announced as a clipped answer. The filter now reports itself in the
        // two fields directly below.
        truncated: result.summary?.truncated === true,
        truncationReason: result.summary?.truncationReason ?? null,
        // D10: the same reasons as data, beside the `+`-joined string.
        truncationReasons: result.summary?.truncationReasons ?? [],
        // D5: the scope the caller ASKED for, in its own channel. TRUE means the
        // edge sets are the whole of the requested scope; FALSE with
        // `truncated: true` means the store itself clipped them.
        filterNarrowed: result.summary?.filterNarrowed === true,
        filterReason: result.summary?.filterReason ?? null,
        // The bound on the WHOLE answer. From bb_graph review D6 a requested
        // `maxEdges` below the per-query cap is HONORED rather than raised to
        // it, so this field is now the number the caller asked for whenever they
        // asked for one — and when it bites, `totalEdgeLimitReached` says so.
        edgeLimit: result.summary?.edgeLimit ?? null,
        // The bound on the WHOLE answer. Without it a caller could compute the
        // ceiling of an answer (per-query limit x fan-out budget x 2) but not
        // that the ceiling was 20,000 edges.
        maxEdges: result.summary?.maxEdges ?? null,
        // The walk-time bound, and whether it fired. Published because this is
        // the only bound whose firing depends on the clock rather than the
        // data: two identical calls can legitimately differ, and this is what
        // tells a reader that the difference was the machine and not the graph.
        timeBudgetMs: result.summary?.timeBudgetMs ?? null,
        timeBudgetExhausted: result.summary?.timeBudgetExhausted === true,
        totalEdgeLimitReached: result.summary?.totalEdgeLimitReached === true,
        cappedQueries: result.summary?.cappedQueries ?? 0,
        callersIfUncapped: result.summary?.callersIfUncapped ?? null,
        calleesIfUncapped: result.summary?.calleesIfUncapped ?? null,
        totalsAreLowerBounds: result.summary?.totalsAreLowerBounds === true,
        // How much of the answer is about the symbol that was asked for, and
        // how much the owner cascade folded in from its members. The cascade is
        // documented; without these numbers a reader cannot use it.
        // DEPTH 0 only — these four describe the ROOT. An edge at depth >= 1
        // is about a symbol the traversal discovered, and is counted as
        // `deeper*`, so the partition is total:
        //   exact + cascaded + deeper === the number of edges returned.
        exactCallers: result.summary?.exactCallers ?? 0,
        cascadedCallers: result.summary?.cascadedCallers ?? 0,
        exactCallees: result.summary?.exactCallees ?? 0,
        cascadedCallees: result.summary?.cascadedCallees ?? 0,
        deeperCallers: result.summary?.deeperCallers ?? 0,
        deeperCallees: result.summary?.deeperCallees ?? 0,
        // The fan-out bound, and whether it bit. `truncationReason` can name
        // `caller-budget-exhausted`; before this it did so without ever saying
        // what the budget was, so the bound was announced and never quantified.
        callerBudget: result.summary?.callerBudget ?? 0,
        calleeBudget: result.summary?.calleeBudget ?? 0,
        callerBudgetExhausted: result.summary?.callerBudgetExhausted === true,
        calleeBudgetExhausted: result.summary?.calleeBudgetExhausted === true,
        // Rows present in BOTH the caller and the callee list. Each is one
        // relationship seen from two ends, so `totalCallers + totalCallees`
        // overstates the distinct relationship count by exactly this much.
        edgesInBothDirections: result.summary?.edgesInBothDirections ?? 0,
        // What the answer is made of, and which kinds a bound would keep first.
        edgesByType: result.summary?.edgesByType ?? {},
        edgeKindPriority: result.summary?.edgeKindPriority ?? [],
        dedupedAtToolLayer: result.summary?.dedupedAtToolLayer ?? { cascadeRepeatsCollapsed: 0, spellingVariantsCollapsed: 0 },
        // What was actually searched. Without this a caller that asked for
        // direction:"callers" cannot tell an empty callee list from a callee
        // list that was never computed, and `relationshipTypes` narrowing is
        // invisible in the results — a graph of 0 edges reads identically
        // whether the filter matched nothing or matched everything.
        scope: {
          direction: directionArg ?? "both",
          // The engine's RESOLVED list, not a literal here. This used to be a
          // hardcoded four-element copy of the engine's default, and when the
          // default was widened to all ten stored kinds the echo went on naming
          // four while the answer held 120 `uses` and 11 `contains` edges.
          relationshipTypes: result.summary?.relationshipTypesUsed ?? [],
          includeCrossLanguage: crossLangArg !== false,
        },
      },
      provenance: result.provenance ?? null,
    }, null, 2))
}
