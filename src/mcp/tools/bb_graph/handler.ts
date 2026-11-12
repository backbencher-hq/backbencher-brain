// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the handler for bb_graph: it validates the request,
// calls the graph engine, and renders the answer as one self-contained payload
// (root, edges with their evidence basis, summary declarations, provenance).
// WHICH TOOL IT SERVES — bb_graph (mutability read, requiresIndex true,
// modes: graph).
// WHY IT IS SHAPED THIS WAY — the engine answers with facts about stored rows;
// this file must not add claims the engine did not make and must not drop facts
// a reader needs to audit one. Every optional argument is validated here before
// it can reach SQL (an unknown direction or a fractional depth would otherwise
// produce a silently different traversal), defaults are the ones the descriptor
// and the docs publish, and each edge keeps its stored tier claim
// (`evidenceClass`) and resolution basis (`targetBasis`) beside the derived
// `tier` so a reader can tell a stored classification from a derived one.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_graph.md,
// validation/tools/bb_graph/** (AUDIT.md, LATENCY.json, probe.ts),
// gates: bun run script/verify-graph.ts,
//        bun run script/m65/verify-graph-blindspots.ts,
//        npx tsx script/m65/verify-graph-plan.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_graph/descriptor.ts
// (schema, defaults, prose), script/tool-docs/curation/bb_graph.ts, and the
// generated page (regenerate with `--only bb_graph --write`).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, the
// read/write boundary (this tool reads and never writes), the graph engine's
// owner-cascade semantics, and the no-regex policy: no regex is used here.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { graphTraversal } from "../../../intelligence/graph/graph-engine"
// The ONE owner of the evidence-tier vocabulary and derivation. The answer must
// call it rather than re-derive a tier, so the tool and the editor cannot
// disagree about the same stored row.
import { classifyTier } from "../../../lsp/evidence_tier"

/** The tool's declared depth default. The engine's own default is the same
 *  number, so the agent door and the editor door answer the same graph when the
 *  caller omits the option: one engine, one default. */
const DEFAULT_MAX_DEPTH = 5
const MAX_DEPTH = 10
const MAX_EDGE_LIMIT = 5000
const MAX_EDGES = 5000

/** True when a value is a whole number inside [min, max]. A fractional depth or
 *  size is refused rather than floored: the editor door refuses the same value,
 *  and a silently floored bound is a bound the caller did not ask for. */
