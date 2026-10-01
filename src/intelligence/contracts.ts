import type { ProjectID } from "../project/schema"
import type { EvidenceProvenance } from "./evidence"

export interface SourceRange {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
}

export interface ParameterInfo {
  name: string
  type?: string
  defaultValue?: string
  isOptional: boolean
}

export interface FunctionInfo {
  id: string
  name: string
  filePath: string
  relativePath: string
  language: string
  scope?: string
  visibility?: string
  isStatic: boolean
  isAsync: boolean
  isAbstract: boolean
  parameters?: ParameterInfo[]
  returnType?: string
  decorators?: string[]
  comments?: string[]
  range: SourceRange
  byteStart?: number | null
  byteEnd?: number | null
  complexity: number
  callers?: FunctionInfo[]
  callees?: FunctionInfo[]
  metadata: Record<string, unknown>
  snippet?: string
}

export interface SearchOptions {
  mode?: "symbols" | "content" | "regex"
  languages?: string[]
  symbolKind?: string
  includeContent?: boolean
  includeComments?: boolean
  exact?: boolean
  caseSensitive?: boolean
  regex?: boolean
  maxResults?: number
  offset?: number
}

export interface SearchResult {
  file: string
  fileId: string
  line: number
  column: number
  context: string
  symbolName?: string
  symbolType?: string
  language: string
  matchType: "symbol" | "content" | "comment"
  snippet: string
  complexity: number
  stale?: boolean
  _relevance: number
}

export type SearchResults = SearchResult[] & {
  staleCount?: number
  freshCount?: number
  searchMode?: string
  truncated?: boolean
  /**
   * Size of the ranked MATCH SET the page was cut from — not the size of the
   * returned page. `results.length` is the page; a caller that used it as the
   * total could not tell one match from fifteen, and a truncated page read as a
   * complete one. 0 when not computed.
   */
  totalMatches?: number
  /**
   * How many of the matched rows were actually RANKED and can therefore be
   * paged through. Equal to `totalMatches` in the normal case; smaller when a
   * cap stopped the ranking. A caller paging to the end needs both numbers: the
   * first says how much matched, the second says how much of it is reachable.
   */
  rankedMatches?: number
  /**
   * How much of the searchable corpus has a symbol BODY to search.
   *
   * Content search matches name, qualified_name, docstring and body. The body
   * column arrived after databases were indexed, so a project indexed before it
   * has none — and a search over such a project silently misses every word
   * that appears only inside a function. This ratio is what lets a caller tell
   * "nothing matched" from "nothing could match", which are opposite facts.
   */
  bodyCoverage?: { withBody: number; symbols: number; ratio: number }
  /**
   * Which route produced this result set.
   *
   * `phrase` means the query appeared verbatim in the name, qualified name,
   * docstring or body. `terms` means nothing matched verbatim and the query's
   * individual content words were matched instead. These are different claims:
   * a phrase hit says the code contains this text, a terms hit says it
   * discusses these words. Reported so a caller can weaken its confidence
   * accordingly instead of presenting a keyword coincidence as a quotation.
   */
  matchMode?: "phrase" | "terms"
  /**
   * Which of the query's content words the BEST result actually matched, and
   * which it ignored.
   *
   * Present only on the terms route, because that is the only route where the
   * two differ in kind. A match on 1 of 3 query words is a different claim from
   * 3 of 3: the same symbol would match any query sharing that one word, so
   * presenting it as "closest matches" without saying so invites reading a
   * coincidence as a finding. The words are named rather than counted because a
   * count alone does not tell a reader WHICH word carried the match.
   *
   * Measured on rake: requiring full coverage to present a result would discard
   * 9 of 11 answerable questions to reject 2 of 7 inapplicable ones, so this is
   * disclosed to the answer rather than used as a filter.
   */
  termMatch?: { queryTerms: string[]; topMatched: string[] }
  /**
   * How many candidate rows the scan actually looked at. Present so a bounded
   * answer can say "stopped after N of M" rather than only "stopped", and
   * absent when the scan completed.
   */
  scannedRows?: number
  /**
   * Why the candidate set is smaller than the raw match set, when it is: a
   * per-phase candidate cap was reached, the noise filter removed rows after
   * the cap, or (regex mode) the row cap or the time budget stopped the scan.
   * Absent means the candidate set is believed complete.
   */
  truncationReason?: string
  /**
   * Freshness could not be resolved (the resolver threw). The answer is still
   * returned and the counts keep their conservative default, but this flag
   * exists so `staleCount: 0` is never read as "everything is fresh" when the
   * check did not run.
   */
  freshnessError?: boolean
}

export interface CallGraphEntry {
  function: FunctionInfo
  callSite: CallSiteAddress
  depth: number
  enrichment?: unknown
  _v?: string
}

export interface TraceOptions {
  direction?: "callers" | "callees" | "both"
  maxDepth?: number
  includeCrossLanguage?: boolean
  relationshipTypes?: string[]
}

