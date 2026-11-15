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
    // What the code actually detects, and what it does not: this tool reports
    // lexical token co-occurrence (source token + sink token in the same symbol).
    // It does NOT perform data-flow analysis, track sanitizers/parameterization,
    // or prove exploitability. No writer emits a hardcoded-secret vulnerability
    // type (that rule belongs to bb_patterns), and weak crypto is emitted only
    // as an isolated sink, so it stays an unvalidated observation rather than a
    // lead. "Cross-language" is retained because cross-file taint resolution
    // exists and is reported, with the flag's precise meaning stated in
    // docs/BB_SECURITY.md. This tool is a LEAD GENERATOR, not a vulnerability
    // scanner; its output is leads to validate manually.
    description: "Lexical security lead generator over the indexed source-to-sink token pairs: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF, open redirect and code execution. A lead is stored when a source expression reaches a dynamic sink argument in the same symbol, with the rule id, source/sink lines and the assignment reach path; parameterized/constant/comment-only/test-file cases are excluded. Reads are read-only against the index; an unindexed project is refused by name. Leads whose underlying file changed after indexing carry a staleness marker. This tool does NOT perform data-flow analysis or prove exploitability; leads require manual validation. Unsupported languages are reported as not scanned, never as a clean zero.",
    inputSchema: { type: "object", properties: { history: { type: "boolean", description: "return persisted security history" }, recordRun: { type: "boolean", description: "persist this scan as an analysis run" }, limit: { type: "number", description: "live lead page size (default 50, max 200), or history run limit when history=true" }, offset: { type: "number", description: "live lead page offset (default 0); omit with history=true" } } },
    mutability: "read",
    requiresIndex: true,
    modes: ["findings"],
    plannedModes: ["flow", "summary", "hotspots"],
    aliases: [],
    deprecated: false,
    documentation: {
      category: "analysis",
      summary:
        "Lexical security leads over the indexed source-to-sink pairs, with optional persisted run history. A lead is stored only when a source expression reaches a dynamic sink argument in the same symbol; parameterized, constant-argument, comment-only and test-file cases are excluded, and the answer declares the languages that were not scanned. A live read is a paginated page of the M72 lead store (limit/offset; declared total); recordRun persists the census and history returns the persisted runs/leads page. Reads open the index read-only and refuse an unindexed project; recordRun is the one write. Not detected: hardcoded secrets; cross-symbol data flow (leads are intra-symbol); string-interpolated input until the Phase-2 contract extension. This tool does NOT perform data-flow analysis or prove exploitability; leads require manual validation.",
      defaults: { history: false, recordRun: false, limit: 50 },
      examples: [{}, { recordRun: true }, { history: true }],
    },
}
