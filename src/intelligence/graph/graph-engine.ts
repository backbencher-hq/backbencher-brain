import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { GraphEdge, GraphNode, GraphTraversalOptions, GraphTraversalResult } from "../contracts"
import { makeProvenance } from "../evidence"

type EdgeMetadata = NonNullable<GraphEdge["metadata"]>

const DEFAULT_REL_TYPES = ["calls", "instantiates", "extends", "implements"]
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_BUDGET = 50

/**
 * M59.A12 (#888): the per-symbol site limit for one edge query.
 *
 * This bound always existed (a bare `LIMIT 200`), but it was INVISIBLE: a symbol
 * with 3,437 call sites answered 200 rows with `truncated: false`, so a caller
 * could not tell a complete answer from a 6% sample. A bound is fine; an
 * undeclared bound is not. When this limit is reached the traversal now declares
 * truncation, names the limit, and reports the true total whenever it is
 * computable (the root symbol's own site count) — never a floor presented as a
 * total. Overridable up to MAX_EDGE_QUERY_LIMIT so a caller can ask for more
 * instead of guessing.
 */
const DEFAULT_EDGE_QUERY_LIMIT = 200
const MAX_EDGE_QUERY_LIMIT = 5000
/** Ceiling for the declared-total counting scan: past this the total is a
 *  declared lower bound rather than a silent one. Only reached when a cap was
 *  hit, so the normal path pays nothing. */
