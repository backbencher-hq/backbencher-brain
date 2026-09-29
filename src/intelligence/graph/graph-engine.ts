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
  /** The endpoint the OWNER CASCADE matched, not the symbol being traced.
   *  Equal to the traced symbol ⇒ the stored row names it exactly; different
   *  ⇒ the row names one of its members and the edge is attributed to the
   *  owner. This is the only way a reader can undo the cascade, and it was
   *  unrecoverable before: the `IN (cascade)` filter discarded it in SQL. */
  matchedId: string | null
  matchedName: string | null
  matchedFile: string | null
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

/**
 * How a stored row came to be an edge of the SYMBOL BEING TRACED.
 *
 *   "exact"          the row names the traced symbol itself
 *   "owner-cascade"  the row names one of its members (a method, a nested
 *                    symbol) and the edge is attributed to the owner
 *
 * The cascade is deliberate and documented, but until this field existed the
 * distinction was DESTROYED inside the SQL (`target_symbol_id IN (cascade)`
 * keeps the row or drops it and says nothing about which), so a reader could
 * not subtract cascade edges to recover the exact set. Measured consequence on
 * cobra: `Command` answers with 184 of 1,078 caller sites, only 24 of which
 * target `Command` itself — and all 184 were indistinguishable.
 */
type CascadeMatch = "exact" | "owner-cascade"

function cascadeMatch(row: EdgeRow, tracedId: string): CascadeMatch {
  return row.matchedId == null || row.matchedId === tracedId ? "exact" : "owner-cascade"
}

