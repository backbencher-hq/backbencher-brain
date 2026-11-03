// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_security: name,
// description, input schema, modes, defaults and examples. This is the contract
// authority the generated page and the MCP wire both read.
// WHICH TOOL IT SERVES — bb_security.
// WHY IT IS SHAPED THIS WAY — the schema is deliberately three options: the tool
// has one executable answer (`findings`) plus two switches — `recordRun` makes it
// the one write, `history` returns the persisted page instead of a live scan.
// Everything else (limits, windows, caps) is a documented bound the engine
// enforces, not a caller knob, so it does not appear here. The description states
// what a finding is NOT (one-sided flows are observations, never exploits) and
// names what the tool does not detect, because those are the two ways a security
// answer is misread.
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json,
//   docs/tools/bb_security.md, validation/tools/bb_security/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_security/handler.ts,
//   script/tool-docs/curation/bb_security.ts, docs/tools/bb_security.md
//   (generated), and script/m13/verify-security-contract.ts.
// CONTRACTS IT MUST NOT BREAK — mutability read, requiresIndex, one executable
//   mode with the roadmap modes kept out of `modes`, the declared defaults, and
//   the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_security",
    // What the code actually detects, and what it does not: no writer emits a
    // hardcoded-secret vulnerability type (that rule belongs to bb_patterns), and
    // weak crypto is emitted only as an isolated sink, so it stays an unvalidated
    // observation rather than a finding. "Cross-language" is retained because
    // cross-file taint resolution exists and is reported, with the flag's precise
    // meaning stated in docs/BB_SECURITY.md.
    description: "Taint-flow security scan over the indexed source-to-sink flows: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF, open redirect and code execution. Flows whose endpoints both resolve to indexed symbols are findings; one-sided flows are reported separately as unvalidated observations, never as confirmed exploits. Reads are read-only against the index; an unindexed project is refused by name. Findings whose underlying file changed after indexing carry a staleness marker.",
    inputSchema: { type: "object", properties: { history: { type: "boolean", description: "return persisted security history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run" }, limit: { type: "number", description: "history run limit (default 20)" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["findings"],
    plannedModes: ["flow", "summary", "hotspots"],
    aliases: [],
    deprecated: false,
    documentation: {
      category: "analysis",
      summary:
        "Taint-flow findings over the index, with optional persisted run history. A flow is a finding only when both endpoints resolve to indexed symbols; one-sided flows are reported as unvalidated observations. A findings answer states the pre-cap census so a capped scan is never mistaken for a complete one; a history answer states its run count and its finding total, and its findings page is capped and declared. Reads open the index read-only and refuse an unindexed project; recordRun is the one write. Not detected: hardcoded secrets; genuine cross-language taint; standalone weak crypto.",
      defaults: { history: false, recordRun: false, limit: 20 },
      examples: [{}, { recordRun: true }, { history: true }],
    },
}
