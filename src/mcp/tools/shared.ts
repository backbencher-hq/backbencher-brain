// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the shared helpers, constants and types every public MCP tool handler imports.
// WHICH TOOL IT SERVES — all sixteen public tools (helpers are internal; no tool is dispatched from here).
// WHERE ITS EVIDENCE LIVES — docs/tools/*.md, validation/tools/<tool>/**, gates script/verify-mcp.ts, script/verify-tool-registry.ts, script/m15/verify-registry-handlers.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tool-handlers.ts (assembler), every src/mcp/tools/<tool>/handler.ts that imports a helper.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../brain/database"
import { annotationId, annotationReachability, canonicalFilePath } from "../../brain/annotation-store"
import { BrainTools, PatternBrainTools } from "../../ast/tools"
import { quickAnswer } from "../../intelligence/search/quick-answer"
import { detectOrphans } from "../../intelligence/patterns/orphans"
import { ASTEngine } from "../../ast/engine"
import { checkResultsFreshness, fileUnchangedSince, resolveRowsFreshnessDetailed, buildStalenessEnvelope, FRESHNESS_REMEDIATION, FRESHNESS_REMEDIATION_MANUAL_ONLY, type FreshnessSummary } from "../../brain/freshness"
import { CrossLanguageSecurityAnalysis } from "../../security/cross-language-security"
import { DependencyGraphVisualizer } from "../../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../../ast/cross-language-migration-assistant"
import { indexProjectParallel, reindexFilesParallel, wipeProjectData } from "../../ast/parallel-indexer"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../../ast/auto-refresh"
import { TOOL_DESCRIPTORS } from "../tool-registry"
import { testQuality } from "../../intelligence/testing/quality"
import { executeEdit, type EditRequest } from "../../intelligence/edit/edit-engine"
import { getUnifiedHealth, formatUnifiedHealth } from "../../intelligence/health/health-provider"
import { getAnalysisHistory, executeAnalysis } from "../../intelligence/analysis/run-history"
import { generateDocumentation, formatDocumentation, type DocRequest } from "../../intelligence/documentation/doc-engine"
import { visualizeProject, formatVisualization, renderVisualizationStudio, type VisualizationRequest, type VisualizationScope, type VisualizationLayout } from "../../intelligence/visualization/visualization-engine"
import { generateMigrationPlans, formatMigrationPlans } from "../../intelligence/migration/migration-engine"
import { graphTraversal } from "../../intelligence/graph/graph-engine"
// M28.T1 (issue #624): the agent door reuses the EXACT components the IDE
// door uses — one truth, two doors (M28 decision D-1). No reimplementation.
// M48.P1 (#696): bb_analyze impact aggregates the SAME canonical calculator
// (computeImpact + its declared budget) so the two doors cannot disagree.
import { computeImpact, IMPACT_BUDGET } from "../../lsp/impact"
// M55.T5 / §15.1: the ONE owner of the evidence-tier vocabulary and derivation.
// The agent door CALLS it. It used to carry a drifted copy of the rule — see the
// `tierFor` delegation in bb_graph below and docs/m63/CL1.md for the shape of
// defect a copy-projection is.
import { classifyTier } from "../../lsp/evidence_tier"
import { tierForCrossLanguageEdge, factsFromRows, storedCrossLanguageRows, storedCrossLanguageFactsByName, CROSS_LANGUAGE_DEFAULT_LIMIT, CROSS_LANGUAGE_MAX_LIMIT } from "../../lsp/cross_language_hover"
import { getProjectStats } from "../../intelligence/analysis/project-stats"
import { getFileDependencies, dependencyProvenance, dependencyPageProvenance, normalizeScopePath, scopeFileCount } from "../../intelligence/analysis/dependencies"
import { analyzeComplexity } from "../../intelligence/analysis/complexity"
import { testMapping, testGaps, testImpact } from "../../intelligence/testing/test-intel"
import { makeProvenance } from "../../intelligence/evidence"
import type { AnalysisFindingInput } from "../../intelligence/contracts"

