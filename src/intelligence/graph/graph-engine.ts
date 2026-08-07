import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { GraphEdge, GraphNode, GraphTraversalOptions, GraphTraversalResult } from "../contracts"

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
  lineNumber: number | null
  relType: string
  confidence: number
  isCrossLang: number | null
  bridge: string | null
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

function cascadeBounds(symbolId: string): { prefix: string; upper: string } {
  const prefix = symbolId.includes(":") ? symbolId.slice(0, symbolId.lastIndexOf(":") + 1) : ""
  return { prefix, upper: prefix + ";" }
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
      "SELECT r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, " +
        "r.is_cross_language AS isCrossLang, r.bridge_mechanism AS bridge, " +
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
        callSite: { file: row.srcFileRel || node.file, line: row.lineNumber || node.line },
        depth,
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

  const traceCallees = (symbolId: string, srcFileRel: string, depth: number): void => {
    if (depth >= maxDepth || visitedCallees.has(symbolId)) return
    visitedCallees.add(symbolId)
    const isExternal = symbolId.startsWith("ext:")
    const { prefix, upper } = cascadeBounds(symbolId)
    const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"

    const selectCols =
      "SELECT r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, " +
      "r.is_cross_language AS isCrossLang, r.bridge_mechanism AS bridge, " +
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

    const children: Array<{ id: string; file: string }> = []
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
        callSite: { file: row.srcFileRel || srcFileRel, line: row.lineNumber || 0 },
        depth,
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push({ id: row.symId, file: node.file })
      else if (row.extName) children.push({ id: `ext:${row.extName}`, file: node.file })
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
        traceCallees(child.id, child.file, depth + 1)
      }
    }
  }

  if (options.direction !== "callees") traceCallers(root.id, 0)
  if (options.direction !== "callers") traceCallees(root.id, root.relativePath, 0)

  return { callers, callees, nodes, truncated, truncationReason, maxDepthReached }
}

// Resolve a symbol name to its highest-gravity match (exact, then fuzzy).
export async function resolveGraphRoot(projectId: ProjectID, name: string): Promise<SymbolRow | null> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const cols =
    "SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.line_start,0) AS line, " +
    "COALESCE(s.line_end,0) AS lineEnd, f.relative_path AS relativePath, f.path AS filePath, " +
    "COALESCE(f.language,'unknown') AS language, COALESCE(s.complexity,0) AS complexity " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id " +
    "WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','trait','struct','enum','macro') "
  let rows = raw.prepare(cols + "AND s.name = ? ORDER BY s.gravity_score DESC LIMIT 1").all(projectId, name) as SymbolRow[]
  if (rows.length === 0) {
    rows = raw.prepare(cols + "AND s.name LIKE ? ORDER BY s.gravity_score DESC LIMIT 1").all(projectId, `%${name}%`) as SymbolRow[]
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
