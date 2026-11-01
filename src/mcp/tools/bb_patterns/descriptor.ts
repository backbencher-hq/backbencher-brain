// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_patterns: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_patterns (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_patterns.md, validation/tools/bb_patterns/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_patterns/handler.ts, script/tool-docs/curation/bb_patterns.ts, and docs/tools/bb_patterns.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
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
}
