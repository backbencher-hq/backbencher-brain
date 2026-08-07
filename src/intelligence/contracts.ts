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
