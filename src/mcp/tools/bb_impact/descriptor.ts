// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_impact: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_impact (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_impact.md, validation/tools/bb_impact/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_impact/handler.ts, script/tool-docs/curation/bb_impact.ts, and docs/tools/bb_impact.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
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
        file: { type: "string", description: "optional defining-file hint for a symbol NAME that several stored symbols carry — the same server-resolved identity the editor's hover sends as `file`. Accept the stored project-relative path, or an absolute path ending in it. It must identify the symbol: a hint that does not is REFUSED with a named error, never silently ignored and never silently relabelled to another same-named copy. Ambiguous MEMBER names (constructors, members outside the graph's root types) resolve through their owning declaration at the hinted file; for a traversable name the walk roots where the graph engine resolves it, and a hint naming another copy is refused rather than answered. Omit it for unique names." },
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
}
