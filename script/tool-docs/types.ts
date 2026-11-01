// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated-documentation contract every generated tool page renders.
// WHICH TOOL IT SERVES — all sixteen public tools (each curation file implements this shape).
// WHERE ITS EVIDENCE LIVES — script/verify-tool-docs.ts, docs/tools/*.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — script/verify-tool-docs.ts and every script/tool-docs/curation/<tool>.ts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

export interface CuratedToolDocumentation {
  returns: readonly string[]
  errors: readonly string[]
  limitations: readonly string[]
  performance: string
  safety: string
  evidence: string
}