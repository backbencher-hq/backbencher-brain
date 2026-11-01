// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_annotations: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_annotations (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_annotations.md, validation/tools/bb_annotations/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotations/handler.ts, script/tool-docs/curation/bb_annotations.ts, and docs/tools/bb_annotations.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
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
}
