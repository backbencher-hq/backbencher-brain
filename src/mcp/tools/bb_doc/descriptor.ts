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
  description: "Generate read-only, evidence-backed documentation with resolvable citations and a freshness block over the cited files. Every mode emits its declared section set, an empty result is never reported as passing, and the output budget is enforced on the payload the caller receives: `quality.budget.estimatedTokens` is measured on the decorated answer, and `estimatedTokens * 4` is never smaller than what was sent. When the required sections cannot fit, the result says so rather than dropping one. `quality.references` counts the citations the answer EMITS (plus the `collected*` totals of everything gathered), so the stale/missing numbers match the Sources list. Supports symbol, file, module, feature, API, project, and documentation-coverage modes in Markdown or JSON. When the cited files are stale, the handler auto-refreshes exactly those files within the shared budget and regenerates the document; refresh=false opts out and answers from existing data with the freshness block. A module target that matches no indexed file is refused by name rather than answered with project-wide facts, and `limit`/`maxTokens` outside their ranges are refused rather than clamped.",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["symbol", "file", "module", "feature", "api", "project", "coverage"], description: "documentation mode" },
      target: {
        type: "string",
        description:
          "symbol, file, module, feature, or API target (`symbol`/`symbolName`/`query` are accepted as aliases); optional for project and coverage. `symbol` matches an indexed name, qualified name or its last dotted/`::` segment. `file` accepts an exact repository-relative path, an absolute path, a directory prefix, or a bare file name with or without its extension. `module` needs a repository-relative directory the index holds; a target that matches nothing is REFUSED with the forms tried. `project` accepts a target but uses it as document metadata only — it does not scope the selection.",
      },
      format: { type: "string", enum: ["markdown", "json"], description: "output format (default markdown)" },
      audience: { type: "string", enum: ["developer", "maintainer", "user", "website"], description: "documentation audience: selects OPTIONAL sections only; a required section is never dropped for a smaller audience" },
      detail: { type: "string", enum: ["brief", "standard", "deep"], description: "detail level: `brief` caps each section at 5 facts and drops optional sections, `standard` caps at `limit`, `deep` caps at 3x`limit` and adds the optional all-edges section; for `feature` it also enables semantic candidate expansion, which is much slower" },
      includeExamples: { type: "boolean", description: "include source-backed examples. No example is emitted when no cited snippet or verified contract supplies one; an honest not-observed unknown is recorded instead" },
      includeDiagrams: { type: "boolean", description: "include cited diagrams when available. This implementation does not emit diagrams; `reference.diagrams` stays empty and an honest not-observed unknown is recorded" },
      includeTests: { type: "boolean", description: "include indexed test evidence. Accepted for `symbol` and `feature` modes only (their documents render a test section); the other modes REFUSE it because it would do nothing. Absent means the mode default (on); explicit false suppresses the test facts" },
      limit: { type: "number", minimum: 1, maximum: 100, description: "maximum evidence items per section (whole number 1-100, default 20). Out-of-range values are REFUSED, not clamped, so the page returned is the page requested" },
      maxTokens: { type: "number", minimum: 1, maximum: 16000, description: "output token budget measured on the emitted payload (whole number 1-16000, default 4000). `estimatedTokens` reports that measurement; when the required sections cannot fit, `budget.passed` is false and a shortfall unknown names the smallest honest rendering. Out-of-range values are REFUSED" },
      refresh: { type: "boolean", description: "false opts out of the inline auto-refresh of the files this document cites (default: auto-refresh those files within the shared budget, then regenerate); the decision is always declared in `autoRefresh` or the answer text" },
    },
    required: ["mode"],
  },
  mutability: "read",
  requiresIndex: true,
  modes: ["symbol", "file", "module", "feature", "api", "project", "coverage"],
  aliases: [],
  deprecated: false,
  documentation: {
    category: "analysis",
    summary: "Cited Markdown or JSON documentation over indexed source and relationships, with declared bounds, emitted-citation freshness counts, and a payload-measured output budget.",
    defaults: { format: "markdown", audience: "developer", detail: "standard", includeExamples: false, includeDiagrams: false, includeTests: false, limit: 20, maxTokens: 4000 },
    examples: [
      { mode: "symbol", target: "handleRequest" },
      { mode: "feature", target: "request handling", format: "json", detail: "deep" },
      { mode: "coverage", target: "src", audience: "maintainer" },
    ],
  },
}
