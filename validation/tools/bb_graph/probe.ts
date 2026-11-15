// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_graph door probe: it calls the tool through the
// same three layers the MCP server calls (registry descriptor -> argument
// validator -> handler), records what came back, and measures default-call
// latency on the three campaign tiers.
// WHICH TOOL IT SERVES — bb_graph (mutability read, requiresIndex true,
// modes: graph).
// WHY IT IS SHAPED THIS WAY — the per-tool gate `script/verify-graph.ts` calls
// the ENGINE directly, so everything the tool adds on top of it (tier
// derivation, id compaction, the summary projection, the refusals) is outside
// that gate. This probe exercises the door and records the answer, so a claim
// about the payload is measured against a payload rather than against an
// engine return value. Target symbols are chosen by measured degree
// (validation/tools/bb_graph/recon.ts) so a leaf, a mid symbol and a hub are
// all represented; a section that would traverse a hub for no reason is not
// included.
// It never writes the index: every call is a read, with BB_NO_AUTO_REFRESH=1,
// and the reference database's file state is recorded before and after so
// "read-only" is a measurement, not a promise.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/,
// validation/tools/bb_graph/AUDIT.md, validation/tools/bb_graph/LATENCY.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — validation/tools/bb_graph/LATENCY.json,
// validation/tools/bb_graph/AUDIT.md, docs/tools/bb_graph.md.
// CONTRACTS IT MUST NOT BREAK — read-only: no index run, no refresh, no write
// tool. A refusal is recorded with its message and never retried as a success.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../src/util/project-id"
import { BrainDatabase } from "../../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const OUT = path.join(ROOT, "validation/tools/bb_graph/results")
mkdirSync(OUT, { recursive: true })

const DESCRIPTOR = TOOL_DESCRIPTORS.find((d) => d.name === "bb_graph")
if (!DESCRIPTOR) throw new Error("bb_graph descriptor is not registered")
const handlers = createToolHandlers() as unknown as Record<string, (args: Record<string, unknown>, ctx: unknown) => Promise<any>>

type DoorResult = { ok: true; text: string; json: any; ms: number; bytes: number } | { ok: false; error: string; ms: number }

/** The exact call sequence src/mcp/server.ts performs, minus the stdio frame. */
async function door(projectPath: string, args: Record<string, unknown>): Promise<DoorResult> {
  const ctx = { projectPath, projectId: getProjectId(projectPath) }
  const started = performance.now()
  try {
    const validated = validateToolArguments(DESCRIPTOR!, args)
    const result = await handlers["bb_graph"]!(validated, ctx)
    const ms = performance.now() - started
    if (result?.isError) return { ok: false, error: String(result?.content?.[0]?.text ?? ""), ms }
    const text = String(result?.content?.[0]?.text ?? "")
    return { ok: true, text, json: JSON.parse(text), ms, bytes: Buffer.byteLength(text, "utf8") }
  } catch (error) {
    const ms = performance.now() - started
    return { ok: false, error: error instanceof Error ? error.message : String(error), ms }
  }
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))]!
}

function fileState(dbPath: string): Record<string, number | null> {
  const state: Record<string, number | null> = {}
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      state[suffix || "db"] = Math.floor(statSync(dbPath + suffix).mtimeMs)
    } catch {
      state[suffix || "db"] = null
    }
  }
  return state
}

const LEGEND = ["structural", "import_based", "usage_contextual", "reference_qualified", "inferred"]
const STRUCTURAL_KINDS = new Set(["call", "calls", "extends", "inherits", "implements", "overrides", "override", "contains", "exports", "instantiates", "mixes_in", "renders", "decorates"])
const IMPORT_KINDS = new Set(["import", "imports", "part_of"])
const USAGE_KINDS = new Set(["reference", "references", "use", "uses", "usage"])
const REFQ_KINDS = new Set(["references_qualified", "reference_qualified"])

/** The W4 rule as the tool's own contract states it, re-derived here so a tier
 *  on the wire is checked against the rule rather than against the code that
 *  produced it. */