// M35.S2: staleness for TEXT-mode derived-analysis read paths (bb_patterns,
// bb_security). Resolve the status of every unique finding file through the
// F1 batch resolver and render per-finding markers + a footer built from the
// REGISTERED remediation constants — never ad-hoc text. Empty findings → no
// footer (silence when fresh; the tools' existing zero-findings idiom stays).
export function derivedStaleness(raw: any, projectId: string, relPaths: Array<string | undefined | null>): { isStale: (rel: string | undefined | null) => boolean; footer: string; summary: FreshnessSummary } {
  const rels = [...new Set(relPaths.filter((p): p is string => !!p))]
  // brain_file.path is ABSOLUTE; findings carry relative_path. Resolve
  // rel -> id first (one IN query on relative_path) and resolve freshness by
  // fileId — the same contract the analyze modes use. Unmapped rels (finding
  // file no longer indexed) resolve honestly as missing via no-row.
  const relToId = new Map<string, string>()
  if (rels.length) {
    for (const r of raw.prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${rels.map(() => "?").join(",")})`).all(projectId, ...rels) as Array<{ id: string; relative_path: string }>) {
      relToId.set(r.relative_path, r.id)
    }
  }
  const rows = rels.map((p) => ({ fileId: relToId.get(p) ?? null }))
  const detail = rows.length ? resolveRowsFreshnessDetailed(raw, projectId, rows) : null
  const statuses = detail?.statuses ?? new Map()
  const fresh = rows.filter((r) => statuses.get(r.fileId ?? "") === "fresh").length
  const stale = rows.filter((r) => statuses.get(r.fileId ?? "") === "stale").length
  const missing = rows.filter((r) => statuses.get(r.fileId ?? "") !== "fresh" && statuses.get(r.fileId ?? "") !== "stale").length
  const summary: FreshnessSummary = { fresh, stale, missing, staleRatio: rows.length ? (stale + missing) / rows.length : 0, freshnessMode: "complete" }
  return {
    isStale: (rel) => rel != null && statuses.get(relToId.get(rel) ?? "") === "stale",
    footer: stale + missing > 0 ? `${stale} stale, ${missing} missing of ${rows.length} findings' files — ${FRESHNESS_REMEDIATION.dir}` : "",
    summary,
  }
}

// bb_security response bounds. The two WINDOW values are what the agent sees;
// the CENSUS cap is how many findings `recordRun` persists so that a capped
// scan can never auto-resolve findings that were merely not looked at
// (completeAnalysisRun resolves any prior `open` finding absent from the set).
// Exported so the security verifiers can pin them rather than re-deriving
// magic numbers that used to be inline literals.
export const SECURITY_FINDINGS_WINDOW = 20
export const SECURITY_SUSPICIOUS_WINDOW = 5
/** Cap for the live (non-recording) scan. Matches the engine's own default. */
export const SECURITY_SCAN_CAP = 500
/** Cap for the recording scan — large enough that a real project is not truncated. */
export const SECURITY_RECORD_RUN_CENSUS_CAP = 50_000

/**
 * Wall-clock ceiling on `bb_analyze`'s call-graph walks (`callers`, `callees`,
 * `trace`) — THIS MODE'S OWN BOUND, not an inherited engine default.
 *
 * The engine applies no clock bound unless a caller asks for one (bb_graph
 * review D7: at 2,000 ms by default it sampled hub answers without bounding
 * their latency — measured, four of five identical default calls returned 200
 * edges in 2,489-16,635 ms while the complete walk took 2,854-4,755 ms and
 * returned 509). This ceiling is kept here because `mode=trace` on a hub is the
 * walk that motivated a clock bound in the first place: the engine's own
 * measurement records it at 613 s before one existed. It is declared on the
 * answer — when it fires, the graph summary carries
 * `timeBudgetExhausted: true` and `walk-time-budget-exhausted` among its
 * `truncationReasons` — so a sampled answer says so instead of reading as
 * complete. Values are the value the engine defaulted to: unchanged behaviour
 * for these three modes, made explicit here so no other door inherits it.
 */
export const ANALYZE_GRAPH_WALK_CEILING_MS = 2_000

export interface ToolContext {
  projectPath: string
  projectId: string
}

export type ToolArguments = Record<string, any>
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
  /**
   * M64.P2: for tools that REPORT a condition rather than failing at it.
   * `false` means the answer contains error-severity findings.
   *
   * bb_health is the first user. It answers "is the index healthy?" — a broken
   * index is the ANSWER, not a tool failure, so it must not set isError (see
   * the handler for the full argument). But without a machine-readable channel
   * a caller could only learn the index is broken by parsing prose, and the
   * MCP surface had no way to say it at all. `isError` means "the tool could
   * not do its job"; this means "the job succeeded and here is what it found".
   */
  healthy?: boolean
}
export type ToolHandler = (args: ToolArguments, context: ToolContext) => Promise<ToolResult>

export function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) }
}

export async function autoRefreshFile(projectId: string, projectPath: string, absPath: string, type: "added" | "modified" = "modified"): Promise<void> {
  try {
    await reindexFilesParallel(projectId as any, projectPath, [{ path: absPath, type }])
  } catch {}
}

