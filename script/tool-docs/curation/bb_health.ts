// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_health: what a caller
// receives, which refusals exist, what is honestly limited, what it costs in
// measured terms, the read/write boundary, and where the numbers come from.
// WHICH TOOL IT SERVES — bb_health (rendered into docs/tools/bb_health.md and
//   docs/data/public-tools.json).
// WHY IT IS SHAPED THIS WAY — the generated page is the reference a reader uses
//   BEFORE calling, so every claim here is either an executable contract
//   (refusals, the read/write boundary) or a measured number from
//   validation/tools/bb_health/LATENCY.json; it must not promise a mode, default
//   or bound the code does not honour.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_health.md, docs/data/
//   public-tools.json, validation/tools/bb_health/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_health/descriptor.ts,
//   src/mcp/tools/bb_health/handler.ts, src/intelligence/health/health-provider.ts.
// CONTRACTS IT MUST NOT BREAK — declared defaults and bounds, declared absent
//   states, the read/write boundary, the `healthy` channel, and the no-regex
//   policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
        "Counts (files, symbols, relationships, imports, syntax-error files), schema version, runtime, embedding model/coverage and a `freshness` block that states whether it checked a SAMPLE or the whole index",
        "The freshness reason mix per file (content-changed, deleted, unreadable, unindexed) and, on verbose, the bounded stale/missing file names",
        "When `paths` is given: a separate five-state block (fresh / stale / gone / not-indexed / absent) for exactly those files, while every other number stays project-wide",
        "When `checkUnindexed` is given: files on disk the indexer would index but the index does not contain, with the population named",
        "When `integrity` is given: the integrity checks with their status and remediation, naming each non-ok check rather than only a score",
        "When `includeAnalysisRuns` is given: persisted run/finding totals as full-table counts; `history` instead answers with JSON `{ health, history, healthy }`",
        "A `healthy` boolean on the result (and inside the history JSON): false exactly when the report contains an error-severity finding",
    ],
    errors: [
        "An option the selected behaviour cannot honour: `limit` without `history=true`, `wait` without `refresh`/`force`, `sampleSize` with `freshness=\"complete\"` — each refused with the accepted form named",
        "Invalid values: unknown `freshness`, `sampleSize` below 1, a non-integer `limit` (and `limit: 0` with `history=true`)",
        "`paths` problems: an empty list, more than 50 entries, duplicate entries, blank entries, or a path that escapes the project (directly or through a symlink)",
        "An index that cannot be opened read-only is reported as an EMPTY_INDEX error finding, not as a tool failure: a broken index is a successful report",
    ],
    limitations: [
        "Sampled freshness (the default) is a deterministic sample, so `stale` is a LOWER BOUND on the project, not a total; `freshness=\"complete\"` is the exact census",
        "A `fresh` verdict reached through the mtime+size fast path never read the file: a same-size edit that preserves the mtime reads fresh (the same trade-off as git's stat-cache)",
        "Embedding coverage reports stored vectors, not semantic quality or retrieval accuracy; verbose=true is what joins it to per-language searchability",
        "`integrity: true` with the default sampled freshness performs a COMPLETE disk pass over the indexed files, and `checkUnindexed: true` walks the project — both are opt-in precisely because a default call must not acquire them",
        "The default call does not run the per-symbol embedding aggregates (per-language symbol counts, searchable-by-language, embedded/unembedded kinds, provider chain); those run only for verbose=true, which is what keeps a default answer bounded by file count rather than symbol count",
        "No `mode` parameter exists: a call reports status, and `refresh`/`force` are the only behaviours selected by flags",
    ],
    performance: "Measured warm through the MCP door on the campaign checkout: a default call answers in about 0.8 s p50 / 0.9 s p95 on the workspace index (6,452 files / 310,423 symbols / 3.6 GB), and about 2.6 s p50 / 3.3 s p95 on a 1,283,638-symbol copy of that index; the first call after a cold start measured 8.3 s and 25.3 s respectively on those two indexes. The 5-file polyglot fixture measures ~53 ms p50 and the 100-file synthetic fixture ~35 ms p50 through the same code path. `verbose=true` adds the per-symbol embedding aggregates, `integrity=true` adds a complete disk pass, `freshness=\"complete\"` hashes/indexes every file, and `checkUnindexed=true` adds a project walk — all opt-in and declared for that reason.",
    safety: "A status call is read-only: the index is opened through the driver's read-only mode, so no migrations, healers or WAL writes run. refresh=true and force=true are the only index mutations and are explicit: refresh reindexes, force WIPES the index before rebuilding and is destructive; wait=false detaches a rebuild and the next call reports its outcome once. `healthy:false` never means the tool failed — the report is the answer.",
    evidence: "Counts, schema version and embedding rows are measured from the brain database; freshness compares indexed metadata with the filesystem and names the reason per file, separating content-verified fresh verdicts from mtime+size fast-path ones; integrity results are computed from stored rows and disk state; sampled answers declare that they are samples. `brain_index_status` counters are labelled when they describe the last index RUN rather than the index itself.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For index size/counts use `bb index status` (CLI) or the stats surface; this tool reports index health, freshness, completeness and integrity."
