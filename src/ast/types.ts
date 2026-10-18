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

/**
 * THE AUTHORITATIVE RELATIONSHIP-TYPE ENUM — one source for the values analyzers emit.
 *
 * CONSOLIDATED 2026-10-17. Three `RelationshipType` enums existed with overlapping member names:
 *   - this one (the authoritative definition),
 *   - `ASTEngine.RelationshipType` in src/ast/engine.ts, which is now a RE-EXPORT of this enum
 *     (const + type alias) so every analyzer's `ASTEngine.RelationshipType.X` keeps resolving,
 *   - `GraphIntelligence.RelationshipType` in src/ast/graph.ts, which keeps the STORED domain and
 *     separates the values analyzers emit (all ten here) from its DERIVED extras — see that file.
 *
 * THE TEN CANONICAL MEMBERS ARE THE EMITTED VOCABULARY. Nothing below them changes an emitted
 * string: the legacy aliases are alternate NAMES for those same ten values, kept so old call sites
 * still compile, and each collapse is justified on the member. The one collapse that was NOT kept is
 * `DependsOn → references` — see the removal note in place of the member.
 */
export enum RelationshipType {
  // ── the ten canonical emitted values ──────────────────────────────────────────────────────────
  Calls = "calls",
  Extends = "extends",
  Implements = "implements",
  Uses = "uses",
  // 2026-10-04. This read "brain_import", which is the NAME OF A TABLE, not a
  // relationship type. Three divergent RelationshipType enums exist in this
  // codebase; this is the odd one out:
  //   src/ast/types.ts   Imports = "brain_import"  <- was, unreachable
  //   src/ast/engine.ts  Imports = "imports"       <- what analyzers emit
  //   src/ast/graph.ts   Imports = "imports"       <- what consumers read
  // Measured on go-stdlib through the production path (getParser -> parse ->
  // analyze): 179 import edges came out typed "imports" and 0 typed
  // "brain_import", even though the emitting source line reads
  // `ASTEngine.RelationshipType.Imports`. So every analyzer, the persistence
  // layer, and every consumer agreed on "imports" while this enum said
  // "brain_import" — and zero sites in src/ ever compare a relationship type
  // against "brain_import". MASTER-HANDOFF §5 read that divergence as "16
  // analyzers emit a raw literal" and queued a 16-lane sweep to fix correct
  // code. The divergence was one line, in one file, in the wrong enum.
  Imports = "imports",
  Exports = "exports",
  Contains = "contains",
  References = "references",
  Overrides = "overrides",
  Instantiates = "instantiates",

  // ── legacy aliases: alternate NAMES for the values above, never new values ───────────────────
  /** @deprecated use {@link Calls}. Singular spelling of the same value. */
  Call = "calls",
  /** @deprecated use {@link Extends}. OO-inheritance synonym; `extends` is the emitted spelling. */
  Inheritance = "extends",
  /** @deprecated use {@link Implements}. */
  Implementation = "implements",
  /** @deprecated use {@link Uses}. A dependency in this vocabulary IS a read of a name, and the
   *  emitted vocabulary spells that `uses`; zero live uses of this member. */
  Dependency = "uses",
  /** @deprecated use {@link Overrides}. Singular spelling of the same value. */
  Override = "overrides",
  /** @deprecated use {@link Contains}. Composition is whole/part membership = containment;
   *  zero live uses of this member. */
  Composition = "contains",
  /** @deprecated use {@link Exports}. `Provides` names what a unit makes reachable, which this
   *  vocabulary spells `exports`; live site: src/ast/real-vue-analyzer.ts. */
  Provides = "exports",
  /** @deprecated use {@link References}. A generic "related to" is a name read; zero live uses. */
  Related = "references",
  /** @deprecated use {@link Contains}. Part-of is containment; zero live uses of this member. */
  PartOf = "contains",

  // REMOVED 2026-10-17: `DependsOn = "references"`. It was the ONE member name in the three enums
  // that meant DIFFERENT strings in different files — `references` here and in engine.ts, but
  // `depends_on` in graph.ts — so an edge authored as `DependsOn` would be stored as one string or
  // the other depending on which import the file used: a silent data-corruption class. It had zero
  // live uses, which is exactly why it is removed NOW, before something fires it and nobody can
  // tell which string the intent became. `depends_on` is DERIVED-only and lives in
  // GraphIntelligence.RelationshipType.DependsOnDerived (see src/ast/graph.ts).
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

/**
 * THE BINDING SEPARATOR — the character a relationship target carries when it names a
 * BINDING rather than a declaration.
 *
 * The family contract publishes no locals, parameters or lambda parameters as symbols (the
 * csharp/python/go parity ruling, recorded for dart as DARTD8), so an edge that reads a local
 * has no declaration to point at — but it still has to say WHICH binding it read, and the
 * string it writes is what the store resolves. `parallel-indexer.ts:resolveRelationships`
 * matches that string against `qualified_name` (Strategy 1) and then against a bare `name`
 * admitted only while the name is declared exactly once in the project (Strategy 2), and it
 * does not read the edge's metadata while doing it.
 *
 * A bare local name is therefore indistinguishable from a declaration's name, and wherever the
 * local's name collides with a UNIQUE declaration the read is bound to that declaration. This
 * is not a hypothesis: `validation/m14/fixtures/dart/local-read-phantom.ts` reproduces it
 * in-repo — a function's own `counter` binds to an unrelated class's field of the same name,
 * with `metadata.isLocalRead` set and the store's own rule (`classifyEdge`) reporting
 * `resolved`. The analyzer's comment at the call site used to claim the opposite ("the family
 * contract publishes no locals, so the target binds to nothing a consumer holds"); the claim
 * was about the FAMILY's contract, and the defect is that the SPELLING did not carry it.
 *
 * `#` cannot appear in an identifier in any language of this family (`[A-Za-z_$]` and the
 * alphanumerics that follow it, in every spelling) — TRUE, and not enough. The tripwire that
 * makes this claim checkable is over PUBLISHED KEYS, not identifiers, and a published key is
 * not always an identifier: a CSS ID selector is written `#sidebar`, a markdown label
 * `code_block#2`, an HCL address `aws#2.region`, a TOML key `units#2.name`, a julia struct
 * `layer::ScopeLayer\n # For provenance`. Measured across laptop B's 23 lanes, NINE of them
 * publish keys containing `#`, and in each of those runs EVERY binding claim became
 * unverifiable — the gate could not tell a binding spelling from a declaration's name
 * (validation/m14/results/incoming-laptop-b.log). The lane cannot fix it by renaming: `#` is
 * the language's own syntax in CSS and SCSS, so the separator is what has to move.
 *
 * U+0000 cannot appear in a published key, and that is structural rather than conventional:
 * tree-sitter parses TEXT, keys are built from node text, and a NUL byte in source terminates
 * the document rather than naming anything in it. It is also invisible to the leaf rules below
 * (no consumer splits on NUL), which is the property that ruled out `.` and `:`.
 *
 * Deliberately NOT `.` and NOT `:`. Consumers take the LEAF of an unresolved target as "the
 * name this edge is about" (`src/intelligence/patterns/orphans.ts`: after the last colon, then
 * after the last dot), which would reduce a dotted or colon-joined spelling straight back to
 * the bare local name and reopen the false name match this constant exists to close.
 */
export const BINDING_SEP = "\u0000"

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
