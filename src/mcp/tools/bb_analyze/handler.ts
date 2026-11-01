// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_analyze — the adapter that parses arguments, calls the owning engine, and shapes the tool result.
// WHICH TOOL IT SERVES — bb_analyze (see src/mcp/tools/bb_analyze/descriptor.ts for mutability, modes and schema).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_analyze.md, docs/BB_*.md for its guide page, validation/tools/bb_analyze/**, and the gate scripts named in its task.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/descriptor.ts (schema/defaults), the owning engine modules it calls, docs/tools/bb_analyze.md, and its gate scripts.
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
// The MCP surface reuses the EXACT components the editor surface uses — one
// truth, two doors, no reimplementation. `bb_analyze` impact aggregates the same
// canonical calculator (computeImpact + its declared budget) as `bb_impact`, so
// the two doors cannot disagree.
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
    const mode = String(args.mode ?? "")
    const allowed = new Set(["mode", "target", "filePath", "limit"])
    // `limit` is ONE parameter with ONE meaning: the most items this answer
    // returns. For dependencies it is files, for the test-intel modes entries,
    // and for the graph modes EDGES PER DIRECTION — because a caller who
    // passes limit:10 to `callers` means ten callers, not ten files. It was
    // previously refused outright on the graph modes, which left the largest
    // answers in the tool (measured: 87,038 bytes for one `callers` call on a
    // 93-file corpus) with no way at all to ask for less.
    const LIMIT_MODES = new Set([
      "callers",
      "callees",
      "trace",
      "dependencies",
      "test_mapping",
      "test_gaps",
      "test_quality",
    ])
    if (args.limit !== undefined && !LIMIT_MODES.has(mode)) {
      return textResult(
        `bb_analyze ${mode}: limit does not apply to this mode (it bounds callers, callees, trace, dependencies, test_mapping, test_gaps and test_quality) — refusing it rather than ignoring it`,
        true,
      )
    }
    if (args.limit !== undefined && Number(args.limit) === 0) {
      // limit 0 became an empty answer that reads as "this project has no
      // dependencies". That is a measurement claim, and it was never taken.
      return textResult("bb_analyze " + mode + ": limit must be at least 1 — limit 0 returns an empty result that is indistinguishable from a real answer", true)
    }
    // The floor is refused because an empty page is indistinguishable from a
    // real answer; the CEILING is refused for the same reason in the other
    // direction. `limit` had a floor and no ceiling, so the schema's "maximum
    // items returned" named no maximum: `limit: 2147483648` was accepted and
    // answered with the whole corpus, which on a large project is an answer too
    // big to read rather than one too big to hold.
    //
    // It is refused, not clamped. Clamping would return a page that looks like
    // the caller's request was honoured, which is the failure this whole
    // parameter exists to prevent.
    const LIMIT_CEILING: Record<string, number> = {
      callers: 5_000,
      callees: 5_000,
      trace: 5_000,
      dependencies: 2_000,
      test_mapping: 2_000,
      test_gaps: 2_000,
      test_quality: 2_000,
    }
    if (args.limit !== undefined && Number(args.limit) > LIMIT_CEILING[mode]) {
      return textResult(
        `bb_analyze ${mode}: limit must be between 1 and ${LIMIT_CEILING[mode]} — refused rather than clamped, so a returned page always means the page asked for. Above this the answer stops being readable (measured on this repository's own src: 20 dependency files of 183 is already 75,911 bytes ~21k tokens, and the per-file edge lists are capped separately).`,
        true,
      )
    }
    // A target is echoed into the answer's `reason` and `target` fields. A
    // 4,000-character target therefore produced a 9,409-byte "not found" —
    // about 2.6k tokens spent on two words of information. The echo is kept,
    // because it is how a caller tells WHICH name was looked up, and elided
    // with its length stated so nothing is silently shortened.
    const MAX_TARGET_ECHO = 200
    const unused = Object.keys(args).filter((key) => !allowed.has(key))
    if (unused.length) return textResult(`bb_analyze ${mode || "unknown"}: irrelevant options: ${unused.join(", ")}`, true)
    const target = args.target ? String(args.target) : ""
    // The search term and the ECHO are different things. A 4,000-character
    // target produced a 9,409-byte "not found" (~2.6k tokens for two words of
    // information) because it is echoed into `target` and `reason`. Truncating
    // the SEARCH TERM to fix that would search for a different symbol than the
    // caller asked for — a wrong answer instead of a long one. So the full
    // string is resolved and only the echo is bounded, with its full length
    // stated so nothing is silently shortened.
    const echo = (t: string): string =>
      t.length > MAX_TARGET_ECHO ? `${t.slice(0, MAX_TARGET_ECHO)}…(+${t.length - MAX_TARGET_ECHO} more characters)` : t
    const targetModes = new Set(["callers", "callees", "trace", "complexity", "impact", "test_impact"])
    // filePath scopes dependencies plus the three test-intel modes (path
    // prefix); stats stays project-wide and rejects filePath.
    const fileModes = new Set(["dependencies", "test_mapping", "test_gaps", "test_quality"])
    if (args.target && !targetModes.has(mode)) return textResult(`bb_analyze ${mode}: irrelevant options: target`, true)
    if (args.filePath && !fileModes.has(mode)) return textResult(`bb_analyze ${mode}: irrelevant options: filePath`, true)
    if (["callers", "callees", "trace", "impact", "test_impact"].includes(mode) && !target.trim())
      return textResult(`bb_analyze ${mode} requires a non-empty target`, true)

    // Staleness on every read mode — additive truth, rows flagged never
    // dropped, nothing silently re-indexed. Helper builds the shared envelope
    // from the batch freshness resolver.
    //
    // Latency budget: freshness resolution must stay under 5% of
    // handler latency. Project-wide modes (stats/complexity/test_mapping/
    // test_gaps/test_quality) would otherwise resolve O(all files) per call,
    // so they resolve a deterministic stride sample (cap below) and the
    // envelope is labeled freshnessMode "sampled" — the contract field that
    // exists exactly for this. Targeted modes (graph/dependencies/impact/
    // test_impact) are row-bounded by the traversal budget / limit and stay
    // "complete". Sampling is honest: the envelope counts describe the sample
    // actually resolved, and the S1 gate recomputes the same sample
    // independently to prove the counts correct-for-sample.
    const FRESHNESS_SAMPLE_CAP = 64
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    const withFreshness = async (
      data: Record<string, unknown>,
      rows: Array<{ fileId?: string | null; filePath?: string | null }>,
      opts: { scope?: { kind: "file" | "dir"; path?: string }; onRows?: (statuses: Map<string, string>) => void; sample?: number } = {},
    ) => {
      // Measurement seam for the S1 latency-budget gate (BB_M35_SKIP_FRESHNESS=1
      // runs the handler WITHOUT freshness work). Not part of the public
      // contract; the gate measures with/without and asserts the delta < 5%.
      // Quarantined behind BB_TEST_HOOKS=1 — like the worker fixtures, a stray
      // env var must not silently degrade a production read path.
      if (process.env.BB_TEST_HOOKS === "1" && process.env.BB_M35_SKIP_FRESHNESS === "1") return textResult(JSON.stringify(data, null, 2))
      let resolved = rows
      let mode: "sampled" | "complete" = "complete"
      const cap = opts.sample
      if (cap && rows.length > cap) {
        const step = Math.ceil(rows.length / cap)
        resolved = rows.filter((_, i) => i % step === 0)
        mode = "sampled"
      }
      const detail = resolveRowsFreshnessDetailed(raw, projectId as any, resolved, { freshnessMode: mode })
      opts.onRows?.(detail.statuses)
      const text = JSON.stringify({ ...data, freshness: buildStalenessEnvelope(detail.summary, opts.scope ?? { kind: "dir" }) }, null, 2)
      return textResult(text)
    }
    // relative_path -> file id map for report rows that carry relative paths
    // (test-intel entries, dependency entries). Built lazily — graph modes pay
    // nothing for it. Keeps the resolver keyed on real brain_file rows so
    // "no-row" only means truth.
    let relMap: Map<string, string> | null = null
    const relToFileId = (): Map<string, string> => {
      if (!relMap) {
        relMap = new Map<string, string>()
        for (const r of raw.prepare("SELECT id, relative_path FROM brain_file WHERE project_id = ?").all(projectId) as Array<{ id: string; relative_path: string }>) {
          relMap!.set(r.relative_path, r.id)
        }
      }
      return relMap
    }
    const statusFor = (statuses: Map<string, string>, rel: string): string => {
      const fid = relToFileId().get(rel)
      return fid ? (statuses.get(fid) ?? "missing") : "no-row"
    }
    // Targeted rel->id lookup for SMALL row sets (breakdown, quality files,
    // affected files): one IN query instead of the full brain_file map.
    const relIdsFor = (rels: string[]): Map<string, string> => {
      const uniq = [...new Set(rels.filter(Boolean))]
      const map = new Map<string, string>()
      if (!uniq.length) return map
      const rows = raw.prepare(
        `SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${uniq.map(() => "?").join(",")})`,
      ).all(projectId, ...uniq) as Array<{ id: string; relative_path: string }>
      for (const r of rows) map.set(r.relative_path, r.id)
      return map
    }

    if (mode === "callers" || mode === "callees" || mode === "trace") {
      // Not-found used to THROW out of the handler, so three of the five
      // target modes answered a missing symbol with `isError: true` and a bare
      // text line while the other two returned JSON with `found: false`. An
      // agent branching on `found` got an exception instead of a value, and
      // neither branch carried a remediation. The declared shape is the same
      // for all five, and the key set does not change with the result.
      let result
      try {
        // This walk keeps a wall-clock ceiling EXPLICITLY, because the engine's
        // default applies none (graph-engine's DEFAULT_WALK_TIME_BUDGET_MS is 0:
        // a bound there sampled the default answer without bounding its
        // latency).
        // `mode=trace` on a hub is the walk that motivated a clock bound at
        // all — measured at 613 s before one existed — so the ceiling stays
        // here, at this mode's own declared value, instead of being inherited by
        // every other door from a constant they never asked for. When it fires
        // the answer carries `timeBudgetExhausted: true` in its graph summary,
        // so the sample is declared rather than silent.
        result = await graphTraversal(projectId as any, target, {
          direction: mode === "trace" ? "both" : mode,
          maxDepth: 3,
          timeBudgetMs: ANALYZE_GRAPH_WALK_CEILING_MS,
        })
      } catch {
        return withFreshness(
          {
            mode,
            target: echo(target),
            found: false,
            notFoundReason: "absent",
            reason: `bb_analyze ${mode}: symbol '${echo(target)}' is not in the indexed graph — no caller or callee set exists for it (this is a declared absence, not an empty answer). Index the project (bb index), or check the spelling.`,
            root: null,
            rootCandidates: 0,
            // No root, so no step: null, not a guess.
            rootMatch: null,
            callers: [],
            callees: [],
            nodes: {},
            // The key set must not change with the result, or every consumer
            // has to branch on presence before it can read a field.
            summary: {
              totalCallers: 0,
              totalCallees: 0,
              maxDepthReached: 0,
              maxDepth: 0,
              crossLanguageEdges: 0,
              truncated: false,
              edgeLimit: 0,
              cappedQueries: 0,
              callersIfUncapped: null,
              calleesIfUncapped: null,
              totalsAreLowerBounds: false,
              dedupedAtToolLayer: { cascadeRepeatsCollapsed: 0, spellingVariantsCollapsed: 0 },
            },
            provenance: makeProvenance({
              evidenceClass: "unknown",
              engine: "graph@intelligence",
              engineVersion: "m10.02",
              projectId,
              source: "brain_symbol",
              limitations: ["The target does not exist in the index, so no relationship set was computed. Nothing is claimed about what depends on it."],
              unknowns: ["target-not-found"],
            }),
          },
          [],
          { scope: { kind: "dir" } },
        )
      }
      // ── the response page ──────────────────────────────────────────────
      // Three things were wrong with the wire shape, all measured on the
      // corpus and on bb's own src:
      //
      //   1. NO PAGE. `limit` was refused here, so a high-fan-in symbol
      //      returned everything: 87,038 bytes (~24k tokens) for one `callers`
      //      call, 89,929 for `trace`.
      //   2. PER-EDGE DECORATION. Every edge carried a `metadata.enrichment`
      //      block (role / layerFlow / criticality / frequency) that no tool
      //      page documents and no caller can cite — 64 of 64 edges, and the
      //      bulk of the payload. `evidenceClass` IS documented, so it stays.
      //   3. ABSOLUTE PATHS. `nodes[].filePath` embedded the checkout's
      //      absolute path 59 times in one answer, so the same question
      //      returns different bytes on a different machine and no two answers
      //      can be diffed or cached.
      // 25, not 50: measured per-edge payload is ~800 bytes pretty-printed
      // (from / to / rowId / callSite / evidenceClass, all of which are load-
      // bearing), so 50 edges is ~56 KB ≈ 15k tokens before the caller has
      // read a line of it. 25 edges is ~28 KB — enough to see the SHAPE of a
      // fan-in, which is what the question is usually for — and the true
      // count is in `summary.callersIfUncapped` / `calleesIfUncapped`, so a
      // caller who needs the rest passes `limit`.
      const GRAPH_EDGE_PAGE = 25
      const edgeLimit = args.limit != null ? Number(args.limit) : GRAPH_EDGE_PAGE
      const fullCallers = ((result as any).callers ?? []) as any[]
      const fullCallees = ((result as any).callees ?? []) as any[]
      // The enrichment block is the indexer's internal inference. Dropping it
      // from THIS surface is not a contract change: it was never in the
      // registry description, the schema, or any tool page.
      const trim = (e: any) => (e?.metadata?.enrichment ? { ...e, metadata: { evidenceClass: e.metadata.evidenceClass } } : e)
      const pageCallers = fullCallers.slice(0, edgeLimit).map(trim)
      const pageCallees = fullCallees.slice(0, edgeLimit).map(trim)
      // Nodes are rebuilt from the RETURNED edges plus the root, so the
      // payload contains exactly what the answer cites.
      const allNodes = (result as { nodes: Record<string, any> }).nodes ?? {}
      const nodeIds = new Set<string>([result.root?.id])
      for (const e of [...pageCallers, ...pageCallees]) {
        if (e.from) nodeIds.add(e.from)
        if (e.to) nodeIds.add(e.to)
      }
      const nodes: any[] = []
      for (const id of nodeIds) {
        const n = allNodes[id]
        if (n) nodes.push({ ...n })
      }
      // `file` is the project-relative path and is what the answer cites.
      // `filePath` was the absolute one: it is dropped AFTER freshness is
      // resolved from it, so the envelope is unaffected.
      for (const n of nodes) delete n.filePath
      // The root carried its own absolute `filePath` outside the nodes map, so
      // one checkout path survived the trim above.
      const rootNode: any = (result as any).root ? { ...(result as any).root } : null
      if (rootNode) delete rootNode.filePath
      const freshable = nodes.filter((n) => !n.isExternal)
      return withFreshness(
        {
          ...(result as unknown as Record<string, unknown>),
          mode,
          target,
          found: true,
          root: rootNode ?? (result as any).root,
          callers: pageCallers,
          callees: pageCallees,
          nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
          summary: {
            ...(result as any).summary,
            // What was returned against what the traversal found.
            // `callersIfUncapped` / `calleesIfUncapped` above are the
            // traversal's own bounded count, so "showing 50 of 390" is a real
            // pair of numbers whenever a cap fired.
            returnedCallers: pageCallers.length,
            returnedCallees: pageCallees.length,
            pageEdgeLimit: edgeLimit,
            pageTruncated: pageCallers.length < fullCallers.length || pageCallees.length < fullCallees.length,
          },
        } as Record<string, unknown>,
        freshable.map((n) => ({ filePath: allNodes[n.id]?.filePath ?? n.file })),
        {
          onRows: (statuses) => {
            for (const n of freshable) n.stale = statuses.get(allNodes[n.id]?.filePath || n.file) !== "fresh"
          },
        },
      )
    }
    if (mode === "dependencies") {
      // The scope is normalized ONCE, here, and the NORMALIZED value goes to
      // both the engine and the denominator. Previously the engine stripped
      // trailing slashes and this count did not, so `filePath: "src/wide/"`
      // returned 20 of 68 files with `totalFiles: 0` and `truncated: false` —
      // a false statement of completeness, 48 files hidden. There is no second
      // copy of the rule to disagree with.
      const rawScope = args.filePath ? String(args.filePath) : undefined
      const scopePath = rawScope ? normalizeScopePath(rawScope) : null
      const deps = await getFileDependencies(projectId as any, { filePath: scopePath ?? undefined, limit: Number(args.limit ?? 20) })
      const rows = deps.flatMap((d) => [
        { fileId: d.fileId },
        // Neither list ships a file id any more — a file id is
        // `<40-hex project id>:<relative path>`, so it repeated the path it sat
        // next to (56,540 of 121,340 bytes on a 20-file page of this repo's own
        // src). The path is the locator; resolve it to a row id here, once.
        ...d.dependencies.filter((x) => !x.external && x.resolution !== "unresolved").map((x) => ({ fileId: relToFileId().get(x.path) ?? null })),
        ...d.dependents.map((x) => ({ fileId: relToFileId().get(x.path) ?? null })),
      ])
      const first = deps[0]
      // Every other collection mode states how many items it returned; this
      // one returned 20 files of 90 with no summary at all. The total is
      // counted over the SCOPE — filePath is a path PREFIX, so the honest
      // denominator is the files under that prefix, not the whole project.
      // The denominator comes from the engine, which computed the rows with the
      // same normalization and the same segment boundary. A count written here
      // is a second opinion about the same question, and it is how the scope
      // came to disagree with itself.
      const totalFiles = await scopeFileCount(projectId as any, scopePath)
      return withFreshness(
        {
          dependencies: deps,
          // One provenance for the report. It used to be repeated on all 20
          // rows — the same engine, the same evidence class, the same
          // limitations — and that repetition was roughly a third of the
          // payload on a default call.
          provenance: dependencyPageProvenance(
            dependencyProvenance(projectId as any),
            { projectId: projectId as string, shown: deps.length, total: totalFiles },
          ),
          summary: {
            returned: deps.length,
            totalFiles,
            scope: scopePath,
            truncated: deps.length < totalFiles,
            // Counted over the RETURNED page, and named as such: these are not
            // project totals.
            returnedInternalDependencies: deps.reduce(
              (n: number, d: any) => n + d.dependencies.filter((x: any) => !x.external).length,
              0,
            ),
            returnedInternalDependents: deps.reduce((n: number, d: any) => n + d.dependents.length, 0),
            pageLimit: Number(args.limit ?? 20),
          },
        },
        rows,
        {
          // A page over a path PREFIX is a directory scope even though `scope` on
          // the wire says "file" for both shapes: naming one file here told a
          // caller to reindex `src/wide/w0.ts` when the stale files were
          // `w4.ts`/`w5.ts` (measured). One returned file that IS the scope keeps
          // the file scope, because that is what the caller asked about.
          scope: scopePath
            ? deps.length === 1 && deps[0].file === scopePath
              ? { kind: "file", path: deps[0].file }
              : { kind: "dir", path: scopePath }
            : first
              ? { kind: "dir" }
              : undefined,
          onRows: (statuses) => {
            for (const d of deps as any[]) {
              d.stale = statuses.get(d.fileId) !== "fresh"
              for (const x of d.dependencies)
                if (!x.external && x.resolution !== "unresolved") x.stale = statuses.get(relToFileId().get(x.path) ?? "") !== "fresh"
              for (const x of d.dependents) x.stale = statuses.get(relToFileId().get(x.path) ?? "") !== "fresh"
            }
          },
        },
      )
    }
    if (mode === "stats") {
      const stats = await getProjectStats(projectId as any)
      const fileRows = raw.prepare("SELECT id FROM brain_file WHERE project_id = ? ORDER BY id").all(projectId) as Array<{ id: string }>
      return withFreshness(stats as unknown as Record<string, unknown>, fileRows.map((f) => ({ fileId: f.id })), { sample: 64 })
    }
    if (mode === "complexity") {
      const report = await analyzeComplexity(projectId as any, { scope: target ? "file" : "project", target: target || undefined })
      // Rows = the files actually visible in the breakdown (<=20): freshness
      // resolution bounded by output size, mode "complete" — no project-wide
      // sampling needed to flag what the user sees. Latency-budget verified.
      const relIds = relIdsFor((report.breakdown ?? []).map((b) => b.file))
      return withFreshness(
        report as unknown as Record<string, unknown>,
        (report.breakdown ?? []).map((b) => ({ fileId: relIds.get(b.file) ?? null })),
        { onRows: (statuses) => { for (const b of report.breakdown as any[]) b.stale = statuses.get(relIds.get(b.file) ?? "") !== "fresh" } },
      )
    }
    if (mode === "impact") {
      // ONE impact calculator. The report aggregates the SAME
      // canonical walk bb_impact and the editor use (computeImpact: callers
      // direction, declared budget 200 nodes / depth 5, truncation + declared
      // total) — the file-level risk aggregation is layered on top, never a
      // second math. The depth cap and depth actually reached are DECLARED
      // fields, so the old silent depth-3 undercount (5 files while claiming
      // truncated:false, dropping real dependents) is impossible.
      const rep = await canonicalImpactReport(raw, projectId as any, target)
      // Not-found reports carry an empty freshness block, as before — the
      // shared envelope over zero rows IS that block, so no special case.
      const affected = rep.found ? ((rep as any).affectedFiles as Array<{ file: string }>) : []
      return withFreshness(
        rep as unknown as Record<string, unknown>,
        affected.map((a) => ({ fileId: relToFileId().get(a.file) ?? null })),
        { onRows: (statuses) => { for (const a of affected as any[]) a.stale = statusFor(statuses, a.file) !== "fresh" } },
      )
    }
    if (mode === "test_mapping") {
      const report = await testMapping(projectId as any, {
        filePath: args.filePath ? String(args.filePath) : undefined,
        maxResults: args.limit != null ? Number(args.limit) : undefined,
      })
      return withFreshness(
        report as unknown as Record<string, unknown>,
        report.entries.map((e) => ({ fileId: relToFileId().get(e.file) ?? null })),
        { sample: 64, onRows: (statuses) => { for (const e of report.entries as any[]) e.stale = statusFor(statuses, e.file) !== "fresh" } },
      )
    }
    if (mode === "test_gaps") {
      const report = await testGaps(projectId as any, {
        filePath: args.filePath ? String(args.filePath) : undefined,
        maxResults: args.limit != null ? Number(args.limit) : undefined,
      })
      return withFreshness(
        report as unknown as Record<string, unknown>,
        report.gaps.map((g) => ({ fileId: relToFileId().get(g.file) ?? null })),
        { sample: 64, onRows: (statuses) => { for (const g of report.gaps as any[]) g.stale = statusFor(statuses, g.file) !== "fresh" } },
      )
    }
    if (mode === "test_impact") {
      // This mode refuses `limit`, so the tool's walk ceiling IS its bound. The
      // graph engine applies no clock bound unless a caller asks for one, and
      // without this the one walking mode with no page size also declared no
      // reason for `truncated`.
      const report = await testImpact(projectId as any, target, { timeBudgetMs: ANALYZE_GRAPH_WALK_CEILING_MS })
      if (report.found) {
        const tests = [...report.directTests, ...report.indirectTests]
        return withFreshness(
          report as unknown as Record<string, unknown>,
          tests.map((t) => ({ fileId: relToFileId().get(t.testFile) ?? null })),
          { onRows: (statuses) => { for (const t of tests as any[]) t.stale = statusFor(statuses, t.testFile) !== "fresh" } },
        )
      }
      return textResult(JSON.stringify({ ...report, freshness: buildStalenessEnvelope({ fresh: 0, stale: 0, missing: 0, staleRatio: 0, freshnessMode: "complete" }, { kind: "dir" }) }, null, 2))
    }
    if (mode === "test_quality") {
      const report = await testQuality(projectId as any, { maxFiles: Number(args.limit ?? 50), filePath: args.filePath ? String(args.filePath) : undefined })
      // The engine returns at most `maxFiles` rows and states returned/totalFiles/
      // truncated in `summary`; freshness resolves exactly the rows the answer
      // carries, and the sample cap still guards pathological limits.
      const relIds = relIdsFor(report.files.map((f) => f.relativePath))
      return withFreshness(
        report as unknown as Record<string, unknown>,
        report.files.map((f) => ({ fileId: relIds.get(f.relativePath) ?? null })),
        { sample: 64, onRows: (statuses) => { for (const f of report.files as any[]) f.stale = statuses.get(relIds.get(f.relativePath) ?? "") !== "fresh" } },
      )
    }
    return textResult("bb_analyze requires mode: callers|callees|trace|dependencies|stats|complexity|impact|test_mapping|test_gaps|test_impact|test_quality", true)
}
