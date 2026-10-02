import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../brain/database"
import { annotationId, annotationReachability, canonicalFilePath } from "../brain/annotation-store"
import { BrainTools, PatternBrainTools } from "../ast/tools"
import { quickAnswer } from "../intelligence/search/quick-answer"
import { detectOrphans } from "../intelligence/patterns/orphans"
import { ASTEngine } from "../ast/engine"
import { checkResultsFreshness, fileUnchangedSince, resolveRowsFreshnessDetailed, buildStalenessEnvelope, FRESHNESS_REMEDIATION, type FreshnessSummary } from "../brain/freshness"
import { CrossLanguageSecurityAnalysis } from "../security/cross-language-security"
import { DependencyGraphVisualizer } from "../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../ast/cross-language-migration-assistant"
import { indexProjectParallel, reindexFilesParallel, wipeProjectData } from "../ast/parallel-indexer"
import { collectStaleFiles, maybeAutoRefresh, autoRefreshLine } from "../ast/auto-refresh"
import { TOOL_DESCRIPTORS } from "./tool-registry"
import { testQuality } from "../intelligence/testing/quality"
import { executeEdit, type EditRequest } from "../intelligence/edit/edit-engine"
import { getUnifiedHealth, formatUnifiedHealth } from "../intelligence/health/health-provider"
import { getAnalysisHistory, executeAnalysis } from "../intelligence/analysis/run-history"
import { generateDocumentation, formatDocumentation, type DocRequest } from "../intelligence/documentation/doc-engine"
import { visualizeProject, formatVisualization, type VisualizationRequest, type VisualizationScope } from "../intelligence/visualization/visualization-engine"
import { generateMigrationPlans, formatMigrationPlans } from "../intelligence/migration/migration-engine"
import { graphTraversal } from "../intelligence/graph/graph-engine"
// M28.T1 (issue #624): the agent door reuses the EXACT components the IDE
// door uses — one truth, two doors (M28 decision D-1). No reimplementation.
// M48.P1 (#696): bb_analyze impact aggregates the SAME canonical calculator
// (computeImpact + its declared budget) so the two doors cannot disagree.
import { computeImpact, IMPACT_BUDGET } from "../lsp/impact"
import { tierForCrossLanguageEdge, factsFromRows, storedCrossLanguageRows, storedCrossLanguageFactsByName, CROSS_LANGUAGE_DEFAULT_LIMIT, CROSS_LANGUAGE_MAX_LIMIT } from "../lsp/cross_language_hover"
import { getProjectStats } from "../intelligence/analysis/project-stats"
import { getFileDependencies, dependencyProvenance, dependencyPageProvenance, normalizeScopePath, scopeFileCount } from "../intelligence/analysis/dependencies"
import { analyzeComplexity } from "../intelligence/analysis/complexity"
import { testMapping, testGaps, testImpact } from "../intelligence/testing/test-intel"
import { makeProvenance } from "../intelligence/evidence"
import type { AnalysisFindingInput } from "../intelligence/contracts"

// M35.S2: staleness for TEXT-mode derived-analysis read paths (bb_patterns,
// bb_security). Resolve the status of every unique finding file through the
// F1 batch resolver and render per-finding markers + a footer built from the
// REGISTERED remediation constants — never ad-hoc text. Empty findings → no
// footer (silence when fresh; the tools' existing zero-findings idiom stays).
function derivedStaleness(raw: any, projectId: string, relPaths: Array<string | undefined | null>): { isStale: (rel: string | undefined | null) => boolean; footer: string; summary: FreshnessSummary } {
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

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) }
}

async function autoRefreshFile(projectId: string, projectPath: string, absPath: string, type: "added" | "modified" = "modified"): Promise<void> {
  try {
    await reindexFilesParallel(projectId as any, projectPath, [{ path: absPath, type }])
  } catch {}
}

async function readSnippet(filePath: string, lineStart: number): Promise<string | null> {
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, "utf8").split("\n").slice(lineStart - 1, lineStart + 12).join("\n")
  } catch {
    return null
  }
}

function resolveProjectPath(projectPath: string, relativePath: string): string {
  return path.resolve(projectPath, relativePath)
}

function ensureWithinProject(projectPath: string, absolutePath: string): void {
  const relative = path.relative(projectPath, absolutePath)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`path escapes project root: ${absolutePath}`)
  }
}

