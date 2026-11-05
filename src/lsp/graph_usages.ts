// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the usages grouping core: stored relationship rows are
// grouped per symbol, with declared multiplicity and declared exclusions, before
// any renderer sees them.
// WHICH TOOL IT SERVES — bb/graph (LSP) `mode: "usages"`, i.e. the editor's
// usage panel and its hover/"who uses this" surfaces.
// WHERE ITS EVIDENCE LIVES — docs/m44 (usages transport), validation/m44,
// validation/tools/bb_graph (the same rows are served by the agent door);
// gates: npx tsx script/m44/verify-usages-groups.ts and the wire agreement law
// in npx tsx script/m55/verify-relations.ts.
// EDIT TOGETHER WHEN THIS CHANGES — src/lsp/graph_request.ts (the db-touching
// layer and the response shape), src/lsp/relations.ts (the relation vocabulary
// this module reads), src/intelligence/contracts.ts (GraphEdge.targetMatch /
// sourceMatch / depth — the directness evidence this module reads), the m44 and
// m55 gates.
// CONTRACTS IT MUST NOT BREAK — one group per symbol; every row the traversal
// returns is either rendered in exactly one group or counted in
// `declaredExclusions.counts`, never silently dropped; exclusions are declared
// on the wire with reasons AND counts; file-level rows live in their own labeled
// sections; order is deterministic; a caller list means callers of THIS symbol.
// ─────────────────────────────────────────────────────────────────────────────
// bb/graph `mode: "usages"` exists so a developer can understand who uses a
// symbol and how. The raw traversal answers "which stored rows touch this
// symbol" — and a caller like buildGreeter legitimately owns several rows
// (uses + references + instantiates), so the raw list repeats the same
// symbol five times. That is honest data with an unusable presentation.
// This module is the SINGLE owner of the grouping: stored rows are grouped
// per symbol BEFORE any rendering (one group per stored symbol).
//
// Declared shape (schemaVersion 2, usages mode):
//   { root, callers: UsageGroup[], callees: UsageGroup[],
//     fileLevel: { imports: FileLevelRow[], exports: FileLevelRow[] },
//     counts, summary, annotations? }
//
// Laws (gated by script/m44/verify-usages-groups.ts, and the three-surface
// agreement law by script/m55/verify-relations.ts over the real wire):
//   L1 one group per symbol:  two stored rows from the same caller produce
//      ONE group, never two rows with the same name.
//   L2 multiplicity declared: every group states relationshipTypes (type +
//      stored-row occurrences) and occurrences (== rows.length).
//   L3 nothing dropped:       every stored row id the SERVED input carries
//      appears in exactly one group's rows (the verifier diffs against the db).
//      The rows this surface declares it does not serve at all — self-loops,
//      declaration containments and OWNER-FAMILY rows — are named in
//      `declaredExclusions` on the payload WITH THEIR COUNTS
//      (`declaredExclusions.counts`, per direction), so "dropped" is a declared
//      filter and never a silent one. `counts.callerCandidateRows` /
//      `calleeCandidateRows` close the arithmetic: rendered + excluded == what
//      the traversal returned.
//   L3b a usage is DIRECT, and the two directions are NOT symmetric (the
//      asymmetry is the engine's, documented in directUsageRows):
//      · CALLERS: a row names this symbol when its TARGET side is the root and
//        the engine does not mark it `targetMatch: owner-cascade` — there the
//        cascade means the row named a DIFFERENT member of the root's owner.
//      · CALLEES: a row belongs to this symbol when its SOURCE side is the root,
//        INCLUDING `sourceMatch: owner-cascade` — there the fold means the call
//        was written inside one of the root's members, which is the legitimate
//        attribution and the only way a class has callees at all. Pruning it
//        emptied class callee lists and dropped the external callee the T5 gate
//        pins (measured 4 of 5 callee rows pruned on that fixture).
//      A DEEPER row is served only when it extends an already-served chain (its
//      parent endpoint is itself a served caller/callee) — that is what keeps
//      the hub's transitive TREE while refusing the owner-family cascade. Rows
//      reached through the owning declaration, a containment walk or an unserved
//      chain are the owner-family superset: not relations of this symbol,
//      excluded AND counted. Measured before this law (real index, real stdio
//      LSP probe): a method with ZERO callers listed SIX owner-family callers
//      for every member of its class, the class's own caller list carried a
//      member's call re-attributed to the class, and the hub could not be
//      reconciled with hover/references. After: a zero-caller symbol answers 0,
//      and a caller list equals the usage sites.
//   L4 file-level + external rows live in DECLARED, labeled sections — never
//      merged into symbol rows, never dropped.
//   L5 deterministic order:   groups sort by file, then name — a stable
//      render target, never insertion-order luck.
//
// Why the direct filter lives HERE and not in the engine: the traversal's owner
// cascade is a DELIBERATE, disclosed superset for the graph/impact/MCP surfaces
// (a graph rooted at a class must reach its members' callers). The question
// `mode: "usages"` answers is narrower — "who uses THIS symbol" — and §15.1
// permits a surface to filter differently PROVIDED it declares the filter. This
// module declares it, on the wire, with counts.
//
// Pure by construction: no imports beyond types + the traversal contracts —
// the mutation suite and every consumer exercise it through the same code.

