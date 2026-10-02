import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { GraphEdge, GraphNode, GraphTraversalOptions, GraphTraversalResult } from "../contracts"
import { makeProvenance } from "../evidence"
import { deriveCallSiteAddress } from "./line-address"

type EdgeMetadata = NonNullable<GraphEdge["metadata"]>

/**
 * Every value of `ASTEngine.RelationshipType`. This list is the DEFAULT filter,
 * and it used to be four of them.
 *
 * The old default was `["calls","instantiates","extends","implements"]`, and it
 * was UNDECLARED — the traversal's `reasons` set reported caps and budgets but
 * not this, so a caller could not tell a filtered answer from a complete one.
 * That is the same failure the M59.A12 note above already forbids in a different
 * guise ("a bound is fine; an undeclared bound is not"), and the number is not
 * small. Measured on 1,200 real Ruby files, 101,017 emitted relationships:
 *
 *     calls        73.6%
 *     contains     10.7%   <- the parent -> member edge
 *     overrides     5.4%
 *     uses          5.0%
 *     references    1.2%
 *     … 22.2% of every emitted relationship was excluded before the query ran.
 *
 * `contains` is the one that does structural damage rather than just thinning:
 * it is the parent -> member edge, so under the old default a traversal from a
 * class could not reach that class's own methods.
 *
 * It also disagreed with the repository's TWO other graph paths, which both
 * return everything when no filter is given — `src/ast/graph.ts`
 * (`relationshipTypes: Object.values(RelationshipType)`) and
 * `visualization-engine.ts` (`!request.relationshipTypes?.length || …`). Three
 * paths, three default policies, and two of them disagreed with each other, so
 * the same question about the same project had two different answers depending
 * on which tool asked. Aligning on "no filter unless asked" makes all three
 * agree, and a caller who wants a subset still passes one.
 *
 * Kept as a literal rather than imported from `ast/engine` to keep this module
 * free of an import cycle, and it must be kept in step with the enum — which is
 * why the value list is spelled out in full instead of a partial subset.
 */
const DEFAULT_REL_TYPES = [
  "calls", "extends", "implements", "uses", "instantiates", "overrides",
  "contains", "references", "imports", "exports",
]
/** Records an ACTIVE caller-supplied type filter in the result's reason set, so a
 * filtered traversal is never mistaken for a complete one. The default is NOT
 * recorded: with the default now covering every type, there is nothing to
 * disclose. */
function noteRelationshipFilter(note: (reason: string) => void, relTypes: string[]): void {
  note(`relationshipTypes:${[...relTypes].sort().join("|")}`)
}

const DEFAULT_MAX_DEPTH = 5
const DEFAULT_BUDGET = 50

/**
 * Wall-clock budget for one walk, in milliseconds.
 *
 * The other bounds on a traversal are in NODES, and a node is not a unit of
 * work. Measured on backbencher-brain/src (7,196 symbols, 40,557
 * relationships): the caller query for `push` matches 2,436 stored rows, and
 * the `ORDER BY f.relative_path, r.line_number, r.id` that makes the answer
 * reproducible (M59.A12) costs 85.8 ms of the 87.8 ms — a 43x multiplier over
 * the same query without it. SQLite sorts BEFORE applying the LIMIT, so the
 * per-query `edgeLimit` of 200 does not bound it. At a 50-node budget that is
 * ~4.4 s for one symbol, and the recursion multiplies it: measured
 * `bb_analyze mode=callers target=push` at 417 ms on a warm cache and over
 * 25 s cold, and `mode=trace target=push` at 613 SECONDS.
 *
 * So a bound that is declared but does not bound is the defect. This one
 * does: when the clock runs out the walk stops and says so through
 * `truncationReason: "walk-time-budget-exhausted"`, which is the same contract
 * every other bound here obeys. A caller who needs the whole set raises
 * `timeBudgetMs` (or lowers the fan-in they are asking about) and can see that
 * they did.
 */
const DEFAULT_WALK_TIME_BUDGET_MS = 2_000

