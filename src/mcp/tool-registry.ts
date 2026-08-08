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
    description: "Search the AST index for symbols (functions, classes, variables). Exact/prefix/substring ranked, with optional regex, symbol-kind and language filters, code snippets, pagination, and a stale flag when the file changed since indexing.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "symbol name or fragment (regex when regex=true)" },
        limit: { type: "number", description: "max results (default 15)" },
        language: { type: "string", description: "filter by language (e.g. typescript, python, go)" },
        symbolKind: { type: "string", description: "filter by symbol kind (function, class, variable, interface, enum, ...)" },
        includeContent: { type: "boolean", description: "include a code snippet per result (default false)" },
        exact: { type: "boolean", description: "only exact name matches (default false)" },
        caseSensitive: { type: "boolean", description: "case-sensitive matching (default false)" },
        regex: { type: "boolean", description: "treat query as a regex against symbol names (default false)" },
        offset: { type: "number", description: "pagination offset (default 0)" },
      },
      required: ["query"],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbols"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Ranked symbol search over the indexed project.", defaults: { limit: 15, includeContent: false, exact: false, caseSensitive: false, regex: false, offset: 0 }, examples: [{ query: "handleRequest", limit: 5 }] },
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
    description: "Dependency graph summary: node/link counts and the most-connected symbols, built with the real graph engine. Use format=json for machine-readable nodes+links, format=html for a self-contained 3D interactive map.",
    inputSchema: { type: "object", properties: { maxNodes: { type: "number", description: "max nodes (default 200)" }, format: { type: "string", enum: ["text", "json", "html"], description: "output format (default text)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["text", "json", "html"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Dependency graph summaries and artifacts.", defaults: { maxNodes: 200, format: "text" }, examples: [{ format: "json", maxNodes: 100 }] },
  },
  {
    name: "bb_migrate",
    description: "Migration plan for porting a symbol to another language (library equivalents, effort, risk). Read-only.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "symbol to migrate" }, targetLanguage: { type: "string", description: "e.g. rust, go, python" } }, required: ["symbolName", "targetLanguage"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["plan"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Cross-language migration plan generation.", defaults: {}, examples: [{ symbolName: "handleRequest", targetLanguage: "go" }] },
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
