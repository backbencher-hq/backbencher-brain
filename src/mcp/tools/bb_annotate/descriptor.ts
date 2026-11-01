// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_annotate: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_annotate (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_annotate.md, validation/tools/bb_annotate/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_annotate/handler.ts, script/tool-docs/curation/bb_annotate.ts, and docs/tools/bb_annotate.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
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
}
