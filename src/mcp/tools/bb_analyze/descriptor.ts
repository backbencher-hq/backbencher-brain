// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_analyze: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_analyze (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_analyze.md, validation/tools/bb_analyze/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/handler.ts, script/tool-docs/curation/bb_analyze.ts, and docs/tools/bb_analyze.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_analyze",
    description: "Unified evidence-backed analysis over graph relationships, dependencies, project statistics, complexity, impact, and test intelligence. Select exactly one mode. Every read mode carries a freshness block (fresh/stale/missing counts + remediation) resolved against the live working tree, and report rows carry a stale flag when their file changed after indexing. Every mode is BOUNDED and says so: `limit` is the most items returned (edges per direction for callers/callees/trace, files for dependencies, entries for the test modes, the same everywhere) and the answer reports what it returned against what exists, so a page is never read as the whole set. callers/callees/trace/impact share the graph engine's owner-cascade semantics — a relationship stored against a class member is attributed to the owner class — and every edge states which it was through `targetMatch`. WHICH symbol the name resolved to is declared as well: `rootMatch` is `exact`, `exact-any-kind` or `containment`, and `containment` means the answer is about a symbol whose name CONTAINS the one asked for, or differs only in case — `found: true` on its own does not mean the name was itself a symbol. Locations are project-relative. Per-mode parameters: target applies to callers, callees, trace, complexity, impact, and test_impact; filePath scopes dependencies, test_mapping, test_gaps, and test_quality to a project-relative path PREFIX and is REFUSED (not ignored) on every other mode; limit applies to callers, callees, trace, dependencies, test_mapping, test_gaps and test_quality and is refused elsewhere; stats is always project-wide.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], description: "analysis mode" }, target: { type: "string", description: "A symbol name for callers/callees/trace/impact/test_impact, or a project-relative FILE PATH for complexity (an exact file, or a directory prefix at any depth INCLUDING a top-level one; anything else is refused rather than treated as a path fragment). `symbol`/`symbolName`/`query` are accepted as aliases. A target is a VALUE, never a pattern: `%`, `_` and `\\` are escaped and match themselves. Echoed back bounded at 200 characters with its full length stated — the search always uses the whole string." }, filePath: { type: "string", description: "Project-relative path PREFIX scoping dependencies, test_mapping, test_gaps and test_quality. Refused on every other mode. Matched on a whole segment boundary, so `src/util` does not match `src/utilities`." }, limit: { type: "number", description: "Maximum items returned: edges per direction for callers/callees/trace, files for dependencies, entries for test_mapping/test_gaps/test_quality. Defaults: 25 edges per direction, 20 files, 50 entries. Range 1-5000 (graph modes) or 1-2000 (the rest); 0 and anything above the ceiling are REFUSED rather than clamped, because a returned page must mean the page that was asked for. The answer reports what it returned and whether that is the whole set. Refused on the modes it does not apply to." } }, required: ["mode"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"],
    // Every bb_analyze mode is a read path over the index — all carry
    // the staleness envelope on their output.
    freshnessModes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"],
    aliases: [],
    deprecated: false,
    documentation: {
      category: "analysis",
      summary: "One typed analysis surface over the graph, the file graph, project counts, complexity, impact and test evidence. Every mode is bounded, declares its own bounds, and reports what it returned against what exists.",
      // The REAL defaults, per mode. A single number was wrong in every mode:
      // 25 edges per direction for the graph modes, 20 files for dependencies,
      // 50 entries for test_mapping/test_gaps, 50 files for test_quality.
      defaults: {
        limit: "25 edges per direction (callers/callees/trace); 20 files (dependencies); 50 entries (test_mapping/test_gaps); 50 files (test_quality)",
        target: "required for callers, callees, trace, impact, test_impact; optional file path or directory prefix for complexity",
        filePath: "optional path prefix (or an exact file) for dependencies, test_mapping, test_gaps, test_quality",
      },
      examples: [{ mode: "callers", target: "handleRequest" }, { mode: "complexity", target: "src/api" }, { mode: "test_quality" }, { mode: "dependencies", filePath: "src/core" }, { mode: "impact", target: "handleRequest", limit: 50 }],
    },
}
