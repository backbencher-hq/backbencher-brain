import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { GraphEdge, GraphNode, GraphTraversalOptions, GraphTraversalResult } from "../contracts"
import { makeProvenance } from "../evidence"
import { deriveCallSiteAddress } from "./line-address"

type EdgeMetadata = NonNullable<GraphEdge["metadata"]>

const DEFAULT_REL_TYPES = ["calls", "instantiates", "extends", "implements"]
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_BUDGET = 50

type SymbolRow = {
  id: string
  name: string
  symbolType: string
  line: number
  lineEnd: number
  relativePath: string
  filePath: string
  language: string
  complexity: number
}

type EdgeRow = {
  rowId: string
  lineNumber: number | null
  relType: string
  confidence: number
  isCrossLang: number | null
  bridge: string | null
  meta: string | null
  symId: string | null
  symName: string | null
  line: number | null
  lineEnd: number | null
  complexity: number | null
  symType: string | null
  fileRel: string | null
  filePath: string | null
  fileLang: string | null
  srcFileRel: string | null
  extName: string | null
}

/** The owner-cascade: a relationship whose stored target is any member of a
 *  class/struct/etc. (e.g. a call to a method) is attributed to the whole
 *  owner family — the edge is emitted toward the OWNER symbol, not just the
 *  exact member. Evidence: `cleanup --calls--> file_already_gone?` (a real
 *  brain_relationship row) is reported as `cleanup → Cleaner`.
 *
 *  This is deliberate class-granularity attribution: every emitted edge still
 *  traces to a real stored row (rowId), and the member-level target is visible
 *  in the edge's callSite/metadata — but it means callers/callees sets at any
 *  depth are a superset of naive exact-target SQL. Tools and docs MUST
 *  disclose this (M48 post-closure accuracy fix; see docs/tools/bb_graph.md). */
function cascadeBounds(symbolId: string): { prefix: string; upper: string } {
  const prefix = symbolId.includes(":") ? symbolId.slice(0, symbolId.lastIndexOf(":") + 1) : ""
  return { prefix, upper: prefix + ";" }
}

/** Parse the stored metadata JSON into the declared pass-through shape.
 *  Malformed or foreign metadata degrades to undefined — never throws, never
 *  invents fields (a row with unreadable metadata still renders, tierless). */