export async function readSnippet(filePath: string, lineStart: number): Promise<string | null> {
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, "utf8").split("\n").slice(lineStart - 1, lineStart + 12).join("\n")
  } catch {
    return null
  }
}

export function resolveProjectPath(projectPath: string, relativePath: string): string {
  return path.resolve(projectPath, relativePath)
}

export function ensureWithinProject(projectPath: string, absolutePath: string): void {
  const relative = path.relative(projectPath, absolutePath)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path escapes project root: ${absolutePath}`)
  }
}

export function resolveSafeReadPath(projectPath: string, requested: string): { absolute: string; relative: string } {
  const root = realpathSync(projectPath)
  const candidate = path.resolve(root, requested)
  ensureWithinProject(root, candidate)
  if (!existsSync(candidate)) throw new Error(`not found: ${requested}`)
  // A directory is named as such. The old message said "file not found" for a
  // path that exists, which sent callers looking for a missing file.
  if (!statSync(candidate).isFile()) throw new Error(`not a file: ${requested}`)
  const absolute = realpathSync(candidate)
  // The second containment check is the one that matters: realpath resolves
  // symlinks, so an in-project link pointing outside the project is caught here
  // and not by the pre-resolution check. It is re-established at the point of
  // read by readIndexedFile, which re-validates the path it is about to open.
  ensureWithinProject(root, absolute)
  return { absolute, relative: path.relative(root, absolute).split(path.sep).join("/") }
}

/**
 * Open an index-verified file, or return an error the caller can act on.
 *
 * The handler used to readFileSync bare after the DB lookup, and to THROW for
 * "file is not indexed", so both a delete between the two statements and an
 * unindexed file reached the caller as a raw ENOENT / raw Error instead of the
 * isError envelope this handler's own contract demands.
 */
export function readIndexedFile(absolute: string, projectPath: string, relative: string): { content: string } | { error: string } {
  try {
    // Re-verify containment at the point of use — the check in
    // resolveSafeReadPath ran before a DB round-trip, and a symlink swapped in
    // that window would otherwise be followed out of the project.
    ensureWithinProject(realpathSync(projectPath), realpathSync(absolute))
  } catch (error: any) {
    return { error: `refused: ${error?.message ?? String(error)}` }
  }
  try {
    return { content: readFileSync(absolute, "utf8") }
  } catch (error: any) {
    return { error: `could not read ${relative}: ${error?.code ?? error?.message ?? String(error)}` }
  }
}

/**
 * Reject a language / symbolKind value this project's index does not hold.
 *
 * Both are free-form strings in the public schema compared with SQL `=`, so
 * "TypeScript" or "Function" produced a byte-identical "no results" to a wrong
 * symbol name — the caller could not tell a filter that excluded everything
 * from a symbol that does not exist. The message lists the indexed values, so
 * the correction arrives in the same round trip. Comparison is
 * case-insensitive, the same rule the engines' NOCASE equality uses.
 */
export async function describeUnknownFilters(projectId: string, args: Record<string, any>): Promise<string | null> {
  const language = typeof args.language === "string" ? args.language.trim() : ""
  const symbolKind = typeof args.symbolKind === "string" ? args.symbolKind.trim() : ""
  if (!language && !symbolKind) return null
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  if (language) {
    const known = (raw.prepare("SELECT DISTINCT language FROM brain_file WHERE project_id=? ORDER BY language").all(projectId) as any[])
      .map((row) => row.language)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
    if (!known.some((value) => value.toLowerCase() === language.toLowerCase())) {
      return `bb_search: language "${language}" is not in this project's index — indexed languages: ${known.join(", ") || "(none)"}`
    }
  }
  if (symbolKind) {
    const known = (raw.prepare("SELECT DISTINCT symbol_type FROM brain_symbol WHERE project_id=? ORDER BY symbol_type").all(projectId) as any[])
      .map((row) => row.symbol_type)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
    if (!known.some((value) => value.toLowerCase() === symbolKind.toLowerCase())) {
      return `bb_search: symbolKind "${symbolKind}" is not in this project's index — indexed kinds: ${known.join(", ") || "(none)"}`
    }
  }
  return null
}

