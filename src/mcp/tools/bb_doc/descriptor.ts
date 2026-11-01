// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the executable descriptor for bb_doc: name, description, input schema, modes, defaults and examples.
// WHICH TOOL IT SERVES — bb_doc (this file is the contract authority for the tool's schema and documentation).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/bb_doc.md, validation/tools/bb_doc/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_doc/handler.ts, script/tool-docs/curation/bb_doc.ts, and docs/tools/bb_doc.md (generated).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolDescriptor } from "../types"

export const descriptor: ToolDescriptor = {
    name: "bb_doc",
    description: "Generate read-only, evidence-backed documentation with resolvable citations and a freshness block over the cited files. Every mode emits its declared section set, an empty result is never reported as passing, and the token budget is enforced against the whole payload. Supports symbol, file, module, feature, API, project, and documentation-coverage modes in Markdown or JSON. When the cited files are stale, the handler auto-refreshes exactly those files within budget and regenerates the document; refresh=false opts out and answers from existing data with the freshness block.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["symbol", "file", "module", "feature", "api", "project", "coverage"], description: "documentation mode" }, target: { type: "string", description: "symbol, file, module, feature, or API target (`symbol`/`symbolName`/`query` are accepted as aliases); optional for project and coverage" }, format: { type: "string", enum: ["markdown", "json"], description: "output format (default markdown)" }, audience: { type: "string", enum: ["developer", "maintainer", "user", "website"], description: "documentation audience" }, detail: { type: "string", enum: ["brief", "standard", "deep"], description: "detail level" }, includeExamples: { type: "boolean", description: "include only source-backed examples" }, includeDiagrams: { type: "boolean", description: "include cited diagrams when available" }, includeTests: { type: "boolean", description: "include indexed test evidence" }, limit: { type: "number", description: "maximum evidence items" }, maxTokens: { type: "number", description: "output token budget" }, refresh: { type: "boolean", description: "false opts out of the inline auto-refresh of the files this document cites (default: auto-refresh those files within budget, then regenerate)" } }, required: ["mode"] },
    mutability: "read",
    requiresIndex: true,
    modes: ["symbol", "file", "module", "feature", "api", "project", "coverage"],
    aliases: [],
    deprecated: false,
    documentation: { category: "analysis", summary: "Cited Markdown or JSON documentation over indexed source and relationships.", defaults: { format: "markdown", audience: "developer", detail: "standard", includeExamples: false, includeDiagrams: false, includeTests: false, limit: 20, maxTokens: 4000 }, examples: [{ mode: "symbol", target: "handleRequest" }, { mode: "feature", target: "request handling", format: "json" }, { mode: "coverage", target: "src" }] },
}
