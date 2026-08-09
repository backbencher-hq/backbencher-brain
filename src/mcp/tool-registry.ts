import type { ToolMutability } from "../contracts/tool-contracts"

export type JsonSchemaProperty = {
  type: "string" | "number" | "boolean" | "array" | "object"
  description?: string
  enum?: readonly string[]
  items?: JsonSchemaProperty
}

export interface ToolInputSchema {
  type: "object"
  properties: Readonly<Record<string, JsonSchemaProperty>>
  required?: readonly string[]
}

export interface ToolDocumentation {
  category: "search" | "analysis" | "operations" | "lifecycle"
  summary: string
  defaults: Readonly<Record<string, string | number | boolean>>
  examples: readonly Readonly<Record<string, unknown>>[]
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: ToolInputSchema
  mutability: ToolMutability
  requiresIndex: boolean
  modes: readonly string[]
  aliases: readonly string[]
  deprecated: boolean
  replacement?: {
    tool: string
    mode?: string
  }
  documentation: ToolDocumentation
}

const descriptors = [
  {
    name: "bb_search",
    description: "Unified indexed retrieval for symbol lists, content, exact symbol source, or files. This is retrieval, not natural-language explanation or code analysis.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["symbols", "content", "symbol", "file"], description: "retrieval mode (default symbols)" },
        query: { type: "string", description: "symbol/content query; also accepted as the exact symbol name" },
        symbolName: { type: "string", description: "exact symbol name for symbol mode" },
        filePath: { type: "string", description: "file target or symbol disambiguation" },
        limit: { type: "number", description: "max results (default 15)" },
        language: { type: "string", description: "filter by language (e.g. typescript, python, go)" },
        symbolKind: { type: "string", description: "filter by symbol kind (function, class, variable, interface, enum, ...)" },
        includeContent: { type: "boolean", description: "include a code snippet per result (default false)" },
        exact: { type: "boolean", description: "only exact name matches (default false)" },
        caseSensitive: { type: "boolean", description: "case-sensitive matching (default false)" },
        regex: { type: "boolean", description: "treat query as a regex against symbol names (default false)" },
        offset: { type: "number", description: "pagination offset (default 0)" },
      },
      required: [],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbols", "content", "symbol", "file"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Unified lexical, content, exact-symbol, and file retrieval.", defaults: { mode: "symbols", limit: 15, includeContent: false, exact: false, caseSensitive: false, regex: false, offset: 0 }, examples: [{ mode: "symbols", query: "handleRequest", limit: 5 }, { mode: "symbol", symbolName: "handleRequest" }, { mode: "file", filePath: "src/app.ts" }] },
  },
  {
    name: "bb_select",
    description: "Extract a symbol's exact source by name. Optional filePath / lineStart disambiguate when the name exists in multiple files. Returns the exact code with byte bounds.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "exact symbol name" }, filePath: { type: "string", description: "partial or exact file path to disambiguate" }, lineStart: { type: "number", description: "line where the symbol starts (disambiguates overloads)" } }, required: ["symbolName"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbol"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_search", mode: "symbol" },
    documentation: { category: "search", summary: "Byte-precise symbol source retrieval.", defaults: {}, examples: [{ symbolName: "handleRequest" }] },
  },
  {
    name: "bb_relationships",
    description: "Find who calls a symbol (callers) or what it calls (callees). Direct by default; set includeIndirect for transitive traversal up to maxDepth. Cross-language aware.",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "symbol name" }, direction: { type: "string", enum: ["callers", "callees"], description: "direction (default callers)" }, includeIndirect: { type: "boolean", description: "traverse transitively (default false)" }, maxDepth: { type: "number", description: "max traversal depth when includeIndirect (default 3)" }, limit: { type: "number", description: "max results (default 15)" } }, required: ["target"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["callers", "callees"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_analyze", mode: "callers" },
    documentation: { category: "analysis", summary: "Direct or transitive callers and callees.", defaults: { direction: "callers", includeIndirect: false, maxDepth: 3, limit: 15 }, examples: [{ target: "handleRequest", direction: "callers" }] },
  },
  {
    name: "bb_ask",
    description: "Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "natural-language question" }, limit: { type: "number", description: "max results (default 5)" } }, required: ["query"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["answer"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Natural-language answers and semantic matches.", defaults: { limit: 5 }, examples: [{ query: "how does request handling work?" }] },
  },
  {
    name: "bb_health",
    description: "Unified index health: file/symbol/relationship/imports counts, embedding model + coverage, schema version, runtime, and file freshness. Use verbose=true for per-language breakdown and stale-file names, refresh=true to reindex before reporting, integrity=true for the 12-point index health check, complete=true for full (not sampled) freshness, includeAnalysisRuns=true for persisted run/finding totals, history=true for persisted analysis history.",
    inputSchema: { type: "object", properties: { verbose: { type: "boolean", description: "include stale/missing file names (default false)" }, history: { type: "boolean", description: "return persisted analysis history (default false)" }, limit: { type: "number", description: "history run limit (default 20)" }, refresh: { type: "boolean", description: "reindex the project before reporting" }, force: { type: "boolean", description: "force a full in-place reindex before reporting" }, wait: { type: "boolean", description: "wait for refresh to finish (default true)" }, freshness: { type: "string", enum: ["sampled", "complete"], description: "freshness mode (default sampled)" }, sampleSize: { type: "number", description: "freshness sample count (default 200)" }, integrity: { type: "boolean", description: "run the 12-point index integrity check" }, includeAnalysisRuns: { type: "boolean", description: "include persisted analysis run/finding totals" } } },
    mutability: "read",
    requiresIndex: false,
    modes: ["status", "refresh"],
    aliases: [],
    deprecated: false,
    documentation: { category: "lifecycle", summary: "Unified index, schema, freshness, embeddings, runtime, integrity, and analysis history.", defaults: { verbose: false, history: false, limit: 20, refresh: false, force: false, wait: true, freshness: "sampled", sampleSize: 200, integrity: false, includeAnalysisRuns: false }, examples: [{ verbose: true }, { history: true }, { refresh: true, force: true }, { integrity: true }, { freshness: "complete" }, { includeAnalysisRuns: true }] },
  },
  {
    name: "bb_patterns",
    description: "Detect orphaned code, framework patterns, anti-patterns, and architecture issues. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional pattern/confidence filters.",
    inputSchema: { type: "object", properties: { scope: { type: "string", enum: ["orphaned", "all"], description: "orphaned only, or all pattern classes (default all)" }, limit: { type: "number", description: "max results (default 20)" }, includeOrphaned: { type: "boolean", description: "include orphaned-code patterns in an all scan (default true)" }, includeFramework: { type: "boolean", description: "include framework patterns (default true)" }, includeAntiPatterns: { type: "boolean", description: "include anti-patterns (default true)" }, confidenceThreshold: { type: "number", description: "minimum confidence 0..1 (default 0.6)" }, history: { type: "boolean", description: "return persisted pattern history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["orphaned", "all"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Pattern/orphan analysis with optional persisted run history.", defaults: { scope: "all", limit: 20, includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0.6, history: false, recordRun: false }, examples: [{ scope: "orphaned" }, { recordRun: true }] },
  },
  {
    name: "bb_security",
    description: "Cross-language security scan: SQL injection, XSS, command injection, hardcoded secrets, weak crypto.",
    inputSchema: { type: "object", properties: { history: { type: "boolean", description: "return persisted security history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run" }, limit: { type: "number", description: "history run limit (default 20)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["findings"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Cross-language findings with optional persisted run history.", defaults: { history: false, recordRun: false, limit: 20 }, examples: [{}, { recordRun: true }, { history: true }] },
  },
  {
    name: "bb_visualize",
    description: "Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and self-contained HTML.",
    inputSchema: { type: "object", properties: { scope: { type: "string", enum: ["project", "file", "module", "symbol", "feature"], description: "graph scope (default project)" }, target: { type: "string", description: "file, module, symbol, or feature target" }, maxNodes: { type: "number", description: "max nodes (default 200)" }, maxLinks: { type: "number", description: "max links (default 5000)" }, relationshipTypes: { type: "array", items: { type: "string" }, description: "relationship type filter" }, languages: { type: "array", items: { type: "string" }, description: "language filter" }, format: { type: "string", enum: ["text", "json", "html"], description: "output format (default text)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["project", "file", "module", "symbol", "feature", "text", "json", "html"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Scoped canonical dependency graphs with explicit truncation and provenance.", defaults: { scope: "project", maxNodes: 200, maxLinks: 5000, format: "text" }, examples: [{ scope: "symbol", target: "handleRequest", format: "json" }, { scope: "module", target: "src/api", format: "html" }] },
  },
  {
    name: "bb_migrate",
    description: "Read-only single or batch migration planning with dependency order, explicit effort methodology, library mappings, risks, truncation, and unsupported cases.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "legacy single symbol alias" }, symbolNames: { type: "array", items: { type: "string" }, description: "one or more symbols to migrate" }, targetLanguage: { type: "string", description: "e.g. rust, go, python" }, format: { type: "string", enum: ["text", "json"], description: "output format (default text)" } }, required: ["targetLanguage"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["plan"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Batch cross-language migration plans with ordering, methodology, and unsupported mappings.", defaults: { format: "text" }, examples: [{ symbolName: "handleRequest", targetLanguage: "go" }, { symbolNames: ["parse", "handle"], targetLanguage: "rust", format: "json" }] },
  },
  {
    name: "bb_analyze",
    description: "Unified evidence-backed analysis over graph relationships, dependencies, statistics, complexity, impact, and test intelligence. Select exactly one mode.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], description: "analysis mode" }, target: { type: "string", description: "symbol or analysis target" }, filePath: { type: "string", description: "file scope for file-based analysis" }, limit: { type: "number", description: "result limit" } }, required: ["mode"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "One typed analysis surface replacing standalone relationship and test intelligence names.", defaults: { limit: 20 }, examples: [{ mode: "callers", target: "handleRequest" }, { mode: "complexity", target: "src/api" }, { mode: "test_quality" }] },
  },
  {
    name: "bb_doc",
    description: "Generate read-only, evidence-backed documentation with resolvable citations. Supports symbol, file, module, feature, API, project, and documentation-coverage modes in Markdown or JSON.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["symbol", "file", "module", "feature", "api", "project", "coverage"], description: "documentation mode" }, target: { type: "string", description: "symbol, file, module, feature, or API target; optional for project and coverage" }, format: { type: "string", enum: ["markdown", "json"], description: "output format (default markdown)" }, audience: { type: "string", enum: ["developer", "maintainer", "user", "website"], description: "documentation audience" }, detail: { type: "string", enum: ["brief", "standard", "deep"], description: "detail level" }, includeExamples: { type: "boolean", description: "include only source-backed examples" }, includeDiagrams: { type: "boolean", description: "include cited diagrams when available" }, includeTests: { type: "boolean", description: "include indexed test evidence" }, limit: { type: "number", description: "maximum evidence items" }, maxTokens: { type: "number", description: "output token budget" } }, required: ["mode"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbol", "file", "module", "feature", "api", "project", "coverage"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Cited Markdown or JSON documentation over indexed source and relationships.", defaults: { format: "markdown", audience: "developer", detail: "standard", includeExamples: false, includeDiagrams: false, includeTests: false, limit: 20, maxTokens: 4000 }, examples: [{ mode: "symbol", target: "handleRequest" }, { mode: "feature", target: "request handling", format: "json" }, { mode: "coverage", target: "src" }] },
  },
  {
    name: "bb_refresh",
    description: "Re-index the project (incremental by default; use force to rebuild from scratch). Requires an existing index.",
    inputSchema: { type: "object", properties: { force: { type: "boolean", description: "wipe and rebuild (default false)" }, wait: { type: "boolean", description: "wait for the reindex to finish (default true)" }, freshness: { type: "string", enum: ["sampled", "complete"], description: "freshness mode for the post-refresh report (default sampled)" } } },
    mutability: "index",
    requiresIndex: true,
    modes: ["refresh"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_health", mode: "refresh" },
    documentation: { category: "lifecycle", summary: "Incremental or in-place forced reindex with a post-refresh health report.", defaults: { force: false, wait: true, freshness: "sampled" }, examples: [{ force: true }, { wait: false }] },
  },
  {
    name: "bb_write",
    description: "Create a new file with the given content (overwrites if it exists).",
    inputSchema: { type: "object", properties: { filePath: { type: "string", description: "path relative to the project root" }, content: { type: "string", description: "file content" } }, required: ["filePath", "content"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["write"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_edit", mode: "write" },
    documentation: { category: "operations", summary: "Create or overwrite a project file and reindex it.", defaults: {}, examples: [{ filePath: "src/new.ts", content: "export const value = 1" }] },
  },
  {
    name: "bb_update",
    description: "Replace a symbol's exact source with new content (byte-precise).",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "symbol to replace" }, newContent: { type: "string", description: "replacement source" }, filePath: { type: "string", description: "disambiguate when the name exists in multiple files" } }, required: ["symbolName", "newContent"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["update"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_edit", mode: "update" },
    documentation: { category: "operations", summary: "Replace indexed symbol source and reindex.", defaults: {}, examples: [{ symbolName: "helper", newContent: "export function helper() { return 2 }" }] },
  },
  {
    name: "bb_insert",
    description: "Insert code relative to an anchor symbol (before, after, inside-top, inside-bottom).",
    inputSchema: { type: "object", properties: { targetSymbolName: { type: "string", description: "anchor symbol" }, position: { type: "string", enum: ["before", "after", "inside-top", "inside-bottom"], description: "insertion position" }, newContent: { type: "string", description: "code to insert" }, filePath: { type: "string", description: "disambiguate the anchor" } }, required: ["targetSymbolName", "position", "newContent"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["insert"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_edit", mode: "insert" },
    documentation: { category: "operations", summary: "Insert source relative to an indexed symbol.", defaults: {}, examples: [{ targetSymbolName: "helper", position: "after", newContent: "export const next = true" }] },
  },
  {
    name: "bb_delete",
    description: "Delete a symbol's exact source and prune now-unused imports.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "symbol to delete" }, filePath: { type: "string", description: "disambiguate the symbol" } }, required: ["symbolName"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["delete"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_edit", mode: "delete" },
    documentation: { category: "operations", summary: "Delete indexed symbol source, prune imports, and reindex.", defaults: {}, examples: [{ symbolName: "obsoleteHelper" }] },
  },
  {
    name: "bb_refactor",
    description: "Rename a symbol across the codebase: declaration plus all caller sites.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "current name" }, newName: { type: "string", description: "new name" }, filePath: { type: "string", description: "disambiguate the declaration" } }, required: ["symbolName", "newName"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["refactor"],
    aliases: [],
    deprecated: false,
    replacement: { tool: "bb_edit", mode: "refactor" },
    documentation: { category: "operations", summary: "Rename a symbol declaration and caller references.", defaults: {}, examples: [{ symbolName: "oldName", newName: "newName" }] },
  },
  {
    name: "bb_edit",
    description: "Unified, validated source mutation. Discriminated by mode: write, update, insert, delete, or refactor. Supports dry-run previews, separator/symlink-safe paths, AST byte bounds, caller protection, rollback on validation failure, formatting, and reindexing.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["write", "update", "insert", "delete", "refactor"] }, dryRun: { type: "boolean" }, filePath: { type: "string" }, symbolName: { type: "string" }, lineStart: { type: "number" }, content: { type: "string" }, newContent: { type: "string" }, targetSymbolName: { type: "string" }, position: { type: "string", enum: ["before", "after", "inside-top", "inside-bottom"] }, newName: { type: "string" }, force: { type: "boolean" }, format: { type: "boolean" } }, required: ["mode"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["write", "update", "insert", "delete", "refactor"],
    aliases: [],
    deprecated: false,
    documentation: { category: "operations", summary: "Unified safe source editing with preview, validation, rollback, and reindex.", defaults: { dryRun: false, format: true, force: false }, examples: [{ mode: "update", symbolName: "helper", newContent: "export function helper() { return 2 }" }, { mode: "insert", targetSymbolName: "main", position: "inside-top", newContent: "const started = true" }, { mode: "write", filePath: "src/new.ts", content: "export const value = 1" }] },
  },
  {
    name: "bb_test_quality",
    description: "Evidence-based per-test-file quality from brain_* tables + file content: independently-measured dimensions (assertions, mocking, error handling, parameterization, docs, fixtures) with capability flags and explicit unknown states (never fabricated). Replaces the legacy LOC-based test-quality heuristic.",
    inputSchema: { type: "object", properties: { maxFiles: { type: "number", description: "max test files to content-analyze (default 50)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["analyze"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Static, capability-flagged test quality report.", defaults: { maxFiles: 50 }, examples: [{}] },
  },
  {
    name: "bb_test_suggestions",
    description: "Test recommendations for changed production symbols (added/modified/deleted). Evidence-first: existing affected tests are recommended before creating new files. Naming conventions are only a low-confidence flagged fallback. Recommendation text only; no test code is generated or written.",
    inputSchema: { type: "object", properties: { changed: { type: "array", description: "array of {name,file,kind}; kind is added|modified|deleted" } }, required: ["changed"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["suggest"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Changed-symbol test suggestions, evidence-first.", defaults: {}, examples: [{ changed: [{ name: "add", file: "src/calc.ts", kind: "modified" }] }] },
  },
] as const satisfies readonly ToolDescriptor[]

export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = descriptors


export const PUBLIC_TOOL_NAMES = new Set([
  "bb_search", "bb_ask", "bb_analyze", "bb_patterns", "bb_security",
  "bb_doc", "bb_visualize", "bb_migrate", "bb_edit", "bb_health",
])

export const PUBLIC_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = descriptors.filter((descriptor) => PUBLIC_TOOL_NAMES.has(descriptor.name))

export const COMPATIBILITY_ALIASES = {
  bb_select: { replacement: "bb_search", mode: "symbol", removalRelease: "0.3.0" },
  bb_relationships: { replacement: "bb_analyze", mode: "callers|callees|trace", removalRelease: "0.3.0" },
  bb_refresh: { replacement: "bb_health", mode: "refresh", removalRelease: "0.3.0" },
  bb_write: { replacement: "bb_edit", mode: "write", removalRelease: "0.3.0" },
  bb_update: { replacement: "bb_edit", mode: "update", removalRelease: "0.3.0" },
  bb_insert: { replacement: "bb_edit", mode: "insert", removalRelease: "0.3.0" },
  bb_delete: { replacement: "bb_edit", mode: "delete", removalRelease: "0.3.0" },
  bb_refactor: { replacement: "bb_edit", mode: "refactor", removalRelease: "0.3.0" },
  bb_test_quality: { replacement: "bb_analyze", mode: "test_quality", removalRelease: "0.3.0" },
  bb_test_suggestions: { replacement: "bb_analyze", mode: "test_impact", removalRelease: "0.3.0" },
} as const


export function validateToolDescriptors(items: readonly ToolDescriptor[]): void {
  const names = new Set<string>()
  for (const item of items) {
    if (!item.name || names.has(item.name)) throw new Error(`duplicate or empty tool name: ${item.name || "<empty>"}`)
    names.add(item.name)
    if (item.inputSchema.type !== "object") throw new Error(`${item.name}: input schema must be an object`)
    const properties = item.inputSchema.properties ?? {}
    for (const required of item.inputSchema.required ?? []) {
      if (!(required in properties)) throw new Error(`${item.name}: required field ${required} is not declared`)
    }
    if (new Set(item.modes).size !== item.modes.length) throw new Error(`${item.name}: duplicate modes`)
    if (new Set(item.aliases).size !== item.aliases.length) throw new Error(`${item.name}: duplicate aliases`)
    if (item.deprecated && !item.replacement) throw new Error(`${item.name}: deprecated tools require a replacement`)
  }
}

validateToolDescriptors(TOOL_DESCRIPTORS)

export function toMcpToolList(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): Array<Pick<ToolDescriptor, "name" | "description" | "inputSchema">> {
  return items.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

export function serializeToolMetadata(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): string {
  return JSON.stringify(items, null, 2)
}