function edgeMetadata(meta: string | null): EdgeMetadata | undefined {
  if (!meta) return undefined
  try {
    const parsed = JSON.parse(meta) as Record<string, unknown>
    const out: EdgeMetadata = {}
    if (typeof parsed["evidenceClass"] === "string") out.evidenceClass = parsed["evidenceClass"]
    // M42.H3: pass through the index-computed enrichment fields (the
    // enrichment pass writes them into metadata; the LSP surface only reads
    // what the index stored — no inference here, §12.3). Presence is gated on
    // the `inferredAt` marker the pass always writes.
    if (typeof parsed["inferredAt"] === "number") {
      out.enrichment = { inferredAt: parsed["inferredAt"] as number }
      for (const key of ["role", "pattern", "layerFlow", "criticality", "frequency"] as const) {
        if (typeof parsed[key] === "string") (out.enrichment as Record<string, unknown>)[key] = parsed[key]
      }
      for (const key of ["isTestCode", "isGeneratedCode", "isFrameworkContract", "isDependencyInjection"] as const) {
        if (typeof parsed[key] === "boolean") (out.enrichment as Record<string, unknown>)[key] = parsed[key]
      }
    }
    return Object.keys(out).length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

function nodeFromEdge(row: EdgeRow): GraphNode {
  const external = !row.symId
  return {
    id: row.symId || `ext:${row.extName || "unknown"}`,
    name: row.symName || row.extName || "unknown",
    symbolType: row.symType || (external ? "external" : "symbol"),
    file: row.fileRel || "",
    filePath: row.filePath || "",
    line: row.line || 0,
    lineEnd: row.lineEnd || 0,
    language: row.fileLang || "unknown",
    complexity: row.complexity || 0,
    isExternal: external,
  }
}

// Single bounded, ID-keyed graph traversal engine. Callers and callees each get
// an independent fan-out budget so one direction cannot starve the other.
export async function traverseGraph(
  projectId: ProjectID,
  root: SymbolRow,
  options: GraphTraversalOptions = {},
): Promise<{ callers: GraphEdge[]; callees: GraphEdge[]; nodes: Record<string, GraphNode>; truncated: boolean; truncationReason?: string; maxDepthReached: number }> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxDepth = Math.min(options.maxDepth || DEFAULT_MAX_DEPTH, 10)
  const relTypes = options.relationshipTypes?.length ? options.relationshipTypes : DEFAULT_REL_TYPES
  const relPlaceholders = relTypes.map(() => "?").join(",")

  const nodes: Record<string, GraphNode> = {}
  let truncated = false
  let truncationReason: string | undefined
  let maxDepthReached = 0

  const registerNode = (node: GraphNode) => {
    if (!nodes[node.id]) nodes[node.id] = node
  }
  registerNode({
    id: root.id,
    name: root.name,
    symbolType: root.symbolType,
    file: root.relativePath,
    filePath: root.filePath,
    line: root.line,
    lineEnd: root.lineEnd,
    language: root.language,
    complexity: root.complexity,
    isExternal: false,
  })

  // ---- callers ----
  const callers: GraphEdge[] = []
  const visitedCallers = new Set<string>()
  let callerBudget = options.callerBudget ?? DEFAULT_BUDGET

  const traceCallers = (symbolId: string, depth: number): void => {
    if (depth >= maxDepth || visitedCallers.has(symbolId)) return
    visitedCallers.add(symbolId)
    const { prefix, upper } = cascadeBounds(symbolId)
    const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
    const rows = raw.prepare(
      "SELECT r.id AS rowId, r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, " +
        "r.is_cross_language AS isCrossLang, r.bridge_mechanism AS bridge, r.metadata AS meta, " +
        "s.id AS symId, s.name AS symName, s.line_start AS line, s.line_end AS lineEnd, " +
        "s.complexity AS complexity, s.symbol_type AS symType, " +
        "f.relative_path AS fileRel, f.path AS filePath, f.language AS fileLang, " +
        "f.relative_path AS srcFileRel, NULL AS extName " +
        "FROM brain_relationship r " +
        "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
        "JOIN brain_file f ON f.id = s.file_id " +
        "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
        "AND r.target_symbol_id IN (" + cascade + ") LIMIT 200",
    ).all(projectId, ...relTypes, symbolId, prefix, upper, projectId) as EdgeRow[]

    const children: string[] = []
    for (const row of rows) {
      if (!row.symName || AnalysisExclusions.isNoiseSymbolName(row.symName)) continue
      if (row.fileRel && AnalysisExclusions.isHardNoisePath(row.fileRel)) continue
      if (options.includeCrossLanguage === false && row.isCrossLang) continue
      const node = nodeFromEdge(row)
      registerNode(node)
      callers.push({
        from: node.id,
        to: symbolId,
        relationshipType: row.relType,
        confidence: row.confidence ?? 0,
        isCrossLanguage: !!row.isCrossLang,
        bridgeMechanism: row.bridge || undefined,
        // M62.A2 (issue #876): the address owner decides what this position
        // IS. A stored line of 0 (the indexer's legacy literal) or NULL is
        // NOT a position — the calling symbol's declaration is only ever a
        // LABELED substitute, never silently presented as the call site.
        callSite: deriveCallSiteAddress({
          storedLine: row.lineNumber,
          file: row.srcFileRel || node.file,
          callerDeclaration: { line: node.line },
        }),
        depth,
        rowId: row.rowId,
        metadata: edgeMetadata(row.meta),
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push(row.symId)
    }

    for (const childId of children) {
      if (callerBudget <= 0) {
        truncated = true
        truncationReason = "caller-budget-exhausted"
        break
      }
      if (depth >= maxDepth - 1) break
      if (!visitedCallers.has(childId)) {
        callerBudget--
        traceCallers(childId, depth + 1)
      }
    }
  }

  // ---- callees ----
  const callees: GraphEdge[] = []
  const visitedCallees = new Set<string>()
  let calleeBudget = options.calleeBudget ?? DEFAULT_BUDGET

  const traceCallees = (symbolId: string, srcFileRel: string, srcLine: number, depth: number): void => {
    if (depth >= maxDepth || visitedCallees.has(symbolId)) return
    visitedCallees.add(symbolId)
    const isExternal = symbolId.startsWith("ext:")
    const { prefix, upper } = cascadeBounds(symbolId)
    const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"

    const selectCols =
      "SELECT r.id AS rowId, r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, " +
      "r.is_cross_language AS isCrossLang, r.bridge_mechanism AS bridge, r.metadata AS meta, " +
      "s.id AS symId, s.name AS symName, s.line_start AS line, s.line_end AS lineEnd, " +
      "s.complexity AS complexity, s.symbol_type AS symType, " +
      "f.relative_path AS fileRel, f.path AS filePath, f.language AS fileLang, " +
      "src.relative_path AS srcFileRel, r.target_external AS extName "

    let rows: EdgeRow[]
    if (isExternal) {
      rows = []
    } else {
      rows = raw.prepare(
        selectCols +
          "FROM brain_relationship r " +
          "JOIN brain_symbol s ON s.id = r.target_symbol_id AND s.project_id = r.project_id " +
          "JOIN brain_file f ON f.id = s.file_id " +
          "LEFT JOIN brain_symbol srcsym ON srcsym.id = r.source_symbol_id " +
          "LEFT JOIN brain_file src ON src.id = srcsym.file_id " +
          "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
          "AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id IN (" + cascade + ") " +
          "UNION ALL " +
          selectCols +
          "FROM brain_relationship r " +
          "LEFT JOIN brain_symbol s ON s.name = r.target_external AND s.project_id = r.project_id " +
          "LEFT JOIN brain_file f ON f.id = s.file_id " +
          "LEFT JOIN brain_symbol srcsym ON srcsym.id = r.source_symbol_id " +
          "LEFT JOIN brain_file src ON src.id = srcsym.file_id " +
          "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
          "AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.source_symbol_id IN (" + cascade + ") " +
          "LIMIT 200",
      ).all(
        projectId, ...relTypes, symbolId, prefix, upper, projectId,
        projectId, ...relTypes, symbolId, prefix, upper, projectId,
      ) as EdgeRow[]
    }

    const children: Array<{ id: string; file: string; line: number }> = []
    for (const row of rows) {
      const targetName = row.symName || row.extName || ""
      if (!targetName || AnalysisExclusions.isNoiseSymbolName(targetName)) continue
      if (row.fileRel && AnalysisExclusions.isHardNoisePath(row.fileRel)) continue
      if (options.includeCrossLanguage === false && row.isCrossLang) continue
      const node = nodeFromEdge(row)
      registerNode(node)
      callees.push({
        from: symbolId,
        to: node.id,
        relationshipType: row.relType,
        confidence: row.confidence ?? 0,
        isCrossLanguage: !!row.isCrossLang,
        bridgeMechanism: row.bridge || undefined,
        // M62.A2 (issue #876): same rule as the callers side — the calling
        // symbol's declaration (srcLine) is a labeled substitute only.
        callSite: deriveCallSiteAddress({
          storedLine: row.lineNumber,
          file: row.srcFileRel || srcFileRel,
          callerDeclaration: { line: srcLine },
        }),
        depth,
        rowId: row.rowId,
        metadata: edgeMetadata(row.meta),
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push({ id: row.symId, file: node.file, line: node.line })
      else if (row.extName) children.push({ id: `ext:${row.extName}`, file: node.file, line: node.line })
    }

    for (const child of children) {
      if (calleeBudget <= 0) {
        truncated = true
        truncationReason = "callee-budget-exhausted"
        break
      }
      if (depth >= maxDepth - 1) break
      if (!visitedCallees.has(child.id)) {
        calleeBudget--
        traceCallees(child.id, child.file, child.line, depth + 1)
      }
    }
  }

  if (options.direction !== "callees") traceCallers(root.id, 0)
  if (options.direction !== "callers") traceCallees(root.id, root.relativePath, root.line, 0)

  return { callers, callees, nodes, truncated, truncationReason, maxDepthReached }
}

// Resolve a symbol name to its highest-gravity match (exact, then fuzzy).
export async function resolveGraphRoot(projectId: ProjectID, name: string): Promise<SymbolRow | null> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const STRUCTURAL = "('function','method','class','interface','trait','struct','enum','macro')"
  const base =
    "SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.line_start,0) AS line, " +
    "COALESCE(s.line_end,0) AS lineEnd, f.relative_path AS relativePath, f.path AS filePath, " +
    "COALESCE(f.language,'unknown') AS language, COALESCE(s.complexity,0) AS complexity " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id " +
    "WHERE s.project_id = ? "
  // 1) exact name among the structural kinds the graph can traverse
  let rows = raw.prepare(base + `AND s.symbol_type IN ${STRUCTURAL} AND s.name = ? ORDER BY s.gravity_score DESC LIMIT 1`).all(projectId, name) as SymbolRow[]
  if (rows.length === 0) {
    // M48.C1 (#699) corpus catch: previously the fallback went STRAIGHT to a
    // fuzzy substring match, so a real exact-name symbol of a non-structural
    // kind (e.g. #define LANGUAGE_NAME in C) lost to an unrelated symbol
    // merely CONTAINING the string (a Makefile target lib$(LANGUAGE_NAME).a) —
    // bb_graph and bb_analyze then answered the same query with different
    // roots. Exact-name of ANY kind must win over fuzzy containment.
    rows = raw.prepare(base + "AND s.name = ? ORDER BY s.gravity_score DESC LIMIT 1").all(projectId, name) as SymbolRow[]
  }
  if (rows.length === 0) {
    // 3) documented near-miss fallback: fuzzy containment among structural kinds
    rows = raw.prepare(base + `AND s.symbol_type IN ${STRUCTURAL} AND s.name LIKE ? ORDER BY s.gravity_score DESC LIMIT 1`).all(projectId, `%${name}%`) as SymbolRow[]
  }
  return rows[0] ?? null
}

export async function graphTraversal(
  projectId: ProjectID,
  name: string,
  options: GraphTraversalOptions = {},
): Promise<GraphTraversalResult> {
  const root = await resolveGraphRoot(projectId, name)
  if (!root) throw new Error(`Symbol '${name}' not found`)
  const { callers, callees, nodes, truncated, truncationReason, maxDepthReached } = await traverseGraph(projectId, root, options)
  const rootNode = nodes[root.id]!
  const crossLanguageEdges = [...callers, ...callees].filter((e) => e.isCrossLanguage).length
  return {
    root: rootNode,
    callers,
    callees,
    nodes,
    provenance: makeProvenance({ evidenceClass: "inferred", engine: "graph@intelligence", engineVersion: "m10.02", projectId, source: "brain_relationship", limitations: ["Traversal is bounded and unresolved external nodes cannot be recursively traversed."], truncated }),
    summary: {
      totalCallers: callers.length,
      totalCallees: callees.length,
      maxDepthReached,
      crossLanguageEdges,
      truncated,
      truncationReason,
    },
  }
}
