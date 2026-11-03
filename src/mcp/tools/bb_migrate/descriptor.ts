// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_migrate: name, description,
//   input schema, modes, defaults and examples. It is the contract authority for the
//   tool's schema and documentation.
// WHICH TOOL IT SERVES — bb_migrate (mutability read, requiresIndex true, modes: plan).
// WHY IT IS SHAPED THIS WAY — the subject is a LIST of entries (names, symbol ids,
//   paths), unioned and capped at 100, and every entry resolves to at most one
//   component before any relationship is read. The descriptions state the refusals
//   (blank entries, blank/unknown target) because the schema cannot express them and
//   a caller should learn them from the contract, not from a failed round-trip. The
//   freshnessModes entry tells the docs generator this tool reports per-plan
//   staleness and never auto-refreshes.
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_migrate.md,
//   validation/tools/bb_migrate/**; gates: npx tsx script/m13/verify-migrate-accuracy.ts,
//   bun run script/m13/verify-migrate-docs.ts, npx tsx script/verify-tool-docs.ts --only bb_migrate.
// EDIT TOGETHER WHEN THIS FILE CHANGES — handler.ts (every documented default and
//   refusal is executed there), script/tool-docs/curation/bb_migrate.ts, and the
//   generated page (regenerate; never hand-edit).
// CONTRACTS IT MUST NOT BREAK — declared bounds (100 entries, one plan per component),
//   declared absence (unsupported entries with typed reasons), freshness flags, the
//   byte-read-only boundary, and the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_migrate",
    description: "Read-only single or batch migration planning with dependency order, explicit effort methodology, library mappings, risks, truncation, and unsupported cases. A request is a list of entries (symbol names, indexed symbol ids, project-relative paths) unioned and capped at 100; every entry resolves to at most one component before any relationship is read, and a component named through more than one entry is planned once. Plans whose source file changed since the last index are flagged stale up front — a plan is a claim about current code; JSON output carries the freshness block.",
    inputSchema: {
        type: "object",
        properties: {
            symbolName: { type: "string", description: "legacy single-symbol alias for symbolNames; when both are supplied the entries are UNIONED, never silently dropped" },
            symbolNames: { type: "array", items: { type: "string" }, description: "one or more component names; a name that matches several symbols in different files is refused with candidate ids to re-run against symbolIds. Blank entries are refused by name" },
            paths: { type: "array", items: { type: "string" }, description: "project-relative file or DIRECTORY paths (absolute paths inside the project are accepted); every indexed symbol in them joins the request, so a whole module can be planned in one call. UNION with symbolNames, not a replacement: naming a symbol AND a path that contains it plans it once. A path that matches no indexed file is refused by name" },
            symbolIds: { type: "array", items: { type: "string" }, description: "indexed symbol ids (shape `<projectId>:<relative file>:<name>:<line>`), the ONLY unambiguous way to name a component. Use this when a refusal reported that a name matches several symbols; a name is not an identity, and ids come from an earlier result's plans or an ambiguity refusal's candidates. An id no symbol carries is refused by name" },
            targetLanguage: { type: "string", description: "e.g. rust, go, python. An unknown target is refused; a known target with no dictionary rows for the source pair is planned with the missing-data gap declared and no mapping invented. Blank is refused" },
            format: { type: "string", enum: ["text", "json"], description: "output format (default text)" },
        },
        required: ["targetLanguage"],
    },
    mutability: "read",
    requiresIndex: true,
    modes: ["plan"],
    freshnessModes: ["plan"],
    aliases: [],
    deprecated: false,
    documentation: {
        category: "analysis",
        summary: "Batch cross-language migration plans with ordering, waves, cohort rollup, scope completeness, and unsupported mappings.",
        defaults: { format: "text" },
        examples: [
            { symbolName: "handleRequest", targetLanguage: "go" },
            { symbolNames: ["parse", "handle"], targetLanguage: "rust", format: "json" },
            { paths: ["src/api"], targetLanguage: "go" },
            { symbolIds: ["<projectId>:src/api/handler.ts:handleRequest:12"], targetLanguage: "go" },
        ],
    },
}
