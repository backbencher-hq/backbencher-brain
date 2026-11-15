// src/lsp/graph_usages.ts — M44.U1 (issue #688): the usages grouping core.
//
// bb/graph `mode: "usages"` exists so a developer can understand who uses a
// symbol and how. The raw traversal answers "which stored rows touch this
// symbol" — and a caller like buildGreeter legitimately owns several rows
// (uses + references + instantiates), so the raw list repeats the same
// symbol five times. That is honest data with an unusable presentation.
// This module is the SINGLE owner of the grouping: stored rows are grouped
// per symbol BEFORE any rendering (Understanding Rules §13.1/§13.2/§13.4).
//
// Declared shape (schemaVersion 2, usages mode):
//   { root, callers: UsageGroup[], callees: UsageGroup[],
//     fileLevel: { imports: FileLevelRow[], exports: FileLevelRow[] },
//     counts, summary, annotations? }
//
// Laws (gated by script/m44/verify-usages-groups.ts):
//   L1 one group per symbol:  two stored rows from the same caller produce
//      ONE group, never two rows with the same name.
//   L2 multiplicity declared: every group states relationshipTypes (type +
//      stored-row occurrences) and occurrences (== rows.length).
//   L3 nothing dropped:       every stored row id the SERVED input carries
//      appears in exactly one group's rows (the verifier diffs against the db).
//      The rows this surface declares it does not serve at all — self-loops and
//      declaration containments — are named in `declaredExclusions` on the
//      payload, so "dropped" is a declared filter and never a silent one.
//   L4 file-level + external rows live in DECLARED, labeled sections — never
//      merged into symbol rows, never dropped (Understanding Rules §13.5).
//   L5 deterministic order:   groups sort by file, then name — a stable
//      render target, never insertion-order luck.
//
// Pure by construction: no imports beyond types + the traversal contracts —
// the mutation suite and every consumer exercise it through the same code.

import type { CallSiteAddress, GraphEdge, GraphNode, GraphTraversalResult } from "../intelligence/contracts"
// M55.T3 (§14 Truth Rule 1): the ONE relation vocabulary. The hub answers the
// same question hover and `textDocument/references` answer, so it reads the same
// rule rather than keeping a private filter — a second filter is a second answer.
import { isDeclarationRelationship, USAGE_COUNT_UNIT_LABEL } from "./relations"

/** The relationship kinds this surface DECLARES it does not serve as a usage,
 *  in the payload's own vocabulary (Understanding Rules §15.1: a surface that
 *  filters differently states its filter). Machine-readable, never prose-only:
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
   *  "a declaration is never a usage"). Found live by the M55.T3 gate on the
   *  merged branch: `Greeter` was rendered as a caller of `greet`.
   *
   *  WHY HERE AND NOT IN THE ENGINE'S DEFAULT TYPE LIST: the traversal must walk
   *  `contains` — a graph rooted at a class cannot reach that class's own
   *  methods without it (src/intelligence/graph/graph-engine.ts:28-30, where
   *  dropping it was measured as structural damage). The exclusion is a property
   *  of the USAGES vocabulary, not of the walk, so it belongs at the usages
   *  grouping — the module the codebase already calls "the SINGLE owner of the
   *  grouping" — and `mode: "graph"` keeps serving every stored kind. */
  declarationContainments: "declaration containments (contains/exports) declare a symbol; they are never usages of it",
} as const