export interface TraceResult {
  function: FunctionInfo
  callGraph: {
    callers: CallGraphEntry[]
    callees: CallGraphEntry[]
  }
  summary: {
    totalCallers: number
    totalCallees: number
    maxDepth: number
    crossLanguageCalls: number
  }
}

export interface ProjectStats {
  files: number
  /** Sums brain_file.line_count — NON-BLANK lines, not physical lines. */
  linesOfCode: number
  avgFileSize: number
  /** The unit `avgFileSize` is measured in. */
  avgFileSizeUnit: string
  symbols: number
  /** How many of `symbols` carry a complexity measurement. `avgComplexity` is
   *  a SQL AVG, which skips nulls, so its denominator is exactly this number. */
  symbolsWithComplexity: number
  avgComplexity: number
  /** Every stored relationship row, whatever its type. */
  relationships: number
  /** The subset of `relationships` that is an actual dependency edge. */
  callEdges: number
  /** Which relationship types `callEdges` counted — `exports` and `contains`
   *  are index bookkeeping and are excluded. */
  couplingRelationshipTypes: string[]
  /** brain_file.is_test_file=1. Depends on the indexer's classifier, so a
   *  project whose tests are not recognisable counts as having none. */
  testFiles: number
  productionFiles: number
  /** Per-language file/line/symbol counts, largest first. A file with no
   *  recorded language is reported as "unknown" rather than dropped. */
  languages: Array<{ language: string; files: number; linesOfCode: number; symbols: number }>
  projectId: string
  provenance: EvidenceProvenance
}

// Semantic search contracts

export interface SemanticSearchOptions {
  similarityThreshold?: number
  maxResults?: number
  filePath?: string
  languages?: string[]
  symbolKind?: string
}

export interface SemanticResult {
  entityId: string
  symbolName: string
  symbolType: string
  file: string
  line: number
  snippet: string
  /**
   * Cosine similarity, or null when none was computed. Null is meaningful and
   * is NOT the same as 0: the keyword-fallback path produces lexical matches
   * with no score at all, and reporting 0 made callers print and average a
   * number the engine had explicitly labelled meaningless.
   */
  similarity: number | null
  language: string
  /** True when the source file changed on disk since indexing — must never be presented as current. */
  stale?: boolean
}

export interface SemanticSearchResults {
  results: SemanticResult[]
  provenance: EvidenceProvenance
  metadata: {
    queryModel: string      // Model that produced the query vector
    indexModel: string       // Model of the retrieved embeddings
    method: "vector" | "keyword-fallback"
    dimension: number
    scannedRows: number
    filteredRows: number
    /**
     * Why the dense path was abandoned. `degenerate-query-vector` is distinct
     * from `no-vector-above-threshold` on purpose: the first means nothing was
     * compared at all because the query could not be embedded, the second means
     * vectors were compared and none cleared the threshold. Collapsing them
     * sends the reader to re-embed a corpus that was embedded correctly.
     */
    fallbackReason?: string
    /** Indexable symbols vs symbols that actually have a stored embedding. */
    indexSymbolCount: number
    embeddedSymbolCount: number
    /** 0..1, embeddedSymbolCount / indexSymbolCount. 1 when nothing is indexed. */
    embeddingCoverage: number
    /**
     * Whether the ranking can tell its top results from one another. False when
     * several stored vectors score within the engine's discrimination margin of
     * the best one, which in a 50-dimensional hashed bag-of-words happens often:
     * the score then orders by an accident of body length rather than by
     * anything about the query, and printing it as a similarity makes noise look
     * measured. Optional — a producer that does not compute it omits the field
     * rather than reporting a guess.
     */
    discriminative?: boolean
    /** How many other candidates scored within the margin of the best. */
    nonDiscriminativeCompetitors?: number
    /**
     * Which of the query's content words the best keyword-fallback result
     * matched, and which it ignored. Present only when the fallback used the
     * terms route.
     *
     * It exists because the answer text lists code blocks, and a reader cannot
     * otherwise tell a match on every word they used from a match on one common
     * one. On rake, "where is the request handled" returns five code blocks that
     * matched the single word `request` — in a GitHub Actions file, in a
     * repository with no request handling at all.
     */
    termMatch?: { queryTerms: string[]; topMatched: string[] }
  }
}

// Graph traversal contracts

/** M62.A1 (issue #875): where an edge's source-side position comes from, and
 *  what may be shown as a result. This replaces the old
 *  `callSite: { file: string; line: number }`, which made "unknown"
 *  unrepresentable and let `line: row.lineNumber || node.line` present the
 *  calling symbol's declaration as the call site (see
 *  `src/intelligence/graph/line-address.ts`, the single owner).
 *
 *  - `call-site`   the stored `brain_relationship.line_number` was REAL
 *                  (`> 0`, 1-based). This is the only kind that may be rendered
 *                  as a bare `file:line`.
 *  - `declaration` the stored line was unknown; the calling symbol's own
 *                  declaration is shown INSTEAD, always with `note`.
 *  - `unknown`     no position is known and none may be shown. `line` is null
 *                  — never 0, never clamped to 1. `note` says why.
 *
 *  `file` is the calling symbol's relative path, or "" when the store names
 *  none (declared, never invented). */
