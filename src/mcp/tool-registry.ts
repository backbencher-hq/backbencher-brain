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
  category: "search" | "analysis" | "operations" | "lifecycle" | "graph" | "annotations"
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
  /** Modes on the roadmap but NOT executable. Never advertised as available. */
  plannedModes?: readonly string[]
  /**
   * M35.E1: modes whose JSON envelope must carry the registered staleness
   * block ({ fresh, stale, missing, staleRatio, mode, remediation }).
   * Enforced by script/m35/verify-envelope-contract.ts against the real
   * handlers: a registered mode that omits the block fails the gate.
   */
  freshnessModes?: readonly string[]
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
    description: "Unified indexed retrieval for symbol lists, content, exact symbol source, or files. This is retrieval, not natural-language explanation or code analysis. Symbol/content/file modes carry a freshness block ({ fresh, stale, missing, staleRatio, mode, remediation }) stating whether results reflect the current files; rows may carry stale=true. Remediation names the exact reindex command. When a read finds stale/missing files within budget, the handler auto-refreshes exactly those files (reindexFilesParallel) before answering and declares it in an autoRefresh field; refresh=false opts out and answers from existing data with the staleness block. Every response declares its match set: totalMatches is the number of matching symbols the page was cut from (not the page size) and truncated is true when a candidate cap or the noise filter kept matches out, so a short page is never mistaken for a complete one. Options a mode cannot honor are rejected with an error naming that mode's accepted options, never silently ignored. language and symbolKind are matched case-insensitively against the indexed vocabulary, and a value the index does not contain is reported as an error rather than as zero results.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["symbols", "content", "symbol", "file"], description: "retrieval mode (default symbols)" },
        query: { type: "string", description: "symbol/content/regex query, trimmed before use; also accepted as the exact symbol name in symbol mode. Not accepted in file mode" },
        symbolName: { type: "string", description: "exact symbol name for symbol mode; supplying it with a different query is an error" },
        filePath: { type: "string", description: "file target for file mode, or symbol disambiguation in symbol mode. Not accepted in symbols/content modes" },
        limit: { type: "number", description: "max results (default 15); 0 returns no rows; must be a whole number. symbols/content/symbol modes only" },
        language: { type: "string", description: "filter by language, case-insensitive (e.g. typescript, python, go); a language this project does not index is an error. symbols/content modes only" },
        symbolKind: { type: "string", description: "filter by symbol kind, case-insensitive (function, class, variable, interface, enum, ...); a kind this project does not index is an error. symbols/content modes only" },
        includeContent: { type: "boolean", description: "include a code snippet per result (default false). symbols mode only" },
        exact: { type: "boolean", description: "only exact name matches (default false); obeys caseSensitive. symbols mode only" },
        caseSensitive: { type: "boolean", description: "case-sensitive matching (default false); folds every Unicode case pair, not only ASCII. symbols mode only" },
        regex: { type: "boolean", description: "treat query as a regex against symbol names (default false). symbols mode only" },
        offset: { type: "number", description: "pagination offset (default 0)" },
        refresh: { type: "boolean", description: "false opts out of the inline auto-refresh of stale files (default: auto-refresh within budget before answering)" },
      },
      required: [],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbols", "content", "symbol", "file"],
    freshnessModes: ["symbol", "content", "file"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Unified lexical, content, exact-symbol, and file retrieval.", defaults: { mode: "symbols", limit: 15, includeContent: false, exact: false, caseSensitive: false, regex: false, offset: 0 }, examples: [{ mode: "symbols", query: "handleRequest", limit: 5 }, { mode: "content", query: "serialize cache entry" }, { mode: "symbol", symbolName: "handleRequest" }, { mode: "file", filePath: "src/app.ts" }] },
  },
  {
    name: "bb_ask",
    description: "Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "natural-language question" }, limit: { type: "number", description: "max results (default 5)" } }, required: ["query"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["answer"],
    plannedModes: ["explain", "feature"],
    aliases: [],
    deprecated: false,
    documentation: { category: "search", summary: "Natural-language answers and semantic matches.", defaults: { limit: 5 }, examples: [{ query: "how does request handling work?" }] },
  },
  {
    name: "bb_health",
    description: "Unified index health: file/symbol/relationship/imports counts, embedding model + coverage, schema version, runtime, and file freshness. Use verbose=true for per-language breakdown and stale-file names, refresh=true to reindex before reporting, force=true to force a full in-place reindex before reporting, integrity=true for the 12-point index health check, complete=true for full (not sampled) freshness, includeAnalysisRuns=true for persisted run/finding totals, history=true for persisted analysis history.",
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
    description: "Detect orphaned code, framework patterns, and anti-patterns, ranked by evidence-derived confidence, with staleness markers when a finding's file changed after indexing. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional pattern/confidence filters. Architecture and code-quality analysis are planned, not yet executable.",
    inputSchema: { type: "object", properties: { scope: { type: "string", enum: ["orphaned", "all"], description: "orphaned only, or all pattern classes (default all)" }, limit: { type: "number", description: "max results (default 20)" }, includeOrphaned: { type: "boolean", description: "include orphaned-code patterns in an all scan (default true)" }, includeFramework: { type: "boolean", description: "include framework patterns (default true)" }, includeAntiPatterns: { type: "boolean", description: "include anti-patterns (default true)" }, confidenceThreshold: { type: "number", description: "drop findings below this confidence (default 0 = report everything, ranked). Orphan confidence is evidence-derived and spans 0.3-0.7; anti-pattern confidence is 0.6-0.9" }, history: { type: "boolean", description: "return persisted pattern history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run (persists the whole census, not the displayed page)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["orphaned", "all"],
    plannedModes: ["quality", "architecture"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Pattern/orphan analysis ranked by evidence-derived confidence, with optional persisted run history.", defaults: { scope: "all", limit: 20, includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, history: false, recordRun: false }, examples: [{ scope: "orphaned" }, { confidenceThreshold: 0.6 }, { recordRun: true }] },
  },
  {
    name: "bb_security",
    description: "Cross-language security scan: SQL injection, XSS, command injection, hardcoded secrets, weak crypto. Findings whose underlying file changed after indexing carry a staleness marker.",
    inputSchema: { type: "object", properties: { history: { type: "boolean", description: "return persisted security history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run" }, limit: { type: "number", description: "history run limit (default 20)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["findings"],
    plannedModes: ["flow", "summary", "hotspots"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Cross-language findings with optional persisted run history.", defaults: { history: false, recordRun: false, limit: 20 }, examples: [{}, { recordRun: true }, { history: true }] },
  },
  {
    name: "bb_visualize",
    description: "Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and self-contained HTML. Every node and link carries a stale flag (file changed since index); links inherit worst-of-endpoints; a freshness envelope rides the JSON output. Same owner-cascade semantics as bb_graph: member-level relationships are attributed to the owner class.",
    inputSchema: { type: "object", properties: { scope: { type: "string", enum: ["project", "file", "module", "symbol", "feature"], description: "graph scope (default project)" }, target: { type: "string", description: "file, module, symbol, or feature target (`symbol`/`symbolName`/`query` are accepted as aliases)" }, maxNodes: { type: "number", description: "max nodes (default 200)" }, maxLinks: { type: "number", description: "max links (default 5000)" }, relationshipTypes: { type: "array", items: { type: "string" }, description: "relationship type filter" }, languages: { type: "array", items: { type: "string" }, description: "language filter" }, format: { type: "string", enum: ["text", "json", "html"], description: "output format (default text)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["project", "file", "module", "symbol", "feature"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Scoped canonical dependency graphs with explicit truncation and provenance.", defaults: { scope: "project", maxNodes: 200, maxLinks: 5000, format: "text" }, examples: [{ scope: "symbol", target: "handleRequest", format: "json" }, { scope: "module", target: "src/api", format: "html" }] },
  },
  {
    name: "bb_migrate",
    description: "Read-only single or batch migration planning with dependency order, explicit effort methodology, library mappings, risks, truncation, and unsupported cases. Plans whose source file changed since the last index are flagged stale up front — a plan is a claim about current code; JSON output carries the freshness block.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "legacy single symbol alias" }, symbolNames: { type: "array", items: { type: "string" }, description: "one or more symbols to migrate" }, targetLanguage: { type: "string", description: "e.g. rust, go, python" }, format: { type: "string", enum: ["text", "json"], description: "output format (default text)" } }, required: ["targetLanguage"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["plan"],
    freshnessModes: ["plan"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Batch cross-language migration plans with ordering, methodology, and unsupported mappings.", defaults: { format: "text" }, examples: [{ symbolName: "handleRequest", targetLanguage: "go" }, { symbolNames: ["parse", "handle"], targetLanguage: "rust", format: "json" }] },
  },
  {
    name: "bb_analyze",
    description: "Unified evidence-backed analysis over graph relationships, dependencies, project statistics, complexity, impact, and test intelligence. Select exactly one mode. Every read mode carries a freshness block (fresh/stale/missing counts + remediation) resolved against the live working tree, and report rows carry a stale flag when their file changed after indexing. Every mode is BOUNDED and says so: `limit` is the most items returned (edges per direction for callers/callees/trace, files for dependencies, entries for the test modes, the same everywhere) and the answer reports what it returned against what exists, so a page is never read as the whole set. callers/callees/trace/impact share the graph engine's owner-cascade semantics — a relationship stored against a class member is attributed to the owner class — and every edge states which it was through `targetMatch`. Locations are project-relative. Per-mode parameters: target applies to callers, callees, trace, complexity, impact, and test_impact; filePath scopes dependencies, test_mapping, test_gaps, and test_quality to a project-relative path PREFIX and is REFUSED (not ignored) on every other mode; limit applies to callers, callees, trace, dependencies, test_mapping, test_gaps and test_quality and is refused elsewhere; stats is always project-wide.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], description: "analysis mode" }, target: { type: "string", description: "A symbol name for callers/callees/trace/impact/test_impact, or a project-relative FILE PATH for complexity (exact file, or a directory prefix; anything else is refused rather than treated as a path fragment). `symbol`/`symbolName`/`query` are accepted as aliases. A target is a VALUE, never a pattern: `%`, `_` and `\\` are escaped and match themselves." }, filePath: { type: "string", description: "Project-relative path PREFIX scoping dependencies, test_mapping, test_gaps and test_quality. Refused on every other mode. Matched on a whole segment boundary, so `src/util` does not match `src/utilities`." }, limit: { type: "number", description: "Maximum items returned: edges per direction for callers/callees/trace, files for dependencies, entries for test_mapping/test_gaps/test_quality. Defaults: 25 edges per direction, 20 files, 50 entries. The answer reports what it returned and whether that is the whole set. Refused on the modes it does not apply to, and `limit: 0` is refused because an empty page is indistinguishable from a real answer." } }, required: ["mode"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"],
    // M35.S1: every bb_analyze mode is a read path over the index — all carry
    // the staleness envelope on their output.
    freshnessModes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"],
    aliases: [],
    deprecated: false,
    documentation: {
      category: "analysis",
      summary: "One typed analysis surface over the graph, the file graph, project counts, complexity, impact and test evidence. Every mode is bounded, declares its own bounds, and reports what it returned against what exists.",
      defaults: { limit: 20 },
      examples: [{ mode: "callers", target: "handleRequest" }, { mode: "complexity", target: "src/api" }, { mode: "test_quality" }, { mode: "dependencies", filePath: "src/core" }, { mode: "impact", target: "handleRequest", limit: 50 }],
    },
  },
  {
    name: "bb_doc",
    description: "Generate read-only, evidence-backed documentation with resolvable citations and a freshness block over the cited files. Every mode emits its declared section set, an empty result is never reported as passing, and the token budget is enforced against the whole payload. Supports symbol, file, module, feature, API, project, and documentation-coverage modes in Markdown or JSON. When the cited files are stale, the handler auto-refreshes exactly those files within budget and regenerates the document; refresh=false opts out and answers from existing data with the freshness block.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["symbol", "file", "module", "feature", "api", "project", "coverage"], description: "documentation mode" }, target: { type: "string", description: "symbol, file, module, feature, or API target (`symbol`/`symbolName`/`query` are accepted as aliases); optional for project and coverage" }, format: { type: "string", enum: ["markdown", "json"], description: "output format (default markdown)" }, audience: { type: "string", enum: ["developer", "maintainer", "user", "website"], description: "documentation audience" }, detail: { type: "string", enum: ["brief", "standard", "deep"], description: "detail level" }, includeExamples: { type: "boolean", description: "include only source-backed examples" }, includeDiagrams: { type: "boolean", description: "include cited diagrams when available" }, includeTests: { type: "boolean", description: "include indexed test evidence" }, limit: { type: "number", description: "maximum evidence items" }, maxTokens: { type: "number", description: "output token budget" }, refresh: { type: "boolean", description: "false opts out of the inline auto-refresh of the files this document cites (default: auto-refresh those files within budget, then regenerate)" } }, required: ["mode"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbol", "file", "module", "feature", "api", "project", "coverage"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Cited Markdown or JSON documentation over indexed source and relationships.", defaults: { format: "markdown", audience: "developer", detail: "standard", includeExamples: false, includeDiagrams: false, includeTests: false, limit: 20, maxTokens: 4000 }, examples: [{ mode: "symbol", target: "handleRequest" }, { mode: "feature", target: "request handling", format: "json" }, { mode: "coverage", target: "src" }] },
  },
  {
    name: "bb_edit",
    description: "Unified, validated source mutation. Discriminated by mode: write, update, insert, delete, or refactor. Supports dry-run previews, separator/symlink-safe paths, AST byte bounds, caller protection, rollback on validation failure, formatting, and reindexing. If the target file changed since it was indexed, this tool refreshes that one file and re-resolves the symbol before editing (reported in warnings) — an edit is never applied to stale byte bounds, and a symbol that was renamed or removed is refused by name.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["write", "update", "insert", "delete", "refactor"], description: "Edit kind: write (create or overwrite a file), update (replace a symbol body), insert (add code relative to a symbol), delete (remove a symbol), or refactor (identifier-aware rename)" }, dryRun: { type: "boolean", description: "Preview the planned changes without writing any file (default false)" }, filePath: { type: "string", description: "write: project-relative target file to create or overwrite. Other modes: disambiguates symbolName when it appears in multiple files" }, symbolName: { type: "string", description: "Name of the symbol to update, delete, or refactor (the index must contain it; a target file changed since indexing is refreshed automatically before the edit)" }, lineStart: { type: "number", description: "Declaration line of the target symbol, used with symbolName/filePath to disambiguate repeated names" }, content: { type: "string", description: "Full file content for write mode; also accepted in place of newContent for update and insert" }, newContent: { type: "string", description: "Replacement source: update swaps the symbol body for this text; insert adds this text relative to targetSymbolName" }, targetSymbolName: { type: "string", description: "insert: symbol whose body or boundary receives the new code (required for insert)" }, position: { type: "string", enum: ["before", "after", "inside-top", "inside-bottom"], description: "insert anchor relative to targetSymbolName (default after)" }, newName: { type: "string", description: "refactor: the valid identifier the symbol is renamed to" }, force: { type: "boolean", description: "delete: allow removal when indexed callers or live references survive; leftovers are reported as warnings (default false)" }, format: { type: "boolean", description: "Run the project formatter on written files after the edit (default true)" } }, required: ["mode"] },
    mutability: "write",
    requiresIndex: true,
    modes: ["write", "update", "insert", "delete", "refactor"],
    aliases: [],
    deprecated: false,
    documentation: { category: "operations", summary: "Unified safe source editing with preview, validation, rollback, and reindex.", defaults: { dryRun: false, format: true, force: false }, examples: [{ mode: "update", symbolName: "helper", newContent: "export function helper() { return 2 }" }, { mode: "insert", targetSymbolName: "main", position: "inside-top", newContent: "const started = true" }, { mode: "write", filePath: "src/new.ts", content: "export const value = 1" }] },
  },
  {
    // M22.E1: agent-driven freshness — an agent that just wrote/edited a file
    // can immediately make it (and only it) visible instead of waiting for a
    // full reindex. This is the direct fix for "agent created a function,
    // seconds later it's not in the DB".
    name: "bb_index",
    description: "Reindex a file or directory so the index reflects edits immediately (agent-fresh). Accepts a path (file or dir); a file reindexes only that file, a dir runs an incremental index of that dir (changed files only). mode=post re-runs the heavy derived-data phases (relationships/enrichment/gravity/taints/health) WITHOUT re-parsing — the remediation after edits on incremental paths. Returns indexed/deleted/error counts, or the per-phase post-processing report.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Project-relative file (reindex only that file) or directory (incremental index of changed files); for mode=post, the project whose derived phases should be re-run" }, mode: { type: "string", enum: ["auto", "file", "dir", "post"], description: "auto (default) infers file vs dir from path; file reindexes one file; dir runs an incremental directory index; post re-runs derived phases (relationships/taints/health) without re-parsing" } }, required: ["path"] },
    mutability: "write",
    requiresIndex: false,
    modes: ["auto", "file", "dir", "post"],
    aliases: [],
    deprecated: false,
    documentation: { category: "operations", summary: "Immediately refresh the index for a just-written/edited file or directory; mode=post re-derives relationships/taints/health without re-parsing.", defaults: { mode: "auto" }, examples: [{ path: "src/new-file.ts" }, { path: "src", mode: "dir" }, { path: "post", mode: "post" }] },
  },
  {
    // M28.T1 (issue #624): the agent door to the graph the IDE shows. The
    // handler reuses the same graph engine the LSP bb/graph handler uses —
    // one truth, two doors (M28 decision D-1/D-2).
    name: "bb_graph",
    description: "Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses; truncated traversals are declared with a reason, never silent. Traversal semantics: a relationship stored against any member of a class (a method call, an inherited behavior) is attributed to the owner class, so caller/callee sets include the owner-family level — every edge still traces to a stored relationship row.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "symbol name to root the graph at (`target`/`symbolName`/`query` are accepted as aliases)" },
        maxDepth: { type: "number", description: "traversal depth bound (default 3)" },
        direction: {
          type: "string",
          enum: ["callers", "callees", "both"],
          description:
            "which side to traverse (default both). 'callers' answers \"who depends on this\" and skips the callee walk entirely — on a real index that is the difference between 1 edge and 37 in the same payload.",
        },
        relationshipTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "stored relationship kinds to include. Default: calls, instantiates, extends, implements. Pass e.g. ['calls'] for the pure call graph, or ['implements'] to see only interface satisfaction. A kind that is not listed is never reported, so this is how you exclude the type-level 'uses'/'references' rows that make up roughly half of what a typical index stores.",
        },
        includeCrossLanguage: {
          type: "boolean",
          description: "include edges the indexer marked cross-language (default true). Set false for a single-language view.",
        },
        timeBudgetMs: {
          type: "number",
          description:
            "wall-clock budget for the whole walk in milliseconds (default 2000; 0 disables it). This is the one bound that is a function of the CLOCK rather than of the data, so a run that hits it can return fewer edges than an otherwise identical run moments later — `summary.timeBudgetExhausted` says when. Raise it, or set 0 to accept the runtime, when you need the whole set or a reproducible answer",
        },
        maxEdges: {
          type: "number",
          description:
            "hard cap on the number of edges in the WHOLE answer, across both directions and all depths (default 1000, max 5000). `edgeLimit` bounds one query and this bounds the answer; their product is what a caller receives. Reaching it is declared as `total-edge-limit` with the value in `summary.maxEdges`. Raise it for a hub symbol, lower it for a quick shape check",
        },
        edgeLimit: { type: "number", description: "Per-symbol call-site limit for one edge query (default 200, max 5000). Reaching it is declared in `summary.truncated` with `summary.truncationReason` and the root's true count in `summary.callersIfUncapped`/`summary.calleesIfUncapped` — the limit is never a silent cap. Raise it to receive more sites in one answer." },
      },
      required: ["symbol"],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["graph"],
    aliases: [],
    deprecated: false,
    documentation: {
      category: "graph",
      summary: "Per-symbol graph with per-edge evidence tiers — the agent view of the editor's graph panel.",
      defaults: { maxDepth: 3, direction: "both" },
      examples: [
        { symbol: "handleRequest" },
        { symbol: "handleRequest", maxDepth: 5 },
        { symbol: "handleRequest", direction: "callers" },
        { symbol: "Handler", relationshipTypes: ["calls"] },
      ],
    },
  },
  {
    // M28.T1 (issue #624): the agent door to bounded impact. Reuses
    // src/lsp/impact.ts (the component the editor graph panel's impact mode
    // uses) so agent and developer see identical totals and truncation.
    name: "bb_impact",
    description: "Bounded reverse-dependency impact for one symbol via the same component the editor graph panel uses: declared node budget (200) and depth (5), truncation as a first-class field with reason, and a declared total that is the size of the set the answer is a prefix of — measured, not inferred, so an answer that is short of the whole set says so even when no bound fired. Unknown symbols are loud declared errors — an empty impact set is never invented. Owner-cascade applies: impact includes dependents attributed at class level, not only exact-symbol rows. The relationship kinds that count are named in every answer's `rule.relationshipTypes` and can be overridden; a dependent carries its evidence tier, cross-language flag, bridge and position.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "symbol name to compute impact for (`target`/`symbolName`/`query` are accepted as aliases)" },
        relationshipTypes: { type: "array", items: { type: "string" }, description: "stored relationship kinds to count as dependencies. Default: calls, instantiates, extends, implements. A kind that is not listed is never reported, and the applied list is echoed in `rule.relationshipTypes` on every answer. This is the same control bb_graph has, so a caller who wants the type-level `uses`/`references` rows can ask for them on either door." },
        refresh: { type: "boolean", description: "set false to skip the bounded staleness repair and answer from the existing index. When omitted, stale files inside the answer are repaired and the walk is re-run so the answer is not built from the rows the refresh replaced." },
      },
      required: ["symbol"],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["impact"],
    aliases: [],
    deprecated: false,
    documentation: { category: "graph", summary: "Bounded impact with declared truncation — identical numbers to the editor's impact mode.", defaults: {}, examples: [{ symbol: "handleRequest" }] },
  },
  {
    // M28.T1 (issue #624): the agent door to cross-language facts. Reuses
    // src/lsp/cross_language_hover.ts (stored rows only, per-pair, declared
    // absence) — the agent reads the same facts the human's hover renders.
    // M63.CL1: same owner, a projection built for a reader that does not have
    // the card around it. Every fact names BOTH ends (the copy of the
    // requested name, and the counterparty's symbol/file/language/line) plus
    // the stored row id, because a language pair alone cannot answer "does my
    // Kotlin Warehouse reach my Java Inventory, and where" — the shape
    // bb_graph already returns. A name is many symbols in the index (`invoke`
    // is 227 in a 230-file JVM corpus), so the facts are the union over every
    // copy, `copies` names them, and `ambiguous` says so; absence is declared
    // only when no copy holds a stored row. Bounded by a declared limit with
    // first-class truncation, as bb_impact is. Same source and same laws as
    // the editor's cross-language hover section; never infers, guesses, or
    // aspires.
    name: "bb_cross_language",
    description: "Cross-language facts for one symbol from stored brain_relationship rows only (is_cross_language = 1), per-pair with bridge mechanism and evidence tier. Every fact names both ends — the copy of the requested name it came from and the other symbol's name, file, language and line — plus the stored row id. A name is many symbols (the index holds one per file/name/line), so facts are the union over every copy; `copies` names them and `ambiguous` says so. SEPARATELY, `memberFacts` holds the rows on the copies' MEMBERS, each marked `match: 'owner-cascade'` with `matchedMember` naming the member: 95% of stored cross-language rows target a member, so a class often has none of its own, and those rows are reported as the MEMBER's edges rather than absorbed into the symbol's — `ownFactCount`, `memberFactCount` and `silentItselfButNotItsMembers` tell the two apart. Absence is declared only when neither the copies nor their members hold a stored row. The answer is bounded by `limit` (default 200, max 1000) with `truncated` and `totalCountIfKnown` declared. This tool never infers, guesses, or aspires. Same source and laws as the editor's cross-language hover section.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "symbol name to fetch cross-language facts for (`target`/`symbolName`/`query` are accepted as aliases)" },
        limit: { type: "number", description: "max facts to return (default 200, max 1000); truncation is declared, never silent" },
      },
      required: ["symbol"],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["cross-language"],
    aliases: [],
    deprecated: false,
    documentation: { category: "graph", summary: "Stored cross-language pairs, each naming both ends, with member rows reported separately, and declared absence and truncation.", defaults: { limit: 200 }, examples: [{ symbol: "Warehouse" }, { symbol: "Iterate" }, { symbol: "invoke", limit: 50 }] },
  },

  {
    // M28.A1 (issue #626, decision D-3): the agent's write door. Provenance is
    // ENFORCED, not delegated: author_class is hardcoded 'agent' here — a tool
    // call can never masquerade as a human note. Upsert keyed on
    // (project, symbol, path, author) so re-annotation updates instead of
    // flooding; body length is bounded by a declared limit.
    name: "bb_annotate",
    description: "Attach an agent-authored annotation to a symbol in the shared index. Provenance is enforced: the row records author class 'agent' (never spoofable), the calling tool identity, and timestamps. Re-annotating the same symbol+path updates the note in place — one note per author per location, enforced by a unique index over (project, symbol, author, path). The symbol is NOT checked against the index, so a note may name anything; instead the reply MEASURES whether an editor surface can show it and says so in `surfacing` (`editor`, `matchedAs`, `matchedNames`, `statement`) — a typo'd name or a qualified name is stored and reported honestly rather than promised to a surface it cannot reach. `path` is resolved to the index's own spelling, so `src/a.ts`, `./src/a.ts` and the absolute path are the same note. Annotations are opinions layered on evidence, never index facts. To change source code use bb_edit; to read notes back use bb_annotations.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "symbol name to annotate (`target`/`query` are accepted as aliases)" },
        body: { type: "string", description: "annotation text (max 2000 chars)" },
        path: { type: "string", description: "optional file path to disambiguate same-named symbols; resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path all reach the same note" },
        toolIdentity: { type: "string", description: "optional name of the calling agent/tool (recorded verbatim)" },
      },
      required: ["symbol", "body"],
    },
    mutability: "write",
    requiresIndex: false,
    modes: ["annotate"],
    aliases: [],
    deprecated: false,
    documentation: { category: "annotations", summary: "Agent note with enforced provenance, stored where the human reads.", defaults: {}, examples: [{ symbol: "handleRequest", body: "Legacy auth path — scheduled for removal in Q3." }] },
  },
  {
    // M28.A1 (issue #626, decision D-3): the read door. Provenance fields are
    // always returned — a reader can always tell an agent note from a human
    // note. Declared absence when there are none; bounded by a declared limit.
    name: "bb_annotations",
    description: "Read annotations for a symbol, one file's copy of a symbol (optional `path`), or all annotations up to the declared limit, with full provenance on every row: author class, tool identity, and timestamps. Every answer declares its bound: `count` is the page size, `totalCountIfKnown` the true total, and `truncated`/`truncationReason` fire when the limit actually dropped rows — a short page is never mistaken for a complete one. A `symbol` also matches notes written under a symbol's qualified name, the same predicate the editor uses. No annotations is a declared absence, never an error. To write a note use bb_annotate.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "symbol name (omit to list all annotations); `target`/`query` are accepted as aliases" },
        path: { type: "string", description: "optional file path; resolved to the index's own spelling first, so `src/a.ts`, `./src/a.ts` and the absolute path are the same note. Returns that file's copy's notes plus any name-level notes (written with no path). Omit to return every note for the symbol" },
        limit: { type: "number", description: "max rows returned (default 50, cap 200)" },
        includeNameLevel: { type: "boolean", description: "with `path` and no `symbol`, also return name-level notes (written with no path), which apply wherever their name appears. Off by default, so a path filter answers the question as asked rather than mixing in the whole project" },
      },
      required: [],
    },
    mutability: "read",
    requiresIndex: false,
    modes: ["annotate"],
    aliases: [],
    deprecated: false,
    documentation: { category: "annotations", summary: "Annotations with full provenance; absence declared.", defaults: { limit: 50 }, examples: [{ symbol: "handleRequest" }, { limit: 100 }] },
  },
] as const satisfies readonly ToolDescriptor[]