import type { CallSiteAddress, GraphEdge, GraphNode, GraphTraversalResult } from "../intelligence/contracts"
// The ONE relation vocabulary. The hub answers the
// same question hover and `textDocument/references` answer, so it reads the same
// rule rather than keeping a private filter — a second filter is a second answer.
import { isDeclarationRelationship, USAGE_COUNT_UNIT_LABEL } from "./relations"

/** The relationship kinds this surface DECLARES it does not serve as a usage,
 *  in the payload's own vocabulary: a surface that filters differently states
 *  its filter. Machine-readable, never prose-only:
 *  a client can diff these against its own traversal and say why a stored row
 *  it holds is not in the list. */
export const USAGES_DECLARED_EXCLUSIONS = {
  /** A stored row whose BOTH ends are this symbol — an analyzer artifact, not a
   *  use of anything. Already excluded before this wave (the self-loop fix). */
  selfReferentialRows: "an analyzer artifact: the row's source and target are the same symbol",
  /** `contains`/`exports` — how a symbol is DECLARED, never who uses it.
   *  `Greeter contains greet` is not `Greeter` USING `greet`; it is `greet` being
   *  a member of `Greeter`. Serving the declaration containment as a caller
   *  listed a class among the users of its own member, which is the exact
   *  inversion the vocabulary exists to prevent (src/lsp/relations.ts:
   *  "a declaration is never a usage"). Measured: `Greeter` was rendered as a
   *  caller of `greet`.
   *
   *  WHY HERE AND NOT IN THE ENGINE'S DEFAULT TYPE LIST: the traversal must walk
   *  `contains` — a graph rooted at a class cannot reach that class's own
   *  methods without it (src/intelligence/graph/graph-engine.ts:28-30, where
   *  dropping it was measured as structural damage). The exclusion is a property
   *  of the USAGES vocabulary, not of the walk, so it belongs at the usages
   *  grouping — the module the codebase already calls "the SINGLE owner of the
   *  grouping" — and `mode: "graph"` keeps serving every stored kind. */
  declarationContainments: "declaration containments (contains/exports) declare a symbol; they are never usages of it",
  /** NEW (T3 cross-surface defect): rows the traversal reached only THROUGH the
   *  owning declaration, a containment walk, or a chain this answer does not
   *  serve. The owner cascade is right for the graph panel (a class graph must
   *  reach its members), but in a CALLERS list it made every member inherit the
   *  whole class's referrers — measured: a method with ZERO callers answered
   *  six, one per class method's callers plus the class's own instantiators; and
   *  the class's caller list carried a member's own call re-attributed to the
   *  class. A "caller" that does not name this symbol is not a caller of it.
   *  Omitted, counted in `declaredExclusions.counts.*.ownerFamilyRows`, never
   *  silent. */
  ownerFamilyRows: "rows reached only through the symbol's owning declaration, a containment walk or a chain that is not served — they do not name this symbol, so they are not usages of it (the owner-family cascade made a zero-caller method report six callers)",
} as const