/** The member the row actually named, when the cascade (not the trace) matched. */
function matchedMember(row: EdgeRow, tracedId: string): { name: string; file: string } | undefined {
  if (row.matchedId == null || row.matchedId === tracedId) return undefined
  if (!row.matchedName) return undefined
  return { name: row.matchedName, file: row.matchedFile || "" }
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
  /** Caller edges that name the traced symbol exactly, vs. those the owner
   *  cascade attributed to it through one of its members. The cascade is a
   *  declared superset; these make it a REDUCIBLE one. */
  exactCallers: number
  cascadedCallers: number
  exactCallees: number
  cascadedCallees: number
  /** Edges at depth >= 1: about symbols DISCOVERED by the traversal, not
   *  about the root. exactCallers + cascadedCallers + deeperCallers is
   *  totalCallers. */
  deeperCallers: number
  deeperCallees: number
  /** The fan-out bounds in force (symbols expanded per direction) and whether
   *  each was exhausted. A bound that fires with no declared value is a bound
   *  a reader cannot reason about. */
  callerBudget: number
  calleeBudget: number
  callerBudgetExhausted: boolean
  calleeBudgetExhausted: boolean
  /** Stored rows that appear in the caller list AND the callee list. Each is
   *  one relationship seen from two ends, so the sum of the two totals
   *  overstates the distinct relationship count by exactly this much. */
  edgesInBothDirections: number
  /** M59 (#895): stored rows collapsed at the tool layer before becoming
   *  edges — cascadeRepeatsCollapsed: the same rowId re-fetched by a deeper
   *  cascade; spellingVariantsCollapsed: reserved for the #854 site-level
   *  collapse (0 until its identity key is pinned from stored data). */
  dedupedAtToolLayer: {
    cascadeRepeatsCollapsed: number
    spellingVariantsCollapsed: number
  }
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

  // ---- M59 (#895) edge dedupe -------------------------------------------
  // The owner-cascade re-queries the same stored row once per traced symbol
  // whose cascade contains its target (measured: one rowId emitted at depths
  // [0,2,3] — 72 callers built from 31 rows). One stored row must emit at
  // most ONE edge per direction: the FIRST traversal depth to reach it emits;
  // the edge's `depth` stays truthful to that traversal. The set is shared
  // across all depths of the direction; caps/budgets/limits are unaffected.
  // #854's same-site spelling rows (`Async` vs `cekernel.Async`) are DISTINCT
  // rowIds, so row-level dedupe cannot see them. They are collapsed by SITE:
  // same relationship type, same source symbol, same resolved target, same
  // file + line. Measured guard (cats-effect, probe-rel-identity): the site
  // key is applied ONLY to rows carrying a real call-site line — the NULL-line
  // groups the store shows (YAML `contains`, 15 distinct keypaths in one
  // group) are genuinely different sites that a NULL line cannot distinguish,
  // so they pass through untouched. Collapses are DECLARED:
  // `summary.dedupedAtToolLayer` reports both counts.
  const emittedCallerRows = new Set<string>()
  const emittedCallerSites = new Set<string>()
  const emittedCalleeRows = new Set<string>()
  const emittedCalleeSites = new Set<string>()
  let collapsedCascadeRepeats = 0
  let collapsedSpellingVariants = 0
  // The owner cascade is a deliberate SUPERSET: a call to `Command.Execute` is
  // reported as an edge of `Command`. Counting the two populations separately
  // is what lets a reader use that superset instead of being drowned by it.
  // Measured on cobra: `Command` returns 184 caller edges of which 24 name the
  // symbol itself — a ratio no per-edge field alone makes obvious.
  //
  // DEPTH 0 ONLY, and that restriction is the whole point. An edge found at
  // depth 2 is exact w.r.t. the symbol traced at depth 2, not w.r.t. the root;
  // rolling those into a root-named total produced a field that was simply
  // wrong (measured: rake's `Application` reported `exactCallers: 37` against 2
  // stored rows targeting `Application`). Edges one hop or more out are about
  // OTHER symbols and are counted as such.
  let exactCallers = 0
  let cascadedCallers = 0
  let exactCallees = 0
  let cascadedCallees = 0
  let deeperCallers = 0
  let deeperCallees = 0
  // Budget exhaustion is a bound like any other, and it used to fire with no
  // number anywhere in the payload. Declared, so a reader who sees
  // `caller-budget-exhausted` can learn what the bound was.
  let callerBudgetExhausted = false
  let calleeBudgetExhausted = false
  // Rows that legitimately appear in BOTH directions. The engine already knew
  // this — it holds one rowId set per direction and re-encounters a row when a
  // deeper cascade reaches it — but never reported it, so `totalCallers +
  // totalCallees` overstated the number of distinct relationships in the
  // answer by exactly this much.
  let edgesInBothDirections = 0

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
      "f.relative_path AS srcFileRel, NULL AS extName, " +
      "casc.id AS matchedId, mt.name AS matchedName, mf.relative_path AS matchedFile " +
      "FROM brain_relationship r " +
      "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
      "JOIN brain_file f ON f.id = s.file_id " +
      // A JOIN, not `target_symbol_id IN (cascade)`. The IN form filters
      // correctly but discards WHICH id matched, and that is the only thing
      // separating "someone calls Command" from "someone calls
      // Command.Execute, attributed to its owner". Binding order follows the
      // text, so the cascade's four parameters now precede the WHERE clause's.
      "JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id " +
      "LEFT JOIN brain_symbol mt ON mt.id = casc.id " +
      "LEFT JOIN brain_file mf ON mf.id = mt.file_id " +
      "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ")"
    const callerParams = [symbolId, prefix, upper, projectId, projectId, ...relTypes]
    // Deterministic order (M59.A12, #888 sibling of #885): a bare LIMIT on an
    // unordered query returned a DIFFERENT 200 rows per run, so two identical
    // questions could disagree. Stable order makes the bound reproducible.
    //
    // The cap is decided by asking for ONE ROW MORE than the limit, not by
    // comparing `rows.length >= edgeLimit` against a `LIMIT edgeLimit` query.
    // Those two are indistinguishable when the true count is exactly the limit:
    // the measured consequence on cobra (IsAdditionalHelpTopicCommand, 12
    // stored caller rows) was `edgeLimit: 12` returning all 12 rows WITH
    // `truncated: true, truncationReason: "caller-site-limit"` — a traversal
    // that dropped nothing declaring that it had dropped something, which is
    // the same class of lie the M59.A12 work existed to remove, one row later.
    // The extra row is never emitted: the first `edgeLimit` rows of a
    // deterministically ordered query are exactly the rows the old query
    // returned, so the visible answer is unchanged for every non-capped call.
    const fetched = raw
      .prepare(callerSql + " ORDER BY fileRel, lineNumber, rowId LIMIT ?")
      .all(...callerParams, edgeLimit + 1) as EdgeRow[]
    const capped = fetched.length > edgeLimit
    const rows = capped ? fetched.slice(0, edgeLimit) : fetched
    if (capped) {
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
      // M59 (#895): one stored row must emit at most one edge per direction —
      // the cascade re-queries it once per traced ancestor (measured depths
      // [0,2,3]). Row-level dedupe is exact: same rowId = same everything.
      if (emittedCallerRows.has(row.rowId)) {
        collapsedCascadeRepeats++
        continue
      }
      emittedCallerRows.add(row.rowId)
      // M59 (#854, consumer option): same call site + same resolved target,
      // different spelling → one edge, first spelling wins. Line-guarded:
      // a NULL line cannot prove two rows name one site.
      if (row.lineNumber != null && row.lineNumber > 0) {
        const siteKey = `${row.relType}|${row.symId ?? ""}|${symbolId}|${row.srcFileRel ?? ""}|${row.lineNumber}`
        if (emittedCallerSites.has(siteKey)) {
          collapsedSpellingVariants++
          continue
        }
        emittedCallerSites.add(siteKey)
      }
      if (depth > 0) deeperCallers++
      else if (cascadeMatch(row, symbolId) === "exact") exactCallers++
      else cascadedCallers++
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
        // Whether the stored row names the traced symbol or one of its
        // members. Without it, a class with 180 methods answers every caller
        // question as if all 180 methods were the class.
        targetMatch: cascadeMatch(row, symbolId),
        matchedMember: matchedMember(row, symbolId),
        metadata: edgeMetadata(row.meta),
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push(row.symId)
    }

    for (const childId of children) {
      if (callerBudget <= 0) {
        noteReason("caller-budget-exhausted")
        callerBudgetExhausted = true
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
      "src.relative_path AS srcFileRel, r.target_external AS extName, " +
      "casc.id AS matchedId, mt.name AS matchedName, mf.relative_path AS matchedFile "

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
          "JOIN (" + cascade + ") casc ON casc.id = r.source_symbol_id " +
          "LEFT JOIN brain_symbol mt ON mt.id = casc.id " +
          "LEFT JOIN brain_file mf ON mf.id = mt.file_id " +
          "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
          "AND r.target_symbol_id IS NOT NULL " +
          "UNION ALL " +
          selectCols +
          "FROM brain_relationship r " +
          "LEFT JOIN brain_symbol s ON s.name = r.target_external AND s.project_id = r.project_id " +
          "LEFT JOIN brain_file f ON f.id = s.file_id " +
          "LEFT JOIN brain_symbol srcsym ON srcsym.id = r.source_symbol_id " +
          "LEFT JOIN brain_file src ON src.id = srcsym.file_id " +
          "JOIN (" + cascade + ") casc ON casc.id = r.source_symbol_id " +
          "LEFT JOIN brain_symbol mt ON mt.id = casc.id " +
          "LEFT JOIN brain_file mf ON mf.id = mt.file_id " +
          "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
          "AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL"
      const calleeParams = [
        symbolId, prefix, upper, projectId, projectId, ...relTypes,
        symbolId, prefix, upper, projectId, projectId, ...relTypes,
      ]
      const calleeOrder = " ORDER BY fileRel, lineNumber, rowId"
      // Same one-row-over rule as the callers side: `LIMIT edgeLimit` cannot
      // tell "exactly at the limit" from "over it", and a compound query needs
      // the probe row just as much as a simple one.
      const fetched = raw.prepare(calleeSql + calleeOrder + " LIMIT ?").all(...calleeParams, edgeLimit + 1) as EdgeRow[]
      const capped = fetched.length > edgeLimit
      rows = capped ? fetched.slice(0, edgeLimit) : fetched
      if (capped) {
        cappedQueries++
        noteReason(depth === 0 ? "callee-site-limit" : "callee-site-limit-at-depth")
        if (depth === 0 && totalCalleesIfKnown === null) {
          totalCalleesIfKnown = countSurviving(calleeSql + calleeOrder, calleeParams, (r) => r.symName || r.extName)
        }
      }
    }

    const children: Array<{ id: string; file: string; line: number }> = []
    for (const row of rows) {
      const targetName = row.symName || row.extName || ""
      if (!targetName || AnalysisExclusions.isNoiseSymbolName(targetName)) continue
      if (row.fileRel && AnalysisExclusions.isHardNoisePath(row.fileRel)) continue
      if (options.includeCrossLanguage === false && row.isCrossLang) continue
      // M59 (#895): same stored row must not emit once per cascade depth.
      if (emittedCalleeRows.has(row.rowId)) {
        collapsedCascadeRepeats++
        continue
      }
      emittedCalleeRows.add(row.rowId)
      // M59 (#854, consumer option): same-site spelling collapse, as in callers.
      if (row.lineNumber != null && row.lineNumber > 0) {
        const calleeKey = `${row.relType}|${symbolId}|${row.symId ?? `ext:${row.extName ?? ""}`}|${row.srcFileRel ?? ""}|${row.lineNumber}`
        if (emittedCalleeSites.has(calleeKey)) {
          collapsedSpellingVariants++
          continue
        }
        emittedCalleeSites.add(calleeKey)
      }
      if (depth > 0) deeperCallees++
      else if (cascadeMatch(row, symbolId) === "exact") exactCallees++
      else cascadedCallees++
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
        sourceMatch: cascadeMatch(row, symbolId),
        matchedMember: matchedMember(row, symbolId),
        metadata: edgeMetadata(row.meta),
      })
      maxDepthReached = Math.max(maxDepthReached, depth)
      if (row.symId) children.push({ id: row.symId, file: node.file, line: node.line })
      else if (row.extName) children.push({ id: `ext:${row.extName}`, file: node.file, line: node.line })
    }

    for (const child of children) {
      if (calleeBudget <= 0) {
        noteReason("callee-budget-exhausted")
        calleeBudgetExhausted = true
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

  // A stored row is one fact; being an incoming AND an outgoing edge of the
  // same family does not make it two. Counted from the emitted edges rather
  // than from the rowId sets, because the sets also absorb cross-depth repeats
  // that never became a second edge.
  for (const edge of callers) {
    if (emittedCalleeRows.has(edge.rowId)) edgesInBothDirections++
  }

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
    exactCallers,
    cascadedCallers,
    exactCallees,
    cascadedCallees,
    deeperCallers,
    deeperCallees,
    callerBudget: options.callerBudget ?? DEFAULT_BUDGET,
    calleeBudget: options.calleeBudget ?? DEFAULT_BUDGET,
    callerBudgetExhausted,
    calleeBudgetExhausted,
    edgesInBothDirections,
    dedupedAtToolLayer: {
      cascadeRepeatsCollapsed: collapsedCascadeRepeats,
      spellingVariantsCollapsed: collapsedSpellingVariants,
    },
  }
}