export type CallSiteAddress =
  | { kind: "call-site"; file: string; line: number }
  | { kind: "declaration"; file: string; line: number; note: string }
  | { kind: "unknown"; file: string; line: null; note: string }

export interface GraphNode {
  id: string                 // symbol id, or "ext:<name>" for unresolved externals
  name: string
  symbolType: string
  file: string               // relative path ("" for pure externals)
  filePath: string
  line: number
  lineEnd: number
  language: string
  complexity: number
  isExternal: boolean
}

export interface GraphEdge {
  from: string               // source node id
  to: string                 // target node id
  relationshipType: string
  confidence: number
  isCrossLanguage: boolean
  bridgeMechanism?: string
  callSite: CallSiteAddress // source-side location of the edge (M62.A1)
  depth: number
  /** brain_relationship row id. Every edge traces to its stored row
   *  (M26.W2 evidence requirement); an edge without one must never be
   *  emitted, never rendered. */
  rowId: string
  /** Callers: whether the stored row names the TRACED symbol ("exact") or one
   *  of its members, folded onto it by the owner cascade ("owner-cascade").
   *  Absent means the engine could not resolve the match, which is NOT the
   *  same as "exact" — consumers must read this rather than infer it. */
  targetMatch?: "exact" | "owner-cascade"
  /** Callees: the same question from the other end — whether the stored row's
   *  SOURCE is the traced symbol or one of its members. */
  sourceMatch?: "exact" | "owner-cascade"
  /** Set only when the match was cascade-derived: the member the stored row
   *  actually named, so the owner-family superset can be reduced to the exact
   *  set without a second query. */
  matchedMember?: { name: string; file: string }
  /** Stored edge metadata (parsed from brain_relationship.metadata).
   *  Only declared fields pass through; the graph renderer derives the
   *  evidence tier from evidenceClass when present. Enrichment fields
   *  (M42.H3) ride under `enrichment` when the index enriched the row —
   *  present only with the `inferredAt` marker the pass writes, and always
   *  annotated as enrichment (never an evidence class). */
  metadata?: {
    evidenceClass?: string
    enrichment?: {
      role?: string
      pattern?: string
      layerFlow?: string
      criticality?: string
      frequency?: string
      isTestCode?: boolean
      isGeneratedCode?: boolean
      isFrameworkContract?: boolean
      isDependencyInjection?: boolean
      inferredAt: number
    }
  }
}

export interface GraphTraversalOptions {
  direction?: "callers" | "callees" | "both"
  maxDepth?: number
  relationshipTypes?: string[]
  includeCrossLanguage?: boolean
  callerBudget?: number
  calleeBudget?: number
  /** M59.A12 (#888): per-symbol site limit for one edge query (default 200, max
   *  5000). Reaching it is DECLARED as truncation, with the root's true site
   *  count reported when computable — it is never a silent cap. */
  edgeLimit?: number
  /** Bound on the SIZE OF THE ANSWER, not of one query (default 1000, max
   *  5000). Reaching it is declared as `total-edge-limit`. */
  maxEdges?: number
  /** Wall-clock budget for the whole walk, in milliseconds (default 2,000;
   *  0 disables it). A node is not a unit of work: the per-node caller query
   *  is priced by the reproducible ORDER BY, which SQLite applies BEFORE the
   *  LIMIT, so `edgeLimit` does not bound it. When this fires the walk stops
   *  and `summary.truncated` is true with reason
   *  "walk-time-budget-exhausted". */
  timeBudgetMs?: number
}

