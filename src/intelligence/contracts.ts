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
}

export interface CallGraphEntry {
  function: FunctionInfo
  callSite: { file: string; line: number }
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
  similarity: number
  language: string
}

export interface SemanticSearchResults {
  results: SemanticResult[]
  metadata: {
    queryModel: string      // Model that produced the query vector
    indexModel: string       // Model of the retrieved embeddings
    method: "vector" | "keyword-fallback"
    dimension: number
    scannedRows: number
    filteredRows: number
    fallbackReason?: string
  }
}

// Graph traversal contracts

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
  callSite: { file: string; line: number } // source-side location of the edge
  depth: number
}

export interface GraphTraversalOptions {
  direction?: "callers" | "callees" | "both"
  maxDepth?: number
  relationshipTypes?: string[]
  includeCrossLanguage?: boolean
  callerBudget?: number
  calleeBudget?: number
}

export interface GraphTraversalResult {
  root: GraphNode
  callers: GraphEdge[]
  callees: GraphEdge[]
  nodes: Record<string, GraphNode>
  summary: {
    totalCallers: number
    totalCallees: number
    maxDepthReached: number
    crossLanguageEdges: number
    truncated: boolean
    truncationReason?: string
  }
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
  summary: {
    total: number
    byRule: Record<string, number>
    scannedSymbols: number
    scannedFiles: number
    truncated: boolean
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
}

export interface SecurityOptions {
  mode?: SecurityMode
  minConfidence?: number
  includeMitigated?: boolean
  includeUnresolved?: boolean
  maxResults?: number
}
