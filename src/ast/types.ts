// Universal AST Types — Extracted from backbencher's engine.ts
// These define the complete data model for symbols, relationships, imports, exports
// across ALL 40 supported programming languages
// Source: /backbencher/packages/opencode/src/ast/engine.ts lines 287-463

// ============================================================================
// SYMBOL KINDS — Universal across all languages
// ============================================================================

export enum SymbolKind {
  Function = "function",
  Class = "class",
  Variable = "variable",
  Constant = "constant",
  Interface = "interface",
  Enum = "enum",
  EnumMember = "enum_member",
  Type = "type",
  Import = "import",
  Export = "export",
  Method = "method",
  Property = "property",
  Constructor = "constructor",
  Namespace = "namespace",
  Module = "module",
  // Language-specific kinds (aliased for backward compat)
  Table = "class",
  Service = "class",
  Resource = "class",
  TypeAlias = "type",
  Event = "event",
  Delegate = "delegate",
  Object = "class",
  Record = "type",
  Macro = "macro",
  Trait = "trait",
  Struct = "struct",
  Impl = "impl",
  Actor = "actor",
  Union = "union",
  // Language-specific kinds — map mixin/extension to their own kind for
  // semantic fidelity (they're distinct language constructs, not classes).
  Mixin = "mixin",
  Extension = "extension",
  /**
   * Additive from the remote lane, which added `Instance` to `engine.SymbolKind` on
   * 2026-10-31. The two enums are duplicated declarations of one concept and tsc
   * compares them structurally, so a member present in one and absent from the other
   * makes every `UniversalSymbol` unassignable across the boundary — which is how
   * the merge surfaced it, in `real-typescript-analyzer` and `real-haskell-analyzer`,
   * as errors in files that neither side had touched in this merge.
   */
  Instance = "instance",
}

// ============================================================================
// RELATIONSHIP TYPES
// ============================================================================

export enum RelationshipType {
  Calls = "calls",
  Call = "calls",
  Extends = "extends",
  Inheritance = "extends",
  Implements = "implements",
  Implementation = "implements",
  Uses = "uses",
  Dependency = "uses",
  Imports = "brain_import",
  Exports = "exports",
  Contains = "contains",
  DependsOn = "references",
  Override = "overrides",
  Composition = "contains",
  Provides = "exports",
  Related = "references",
  PartOf = "contains",
  References = "references",
  Overrides = "overrides",
  Instantiates = "instantiates",
}

// ============================================================================
// CORE DATA TYPES
// ============================================================================

export interface Parameter {
  name: string
  type?: string
  defaultValue?: string
  isOptional?: boolean
  [key: string]: any
}

/**
 * UniversalSymbol — THE core data structure.
 * Every analyzer in all 40 languages produces an array of these.
 * Contains byte-precise start/end indices for surgical code operations.
 */
export interface UniversalSymbol {
  name: string
  kind: SymbolKind
  range: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
    startIndex?: number
    endIndex?: number
  }
  scope?: string
  visibility?: string
  isStatic?: boolean
  isAsync?: boolean
  isAbstract?: boolean
  parameters?: Parameter[]
  returnType?: string
  decorators?: string[]
  genericParameters?: string[]
  comments?: string[]
  qualified_calls?: string[]
  apiContractPath?: string
  ownerName?: string
  ownerKind?: SymbolKind
  taintSources?: { type: string; snippet: string }[]
  taintSinks?: { type: string; snippet: string; vulnerability_type: string }[]
  gravityScore?: number
  layer?: string
  metadata: Record<string, any>
  [key: string]: any
}

export interface UniversalRelationship {
  source?: string
  target?: string
  from?: string
  to?: string
  fromSymbol?: string
  toSymbol?: string
  type?: RelationshipType
  relationshipType?: RelationshipType
  confidence?: number
  line_number?: number
  metadata: Record<string, any>
  [key: string]: any
}

export interface ImportInfo {
  module?: string
  items?: string[]
  isDefault?: boolean
  isDefaultImport?: boolean
  isNamespaceImport?: boolean
  alias?: string
  range?: UniversalSymbol["range"]
  localName?: string
  importType?: string
  path?: string
  isNamespace?: boolean
  importedNames?: string[]
  metadata?: Record<string, any>
  [key: string]: any
}

export interface ExportInfo {
  name: string
  isDefault?: boolean
  type?: string
  range?: UniversalSymbol["range"]
  kind?: SymbolKind
  metadata?: Record<string, any>
  [key: string]: any
}

export interface ParseError {
  message: string
  range: UniversalSymbol["range"]
  severity: "error" | "warning" | "info"
}

export interface FileMetadata {
  complexity: number
  linesOfCode: number
  cyclomaticComplexity?: number
  statisticalComplexity?: number
  framework?: string
  architecture?: string
  patterns?: string[]
  detectedFrameworks?: string[]
  frameworkPatterns?: any[]
  architecturalInsights?: any[]
  architecturalScore?: number
  codeQuality?: string
  crossFileRelationshipCount?: number
  hasOrphanedSymbols?: boolean
  hasTypeInference?: boolean
  hasFrameworkIntelligence?: boolean
  analysisVersion?: string
  [key: string]: any
}

// ============================================================================
// PARSE RESULT
// ============================================================================

export interface ParseResult {
  language?: string
  symbols: UniversalSymbol[]
  relationships: UniversalRelationship[]
  imports: ImportInfo[]
  exports?: ExportInfo[]
  errors?: ParseError[]
  rawContent?: string
  metadata: FileMetadata
  [key: string]: any
}

// ============================================================================
// LANGUAGE ANALYZER INTERFACE — Identical between backbencher and mcp-brain
// ============================================================================

export interface AnalyzeContext {
  /**
   * Project-level companion index for cross-file override-target resolution:
   * owner type name → declared method names. Built by the caller (M12
   * differential harness; production indexer via M12.44) from the symbols of
   * previously parsed files. Absent for per-file-only callers — analyzers then
   * fall back to their deterministic first-parent default.
   */
  overrideCompanion?: Map<string, Set<string>>
  [key: string]: any
}

export interface LanguageAnalyzer {
  analyze(
    rootNode: any,
    content: string,
    filePath: string,
    context?: AnalyzeContext,
  ): Omit<ParseResult, "language" | "metadata"> & { metadata?: Partial<FileMetadata> }
}

// ============================================================================
// MCP TOOL TYPES
// ============================================================================

export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, any>
    required?: string[]
  }
  handler: (args: any, ctx: ToolContext) => Promise<any>
}

export interface ToolContext {
  projectPath: string
  projectId: string
  db: any // Database instance — typed in database.ts
}