/** The per-direction COUNTS of the declared exclusions. The reasons above say
 *  WHAT is excluded; these say HOW MANY, per direction, so a reader can
 *  reconcile a rendered list with the traversal it came from instead of
 *  trusting a number. */
export interface UsagesExclusionCounts {
  selfReferentialRows: number
  declarationContainments: number
  ownerFamilyRows: number
}

/** The payload's declared filter: reasons (client-facing, stable vocabulary)
 *  plus the counts (machine-readable reconciliation). */
export interface UsagesDeclaredExclusions {
  selfReferentialRows: string
  declarationContainments: string
  ownerFamilyRows: string
  counts: {
    caller: UsagesExclusionCounts
    callee: UsagesExclusionCounts
  }
}

/** One stored relationship row as it survives grouping. Nothing about the
 *  row is dropped: rowId keeps it traceable, evidenceClass/enrichment ride
 *  along for the badge and tier laws (the editor renders from these), and
 *  depth survives for the hub tree (U3 reworks the tree presentation; the
 *  data keeps the traversal depth declared). */
export interface GroupedRow {
  rowId: string
  relationshipType: string
  /** Source-side position, as the M62 address owner derived it. Never a bare
   *  line: a legacy `0` or a NULL line is `kind: "unknown"` (or a labeled
   *  `"declaration"` substitute) — see src/intelligence/graph/line-address.ts. */
  callSite?: CallSiteAddress
  /** Traversal depth of the edge this row came from. */
  depth: number
  confidence: number
  isCrossLanguage: boolean
  bridgeMechanism?: string
  evidenceClass?: string
  enrichment?: NonNullable<GraphEdge["metadata"]>["enrichment"]
  /** The tree parent of this row's group — the symbol
   *  the edge connects toward the root (callers: edge.to; callees:
   *  edge.from), or the root symbol id itself for a depth-0 row. Every
   *  expanded node is itself a caller/callee group, so this id always
   *  resolves to a rendered tree position — a renderer that nests a row
   *  under a parent that does not own it fabricates a level. Kept per ROW
   *  because one symbol group can legitimately
   *  own rows toward several parents (a diamond); the tree then shows the
   *  symbol once per parent position with each position's own rows. */
  parentSymbolId: string
  /** Display name of the parent symbol (index-stored, never parsed). */
  parentName: string
}

/** A per-symbol usage group: the caller/callee symbol ONCE, with the full
 *  declared multiplicity of the stored rows behind it. */
export interface UsageGroup {
  symbolId: string
  name: string
  file: string
  language: string
  symbolType: string
  /** Definition line of the symbol (navigation target). */
  line: number
  isExternal: boolean
  /** Per relationship-type stored-row counts. */
  relationshipTypes: Array<{ type: string; occurrences: number }>
  /** Total stored rows in this group — the multiplicity. == rows.length. */
  occurrences: number
  /** Every stored row, declared (nothing dropped; L3 differential). */
  rows: GroupedRow[]
}

/** A raw file-level relationship row as stored (no symbol endpoint). The
 *  SQL that fetches these lives in graph_request.ts (the only db-touching
 *  layer); classification is pure and lives here. */
export interface FileLevelRawRow {
  rowId: string
  relationshipType: string
  /** Module specifier from storage (e.g. "./greeter:Greeter"), may be empty
   *  when the store names no module. */
  moduleSpecifier: string | null
  confidence: number
}

/** Classify raw file-level rows into the declared sections. An unexpected
 *  relationship type is a storage-contract violation — throw (never drop a
 *  row into silence, never guess a section for it). */