export interface GraphTraversalResult {
  root: GraphNode
  /** How many stored symbols the name resolved among. 1 means the name was
   *  unique; more means the caller should confirm `root` is the one they meant
   *  (measured: lodash holds eight symbols named `build`, cobra holds fifty
   *  structural symbols named `code_block.go`). */
  rootCandidates: number
  /** How the root was found: `exact` (a structural symbol of that name),
   *  `exact-any-kind` (a symbol of that name the graph cannot traverse — a
   *  constant, a type alias — which still has callers), or `containment` (the
   *  documented near-miss fallback, or a case difference, because SQLite's LIKE
   *  is case-insensitive for ASCII).
   *
   *  `containment` means the answer is about a symbol whose name CONTAINS the
   *  one asked for. Measured on the atlas corpus: `target: "ub"` answered
   *  `found: true` rooted at `hub`, and `target: "_"` answered `found: true`
   *  rooted at `build_registry`, with nothing in the payload saying the name
   *  was not found at all. `found: true` alone means "a root was found", which
   *  is a weaker claim than the one a reader assumes. */
  rootMatch: "exact" | "exact-any-kind" | "containment"
  callers: GraphEdge[]
  callees: GraphEdge[]
  nodes: Record<string, GraphNode>
  provenance: EvidenceProvenance
  summary: {
    /** Edges RETURNED for callers. When `truncated` is true this is a floor,
     *  not the total — read `callersIfUncapped` for the count when it is known
     *  (M59.A12 / #888: this used to be presented as the total). */
    totalCallers: number
    /** Edges RETURNED for callees; see `totalCallers`. */
    totalCallees: number
    maxDepthReached: number
    /** The depth cap in force for this traversal. Paired with
     *  `maxDepthReached` it is what a UI renders, and `truncated: true` with a
     *  depth reason is what tells a reader the answer is a prefix. */
    maxDepth: number
    /** The wall-clock budget this walk ran under, and whether it stopped on
     *  it. A node is not a unit of work: the per-node caller query is priced by
     *  the reproducible ORDER BY, which sorts before the LIMIT, so a symbol
     *  with thousands of call sites can cost seconds per node. The time bound
     *  is what bounds it, and `truncated` is true when it fires. */
    timeBudgetMs: number
    timeBudgetExhausted: boolean
    /** Stored rows the vendored/generated/fixture/noise policy removed before any
     *  bound applied. Non-zero means the edge sets are smaller than the store's BY
     *  POLICY, not because nothing was found — so an empty edge set with
     *  `truncated: false` does not mean "nothing references this". Reported here
     *  rather than as a truncation reason: a bound means the walk stopped early,
     *  a filter means it finished and removed rows, and `truncated` must not mean
     *  both. */
    noiseFiltered: { callers: number; callees: number }
    crossLanguageEdges: number
    truncated: boolean
    truncationReason?: string
    /** M59.A12 (#888): the declared per-query site limit that was in force. */
    edgeLimit: number
    /** The bound on the WHOLE answer. `edgeLimit` and the fan-out budgets bound
     *  a query and a fan-out; their product was otherwise unbounded, and a hub
     *  symbol at the default depth returned 454 edges and half a megabyte
     *  (ripgrep's `unwrap`). Declared so the size of an answer is something a
     *  caller can predict, and raise if it is too large. */
    maxEdges: number
    totalEdgeLimitReached: boolean
    /** How many edge queries hit that limit (any depth). */
    /** How many edge queries hit the per-symbol SITE limit specifically. Not a
     *  count of all bounds: `truncationReason` can name the fan-out budget and
     *  the depth cap as well, and this figure says which of them bit how often. */
    /** How many edge queries hit the per-symbol SITE limit specifically — NOT a
     *  count of every bound. `truncationReason` can also name the fan-out budget
     *  and the depth cap, and those carry their own flags (`callerBudgetExhausted`,
     *  `calleeBudgetExhausted`) and their own reasons, so this figure says which
     *  bound bit how often. */
    cappedQueries: number
    /** The root's true site count, counted with the same query and the same
     *  noise filters. `null` = not counted (no cap reached, or not computable),
     *  never zero. A lower bound when `totalsAreLowerBounds` is true. */
    callersIfUncapped: number | null
    calleesIfUncapped: number | null
    totalsAreLowerBounds: boolean
    /** DEPTH 0 ONLY — these four describe the ROOT. `exactCallers` names the
     *  root itself; `cascadedCallers` names one of its members, folded on by
     *  the owner cascade. The cascade is a declared superset; these make it a
     *  REDUCIBLE one. An edge at depth >= 1 is about another symbol entirely
     *  and is counted as `deeperCallers`; folding those in here would make
     *  this number describe something other than the root. */
    exactCallers: number
    cascadedCallers: number
    exactCallees: number
    cascadedCallees: number
    /** Edges at depth >= 1, about symbols the traversal discovered.
     *  exactCallers + cascadedCallers + deeperCallers === totalCallers. */
    deeperCallers: number
    deeperCallees: number
    /** The fan-out bound in force (symbols expanded per direction) and whether
     *  it was exhausted. `truncationReason` names the bound when it fires; this
     *  says what the bound was, which it previously did not. */
    callerBudget: number
    calleeBudget: number
    callerBudgetExhausted: boolean
    calleeBudgetExhausted: boolean
    /** Rows present in both the caller and the callee list — one relationship
     *  seen from two ends. `totalCallers + totalCallees` double-counts these. */
    edgesInBothDirections: number
    /** Composition of the RETURNED edges by stored relationship kind, counted
     *  from the emitted edges. With every stored kind in the default filter
     *  this is how a reader learns how many of the edges are calls without
     *  walking all of them. */
    edgesByType: Record<string, number>
    /** The cap's kind ordering, in survival order. A cap that keeps `calls`
     *  and drops `contains` is a decision; this publishes it. */
    edgeKindPriority: string[]
    /** The relationship kinds this run actually searched, resolved. NOT a
     *  restatement of the default: a scope field that disagrees with the
     *  answer is worse than no scope field. */
    relationshipTypesUsed: string[]
    /** M59 (#895, #854): stored rows collapsed at the tool layer before
     *  becoming edges — cascadeRepeatsCollapsed: the same rowId re-fetched by
     *  a deeper cascade; spellingVariantsCollapsed: same call site + same
     *  resolved target stored under different spellings, emitted once (the
     *  collapse is line-guarded: a NULL line never proves one site). Both are
     *  DECLARED, never silent: an agent can see how many rows were merged to
     *  produce the returned edge set. */
    dedupedAtToolLayer: {
      cascadeRepeatsCollapsed: number
      spellingVariantsCollapsed: number
    }
  }
  /** M28.A2 (D-6): the root symbol's agent/human annotations, author-labeled.
   *  Empty array when none — the webview then renders NO annotation badge. */
  annotations?: Array<{ author_class: string; tool_identity: string; body: string; time_updated: number }>
}

