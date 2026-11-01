// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_analyze (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_analyze (rendered into docs/tools/bb_analyze.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_analyze.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/descriptor.ts, src/mcp/tools/bb_analyze/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Mode-specific typed analysis: graph edges, file dependency edges, project counts, complexity metrics, impact, or test evidence",
      "A declared bound on every answer — what was returned, what exists, and whether the set is the whole one",
      "Explicit unavailable states: a metric or target that cannot be computed is `available: false` / `notFoundReason`, never a substituted number",
    ],
    errors: [
      "Missing required mode",
      "Missing or blank target for a target-based mode",
      "Option irrelevant to the selected mode (refused, never ignored)",
      "`limit` on a mode it does not apply to, or `limit: 0`",
      "A `complexity` target that names no indexed file and no directory prefix",
    ],
    limitations: [
      "Static relationships cannot establish runtime behavior",
      "Test results describe indexed static evidence, not executed coverage; a project whose tests the indexer did not recognise is reported as having none, with the reason",
      "Callers/callees/trace/impact modes share the graph engine's owner-cascade semantics: a relationship stored against a class member is attributed to the owner class. Every edge states which it was through `targetMatch` (`exact` or `owner-cascade`); absent means the engine could not tell, which is not the same as `exact`",
      "Callers/callees/trace answer from the graph engine's DEFAULT kind set, which is EVERY kind the index stores — so a `callers` set means \"who has a stored edge INTO this\", not only who calls it. `contains` is the parent→member edge, so a class that CONTAINS a symbol is reported as that member's caller (membership, not dependency); `uses`/`references` are lexical evidence and `imports`/`exports` are module-level. Measured on this engine's own answers: lodash `baseConvert` answered 99 `calls` rows of 230 edges, cobra `getCompletions` 36 of 65, rake `standard_rake_options` 72 of 76. Every edge carries its stored `relationshipType`, so the composition is readable per answer. Mode `impact` does NOT share that set: it walks the declared dependency kinds (`calls`, `instantiates`, `extends`, `implements` — `src/lsp/impact.ts` `IMPACT_REL_TYPES`) and states the rule it applied, so a `callers` count and an `impact` count about the same symbol answer different questions",
      "A name resolves to ONE stored symbol, and WHICH one is declared in `rootMatch`: `exact` (a structural symbol of that name), `exact-any-kind` (a symbol of that name the graph cannot traverse — a constant, a type alias — which still has callers), or `containment`. `containment` is the documented near-miss fallback and means the answer is about a symbol whose name CONTAINS the one asked for. Measured on this repository's src: `target: \"us\"` answered `found: true` rooted at `analyzeCSharpBareIdentifierUses`, and `target: \"_\"` answered `found: true` rooted at `build_registry` when no symbol is named `_`. `found: true` alone does not mean the name was a symbol",
      "A CASE difference resolves by containment, because the exact step is `name = ?` (case-sensitive) and SQLite's `LIKE` is case-insensitive for ASCII. So `target: \"HUB\"` and `target: \"hub\"` are the same answer, reached by the weaker step — which is why `rootMatch` says `containment` for the first",
      "`limit` has two ends and both are declared: refused below 1 (an empty page is indistinguishable from a real answer) and refused above 5,000 for the graph modes / 2,000 for the rest. It is refused rather than clamped, because a returned page must mean the page that was asked for. Measured on this repository's src, `limit: 2147483648` was accepted before this and answered with the whole corpus",
      "`complexity` accepts a directory prefix at ANY depth, including a top-level directory. It did not: the prefix branch required a `/` in the target, so `target: \"ast\"` was refused as \"no indexed file matches\" while 84 indexed files sat under it, and the same for every top-level directory on every project",
      "`complexity` publishes both file counts: `filesMatchingScope` is how many files the scope names and `filesInScope` is how many hold a symbol the metrics are over. They differ when a file in scope has no indexed symbol (83 of 84, measured), and `linesOfCode` covers the second number — so the gap is visible instead of an unexplained discrepancy",
      "`test_mapping.summary.productionSymbols` and `test_gaps.summary.productionSymbols` are the SAME number, and each report also states `excludedAsNoise`, so `productionSymbols + excludedAsNoise` is the store's population under the mode's own filter. `test_gaps.summary.total` is a count of GAPS, not of production symbols — it is the population minus `directlyTested`, and the identity closes in public",
      "A `not-found` answer is bounded: the target is echoed at most 200 characters with its full length stated. A 4,000-character target produced a 9,409-byte answer (~2.6k tokens for two words of information) before this. The bound is on the ECHO only — the search always uses the whole string",
      "A name resolves among several stored symbols. `rootCandidates` says how many — 1 means the name was unique, more means the answer is about one of several",
      "mode `impact` refuses a target the graph cannot root at, with `notFoundReason: \"not-traversable\"` and the symbol type. Such a symbol IS in the index; `callers`/`callees` resolve the same name because they match any type",
      "A depth-capped walk is TRUNCATION and says so: `summary.truncated` is true with `truncationReason` naming the depth cap, beside `maxDepth` and `maxDepthReached`",
      "These three modes' walks run under a wall-clock ceiling THIS TOOL declares — 2,000 ms, published on the answer as `summary.timeBudgetMs` with `summary.timeBudgetExhausted` saying whether it fired (`walk-time-budget-exhausted` among the reasons). It is not an inherited engine default: the graph engine applies no clock bound unless a caller asks for one, so the ceiling is visible here rather than implicit. It is kept because `mode=trace` on a hub is the walk that motivated a clock bound at all. A node is not a unit of work: the per-node caller query is priced by the reproducible ORDER BY, which SQLite applies before the LIMIT, so `edgeLimit` cannot bound it. Measured on this repository's own src: 2,436 matching rows for one symbol cost 85.8 ms of the 87.8 ms, and the walk was unbounded until this budget existed",
      "`dependencies` resolves an internal specifier against the importing file's own directory and LABELS each edge `resolved` / `suffix-match` / `unresolved`. It is not a guess from a basename: on this repository's own src only 74 of 906 `imports` relationships carry both endpoints and `brain_import.resolved_symbol_id` is empty, so specifier resolution is the primary path, not a fallback",
      "A file's `dependents` and `dependencies` lists are capped per row; `dependentsTotal` / `dependenciesTotal` are the real sizes and the Truncated flags say the list was cut",
      "Neither list carries `fileId` — a file id is `<40-hex project id>:<relative path>`, so it repeated the path printed beside it (56,540 of 121,340 bytes on a default page of this repository's src). The path is the locator, `resolution` says how it was reached, and the row above carries the id for the file the row is about",
      "`metrics.couplingEdges` counts only the relationship types listed in `couplingRelationshipTypes`; `exports` and `contains` are index bookkeeping. `stats.relationships` is every row and is a different number",
      "`metrics.maintainability` is unavailable when the formula's domain does not cover the scope (it is negative above roughly 3·10⁴ non-blank lines) rather than clamped to 0",
      "Locations are project-relative. `nodes[].filePath` (absolute) is not emitted, so the same question returns the same bytes on any machine",
      "A mapping entry carries at most 20 links (`linksTruncated` says when more exist); the ranking and every summary count use the complete set",
      "`provenance` on a `dependencies` page is on the REPORT, not repeated per row",
    ],
    performance: "Every mode is paged and says so. `limit` bounds the answer — 25 edges per direction for callers/callees/trace (default), 20 files for dependencies, 50 entries for the test modes. On this repository's src (183 files, 8,565 symbols, 52,597 relationships) a default answer is 1.5-26 KB for eight of the eleven modes; `dependencies` is 75.9 KB (~21k tokens) because 20 of those files really do have 506 internal edges between them, so a caller who wants less should pass `limit`. The graph walk is additionally bounded by depth, per-node site limit, fan-out budget, and a wall-clock budget; whichever fires is named in `truncationReason`. All nine graph cases in fixtures/analyze/latency-gate.sh answer in under 2.4 s on that corpus, against a measured 613 s and several that never returned.",
    safety: "Read-only. Analysis never creates tests or edits source.",
    evidence: "Findings derive from brain_* symbols, files, relationships, complexity, and test-file classifications. `provenance.evidenceClass` classifies what kind of claim the answer is; `unknowns` names every absence the answer rests on.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For the plain per-symbol call graph use `bb_graph` (same engine, evidence tiers). For bounded impact-with-files use mode `impact` (numbers identical to `bb_impact`)."