// Resolve a symbol name to its highest-gravity match (exact, then fuzzy).
export async function resolveGraphRootDetailed(
  projectId: ProjectID,
  name: string,
): Promise<{ root: SymbolRow | null; candidates: number }> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const STRUCTURAL = "('function','method','class','interface','trait','struct','enum','macro')"
  const base =
    "SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.line_start,0) AS line, " +
    "COALESCE(s.line_end,0) AS lineEnd, f.relative_path AS relativePath, f.path AS filePath, " +
    "COALESCE(f.language,'unknown') AS language, COALESCE(s.complexity,0) AS complexity " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id " +
    "WHERE s.project_id = ? "
  // Every ranking is a TOTAL order. `ORDER BY gravity_score DESC LIMIT 1` alone
  // leaves the winner undefined when two same-named symbols tie on gravity, and
  // SQLite is free to return either one — the answer would then depend on the
  // page layout, not on the question. `s.id` is the primary key, so appending it
  // makes the pick a function of the data alone. (Measured ambiguity in real
  // corpora is not hypothetical: cobra indexes 50 structural symbols all named
  // `code_block.go`.)
  const RANK = " ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1"
  // The three steps, as data. Which one produced the winning row is carried
  // with it rather than inferred afterwards, because recounting the wrong
  // population would describe a step that never ran.
  const exactStructural = base + `AND s.symbol_type IN ${STRUCTURAL} AND s.name = ?`
  const exactAnyKind = base + "AND s.name = ?"
  const fuzzyStructural = base + `AND s.symbol_type IN ${STRUCTURAL} AND s.name LIKE ? ESCAPE '\\'`

  // 1) exact name among the structural kinds the graph can traverse
  let predicate = exactStructural
  let param = name
  let rows = raw.prepare(exactStructural + RANK).all(projectId, name) as SymbolRow[]
  if (rows.length === 0) {
    // M48.C1 (#699) corpus catch: previously the fallback went STRAIGHT to a
    // fuzzy substring match, so a real exact-name symbol of a non-structural
    // kind (e.g. #define LANGUAGE_NAME in C) lost to an unrelated symbol
    // merely CONTAINING the string (a Makefile target lib$(LANGUAGE_NAME).a) —
    // bb_graph and bb_analyze then answered the same query with different
    // roots. Exact-name of ANY kind must win over fuzzy containment.
    rows = raw.prepare(exactAnyKind + RANK).all(projectId, name) as SymbolRow[]
    predicate = exactAnyKind
    param = name
  }
  if (rows.length === 0) {
    // 3) documented near-miss fallback: fuzzy containment among structural kinds.
    //
    // The caller's string becomes a LIKE PATTERN, so `%`, `_` and the escape
    // character itself are metacharacters that silently widen the search.
    // Unescaped, `bb_graph({symbol: "%"})` matched every symbol in the project
    // and returned a confident graph rooted at an unrelated symbol (measured on
    // cobra: asked for "%", rooted at `Command`) — the tool answered a question
    // nobody asked, with nothing in the payload saying so. `likeContains`
    // neutralises the metacharacters by value (not by deleting them from the
    // name) and pins the escape character so SQLite cannot re-interpret it.
    const pattern = likeContains(name)
    rows = raw.prepare(fuzzyStructural + RANK).all(projectId, pattern) as SymbolRow[]
    predicate = fuzzyStructural
    param = pattern
  }
  const root = rows[0] ?? null
  if (!root) return { root: null, candidates: 0 }
  // How many stored symbols the winning step had to choose between, counted
  // with that step's own predicate and parameter.
  const countRow = raw.prepare("SELECT COUNT(*) c FROM (" + predicate + ")").get(projectId, param) as any
  return { root, candidates: Math.max(1, Number(countRow?.c ?? 1)) }
}

