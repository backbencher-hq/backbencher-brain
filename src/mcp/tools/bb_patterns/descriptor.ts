// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_patterns: name, description,
// input schema (with machine-readable defaults and bounds), modes, planned modes and
// examples.
// WHICH TOOL IT SERVES — bb_patterns (this file is the contract authority for the
//   tool's schema and documentation).
// WHY IT IS SHAPED THIS WAY — a default and a bound stated only in prose are facts a
//   caller must interpret; `default`, `minimum` and `maximum` make them readable before
//   the first call. `limit` is bounded (0..500) because the answer is one page and the
//   census names the whole; `confidenceThreshold` is 0..1 because it is a confidence.
//   `modes` lists only executable scopes; quality/architecture are planned, and the
//   description says they are not executable so the registry cannot advertise them.
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_patterns.md,
//   validation/tools/bb_patterns/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_patterns/handler.ts,
//   script/tool-docs/curation/bb_patterns.ts, docs/tools/bb_patterns.md (generated),
//   and script/m13/verify-patterns-contract.ts.
// CONTRACTS IT MUST NOT BREAK — every documented default is executed by the handler;
//   `limit` maximum 500 and `confidenceThreshold` 0..1 are enforced by name in the
//   handler; the read-only boundary (only an explicit recordRun persists anything);
//   declared bounds/absence/freshness flags; no regex.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
  name: "bb_patterns",
  description:
    "Detect orphaned code, framework patterns, and anti-patterns, ranked by confidence, with staleness markers when a finding's file changed after indexing. " +
    "Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional class/confidence filters. " +
    "Orphan confidence is derived from evidence (0.30-0.70); anti-pattern confidence is 0.60-0.90; framework findings carry a fixed 0.6. " +
    "`limit` is one bounded page (maximum 500) and the answer names the full census. " +
    "Architecture and code-quality analysis are planned, not yet executable.",
  inputSchema: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["orphaned", "all"],
        default: "all",
        description: "orphaned only, or all pattern classes (default all)",
      },
      limit: {
        type: "number",
        default: 20,
        minimum: 0,
        maximum: 500,
        description: "maximum findings displayed (default 20, maximum 500); the answer's census line reports the full count",
      },
      includeOrphaned: {
        type: "boolean",
        default: true,
        description: "include orphaned-code patterns in an all scan (default true)",
      },
      includeFramework: {
        type: "boolean",
        default: true,
        description: "include framework patterns (default true)",
      },
      includeAntiPatterns: {
        type: "boolean",
        default: true,
        description: "include anti-patterns (default true)",
      },
      confidenceThreshold: {
        type: "number",
        default: 0,
        minimum: 0,
        maximum: 1,
        description:
          "drop findings below this confidence (default 0 = report everything, ranked). " +
          "Orphan confidence is evidence-derived and spans 0.30-0.70; anti-pattern confidence spans 0.60-0.90; framework findings are a fixed 0.6",
      },
      history: {
        type: "boolean",
        default: false,
        description: "return persisted pattern history (runs bounded by limit; the findings window and its total are declared in the answer)",
      },
      recordRun: {
        type: "boolean",
        default: false,
        description: "persist this scan as an analysis run (persists the whole census, not the displayed page; works in both scopes; capped at 50,000 findings with the cap disclosed)",
      },
    },
  },
  mutability: "read",
  requiresIndex: true,
  modes: ["orphaned", "all"],
  plannedModes: ["quality", "architecture"],
  aliases: [],
  deprecated: false,
  documentation: {
    category: "analysis",
    summary: "Pattern/orphan analysis ranked by confidence, with a bounded page, a declared census, per-finding staleness, and optional persisted run history.",
    defaults: { scope: "all", limit: 20, includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, history: false, recordRun: false },
    examples: [{ scope: "orphaned" }, { confidenceThreshold: 0.6 }, { recordRun: true }],
  },
}