export function classifyFileLevel(raw: FileLevelRawRow[]): { imports: FileLevelRow[]; exports: FileLevelRow[] } {
  const imports: FileLevelRow[] = []
  const exports: FileLevelRow[] = []
  for (const row of raw) {
    const entry: FileLevelRow = { rowId: row.rowId, relationshipType: row.relationshipType, moduleSpecifier: row.moduleSpecifier ?? "", confidence: row.confidence }
    // `part_of` IS A FILE-LEVEL DEPENDENCY KIND (2026-10-22, cpp lane): a QUOTED `#include "x.h"`
    // is the unit's own fragment (src/ast/types.ts:148-160), and it must appear in the file-level
    // dependency section exactly as an angle include does — otherwise the classifier is the second
    // place the vocabulary has to be extended and the first place it is forgotten.
    if (row.relationshipType === "imports" || row.relationshipType === "part_of") imports.push(entry)
    else if (row.relationshipType === "exports") exports.push(entry)
    else throw new Error(`bb/graph: file-level classifier received unexpected relationship_type ${row.relationshipType} (row ${row.rowId})`)
  }
  imports.sort((a, b) => a.moduleSpecifier.localeCompare(b.moduleSpecifier) || a.rowId.localeCompare(b.rowId))
  exports.sort((a, b) => a.moduleSpecifier.localeCompare(b.moduleSpecifier) || a.rowId.localeCompare(b.rowId))
  return { imports, exports }
}

/** A file-level relationship row (imports/exports with no symbol endpoint).
 *  Storage has no file column for these: the identity is the module
 *  specifier (target_external) plus the stored relationship type. Rendered
 *  in a declared, labeled section — never as a symbol row. */
export interface FileLevelRow {
  rowId: string
  relationshipType: "imports" | "exports" | string
  /** Module specifier from storage (e.g. "./greeter:Greeter"), or "" when
   *  the store names no module — declared, never invented. */
  moduleSpecifier: string
  /** Stored confidence, preserved. */
  confidence: number
}

export interface GroupedUsages {
  root: { symbolId: string; name: string; file: string; language: string; line: number }
  callers: UsageGroup[]
  callees: UsageGroup[]
  /** File-level rows, both directions. `imports`/`exports` are INCOMING —
   *  rows that target the root (who imports this symbol).
   *  `dependencies` are OUTGOING — the root FILE's own module
   *  dependencies, which is the only shape a `#include` can take: it has no
   *  symbol endpoint on either side, so the incoming query can never reach
   *  it. Declared separately rather than mixed into `imports`, so a consumer
   *  can never mistake "what this file includes" for "who imports this". */
  fileLevel: { imports: FileLevelRow[]; exports: FileLevelRow[]; dependencies: FileLevelRow[] }
  counts: {
    callerGroups: number
    calleeGroups: number
    callerRows: number
    calleeRows: number
    fileLevelRows: number
    /** The outgoing subset of fileLevelRows — counted so the two
     *  directions can never be conflated in a header number. */
    fileDependencyRows: number
    /** The traversal's rows per direction BEFORE this surface's declared
     *  filters. Reconciliation: callerRows + declaredExclusions.counts.caller
     *  sums === callerCandidateRows (and the same for callees). Added with L3b
     *  so the owner-family exclusions can be subtracted by a client, not
     *  guessed at. */
    callerCandidateRows: number
    calleeCandidateRows: number
  }
  summary: {
    truncated: boolean
    truncationReason?: string
    crossLanguageGroups: number
  }
  /** This surface filters, and says so ON THE WIRE. Every stored row the
   *  traversal returned and this payload does not serve is named here with its
   *  reason AND counted here per direction, so a client holding a row this list
   *  omits can tell "not a usage" from "not reached" — and can add the count
   *  back to reconcile with a surface that does not filter (hover). The counts
   *  are the reconciliation; the reasons are the vocabulary. */
  declaredExclusions?: UsagesDeclaredExclusions
  /**
   * What a hub COUNT counts, in the payload beside `counts`.
   * `counts.callerGroups` is groups (symbols) and `counts.callerRows` is stored
   * rows; NEITHER is "usages" — the hub's list is one group per symbol, while the
   * hover's is one row per place. A client that renders either number under the
   * bare word "callers" makes a claim the count unit does not license, and this
   * field is what lets it render the right one. The sentence is the vocabulary
   * owner's single copy (USAGE_COUNT_UNIT_LABEL in src/lsp/relations.ts), so no
   * surface can paraphrase the unit into its own dialect.
   */
  countUnit?: string
  annotations?: GraphTraversalResult["annotations"]
}

