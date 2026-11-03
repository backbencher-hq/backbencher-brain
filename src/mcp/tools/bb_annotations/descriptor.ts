// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_annotations: name,
// description, input schema, declared bounds, defaults and examples.
// WHICH TOOL IT SERVES — bb_annotations (this file is the contract authority for
//   the tool's schema and for the page generated from it).
// WHY IT IS SHAPED THIS WAY — the schema states the bounds the handler enforces
//   (limit 1..200, default 50) as schema facts, not only as prose, so a client or
//   a generated page can read them directly. The description states the two
//   semantics a caller can otherwise misread: a symbol request matches both name
//   forms the index publishes, and a path request returns the file's own notes
//   unless includeNameLevel widens it. `requiresIndex` is false because the
//   annotation store is not the code index: a project with no store answers with
//   a declared absence and creates nothing.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_annotations.md (generated),
//   docs/data/public-tools.json, validation/tools/bb_annotations/**; gates:
//   npx tsx script/verify-tool-docs.ts --only bb_annotations,
//   npx tsx script/m28/verify-mcp-tools.ts,
//   npx tsx validation/tools/bb_annotations/verify-read-door.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — handler.ts, the curation file, the
//   generated page and the read-door gate.
// CONTRACTS IT MUST NOT BREAK — every documented default and bound is executed by
//   handler.ts; declared absence for the symbol, path and project shapes; no
//   regex; read-only.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
  name: "bb_annotations",
  description: "Read annotations for a symbol, one file's copy of a symbol (optional `path`), or all annotations up to the declared limit, with full provenance on every row: author class, tool identity, and timestamps. Every answer declares its bound: `count` is the page size, `totalCountIfKnown` the true total, and `truncated`/`truncationReason` fire when the limit actually dropped rows — a short page is never mistaken for a complete one, and at the declared cap the reason names narrowing the filter instead of an impossible limit raise. A `symbol` matches notes written under either name form the index publishes — the symbol's simple name AND its qualified name — the same pair the editor hover matches, so a note written as `render` is found by `Widget.render` and the other way round. A `path` is resolved to the index's own spelling before filtering. A project with no store yet is a declared absence; this read creates nothing. To write a note use bb_annotate.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "symbol name, simple name or qualified name; both forms resolve to the same notes. Omit to read the whole project. `target`/`query` are accepted as aliases",
      },
      path: {
        type: "string",
        description: "optional file path; resolved to the index's own spelling first, so `src/a.ts`, `./src/a.ts` and the absolute path are the same filter. A path without a symbol returns that file's own notes only — pass `includeNameLevel` for the project's name-level notes as well. Combined with a symbol, it returns that file's copy of the symbol plus name-level notes about that symbol. Omit to read every file for the symbol",
      },
      limit: {
        type: "number",
        description: "max rows returned (default 50, min 1, max 200); a truncated answer states the true total and a reason",
        default: 50,
        minimum: 1,
        maximum: 200,
      },
      includeNameLevel: {
        type: "boolean",
        description: "with `path` and no `symbol`, also return name-level notes (written with no path), which apply wherever their name appears. Off by default, so a path filter answers the question as asked rather than mixing in the whole project. With a symbol present the flag has no effect: name-level notes about that symbol always apply",
      },
    },
    required: [],
  },
  mutability: "read",
  // The store is not the code index: absence is declared for a project that has
  // no store, and the read never creates one.
  requiresIndex: false,
  modes: ["annotate"],
  aliases: [],
  deprecated: false,
  documentation: {
    category: "annotations",
    summary: "Annotations with full provenance; declared absence; both name forms matched; path canonicalized.",
    defaults: { limit: 50 },
    examples: [{ symbol: "handleRequest", path: "src/server.ts" }, { symbol: "Widget.render" }, { includeNameLevel: true, path: "src/index.ts" }],
  },
}