// M48.P1 (#696): canonical impact report for bb_analyze mode=impact.
// Numbers (symbol set, truncation, declared total, budget/depth) come from
// computeImpact — the SAME component bb_impact and the editor use. The
// aggregation adds only what the report semantics genuinely need: file-level
// rollup, risk level, cross-language and unresolved-edge counts. All are
// derived from the SAME single traversal (injected via deps.traverse) — no
// second walk, no second math, no drift. Depth cap + depth reached are
// declared fields; truncated is real (can be true when the node budget or
// traversal budget is exhausted).
export async function canonicalImpactReport(
  raw: any,
  projectId: string,
  target: string,
): Promise<Record<string, unknown> & { found: boolean }> {
  const notFound = (): Record<string, unknown> & { found: boolean } => ({
    target,
    found: false,
    scope: "transitive",
    directSymbols: 0,
    affectedFiles: [],
    transitiveFiles: 0,
    crossLanguageFiles: 0,
    unresolvedEdges: 0,
    riskLevel: "low",
    truncated: false,
    // Declared even when empty: a response whose key set changes with the
    // result forces every consumer to branch on presence.
    truncationReason: null,
    depthCap: IMPACT_BUDGET.maxDepth,
    nodeBudget: IMPACT_BUDGET.maxNodes,
    depthReached: 0,
    totalSymbols: 0,
    totalSymbolsIfKnown: null,
    // No root, so no match — the same key set in every state.
    root: null,
    notFoundReason: "absent",
    source: "impact@lsp-canonical (computeImpact, M48.P1) — no walk was performed",
    provenance: makeProvenance({
      evidenceClass: "unknown",
      engine: "impact@lsp-canonical",
      engineVersion: "m48.01",
      projectId,
      source: "computeImpact-not-found",
      limitations: ["Target not found in the indexed graph — no impact set exists (declared, never an invented empty set)."],
      unknowns: ["target-not-found"],
    }),
  })
  let capturedEdges: Array<any> = []
  let capturedNodes: Record<string, any> = {}
  // WHICH symbol the walk actually rooted at. `computeImpact` roots the same way
  // the graph modes do — exact, then exact-any-kind, then a containment
  // near-miss — and the report never said so, because this payload has no
  // `root` at all. Measured on the atlas corpus: `target: "ub"` answered
  // `found: true` with `directSymbols` and `affectedFiles` computed from
  // `hub`, and there was no field anywhere naming `hub` or saying that `ub` was
  // never a symbol. A risk level attached to an unnamed symbol cannot be checked
  // or reproduced, which is the one thing a blast radius is for.
  let capturedRoot: any = null
  let capturedRootCandidates = 1
  let capturedRootMatch: string | null = null
  // computeImpact draws its line at "traversable root / absent". A symbol that
  // IS indexed but is a namespace, constant, type alias or enum member is
  // neither, and reporting it as "absent" is a confident FALSE NEGATIVE.
  // Measured on bb's own src: 78 of 140 distinct symbol names landed here, and
  // one of them was `ASTEngine` with 390 caller edges — the tool reported
  // `found:false, riskLevel:"low", directSymbols:0` for it. callers/callees
  // resolve those same names by exact match of ANY type, so the tool answered
  // for them one mode earlier and denied them here. The calculator already
  // renders this case as a declared error naming the type and the
  // remediation; the wrapper was throwing that message away.
  let result
  try {
    result = await computeImpact(raw, projectId, target, {
      traverse: (async (pid: string, symbol: string, opts: any) => {
        const r = await graphTraversal(pid, symbol, opts)
        capturedEdges = r.callers ?? []
        capturedNodes = r.nodes ?? {}
        capturedRoot = r.root ?? null
        capturedRootCandidates = r.rootCandidates ?? 1
        capturedRootMatch = r.rootMatch ?? null
        return r
      }) as any,
    })
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error)
    // "exists but the graph cannot root here" and "the lookup itself blew up"
    // are both distinct from "there is no such symbol". Each is carried out
    // verbatim; neither is dressed as the third.
    if (/not a traversable root|owning-declaration/i.test(message)) {
      return {
        ...notFound(),
        notFoundReason: "not-traversable",
        reason: message,
        provenance: makeProvenance({
          evidenceClass: "unknown",
          engine: "impact@lsp-canonical",
          engineVersion: "m48.01",
          projectId,
          source: "computeImpact-declared-error",
          limitations: [
            "The target IS in the index; the graph engine cannot root a traversal at it. No impact set exists for it — this is a declared refusal, not an empty answer.",
            "callers/callees/trace resolve the same name by exact match of ANY symbol type; use those modes, or target the owning declaration.",
          ],
          unknowns: ["target-not-traversable"],
        }),
      }
    }
    if (!/not found/i.test(message)) {
      return {
        ...notFound(),
        notFoundReason: "error",
        reason: message,
        provenance: makeProvenance({
          evidenceClass: "unknown",
          engine: "impact@lsp-canonical",
          engineVersion: "m48.01",
          projectId,
          source: "computeImpact-error",
          limitations: ["The impact calculation failed; the reason is reported verbatim rather than as a missing target."],
          unknowns: ["impact-calc-failed"],
        }),
      }
    }
    return notFound()
  }

  const internal = new Map<string, { name: string; file: string; depth: number }>()
  // Counted once per DISTINCT node id: the entry loop and the raw-edge loop
  // both counted an external node, so unresolvedEdges was up to double.
  const unresolvedNodes = new Set<string>()
  let depthReached = 0
  for (const entry of result.impact as Array<{ id: string; name: string; file: string; depth: number }>) {
    if (entry.depth > depthReached) depthReached = entry.depth
    const node = capturedNodes[entry.id]
    if (node?.isExternal === true || !entry.file) { unresolvedNodes.add(entry.id); continue }
    const existing = internal.get(entry.id)
    if (!existing || entry.depth < existing.depth) internal.set(entry.id, { name: entry.name, file: entry.file, depth: entry.depth })
  }
  for (const edge of capturedEdges) {
    const node = capturedNodes[edge.from]
    if (node?.isExternal === true) unresolvedNodes.add(edge.from)
  }
  const unresolvedEdges = unresolvedNodes.size

  // File-level rollup (one row per file, min depth, first symbol as via).
  const crossLangFiles = new Set<string>()
  for (const edge of capturedEdges) {
    const node = capturedNodes[edge.from]
    if (!node || node.isExternal === true) continue
    if (edge.isCrossLanguage === true && node.file) crossLangFiles.add(node.file)
  }
  const byFile = new Map<string, { via: string; depth: number; crossLanguage: boolean }>()
  for (const entry of internal.values()) {
    const cur = byFile.get(entry.file)
    if (!cur || entry.depth < cur.depth) {
      byFile.set(entry.file, { via: entry.name, depth: entry.depth, crossLanguage: crossLangFiles.has(entry.file) })
    }
  }
  const affectedFiles = Array.from(byFile.entries())
    .map(([file, v]) => ({ file, via: v.via, depth: v.depth, crossLanguage: v.crossLanguage }))
    .sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file))
  const directSymbols = Array.from(internal.values()).filter((e) => e.depth === 0).length
  const transitiveFiles = affectedFiles.filter((f) => f.depth > 0).length
  const crossLanguageFiles = new Set(affectedFiles.filter((f) => f.crossLanguage).map((f) => f.file)).size
  const total = affectedFiles.length
  const riskLevel = total >= 20 || crossLanguageFiles > 0 ? "critical" : total >= 8 ? "high" : total >= 3 ? "medium" : "low"
  return {
    target,
    found: true,
    // The symbol every number below is about, and how the name resolved to it.
    root: capturedRoot
      ? {
          name: capturedRoot.name,
          symbolType: capturedRoot.symbolType,
          file: capturedRoot.file,
          line: capturedRoot.line,
          candidates: capturedRootCandidates,
          match: capturedRootMatch,
        }
      : null,
    scope: "transitive",
    directSymbols,
    affectedFiles,
    transitiveFiles,
    crossLanguageFiles,
    unresolvedEdges,
    riskLevel,
    truncated: result.truncated,
    truncationReason: result.truncationReason,
    // Declared limits (M48.P1): the cap and the depth actually reached are
    // always stated — a reader never has to guess whether more exists.
    depthCap: IMPACT_BUDGET.maxDepth,
    nodeBudget: IMPACT_BUDGET.maxNodes,
    depthReached,
    // The exact bb_impact count (same result object) — gate-asserted equal.
    totalSymbols: result.shownCount,
    // computeImpact already runs the bounded independent COUNT that exists
    // for exactly this ("showing X of Y"). It was computed and then dropped,
    // so a truncated set could only ever be read as the whole set.
    totalSymbolsIfKnown: result.totalCountIfKnown,
    source: "impact@lsp-canonical (computeImpact, M48.P1)",
    provenance: makeProvenance({
      evidenceClass: "inferred",
      engine: "impact@lsp-canonical",
      engineVersion: "m48.01",
      projectId,
      source: "brain_relationship+brain_symbol+brain_file via computeImpact",
      limitations: [
        "Impact set, truncation, and totals come from the editor-canonical calculator (src/lsp/impact.ts).",
        `Depth cap ${IMPACT_BUDGET.maxDepth} and node budget ${IMPACT_BUDGET.maxNodes} are declared; depthReached states how far the walk actually went.`,
        "Static impact cannot establish runtime behavior; unresolved external edges are counted but not followed.",
      ],
      truncated: result.truncated,
    }),
  }
}