// Analyze (metrics / dependencies / complexity / impact) contracts

export type AnalyzeMode =
  | "callers"
  | "callees"
  | "trace"
  | "dependencies"
  | "statistics"
  | "complexity"
  | "impact"

export interface CouplingEntry {
  symbolId: string
  name: string
  file: string
  incoming: number   // edges where this symbol is the target (fan-in)
  outgoing: number   // edges where this symbol is the source (fan-out)
  score: number      // incoming + outgoing
}

export interface FileDependency {
  file: string           // relative path
  fileId: string
  /** The project-relative path of the target (`external: false` and resolved),
   *  or the specifier as written when it is external or unresolved. No
   *  `fileId`: one embeds the project id AND the relative path, so it repeated
   *  the path beside it. The path is the locator. */
  dependencies: Array<{
    path: string
    external: boolean
    /** How this target was reached: an exact path match, a segment-anchored
     *  suffix match, or nothing (the specifier the caller wrote, unresolved).
     *  This is the part a path cannot tell you. */
    resolution?: "resolved" | "suffix-match" | "unresolved"
  }>
  /** The project-relative path only. A file id embeds the project id AND the
   *  relative path, so carrying both repeated the path for every edge; the path
   *  is the locator. */
  dependents: Array<{ path: string }>
  /** The TRUE sizes of the two lists above. They are capped so one widely
   *  imported file cannot dominate a page; these are the real counts. */
  dependenciesTotal: number
  dependentsTotal: number
  dependenciesTruncated: boolean
  dependentsTruncated: boolean
  /** Internal specifiers this file wrote that resolve to no indexed file.
   *  Declared so an incomplete graph reads as incomplete rather than small. */
  unresolvedSpecifiers?: number
  score: number
  /** CONTRACT CHANGE: provenance moved to the report, not repeated per row. It
   *  was the same object on every row and roughly a third of the payload. A
   *  dependency page's evidence identity is on the page, not on each file. */
  provenance?: EvidenceProvenance
}

export interface ComplexityMetric {
  value: number | null   // null = not computable / unavailable (never fabricated)
  available: boolean
}

export interface ComplexityReport {
  target: string
  scope: "project" | "file" | "class" | "function"
  metrics: {
    cyclomaticAvg: ComplexityMetric
    cyclomaticTotal: ComplexityMetric
    linesOfCode: ComplexityMetric
    couplingEdges: ComplexityMetric
    maintainability: ComplexityMetric
    depthOfInheritance: ComplexityMetric // available:false until real hierarchy analysis
  }
  breakdown: Array<{ name: string; type: string; complexity: number; file: string; line: number }>
  symbolCount: number
  /** How many FILES the scope covered. A file scope can match many
   *  (`target: "src"`), and without this a one-file answer and an eighty-file
   *  answer are the same shape — measured 163 symbols with `linesOfCode: 2`. */
  /** Files HOLDING A SYMBOL the metrics above are computed over. */
  filesInScope: number
  /** Files the scope NAMES, whether or not any of them hold an indexed symbol.
   *  Equals `filesInScope` unless a file in scope has no symbols — measured on
   *  backbencher-brain/src, `target: "ast"` reported 83 of 84. Published so the
   *  difference is visible rather than an unexplained discrepancy. */
  filesMatchingScope: number
  /** For a file-shaped scope, WHICH of the two shapes it was:
   *  `exact-file` (one `brain_file.relative_path`) or `directory-prefix` (every
   *  file under a path prefix, on a segment boundary). Absent for a symbol or
   *  project scope, where the question does not arise.
   *
   *  `scope` reads `"file"` for both, which reads as ONE file: measured,
   *  `target: "src/wide"` reported `scope: "file"` with `filesInScope: 68`. */
  scopeMatch?: "exact-file" | "directory-prefix"
  /** Which relationship types `metrics.couplingEdges` counted. `exports` and
   *  `contains` are index bookkeeping; counting them inflated the number by
   *  1.20x on bb's own src and 2.24x on a small corpus. */
  couplingRelationshipTypes: string[]
  provenance: EvidenceProvenance
}