/**
 * Which relationship kinds survive a cap first, and why.
 *
 * The cap's ORDER BY used to be `fileRel, lineNumber, rowId` — stable, but
 * indifferent to KIND. When DEFAULT_REL_TYPES was four kinds that did not
 * matter; now that it is all ten it does, because every kind competes for the
 * same slots and the survivor set becomes a function of the target's file
 * rather than of the graph. Measured on lodash's `baseConvert`:
 *
 *     relationshipTypes: ["calls"]  ->  99 edges, all calls
 *     default (all ten kinds)       -> 230 edges, of which 71 are calls
 *
 * Asking for more returned fewer calls. That is the wrong direction for a tool
 * whose question is "what depends on this", and it was invisible: the payload
 * said nothing about which kinds had lost.
 *
 * The order below is a statement about what an edge MEANS, not about
 * importance. `calls`, `instantiates`, `extends`, `implements` and `overrides`
 * are dependencies between two symbols. `contains` is membership, `uses` and
 * `references` are lexical, `imports` and `exports` are module-level. When a
 * bound forces a choice, it should fall on the dependency side.
 *
 * KINDS NOT LISTED sort last but are still returned — this is a cap ordering,
 * not a filter. `relTypes` is what filters; nothing here hides anything.
 *
 * The prefix keeps the order a strict TOTAL order (kind, then file, then line,
 * then rowId), so two identical questions still produce identical answers.
 */
const EDGE_KIND_PRIORITY: Record<string, number> = {
  calls: 0,
  instantiates: 1,
  extends: 2,
  implements: 3,
  overrides: 4,
  uses: 5,
  references: 6,
  imports: 7,
  exports: 8,
  contains: 9,
}
const UNRANKED_KIND_ORDER = 100

/**
 * The rank expression, PROJECTED under the alias `kindRank`.
 *
 * It has to be projected rather than written inline in the ORDER BY. The
 * callee query is a compound select (`... UNION ALL ...`), and for those SQLite
 * restricts ORDER BY to output column names, integer literals and parameters —
 * an arbitrary expression is refused outright, with
 * "1st ORDER BY term does not match any column in the result set". The caller
 * query is a simple select and would have taken it inline, but both project it
 * so there is one ordering expression in the module rather than two.
 */
const KIND_RANK_SQL =
  // `r.relationship_type`, not `relType`: the CASE is evaluated against the
  // FROM tables, and an output alias is not in scope there. Inside a compound
  // select that is a hard error — "no such column: relType" — which the corpus
  // suite found before any reasoning about it would have.
  "CASE r.relationship_type " +
  Object.entries(EDGE_KIND_PRIORITY)
    .map(([kind, rank]) => `WHEN '${kind}' THEN ${rank}`)
    .join(" ") +
  ` ELSE ${UNRANKED_KIND_ORDER} END AS kindRank `

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

/**
 * The bound on the SIZE OF THE ANSWER, as distinct from the bound on one query.
 *
 * `edgeLimit` bounds a single edge query and the fan-out budgets bound how many
 * symbols are expanded, but nothing bounded their PRODUCT — so the nominal
 * ceiling was 50 x 200 x 2 = 20,000 edges, and a caller asking "who calls
 * unwrap" at the default depth could be handed half a megabyte with nothing in
 * the payload to predict it. Measured: ripgrep's `unwrap` returns 206 edges at
 * depth 1, 454 at depth 3 and 702 at depth 5 — 228 KiB, 504 KiB and 770 KiB
 * rendered.
 *
 * Both existing bounds are declared, so this was never a silent lie; but a
 * declared pair whose product is unbounded is not a bound, and the reader has to
 * do the multiplication themselves to find that out.
 *
 * The default sits comfortably above what an ordinary question produces (about
 * 450 edges for a hub symbol at the default depth) and stops the explosion. A
 * caller who wants more asks for more.
 */
const DEFAULT_MAX_TOTAL_EDGES = 1000
const MAX_TOTAL_EDGES = 5000
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
/**
 * Compiled-statement cache, keyed on the connection and then on the SQL text.
 *
 * A traversal's SQL depends only on (relationshipTypes, edgeLimit) — the traced
 * symbol, the project, the cascade bounds and the cap are all BOUND, never
 * interpolated — so every symbol in a walk re-compiles a byte-identical
 * statement. Measured on the pinned tree: 84–132 compilations per call across
 * only 11–12 distinct statements, the busiest text compiled 52 times per call
 * (`fixtures/bb_graph/suites/27-statement-cost.ts`).
 *
 * Keyed on the connection so that a closed database and its statements are
 * collected together, and so a pooled replacement never inherits a dead
 * statement. Safe to share because every call site is `prepare(...).all(...)` in
 * one synchronous expression with no `await` in between, so a statement cannot
 * be re-entered on a single event loop.
 */
const STATEMENT_CACHE = new WeakMap<object, Map<string, unknown>>()