export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = descriptors


export const PUBLIC_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = descriptors


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
    if (item.plannedModes) {
      if (new Set(item.plannedModes).size !== item.plannedModes.length) throw new Error(`${item.name}: duplicate planned modes`)
      const modeSet = new Set(item.modes)
      const overlap = item.plannedModes.filter((mode) => modeSet.has(mode))
      if (overlap.length) throw new Error(`${item.name}: planned modes overlap executable modes: ${overlap.join(", ")}`)
    }
    if (item.freshnessModes) {
      if (new Set(item.freshnessModes).size !== item.freshnessModes.length) throw new Error(`${item.name}: duplicate freshness modes`)
      const modeSet = new Set(item.modes)
      const unknown = item.freshnessModes.filter((mode) => !modeSet.has(mode))
      if (unknown.length) throw new Error(`${item.name}: freshness modes not in executable modes: ${unknown.join(", ")}`)
    }
    if (new Set(item.aliases).size !== item.aliases.length) throw new Error(`${item.name}: duplicate aliases`)
    if (item.deprecated && !item.replacement) throw new Error(`${item.name}: deprecated tools require a replacement`)
  }
}

validateToolDescriptors(TOOL_DESCRIPTORS)

/**
 * The public tool contract, DERIVED from the executable registry. This is the
 * single authority the M13 drift test and every consumer must use; there is no
 * hand-maintained parallel copy to drift out of sync.
 */
export interface DerivedToolContract {
  name: string
  mutability: ToolMutability
  requiresIndex: boolean
  modes: readonly string[]
  plannedModes: readonly string[]
  required: readonly string[]
  properties: readonly string[]
  defaults: Readonly<Record<string, string | number | boolean>>
  output: "text"
  replacement: string
}

export function deriveToolContracts(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): DerivedToolContract[] {
  return items.map((descriptor) => ({
    name: descriptor.name,
    mutability: descriptor.mutability,
    requiresIndex: descriptor.requiresIndex,
    modes: descriptor.modes,
    plannedModes: descriptor.plannedModes ?? [],
    required: descriptor.inputSchema.required ?? [],
    properties: Object.keys(descriptor.inputSchema.properties ?? {}),
    defaults: descriptor.documentation.defaults,
    output: "text" as const,
    replacement: descriptor.name,
  }))
}

export function toMcpToolList(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): Array<Pick<ToolDescriptor, "name" | "description" | "inputSchema">> {
  return items.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

export function serializeToolMetadata(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): string {
  return JSON.stringify(items, null, 2)
}
