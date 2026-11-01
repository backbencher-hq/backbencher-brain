// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_cross_language: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_cross_language (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_cross_language.md, docs/data/public-tools.json, validation/tools/bb_cross_language/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_cross_language/handler.ts, src/lsp/cross_language_hover.ts, script/tool-docs/curation/bb_cross_language.ts, and docs/tools/bb_cross_language.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, the
//   self/owner/pair invariant on member facts, the read/write boundary, and the
//   no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
  name: "bb_cross_language",
  description: "Cross-language facts for one symbol from stored brain_relationship rows only (is_cross_language = 1), per-pair with bridge mechanism and evidence tier. Every fact names both ends — the copy of the requested name it came from and the other symbol's name, file, language and line — plus the stored row id. A name is many symbols (the index holds one per file/name/line), so facts are the union over every copy; `copies` names them and `ambiguous` says so. SEPARATELY, `memberFacts` holds the rows on the copies' MEMBERS: each fact's `self` is the MEMBER the stored row names, `owner` is the copy of the asked name it was attributed through, and `pair` is exactly `self.language → other.language` (null when the two are equal or unknown, and then the row is counted in `unpairableRowCount` rather than given a pair). Member rows are the MEMBER's edges, never absorbed into the symbol's — `ownFactCount`, `memberFactCount` and `silentItselfButNotItsMembers` tell the two apart. Absence is a property of the store: it is declared only when neither the copies nor their direct members hold a stored row. A row that exists but cannot name a language pair is NOT absence — it is counted in `unpairableRowCount` and named in `pairlessRowNote`, while `storedRowCount` still reports it. Rows on descendants at depth 2 or deeper are counted in `deeperDescendantRowCount` (both directions) and deliberately not cascaded. Counts name what they count: `factCount` facts in this answer, `pairCount` DISTINCT language pairs, `signatureCount` distinct (pair, direction, bridge, tier); `memberCount` is the distinct members that contributed BEFORE the limit while `memberFactCount` is what was shown, and `ownFactsTruncated`/`memberFactsTruncated` say which section a limit cut. The answer is bounded by `limit` (default 200, max 1000) with `truncated` and `totalCountIfKnown` declared, and the copy list has its own declared cap. This tool never infers, guesses, or aspires. Same source and laws as the editor's cross-language hover section.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "symbol name to fetch cross-language facts for (`target`/`symbolName`/`query` are accepted as aliases)" },
      limit: {
        type: "number",
        description: "max facts to return (default 200, max 1000); truncation is declared, never silent. Refused below 1 or above 1000 rather than clamped",
        default: 200,
        minimum: 1,
        maximum: 1000,
      },
    },
    required: ["symbol"],
  },
  mutability: "read",
  requiresIndex: true,
  modes: ["cross-language"],
  aliases: [],
  deprecated: false,
  documentation: {
    category: "graph",
    summary: "Stored cross-language pairs, each naming both ends, with member rows reported separately as the member's, absence declared as a property of the store, and declared bounds and truncation.",
    defaults: { limit: 200 },
    examples: [{ symbol: "Warehouse" }, { symbol: "Iterate" }, { symbol: "invoke", limit: 50 }],
  },
}