export interface ImpactReport {
  target: string
  found: boolean
  scope: "direct" | "transitive" | "global"
  directSymbols: number
  affectedFiles: Array<{ file: string; via: string; depth: number; crossLanguage: boolean }>
  transitiveFiles: number
  crossLanguageFiles: number
  unresolvedEdges: number
  riskLevel: "low" | "medium" | "high" | "critical"
  truncated: boolean
  provenance: EvidenceProvenance
}

// Pattern findings (orphans / architecture) — one canonical finding schema.

export type PatternRule =
  | "orphaned_function"
  | "orphaned_class"
  | "orphaned_file"
  | "orphaned_import"

export type PatternSeverity = "info" | "warning" | "error"

export interface PatternEvidence {
  kind: "relationship" | "import" | "reference" | "heuristic"
  description: string
}

export interface PatternFinding {
  rule: PatternRule
  engine: string                 // which engine produced it (provenance)
  severity: PatternSeverity
  confidence: number             // 0..1
  location: { file: string; line: number; symbol?: string }
  linesOfCode: number            // exact indexed span (line_end - line_start), 0 if unknown
  description: string
  remediation: string            // evidence-aware, never "safe to remove"
  evidence: PatternEvidence[]
  limitations: string[]          // known false-positive classes for this finding
}

export interface PatternReport {
  findings: PatternFinding[]
  provenance: EvidenceProvenance
  summary: {
    total: number
    byRule: Record<string, number>
    scannedSymbols: number
    scannedFiles: number
    truncated: boolean
    // M57.T3 (#791): census over the FULL candidate set (not just the returned
    // page) so a caller can bound the page without losing the aggregate counts.
    candidatesTotal: number
    candidatesByRule: Record<string, number>
    candidatesAverageConfidence: number
    /**
     * Why the candidate set is the size it is. Every candidate the scan
     * discarded, by reason. A report that says "0 findings" is only honest if
     * the reader can see whether that is because nothing was dead or because
     * everything was suppressed; this makes the second case distinguishable
     * from the first. Optional: a producer that does not account for its own
     * suppressions omits it rather than reporting zeros it did not measure.
     */
    suppressedByReason?: Record<string, number>
  }
}

export interface OrphanOptions {
  rules?: PatternRule[]
  minConfidence?: number
  maxResults?: number
  includeTests?: boolean
}

// Security (taint-flow) contracts — brain_taint_flow is the primary evidence.

export type SecurityMode = "findings" | "flow" | "summary" | "hotspots"

export type FlowState = "confirmed" | "mitigated" | "unresolved" | "source_only"

export interface FlowNode {
  symbolId: string | null
  name: string | null
  file: string | null
  line: number | null
}

export interface SecurityEvidenceItem {
  kind: "taint_flow" | "source_scan"
  description: string
}

export interface SecurityFindingV2 {
  id: string
  vulnerabilityType: string        // normalized (e.g. sql_injection)
  label: string
  severity: "critical" | "high" | "medium" | "low" | "unknown"
  confidence: number               // 0..1, calibrated by flow state
  state: FlowState
  file: string | null
  line: number | null
  symbol: string | null
  language: string | null
  sourceType: string | null
  sinkType: string | null
  source: FlowNode
  sink: FlowNode
  path: FlowNode[]                 // fully resolved intermediate nodes (id+location)
  crossLanguage: boolean
  mitigated: boolean
  evidence: SecurityEvidenceItem[]
  limitations: string[]
}

export interface SecurityHotspot {
  key: string                      // file or symbol
  kind: "file" | "symbol"
  findings: number
  maxSeverity: "critical" | "high" | "medium" | "low" | "unknown"
}

export interface SecuritySummaryV2 {
  total: number
  bySeverity: Record<string, number>
  byType: Record<string, number>
  byState: Record<FlowState, number>
  crossLanguage: number
  scannedFlows: number
  deduplicatedFlows: number
  /**
   * Deduplicated findings omitted by the `maxResults` cap. `0` means the report
   * is complete. `deduplicatedFlows` is the pre-cap census and `total` is what
   * was returned, so a caller that reads only `total` cannot tell a capped scan
   * from a small one — this is the field that tells them.
   */
  truncatedFindings: number
}

export interface SecurityReport {
  findings: SecurityFindingV2[]
  summary: SecuritySummaryV2
  hotspots: SecurityHotspot[]
  provenance: EvidenceProvenance
}

export interface SecurityOptions {
  mode?: SecurityMode
  minConfidence?: number
  includeMitigated?: boolean
  includeUnresolved?: boolean
  maxResults?: number
}

// Test intelligence (static, evidence-based) contracts.
// Static evidence links test-file symbols to production symbols via the
// relationship graph. It does NOT prove runtime execution or line coverage.

export type TestEvidenceKind = "direct_call" | "reference" | "import"

export interface TestLink {
  testSymbolId: string
  testSymbolName: string
  testFile: string
  evidence: TestEvidenceKind
  relationshipType: string
  confidence: number   // direct_call > reference > import
}