/**
 * Build a `LIKE '%needle%'` pattern in which the needle matches itself and
 * nothing else. `%` and `_` are LIKE wildcards; `\` is SQLite's LIKE escape
 * character, so a literal backslash in a name must become two. This is
 * character-wise escaping — there is no pattern here to get wrong.
 */
export function likeContains(needle: string): string {
  let escaped = ""
  for (const ch of needle) {
    if (ch === "\\" || ch === "%" || ch === "_") escaped += "\\" + ch
    else escaped += ch
  }
  return `%${escaped}%`
}

/** The single-symbol form, unchanged for existing callers. */
export async function resolveGraphRoot(projectId: ProjectID, name: string): Promise<SymbolRow | null> {
  return (await resolveGraphRootDetailed(projectId, name)).root
}

export async function graphTraversal(
  projectId: ProjectID,
  name: string,
  options: GraphTraversalOptions = {},
): Promise<GraphTraversalResult> {
  const { root, candidates } = await resolveGraphRootDetailed(projectId, name)
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
    exactCallers,
    cascadedCallers,
    exactCallees,
    cascadedCallees,
    deeperCallers,
    deeperCallees,
    callerBudget,
    calleeBudget,
    callerBudgetExhausted,
    calleeBudgetExhausted,
    edgesInBothDirections,
    dedupedAtToolLayer,
  } = await traverseGraph(projectId, root, options)
  const rootNode = nodes[root.id]!
  const crossLanguageEdges = [...callers, ...callees].filter((e) => e.isCrossLanguage).length
  return {
    root: rootNode,
    rootCandidates: candidates,
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
      // The owner cascade is a superset by design. These four numbers are how
      // much of it is about the symbol that was actually asked for. An agent
      // that sees `totalCallers: 184, exactCallers: 24` knows at once that the
      // answer is mostly about the symbol's members — which no count above this
      // line would ever have told it.
      exactCallers,
      cascadedCallers,
      exactCallees,
      cascadedCallees,
      deeperCallers,
      deeperCallees,
      // The fan-out bound, and whether it bit. `truncationReason` can name
      // `caller-budget-exhausted`; before this it did so without saying what
      // the budget was, so the bound was announced and never quantified.
      callerBudget,
      calleeBudget,
      callerBudgetExhausted,
      calleeBudgetExhausted,
      // Rows present in BOTH callers and callees. `totalCallers + totalCallees`
      // counts each of these twice, and the number above is the correction.
      edgesInBothDirections,
      // M59 (#895, #854): what the tool layer collapsed before handing edges
      // to the agent. cascadeRepeatsCollapsed: the same stored row re-fetched
      // by a deeper cascade. spellingVariantsCollapsed: same call site + same
      // resolved target stored under different spellings, emitted once.
      dedupedAtToolLayer,
    },
  }
}
