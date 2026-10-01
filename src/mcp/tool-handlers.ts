import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../brain/database"
import { annotationId } from "../brain/annotation-store"
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
import { tierForCrossLanguageEdge, factsFromRows, storedCrossLanguageRows } from "../lsp/cross_language_hover"
import { getProjectStats } from "../intelligence/analysis/project-stats"
import { getFileDependencies } from "../intelligence/analysis/dependencies"
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

export interface ToolContext {
  projectPath: string
  projectId: string
}

export type ToolArguments = Record<string, any>
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
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
  if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error(`file not found: ${requested}`)
  const absolute = realpathSync(candidate)
  ensureWithinProject(root, absolute)
  return { absolute, relative: path.relative(root, absolute).split(path.sep).join("/") }
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
  let result
  try {
    result = await computeImpact(raw, projectId, target, {
      traverse: (async (pid: string, symbol: string, opts: any) => {
        const r = await graphTraversal(pid, symbol, opts)
        capturedEdges = r.callers ?? []
        capturedNodes = r.nodes ?? {}
        return r
      }) as any,
    })
  } catch {
    return notFound()
  }

  const internal = new Map<string, { name: string; file: string; depth: number }>()
  let unresolvedEdges = 0
  let depthReached = 0
  for (const entry of result.impact as Array<{ id: string; name: string; file: string; depth: number }>) {
    if (entry.depth > depthReached) depthReached = entry.depth
    const node = capturedNodes[entry.id]
    if (node?.isExternal === true || !entry.file) { unresolvedEdges++; continue }
    const existing = internal.get(entry.id)
    if (!existing || entry.depth < existing.depth) internal.set(entry.id, { name: entry.name, file: entry.file, depth: entry.depth })
  }
  for (const edge of capturedEdges) {
    const node = capturedNodes[edge.from]
    if (node?.isExternal === true) unresolvedEdges++
  }

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
    if (mode === "file") {
      let target: { absolute: string; relative: string }
      try {
        target = resolveSafeReadPath(projectPath, String(args.filePath))
      } catch (e: any) {
        return textResult(`bb_search mode=file: ${e?.message ?? "invalid path"}`, true)
      }
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      const row = raw.prepare("SELECT id, language, file_hash FROM brain_file WHERE project_id=? AND path=?").get(projectId, target.absolute) as { id: string; language: string; file_hash: string } | undefined
      if (!row) throw new Error(`file is not indexed: ${target.relative}`)
      const content = readFileSync(target.absolute, "utf8")
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
        const results = await searchContent(projectId as any, String(args.query ?? ""), { maxResults: Number(args.limit ?? 15), languages: args.language ? [String(args.language)] : undefined, symbolKind: args.symbolKind ? String(args.symbolKind) : undefined })
        // M35.E1: freshness block from the shared resolver (rows carry fileId;
        // per-row stale flags are set by searchContent itself).
        const detail = resolveRowsFreshnessDetailed(raw, projectId as any, results.map((r: any) => ({ fileId: r.fileId })))
        return {
          answer: {
            searchMode: "content",
            query: String(args.query ?? ""),
            total: results.length,
            staleCount: results.staleCount ?? 0,
            freshCount: results.freshCount ?? 0,
            truncated: results.truncated ?? false,
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
      const runPass = async () => {
        const found = await ASTEngine.findSymbol(projectId, String(args.symbolName ?? args.query ?? ""), args.filePath ? String(args.filePath) : undefined)
        // M35.E1: per-match stale flag + envelope block. findSymbol rows alias
        // fileId to the file PATH, so the resolver gets filePath rows.
        const matches = (found as { matches: any[] }).matches ?? []
        const detail = resolveRowsFreshnessDetailed(raw, projectId as any, matches.map((m: any) => ({ filePath: m.fileId })))
        for (const m of matches) m.stale = detail.statuses.get(m.fileId) !== "fresh"
        return {
          answer: { ...found, freshness: buildStalenessEnvelope(detail.summary, { kind: "dir" }) },
          rows: matches.map((m: any) => ({ filePath: m.fileId })),
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
          return textResult(JSON.stringify({ ...pass1.answer, autoRefresh: autoRefreshLine(decision) }, null, 2))
        }
      }
      return textResult(JSON.stringify(pass1.answer, null, 2))
    }
    const query = String(args.query ?? "")
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
      const lines = results.map((result: any) => {
        const stale = result.stale ? " [STALE]" : ""
        const snippet = result.snippet && result.snippet !== result.symbolName
          ? `\n    ${String(result.snippet).split("\n").slice(0, 8).join("\n    ")}`
          : ""
        return `${result.symbolName} [${result.symbolType}] ${result.file}:${result.line} (${result.language})${stale}${snippet}`
      })
      return {
        text: lines.length ? lines.join("\n") : `no results for "${query}"`,
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
    const result = await quickAnswer(projectId, String(args.query))
    const lines = result.sources
      .slice(0, Number(args.limit ?? 5))
      .map((source, index) => `${index + 1}. ${source.file}:${source.line}\n   ${source.context ?? ""}`)
    const head = result.answer ? `answer: ${result.answer}\n\n` : ""
    const prov = `[provenance: ${result.provenance.evidenceClass} via ${result.provenance.engine}${result.provenance.unknowns.length ? `; unknowns: ${result.provenance.unknowns.join("; ")}` : ""}]`
    return textResult(head + (lines.length ? lines.join("\n") : `no semantic matches for "${args.query}"`) + `\n${prov}`)
  },

  bb_analyze: async (args, { projectId }) => {
    const mode = String(args.mode ?? "")
    const allowed = new Set(["mode", "target", "filePath", "limit"])
    const unused = Object.keys(args).filter((key) => !allowed.has(key))
    if (unused.length) return textResult(`bb_analyze ${mode || "unknown"}: irrelevant options: ${unused.join(", ")}`, true)
    const target = args.target ? String(args.target) : ""
    const targetModes = new Set(["callers", "callees", "trace", "complexity", "impact", "test_impact"])
    // filePath scopes dependencies plus the three test-intel modes (path
    // prefix); stats stays project-wide and rejects filePath.
    const fileModes = new Set(["dependencies", "test_mapping", "test_gaps", "test_quality"])
    if (args.target && !targetModes.has(mode)) return textResult(`bb_analyze ${mode}: irrelevant options: target`, true)
    if (args.filePath && !fileModes.has(mode)) return textResult(`bb_analyze ${mode}: irrelevant options: filePath`, true)
    if (["callers", "callees", "trace", "impact", "test_impact"].includes(mode) && !target) return textResult(`bb_analyze ${mode} requires target`, true)

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
      const result = await graphTraversal(projectId as any, target, { direction: mode === "trace" ? "both" : mode, maxDepth: 3 })
      const nodes = Object.values((result as { nodes: Record<string, any> }).nodes ?? {})
      return withFreshness(
        result as unknown as Record<string, unknown>,
        nodes.map((n) => (n.isExternal ? { filePath: null } : { filePath: n.filePath || n.file || null })),
        { onRows: (statuses) => { for (const n of nodes) if (!n.isExternal) n.stale = statuses.get(n.filePath || n.file) !== "fresh" } },
      )
    }
    if (mode === "dependencies") {
      const deps = await getFileDependencies(projectId as any, { filePath: args.filePath ? String(args.filePath) : target || undefined, limit: Number(args.limit ?? 20) })
      const rows = deps.flatMap((d) => [
        { fileId: d.fileId },
        ...d.dependencies.filter((x) => !x.external && x.fileId).map((x) => ({ fileId: x.fileId! })),
        ...d.dependents.map((x) => ({ fileId: x.fileId })),
      ])
      const first = deps[0]
      return withFreshness(
        { dependencies: deps },
        rows,
        {
          scope: first ? { kind: "file", path: first.file } : undefined,
          onRows: (statuses) => {
            for (const d of deps as any[]) {
              d.stale = statuses.get(d.fileId) !== "fresh"
              for (const x of d.dependencies) if (!x.external && x.fileId) x.stale = statuses.get(x.fileId) !== "fresh"
              for (const x of d.dependents) x.stale = statuses.get(x.fileId) !== "fresh"
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
      const report = await testMapping(projectId as any, { filePath: args.filePath ? String(args.filePath) : undefined })
      return withFreshness(
        report as unknown as Record<string, unknown>,
        report.entries.map((e) => ({ fileId: relToFileId().get(e.file) ?? null })),
        { sample: 64, onRows: (statuses) => { for (const e of report.entries as any[]) e.stale = statusFor(statuses, e.file) === "stale" } },
      )
    }
    if (mode === "test_gaps") {
      const report = await testGaps(projectId as any, { filePath: args.filePath ? String(args.filePath) : undefined })
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
    const report = await getUnifiedHealth(projectId, projectPath, { refresh: refreshRequested, force: args.force === true, wait: args.wait !== false, freshness: args.freshness === "complete" ? "complete" : "sampled", sampleSize: args.sampleSize != null ? Number(args.sampleSize) : undefined, integrity: args.integrity === true, includeAnalysisRuns: args.includeAnalysisRuns === true, verbose: args.verbose === true, logger: { log: (..._a: any[]) => {}, write: (_s: string) => {} } })
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, undefined, Number(args.limit ?? 20))
      return textResult(JSON.stringify({ health: report, history }, null, 2))
    }
    return textResult(formatUnifiedHealth(report))
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
      const report = await detectOrphans(projectId, { minConfidence: Number(args.confidenceThreshold ?? 0.6), maxResults: Math.max(limit, 100) })
      const items = report.findings.slice(0, limit)
      const derived = derivedStaleness(rawDb, projectId as any, items.map((f) => f.location.file))
      const lines = items.map((f) => `  ${f.rule} ${f.location.symbol || f.location.file} — ${f.location.file}:${f.location.line} (${Math.round(f.confidence * 100)}%)${derived.isStale(f.location.file) ? " [stale]" : ""}`)
      const prov = `\n[provenance: ${report.provenance.evidenceClass} via ${report.provenance.engine}; ${report.findings.length} findings${report.provenance.truncated ? "; truncated" : ""}; limitations: ${report.provenance.limitations.length}]`
      const footer = derived.footer ? `\n${derived.footer}` : ""
      return textResult(`orphaned code (${report.summary?.total ?? items.length}):\n${lines.join("\n") || "  none"}${prov}${footer}`)
    }
    const result: any = await PatternBrainTools.detectPatterns(projectId, {
      includeOrphaned: args.includeOrphaned !== false,
      includeFramework: args.includeFramework !== false,
      includeAntiPatterns: args.includeAntiPatterns !== false,
      confidenceThreshold: Number(args.confidenceThreshold ?? 0.6),
      maxResults: Math.max(limit, 100),
    })
    const allPatterns = result?.patterns ?? []
    const items = allPatterns.slice(0, limit)
    const derived = derivedStaleness(rawDb, projectId as any, items.map((item: any) => item.location?.file))
    const lines = items.map((item: any) => `  [${item.severity}] ${item.type} @ ${item.location?.file}:${item.location?.line} (${Math.round(item.confidence * 100)}%)${derived.isStale(item.location?.file) ? " [stale]" : ""}`)
    const stalenessFooter = derived.footer ? `\n${derived.footer}` : ""
    if (args.recordRun === true) {
      const recorded = await executeAnalysis({
        projectId,
        kind: "patterns",
        input: { options: args },
        // Persist the FULL analyzed set, never the display slice: recorded
        // history must reflect the run, not the truncated preview. Otherwise
        // findings past `limit` would be silently auto-resolved on the next
        // run even though they still exist.
        persist: () => allPatterns.map((item: any): AnalysisFindingInput => ({
          fingerprint: item.fingerprint ?? `${item.type}:${item.location?.file ?? "?"}:${item.location?.line ?? "?"}`,
          rule: item.type ?? "pattern",
          title: item.description ?? item.type ?? "pattern finding",
          severity: item.severity ?? "info",
          confidence: item.confidence ?? null,
          evidence: item.evidence ?? [],
          location: item.location?.file ? `${item.location.file}:${item.location.line ?? "?"}` : null,
        })),
      })
      const found = result?.statistics?.totalFound ?? allPatterns.length
      return textResult(`patterns (${found} found, ${recorded.report.run.findingCount} recorded) recorded run ${recorded.report.run.id}: new=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}\n${lines.join("\n") || "  none"}${stalenessFooter}`)
    }
    return textResult(`patterns (${result?.statistics?.totalFound ?? items.length}):\n${lines.join("\n") || "  none"}${stalenessFooter}`)
  },

  bb_security: async (args, { projectId }) => {
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, "security", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    const result: any = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
    const findings = result?.findings ?? []
    const suspicious = result?.suspiciousSources ?? []
    const summary = result?.summary
    // M35.S2: a stale taint/flow finding says so — security honesty. History
    // paths (above) keep their recorded state; this is the live read.
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    const derived = derivedStaleness(rawDb, projectId as any, findings.map((f: any) => f.file))
    const head = summary
      ? `security: ${summary.critical} critical / ${summary.high} high / ${summary.medium} medium / ${summary.low} low (${summary.resolved} resolved flows, ${summary.unresolvedSources} unvalidated sources, ${summary.mitigated} mitigated)`
      : `security findings (${findings.length})`
    const lines = findings.slice(0, 20).map(
      (finding: any) => `  [${finding.severity}] ${finding.label ?? finding.type}${finding.symbol ? ` (${finding.symbol})` : ""} @ ${finding.file}:${finding.line ?? "?"}${finding.sinkType ? ` -> ${finding.sinkType}` : ""}${finding.mitigated ? " [mitigated]" : ""}${derived.isStale(finding.file) ? " [stale]" : ""}`,
    )
    const sourceLines = suspicious.slice(0, 5).map(
      (source: any) => `  [info] unvalidated input${source.symbol ? ` ${source.symbol}` : ""} @ ${source.file}:${source.line ?? "?"} (no sink reached)`,
    )
    if (args.recordRun === true) {
      const findingCount = findings.length
      const recorded = await executeAnalysis({
        projectId,
        kind: "security",
        input: { options: args },
        persist: () => findings.map((finding: any): AnalysisFindingInput => ({
          fingerprint: finding.fingerprint ?? `${finding.file}:${finding.line ?? "?"}:${finding.label ?? finding.type}`,
          rule: finding.label ?? finding.type ?? "security",
          title: finding.label ?? finding.type ?? "security finding",
          severity: finding.severity ?? "medium",
          confidence: finding.confidence ?? null,
          evidence: finding.evidence ?? [],
          location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
          state: finding.mitigated ? "mitigated" : undefined,
        })),
      })
      return textResult(head + `\nrecorded run: ${recorded.report.run.id}\nnew=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}` + "\n" + `${findingCount} findings recorded` + (lines.length ? "\n" + lines.join("\n") : "") + (derived.footer ? `\n${derived.footer}` : ""))
    }
    return textResult(head + "\n" + (lines.length ? lines.join("\n") : "  clean") + (sourceLines.length ? `\n\nunvalidated input sources:\n${sourceLines.join("\n")}` : "") + (derived.footer ? `\n\n${derived.footer}` : ""))
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
    const request: VisualizationRequest = { scope: scope as VisualizationScope, target: args.target ? String(args.target) : undefined, format: ["text", "json", "html"].includes(String(args.format)) ? args.format : "text", maxNodes: args.maxNodes == null ? undefined : Number(args.maxNodes), maxLinks: args.maxLinks == null ? undefined : Number(args.maxLinks), relationshipTypes: Array.isArray(args.relationshipTypes) ? args.relationshipTypes.map(String) : undefined, languages: Array.isArray(args.languages) ? args.languages.map(String) : undefined }
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

  bb_migrate: async (args, { projectId }) => {
    const symbolNames = Array.isArray(args.symbolNames) ? args.symbolNames.map(String) : args.symbolName ? [String(args.symbolName)] : []
    if (!symbolNames.length || !args.targetLanguage) return textResult("bb_migrate requires symbolNames (or symbolName) and targetLanguage", true)
    const result = await generateMigrationPlans(projectId, { symbolNames, targetLanguage: String(args.targetLanguage) })
    // M35.S3: a migration plan is a claim about CURRENT code. Resolve each
    // plan's source file and flag plans whose file changed since the index —
    // a stale plan says so up front instead of silently planning against
    // outdated symbols.
    const migRaw = await BrainDatabase.getRawInstance(projectId as any)
    const planNames = (result.plans as any[]).map((p) => String(p.componentName ?? "").toLowerCase()).filter(Boolean)
    const nameToRel = new Map<string, string>()
    if (planNames.length) {
      for (const r of migRaw.prepare(`SELECT lower(s.name) AS lname, f.relative_path AS rel FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND lower(s.name) IN (${planNames.map(() => "?").join(",")})`).all(projectId, ...planNames) as Array<{ lname: string; rel: string }>) {
        if (!nameToRel.has(r.lname)) nameToRel.set(r.lname, r.rel)
      }
    }
    const migFiles = [...new Set([...nameToRel.values()])]
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
      p.sourceFile = nameToRel.get(String(p.componentName ?? "").toLowerCase()) ?? null
      p.stale = migStatus(p.sourceFile) === "stale"
    }
    const migSummary = {
      fresh: migRows.filter((r) => migStatuses.get(r.fileId ?? "") === "fresh").length,
      stale: migRows.filter((r) => migStatuses.get(r.fileId ?? "") === "stale").length,
      missing: migRows.filter((r) => migStatuses.get(r.fileId ?? "") !== "fresh" && migStatuses.get(r.fileId ?? "") !== "stale").length,
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
    const result = await generateDocumentation(projectId, projectPath, request)
    // M35.S2: the doc carries the registered freshness envelope over its cited
    // files; per-citation freshness is already resolved inside the engine and
    // rendered in Sources. JSON gets the exact registered block; text/markdown
    // get the footer built from the registered remediation constant.
    const rawDb = await BrainDatabase.getRawInstance(projectId as any)
    const derived = derivedStaleness(rawDb, projectId as any, (result.citations ?? []).map((c) => c.path ?? undefined))
    if (request.format === "json") {
      const parsed = JSON.parse(formatDocumentation(result, "json"))
      parsed.freshness = buildStalenessEnvelope(derived.summary, { kind: "dir" })
      return textResult(JSON.stringify(parsed, null, 2))
    }
    const base = formatDocumentation(result, request.format)
    return textResult(derived.footer ? `${base}\n\n---\n${derived.footer}` : base)
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
      return textResult(JSON.stringify({ ok: false, mode: request.mode, error: e?.message ?? String(e), rolledBack: true }, null, 2), true)
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
      const { runPostProcessing } = await import("../ast/parallel-indexer")
      try {
        const post = await runPostProcessing(projectId as any, { logger: { log: () => {}, write: () => {} } })
        return textResult(JSON.stringify({ mode: "post", phases: post.phases, totalMs: post.totalMs, integrityHealth: post.integrityHealth }, null, 2))
      } catch (e: any) {
        return textResult(`bb_index mode=post failed: ${e?.message}`, true)
      }
    }
    const abs = path.isAbsolute(raw) ? raw : path.resolve(projectPath, raw)
    if (!existsSync(abs)) return textResult(`bb_index: no such path: ${abs}`, true)
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
        return textResult(JSON.stringify({ mode: "file", path: abs, indexed: r.indexed, deleted: r.deleted, errors: r.errors, derived: r.derived ?? { pass: "deferred", phases: [], repairedInEdges: 0, touchedSymbols: 0 } }, null, 2))
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
        return textResult(JSON.stringify({ mode: "dir", path: abs, candidates: 0, processed: 0, deleted: 0, errors: 0, unchanged: true }, null, 2))
      }
      const r = await reindexFilesParallel(projectId as any, projectPath, changes)
      return textResult(JSON.stringify({ mode: "dir", path: abs, candidates: changes.length, processed: r.indexed, deleted: r.deleted, errors: r.errors }, null, 2))
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
    let result
    try {
      result = await graphTraversal(projectId as any, symbol, {
        maxDepth,
        edgeLimit: edgeLimitArg,
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
    const describe = (id: string) => {
      const n = (result.nodes as Record<string, any> | undefined)?.[id]
      if (!n) return null
      return { id: n.id, name: n.name, symbolType: n.symbolType, file: n.file, line: n.line, isExternal: n.isExternal === true }
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
        rowId: e.rowId ?? null,
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
        crossLanguageEdges: result.summary?.crossLanguageEdges ?? 0,
        truncated: result.summary?.truncated === true,
        truncationReason: result.summary?.truncationReason ?? null,
        edgeLimit: result.summary?.edgeLimit ?? null,
        cappedQueries: result.summary?.cappedQueries ?? 0,
        callersIfUncapped: result.summary?.callersIfUncapped ?? null,
        calleesIfUncapped: result.summary?.calleesIfUncapped ?? null,
        totalsAreLowerBounds: result.summary?.totalsAreLowerBounds === true,
        // How much of the answer is about the symbol that was asked for, and
        // how much the owner cascade folded in from its members. The cascade is
        // documented; without these numbers a reader cannot use it.
        exactCallers: result.summary?.exactCallers ?? 0,
        cascadedCallers: result.summary?.cascadedCallers ?? 0,
        exactCallees: result.summary?.exactCallees ?? 0,
        cascadedCallees: result.summary?.cascadedCallees ?? 0,
        // Rows present in BOTH the caller and the callee list. Each is one
        // relationship seen from two ends, so `totalCallers + totalCallees`
        // overstates the distinct relationship count by exactly this much.
        edgesInBothDirections: result.summary?.edgesInBothDirections ?? 0,
        dedupedAtToolLayer: result.summary?.dedupedAtToolLayer ?? { cascadeRepeatsCollapsed: 0, spellingVariantsCollapsed: 0 },
        // What was actually searched. Without this a caller that asked for
        // direction:"callers" cannot tell an empty callee list from a callee
        // list that was never computed, and `relationshipTypes` narrowing is
        // invisible in the results — a graph of 0 edges reads identically
        // whether the filter matched nothing or matched everything.
        scope: {
          direction: directionArg ?? "both",
          relationshipTypes: relTypesArg ?? ["calls", "instantiates", "extends", "implements"],
          includeCrossLanguage: crossLangArg !== false,
        },
      },
      provenance: result.provenance ?? null,
    }, null, 2))
  },

  bb_impact: async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "")
    if (!symbol) return textResult("bb_impact requires symbol", true)
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    try {
      // The SAME component the editor graph panel's impact mode uses
      // (src/lsp/impact.ts): declared budget, first-class truncation,
      // declared total. One truth (M28 decision D-1).
      const impact = await computeImpact(raw, projectId as string, symbol)
      return textResult(JSON.stringify({
        symbol,
        root: impact.root,
        budget: { maxNodes: 200, maxDepth: 5 },
        impact: impact.impact,
        shownCount: impact.shownCount,
        totalCountIfKnown: impact.totalCountIfKnown,
        truncated: impact.truncated,
        truncationReason: impact.truncationReason,
      }, null, 2))
    } catch (error) {
      return textResult(`bb_impact: ${error instanceof Error ? error.message : String(error)}`, true)
    }
  },

  bb_cross_language: async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "")
    if (!symbol) return textResult("bb_cross_language requires symbol", true)
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    // The hover derives language from the FILE row (brain_file.language) —
    // brain_symbol has no language column. Same source, same semantics (D-1).
    const row = raw.prepare("SELECT s.id AS id, f.language AS language FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ?").get(projectId, symbol) as { id: string; language: string | null } | undefined
    if (!row) {
      return textResult(`bb_cross_language: symbol '${symbol}' not found — declared error, not an empty set`, true)
    }
    // The SAME component the hover section renders from (D-1): stored rows
    // only, per-pair, declared absence when there are none.
    const rows = storedCrossLanguageRows(raw, row.id)
    const facts = factsFromRows(rows, row.language ?? null)
    return textResult(JSON.stringify({
      symbol,
      language: row.language,
      facts,
      pairCount: facts.length,
      declaredAbsent: facts.length === 0,
      absenceNote: facts.length === 0 ? "no stored cross-language rows for this symbol — absence declared, never guessed" : null,
    }, null, 2))
  },

  // M28.A1 (issue #626, decision D-3): the agent's write door. Provenance is
  // enforced HERE, in code: author_class is always 'agent' for tool writes —
  // no argument can override it, so an agent note can never masquerade as a
  // human note. Upsert on (project, symbol, path, author): one note per author
  // per location, re-annotation updates in place (anti-flood by construction).
  bb_annotate: async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "").trim()
    const body = String(args.body ?? "")
    const annotationPath = args.path === undefined || args.path === null || String(args.path).trim() === "" ? null : String(args.path)
    const toolIdentity = String(args.toolIdentity ?? "bb_annotate(mcp)")
    if (!symbol) return textResult("bb_annotate requires symbol", true)
    if (!body.trim()) return textResult("bb_annotate requires a non-empty body — an empty note is a refusal, not a silent no-op", true)
    if (body.length > 2000) return textResult(`bb_annotate: body exceeds the declared limit of 2000 chars (got ${body.length}) — declared refusal, not silent truncation`, true)
    const now = Date.now()
    const id = annotationId({ projectId, symbol, path: annotationPath, authorClass: "agent" })
    const raw = await BrainDatabase.getRawInstance(projectId as any)
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
      provenance: "author_class is enforced 'agent' for tool writes — recorded, not claimed",
      surfaces: "this note renders in the editor hover section and graph badge (M28.A2)",
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
    const annotationPath = args.path === undefined || args.path === null || String(args.path).trim() === "" ? null : String(args.path)
    const limitRaw = args.limit === undefined || args.limit === null ? 50 : Number(args.limit)
    if (Number.isNaN(limitRaw) || limitRaw < 1 || limitRaw > 200) return textResult("bb_annotations: limit must be a number between 1 and 200", true)
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    const limit = Math.floor(limitRaw)
    // The ORDER BY carries a deterministic tiebreak: several agents writing in
    // the same millisecond share a time_updated, and without a second key their
    // relative order is whatever SQLite happens to produce, so "read back what
    // I just wrote" is not reproducible.
    const COLUMNS = "id, symbol_name, symbol_path, author_class, tool_identity, body, time_created, time_updated"
    let rows: any[]
    if (symbol && annotationPath) {
      rows = raw.prepare(`SELECT ${COLUMNS} FROM brain_annotation WHERE project_id = ? AND symbol_name = ? AND (symbol_path = ? OR symbol_path IS NULL) ORDER BY time_updated DESC, id LIMIT ?`).all(projectId, symbol, annotationPath, limit) as any[]
    } else if (symbol) {
      rows = raw.prepare(`SELECT ${COLUMNS} FROM brain_annotation WHERE project_id = ? AND symbol_name = ? ORDER BY time_updated DESC, id LIMIT ?`).all(projectId, symbol, limit) as any[]
    } else if (annotationPath) {
      rows = raw.prepare(`SELECT ${COLUMNS} FROM brain_annotation WHERE project_id = ? AND (symbol_path = ? OR symbol_path IS NULL) ORDER BY time_updated DESC, id LIMIT ?`).all(projectId, annotationPath, limit) as any[]
    } else {
      rows = raw.prepare(`SELECT ${COLUMNS} FROM brain_annotation WHERE project_id = ? ORDER BY time_updated DESC, id LIMIT ?`).all(projectId, limit) as any[]
    }
    return textResult(JSON.stringify({
      symbol,
      path: annotationPath,
      annotations: rows,
      count: rows.length,
      declaredAbsent: rows.length === 0,
      absenceNote: rows.length === 0
        ? (symbol && annotationPath
          ? `no annotations stored for '${symbol}' in '${annotationPath}' — absence declared, never guessed`
          : symbol
            ? `no annotations stored for '${symbol}' — absence declared, never guessed`
            : annotationPath
              ? `no annotations stored for '${annotationPath}' — absence declared, never guessed`
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