export interface TestMappingEntry {
  symbolId: string
  name: string
  symbolType: string
  file: string
  line: number
  complexity: number
  gravity: number
  /** At most DEFAULT_MAX_LINKS rows. `strongestEvidence` and every summary
   *  count are computed from the COMPLETE set, so a trimmed entry still says
   *  how strongly this symbol is tested. Absent when nothing was trimmed. */
  links: TestLink[]
  linksTruncated?: boolean
  strongestEvidence: TestEvidenceKind | "none"
}

export interface TestMappingReport {
  entries: TestMappingEntry[]
  provenance: EvidenceProvenance
  summary: {
    productionSymbols: number
    /** Symbols the documented population filter removed — noise paths and noise
     *  symbol names. So `productionSymbols + excludedAsNoise` is the store's
     *  population under this mode's own filter, and a reader can check it
     *  instead of taking it on trust. */
    excludedAsNoise: number
    /** How many entries this answer returned, against the population above. */
    returned: number
    truncated: boolean
    testedSymbols: number
    untestedSymbols: number
    testFiles: number
    scannedTestSymbols: number
    evidenceLinks: number
  }
}

export type TestGapCategory =
  | "no_evidence"
  | "weak_evidence"       // only reference/import, no direct call
  | "indirect_only"       // reached only via transitive graph, not directly

export interface TestGap {
  symbolId: string
  name: string
  symbolType: string
  file: string
  line: number
  category: TestGapCategory
  complexity: number
  gravity: number
  riskScore: number       // ranking: complexity + gravity weighting
  recommendation: string
}

export interface TestGapReport {
  gaps: TestGap[]
  provenance: EvidenceProvenance
  summary: {
    /** The production-symbol population this mode scanned — the SAME number
     *  `test_mapping` reports as `productionSymbols`, so the two modes can be
     *  compared. */
    productionSymbols: number
    /** How many GAP rows exist: `productionSymbols - directlyTested`. Named
     *  `total` for compatibility, but it is a count of gaps, NOT of production
     *  symbols. The two used to be indistinguishable: on the atlas corpus the
     *  modes answered 169 and 163 under names that read as one question, and
     *  nothing in either payload said how they relate. */
    total: number
    /** Production symbols excluded because a test calls them directly — the
     *  difference between the population and the gap count. */
    directlyTested: number
    /** Symbols the population filter dropped as noise. */
    excludedAsNoise: number
    /** How many gap rows this answer returned, against `total`. */
    returned: number
    truncated: boolean
    byCategory: Record<string, number>
    highRisk: number
  }
}

export interface TestImpactReport {
  target: string
  found: boolean
  directTests: Array<{ testSymbol: string; testFile: string; depth: number }>
  indirectTests: Array<{ testSymbol: string; testFile: string; depth: number }>
  affectedTestFiles: string[]
  truncated: boolean
  provenance: EvidenceProvenance
  // Runtime coverage is a SEPARATE field; only populated from a real artifact.
  runtimeCoverage: { available: false } | { available: true; percent: number; source: string }
}

export interface TestIntelOptions {
  maxResults?: number
  includeMethods?: boolean
  maxDepth?: number
  /** Scope the report to production symbols under this project-relative path prefix. */
  filePath?: string
}

// ============================================================================
// Test quality & suggestions (M9.11) — verify-driven, capability flags only.
// The static metric semantics live in docs/BB_TEST_QUALITY.md (methodology).
// ============================================================================

export type TestSuggestionAction =
  | "extend_existing_test"
  | "create_test"
  | "review_deleted_symbol_coverage"

export interface TestQualityIssue {
  category: string                              // e.g. no_assertion_signal
  description: string
}

export type TestQualityDimensionId =
  | "assertions"
  | "mocking"
  | "error_handling"
  | "parameterization"
  | "docs"
  | "fixtures"

/** A single independently-measured dimension. Never a multiplier of an overall score. */
export interface TestQualityDimension {
  id: TestQualityDimensionId
  supported: boolean
  /** Normalized 0..1, or null when node has no branches to measure (relevant-not-applicable). */
  relevance: number | null
  /** Observed modifier (accumulated bonus/penalty), or null when not measured. */
  evidenceStrength: number | null
  /** 0..1 penalty-signal share, or null when not measured. */
  penaltyPotential: number | null
  /** Strongest observed basis symbol, or null. */
  observedAnchor: string | null
  /** Confidence 0..1, or null when not measured/unknown. */
  confidence: number | null
}

export interface TestQualityFile {
  relativePath: string
  /** Weighted mean of measured dimensions only, or null when unknown. */
  overall: number | null
  dimensions: TestQualityDimension[]
  unsupported: string[]
  issues: TestQualityIssue[]
  strengths: string[]
}

export interface TestQualityReport {
  files: TestQualityFile[]
  aggregate: { mean: number | null; perDimension: Record<string, number | null> }
  provenance: EvidenceProvenance
  summary: {
    filesWithContent: number
    filesUnknown: number
    unsupportedDimensionCount: number
  }
}

