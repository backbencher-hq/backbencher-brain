export type ToolMutability = "read" | "index" | "write"

export interface CurrentToolContract {
  name: string
  mutability: ToolMutability
  required: readonly string[]
  properties: readonly string[]
  defaults: Readonly<Record<string, string | number | boolean>>
  output: "text"
  replacement: string
  replacementMode?: string
}

export const CURRENT_MCP_TOOL_CONTRACTS = [
  {
    name: "bb_search",
    mutability: "read",
    required: ["query"],
    properties: ["query", "limit", "language", "symbolKind", "includeContent", "exact", "caseSensitive", "regex", "offset"],
    defaults: { limit: 15, includeContent: false, exact: false, caseSensitive: false, regex: false, offset: 0 },
    output: "text",
    replacement: "bb_search",
  },
  {
    name: "bb_select",
    mutability: "read",
    required: ["symbolName"],
    properties: ["symbolName", "filePath", "lineStart"],
    defaults: {},
    output: "text",
    replacement: "bb_search",
    replacementMode: "symbol",
  },
  {
    name: "bb_relationships",
    mutability: "read",
    required: ["target"],
    properties: ["target", "direction", "includeIndirect", "maxDepth", "limit"],
    defaults: { direction: "callers", includeIndirect: false, maxDepth: 3, limit: 15 },
    output: "text",
    replacement: "bb_analyze",
    replacementMode: "callers",
  },
  {
    name: "bb_ask",
    mutability: "read",
    required: ["query"],
    properties: ["query", "limit"],
    defaults: { limit: 5 },
    output: "text",
    replacement: "bb_ask",
  },
  {
    name: "bb_health",
    mutability: "read",
    required: [],
    properties: ["verbose"],
    defaults: { verbose: false },
    output: "text",
    replacement: "bb_health",
  },
  {
    name: "bb_patterns",
    mutability: "read",
    required: [],
    properties: ["scope", "limit", "includeOrphaned", "includeFramework", "includeAntiPatterns", "confidenceThreshold"],
    defaults: { scope: "all", limit: 20, includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0.6 },
    output: "text",
    replacement: "bb_patterns",
  },
  {
    name: "bb_security",
    mutability: "read",
    required: [],
    properties: [],
    defaults: {},
    output: "text",
    replacement: "bb_security",
  },
  {
    name: "bb_visualize",
    mutability: "read",
    required: [],
    properties: ["maxNodes", "format"],
    defaults: { maxNodes: 200, format: "text" },
    output: "text",
    replacement: "bb_visualize",
  },
  {
    name: "bb_migrate",
    mutability: "read",
    required: ["symbolName", "targetLanguage"],
    properties: ["symbolName", "targetLanguage"],
    defaults: {},
    output: "text",
    replacement: "bb_migrate",
  },
  {
    name: "bb_refresh",
    mutability: "index",
    required: [],
    properties: ["force"],
    defaults: { force: false },
    output: "text",
    replacement: "bb_health",
    replacementMode: "refresh",
  },
  {
    name: "bb_write",
    mutability: "write",
    required: ["filePath", "content"],
    properties: ["filePath", "content"],
    defaults: {},
    output: "text",
    replacement: "bb_edit",
    replacementMode: "write",
  },
  {
    name: "bb_update",
    mutability: "write",
    required: ["symbolName", "newContent"],
    properties: ["symbolName", "newContent", "filePath"],
    defaults: {},
    output: "text",
    replacement: "bb_edit",
    replacementMode: "update",
  },
  {
    name: "bb_insert",
    mutability: "write",
    required: ["targetSymbolName", "position", "newContent"],
    properties: ["targetSymbolName", "position", "newContent", "filePath"],
    defaults: {},
    output: "text",
    replacement: "bb_edit",
    replacementMode: "insert",
  },
  {
    name: "bb_delete",
    mutability: "write",
    required: ["symbolName"],
    properties: ["symbolName", "filePath"],
    defaults: {},
    output: "text",
    replacement: "bb_edit",
    replacementMode: "delete",
  },
  {
    name: "bb_refactor",
    mutability: "write",
    required: ["symbolName", "newName"],
    properties: ["symbolName", "newName", "filePath"],
    defaults: {},
    output: "text",
    replacement: "bb_edit",
    replacementMode: "refactor",
  },
] as const satisfies readonly CurrentToolContract[]