function resolveSafeReadPath(projectPath: string, requested: string): { absolute: string; relative: string } {
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
function readIndexedFile(absolute: string, projectPath: string, relative: string): { content: string } | { error: string } {
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
async function describeUnknownFilters(projectId: string, args: Record<string, any>): Promise<string | null> {
  const language = typeof args.language === "string" ? args.language.trim() : ""
  const symbolKind = typeof args.symbolKind === "string" ? args.symbolKind.trim() : ""
  if (!language && !symbolKind) return null
  const raw = await BrainDatabase.getRawInstance(projectId)
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
async function canonicalImpactReport(
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

const handlers: Record<string, ToolHandler> = {
  bb_search: async (args, { projectId, projectPath }) => {
    const mode = args.mode === "content" ? "content" : args.mode === "symbol" || args.mode === "file" ? args.mode : "symbols"
    // M40.A7 negative-case fix: invalid input must return an MCP error
    // envelope, not throw out of the handler — a thrown error crashes the
    // whole tool call on hosts that do not wrap handlers in try/catch.
    // M48.C1 (#699) corpus catch: the registry advertises mode enum
    // [symbols, content, symbol, file] (and the docs example calls
    // mode:"symbols"), the validation layer accepts it — but this guard
    // rejected it. Surface truth: the advertised enum value must work.
    if (args.mode !== undefined && !"symbols content symbol file".split(" ").includes(String(args.mode))) {
      return textResult(`bb_search: unknown mode "${args.mode}" (known: symbols, content, symbol, file)`, true)
    }
    // A language / symbolKind value the index does not contain is reported as
    // an error, because a filter that excludes everything is indistinguishable
    // from a symbol that does not exist. Checked before any search work so the
    // correction arrives in the same round trip.
    if (mode === "symbols" || mode === "content") {
      const unknown = await describeUnknownFilters(projectId as string, args)
      if (unknown) return textResult(unknown, true)
    }
    if (mode === "file") {
      let target: { absolute: string; relative: string }
      try {
        target = resolveSafeReadPath(projectPath, String(args.filePath))
      } catch (e: any) {
        return textResult(`bb_search mode=file: ${e?.message ?? "invalid path"}`, true)
      }
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      // Looked up by the INDEXED relative path first, not by the realpath'd
      // absolute one. resolveSafeReadPath returns realpathSync(candidate) while
      // brain_file.path holds the path the indexer was given, so a project
      // reached through a symlink (/tmp, /var on macOS, a symlinked checkout)
      // reported "file is not indexed" for a file that IS indexed. The relative
      // path is symlink-independent; the absolute path stays as a fallback for
      // an index built from realpaths.
      const byRelative = raw
        .prepare("SELECT id, language, file_hash FROM brain_file WHERE project_id=? AND relative_path=?")
        .get(projectId, target.relative) as { id: string; language: string; file_hash: string } | undefined
      const row = byRelative ?? (raw
        .prepare("SELECT id, language, file_hash FROM brain_file WHERE project_id=? AND path=?")
        .get(projectId, target.absolute) as { id: string; language: string; file_hash: string } | undefined)
      // An error envelope, not a throw: this handler's own contract (M40.A7,
      // stated above) is that invalid input returns isError, and the sibling
      // branches here already do.
      if (!row) return textResult(`bb_search mode=file: file is not indexed: ${target.relative}`, true)
      const read = readIndexedFile(target.absolute, projectPath, target.relative)
      if ("error" in read) return textResult(`bb_search mode=file: ${read.error}`, true)
      const content = read.content
      const maxChars = 100_000
      const truncated = content.length > maxChars
      // M35.E1: freshness from the shared resolver — per-item flag + envelope
      // block (file-scope remediation names this exact file).
      const detail = resolveRowsFreshnessDetailed(raw, projectId as any, [{ fileId: row.id }])
      const fileStatus = detail.statuses.get(row.id) ?? "missing"
      return textResult(JSON.stringify({
        searchMode: "file",
        file: target.relative,
        fileId: row.id,
        language: row.language || "unknown",
        content: truncated ? content.slice(0, maxChars) : content,
        contentLength: content.length,
        truncated,
        // Declared so every mode's response names its match set, even the one
        // that can only ever match a single file.
        totalMatches: 1,
        stale: fileStatus !== "fresh",
        freshness: buildStalenessEnvelope(detail.summary, { kind: "file", path: target.relative }),
      }, null, 2))
    }
    if (mode === "content") {
      const { searchContent } = await import("../intelligence/search/content-search")
      // searchContent returns a typed array with meta attached (searchMode/staleCount/…).
      // JSON.stringify of an array drops those properties, so the wire response must
      // wrap the results in an explicit envelope — otherwise the mode and freshness
      // metadata silently vanish for every MCP/CLI consumer.
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      // M43.A1 (#657): the pass is rerunnable — when the first pass finds stale
      // files within budget we repair them inline and run AGAIN so the answer
      // reflects the repair, with the decision declared on the answer.
      const runPass = async () => {
        // offset was never forwarded, although searchContent fully supports it —
        // so offset:100 returned page 1 byte-identically and an agent paging
        // until the page came back empty never terminated.
        const results = await searchContent(projectId as any, String(args.query ?? ""), {
          maxResults: Number(args.limit ?? 15),
          offset: Number(args.offset ?? 0),
          languages: args.language ? [String(args.language)] : undefined,
          symbolKind: args.symbolKind ? String(args.symbolKind) : undefined,
        })
        // M35.E1: freshness block from the shared resolver (rows carry fileId;
        // per-row stale flags are set by searchContent itself).
        const detail = resolveRowsFreshnessDetailed(raw, projectId as any, results.map((r: any) => ({ fileId: r.fileId })))
        return {
          answer: {
            searchMode: "content",
            query: String(args.query ?? ""),
            // `total` is the MATCH SET and `returned` is the page. Reporting the
            // page length as `total` meant a caller could not tell one match
            // from fifteen, and a truncated page read as a complete one.
            total: results.totalMatches ?? results.length,
            returned: results.length,
            staleCount: results.staleCount ?? 0,
            freshCount: results.freshCount ?? 0,
            truncated: results.truncated ?? false,
            ...(results.truncationReason ? { truncationReason: results.truncationReason } : {}),
            // Which route matched, and how much of the corpus has a searchable
            // body. Without these a caller cannot tell a phrase hit (the text
            // says this verbatim) from a keyword coincidence (it discusses the
            // same words), nor "nothing matched" from "nothing could match" on a
            // database indexed before bodies were stored. Declared in
            // SearchResults and populated by searchContent; carried here because a
            // disclosure that stops at the search layer is not a disclosure.
            ...(results.matchMode ? { matchMode: results.matchMode } : {}),
            // Which words carried the match, when the answer is a keyword
            // coincidence rather than the phrase that was asked for. This was
            // computed, declared in SearchResults, and then dropped here — so
            // the comment above ("a disclosure that stops at the search layer
            // is not a disclosure") was true of every OTHER field on this
            // object and false of this one.
            ...(results.termMatch ? { termMatch: results.termMatch } : {}),
            ...(results.bodyCoverage ? { bodyCoverage: results.bodyCoverage } : {}),
            freshness: buildStalenessEnvelope(detail.summary, { kind: "dir" }),
            results,
          },
          rows: results.map((r: any) => ({ fileId: r.fileId })),
          statuses: detail.statuses,
        }
      }
      const pass1 = await runPass()
      const staleFiles = collectStaleFiles(raw, pass1.rows, pass1.statuses)
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        if (decision.action === "refreshed") {
          const pass2 = await runPass()
          return textResult(JSON.stringify({ ...pass2.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
        if (decision.action === "declined") {
          // Honest decline: answer from existing data with the envelope, and
          // declare why the automatic repair did not run.
          return textResult(JSON.stringify({ ...pass1.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
      }
      return textResult(JSON.stringify(pass1.answer, null, 2))
    }
    if (mode === "symbol") {
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      // M43.A1 (#657): rerunnable pass — repair stale files inline within
      // budget, then answer from the SECOND pass so the answer reflects the
      // repair (declared).
      // Both branches produce either an answer or an error envelope, so the
      // call sites must narrow the type before reading answer/rows/statuses.
      type SymbolPass = { answer: Record<string, unknown>; rows: Array<{ filePath: string }>; statuses: Map<string, string> } | { envelope: string }
      const runPass = async (): Promise<SymbolPass> => {
        let found: { matches: any[] }
        try {
          found = await ASTEngine.findSymbol(projectId, String(args.symbolName ?? args.query ?? "").trim(), args.filePath ? String(args.filePath) : undefined)
        } catch (error: any) {
          // findSymbol's internals (dynamic import, DB handle) threw. The
          // handler returns an error envelope rather than letting a raw driver
          // or loader message reach the caller as a "successful" answer.
          return { envelope: `bb_search mode=symbol: ${error?.message ?? String(error)}` }
        }
        // M35.E1: per-match stale flag + envelope block. findSymbol rows alias
        // fileId to the file PATH, so the resolver gets filePath rows.
        const matches = (found as { matches: any[] }).matches ?? []
        const detail = resolveRowsFreshnessDetailed(raw, projectId as any, matches.map((m: any) => ({ filePath: m.fileId })))
        for (const m of matches) m.stale = detail.statuses.get(m.fileId) !== "fresh"
        return {
          answer: {
            ...found,
            // A symbol name can legitimately be declared in many files (a common
            // method name) and the whole set is returned. The envelope says so,
            // instead of leaving the caller to guess whether a long list is
            // complete.
            totalMatches: matches.length,
            truncated: false,
            freshness: buildStalenessEnvelope(detail.summary, { kind: "dir" }),
          },
          rows: matches.map((m: any) => ({ filePath: m.fileId })),
          statuses: detail.statuses,
        }
      }
      const pass1 = await runPass()
      if ("envelope" in pass1) return textResult(pass1.envelope, true)
      const staleFiles = collectStaleFiles(raw, pass1.rows, pass1.statuses)
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        if (decision.action === "refreshed") {
          const pass2 = await runPass()
          if ("envelope" in pass2) return textResult(pass2.envelope, true)
          return textResult(JSON.stringify({ ...pass2.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
        if (decision.action === "declined") {
          return textResult(JSON.stringify({ ...pass1.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
      }
      return textResult(JSON.stringify(pass1.answer, null, 2))
    }
    // Trimmed once, here, so the value echoed back in "no results for …" is the
    // value that was actually searched.
    const query = String(args.query ?? "").trim()
    if (!query) return textResult("bb_search: query must not be empty", true)
    // M43.A1 (#657): rerunnable pass — the pass answers from the SECOND run
    // after an inline repair, with the decision declared on a trailing line.
    // No staleness (searchCode's own resolution found none) ⇒ one pass, zero
    // added cost, byte-identical output with the pre-A1 behavior.
    const runPass = async () => {
      const results: any = await BrainTools.searchCode(projectId, query, {
        maxResults: Number(args.limit ?? 15),
        languages: args.language ? [String(args.language)] : undefined,
        symbolKind: args.symbolKind ? String(args.symbolKind) : undefined,
        includeContent: args.includeContent === true,
        exact: args.exact === true,
        caseSensitive: args.caseSensitive === true,
        regex: args.regex === true,
        offset: Number(args.offset ?? 0),
      })
      // A stale row's snippet is read from CURRENT disk while its line numbers
      // come from the index, so the two describe different revisions of the
      // file. The [STALE] marker qualifies the record; the snippet line is
      // marked separately, because the bytes are on the NEXT line.
      const lines = results.map((result: any) => {
        const stale = result.stale ? " [STALE]" : ""
        const snippet = result.snippet && result.snippet !== result.symbolName
          ? `\n    ${String(result.snippet).split("\n").slice(0, 8).join("\n    ")}${result.stale ? "\n    [snippet read from the current file; the line numbers above are from the index]" : ""}`
          : ""
        return `${result.symbolName} [${result.symbolType}] ${result.file}:${result.line} (${result.language})${stale}${snippet}`
      })
      // The engine already computed totalMatches / truncated / staleCount, and
      // this response is a rendered STRING — so those fields were structurally
      // dropped and a truncated page read as a complete one. The footer is what
      // makes the page legible: how many matches exist, whether the page is all
      // of them, and how many rows are stale.
      const total = results.totalMatches ?? results.length
      const footer: string[] = []
      if (total > lines.length) {
        footer.push(
          `showing ${lines.length} of ${total} match${total === 1 ? "" : "es"}` +
            (results.truncated ? " — TRUNCATED: a candidate cap or the noise filter kept matches out of this page" : ""),
        )
      }
      if ((results.staleCount ?? 0) > 0) footer.push(`${results.staleCount} of ${lines.length} results are STALE — the file changed after indexing`)
      if (results.freshnessError) footer.push("freshness could not be resolved for these results (staleCount is not a freshness claim)")
      if (results.truncated && lines.length === 0) {
        // An EMPTY page is not automatically a complete answer. When the engine
        // declared it was cut short, "no results" is a statement the caller
        // cannot check — a bounded scan and a scan that genuinely found nothing
        // were byte-identical. Measured case: `(a+)+b` on this repo's own index
        // returns "no results" in 0.3s when the scan completes and in 2s when
        // the time budget kills it; the two answers must not look the same.
        footer.push(
          `scan was cut short (${results.truncationReason ?? "unknown"}) over ${results.scannedRows ?? "some"} candidate rows — this is NOT a complete answer`,
        )
      } else if (results.truncated && lines.length > 0) {
        footer.push(`TRUNCATED (${results.truncationReason ?? "unknown"}) — this page is not the whole match set`)
      }
      return {
        text: lines.length
          ? lines.join("\n") + (footer.length ? `\n${footer.join("\n")}` : "")
          : `no results for "${query}"` + (footer.length ? `\n${footer.join("\n")}` : ""),
        results,
        lines,
        rows: results.map((r: any) => ({ fileId: r.fileId })),
      }
    }
    const pass1 = await runPass()
    // searchSymbols already resolved staleness internally (result.stale +
    // staleCount) — only when it found staleness do we resolve the row map
    // ourselves (no added stat cost on the fresh path) to build the repair set.
    if ((pass1.results.staleCount ?? 0) > 0) {
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      const detail = resolveRowsFreshnessDetailed(raw, projectId as any, pass1.rows)
      const staleFiles = collectStaleFiles(raw, pass1.rows, detail.statuses)
      if (staleFiles.length > 0) {
        const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
        if (decision.action === "refreshed") {
          const pass2 = await runPass()
          // pass2.text already carries the honest "no results for …" when the
          // edit removed every match — always keep it, then declare.
          return textResult(`${pass2.text}\n${autoRefreshLine(decision)}`)
        }
        if (decision.action === "declined") {
          // Honest decline appended to the stale answer — never silently stale.
          return textResult(`${pass1.text}\n${autoRefreshLine(decision)}`)
        }
      }
    }
    return textResult(pass1.text)
  },

  bb_ask: async (args, { projectId }) => {
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
  },

  bb_analyze: async (args, { projectId }) => {
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

    // M35.S1: staleness on every read mode — additive truth, rows flagged
    // never dropped, nothing silently re-indexed. Helper builds the shared
    // envelope from the F1 batch resolver.
    //
    // Latency budget (issue #582): freshness resolution must stay under 5% of
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
      // M40.A9: quarantined behind BB_TEST_HOOKS=1 — like the worker fixtures,
      // a stray env var must not silently degrade a production read path.
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
        result = await graphTraversal(projectId as any, target, { direction: mode === "trace" ? "both" : mode, maxDepth: 3 })
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
      const rawScope = args.filePath ? String(args.filePath) : target || undefined
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
          scope: first ? { kind: "file", path: first.file } : undefined,
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
      // M48.P1 (#696): ONE impact calculator. The report aggregates the SAME
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
        { sample: 64, onRows: (statuses) => { for (const e of report.entries as any[]) e.stale = statusFor(statuses, e.file) === "stale" } },
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
        { sample: 64, onRows: (statuses) => { for (const g of report.gaps as any[]) g.stale = statusFor(statuses, g.file) === "stale" } },
      )
    }
    if (mode === "test_impact") {
      const report = await testImpact(projectId as any, target)
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
      // Rows = the files in the report (<= maxFiles, default 50): complete
      // over visible rows; the sample cap still guards pathological limits.
      const relIds = relIdsFor(report.files.map((f) => f.relativePath))
      return withFreshness(
        report as unknown as Record<string, unknown>,
        report.files.map((f) => ({ fileId: relIds.get(f.relativePath) ?? null })),
        { sample: 64, onRows: (statuses) => { for (const f of report.files as any[]) f.stale = statuses.get(relIds.get(f.relativePath) ?? "") === "stale" } },
      )
    }
    return textResult("bb_analyze requires mode: callers|callees|trace|dependencies|stats|complexity|impact|test_mapping|test_gaps|test_impact|test_quality", true)
  },

  bb_health: async (args, { projectId, projectPath }) => {
    const refreshRequested = args.refresh === true || args.force === true
    const report = await getUnifiedHealth(projectId, projectPath, { refresh: refreshRequested, force: args.force === true, wait: args.wait !== false, freshness: args.freshness === "complete" ? "complete" : "sampled", sampleSize: args.sampleSize != null ? Number(args.sampleSize) : undefined, integrity: args.integrity === true, includeAnalysisRuns: args.includeAnalysisRuns === true, checkUnindexed: args.checkUnindexed === true, paths: Array.isArray(args.paths) ? args.paths.map((p: unknown) => String(p)) : undefined, verbose: args.verbose === true, logger: { log: (..._a: any[]) => {}, write: (_s: string) => {} } })
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, undefined, Number(args.limit ?? 20))
      // M64.P3: this branch returned a bare textResult, so it carried no
      // `healthy` — the ONE mode that answers in raw JSON, where a consumer is
      // most likely to branch programmatically, was the one mode without the
      // machine-readable channel. Round 2 added the field for exactly the
      // purpose of not having to parse prose, and then left it off the branch
      // that needs it least prose. Both branches now derive it from the same
      // predicate; a caller does not have to remember which shape it asked for.
      return {
        ...textResult(JSON.stringify({ health: report, history }, null, 2)),
        healthy: !report.warnings.some((w) => w.severity === "error"),
      }
    }
    const rendered = formatUnifiedHealth(report)
    // M64.P2: this tool now reports conditions that are genuinely ERRORS —
    // EMPTY_INDEX (the index holds nothing), INCOMPLETE_INDEX (the last run
    // wrote fewer files than it found), REFRESH_FAILED_ASYNC (a detached
    // rebuild did not finish), REFRESH_IN_PROGRESS (a wipe is mid-flight). The
    // CLI has always mapped an error-severity warning to a non-zero exit code.
    //
    // MCP deliberately does NOT set isError for them, and that is a decision
    // rather than an oversight. `isError` means "the tool could not do its
    // job" — an agent should not be handed a protocol-level failure when the
    // tool succeeded at its job, which is REPORTING that the index is broken.
    // The findings are in the payload, at the top level, as `error:` lines and
    // as severity-carrying warning objects; an agent that ignores all of that
    // would also ignore an isError it did not read. Every other tool here uses
    // isError for bad INPUT (an unknown scope, a missing target), never for bad
    // DATA — and an index's contents are data.
    //
    // So the divergence is intentional, and the thing that was actually missing
    // is a machine-readable channel for "the report contains errors", which a
    // caller can act on without parsing prose. `healthy: false` is that
    // channel: it is false exactly when an error-severity warning is present.
    return { ...textResult(rendered), healthy: !report.warnings.some((w) => w.severity === "error") }
  },

  bb_patterns: async (args, { projectId }) => {
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, "patterns", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    // M48.C2 (#700): unknown scope strings are refused, never silently
    // re-interpreted as "all" — a typo'd scope must not masquerade as a
    // different (much larger) scan.
    const scopeArg = String(args.scope ?? "all")
    if (!["all", "orphaned"].includes(scopeArg)) return textResult(`bb_patterns: unknown scope: ${scopeArg} (expected all|orphaned)`, true)
    const scope = scopeArg as "all" | "orphaned"
    const limit = Number(args.limit ?? 20)
    // M35.S2: live derived findings carry staleness truth — flagged per
    // finding, never silently presented as current. History (above) keeps its
    // recorded state; staleness applies to live reads only.
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    if (scope === "orphaned") {
      // Default 0, not 0.6. Orphan confidence is now EVIDENCE-DERIVED and spans
      // [0.30, 0.70] for symbols and [0.30, 0.55] for files, so a 0.6 default
      // would drop most symbol findings AND every single file finding — the
      // silent whole-rule loss this tool had before, re-created because the
      // number was left in place while the scale underneath it changed. With
      // 0, everything the scan found is reported and the ranking decides the
      // order; a caller who wants only the strongest passes 0.6 and gets them.
      const threshold = args.confidenceThreshold == null ? 0 : Number(args.confidenceThreshold)
      const report = await detectOrphans(projectId, { minConfidence: threshold, maxResults: Math.max(limit, 100) })
      const items = report.findings.slice(0, limit)
      const derived = derivedStaleness(rawDb, projectId as any, items.map((f) => f.location.file))
      const lines = items.map((f) => `  ${f.rule} ${f.location.symbol || f.location.file} — ${f.location.file}:${f.location.line} (${Math.round(f.confidence * 100)}%)${derived.isStale(f.location.file) ? " [stale]" : ""}`)
      // The census, not the page. This used to print summary.total, which IS
      // the engine's page length (100), while printing 20 lines: "orphaned code
      // (100)" above twenty findings, with nothing saying where the other 80
      // went or how many existed. Every number is now named, including what
      // the scan suppressed and why — a report of 0 is only honest if the
      // reader can see that it was not caused by suppression.
      const census = Number(report.summary?.candidatesTotal ?? items.length)
      const byRule = Object.entries(report.summary?.candidatesByRule ?? {} as Record<string, number>)
        .sort((a: any, b: any) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")
      const suppressed = (report.summary as any)?.suppressedByReason as Record<string, number> | undefined
      const suppressedLine = suppressed
        ? `\n[suppressed: ${Object.entries(suppressed).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(" ") || "nothing"}]`
        : ""
      const prov = `\n[provenance: ${report.provenance.evidenceClass} via ${report.provenance.engine}; scanned ${report.summary?.scannedSymbols ?? 0} symbol(s) in ${report.summary?.scannedFiles ?? 0} file(s); limitations: ${report.provenance.limitations.length}]`
      const countLine = `\n[scan: ${census} orphan candidate(s) ${byRule ? `(${byRule})` : ""}; showing ${items.length}${census > items.length ? ` — raise \`limit\` to see more` : ""}]`
      const footer = derived.footer ? `\n${derived.footer}` : ""
      return textResult(`orphaned code (${census} found):\n${lines.join("\n") || "  none"}${countLine}${suppressedLine}${prov}${footer}`)
    }
    const result: any = await PatternBrainTools.detectPatterns(projectId, {
      includeOrphaned: args.includeOrphaned !== false,
      includeFramework: args.includeFramework !== false,
      includeAntiPatterns: args.includeAntiPatterns !== false,
      confidenceThreshold: args.confidenceThreshold == null ? 0 : Number(args.confidenceThreshold),
      maxResults: Math.max(limit, 100),
    })
    const allPatterns = result?.patterns ?? []
    const items = allPatterns.slice(0, limit)
    const derived = derivedStaleness(rawDb, projectId as any, items.map((item: any) => item.location?.file))
    const lines = items.map((item: any) => `  [${item.severity}] ${item.type} @ ${item.location?.file}:${item.location?.line} (${Math.round(item.confidence * 100)}%)${derived.isStale(item.location?.file) ? " [stale]" : ""}`)
    const stalenessFooter = derived.footer ? `\n${derived.footer}` : ""
    // The census and the page are different numbers and the header used to
    // print neither: it printed statistics.totalFound, which was the page
    // length, under the words "patterns (N)". With the default limit of 20 the
    // tool fetched 100, printed 20 and said 100. All three numbers are now
    // named.
    const census = Number(result?.scan?.findingsBeforeDisplayLimit ?? result?.statistics?.totalFound ?? allPatterns.length)
    const typeCounts = Object.entries(result?.statistics?.byType ?? {} as Record<string, number>)
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([t, n]) => `${t}=${n}`)
    const countLine = `\n[scan: ${census} finding(s) across ${typeCounts.join(" ") || "no"} rule(s); showing ${items.length}${census > items.length ? ` — raise \`limit\` to see more` : ""}]`
    if (args.recordRun === true) {
      // The comment below used to claim the FULL analyzed set was persisted.
      // It was not: M57.T3 bounded the page inside detectPatterns, so
      // allPatterns was min(census, max(limit,100)) and the auto-resolve pass
      // would mark every finding past the page as resolved on the next run —
      // the exact failure the comment said it prevented. recordRun therefore
      // re-scans for the whole census. The cost is one finding object per
      // census entry, which is why it is only paid on this path; the cap keeps
      // a pathological project from exhausting memory, and the response says so
      // if the cap was hit.
      const RECORD_RUN_CENSUS_CAP = 50_000
      const full: any = await PatternBrainTools.detectPatterns(projectId, {
        includeOrphaned: args.includeOrphaned !== false,
        includeFramework: args.includeFramework !== false,
        includeAntiPatterns: args.includeAntiPatterns !== false,
        confidenceThreshold: args.confidenceThreshold == null ? 0 : Number(args.confidenceThreshold),
        maxResults: RECORD_RUN_CENSUS_CAP,
      })
      const censusPatterns: any[] = full?.patterns ?? []
      const recorded = await executeAnalysis({
        projectId,
        kind: "patterns",
        input: { options: args },
        // Persist the FULL analyzed set, never the display slice: recorded
        // history must reflect the run, not the truncated preview. Otherwise
        // findings past `limit` would be silently auto-resolved on the next
        // run even though they still exist.
        persist: () => censusPatterns.map((item: any): AnalysisFindingInput => ({
          fingerprint: item.fingerprint ?? `${item.type}:${item.location?.file ?? "?"}:${item.location?.line ?? "?"}`,
          rule: item.type ?? "pattern",
          title: item.description ?? item.type ?? "pattern finding",
          severity: item.severity ?? "info",
          confidence: item.confidence ?? null,
          evidence: item.evidence ?? [],
          location: item.location?.file ? `${item.location.file}:${item.location.line ?? "?"}` : null,
        })),
      })
      const found = full?.statistics?.totalFound ?? censusPatterns.length
      const capped = found > RECORD_RUN_CENSUS_CAP
      const capNote = capped ? ` — CAPPED at ${RECORD_RUN_CENSUS_CAP}; ${found} findings exist and ${found - RECORD_RUN_CENSUS_CAP} were not recorded, so they will be auto-resolved on the next run` : ""
      return textResult(`patterns (${found} found, ${recorded.report.run.findingCount} recorded) recorded run ${recorded.report.run.id}: new=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}${capNote}\n${lines.join("\n") || "  none"}${countLine}${stalenessFooter}`)
    }
    return textResult(`patterns (${census} found):\n${lines.join("\n") || "  none"}${countLine}${stalenessFooter}`)
  },

  bb_security: async (args, { projectId }) => {
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, "security", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    // A1: `recordRun` persists a SNAPSHOT whose completeness decides whether
    // still-real findings are auto-resolved. `completeAnalysisRun` marks every
    // prior `open` finding that is absent from the persisted set as `resolved`,
    // so a scan capped at the engine default (500) silently resolved everything
    // past 500 on a project that really had them. `bb_patterns` already guards
    // this with a census cap + a cap note (tool-handlers.ts:1174-1224); the
    // security path had no guard at all. Recording asks for a census-sized
    // scan; the DISPLAY still renders the ordinary window.
    const recordRun = args.recordRun === true
    const result: any = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(
      projectId,
      { maxResults: recordRun ? SECURITY_RECORD_RUN_CENSUS_CAP : SECURITY_SCAN_CAP },
    )
    const findings = result?.findings ?? []
    const suspicious = result?.suspiciousSources ?? []
    const summary = result?.summary
    // M35.S2: a stale taint/flow finding says so — security honesty. History
    // paths (above) keep their recorded state; this is the live read.
    //
    // B3: the unvalidated-source rows are ALSO derived from indexed files, so
    // they are resolved for freshness too. They were left out, which presented
    // stale observations as current fact. `derivedStaleness` filters null, and
    // `file` is now honestly `null` when neither endpoint resolved (it was the
    // `"?"` sentinel, which resolved to nothing and counted as `missing`).
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    const derived = derivedStaleness(rawDb, projectId as any, [...findings, ...suspicious].map((f: any) => f.file))
    // A1: the engine's own census vs. what is on screen. Silence here is what
    // made a 5000-flow project read as "20 findings" with no indication that
    // 4980 were unseen — the same contract bb_visualize and bb_search use.
    const capNote = result?.truncatedFindings > 0
      ? ` — CAPPED at ${(recordRun ? SECURITY_RECORD_RUN_CENSUS_CAP : SECURITY_SCAN_CAP).toLocaleString("en-US")}; ${result.deduplicatedFlows} findings exist and ${result.truncatedFindings} were not examined`
      : ""
    const countLine =
      `\n[scan: ${result?.scannedFlows ?? 0} taint flow(s) indexed → ${result?.deduplicatedFlows ?? 0} finding(s)` +
      `${result?.truncatedFindings ? ` (${result.truncatedFindings} beyond the cap)` : ""};` +
      ` showing ${Math.min(findings.length, SECURITY_FINDINGS_WINDOW)} finding(s)` +
      `${suspicious.length ? ` and ${Math.min(suspicious.length, SECURITY_SUSPICIOUS_WINDOW)} of ${suspicious.length} unvalidated observation(s)` : ""}]`
    // B2: the severity counts are the indexer's, and `taint.ts` now normalizes
    // severity into exactly these five buckets, so the head line cannot print
    // "0 critical" above a list of critical findings.
    const head = summary
      ? `security: ${summary.critical} critical / ${summary.high} high / ${summary.medium} medium / ${summary.low} low${summary.unknown ? ` / ${summary.unknown} unknown` : ""} (${summary.resolved} resolved flows, ${summary.unresolvedSources} unvalidated sources, ${summary.mitigated} mitigated)`
      : `security findings (${findings.length})`
    const where = (f: any) => (f.file ? `${f.file}:${f.line ?? "?"}` : "<unresolved location>")
    const lines = findings.slice(0, SECURITY_FINDINGS_WINDOW).map(
      (finding: any) => `  [${finding.severity}] ${finding.label ?? finding.type}${finding.symbol ? ` (${finding.symbol})` : ""} @ ${where(finding)}${finding.sourceType ? ` <- ${finding.sourceType}` : ""}${finding.sinkType ? ` -> ${finding.sinkType}` : ""}${finding.mitigated ? " [mitigated]" : ""}${finding.file && derived.isStale(finding.file) ? " [stale]" : ""}`,
    )
    // B1: the two observation states are DIFFERENT facts and were rendered with
    // one sentence. `source_only` genuinely has no sink ("no sink reached").
    // `unresolved` has a RESOLVED SINK and is missing the source — the old
    // text claimed the opposite for it, on the exact rows the indexer's
    // heuristic detectors produce (they write `source_symbol_id = NULL`).
    // B2 again: these rows carry the indexer's real severity (an isolated
    // command-injection sink is `critical`) and were all printed as `[info]`.
    const sourceLines = suspicious.slice(0, SECURITY_SUSPICIOUS_WINDOW).map((source: any) => {
      const isSourceOnly = source.state === "source_only"
      return `  [${source.severity}] unvalidated ${isSourceOnly ? "input source" : "sink"}: ${source.label ?? source.type}${source.symbol ? ` ${source.symbol}` : ""} @ ${where(source)} (${isSourceOnly ? "no sink reached" : "sink found; source endpoint not resolved to an indexed symbol"})${source.file && derived.isStale(source.file) ? " [stale]" : ""}`
    })
    if (recordRun) {
      const findingCount = findings.length
      const recorded = await executeAnalysis({
        projectId,
        kind: "security",
        input: { options: args },
        persist: () => findings.map((finding: any): AnalysisFindingInput => ({
          // A7: the persisted identity must be stable across runs AND distinct
          // per sink. The old key was `file:line:label`, which put a DISPLAY
          // label in the identity: re-labelling a vulnerability type would
          // resolve the old finding and mint a new one for a flow that never
          // changed. The key is now the normalized type + sink type + location,
          // so re-grading `severity` is a repeat and only a genuine move or
          // change of vulnerability type produces a new row.
          fingerprint: `taint:${finding.type}:${finding.sinkType ?? "?"}:${finding.file ?? "?"}:${finding.line ?? "?"}`,
          rule: finding.type ?? "security",
          title: finding.label ?? finding.type ?? "security finding",
          severity: finding.severity ?? "medium",
          // A7: the engine calibrates 0.7/0.4/0.3 by state; the legacy mapping
          // dropped it, so this read `?? null` and every persisted security
          // finding recorded NULL confidence.
          confidence: typeof finding.confidence === "number" ? finding.confidence : null,
          // A7: likewise `evidence` was always `[]` — history recorded security
          // findings with no evidence at all.
          evidence: finding.evidence ?? [],
          limitations: finding.limitations ?? [],
          evidenceClass: "static_finding",
          engine: "taint@intelligence",
          location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
          state: finding.mitigated ? "mitigated" : undefined,
        })),
      })
      return textResult(head + `\nrecorded run: ${recorded.report.run.id}\nnew=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}` + "\n" + `${findingCount} findings recorded${capNote}` + (lines.length ? "\n" + lines.join("\n") : "") + countLine + (sourceLines.length ? `\n\nunvalidated sources (not persisted):\n${sourceLines.join("\n")}` : "") + (derived.footer ? `\n${derived.footer}` : ""))
    }
    // The zero-findings case still states the census. "clean" alone is
    // indistinguishable from "found nothing" when the scan was capped or the
    // index has no taint rows at all, and those are very different facts.
    return textResult(head + "\n" + (lines.length ? lines.join("\n") : "  no findings with both endpoints resolved") + countLine + (sourceLines.length ? `\n\nunvalidated observations (leads, not confirmed exploitable paths):\n${sourceLines.join("\n")}` : "") + (derived.footer ? `\n\n${derived.footer}` : ""))
  },

  bb_visualize: async (args, { projectId }) => {
    // M31.T1: no silent scope/target fallback. The validation layer rejects
    // scoped calls without a target; unknown scope strings here are a handler
    // bug and must fail loudly rather than masquerade as a project graph.
    const scope = String(args.scope ?? "project")
    if (!["project", "file", "module", "symbol", "feature"].includes(scope)) return textResult(`bb_visualize: unknown scope: ${scope}`, true)
    // M48.C2 (#700): every non-project scope needs a target — without one the
    // old path silently rendered a project-wide graph for a scoped request.
    if (scope !== "project" && !args.target) return textResult(`bb_visualize scope=${scope} requires a target`, true)
    const request: VisualizationRequest = { scope: scope as VisualizationScope, target: args.target ? String(args.target) : undefined, format: ["text", "json", "html"].includes(String(args.format)) ? args.format : "text", view: ["graph", "codemap", "class"].includes(String(args.view)) ? args.view : "graph", maxNodes: args.maxNodes == null ? undefined : Number(args.maxNodes), maxLinks: args.maxLinks == null ? undefined : Number(args.maxLinks), relationshipTypes: Array.isArray(args.relationshipTypes) ? args.relationshipTypes.map(String) : undefined, languages: Array.isArray(args.languages) ? args.languages.map(String) : undefined }
    const result = await visualizeProject(projectId, request)
    // M35.S3: per-node stale flags (node file changed since index); links
    // inherit worst-of-endpoints — a link is stale if EITHER endpoint's file
    // is stale (the edge crosses changed code on either side). Truncation
    // metadata is untouched so truncated AND stale are both visible.
    const vizRaw = await BrainDatabase.getRawInstance(projectId as any)
    const vizFiles = [...new Set((result.nodes as any[]).map((n) => n.filePath).filter((p: unknown): p is string => typeof p === "string" && p.length > 0 && p !== "unknown"))]
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
    for (const n of result.nodes as any[]) n.stale = vizStatus(n.filePath) === "stale"
    const nodeById = new Map((result.nodes as any[]).map((n) => [n.id, n]))
    for (const l of result.links as any[]) {
      const s = nodeById.get(l.source)
      const t = nodeById.get(l.target)
      l.stale = (!!s && vizStatus(s.filePath) === "stale") || (!!t && vizStatus(t.filePath) === "stale")
    }
    const vizEnvelopeSource = { ...vizSummary, staleRatio: vizRows.length ? (vizSummary.stale + vizSummary.missing) / vizRows.length : 0, freshnessMode: "complete" as const }
    if (request.format === "json") {
      const parsed = JSON.parse(formatVisualization(result))
      parsed.freshness = buildStalenessEnvelope(vizEnvelopeSource, { kind: "dir" })
      return textResult(JSON.stringify(parsed, null, 2))
    }
    const vizOut = formatVisualization(result)
    const vizFooter = vizSummary.stale + vizSummary.missing > 0 ? `\n\n${vizSummary.stale} stale, ${vizSummary.missing} missing of ${vizRows.length} graph files — ${FRESHNESS_REMEDIATION.dir}` : ""
    return textResult(vizOut + vizFooter)
  },

  bb_migrate: async (args, { projectId, projectPath }) => {
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
  },

  bb_doc: async (args, { projectId, projectPath }) => {
    const mode = String(args.mode ?? "") as DocRequest["mode"]
    if (!["symbol", "file", "module", "feature", "api", "project", "coverage"].includes(mode)) return textResult("bb_doc requires mode: symbol|file|module|feature|api|project|coverage", true)
    if (["symbol", "file", "module", "feature"].includes(mode) && !args.target) return textResult(`bb_doc ${mode} mode requires target`, true)
    const request: DocRequest = { mode, target: args.target ? String(args.target) : undefined, format: args.format === "json" ? "json" : "markdown", audience: args.audience, detail: args.detail, includeExamples: args.includeExamples === true, includeDiagrams: args.includeDiagrams === true, includeTests: args.includeTests === true, limit: args.limit == null ? undefined : Number(args.limit), maxTokens: args.maxTokens == null ? undefined : Number(args.maxTokens) }

    // M43.A1/A2 parity: bb_doc is a READ tool, so it participates in the inline
    // bounded auto-refresh like bb_search / bb_ask / bb_analyze do. It did not,
    // while the registered remediation string it printed told the reader to
    // "disable with BB_NO_AUTO_REFRESH=1 or refresh=false" — naming two
    // controls this tool did not have, and leaving AGENTS.md's promise ("reads
    // refresh stale files within budget") false for this one read path.
    //
    // The flow is the shared one: generate, resolve freshness over the files the
    // doc actually cites, repair exactly those files if they are stale within
    // budget, then REGENERATE so the answer is not built from the rows the
    // refresh just replaced. A decline is declared, never silent.
    const generate = async (): Promise<{ result: any; derived: ReturnType<typeof derivedStaleness>; rows: Array<{ fileId: string | null }>; statuses: Map<string, string> }> => {
      const result = await generateDocumentation(projectId, projectPath, request)
      const rawDb = await BrainDatabase.getRawInstance(projectId as any)
      // Only a file-backed citation can name a file to repair; an index-scoped
      // citation has no path and contributes to the envelope, not the repair set.
      const relPaths = (result.citations ?? []).map((c: any) => c.path ?? undefined).filter((p: any): p is string => !!p)
      const derived = derivedStaleness(rawDb, projectId as any, relPaths)
      const relToId = new Map<string, string>()
      if (relPaths.length) {
        for (const r of rawDb.prepare(`SELECT id, relative_path FROM brain_file WHERE project_id = ? AND relative_path IN (${relPaths.map(() => "?").join(",")})`).all(projectId, ...relPaths) as Array<{ id: string; relative_path: string }>) {
          relToId.set(r.relative_path, r.id)
        }
      }
      const rows = relPaths.map((p) => ({ fileId: relToId.get(p) ?? null }))
      return { result, derived, rows, statuses: resolveRowsFreshnessDetailed(rawDb, projectId as any, rows).statuses }
    }

    const first = await generate()
    const staleFiles = collectStaleFiles(await BrainDatabase.getRawInstance(projectId as any), first.rows, first.statuses)
    let autoRefreshLineText = ""
    let final = first
    if (staleFiles.length > 0) {
      const decision = await maybeAutoRefresh(projectId, projectPath, staleFiles, { perCallOptOut: args.refresh === false })
      autoRefreshLineText = autoRefreshLine(decision)
      // Regenerate after a repair: answering from the rows the refresh just
      // replaced would be the one thing a documentation tool must not do.
      if (decision.action === "refreshed") final = await generate()
    }

    // M35.S2: the doc carries the registered freshness envelope over its cited
    // files; per-citation freshness is already resolved inside the engine and
    // rendered in Sources. JSON gets the exact registered block; text/markdown
    // get the footer built from the registered remediation constant. A markdown
    // document that cites no file has no scope to be stale in, and says nothing
    // about staleness rather than a clean 0/0/0 that reads as a measurement.
    if (request.format === "json") {
      const parsed = JSON.parse(formatDocumentation(final.result, "json"))
      parsed.freshness = buildStalenessEnvelope(final.derived.summary, { kind: "dir" })
      if (autoRefreshLineText) parsed.autoRefresh = autoRefreshLineText
      return textResult(JSON.stringify(parsed, null, 2))
    }
    const base = formatDocumentation(final.result, request.format)
    const parts = [base]
    if (autoRefreshLineText) parts.push(autoRefreshLineText)
    if (final.rows.length === 0) {
      parts.push("Freshness not applicable: this document cites no file, so there is no source to be stale.")
    } else if (final.derived.footer) {
      parts.push(`---\n${final.derived.footer}`)
    }
    return textResult(parts.join("\n\n"))
  },

  bb_edit: async (args, { projectId, projectPath }) => {
    const request = args as EditRequest
    if (!(["write", "update", "insert", "delete", "refactor"] as const).includes(request.mode as any)) return textResult("bb_edit requires mode: write|update|insert|delete|refactor", true)
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
      }, null, 2), true)
    }
  },

  // M22.E1: agent-fresh. A file reindexes only itself; a dir runs an
  // incremental index (changed files only) so an agent that just wrote a
  // function can make it visible immediately without a full reindex.
  bb_index: async (args, { projectId, projectPath }) => {
    const raw = String(args.path ?? "")
    if (!raw) return textResult("bb_index requires path", true)
    const mode = String(args.mode ?? "auto")
    // M48.C2 (#700): unknown modes are refused, never silently treated as
    // another mode — the old fall-through executed a full dir index for ANY
    // unrecognized mode string.
    if (!["auto", "file", "dir", "post"].includes(mode)) return textResult(`bb_index: unknown mode: ${mode} (expected auto|file|dir|post)`, true)
    // M40.A1: mode=post — re-run the heavy derived-data phases (relationships,
    // enrichment, gravity, taints, health) WITHOUT re-parsing. The remediation
    // for stale derived data after agent edits or incremental indexing.
    if (mode === "post") {
      // `path` is REQUIRED by the schema and the registry describes it as "the
      // project whose derived phases should be re-run". It was then ignored
      // entirely: `mode=post` with `path: "no/such/path/at/all"` re-derived all
      // eight phases and reported success. A required parameter that is not
      // read is a requirement that teaches a caller the wrong lesson.
      const postAbs = path.isAbsolute(raw) ? raw : path.resolve(projectPath, raw)
      if (!existsSync(postAbs)) {
        return textResult(`bb_index mode=post: no such path: ${postAbs} — mode=post re-derives the phases of THIS project, and the required \`path\` must name it.`, true)
      }
      const { runPostProcessing } = await import("../ast/parallel-indexer")
      try {
        const post = await runPostProcessing(projectId as any, { logger: { log: () => {}, write: () => {} } })
        return textResult(JSON.stringify({ mode: "post", path: raw, phases: post.phases, totalMs: post.totalMs, integrityHealth: post.integrityHealth }, null, 2))
      } catch (e: any) {
        return textResult(`bb_index mode=post failed: ${e?.message}`, true)
      }
    }
    const abs = path.isAbsolute(raw) ? raw : path.resolve(projectPath, raw)
    if (!existsSync(abs)) return textResult(`bb_index: no such path: ${abs}`, true)
    // The path must be INSIDE the project.
    //
    // `path.resolve(projectPath, raw)` happily walks out: `bb_index path: "../x.ts"`
    // and an absolute path to any file on the machine both resolved and indexed.
    // Measured on a scratch project, all three of these were accepted with
    // `indexed: 1`:
    //
    //   an absolute path to a file in another directory
    //   a relative `../other-dir/file.ts`
    //   `mode: "dir"` on a whole directory OUTSIDE the project
    //
    // and the row it wrote has a "project-relative" path that is not one — the
    // absolute path with its leading `/` stripped:
    //
    //   Users/…/secrets-cOJXSq/credentials.ts
    //
    // `relative_path` is the key for `bb_analyze filePath` scoping, for every
    // file the graph modes name, and for freshness resolution by path, so those
    // rows are invisible to scoped queries while still counted in `stats.files`
    // (measured: a 2-file project reporting 3). It is a write tool, so the
    // pollution persists. And the file is then discoverable by name through the
    // read tools, with its out-of-tree location printed.
    //
    // The registry already says "Project-relative file (reindex only that
    // file)"; this is the check that makes that sentence true. Both sides are
    // resolved through `realpath` so a symlink inside the project pointing out
    // of it is refused too — a lexical check alone would wave it through.
    const rootReal = realpathSync(projectPath)
    const absReal = realpathSync(abs)
    const relToRoot = path.relative(rootReal, absReal)
    // `relToRoot === ""` is the project root ITSELF, which is in bounds and is
    // the documented way to reindex a whole project — `mode: auto` on a
    // directory runs a dir index. Refusing it was my own bug on the first
    // version of this guard, caught by the suite immediately.
    const outsideRoot = relToRoot === "" ? false : relToRoot.startsWith("..") || path.isAbsolute(relToRoot)
    if (outsideRoot) {
      return textResult(
        `bb_index: refusing a path outside the project. "${raw}" resolves to ${absReal}, which is not inside ${rootReal}. ` +
          `bb_index indexes THIS project's files; an out-of-tree path would be stored with a "project-relative" path that is not relative to anything, and every scoped query, file name and freshness check in the index would then be wrong for it.`,
        true,
      )
    }
    const isDir = statSync(abs).isDirectory()
    const effective = mode === "auto" ? (isDir ? "dir" : "file") : mode
    if (effective === "file" && isDir) return textResult("bb_index mode=file requires a file path", true)
    if (effective === "dir" && !isDir) return textResult("bb_index mode=dir requires a directory path", true)
    if (effective === "file") {
      try {
        const r = await reindexFilesParallel(projectId as any, projectPath, [{ path: abs, type: "modified" }])
        // M40.A3: derived-data telemetry surfaced — an agent can see whether
        // relationships/gravity were re-derived for the touched file, and how
        // many caller edges were repaired, without inspecting logs.
        // `indexed: 0, deleted: 0, errors: 0` reads as "nothing happened and
        // nothing failed", and those are three different situations: the file
        // was already current, the file is not indexable (a binary, say), or
        // the indexer declined it for some other reason. Measured on a binary
        // file: exactly that answer, with no way to tell it from a no-op.
        // So when nothing happened, say which of the two it was.
        const didNothing = r.indexed === 0 && r.deleted === 0 && r.errors === 0
        const note = didNothing
          ? {
              outcome: "no-op",
              skipped: r.skipped ?? 0,
              reason:
                r.skippedReason ??
                (r.skipped
                  ? `${r.skipped} file(s) hold nothing the indexer extracts`
                  : "nothing changed: the file's content already matches the index"),
            }
          : { outcome: r.errors > 0 ? "partial" : "indexed" }
        return textResult(
          JSON.stringify(
            {
              mode: "file",
              path: raw,
              indexed: r.indexed,
              deleted: r.deleted,
              errors: r.errors,
              // Which files failed and why, when any did. `errors` alone is a
              // count, and a count is not something a caller can act on.
              ...(r.errors > 0 ? { errorDetail: r.errorDetail ?? [] } : {}),
              ...note,
              derived: r.derived ?? { pass: "deferred", phases: [], repairedInEdges: 0, touchedSymbols: 0 },
            },
            null,
            2,
          ),
        )
      } catch (e: any) {
        // M43.P1: another indexer holds the project lock — declared refusal,
        // never a thrown handler crash.
        return textResult(`bb_index mode=file refused: ${e?.message}`, true)
      }
    }
    // M48.C2 (#700): dir-mode detects changes under the requested directory
    // but reindexes from the PROJECT ROOT — file keys are root-relative and
    // never move, so a subdir index can no longer corrupt the index.
    try {
      const { collectDirChanges } = await import("../ast/parallel-indexer")
      const changes = await collectDirChanges(projectId as any, projectPath, abs)
      if (changes.length === 0) {
        return textResult(JSON.stringify({ mode: "dir", path: raw, candidates: 0, processed: 0, deleted: 0, errors: 0, unchanged: true }, null, 2))
      }
      const r = await reindexFilesParallel(projectId as any, projectPath, changes)
      return textResult(
        JSON.stringify(
          {
            mode: "dir",
            path: raw,
            candidates: changes.length,
            processed: r.indexed,
            deleted: r.deleted,
            errors: r.errors,
            ...(r.errors > 0 ? { errorDetail: r.errorDetail ?? [] } : {}),
            skipped: r.skipped ?? 0,
          },
          null,
          2,
        ),
      )
    } catch (e: any) {
      return textResult(`bb_index mode=dir refused: ${e?.message}`, true)
    }
  },

  // --- M28.T1 (issue #624): the agent door to the graph surface ------------
  // Decision D-1: these handlers call the same functions the LSP handlers
  // call. The union differential gate (M28.U1) proves the two doors agree.

  bb_graph: async (args, { projectId }) => {
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
    const tierFor = (e: { relationshipType: string; confidence: number; metadata?: { evidenceClass?: string } }): string => {
      // Identical tier derivation to the webview core (script/m26/graph-core.ts
      // tierForEdge) and the hover gloss — M28.U1 drift-gates the copies.
      const STRUCTURAL = new Set(["calls", "inherits", "implements", "overrides"])
      const IMPORT = new Set(["imports", "import"])
      const stored = e.metadata?.evidenceClass
      if (stored && ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"].includes(stored)) return stored
      if (STRUCTURAL.has(e.relationshipType)) return e.confidence >= 0.7 ? "structural" : "inferred"
      if (IMPORT.has(e.relationshipType)) return "import_based"
      return "inferred"
    }
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
        truncated: result.summary?.truncated === true,
        truncationReason: result.summary?.truncationReason ?? null,
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
  },

  bb_impact: async (args, { projectId, projectPath }) => {
    const symbol = String(args.symbol ?? "")
    if (!symbol) return textResult("bb_impact requires symbol", true)
    const relationshipTypes: string[] | undefined =
      Array.isArray(args.relationshipTypes) ? args.relationshipTypes.map((t: unknown) => String(t)) : undefined
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
        const impact = await computeImpact(raw, projectId as string, symbol, {}, undefined, relationshipTypes ? { relationshipTypes } : {})
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
      return textResult(`bb_impact: ${error instanceof Error ? error.message : String(error)}`, true)
    }
  },

  // M63.CL1 — the agent door, rebuilt on the same single owner
  // (src/lsp/cross_language_hover.ts). Four defects, all measured on a real
  // polyglot corpus (validation/m63/results/CL1.json), all fixed here:
  //
  //   A. The old door ran `SELECT ... WHERE project_id = ? AND name = ?` with
  //      `.get()` — ONE arbitrary copy of a name the index holds up to 227
  //      times (the index has one symbol per file/name/line), and reported that
  //      copy's rows as the whole answer. When the copy SQLite happened to
  //      return held none, the tool answered `declaredAbsent: true` — "no
  //      stored cross-language rows for this symbol — absence declared, never
  //      guessed" — while the index held 21 such rows for the name. A false
  //      absence is the worst thing a tool whose contract is "never guesses"
  //      can emit. The facts are now the UNION over every copy, the copies are
  //      named, and absence is declared only when no copy holds a row.
  //   B. Each fact now names the counterparty (symbol, file, language, line)
  //      and the stored row id — the fields bb_graph already returns and the
  //      hover card did not need. A language pair alone cannot answer "does my
  //      Kotlin Warehouse reach my Java Inventory, and where".
  //   C. The answer is bounded by a declared `limit`, and truncation is
  //      first-class (`truncated` / `truncationReason` / `totalCountIfKnown`),
  //      exactly as bb_impact reports its budget. 106 stored rows used to
  //      become 106 identical facts and 20,904 bytes.
  //   D. The row query filters on `r.project_id = ?`. The old door took the
  //      symbol id as its only key and never constrained the ROW's project;
  //      a relationship row minted for another project and pointing at this
  //      symbol was returned as one of this tool's own facts (reproduced
  //      before the fix).
  bb_cross_language: async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "").trim()
    if (!symbol) return textResult("bb_cross_language requires symbol", true)
    const limitRaw = args.limit === undefined || args.limit === null ? CROSS_LANGUAGE_DEFAULT_LIMIT : Number(args.limit)
    if (!Number.isFinite(limitRaw) || limitRaw < 1 || limitRaw > CROSS_LANGUAGE_MAX_LIMIT) {
      return textResult(`bb_cross_language: limit must be a number between 1 and ${CROSS_LANGUAGE_MAX_LIMIT}`, true)
    }
    const limit = Math.floor(limitRaw)
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    // Existence is its own question, and it is asked over every copy: a name
    // the index does not hold is a loud error (never an empty set), a name it
    // holds is answered for all of its copies.
    const exists = raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ?").get(projectId, symbol) as { n: number }
    if (!exists || exists.n === 0) {
      return textResult(`bb_cross_language: symbol '${symbol}' not found — declared error, not an empty set`, true)
    }
    const result = storedCrossLanguageFactsByName(raw, projectId as string, symbol)
    // ONE budget over the union, own rows first. Two independent limits would
    // mean a caller holding one `limit` could not reason about the size of the
    // answer, and the exact rows — the ones that name the symbol itself — must
    // never be crowded out by a member's edges.
    const totalFacts = result.facts.length + result.memberFacts.length
    const ownShown = result.facts.slice(0, limit)
    const remaining = Math.max(0, limit - ownShown.length)
    const memberShown = result.memberFacts.slice(0, remaining)
    const shownCount = ownShown.length + memberShown.length
    const truncated = totalFacts > shownCount
    // `language` is only meaningful when the copies agree. On an ambiguous
    // name it is null and `languages` carries the truth, rather than the
    // single language of whichever copy the database happened to return first.
    const language = result.languages.length === 1 ? result.languages[0]! : null
    return textResult(JSON.stringify({
      symbol,
      language,
      languages: result.languages,
      copies: result.copies,
      copyCount: result.copyCount,
      // M63.CL5: `limit` governs FACTS. It said nothing about the copy list, which
      // was as long as the index says the name is ambiguous — measured at 844KB for
      // a name with 5,000 copies and a single cross-language row, at both `limit: 1`
      // and `limit: 200`, with `truncated: false` saying nothing had been dropped.
      // The response was not bounded. It is now, and the cap is declared rather
      // than applied quietly: an answer that hides its own bound is the defect this
      // fixes, repeated one field over.
      copiesTruncated: result.copiesTruncated,
      copiesCap: result.copiesCap,
      copiesNote: result.copiesTruncated
        ? `copies is the first ${result.copies.length} of ${result.copyCount} indexed symbols named '${symbol}' (cap ${result.copiesCap}); the EDGES are unaffected, because every copy holding a cross-language row is reported in facts regardless of where it sits in that list`
        : null,
      ambiguous: result.ambiguous,
      ambiguityNote: result.ambiguous
        ? `${result.copyCount} indexed symbols are named '${symbol}' across ${new Set(result.copies.map((c) => c.file)).size} file(s); the facts below are the union over all of them, and every fact names the copy it came from`
        : null,
      // Rows on the copies themselves.
      facts: ownShown,
      ownFactCount: ownShown.length,
      // Rows on the MEMBERS of the copies, each marked `owner-cascade` and
      // naming the member. These are the MEMBER's edges, never the owner's,
      // which is why they are a separate section and not merged into `facts`.
      memberFacts: memberShown,
      memberFactCount: memberShown.length,
      memberCount: result.memberCount,
      memberNote: result.memberCount > 0
        ? `${result.memberCount} member symbol(s) of '${symbol}' hold cross-language rows of their own. They are reported under memberFacts, marked match "owner-cascade" with matchedMember naming the member — they are the MEMBER's edges, not '${symbol}'s. bb_graph's cascaded count for the same symbol is larger, because its cascade is a lexical id-prefix range rather than the store's owner_symbol_id; both are declared rather than reconciled.`
        : null,
      pairCount: shownCount,
      // Distinct language pairs — the number a human actually reads, and the
      // one that stays small where the row count does not.
      distinctPairCount: new Set([...ownShown, ...memberShown].map((f) => `${f.pair}|${f.direction}|${f.bridge}|${f.tier}`)).size,
      storedRowCount: result.storedRowCount,
      unpairableRowCount: result.unpairableRowCount,
      collapsedRowCount: result.collapsedRowCount,
      limit,
      truncated,
      truncationReason: truncated
        ? `declared limit of ${limit} facts; ${totalFacts} stored cross-language rows matched this name (${result.facts.length} on the symbol itself, ${result.memberFacts.length} on its members)`
        : null,
      totalCountIfKnown: totalFacts,
      // ABSENCE MEANS THE NAME IS SILENT, NOT THE SYMBOL. Before this it was
      // `facts.length === 0` alone, so a class whose members carried 109
      // cross-language rows while it carried none was answered "absence
      // declared, never guessed" — a false absence, on the most natural
      // question a caller can ask ("is this class involved in cross-language
      // code?"), and the direct opposite of what bb_graph said about the same
      // symbol on the same index (measured: 7 of 10 such owners, docs/m63/CL2.md).
      // An empty answer now requires that NEITHER the copies NOR their members
      // hold a stored row.
      declaredAbsent: shownCount === 0,
      // SCOPE, and it used to be wrong. M63.CL4: this read "anywhere in the
      // index", but all three queries bind a projectId as their first parameter,
      // so the search covered exactly one project. With the same name present in
      // a second project that DOES hold cross-language rows for it, the sentence
      // was false as written — measured, with both projects real
      // (lane/cl-absence-scope.ts: CLAIM_IS_FALSE). An agent reads this instead of
      // checking, so an overclaim here is worse than an overclaim in a count.
      // Absence for THIS project is still correct and still declared; only the
      // universality was wrong.
      // M63.CL5: this note is only true about the name and its DIRECT members, and
      // it used to read as though it were true about the symbol. Measured: 141
      // cross-language rows sit on grandchildren on the JVM corpus (19 owners) and
      // 27 on elixir (4), with nesting reaching depth 4 and 6 — and for those owners
      // this tool answered `declaredAbsent: true` with nothing in `facts`.
      //
      // `declaredAbsent` stays TRUE, because it remains exactly what CL2 made it
      // mean: the name and its direct members hold no stored row. What changes is
      // that the note no longer implies the index holds nothing, and the count is
      // given so a caller can tell this apart from a genuinely unconnected symbol
      // rather than having to ask bb_graph and hope.
      //
      // The rows are COUNTED and not emitted: they are the descendants' edges, and
      // CL2 ruled they are reported as the member's, never absorbed into the owner.
      deeperDescendantRowCount: result.deeperDescendantRowCount,
      deeperDescendantNote: result.deeperDescendantRowCount > 0
        ? `${result.deeperDescendantRowCount} stored cross-language row(s) sit on members-of-members and deeper below '${symbol}'. They are NOT cascaded into the facts above — they are the descendants' edges, not '${symbol}'s — and bb_graph reports none of them either, so both doors are silent about them. Ask about the member directly to see them.`
        : null,
      absenceNote: shownCount === 0
        ? (result.deeperDescendantRowCount > 0
            ? `no stored cross-language rows anywhere in THIS PROJECT's index for '${symbol}' or for any of its DIRECT members — but ${result.deeperDescendantRowCount} row(s) sit on members-of-members and deeper (deeperDescendantRowCount), which are the descendants' edges and are deliberately not cascaded. Absence at this level declared, never guessed; this is not the same as the symbol being unconnected.`
            : `no stored cross-language rows anywhere in THIS PROJECT's index for '${symbol}', for any of its members, or on any member-of-member and deeper — absence declared, never guessed`)
        : null,
      // The symptom that produced this change, stated in the answer itself: the
      // symbol is silent and its members are not. A caller reading only
      // `declaredAbsent: false` would otherwise assume the symbol itself is the
      // connected one.
      silentItselfButNotItsMembers: ownShown.length === 0 && memberShown.length > 0,
    }, null, 2))
  },

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
  bb_annotate: async (args, { projectId }) => {
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
    const isReplacement = prior !== undefined && prior.body !== body
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
  },

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
  bb_annotations: async (args, { projectId }) => {
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
  },

}

export function createToolHandlers(): Readonly<Record<string, ToolHandler>> {
  const registeredNames = new Set(TOOL_DESCRIPTORS.map((descriptor) => descriptor.name))
  for (const name of registeredNames) if (!handlers[name]) throw new Error(`missing handler for registered tool: ${name}`)
  for (const name of Object.keys(handlers)) if (!registeredNames.has(name)) throw new Error(`handler has no registered tool: ${name}`)
  return handlers
}