function typeCounts(rows: GroupedRow[]): Array<{ type: string; occurrences: number }> {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.relationshipType, (map.get(row.relationshipType) ?? 0) + 1)
  return [...map.entries()]
    .map(([type, occurrences]) => ({ type, occurrences }))
    .sort((a, b) => a.type.localeCompare(b.type) || b.occurrences - a.occurrences)
}

function sortedGroups(groups: UsageGroup[]): UsageGroup[] {
  return [...groups].sort(
    (a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name) || a.symbolId.localeCompare(b.symbolId),
  )
}

function groupSide(edges: GraphEdge[], nodes: Record<string, GraphNode>, pick: (e: GraphEdge) => string, parentOf: (e: GraphEdge) => string): Map<string, UsageGroup> {
  const byNode = new Map<string, UsageGroup>()
  for (const edge of edges) {
    const nodeId = pick(edge)
    const node = nodes[nodeId]
    if (node === undefined) {
      // Traceability rule: an edge whose endpoint is not in the node
      // registry can never render. Fail loud — never silently drop.
      throw new Error(`bb/graph: usages grouping consistency failure — edge ${edge.from} -> ${edge.to} has no registered node ${nodeId}`)
    }
    // Tree parent must resolve too — a row whose parent endpoint is missing
    // from the registry would let a renderer nest it under a fabricated
    // parent. The parent is ALWAYS root or an expanded
    // caller/callee, both registered, so a miss is an engine contract break.
    const parentId = parentOf(edge)
    if (nodes[parentId] === undefined) {
      throw new Error(`bb/graph: usages grouping consistency failure — edge ${edge.from} -> ${edge.to} has no registered parent node ${parentId}`)
    }
    let group = byNode.get(nodeId)
    if (group === undefined) {
      group = {
        symbolId: node.id,
        name: node.name,
        file: node.file,
        language: node.language,
        symbolType: node.symbolType,
        line: node.line,
        isExternal: node.isExternal,
        relationshipTypes: [],
        occurrences: 0,
        rows: [],
      }
      byNode.set(nodeId, group)
    }
      group.rows.push({
      rowId: edge.rowId,
      relationshipType: edge.relationshipType,
      callSite: edge.callSite,
      depth: edge.depth,
      confidence: edge.confidence,
      isCrossLanguage: edge.isCrossLanguage,
      bridgeMechanism: edge.bridgeMechanism,
      evidenceClass: edge.metadata?.evidenceClass,
      enrichment: edge.metadata?.enrichment,
      parentSymbolId: parentId,
      parentName: nodes[parentId]!.name,
    })
  }
  return byNode
}

function finalize(byNode: Map<string, UsageGroup>): UsageGroup[] {
  const groups = [...byNode.values()]
  for (const g of groups) {
    g.rows.sort((a, b) => a.relationshipType.localeCompare(b.relationshipType) || a.rowId.localeCompare(b.rowId))
    g.relationshipTypes = typeCounts(g.rows)
    g.occurrences = g.rows.length
  }
  return sortedGroups(groups)
}

/** One direction's served rows plus the declared-exclusion tally behind them. */
interface DirectUsageSide {
  rendered: GraphEdge[]
  excluded: UsagesExclusionCounts
}