export interface TestSuggestionActionItem {
  action: TestSuggestionAction
  evidence: { evidenceKind: TestEvidenceKind; confidence: number; testFile?: string; testSymbol?: string }
  /** "existing_test_ref" | "expected_convention" | "dangling_impact_edge" | "naming_fallback" */
  targetBasis: string
  priority: "critical" | "high" | "medium" | "low"
  estimatedEffort: "small" | "medium" | "large"
  text: string                          // recommendation text only; NO generated test code
}

export interface TestSymbolChangeSuggestion {
  symbolId: string
  symbolName: string
  filePath: string                      // "" when deletion removed the file scope
  changeType: "added" | "modified" | "deleted"
  blastRadius: number                   // unique reachable caller count from graph engine
  actions: TestSuggestionActionItem[]
  namingFallback: boolean
}

export interface AffectedTestEntry {
  testSymbol: string
  testFile: string
  depth: number
  changedSymbol: string
}

export interface TestSuggestionsReport {
  changedSymbols: TestSymbolChangeSuggestion[]
  /** Existing tests affected by changed production symbols (recommended first). */
  affectedExistingTests: AffectedTestEntry[]
  unknowns: string[]
  summary: { actionCount: number; extendExisting: number; createNew: number }
}

// ============================================================================
// Analysis runs and finding history (M9.12).
// ============================================================================

export type AnalysisRunKind = "security" | "patterns" | "test" | "analyze" | "health"
export type AnalysisRunStatus = "running" | "completed" | "failed"
export type AnalysisFindingState = "open" | "resolved" | "suppressed" | "reopened" | "mitigated" | "stale"

export interface AnalysisRunRecord {
  id: string
  projectId: ProjectID
  kind: AnalysisRunKind
  status: AnalysisRunStatus
  engineVersion: string
  inputHash: string
  startedAt: number
  completedAt: number | null
  findingCount: number
  error: string | null
}

export interface AnalysisFindingRecord {
  id: string
  projectId: ProjectID
  kind: AnalysisRunKind
  fingerprint: string
  rule: string
  title: string
  severity: string
  state: AnalysisFindingState
  confidence: number | null
  evidence: unknown[]
  /** Stable location identifier (file:line or symbol), used in dedup key. */
  location: string | null
  /** Known false-positive classes for this finding; retained alongside evidence. */
  limitations: string[]
  /** Per-finding provenance identity (evidence class + engine + version). */
  evidenceClass: string | null
  engine: string | null
  engineVersion: string | null
  firstSeenAt: number
  lastSeenAt: number
  resolvedAt: number | null
  suppressedAt: number | null
  mitigatedAt: number | null
  occurrenceCount: number
}

export interface AnalysisFindingOccurrence {
  id: string
  findingId: string
  runId: string
  state: AnalysisFindingState
  location: string | null
  evidence: unknown[]
  limitations: string[]
  evidenceClass: string | null
  engine: string | null
  engineVersion: string | null
  observedAt: number
}

export interface AnalysisRunInput {
  projectId: ProjectID
  kind: AnalysisRunKind
  input?: unknown
  engineVersion?: string
  retentionDays?: number
}

export interface AnalysisFindingInput {
  fingerprint?: string
  rule: string
  title: string
  severity: string
  confidence?: number | null
  evidence?: unknown[]
  location?: string | null
  limitations?: string[]
  evidenceClass?: string
  engine?: string
  engineVersion?: string
  state?: AnalysisFindingState
}

export interface AnalysisRunReport {
  run: AnalysisRunRecord
  findings: AnalysisFindingRecord[]
  newFindings: number
  repeatedFindings: number
  resolvedFindings: number
  reopenedFindings: number
  staleFindings: number
  // All findings read back in deterministic order (state priority ASC, last_seen_at DESC, fingerprint ASC).
  orderedFindings: AnalysisFindingRecord[]
}

export interface AnalysisHistoryReport {
  runs: AnalysisRunRecord[]
  findings: AnalysisFindingRecord[]
  summary: Record<AnalysisFindingState, number>
}

// ── M35.E1 (#581): the one staleness wire shape for every read tool ──
// Carried by read-mode JSON envelopes as `freshness`, with per-item
// `stale?: boolean` where the row shape has a file identity. Registered per
// tool+mode in the executable registry via descriptor.freshnessModes, so a
// mode must carry this block exactly when it is registered to.
// remediation is machine-stable text naming the real reindex interface —
// its exact forms live in FRESHNESS_REMEDIATION (src/brain/freshness.ts).
export interface StalenessEnvelope {
  fresh: number
  stale: number
  missing: number
  /** (stale + missing) / (fresh + stale + missing); 0 when nothing checked. */
  staleRatio: number
  /** sampled = subset of files checked; complete = every row's file checked. */
  mode: "sampled" | "complete"
  /** Actionable, machine-stable remediation; "" when nothing is stale. */
  remediation: string
}
