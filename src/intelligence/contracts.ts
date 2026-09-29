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
  linesOfCode: number
  avgFileSize: number
  symbols: number
  avgComplexity: number
  relationships: number
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
}

export interface GraphTraversalResult {
  root: GraphNode
  /** How many stored symbols the name resolved among. 1 means the name was
   *  unique; more means the caller should confirm `root` is the one they meant
   *  (measured: lodash holds eight symbols named `build`, cobra holds fifty
   *  structural symbols named `code_block.go`). */
  rootCandidates: number
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
    crossLanguageEdges: number
    truncated: boolean
    truncationReason?: string
    /** M59.A12 (#888): the declared per-query site limit that was in force. */
    edgeLimit: number
    /** How many edge queries hit that limit (any depth). */
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
  dependencies: Array<{ path: string; fileId?: string; external: boolean }>
  dependents: Array<{ path: string; fileId: string }>
  score: number
  provenance: EvidenceProvenance
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
  links: TestLink[]
  strongestEvidence: TestEvidenceKind | "none"
}

export interface TestMappingReport {
  entries: TestMappingEntry[]
  provenance: EvidenceProvenance
  summary: {
    productionSymbols: number
    testedSymbols: number
    untestedSymbols: number
    testFiles: number
    scannedTestSymbols: number
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
    total: number
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