/**
 * L3 / L3b: keep the rows that name THIS symbol directly plus the deeper rows
 * that extend an already-served chain, and classify every row this surface
 * declines into the declared-exclusion vocabulary. One row lands in exactly one
 * bucket, so the counts partition the input.
 *
 * What "direct" means, read from the traversal rather than re-derived here. The
 * two directions are NOT symmetric, and the asymmetry is the engine's:
 *   · a CALLER row is a claim ABOUT this symbol: its target side is the root
 *     (`edge.to === rootId`), and `targetMatch` states whether the stored row
 *     names the root or a MEMBER of the root's owner. An explicit
 *     `owner-cascade` there is the engine saying the row named a different
 *     member, so it is not a caller of this symbol.
 *   · a CALLEE row is a claim BY this symbol: its source side is the root
 *     (`edge.from === rootId`), and `sourceMatch: "owner-cascade"` there means
 *     the call was written inside one of the root's MEMBERS and folded onto the
 *     root — the LEGITIMATE attribution, and the only reason a class has callees
 *     at all (a class's calls live in its methods). It is NOT pruned. A callee
 *     row has no attribution field on its target side (GraphEdge.sourceMatch is
 *     the callee-side field; the callee node's identity is its own), so there is
 *     nothing on the far end that needs testing.
 *   · a DEEPER row (depth > 0) is served only when it extends a chain this
 *     answer already serves: its parent endpoint (callers: edge.to; callees:
 *     edge.from) is itself a served group. `render → make → Widget` keeps
 *     `render` nested under `make`; the owner-family row `main → Greeter`
 *     attributed to a method is not, because the owner is not a served caller of
 *     that method. This keeps the hub's genuine transitive tree without letting
 *     the owner cascade become callers.
 *
 * A hand-built edge that omits `targetMatch`/`sourceMatch`/`depth` is NOT
 * evidence of a cascade, so only an explicit non-exact match is treated as one;
 * pruning on a missing field would drop rows on an unproven suspicion. (The
 * engine states the match on every row it emits — GraphEdge.targetMatch in
 * src/intelligence/contracts.ts.)
 */
function directUsageRows(
  edges: readonly GraphEdge[],
  direction: "caller" | "callee",
  rootId: string,
): DirectUsageSide {
  const rendered: GraphEdge[] = []
  const excluded: UsagesExclusionCounts = { selfReferentialRows: 0, declarationContainments: 0, ownerFamilyRows: 0 }
  const servedGroupIds = new Set<string>()
  const deferred: GraphEdge[] = []
  const namesRoot = (edge: GraphEdge): boolean =>
    direction === "caller"
      ? edge.to === rootId && edge.targetMatch !== "owner-cascade"
      : edge.from === rootId
  const groupOf = (edge: GraphEdge) => (direction === "caller" ? edge.from : edge.to)
  for (const edge of edges) {
    if (edge.from === edge.to) {
      excluded.selfReferentialRows++
      continue
    }
    if (isDeclarationRelationship(edge.relationshipType)) {
      excluded.declarationContainments++
      continue
    }
    const rowDepth = (edge as { depth?: number }).depth
    if (namesRoot(edge)) {
      // The row names the symbol itself (any depth: a re-fetched adjacent row
      // is still this row, and dedupe by row id below keeps it counted once).
      if (!rendered.some((r) => r.rowId === edge.rowId)) rendered.push(edge)
      servedGroupIds.add(groupOf(edge))
    } else if (rowDepth === 0) {
      // Adjacent, but the row's claimed end is not the symbol (or its target is
      // attributed through the owner): nothing to nest it under on this side.
      excluded.ownerFamilyRows++
    } else {
      deferred.push(edge)
    }
  }
  for (const edge of deferred) {
    const parentId = direction === "caller" ? edge.to : edge.from
    // A caller row whose target is an owner-cascade attribution is not a caller
    // of the parent either. A callee row's source fold is legitimate at every
    // depth (see the direction note above), so only the served parent matters.
    const extendsServedChain = servedGroupIds.has(parentId) &&
      (direction === "caller" ? edge.targetMatch !== "owner-cascade" : true)
    if (extendsServedChain) rendered.push(edge)
    else excluded.ownerFamilyRows++
  }
  return { rendered, excluded }
}