function expectedTier(kind: string, confidence: number, storedEvidenceClass: string | null = null): string {
  // The stored classification wins when it is a legend tier (src/lsp/evidence_tier.ts).
  if (storedEvidenceClass !== null && LEGEND.includes(storedEvidenceClass)) return storedEvidenceClass
  const k = kind.trim().toLowerCase()
  if (STRUCTURAL_KINDS.has(k)) return confidence >= 0.7 ? "structural" : "inferred"
  if (IMPORT_KINDS.has(k)) return "import_based"
  if (USAGE_KINDS.has(k)) return "usage_contextual"
  if (REFQ_KINDS.has(k)) return "reference_qualified"
  return "inferred"
}

/** Cheap degree-measured targets on the reference index (results/recon.json): a
 *  leaf, a mid node, a class-shaped root and a hub. */
const REFERENCE = path.resolve(import.meta.dirname, "../../..")
const PROJECT = process.env.BB_GRAPH_PROBE_PROJECT ? path.resolve(REFERENCE, process.env.BB_GRAPH_PROBE_PROJECT) : REFERENCE
const IS_REFERENCE = PROJECT === REFERENCE
/** Degree-measured targets on the reference index (results/recon.json). On a
 *  fixture the same roles are discovered from the fixture's own store, so a
 *  probe section is always about a symbol the index actually holds. */
let T2_LEAF = "likeContains"            // incoming 3, outgoing 0
let T2_MID = "traverseGraph"            // incoming 2, outgoing 169
let T2_SMALL_CLASSES = ["FreshnessResolver", "VisitContext", "Scope", "Query", "EvidenceInput"]
let T2_HUB = "getProjectId"             // incoming 672