function prepared(db: unknown, sql: string): { all: (...params: unknown[]) => unknown[] } {
  let cache = STATEMENT_CACHE.get(db as object)
  if (!cache) {
    cache = new Map()
    STATEMENT_CACHE.set(db as object, cache)
  }
  let statement = cache.get(sql)
  if (!statement) {
    statement = (db as { prepare: (s: string) => unknown }).prepare(sql)
    cache.set(sql, statement)
  }
  return statement as { all: (...params: unknown[]) => unknown[] }
}

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
  /** The depth cap this run enforced. Paired with `maxDepthReached` it is the
   *  only way a reader can tell "the walk finished" from "the walk stopped". */
  maxDepth: number
  /** The wall-clock budget this walk ran under, and whether it stopped on it.
   *  A node is not a unit of work — see DEFAULT_WALK_TIME_BUDGET_MS — so the
   *  time bound is the one that actually bounds a pathological target, and it
   *  is declared on both sides: what it was, and whether it fired. */
  timeBudgetMs: number
  timeBudgetExhausted: boolean
  /** Stored rows the noise policy removed, per direction. See the public
   *  `GraphTraversalResult.noiseFiltered` for why this is not a bound. */
  noiseFiltered: { callers: number; callees: number }
  /** M59.A12 (#888): the declared per-query site limit in force for this run. */
  edgeLimit: number
  /** The total-edge bound in force for this run, and whether it was reached.
   *  Distinct from `edgeLimit`, which bounds ONE query: this bounds the answer. */
  maxEdges: number
  totalEdgeLimitReached: boolean
  /** How many edge queries hit that limit (a query can hit it at any depth). */
  cappedQueries: number
  /** True site count of the ROOT symbol, counted with the same query and the
   *  same noise filters. Present only when a cap was reached and the count was
   *  computable; `null` means "not counted", never zero. */
  totalCallersIfKnown: number | null
  totalCalleesIfKnown: number | null
  /** The count is a lower bound because the counting scan itself is bounded. */
  totalsAreLowerBounds: boolean
  /** DEPTH 0 ONLY. Caller edges that name the traced symbol exactly, vs. those
   *  the owner cascade attributed to it through one of its members. The cascade
   *  is a declared superset; these make it a REDUCIBLE one.
   *
   *  The depth-0 restriction is load-bearing, not pedantry: an edge found at
   *  depth 2 is exact w.r.t. the symbol traced at depth 2, not w.r.t. the root,
   *  and folding those in here produced a field that was simply wrong — measured
   *  on rake, `exactCallers: 37` against 2 stored rows targeting the root. */
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
  /** Composition of the RETURNED edges by stored relationship kind. Counted
   *  from the emitted edges, so it describes what the caller received after
   *  cascade attribution, overlap and the cap — not what was queried. */
  edgesByType: Record<string, number>
  /** The cap's kind ordering, declared: which kinds survive a bound first.
   *  Only observable when `truncated` is true, but published always so the rule
   *  is not something a reader has to find in the engine's SQL. */
  edgeKindPriority: string[]
  /** The relationship kinds this run ACTUALLY searched — the resolved list,
   *  not a restatement of the default. Measured: the handler's scope echo used
   *  to name four kinds while the answer contained 120 `uses` and 11
   *  `contains` edges, because it carried its own hardcoded copy of a default
   *  that lives in this module and had been widened. A scope field is only
   *  useful if it is true. */
  relationshipTypesUsed: string[]
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
  // Clamped at BOTH ends, and the lower clamp is the one that matters.
  // `Math.min(options.maxDepth || DEFAULT, 10)` leaves a negative depth intact,
  // and `depth >= maxDepth` is then true at depth 0 — so a caller passing
  // `maxDepth: -1` got zero edges, `truncated: false` and `maxDepthReached: 0`:
  // an empty answer presented as a complete one. bb_graph's own handler rejects
  // `maxDepth < 1` so the tool cannot reach it, but `graphTraversal` is the
  // shared engine behind bb_impact, the test-intelligence suggestions and the
  // LSP graph panel, and a trap that is unreachable from one door is still a
  // trap for the other three.
  const maxDepth = Math.max(1, Math.min(Math.floor(options.maxDepth || DEFAULT_MAX_DEPTH), 10))
  const relTypes = options.relationshipTypes?.length ? options.relationshipTypes : DEFAULT_REL_TYPES
  // DECLARE the filter, whether it is the caller's or the default. Every other
  // bound this function applies reports itself through `reasons`, and a caller
  // reading a traversal result has no other way to know that a type was excluded
  // before the answer was computed.
  const callerFiltered = !!options.relationshipTypes?.length
  const relPlaceholders = relTypes.map(() => "?").join(",")
  const edgeLimit = Math.max(1, Math.min(Math.floor(options.edgeLimit ?? DEFAULT_EDGE_QUERY_LIMIT), MAX_EDGE_QUERY_LIMIT))
  const maxEdges = Math.max(
    edgeLimit,
    Math.min(Math.floor(options.maxEdges ?? DEFAULT_MAX_TOTAL_EDGES), MAX_TOTAL_EDGES),
  )
  // Set once the answer is full, and consulted before every further emit, so the
  // traversal stops rather than continuing to expand symbols whose edges can no
  // longer be returned.
  let totalLimitReached = false

  // The cap orderings, over the projected `kindRank`. The trailing keys make
  // each a strict TOTAL order, which is what makes two identical questions
  // produce identical answers: a cap that returned a different 200 rows per run
  // would make every count in the summary a sample of something arbitrary.
  const CALLER_ORDER = "kindRank, fileRel, lineNumber, rowId"
  const CALLEE_ORDER = "kindRank, fileRel, lineNumber, rowId"

  const nodes: Record<string, GraphNode> = {}
  let truncated = false
  // M59.A12: every bound that fires contributes its own name — a cap AND a budget
  // are both true at once, so joining them beats letting the last one win.
  const reasons = new Set<string>()
  const noteReason = (reason: string) => {
    reasons.add(reason)
    truncated = true
  }
  // Armed once, at the top of the walk, and read before every descent. The
  // root query itself is not interruptible (SQLite would have to be), so the
  // floor on a single call is one query — measured at 88 ms on the corpus that
  // produced the 613 s figure, and 2 ms on a small one.
  const timeBudgetMs = Math.max(0, Math.floor(options.timeBudgetMs ?? DEFAULT_WALK_TIME_BUDGET_MS))
  const deadline = Date.now() + timeBudgetMs
  let timeBudgetExhausted = false
  const outOfTime = (): boolean => timeBudgetMs > 0 && Date.now() >= deadline
  // An ACTIVE filter is a declared subset, so it goes through `noteReason` rather
  // than straight into the set. Adding the reason alone would produce
  // `truncated: false` beside a `truncationReason`, which is worse than either
  // state on its own: a consumer that reads the boolean gets "complete" and a
  // consumer that reads the string gets "filtered", and they disagree.
  if (callerFiltered) noteRelationshipFilter(noteReason, relTypes)
  let maxDepthReached = 0
  let cappedQueries = 0
  let totalCallersIfKnown: number | null = null
  let totalCalleesIfKnown: number | null = null
  let totalsAreLowerBounds = false

  /** The same noise filters the edge loops apply, so a declared total counts
   *  exactly what a caller WOULD receive if no limit existed. */
  // Rows the noise policy removed, counted per direction.
  //
  // The walk has always dropped vendored/generated/fixture paths and noise
  // symbol names inline with `continue`, and said nothing. The answer then read
  // as complete: measured, `callers` for a symbol in `vendor/` answered
  // `found: true` with 0 caller and 0 callee edges and `truncated: false` —
  // "nobody uses this, and that is the whole set", for a set that was emptied
  // by a policy rather than measured to be empty. `bb_search` already declares
  // this ("scan was cut short (noise-filter) over some candidate rows"); the
  // graph did not.
  //
  // This is deliberately NOT a truncation reason. A bound means the walk stopped
  // early; a filter means it finished and removed rows by policy. Reporting the
  // second as the first would make `truncated` mean two different things, which
  // is the defect this whole review exists to remove.
  let noiseFilteredCallers = 0
  let noiseFilteredCallees = 0

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
    const scanned = prepared(raw, sqlWithoutLimit + " LIMIT ?").all(...params, MAX_TOTAL_COUNT_SCAN) as EdgeRow[]
    for (const row of scanned) {
      if (survivesFilters(row, nameOf(row), includeCrossLanguage)) total++
    }
    if (total >= MAX_TOTAL_COUNT_SCAN) totalsAreLowerBounds = true
    return total
  }

  // The cascade member's name and file, resolved for the rows that SURVIVED the
  // cap rather than joined for every row the cap discarded.
  //
  // Measured: the two joins these replace cost 14,267 ms of a 19,753 ms capped
  // caller query on scala3 — 72% of the statement — and `matchedMember` returns
  // `undefined` for every exact match, so nearly all of that was discarded work.
  // The ids are memoised for the traversal because a member recurs across edges.
  const matchedIdentities = new Map<string, { name: string; file: string }>()

  const attachMatchedIdentities = (rows: EdgeRow[], tracedId: string): void => {
    const wanted: string[] = []
    for (const row of rows) {
      const id = row.matchedId
      if (id == null || id === tracedId || matchedIdentities.has(id)) continue
      if (!wanted.includes(id)) wanted.push(id)
    }
    if (wanted.length === 0) return
    // Chunked so a long edge list cannot exceed SQLite's bound-variable limit.
    for (let i = 0; i < wanted.length; i += 400) {
      const chunk = wanted.slice(i, i + 400)
      const got = prepared(
        raw,
        "SELECT s.id AS id, s.name AS name, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (" +
          chunk.map(() => "?").join(",") +
          ")",
      ).all(...chunk) as Array<{ id: string; name: string; file: string | null }>
      for (const g of got) matchedIdentities.set(g.id, { name: g.name, file: g.file || "" })
    }
    for (const row of rows) {
      const id = row.matchedId
      if (id == null) continue
      const hit = matchedIdentities.get(id)
      // An id that is not a symbol leaves the field unset, exactly as the
      // `LEFT JOIN brain_symbol mt` it replaces would have.
      if (hit) {
        row.matchedName = hit.name
        row.matchedFile = hit.file
      }
    }
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
    if (outOfTime()) {
      timeBudgetExhausted = true
      noteReason("walk-time-budget-exhausted")
      return
    }
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
      "casc.id AS matchedId, " +
      KIND_RANK_SQL +
      "FROM brain_relationship r " +
      "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
      "JOIN brain_file f ON f.id = s.file_id " +
      // A JOIN, not `target_symbol_id IN (cascade)`. The IN form filters
      // correctly but discards WHICH id matched, and that is the only thing
      // separating "someone calls Command" from "someone calls
      // Command.Execute, attributed to its owner". Binding order follows the
      // text, so the cascade's four parameters now precede the WHERE clause's.
      "JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id " +
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
    const fetched = prepared(raw, callerSql + " ORDER BY " + CALLER_ORDER + " LIMIT ?").all(
      ...callerParams,
      edgeLimit + 1,
    ) as EdgeRow[]
    const capped = fetched.length > edgeLimit
    const rows = capped ? fetched.slice(0, edgeLimit) : fetched
    attachMatchedIdentities(rows, symbolId)
    if (capped) {
      cappedQueries++
      noteReason(depth === 0 ? "caller-site-limit" : "caller-site-limit-at-depth")
      // The root's true total is the number an agent actually asks for, and it
      // is countable in one bounded scan. Deeper symbols report the cap itself
      // (cappedQueries) rather than a total nobody could cheaply compute.
      if (depth === 0 && totalCallersIfKnown === null) {
        // Same ordering as the capped query, so the declared total and the
        // returned rows are computed over one list rather than two.
        totalCallersIfKnown = countSurviving(callerSql + " ORDER BY " + CALLER_ORDER, callerParams, (r) => r.symName)
      }
    }

    const children: string[] = []
    for (const row of rows) {
      if (!row.symName || AnalysisExclusions.isNoiseSymbolName(row.symName)) { noiseFilteredCallers++; continue }
      if (row.fileRel && AnalysisExclusions.isHardNoisePath(row.fileRel)) { noiseFilteredCallers++; continue }
      if (options.includeCrossLanguage === false && row.isCrossLang) continue
      // The bound on the WHOLE answer, as distinct from the per-query site
      // limit. Checked BEFORE any bookkeeping for this row, so `emittedCallerRows`
      // means "emitted" and does not claim a row the bound then discarded — the
      // two orderings happen to behave the same today because the loop breaks
      // either way, and "happens to" is not a property worth depending on.
      if (callers.length + callees.length >= maxEdges) {
        totalLimitReached = true
        noteReason("total-edge-limit")
        break
      }
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
      // Order matters. The VISITED test comes first, because a child that has
      // already been expanded needs no budget; the previous order ended the loop
      // on the first already-visited child it met once the budget ran out.
      if (visitedCallers.has(childId)) continue
      if (callerBudget <= 0) {
        // A bound that fires with nothing left to do is not a truncation. The
        // depth cap below already asks whether work remains; the budget did not,
        // so it declared exhaustion on answers that skipped nothing — the two
        // bounds disagreed about what "exhausted" means, and `truncated: true`
        // was set for a traversal that lost no edges.
        if (children.some((c) => !visitedCallers.has(c))) {
          noteReason("caller-budget-exhausted")
          callerBudgetExhausted = true
        }
        break
      }
      if (depth >= maxDepth - 1) {
        // A bound that fires with work still queued is a truncation. The depth
        // cap used to break out silently, so a 14-hop chain answered with the
        // first 3 hops and `truncated: false` — a 23% sample presented as the
        // whole set, which is the same lie as the budget directly above and
        // exactly what this field exists to prevent.
        if (children.some((c) => !visitedCallers.has(c))) noteReason("caller-depth-cap-reached")
        break
      }
      callerBudget--
      traceCallers(childId, depth + 1)
    }
  }

  // ---- callees ----
  const callees: GraphEdge[] = []
  const visitedCallees = new Set<string>()
  let calleeBudget = options.calleeBudget ?? DEFAULT_BUDGET

  const traceCallees = (symbolId: string, srcFileRel: string, srcLine: number, depth: number): void => {
    if (depth >= maxDepth || visitedCallees.has(symbolId)) return
    if (outOfTime()) {
      timeBudgetExhausted = true
      noteReason("walk-time-budget-exhausted")
      return
    }
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
      "casc.id AS matchedId, " +
      KIND_RANK_SQL

    // The same shape with the TARGET-symbol columns as literal NULLs.
    //
    // These nine columns describe the resolved target, and in the unresolved arm
    // there is no target — so they are constants. They used to be produced by
    // `LEFT JOIN brain_symbol s ON 0` / `LEFT JOIN brain_file f ON 0`, which
    // keeps the column count right and costs a nested-loop join per row. SQLite
    // cannot flatten a compound whose arm contains a join it cannot eliminate,
    // so the arm lost the `brain_rel_proj_type_target_idx` it was eligible for
    // and read ALL 52,597 relationship rows of the project.
    //
    // Measured on backbencher-brain/src: ONE statement took 24-29 seconds —
    // `bb_analyze mode=callees target=push` did not answer in 30 s, for a
    // symbol with 23 callees, and `mode:callees` on a symbol with 6 callees did
    // not answer either. A wall-clock budget cannot interrupt a single SQL
    // statement, so this was the floor under the whole walk.
    const selectColsUnresolved =
      "SELECT r.id AS rowId, r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, " +
      "r.is_cross_language AS isCrossLang, r.bridge_mechanism AS bridge, r.metadata AS meta, " +
      "NULL AS symId, NULL AS symName, NULL AS line, NULL AS lineEnd, " +
      "NULL AS complexity, NULL AS symType, " +
      "NULL AS fileRel, NULL AS filePath, NULL AS fileLang, " +
      "src.relative_path AS srcFileRel, r.target_external AS extName, " +
      "casc.id AS matchedId, " +
      KIND_RANK_SQL

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
          "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
          "AND r.target_symbol_id IS NOT NULL " +
          "UNION ALL " +
          // The UNRESOLVED arm. `target_symbol_id IS NULL` is the store saying
          // it could not resolve this target, and `target_external` is the NAME
          // it saw — not an identity.
          //
          // This arm used to JOIN brain_symbol back on that name, which turned
          // the admission into a claim. Measured on real corpora, the name it
          // joined on is not even close to unique: vscode fans a single stored
          // row out to 37,876 internal symbols for the name `match`, svelte to
          // 437,570 for `end`. The tool then emitted those as edges — asked
          // about typescript's `pseudoTypeEquivalentToType` it reported 27
          // internal callees, the first of them `isErrorType` in a different
          // file, when the stored row names `getTypeOfSymbol`. No such
          // relationship exists.
          //
          // Three harms, one JOIN: fabricated edges; the 200-row cap consumed
          // entirely by fan-out so real callees never appear (and
          // `calleesIfUncapped` reporting the inflated number); and
          // `children.push` recursing into the arbitrary match, contaminating
          // everything downstream.
          //
          // An unresolved target is therefore reported as the `ext:<name>` node
          // this contract already documents for it. The name is kept — it is
          // the node's name — so nothing is lost; it is simply labelled for
          // what it is.
          selectColsUnresolved +
          "FROM brain_relationship r " +
          // No target-symbol join at all: there is no target symbol, so the
          // target columns come from `selectColsUnresolved` as literal NULLs.
          // They used to be `LEFT JOIN … ON 0` against the resolved select
          // list — same columns, one nested-loop join per row, and SQLite could
          // not flatten the arm, so the arm read every relationship row in the
          // project instead of using `brain_rel_proj_type_target_idx`.
          "LEFT JOIN brain_symbol srcsym ON srcsym.id = r.source_symbol_id " +
          "LEFT JOIN brain_file src ON src.id = srcsym.file_id " +
          "JOIN (" + cascade + ") casc ON casc.id = r.source_symbol_id " +
          "WHERE r.project_id = ? AND r.relationship_type IN (" + relPlaceholders + ") " +
          "AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL"
      const calleeParams = [
        symbolId, prefix, upper, projectId, projectId, ...relTypes,
        symbolId, prefix, upper, projectId, projectId, ...relTypes,
      ]
      const calleeOrder = " ORDER BY " + CALLEE_ORDER
      // Same one-row-over rule as the callers side: `LIMIT edgeLimit` cannot
      // tell "exactly at the limit" from "over it", and a compound query needs
      // the probe row just as much as a simple one.
      const fetched = prepared(raw, calleeSql + calleeOrder + " LIMIT ?").all(...calleeParams, edgeLimit + 1) as EdgeRow[]
      const capped = fetched.length > edgeLimit
      rows = capped ? fetched.slice(0, edgeLimit) : fetched
      attachMatchedIdentities(rows, symbolId)
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
      if (!targetName || AnalysisExclusions.isNoiseSymbolName(targetName)) { noiseFilteredCallees++; continue }
      if (row.fileRel && AnalysisExclusions.isHardNoisePath(row.fileRel)) { noiseFilteredCallees++; continue }
      if (options.includeCrossLanguage === false && row.isCrossLang) continue
      // Before the dedupe bookkeeping, for the same reason as the callers side:
      // the emitted-row set must describe what was emitted.
      if (callers.length + callees.length >= maxEdges) {
        totalLimitReached = true
        noteReason("total-edge-limit")
        break
      }
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
      // Only a real symbol is worth walking into. An `ext:` node has no stored
      // relationships of its own, and `traceCallees` already refuses it; the
      // push existed only so the visited-set could absorb it, and with the
      // name-join gone nothing resolves an external to anything walkable.
      if (row.symId) children.push({ id: row.symId, file: node.file, line: node.line })
    }

    for (const child of children) {
      // Same rule as the callers side: an already-visited child needs no budget,
      // and a bound only counts as a truncation when work is actually left. The
      // depth cap below already asked that question; the budget did not, so the
      // two bounds disagreed about what "exhausted" means.
      if (visitedCallees.has(child.id)) continue
      if (calleeBudget <= 0) {
        if (children.some((c) => !visitedCallees.has(c.id))) {
          noteReason("callee-budget-exhausted")
          calleeBudgetExhausted = true
        }
        break
      }
      if (depth >= maxDepth - 1) {
        if (children.some((c) => !visitedCallees.has(c.id))) noteReason("callee-depth-cap-reached")
        break
      }
      calleeBudget--
      traceCallees(child.id, child.file, child.line, depth + 1)
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

  // What the answer is made of, counted from the EMITTED edges rather than from
  // the query. With ten kinds in the default filter, a reader otherwise has to
  // walk every edge to learn how many are calls — and the walk is per-call
  // work an agent will not always do.
  const edgesByType: Record<string, number> = {}
  for (const edge of [...callers, ...callees]) {
    edgesByType[edge.relationshipType] = (edgesByType[edge.relationshipType] ?? 0) + 1
  }

  return {
    callers,
    callees,
    nodes,
    truncated,
    truncationReason: reasons.size > 0 ? [...reasons].join("+") : undefined,
    maxDepthReached,
    maxDepth,
    timeBudgetMs,
    timeBudgetExhausted,
    noiseFiltered: { callers: noiseFilteredCallers, callees: noiseFilteredCallees },
    edgeLimit,
    maxEdges,
    totalEdgeLimitReached: totalLimitReached,
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
    edgesByType,
    edgeKindPriority: [...Object.keys(EDGE_KIND_PRIORITY)],
    relationshipTypesUsed: relTypes,
    dedupedAtToolLayer: {
      cascadeRepeatsCollapsed: collapsedCascadeRepeats,
      spellingVariantsCollapsed: collapsedSpellingVariants,
    },
  }
}