/** Group the traversal result's caller/callee edges per symbol. This is the
 *  whole of the grouping decision — a renderer that repeats a symbol row,
 *  drops a row, or miscounts a group has broken a law this module enforces.
 *
 *  Tree parent semantics: an edge's group keys on one endpoint and its TREE
 *  position hangs under the OTHER endpoint — the symbol one hop closer to the
 *  root. Caller edge Y→X: group Y (the caller), parent X (Y calls X, X calls
 *  root). Callee edge X→Y: group Y (the callee), parent X (X calls Y, root
 *  calls X). Depth-0 rows therefore parent to the root symbol id.
 *
 *  THREE exclusions, ONE vocabulary (`USAGES_DECLARED_EXCLUSIONS`), all counted
 *  in `exclusions`, so none is a silent thinning:
 *    · a SELF-REFERENTIAL row (from === to) is an analyzer artifact, not a
 *      usage. Measured: the graph listed `greet` among greet's own callers.
 *    · a DECLARATION CONTAINMENT (`contains`/`exports`) is how a symbol is
 *      DECLARED, never who uses it. Measured: `Greeter` (the class that
 *      CONTAINS `greet`) was rendered as a caller of `greet`.
 *    · an OWNER-FAMILY row is reached only through the owning declaration, a
 *      containment walk or a chain this answer does not serve (L3b). Measured:
 *      a zero-caller method listed six callers, all owner-family. */
export function groupUsagesEdges(result: GraphTraversalResult): {
  callers: UsageGroup[]
  callees: UsageGroup[]
  exclusions: { caller: UsagesExclusionCounts; callee: UsagesExclusionCounts }
  candidateRows: { caller: number; callee: number }
} {
  const rootId = result.root.id
  const callerSide = directUsageRows(result.callers ?? [], "caller", rootId)
  const calleeSide = directUsageRows(result.callees ?? [], "callee", rootId)
  const callerMap = groupSide(callerSide.rendered, result.nodes ?? {}, (e) => e.from, (e) => e.to)
  const calleeMap = groupSide(calleeSide.rendered, result.nodes ?? {}, (e) => e.to, (e) => e.from)
  return {
    callers: finalize(callerMap),
    callees: finalize(calleeMap),
    exclusions: { caller: callerSide.excluded, callee: calleeSide.excluded },
    candidateRows: { caller: (result.callers ?? []).length, callee: (result.callees ?? []).length },
  }
}

/** Assemble the full grouped-usages response (root + groups + counts). */
export function buildGroupedUsages(
  result: GraphTraversalResult,
  fileLevel: { imports: FileLevelRow[]; exports: FileLevelRow[]; dependencies?: FileLevelRow[] },
): GroupedUsages {
  const { callers, callees, exclusions, candidateRows } = groupUsagesEdges(result)
  const crossLanguageGroups = [...callers, ...callees].filter((g) => g.rows.some((r) => r.isCrossLanguage)).length
  const root = result.root
  const sections = { imports: fileLevel.imports, exports: fileLevel.exports, dependencies: fileLevel.dependencies ?? [] }
  return {
    root: { symbolId: root.id, name: root.name, file: root.file, language: root.language, line: root.line },
    callers,
    callees,
    fileLevel: sections,
    counts: {
      callerGroups: callers.length,
      calleeGroups: callees.length,
      callerRows: callers.reduce((n, g) => n + g.rows.length, 0),
      calleeRows: callees.reduce((n, g) => n + g.rows.length, 0),
      fileLevelRows: sections.imports.length + sections.exports.length + sections.dependencies.length,
      fileDependencyRows: sections.dependencies.length,
      callerCandidateRows: candidateRows.caller,
      calleeCandidateRows: candidateRows.callee,
    },
    summary: {
      truncated: result.summary.truncated,
      truncationReason: result.summary.truncationReason,
      crossLanguageGroups,
    },
    declaredExclusions: { ...USAGES_DECLARED_EXCLUSIONS, counts: exclusions },
    countUnit: USAGE_COUNT_UNIT_LABEL,
    annotations: result.annotations,
  }
}
