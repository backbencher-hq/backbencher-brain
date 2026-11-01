// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_graph: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_graph (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_graph.md, validation/tools/bb_graph/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_graph/handler.ts, script/tool-docs/curation/bb_graph.ts, and docs/tools/bb_graph.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    // M28.T1 (issue #624): the agent door to the graph the IDE shows. The
    // handler reuses the same graph engine the LSP bb/graph handler uses —
    // one truth, two doors (M28 decision D-1/D-2).
    name: "bb_graph",
    description: "Per-symbol dependency graph over the canonical graph engine: callers, callees, per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred), confidence, and cross-language edge count. Same engine and tier rules the editor graph panel uses; truncated traversals are declared with a reason, never silent. Traversal semantics: a relationship stored against any member of a class (a method call, an inherited behavior) is attributed to the owner class, so caller/callee sets include the owner-family level — every edge still traces to a stored relationship row. Each edge's `rowId` is the stored relationship key with its leading '<projectHash>:rel:' removed, and each endpoint's `id` is the stored symbol key with its leading '<projectHash>:' removed — both prefixes are constant within one answer, and `root.id` carries the FULL stored form, so '<projectHash>' is the segment before its first ':' and prepending it (plus ':rel:' for a rowId) reconstructs the store key exactly. An `ext:` id has no such prefix and is returned whole. The two stored keys are 127-248 and 65-144 characters and were 28-31% and 28.6% of every edge's bytes.",
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
            "stored relationship kinds to include. Default: EVERY kind the index stores (calls, extends, implements, uses, instantiates, overrides, contains, references, imports, exports) — deliberately not narrowed, because a narrower default silently drops a fifth of the graph and cannot descend a class hierarchy: 'contains' is the parent-to-member edge, so excluding it means a traversal rooted at a class cannot reach that class's own methods. The cost is size — the type-level 'uses'/'references'/'contains' rows are roughly half of what a typical index stores, so a hub symbol's default answer is 2.5-4.8x larger than a filtered one (measured: lodash 487 KiB against 101 KiB, ripgrep 795 against 321). Pass relationshipTypes: ['calls'] for the pure call graph, or ['implements'] to see only interface satisfaction; a kind you do not list is never reported, and a filter you supply is recorded in the answer's truncationReason so a filtered answer is never read as the whole graph.",
        },
        includeCrossLanguage: {
          type: "boolean",
          description: "include edges the indexer marked cross-language (default true). Set false for a single-language view.",
        },
        timeBudgetMs: {
          type: "number",
          description:
            "wall-clock ceiling for the whole walk in milliseconds. DEFAULT 0 = NO clock bound: every other bound on this answer is a function of the DATA (edgeLimit, the 50-symbol per-direction fan-out, maxEdges, maxDepth), so the default answer is complete over them and byte-identical on a re-run. Pass a value only to cap latency, and know what you are buying: a run that hits the ceiling returns a SAMPLE of the set, because the walk can only stop between statements — the ceiling is checked between queries, never inside one. The sample is declared, never silent: `summary.timeBudgetExhausted` is true and `walk-time-budget-exhausted` is among `summary.truncationReasons`. There is no value that makes a clock-bounded answer reproducible; if you need the whole set, leave this unset",
        },
        maxEdges: {
          type: "number",
          description:
            "hard cap on the number of edges in the WHOLE answer, across both directions and all depths (default 1000, max 5000). `edgeLimit` bounds one query and this bounds the answer; their product is what a caller receives. Reaching it is declared as `total-edge-limit` with the value in `summary.maxEdges`. Raise it for a hub symbol, lower it for a quick shape check — a value below `edgeLimit` IS honored (the answer stops at it and says so), so `maxEdges` is the knob for \"just show me the shape\"",
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
}
