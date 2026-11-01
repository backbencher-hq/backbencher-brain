// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_index (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_index (rendered into docs/tools/bb_index.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_index.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_index/descriptor.ts, src/mcp/tools/bb_index/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Indexed, deleted, error and skipped counts for the refreshed path",
      "Mode actually applied (auto resolved to file or dir, or the mode named)",
      "`outcome` — `indexed`, `partial`, or `no-op` — and, for a no-op, a `reason` distinguishing \"nothing changed, the file already matches the index\" from \"this file holds nothing the indexer extracts\"",
      "`errorDetail`: the file and the message for each failure, beside the `errors` count",
      "For mode=post, the per-phase report (relationships, enrichment, gravity, taint, health, integrity, vectorBlobs, analyze) with its timings",
    ],
    errors: [
      "Missing or blank path",
      "A path that resolves OUTSIDE the project — an absolute path elsewhere, a `../` traversal, a foreign directory, or a symlink inside the project pointing out of it",
      "mode=file on a directory, or mode=dir on a file",
      "mode=post with a path that does not exist — the schema requires `path`, so it is checked rather than ignored",
      "Another indexer holding the project lock, as a declared refusal",
    ],
    limitations: [
      "A file reindex updates only that file's evidence; cross-file relationships refresh on the next full or incremental dir index",
      "Dir mode reuses the incremental indexer: unchanged files are skipped by design, and a settled tree answers `unchanged: true`",
      "The COUNTS in a report are stable between identical calls, but the `ms` fields are measured wall-clock and DO vary. Byte-stability is therefore not a property of this tool's answers and a diff of two reports will show timing drift",
      "A file the indexer declines — a binary, an unsupported type, or one with no extractable symbols — is reported as `skipped` or as a `no-op` with a reason. It is never silently absent, and never counted as a success",
      "Derived data (relationships, enrichment, gravity, taints, health) is not refreshed by a single-file reindex unless `derived.pass` says it was; `deferred` means it was not, and `mode: post` is the remediation",
    ],
    performance: "A single file reindex is bounded by that file's parse cost; dir mode is bounded by the changed-file set, and reports how many candidates it found against how many it processed.",
    safety: "Write-capable against INDEX data only — it never modifies source files. It will only index paths inside this project: both sides are resolved through realpath, so a symlink inside the project pointing out of it is refused, and a symlink to a file inside it is allowed.",
    evidence: "Counts come from the real parse/store pipeline. The report's own assertions are checked against the store by fixtures/analyze/index.test.ts, which edits real files and asks the database rather than reading the answer back.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "The CLI twin is `bb index` (same semantics; see docs/MCP_CLI_INDEXER_GUIDE.md). Refresh changed files after agent edits with mode `dir`/`file` or the CLI `--changed`."