/** One stored relationship row as it survives grouping. Nothing about the
 *  row is dropped: rowId keeps it traceable, evidenceClass/enrichment ride
 *  along for the badge and tier laws (M26.W4/U4 render from these), and
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
  /** M44.U3 (issue #690): the tree parent of this row's group — the symbol
   *  the edge connects toward the root (callers: edge.to; callees:
   *  edge.from), or the root symbol id itself for a depth-0 row. Every
   *  expanded node is itself a caller/callee group, so this id always
   *  resolves to a rendered tree position — a renderer that nests a row
   *  under a parent that does not own it fabricates a level (harness
   *  AH7-negative). Kept per ROW because one symbol group can legitimately
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
  /** Per relationship-type stored-row counts (Understanding Rules §13.2). */
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
    if (row.relationshipType === "imports") imports.push(entry)
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
 *  in a declared, labeled section — never as a symbol row (§13.5). */
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
   *  rows that target the root (who imports this symbol, §13.5).
   *  `dependencies` (M60/#910) are OUTGOING — the root FILE's own module
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
    /** M60/#910: the outgoing subset of fileLevelRows — counted so the two
     *  directions can never be conflated in a header number. */
    fileDependencyRows: number
  }
  summary: {
    truncated: boolean
    truncationReason?: string
    crossLanguageGroups: number
  }
  /** §14 Truth Rule 1, second half: this surface filters, and says so ON THE
   *  WIRE. Every stored row the traversal returned and this payload does not
   *  serve is named here with its reason, so a client holding a row this list
   *  omits can tell "not a usage" from "not reached". Absent before this wave,
   *  which is why the hub's caller count could disagree with hover's without
   *  either surface being able to say why. */
  declaredExclusions?: typeof USAGES_DECLARED_EXCLUSIONS
  /**
   * M55.T3 integration: what a hub COUNT counts, in the payload beside `counts`.
   * `counts.callerGroups` is groups (symbols) and `counts.callerRows` is stored
   * rows; NEITHER is "usages" — the hub's list is one group per symbol, while the
   * hover's is one row per place. A client that renders either number under the
   * bare word "callers" makes a claim §14 rule 1 does not license, and this
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
      // Traceability law (M26.W2): an edge whose endpoint is not in the node
      // registry can never render. Fail loud — never silently drop.
      throw new Error(`bb/graph: usages grouping consistency failure — edge ${edge.from} -> ${edge.to} has no registered node ${nodeId}`)
    }
    // Tree parent must resolve too — a row whose parent endpoint is missing
    // from the registry would let a renderer nest it under a fabricated
    // parent (U3 AH7-negative). The parent is ALWAYS root or an expanded
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

/** Group the traversal result's caller/callee edges per symbol. This is the
 *  whole of the grouping decision — a renderer that repeats a symbol row,
 *  drops a row, or miscounts a group has broken a law this module enforces. */
export function groupUsagesEdges(result: GraphTraversalResult): { callers: UsageGroup[]; callees: UsageGroup[] } {
  // Tree parent semantics (U3): an edge's group keys on one endpoint and its
  // TREE position hangs under the OTHER endpoint — the symbol one hop closer
  // to the root. Caller edge Y→X: group Y (the caller), parent X (Y calls X,
  // X calls root). Callee edge X→Y: group Y (the callee), parent X (X calls
  // Y, root calls X). Depth-0 rows therefore parent to the root symbol id.
  //
  // M55.T3 (§14 Truth Rule 1): TWO exclusions, ONE vocabulary
  // (src/lsp/relations.ts). Both are declared in the payload
  // (`USAGES_DECLARED_EXCLUSIONS`), so neither is a silent thinning:
  //   - a SELF-REFERENTIAL row (from === to) is an analyzer artifact, not a
  //     usage. Found live by the T3 gate: the graph listed `greet` among
  //     greet's own callers.
  //   - a DECLARATION CONTAINMENT (`contains`/`exports`) is how a symbol is
  //     DECLARED, never who uses it. Found live by the same gate: `Greeter`
  //     (the class that CONTAINS `greet`) was rendered as a caller of `greet`.
  //     The predicate is the vocabulary owner's, not a local type list, so this
  //     surface cannot drift from hover's or references'.
  const usageRowsOnly = <T extends { from: string; to: string; relationshipType: string }>(edges: readonly T[]): T[] =>
    edges.filter((e) => e.from !== e.to && !isDeclarationRelationship(e.relationshipType))
  const callerMap = groupSide(usageRowsOnly(result.callers ?? []), result.nodes ?? {}, (e) => e.from, (e) => e.to)
  const calleeMap = groupSide(usageRowsOnly(result.callees ?? []), result.nodes ?? {}, (e) => e.to, (e) => e.from)
  return { callers: finalize(callerMap), callees: finalize(calleeMap) }
}

/** Assemble the full grouped-usages response (root + groups + counts). */
export function buildGroupedUsages(
  result: GraphTraversalResult,
  fileLevel: { imports: FileLevelRow[]; exports: FileLevelRow[]; dependencies?: FileLevelRow[] },
): GroupedUsages {
  const { callers, callees } = groupUsagesEdges(result)
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
    },
    summary: {
      truncated: result.summary.truncated,
      truncationReason: result.summary.truncationReason,
      crossLanguageGroups,
    },
    declaredExclusions: USAGES_DECLARED_EXCLUSIONS,
    countUnit: USAGE_COUNT_UNIT_LABEL,
    annotations: result.annotations,
  }
}
