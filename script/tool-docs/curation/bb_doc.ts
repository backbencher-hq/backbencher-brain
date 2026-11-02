// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_doc (returns, errors, limitations, performance, safety, evidence) and its cross-reference line.
// WHICH TOOL IT SERVES — bb_doc (rendered into docs/tools/bb_doc.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_doc.md, docs/data/public-tools.json, validation/tools/bb_doc/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_doc/descriptor.ts, src/mcp/tools/bb_doc/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
  returns: [
    "Markdown or structured JSON documentation: title, summary, the mode's declared sections, citation objects with stable IDs and per-citation freshness, and declared unknowns",
    "`quality`: the four-term verdict, emitted-citation reference counts (`broken`/`stale`/`missing` plus the `collectedStale`/`collectedMissing` totals of everything gathered), completeness against the declared section set, the index snapshot, and the payload-measured budget",
    "`quality.bounds`: per-section numbers — `available`, `capped`, `droppedForBudget`, `emitted` — with `emitted + droppedForBudget === capped` enforced before the result is returned",
    "A declared selection bound when a scope has more indexed symbols than the evidence limit selected, naming both numbers",
    "`reference`: stable website keys (`projectId`, `snapshotId`, `generatedAt`, `indexVersion`, `schemaVersion`, `sourceLanguage`, `canonicalPath`, `slugs`, `tags`) and an empty `diagrams` array",
    "An `autoRefresh` line whenever stale cited files were repaired or a repair was declined, with the reason",
  ],
  errors: [
    "Missing mode, or a mode outside symbol|file|module|feature|api|project|coverage",
    "Missing target for `symbol`, `file`, `module` or `feature`",
    "`limit` outside 1-100, or `maxTokens` outside 1-16000 — refused with the accepted range rather than clamped",
    "`includeTests` on a mode that renders no test evidence (everything except `symbol` and `feature`)",
    "A `module` target that matches no indexed file — refused by name, with the two directory forms it tried",
    "An invalid `format`, `audience` or `detail` value (rejected by the registry validator with the accepted enum)",
    "Unavailable indexed evidence",
  ],
  limitations: [
    "Unknown facts are explicit, and a required section that renders empty says why in its own words; a document with no cited claim never reports `passed`",
    "Stale evidence is qualified per citation and counted as `freshness.passed: false`; it cannot silently become current",
    "`includeTests` is a real option only where a test section is rendered: `symbol` and `feature`. The other modes refuse it instead of accepting a no-op",
    "`project` mode accepts a target but uses it as document metadata; it does not scope the selection",
    "`feature` mode's semantic candidate expansion is opt-in via `detail: \"deep\"`; every other call is lexically discovered and says so, because semantic expansion measured 19-52 s on a 310k-symbol index",
    "A scope with more indexed symbols than `2 x limit` reports the selection bound (`selected` of `available`) rather than implying it mapped the whole set",
    "When the required sections cannot fit `maxTokens`, the result is returned with `budget.passed: false` and the smallest honest rendering named; it is never met by dropping a required section",
  ],
  performance: "Measured warm on the reference index (6,452 files, 310,423 symbols, 820,040 relationships): default calls take symbol 0.24 s, file 0.19 s, module 0.42 s, api 1.03 s, project 0.76 s, coverage 0.07 s, feature 1.97 s (p50; five runs, p95 at most 3.65 s). A COLD first default call in a fresh process is 3.9 s on a cold page cache (930 ms with a warm one) and the read-only database open is 2 ms; the cold cost is index page-cache warm-up, not query time, and it is declared here rather than hidden by the warm figures. `feature` with `detail: \"deep\"` adds a semantic candidate pass (measured 18.0 s and 926 MB on the reference index) and is the only shape that can approach the client timeout; the default feature call is lexical and 2 s. Work is bounded by the request: the evidence limit bounds the facts, the per-section cap bounds each section, and `maxTokens` bounds the emitted payload. The default budget is 8,000 tokens because the measured minimum honest rendering of a project document on the reference index is about 6,700 tokens; a 4,000-token default could not be honoured by its own reference call.",
  safety: "Read-only with one bounded, declared exception: when the files a document cites are stale, the handler reindexes exactly those cited files (at most 25 files / 2 MiB per call) and regenerates. `refresh:false` or `BB_NO_AUTO_REFRESH=1` opts out and the answer declares the decline. It never writes source, never creates a file, never calls bb_edit, and never touches a file the document does not cite.",
  evidence: "Claims are classified as extracted, inferred, generated or unknown and carry resolvable citations; relationship facts name the symbol on the other end of the edge, with inbound edges naming the documented symbol. `quality.references` counts the citations the answer emits so the stale/missing numbers can be checked against the Sources list.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For raw symbol metadata use `bb_search` mode `symbol`; this tool composes documented, cited explanations. For cross-language reference facts on one symbol use `bb_cross_language`; for graph traversal use `bb_graph`."
