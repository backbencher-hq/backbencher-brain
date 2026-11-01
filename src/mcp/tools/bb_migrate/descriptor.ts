// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_migrate: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_migrate (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_migrate.md, validation/tools/bb_migrate/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_migrate/handler.ts, script/tool-docs/curation/bb_migrate.ts, and docs/tools/bb_migrate.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_migrate",
    description: "Read-only single or batch migration planning with dependency order, explicit effort methodology, library mappings, risks, truncation, and unsupported cases. Plans whose source file changed since the last index are flagged stale up front — a plan is a claim about current code; JSON output carries the freshness block.",
    inputSchema: { type: "object", properties: { symbolName: { type: "string", description: "legacy single symbol alias" }, symbolNames: { type: "array", items: { type: "string" }, description: "one or more symbols to migrate" }, paths: { type: "array", items: { type: "string" }, description: "project-relative file or DIRECTORY paths; every indexed symbol in them joins the request, so a whole module can be planned in one call. UNION with symbolNames, not a replacement: naming a symbol AND a path that contains it plans it once" }, symbolIds: { type: "array", items: { type: "string" }, description: "indexed symbol ids, the ONLY unambiguous way to name a component. Use this when a refusal reported that a name matches several symbols; a name is not an identity, and two components can share one name in two files" }, targetLanguage: { type: "string", description: "e.g. rust, go, python" }, format: { type: "string", enum: ["text", "json"], description: "output format (default text)" } }, required: ["targetLanguage"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["plan"],
    freshnessModes: ["plan"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Batch cross-language migration plans with ordering, waves, cohort rollup, scope completeness, and unsupported mappings.", defaults: { format: "text" }, examples: [{ symbolName: "handleRequest", targetLanguage: "go" }, { symbolNames: ["parse", "handle"], targetLanguage: "rust", format: "json" }, { paths: ["src/api"], targetLanguage: "go" }, { symbolIds: ["sym_01H..."], targetLanguage: "go" }] },
}