function wholeNumber(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/** Strip a symbol id's constant project prefix.
 *
 * A symbol id is `<projectHash40>:<path>:<name>:<line>`, and the hash is the
 * same for every symbol in one answer, so the per-edge copy would repeat it on
 * both endpoints of every edge. The rendered id stays a complete handle:
 * prepend the hash from `root.id` to recover the stored id. Only a first
 * segment that is exactly 40 lowercase hex characters is stripped, so an
 * `ext:` node and a foreign id shape come back untouched. Checked character by
 * character — a pattern match is not needed to compare one string to a
 * character set.
 */
const HEX_DIGITS = "0123456789abcdef"
function isFortyLowerHex(value: string): boolean {
  if (value.length !== 40) return false
  for (let i = 0; i < value.length; i++) {
    if (!HEX_DIGITS.includes(value[i]!)) return false
  }
  return true
}
function compactId(id: string): string {
  if (typeof id !== "string" || id.length <= 41) return id
  const at = id.indexOf(":")
  if (at !== 40 || !isFortyLowerHex(id.slice(0, at))) return id
  return id.slice(at + 1)
}

/** Strip a stored relationship id's constant prefix.
 *
 * A stored id is `<projectHash>:rel:<projectHash>:<sourceSymbolId>:<kind>:<n>`.
 * The leading `<projectHash>:rel:` is a constant within one answer and the hash
 * is already readable from every symbol id here, so it is dropped and the
 * remainder is still a complete handle: `<projectHash>:rel:` followed by this
 * string is the stored id. Anything not shaped that way is returned untouched. */
function compactRowId(rowId: unknown): string | null {
  if (typeof rowId !== "string" || rowId.length === 0) return null
  const marker = ":rel:"
  const at = rowId.indexOf(marker)
  if (at <= 0) return rowId
  const projectHash = rowId.slice(0, at)
  const rest = rowId.slice(at + marker.length)
  if (!rest.startsWith(projectHash + ":")) return rowId
  return rest
}

export const handler: ToolHandler = async (args, { projectId }) => {
    const symbol = String(args.symbol ?? "").trim()
    if (!symbol) return textResult("bb_graph requires symbol", true)

    const maxDepth = args.maxDepth === undefined ? DEFAULT_MAX_DEPTH : Number(args.maxDepth)
    if (!wholeNumber(maxDepth, 1, MAX_DEPTH)) {
      return textResult(`bb_graph maxDepth must be a whole number between 1 and ${MAX_DEPTH}`, true)
    }
    const edgeLimitArg = args.edgeLimit === undefined ? undefined : Number(args.edgeLimit)
    if (edgeLimitArg !== undefined && !wholeNumber(edgeLimitArg, 1, MAX_EDGE_LIMIT)) {
      return textResult(`bb_graph edgeLimit must be a whole number between 1 and ${MAX_EDGE_LIMIT}`, true)
    }
    const directionArg = args.direction === undefined ? undefined : String(args.direction)
    if (directionArg !== undefined && directionArg !== "callers" && directionArg !== "callees" && directionArg !== "both") {
      return textResult("bb_graph direction must be one of: callers, callees, both", true)
    }
    const relTypesArg = args.relationshipTypes === undefined ? undefined : (args.relationshipTypes as unknown[]).map((t) => String(t))
    if (relTypesArg !== undefined && relTypesArg.length === 0) {
      return textResult("bb_graph relationshipTypes must name at least one relationship kind", true)
    }
    const crossLangArg = args.includeCrossLanguage === undefined ? undefined : args.includeCrossLanguage !== false
    // The one bound that is a function of the clock. It is exposed because it is
    // the one bound that can be turned off: 0 is how a caller says "I accept the
    // runtime and I need a reproducible answer".
    const timeBudgetArg = args.timeBudgetMs === undefined ? undefined : Number(args.timeBudgetMs)
    if (timeBudgetArg !== undefined && (!Number.isFinite(timeBudgetArg) || timeBudgetArg < 0)) {
      return textResult("bb_graph timeBudgetMs must be a non-negative number (0 disables the bound)", true)
    }
    const maxEdgesArg = args.maxEdges === undefined ? undefined : Number(args.maxEdges)
    if (maxEdgesArg !== undefined && !wholeNumber(maxEdgesArg, 1, MAX_EDGES)) {
      return textResult(`bb_graph maxEdges must be a whole number between 1 and ${MAX_EDGES}`, true)
    }

    let result
    try {
      result = await graphTraversal(projectId as any, symbol, {
        rootFile: typeof args.file === "string" ? args.file.trim() || undefined : undefined,
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

    // The tier is the ONE owner's answer, and the stored claim that may have
    // decided it rides beside it: an edge whose `evidenceClass` is null got its
    // tier from its own stored kind and confidence.
    const tierFor = (e: { relationshipType: string; confidence: number | null; metadata?: { evidenceClass?: string | null } }): string =>
      classifyTier({ relationshipType: e.relationshipType, confidence: e.confidence ?? null, evidenceClass: e.metadata?.evidenceClass ?? null })

    // Renders one endpoint out of the engine's node map, so an edge is
    // self-contained: a reader never parses an id and never needs a second call to
    // learn which file a caller lives in.
    const describe = (id: string) => {
      const n = (result.nodes as Record<string, any> | undefined)?.[id]
      if (!n) return null
      return { id: compactId(n.id), name: n.name, symbolType: n.symbolType, file: n.file, line: n.line, isExternal: n.isExternal === true }
    }

    const edgesOf = (list: any[], direction: "caller" | "callee") =>
      list.map((e) => ({
        direction,
        from: describe(e.from),
        to: describe(e.to),
        relationshipType: e.relationshipType,
        confidence: e.confidence,
        tier: tierFor(e),
        // The stored classification when the index made one. Null means the tier
        // above was DERIVED from the stored kind and confidence — a reader can
        // tell a stored claim from a derivation without a second query.
        evidenceClass: e.metadata?.evidenceClass ?? null,
        // The stored enrichment "why" (role, pattern, layerFlow, criticality,
        // frequency and the inferredAt marker), nested exactly as the graph engine
        // parsed it. Absent when the row carries no enrichment; nothing is inferred
        // at read time.
        ...(e.metadata?.enrichment ? { enrichment: e.metadata.enrichment } : {}),
        ...(e.metadata?.method === "regex" ? { extractionMethod: "regex" } : {}),
        isCrossLanguage: e.isCrossLanguage === true,
        bridgeMechanism: e.bridge ?? e.bridgeMechanism ?? null,
        depth: e.depth,
        callSite: e.callSite ?? null,
        ...(e.metadata?.callSiteStartIndex !== undefined ? { callSiteStartIndex: e.metadata.callSiteStartIndex } : {}),
        // Whether the edge is about the symbol that was asked for, or about one of
        // its members folded on by the owner cascade. `matchedMember` names the
        // member the stored row actually referenced, which is what makes the
        // documented superset reducible to the exact set.
        match: e.targetMatch ?? e.sourceMatch ?? null,
        matchedMember: e.matchedMember ?? null,
        // Why the target may claim this identity, from the stored row:
        // `symbol` = a stored declaration, `external`/`unresolved` = a name the
        // index could not attach. Never inferred here.
        targetBasis: e.targetBasis ?? null,
        // The stored brain_relationship row this edge traces to, so every claim is
        // auditable against the index.
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
        // How many stored symbols this name resolved among. A name is not a unique
        // identifier, and when this is > 1 the graph below is about ONE of them.
        candidates: result.rootCandidates ?? 1,
        // WHICH step resolved the name: `containment` means the answer is about a
        // symbol whose name CONTAINS the one asked for, so the name was not itself
        // a symbol.
        match: result.rootMatch ?? null,
      },
      callers: edgesOf(result.callers as any[], "caller"),
      callees: edgesOf(result.callees as any[], "callee"),
      summary: {
        // RETURNED counts; `truncated`, `edgeLimit` and `callersIfUncapped` are
        // what tell a reader whether they hold the whole set.
        totalCallers: result.summary?.totalCallers ?? result.callers.length,
        totalCallees: result.summary?.totalCallees ?? result.callees.length,
        // What the walk actually reached, beside the cap it was allowed. A leaf
        // with no edges did not reach depth 3 just because 3 was permitted.
        maxDepthReached: result.summary?.maxDepthReached ?? null,
        maxDepth: result.summary?.maxDepth ?? null,
        crossLanguageEdges: result.summary?.crossLanguageEdges ?? 0,
        // Rows removed by the noise policy and by the includeCrossLanguage request.
        // Filters, not bounds: they leave a number so an empty set beside a
        // non-zero count is read as a policy or a request, never as an empty store.
        noiseFiltered: result.summary?.noiseFiltered ?? { callers: 0, callees: 0 },
        // Rows that NAME this symbol but carry no source symbol, so no traversal
        // can show them in either direction. `null` = not counted, never zero.
        unattributed: result.summary?.unattributed ?? null,
        crossLanguageExcluded: result.summary?.crossLanguageExcluded ?? { callers: 0, callees: 0 },
        // A DECLARED BOUND bit only: a filter is a request and reports through
        // filterNarrowed/filterReason below, never here.
        truncated: result.summary?.truncated === true,
        truncationReason: result.summary?.truncationReason ?? null,
        truncationReasons: result.summary?.truncationReasons ?? [],
        filterNarrowed: result.summary?.filterNarrowed === true,
        filterReason: result.summary?.filterReason ?? null,
        // The per-query site limit and the whole-answer limit in force, and which
        // fired. A requested maxEdges below edgeLimit is honored, not raised.
        edgeLimit: result.summary?.edgeLimit ?? null,
        maxEdges: result.summary?.maxEdges ?? null,
        // The walk-time bound and whether it fired: the one bound whose result can
        // legitimately differ between two identical calls.
        timeBudgetMs: result.summary?.timeBudgetMs ?? null,
        timeBudgetExhausted: result.summary?.timeBudgetExhausted === true,
        totalEdgeLimitReached: result.summary?.totalEdgeLimitReached === true,
        cappedQueries: result.summary?.cappedQueries ?? 0,
        callersIfUncapped: result.summary?.callersIfUncapped ?? null,
        calleesIfUncapped: result.summary?.calleesIfUncapped ?? null,
        totalsAreLowerBounds: result.summary?.totalsAreLowerBounds === true,
        // DEPTH 0 only: how much of the answer is about the symbol that was asked
        // for, and how much the owner cascade folded in from its members. Edges at
        // depth >= 1 are about discovered symbols and are counted as `deeper*`, so
        // exact + cascaded + deeper is the edges returned for that direction.
        exactCallers: result.summary?.exactCallers ?? 0,
        cascadedCallers: result.summary?.cascadedCallers ?? 0,
        exactCallees: result.summary?.exactCallees ?? 0,
        cascadedCallees: result.summary?.cascadedCallees ?? 0,
        deeperCallers: result.summary?.deeperCallers ?? 0,
        deeperCallees: result.summary?.deeperCallees ?? 0,
        // The fan-out bound in force and whether it bit.
        callerBudget: result.summary?.callerBudget ?? 0,
        calleeBudget: result.summary?.calleeBudget ?? 0,
        callerBudgetExhausted: result.summary?.callerBudgetExhausted === true,
        calleeBudgetExhausted: result.summary?.calleeBudgetExhausted === true,
        // Rows present in BOTH lists: one relationship seen from two ends, so
        // totalCallers + totalCallees overstates distinct rows by exactly this.
        edgesInBothDirections: result.summary?.edgesInBothDirections ?? 0,
        // The composition of the returned edges, the order kinds survive a cap in,
        // and — through scope below — the kinds actually searched.
        edgesByType: result.summary?.edgesByType ?? {},
        edgeKindPriority: result.summary?.edgeKindPriority ?? [],
        dedupedAtToolLayer: result.summary?.dedupedAtToolLayer ?? { cascadeRepeatsCollapsed: 0, spellingVariantsCollapsed: 0 },
        scope: {
          direction: directionArg ?? "both",
          // The engine's RESOLVED list, not a copy of a default kept here.
          relationshipTypes: result.summary?.relationshipTypesUsed ?? [],
          includeCrossLanguage: crossLangArg !== false,
        },
      },
      provenance: result.provenance ?? null,
    }, null, 2))
  }