async function main(): Promise<void> {
  const section = process.argv[2] ?? "refusals"
  const projectPath = PROJECT
  const projectId = getProjectId(projectPath)
  const dbPath = BrainDatabase.getDbPath(projectId)
  const before = fileState(dbPath)
  if (!IS_REFERENCE) {
    const fixtureDb = await BrainDatabase.getRawInstance(projectId as any)
    const withIncoming = fixtureDb.prepare(`SELECT s.name, COUNT(r.id) c FROM brain_symbol s JOIN brain_relationship r ON r.target_symbol_id = s.id AND r.project_id = s.project_id WHERE s.project_id = ? AND s.symbol_type IN ('function','method') GROUP BY s.id ORDER BY c DESC`).all(projectId as any) as Array<{ name: string; c: number }>
    const withOutgoing = fixtureDb.prepare(`SELECT s.name, COUNT(r.id) c FROM brain_symbol s JOIN brain_relationship r ON r.source_symbol_id = s.id AND r.project_id = s.project_id WHERE s.project_id = ? AND s.symbol_type IN ('function','method') GROUP BY s.id ORDER BY c DESC`).all(projectId as any) as Array<{ name: string; c: number }>
    const classes = fixtureDb.prepare(`SELECT s.name, COUNT(r.id) c FROM brain_symbol s JOIN brain_relationship r ON r.target_symbol_id = s.id AND r.project_id = s.project_id WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum') GROUP BY s.id ORDER BY c DESC LIMIT 5`).all(projectId as any) as Array<{ name: string; c: number }>
    if (withIncoming[0]) T2_HUB = withIncoming[0].name
    if (withIncoming.length > 1) T2_MID = withIncoming[1]!.name
    if (withOutgoing[0]) T2_MID = withOutgoing[0].name
    const leaf = withIncoming.find((r) => r.c <= 1) ?? withIncoming[withIncoming.length - 1]
    if (leaf) T2_LEAF = leaf.name
    if (classes.length) T2_SMALL_CLASSES = classes.map((c) => c.name)
  }
  const run: Record<string, unknown> = {
    probe: "bb_graph door",
    section,
    at: new Date().toISOString(),
    project: projectPath,
    projectId,
    dataDir: process.env.BB_DATA_DIR ?? null,
    dbPath,
    dbBefore: before,
  }

  // ── 1. protocol/refusal matrix ─────────────────────────────────────────────
  if (section === "refusals") {
    const leaf = T2_LEAF
    const cases: Array<{ id: string; args: Record<string, unknown> }> = [
      { id: "missing-symbol", args: {} },
      { id: "blank-symbol", args: { symbol: "   " } },
      { id: "unknown-symbol", args: { symbol: "no_such_symbol_9f3a" } },
      { id: "maxDepth-0", args: { symbol: leaf, maxDepth: 0 } },
      { id: "maxDepth-11", args: { symbol: leaf, maxDepth: 11 } },
      { id: "maxDepth-fractional", args: { symbol: leaf, maxDepth: 2.5 } },
      { id: "maxDepth-string", args: { symbol: leaf, maxDepth: "3" } },
      { id: "direction-invalid", args: { symbol: leaf, direction: "up" } },
      { id: "relationshipTypes-empty", args: { symbol: leaf, relationshipTypes: [] } },
      { id: "relationshipTypes-blank-entry", args: { symbol: leaf, relationshipTypes: [""] } },
      { id: "relationshipTypes-string", args: { symbol: leaf, relationshipTypes: "calls" } },
      { id: "relationshipTypes-number-entry", args: { symbol: leaf, relationshipTypes: [7] } },
      { id: "edgeLimit-0", args: { symbol: leaf, edgeLimit: 0 } },
      { id: "edgeLimit-negative", args: { symbol: leaf, edgeLimit: -5 } },
      { id: "edgeLimit-fractional", args: { symbol: leaf, edgeLimit: 2.5 } },
      { id: "maxEdges-0", args: { symbol: leaf, maxEdges: 0 } },
      { id: "maxEdges-fractional", args: { symbol: leaf, maxEdges: 2.5 } },
      { id: "timeBudget-negative", args: { symbol: leaf, timeBudgetMs: -1 } },
      { id: "includeCrossLanguage-string", args: { symbol: leaf, includeCrossLanguage: "false" } },
      { id: "unknown-option", args: { symbol: leaf, depth: 2 } },
      { id: "alias-target", args: { target: leaf } },
      { id: "alias-query", args: { query: leaf } },
      { id: "alias-conflict", args: { symbol: leaf, target: "matchedMember" } },
    ]
    const observed: any[] = []
    for (const c of cases) {
      const r = await door(projectPath, c.args)
      observed.push({
        id: c.id,
        args: c.args,
        ok: r.ok,
        error: r.ok ? null : r.error,
        ms: Math.round(r.ms * 100) / 100,
        ...(r.ok
          ? {
              rootName: r.json?.root?.name ?? null,
              rootMatch: r.json?.root?.match ?? null,
              edges: (r.json?.callers?.length ?? 0) + (r.json?.callees?.length ?? 0),
              maxDepth: r.json?.summary?.maxDepth,
              edgeLimit: r.json?.summary?.edgeLimit,
              maxEdges: r.json?.summary?.maxEdges,
              scope: r.json?.summary?.scope,
              truncated: r.json?.summary?.truncated,
              filterNarrowed: r.json?.summary?.filterNarrowed,
              filterReason: r.json?.summary?.filterReason,
              truncationReasons: r.json?.summary?.truncationReasons,
            }
          : {}),
      })
      console.log(`  ${c.id}: ${r.ok ? "OK" : `REFUSED ${r.error}`} (${Math.round(r.ms)} ms)`)
    }
    run.refusals = observed
  }

  // ── 2. invariant audit over live answers ───────────────────────────────────
  if (section === "invariants") {
    const targets = [T2_MID, T2_LEAF, ...T2_SMALL_CLASSES.slice(0, 2)]
    const answers: any[] = []
    for (const symbol of targets) {
      const r = await door(projectPath, { symbol, maxDepth: 1 })
      if (!r.ok) {
        answers.push({ symbol, ok: false, error: r.error })
        continue
      }
      const j = r.json
      const tierViolations: any[] = []
      const missingEndpoints: any[] = []
      const missingRowIds: any[] = []
      const targetBasis = { callerNonNull: 0, callerNull: 0, calleeNonNull: 0, calleeNull: 0 }
      const tierCounts: Record<string, number> = {}
      const unknownTiers: string[] = []
      for (const e of j.callers ?? []) {
        if (!e.rowId) missingRowIds.push(e)
        if (!e.from || !e.to) missingEndpoints.push(e)
        if (e.match === "owner-cascade") targetBasis.callerNonNull++
        else targetBasis.callerNull++
        tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1
        if (!LEGEND.includes(e.tier)) unknownTiers.push(String(e.tier))
        if (e.tier !== expectedTier(e.relationshipType, e.confidence, e.evidenceClass ?? null)) {
          tierViolations.push({ direction: "caller", kind: e.relationshipType, confidence: e.confidence, tier: e.tier, evidenceClass: e.evidenceClass ?? null, expected: expectedTier(e.relationshipType, e.confidence, e.evidenceClass ?? null) })
        }
      }
      for (const e of j.callees ?? []) {
        if (!e.rowId) missingRowIds.push(e)
        if (!e.from || !e.to) missingEndpoints.push(e)
        if (e.match === "owner-cascade") targetBasis.calleeNonNull++
        else targetBasis.calleeNull++
        tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1
        if (!LEGEND.includes(e.tier)) unknownTiers.push(String(e.tier))
        if (e.tier !== expectedTier(e.relationshipType, e.confidence, e.evidenceClass ?? null)) {
          tierViolations.push({ direction: "callee", kind: e.relationshipType, confidence: e.confidence, tier: e.tier, evidenceClass: e.evidenceClass ?? null, expected: expectedTier(e.relationshipType, e.confidence, e.evidenceClass ?? null) })
        }
      }
      const s = j.summary
      answers.push({
        symbol,
        ok: true,
        root: j.root,
        callers: (j.callers ?? []).length,
        callees: (j.callees ?? []).length,
        bytes: r.bytes,
        ms: Math.round(r.ms * 100) / 100,
        tierCounts,
        unknownTiers,
        tierViolations: tierViolations.slice(0, 5),
        tierViolationCount: tierViolations.length,
        missingRowIds: missingRowIds.length,
        missingEndpoints: missingEndpoints.length,
        targetBasis,
        partition: {
          callersExpected: (j.callers ?? []).length,
          callersSum: (s?.exactCallers ?? 0) + (s?.cascadedCallers ?? 0) + (s?.deeperCallers ?? 0),
          calleesExpected: (j.callees ?? []).length,
          calleesSum: (s?.exactCallees ?? 0) + (s?.cascadedCallees ?? 0) + (s?.deeperCallees ?? 0),
        },
        truncation: {
          truncated: s?.truncated,
          reasons: s?.truncationReasons,
          joinedMatches: (s?.truncationReasons ?? []).join("+") === String(s?.truncationReason ?? ""),
          filterNarrowed: s?.filterNarrowed,
          filterReason: s?.filterReason,
          edgeLimit: s?.edgeLimit,
          maxEdges: s?.maxEdges,
          totalEdgeLimitReached: s?.totalEdgeLimitReached,
          cappedQueries: s?.cappedQueries,
          callersIfUncapped: s?.callersIfUncapped,
          calleesIfUncapped: s?.calleesIfUncapped,
          totalsAreLowerBounds: s?.totalsAreLowerBounds,
          timeBudgetMs: s?.timeBudgetMs,
          timeBudgetExhausted: s?.timeBudgetExhausted,
        },
        filters: { noiseFiltered: s?.noiseFiltered, crossLanguageExcluded: s?.crossLanguageExcluded, crossLanguageEdges: s?.crossLanguageEdges, unattributed: s?.unattributed },
        scope: s?.scope,
        deduped: s?.dedupedAtToolLayer,
        edgesByType: s?.edgesByType,
        edgeKindPriority: s?.edgeKindPriority,
        edgeFieldsObserved: Object.keys((j.callers ?? [])[0] ?? (j.callees ?? [])[0] ?? {}),
        summaryFieldsObserved: Object.keys(s ?? {}),
        rootFieldsObserved: Object.keys(j.root ?? {}),
      })
      console.log(`  ${symbol}: ${(j.callers ?? []).length} callers / ${(j.callees ?? []).length} callees, ${r.bytes} B, ${Math.round(r.ms)} ms, tierViolations=${tierViolations.length}`)
    }
    run.invariants = answers
  }

  // ── 3. bounds behaviour: edgeLimit / maxEdges / depth / filter ─────────────
  if (section === "bounds") {
    const symbol = T2_MID
    const bounds: any[] = []
    for (const raw of [
      { symbol, edgeLimit: 1 },
      { symbol, edgeLimit: 1, direction: "callees" },
      { symbol, maxEdges: 1 },
      { symbol, maxEdges: 3 },
      { symbol, maxEdges: 5001 },
      { symbol, maxEdges: 6000 },
      { symbol, maxDepth: 1 },
      { symbol, maxDepth: 10 },
      { symbol, direction: "callers" },
      { symbol, direction: "callees" },
      { symbol, relationshipTypes: ["calls"] },
      { symbol, relationshipTypes: ["implements"] },
      { symbol, includeCrossLanguage: false },
      { symbol, timeBudgetMs: 1 },
      { symbol, timeBudgetMs: 0 },
    ]) {
      const args = raw.maxDepth === undefined ? { ...raw, maxDepth: 1 } : raw
      const r = await door(projectPath, args)
      const s = r.ok ? r.json.summary : null
      bounds.push({
        args,
        ok: r.ok,
        error: r.ok ? null : r.error,
        ms: Math.round(r.ms * 100) / 100,
        bytes: r.ok ? r.bytes : null,
        totalEdges: r.ok ? (r.json.callers?.length ?? 0) + (r.json.callees?.length ?? 0) : null,
        s: s
          ? {
              truncated: s.truncated,
              reasons: s.truncationReasons,
              edgeLimit: s.edgeLimit,
              maxEdges: s.maxEdges,
              totalEdgeLimitReached: s.totalEdgeLimitReached,
              cappedQueries: s.cappedQueries,
              callersIfUncapped: s.callersIfUncapped,
              calleesIfUncapped: s.calleesIfUncapped,
              totalsAreLowerBounds: s.totalsAreLowerBounds,
              filterNarrowed: s.filterNarrowed,
              filterReason: s.filterReason,
              timeBudgetMs: s.timeBudgetMs,
              timeBudgetExhausted: s.timeBudgetExhausted,
              maxDepth: s.maxDepth,
              maxDepthReached: s.maxDepthReached,
              scope: s.scope,
              crossLanguageExcluded: s.crossLanguageExcluded,
              noiseFiltered: s.noiseFiltered,
              unattributed: s.unattributed,
            }
          : null,
      })
      console.log(`  ${JSON.stringify(args)} -> ${r.ok ? `${bounds[bounds.length - 1]!.totalEdges} edges, truncated=${s?.truncated}, reasons=${JSON.stringify(s?.truncationReasons)}` : `REFUSED ${r.error}`}`)
    }
    run.bounds = bounds
  }

  // ── 4. owner cascade, on class-shaped symbols with measured small degree ───
  if (section === "cascade") {
    const cascade: any[] = []
    for (const name of T2_SMALL_CLASSES) {
      const r = await door(projectPath, { symbol: name, direction: "callers", maxDepth: 1 })
      if (!r.ok) {
        cascade.push({ symbol: name, ok: false, error: r.error })
        continue
      }
      const s = r.json.summary
      const cascaded = (r.json.callers ?? []).filter((e: any) => e.match === "owner-cascade")
      cascade.push({
        symbol: name,
        ok: true,
        root: r.json.root,
        returnedCallers: (r.json.callers ?? []).length,
        exactCallers: s.exactCallers,
        cascadedCallers: s.cascadedCallers,
        deeperCallers: s.deeperCallers,
        partition: s.exactCallers + s.cascadedCallers + s.deeperCallers === (r.json.callers ?? []).length,
        cascadeEdgesCarryMember: cascaded.slice(0, 3).map((e: any) => ({ match: e.match, matchedMember: e.matchedMember })),
        cascadeEdgesMissingMember: cascaded.filter((e: any) => !e.matchedMember).length,
        candidateNameMatches: r.json.root?.candidates,
        edgesByType: s.edgesByType,
      })
      console.log(`  ${name}: callers=${(r.json.callers ?? []).length} exact=${s.exactCallers} cascaded=${s.cascadedCallers} deeper=${s.deeperCallers} missingMember=${cascade[cascade.length - 1]!.cascadeEdgesMissingMember}`)
    }
    run.cascade = cascade
  }

  // ── 5. the LSP twin's default depth, measured through the shared engine ────
  if (section === "twin") {
    const { handleGraphRequest, GRAPH_SCHEMA_VERSION } = await import("../../../src/lsp/graph_request")
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    const twin: any[] = []
    for (const symbol of [T2_LEAF, "cascadeMatch", T2_MID]) {
      const lsp = (await handleGraphRequest(raw as any, projectId, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol, maxDepth: 1 } as any)) as any
      const mcp = await door(projectPath, { ...({} as any), symbol, maxDepth: 1 })
      const mcpSummary = mcp.ok ? mcp.json.summary : null
      twin.push({
        symbol,
        lsp: { callers: lsp.callers?.length, callees: lsp.callees?.length, maxDepth: lsp.summary?.maxDepth, maxDepthReached: lsp.summary?.maxDepthReached, edgeLimit: lsp.summary?.edgeLimit, maxEdges: lsp.summary?.maxEdges, timeBudgetMs: lsp.summary?.timeBudgetMs },
        mcp: { callers: mcp.ok ? mcp.json.callers.length : null, callees: mcp.ok ? mcp.json.callees.length : null, maxDepth: mcpSummary?.maxDepth, maxDepthReached: mcpSummary?.maxDepthReached, edgeLimit: mcpSummary?.edgeLimit, maxEdges: mcpSummary?.maxEdges, timeBudgetMs: mcpSummary?.timeBudgetMs },
        defaultDepthAgrees: lsp.summary?.maxDepth === mcpSummary?.maxDepth,
        sameEdgeCount: (lsp.callers?.length ?? -1) === (mcp.ok ? mcp.json.callers.length : -2) && (lsp.callees?.length ?? -1) === (mcp.ok ? mcp.json.callees.length : -2),
      })
      console.log(`  ${symbol}: lsp depth ${lsp.summary?.maxDepth} / mcp depth ${mcpSummary?.maxDepth} — agree=${twin[twin.length - 1]!.defaultDepthAgrees}`)
    }
    run.twin = twin
  }

  // ── 6. latency, T2 (reference large index) ────────────────────────────────
  if (section === "latency-t2") {
    const cases: Array<{ id: string; args: Record<string, unknown> }> = [
      { id: "leaf-depth1", args: { symbol: T2_LEAF, maxDepth: 1 } },
      { id: "mid-depth1", args: { symbol: T2_MID, maxDepth: 1 } },
      { id: "mid-depth2", args: { symbol: T2_MID, maxDepth: 2 } },
      { id: "hub-depth1", args: { symbol: T2_HUB, maxDepth: 1 } },
      { id: "leaf-maxEdges-20", args: { symbol: T2_LEAF, maxEdges: 20 } },
    ]
    const results: any[] = []
    for (const c of cases) {
      for (let i = 0; i < 2; i++) await door(projectPath, c.args)
      const samples: number[] = []
      let bytes = 0
      let edges = 0
      let last: any = null
      for (let i = 0; i < 5; i++) {
        const r = await door(projectPath, c.args)
        if (!r.ok) {
          results.push({ ...c, ok: false, error: r.error })
          last = null
          break
        }
        samples.push(Math.round(r.ms * 100) / 100)
        bytes = r.bytes
        edges = (r.json.callers?.length ?? 0) + (r.json.callees?.length ?? 0)
        last = r.json
      }
      if (last === null) continue
      results.push({
        ...c,
        ok: true,
        samplesMs: samples,
        p50: percentile(samples, 50),
        p95: percentile(samples, 95),
        min: Math.min(...samples),
        max: Math.max(...samples),
        bytes,
        edges,
        truncated: last.summary?.truncated,
        reasons: last.summary?.truncationReasons,
        cappedQueries: last.summary?.cappedQueries,
        timeBudgetMs: last.summary?.timeBudgetMs,
      })
      console.log(`  ${c.id}: p50=${percentile(samples, 50)}ms p95=${percentile(samples, 95)}ms edges=${edges} bytes=${bytes} samples=${JSON.stringify(samples)}`)
    }
    run.latency = results
  }

  // ── 7. latency, T0 (polyglot fixture) and T1 (n100 scale fixture) ─────────
  if (section === "latency-t0t1") {
    process.env.BB_DATA_DIR = path.join(ROOT, "validation/tools/bb_graph/bbdata")
    const { indexProjectParallel } = await import("../../../src/ast/parallel-indexer")
    const quiet = { log: () => {}, write: () => {}, error: () => {} } as any
    const tiers: any[] = []
    for (const [tier, fixture] of [
      ["T0", path.join(ROOT, "test/fixtures/polyglot")],
      ["T1", path.join(ROOT, ".perf-fixtures/bb-scale/n100")],
    ] as const) {
      const pid = getProjectId(fixture)
      const indexStarted = performance.now()
      const conlog = console.log
      console.log = () => {}
      try {
        await indexProjectParallel(pid as any, fixture, { logger: quiet })
      } finally {
        console.log = conlog
      }
      const indexMs = Math.round(performance.now() - indexStarted)
      const raw = await BrainDatabase.getRawInstance(pid as any)
      const symbolRow = raw.prepare("SELECT name FROM brain_symbol WHERE project_id = ? AND symbol_type IN ('function','method','class') ORDER BY gravity_score DESC LIMIT 1").get(pid) as any
      const symbol = String(symbolRow?.name ?? "")
      const samples: number[] = []
      let bytes = 0
      let edges = 0
      for (let i = 0; i < 5; i++) {
        const r = await door(fixture, { symbol })
        if (!r.ok) {
          tiers.push({ tier, fixture, ok: false, error: r.error })
          break
        }
        samples.push(Math.round(r.ms * 100) / 100)
        bytes = r.bytes
        edges = (r.json.callers?.length ?? 0) + (r.json.callees?.length ?? 0)
      }
      tiers.push({
        tier,
        fixture: path.relative(ROOT, fixture),
        symbol,
        ok: samples.length === 5,
        indexMs,
        samplesMs: samples,
        p50: samples.length ? percentile(samples, 50) : null,
        p95: samples.length ? percentile(samples, 95) : null,
        bytes,
        edges,
      })
      console.log(`  ${tier}: symbol=${symbol} index=${indexMs}ms p50=${tiers[tiers.length - 1]!.p50}ms p95=${tiers[tiers.length - 1]!.p95}ms edges=${edges}`)
    }
    run.tiers = tiers
  }

  // ── 8. the documented worst case: a hub at the default depth ──────────────
  if (section === "slow") {
    const started = performance.now()
    const r = await door(projectPath, { symbol: "push" })
    run.slow = r.ok
      ? {
          symbol: "push",
          ok: true,
          ms: Math.round(performance.now() - started),
          edges: (r.json.callers?.length ?? 0) + (r.json.callees?.length ?? 0),
          bytes: r.bytes,
          truncated: r.json.summary?.truncated,
          reasons: r.json.summary?.truncationReasons,
          cappedQueries: r.json.summary?.cappedQueries,
          callersIfUncapped: r.json.summary?.callersIfUncapped,
          calleesIfUncapped: r.json.summary?.calleesIfUncapped,
          totalsAreLowerBounds: r.json.summary?.totalsAreLowerBounds,
          timeBudgetMs: r.json.summary?.timeBudgetMs,
        }
      : { symbol: "push", ok: false, error: r.error, ms: Math.round(performance.now() - started) }
    console.log(JSON.stringify(run.slow))
  }

  const after = fileState(dbPath)
  run.dbAfter = after
  run.dbUnchanged = before.db === after.db && before["-wal"] === after["-wal"] && before["-shm"] === after["-shm"]
  const file = path.join(OUT, `probe-${section}.json`)
  writeFileSync(file, JSON.stringify(run, null, 2))
  console.log(`\nwrote ${file}`)
  console.log(`db files unchanged: ${run.dbUnchanged}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
