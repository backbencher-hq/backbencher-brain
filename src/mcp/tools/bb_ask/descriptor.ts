// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_ask: name, truthful description,
//   input schema with the declared page-size bounds, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_ask (this file is the contract authority for the tool's
//   schema and documentation).
// WHY IT IS SHAPED THIS WAY — the previous description promised "matched symbols with
//   similarity scores" on every call, which is false for three of the five routes: an
//   exact aggregate returns a count, the lexical fallback computes no similarity, and an
//   exact name lookup is not a similarity claim. The description now names the routes and
//   the bounds, because a schema whose prose overclaims is the first lie a caller meets.
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_ask.md,
//   validation/tools/bb_ask/**, docs/BB_ASK.md.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/handler.ts,
//   src/intelligence/search/quick-answer.ts, script/tool-docs/curation/bb_ask.ts,
//   docs/tools/bb_ask.md (generated), docs/BB_ASK.md.
// CONTRACTS IT MUST NOT BREAK — declared bounds (`limit` 1..100, default 5), declared
//   absence (no-index and no-match answers), freshness markers, read-only access, and
//   the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_ask",
    description:
      "Answer a question about the codebase from the index, with the route and its limits stated. Four routes: (1) an EXACT AGGREGATE over indexed rows (counts of symbols/functions/classes/interfaces/structs/enums/traits/types/constants/relationships/imports/files, optionally by language; the largest file; the most complex function) — exact about the indexed snapshot, with that snapshot's time reported, and never a similarity claim; (2) an EXACT SYMBOL NAME lookup when the query is a single symbol name — matched by name, not by similarity, with its neighbours listed and labelled as neighbours; (3) SEMANTIC RETRIEVAL over stored embeddings — only vectors from the same model and dimension as the query are compared, similarities are cosine scores, and the answer reports which model space it compared, how many symbols exist in that space versus across the whole library, whether the scan cap was reached, and whether the provider embedding timed out (then a capped local 50-dimension fallback runs); (4) a KEYWORD FALLBACK when embeddings are unavailable or nothing clears the similarity floor — lexical matches that carry NO similarity score, with the reason stated. Every answer reports its confidence kind: a mean of returned similarities (bounded 0.2–0.85), a declared floor when no score was computed, or NO confidence number at all when the ranking is declared non-discriminative (the answer then says the scores do not separate candidates). Every answer declares `returned`/`totalMatches`/`truncated` bounds so a prefix is never read as a complete match set. Cited sources carry `[STALE — file changed since index]` or `[MISSING — file no longer on disk]` markers, and nothing is auto-refreshed. `limit` is the page size: whole number 1..100, default 5, values outside refused rather than clamped. When embeddings are configured, the natural-language question itself is sent to the configured embedding provider to compute the query vector; with local word vectors everything stays offline.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "natural-language question, or a symbol name for the exact-name route" },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          description: "max results (default 5; whole number 1..100; values outside are refused, not clamped). A larger page also means a larger work budget.",
        },
      },
      required: ["query"],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["answer"],
    plannedModes: ["explain", "feature"],
    aliases: [],
    deprecated: false,
    documentation: {
      category: "search",
      summary: "Exact aggregates, exact-name lookups, and scored semantic or lexical matches — each labelled with its route and bounds.",
      defaults: { limit: 5 },
      examples: [
        { query: "how many functions are in this project" },
        { query: "where is request handling implemented" },
        { query: "handleRequest", limit: 1 },
      ],
    },
}
