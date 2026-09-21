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
//   L3 nothing dropped:       every stored row id in the input appears in
//      exactly one group's rows (the verifier diffs against the db).
//   L4 file-level + external rows live in DECLARED, labeled sections — never
//      merged into symbol rows, never dropped (Understanding Rules §13.5).
//   L5 deterministic order:   groups sort by file, then name — a stable
//      render target, never insertion-order luck.
//
// Pure by construction: no imports beyond types + the traversal contracts —
// the mutation suite and every consumer exercise it through the same code.

import type { GraphEdge, GraphNode, GraphTraversalResult } from "../intelligence/contracts"

/** One stored relationship row as it survives grouping. Nothing about the
 *  row is dropped: rowId keeps it traceable, evidenceClass/enrichment ride
 *  along for the badge and tier laws (M26.W4/U4 render from these), and
 *  depth survives for the hub tree (U3 reworks the tree presentation; the
 *  data keeps the traversal depth declared). */
export interface GroupedRow {
  rowId: string
  relationshipType: string
  /** Source-side call site (file relative + 1-based line). null line = the
   *  analyzer could not derive one (M59.O4 #823) — renderers must treat it
   *  as "unknown", never substitute another line. */
  callSite?: { file: string; line: number | null }
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
  const callerMap = groupSide(result.callers ?? [], result.nodes ?? {}, (e) => e.from, (e) => e.to)
  const calleeMap = groupSide(result.callees ?? [], result.nodes ?? {}, (e) => e.to, (e) => e.from)
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
    annotations: result.annotations,
  }
}