export const CURRENT_CLI_CONTRACTS = [
  { name: "index", required: ["dir"], options: ["force"] },
  { name: "search", required: ["query"], options: ["dir", "limit", "language"] },
  { name: "health", required: [], options: ["dir"] },
  { name: "mcp", required: [], options: ["dir"] },
  { name: "version", required: [], options: [] },
] as const

export const CURRENT_LIBRARY_EXPORTS = [
  "BrainDatabase",
  "BrainSchema",
  "ProjectSchema",
  "ProjectID",
  "CoreStorage",
  "ASTEngine",
  "indexProjectParallel",
  "BrainTools",
  "SemanticEngine",
  "checkFileFreshness",
  "checkResultsFreshness",
  "hashFileContent",
  "getProjectId",
] as const

export type SearchMode = "symbols" | "content" | "symbol" | "file"
export type AskMode = "answer" | "explain" | "feature"
export type AnalyzeMode =
  | "callers"
  | "callees"
  | "trace"
  | "dependencies"
  | "stats"
  | "complexity"
  | "impact"
  | "test_mapping"
  | "test_gaps"
  | "test_impact"
  | "test_quality"
export type PatternScope = "orphaned" | "quality" | "architecture" | "all"
export type SecurityMode = "findings" | "flow" | "summary" | "hotspots"
export type DocMode = "symbol" | "file" | "module" | "feature" | "api" | "project" | "coverage"
export type EditMode = "write" | "update" | "insert" | "delete" | "refactor"

export type TargetToolInput =
  | { tool: "bb_search"; mode: SearchMode; query?: string; symbolName?: string; filePath?: string }
  | { tool: "bb_ask"; mode: AskMode; query: string }
  | { tool: "bb_analyze"; mode: AnalyzeMode; target?: string; filePath?: string }
  | { tool: "bb_patterns"; scope: PatternScope; target?: string }
  | { tool: "bb_security"; mode: SecurityMode; target?: string }
  | { tool: "bb_doc"; mode: DocMode; target?: string; format?: "markdown" | "json" }
  | { tool: "bb_visualize"; scope?: "project" | "file" | "symbol" | "feature"; target?: string }
  | { tool: "bb_migrate"; symbolNames: string[]; targetLanguage: string }
  | { tool: "bb_edit"; mode: EditMode; dryRun?: boolean }
  | { tool: "bb_health"; refresh?: boolean; wait?: boolean; verbose?: boolean }

export interface TargetToolContract {
  name: TargetToolInput["tool"]
  mutability: ToolMutability
  modes: readonly string[]
  purpose: string
}

export const TARGET_TOOL_CONTRACTS = [
  { name: "bb_search", mutability: "read", modes: ["symbols", "content", "symbol", "file"], purpose: "Indexed lexical, structural, and exact source retrieval" },
  { name: "bb_ask", mutability: "read", modes: ["answer", "explain", "feature"], purpose: "Evidence-backed natural-language codebase intelligence" },
  { name: "bb_analyze", mutability: "read", modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], purpose: "Graph, metric, impact, and test analysis" },
  { name: "bb_patterns", mutability: "read", modes: ["orphaned", "quality", "architecture", "all"], purpose: "Evidence-backed quality and architecture findings" },
  { name: "bb_security", mutability: "read", modes: ["findings", "flow", "summary", "hotspots"], purpose: "Taint-flow and source-evidence security analysis" },
  { name: "bb_doc", mutability: "read", modes: ["symbol", "file", "module", "feature", "api", "project", "coverage"], purpose: "Cited documentation generation and coverage" },
  { name: "bb_visualize", mutability: "read", modes: ["project", "file", "symbol", "feature"], purpose: "Dependency and architecture visualization" },
  { name: "bb_migrate", mutability: "read", modes: ["plan"], purpose: "Cross-language migration planning" },
  { name: "bb_edit", mutability: "write", modes: ["write", "update", "insert", "delete", "refactor"], purpose: "Validated source mutations with dry-run support" },
  { name: "bb_health", mutability: "index", modes: ["status", "refresh"], purpose: "Index, schema, freshness, embedding, and runtime health" },
] as const satisfies readonly TargetToolContract[]