/**
 * How the root symbol was found, from most to least specific.
 *
 * `found: true` used to mean only "a root was found", which is not the same
 * claim. The third step is a documented near-miss fallback — fuzzy CONTAINMENT
 * among structural kinds — and its result was indistinguishable from a hit in
 * the payload. Measured on the atlas corpus: `target: "ub"` answered
 * `found: true` with root `hub`, and `target: "_"` answered `found: true` with
 * root `build_registry` (no symbol is named `_`). An agent asking "who calls
 * `ub`?" got a confident answer about a different symbol and nothing saying so.
 *
 * `containment` is also how a CASE difference is resolved, which is not a near
 * miss at all and must not read like one: the exact step is `name = ?`
 * (case-sensitive) while the fallback is `LIKE '%…%'`, and SQLite's LIKE is
 * case-insensitive for ASCII. So `target: "HUB"` finds `hub` by containment.
 * Declaring the step makes both facts visible in one field.
 */
export type RootMatch = "exact" | "exact-any-kind" | "containment"

// Resolve a symbol name to its highest-gravity match (exact, then fuzzy).
//
// The winning step is returned, not just its row. `candidates` says how many
// the step chose between; `match` says what the step WAS. A caller that reports
// `found: true` without reporting this reports half the answer.
export async function resolveGraphRootDetailed(
  projectId: ProjectID,
  name: string,
):
  // A discriminated union, so a caller that has a root also has a `match`
  // without an assertion. The two are set together and are not independent:
  // `match: null` means "no root", and a root without a step never happens.
  | Promise<
      | { root: null; candidates: 0; match: null }
      | { root: SymbolRow; candidates: number; match: RootMatch }
    > {
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
  // Set alongside `predicate`, so what is REPORTED cannot drift from what RAN.
  let match: RootMatch = "exact"

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
    match = "exact-any-kind"
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
    match = "containment"
  }
  const root = rows[0] ?? null
  if (!root) return { root: null, candidates: 0, match: null }
  // How many stored symbols the winning step had to choose between, counted
  // with that step's own predicate and parameter.
  const countRow = raw.prepare("SELECT COUNT(*) c FROM (" + predicate + ")").get(projectId, param) as any
  return { root, candidates: Math.max(1, Number(countRow?.c ?? 1)), match }
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
  const { root, candidates, match } = await resolveGraphRootDetailed(projectId, name)
  if (!root) throw new Error(`Symbol '${name}' not found`)
  const {
    callers,
    callees,
    nodes,
    truncated,
    truncationReason,
    maxDepthReached,
    maxDepth,
    timeBudgetMs,
    timeBudgetExhausted,
    noiseFiltered,
    edgeLimit,
    maxEdges,
    totalEdgeLimitReached: totalLimitReached,
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
    edgesByType,
    edgeKindPriority,
    relationshipTypesUsed,
    dedupedAtToolLayer,
  } = await traverseGraph(projectId, root, options)
  const rootNode = nodes[root.id]!
  const crossLanguageEdges = [...callers, ...callees].filter((e) => e.isCrossLanguage).length
  return {
    root: rootNode,
    rootCandidates: candidates,
    // WHICH step found the root, beside the root itself. Without this a
    // containment match is indistinguishable from the symbol that was asked
    // for, and the whole answer is confidently about the wrong symbol.
    rootMatch: match,
    callers,
    callees,
    nodes,
    provenance: makeProvenance({
      evidenceClass: "inferred",
      engine: "graph@intelligence",
      engineVersion: "m10.02",
      projectId,
      source: "brain_relationship",
      limitations: ["Traversal is bounded and unresolved external nodes cannot be recursively traversed."],
      truncated,
      unknowns: [
        ...(noiseFiltered.callers + noiseFiltered.callees > 0
          ? [`noise-policy: ${noiseFiltered.callers} caller and ${noiseFiltered.callees} callee stored rows were removed because they live in a vendored, generated, fixture, snapshot, dist or build path, or carry a generated name. They are excluded by POLICY, not absent: an empty edge set here does not mean nothing references this symbol. Applies to bb_search, bb_impact and the test-intelligence modes too, and NOT to mode "complexity", which applies no noise filter — so the same symbol can be unmeasurable there and unmentioned here.`]
          : []),
      ],
    }),
    summary: {
      totalCallers: callers.length,
      totalCallees: callees.length,
      maxDepthReached,
      maxDepth,
      timeBudgetMs,
      timeBudgetExhausted,
      // How many stored rows the vendored/generated/fixture/noise policy removed
      // before any bound applied. Non-zero means the edge sets above are
      // smaller than the store's, BY POLICY — not because nothing was found.
      noiseFiltered,
      crossLanguageEdges,
      truncated,
      truncationReason,
      // M59.A12 (#888): `totalCallers`/`totalCallees` above are the RETURNED
      // counts. These fields say so explicitly and add the true root count when
      // a cap was hit and it was computable — a floor can no longer be read as a
      // total by a caller that only looks at the summary.
      edgeLimit,
      // The bound on the WHOLE answer, as distinct from the per-query site
      // limit. Declared because the product of the per-query bound and the
      // fan-out budget is otherwise unbounded, and unstated.
      maxEdges,
      totalEdgeLimitReached: totalLimitReached,
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
      // What the answer is made of. With ten kinds in the default filter, a
      // caller that wanted calls had no way to find out how many of the
      // returned edges were calls without walking all of them.
      edgesByType,
      // The kinds this run actually searched, resolved — not a restatement of
      // the default. The handler's scope echo carried its own hardcoded copy
      // and went stale the moment the default was widened, so it named four
      // kinds while the answer held `uses` and `contains` edges.
      relationshipTypesUsed,
      // Which kinds survive a bound first. Only observable under truncation,
      // but published always: the cap's ORDER BY used to be indifferent to
      // kind, so asking for MORE kinds returned FEWER call edges (measured on
      // lodash: 99 calls alone, 71 inside the 230-edge default answer). The
      // rule that decides that is now declared here.
      edgeKindPriority,
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