const MAX_TOTAL_COUNT_SCAN = 50_000

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
): Promise<{
  callers: GraphEdge[]
  callees: GraphEdge[]
  nodes: Record<string, GraphNode>
  truncated: boolean
  truncationReason?: string
  maxDepthReached: number
  /** M59.A12 (#888): the declared per-query site limit in force for this run. */
  edgeLimit: number
  /** How many edge queries hit that limit (a query can hit it at any depth). */
  cappedQueries: number
  /** True site count of the ROOT symbol, counted with the same query and the
   *  same noise filters. Present only when a cap was reached and the count was
   *  computable; `null` means "not counted", never zero. */
  totalCallersIfKnown: number | null
  totalCalleesIfKnown: number | null
  /** The count is a lower bound because the counting scan itself is bounded. */
  totalsAreLowerBounds: boolean
}> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const maxDepth = Math.min(options.maxDepth || DEFAULT_MAX_DEPTH, 10)
  const relTypes = options.relationshipTypes?.length ? options.relationshipTypes : DEFAULT_REL_TYPES
  const relPlaceholders = relTypes.map(() => "?").join(",")
  const edgeLimit = Math.max(1, Math.min(Math.floor(options.edgeLimit ?? DEFAULT_EDGE_QUERY_LIMIT), MAX_EDGE_QUERY_LIMIT))

  const nodes: Record<string, GraphNode> = {}
  let truncated = false
  // M59.A12: every bound that fires contributes its own name — a cap AND a budget
  // are both true at once, so joining them beats letting the last one win.
  const reasons = new Set<string>()
  const noteReason = (reason: string) => {
    reasons.add(reason)
    truncated = true
  }
  let maxDepthReached = 0
  let cappedQueries = 0
  let totalCallersIfKnown: number | null = null
  let totalCalleesIfKnown: number | null = null
  let totalsAreLowerBounds = false

  /** The same noise filters the edge loops apply, so a declared total counts
   *  exactly what a caller WOULD receive if no limit existed. */
  const survivesFilters = (row: EdgeRow, name: string | null, includeCrossLanguage: boolean): boolean => {
    if (!name || AnalysisExclusions.isNoiseSymbolName(name)) return false
    if (row.fileRel && AnalysisExclusions.isHardNoisePath(row.fileRel)) return false
    if (includeCrossLanguage === false && row.isCrossLang) return false
    return true
  }
  const includeCrossLanguage = options.includeCrossLanguage !== false

  /** Count what the uncapped query would return, bounded by a scan ceiling. */
  const countSurviving = (sqlWithoutLimit: string, params: unknown[], nameOf: (row: EdgeRow) => string | null): number => {
    let total = 0
    const scanned = raw.prepare(sqlWithoutLimit + " LIMIT ?").all(...params, MAX_TOTAL_COUNT_SCAN) as EdgeRow[]
    for (const row of scanned) {
      if (survivesFilters(row, nameOf(row), includeCrossLanguage)) total++
    }
    if (total >= MAX_TOTAL_COUNT_SCAN) totalsAreLowerBounds = true
    return total
  }

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
    const callerSql =
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
      "AND r.target_symbol_id IN (" + cascade + ")"
    const callerParams = [projectId, ...relTypes, symbolId, prefix, upper, projectId]
    // Deterministic order (M59.A12, #888 sibling of #885): a bare LIMIT on an
    // unordered query returned a DIFFERENT 200 rows per run, so two identical
    // questions could disagree. Stable order makes the bound reproducible.
    const rows = raw
      .prepare(callerSql + " ORDER BY fileRel, lineNumber, rowId LIMIT ?")
      .all(...callerParams, edgeLimit) as EdgeRow[]
    if (rows.length >= edgeLimit) {
      cappedQueries++
      noteReason(depth === 0 ? "caller-site-limit" : "caller-site-limit-at-depth")
      // The root's true total is the number an agent actually asks for, and it
      // is countable in one bounded scan. Deeper symbols report the cap itself
      // (cappedQueries) rather than a total nobody could cheaply compute.
      if (depth === 0 && totalCallersIfKnown === null) {
        totalCallersIfKnown = countSurviving(callerSql + " ORDER BY fileRel, lineNumber, rowId", callerParams, (r) => r.symName)
      }
    }

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
        // M59.O4 (#823): a DB-unknown line stays null — the previous
        // `|| node.line` substituted the symbol's DECLARATION line for the
        // call site, which is how bb_graph invented lines 189,499 times.
        callSite: { file: row.srcFileRel || node.file, line: row.lineNumber && row.lineNumber > 0 ? row.lineNumber : null },
        depth,
        rowId: row.rowId,
        metadata: edgeMetadata(row.meta),
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push(row.symId)
    }

    for (const childId of children) {
      if (callerBudget <= 0) {
        noteReason("caller-budget-exhausted")
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
      const calleeSql =
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
          "AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL AND r.source_symbol_id IN (" + cascade + ")"
      const calleeParams = [
        projectId, ...relTypes, symbolId, prefix, upper, projectId,
        projectId, ...relTypes, symbolId, prefix, upper, projectId,
      ]
      const calleeOrder = " ORDER BY fileRel, lineNumber, rowId"
      rows = raw.prepare(calleeSql + calleeOrder + " LIMIT ?").all(...calleeParams, edgeLimit) as EdgeRow[]
      if (rows.length >= edgeLimit) {
        cappedQueries++
        noteReason(depth === 0 ? "callee-site-limit" : "callee-site-limit-at-depth")
        if (depth === 0 && totalCalleesIfKnown === null) {
          totalCalleesIfKnown = countSurviving(calleeSql + calleeOrder, calleeParams, (r) => r.symName || r.extName)
        }
      }
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
        // M59.O4 (#823): `|| 0` reported "unknown" as line 0 — equally
        // fabricated. null means the analyzer could not derive a line.
        callSite: { file: row.srcFileRel || srcFileRel, line: row.lineNumber && row.lineNumber > 0 ? row.lineNumber : null },
        depth,
        rowId: row.rowId,
        metadata: edgeMetadata(row.meta),
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push({ id: row.symId, file: node.file })
      else if (row.extName) children.push({ id: `ext:${row.extName}`, file: node.file })
    }

    for (const child of children) {
      if (calleeBudget <= 0) {
        noteReason("callee-budget-exhausted")
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

  return {
    callers,
    callees,
    nodes,
    truncated,
    truncationReason: reasons.size > 0 ? [...reasons].join("+") : undefined,
    maxDepthReached,
    edgeLimit,
    cappedQueries,
    totalCallersIfKnown,
    totalCalleesIfKnown,
    totalsAreLowerBounds,
  }
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
  const {
    callers,
    callees,
    nodes,
    truncated,
    truncationReason,
    maxDepthReached,
    edgeLimit,
    cappedQueries,
    totalCallersIfKnown,
    totalCalleesIfKnown,
    totalsAreLowerBounds,
  } = await traverseGraph(projectId, root, options)
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
      // M59.A12 (#888): `totalCallers`/`totalCallees` above are the RETURNED
      // counts. These fields say so explicitly and add the true root count when
      // a cap was hit and it was computable — a floor can no longer be read as a
      // total by a caller that only looks at the summary.
      edgeLimit,
      cappedQueries,
      callersIfUncapped: totalCallersIfKnown,
      calleesIfUncapped: totalCalleesIfKnown,
      totalsAreLowerBounds,
    },
  }
}
