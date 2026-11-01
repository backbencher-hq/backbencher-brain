// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_visualize (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_visualize (rendered into docs/tools/bb_visualize.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_visualize.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_visualize/descriptor.ts, src/mcp/tools/bb_visualize/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Canonical nodes and links, with EVERY stored relationship type between a pair kept as a separate link",
      "An auditable projection rather than a picture: each link carries `rowId` (the stored relationship it traces to), its stored `confidence` and its line, and `crossLanguage` where the edge crosses a language boundary; each node carries `line`, `lineEnd` and `qualifiedName`, so the graph is navigable and every edge can be checked against the row that justifies it",
      "Three DISTINCT declared counts — `totalNodesAvailable` (what the scope and filters match), `truncation.originalNodes` (what reached the projection) and `nodes` (what was returned) — so a short page is never mistaken for a whole set",
      "`considered` — what the answer actually READ: how many relationships exist, how many the query read, and in what words the selection is an arbitrary primary-key slice rather than a ranking, plus which symbols got a chance to be in the graph and in what order",
      "`excluded` — what the noise filter removed, how many, and the patterns responsible — always present, including when it is empty, so silence and zero are never confused",
      "`declaredAbsent` with an `absenceNote` when the answer is empty, distinguishing what matched nothing from what matched but did not survive the projection",
      "Text, JSON, or genuinely SELF-CONTAINED HTML: one file with no network, no fonts and no build step, carrying its own force-directed layout and canvas renderer, so it renders offline and in an air-gapped editor",
      "In the HTML the evidence is ENCODED rather than decorated: edge opacity is stored confidence, relationship type sets colour and a structural/behavioural dash, a cross-language edge gets its own wide dash and is drawn beneath the local edges, a stale endpoint is a hollow ring, node size is the index's own gravity, and any node or edge can be selected to read its stored facts",
      "The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited",
      "`view` is `graph` and rides the result as `view`: the force-directed dependency map (nodes are symbols, lines are relationships, sized by stored evidence). Any other value is refused rather than answered as the graph.",
    ],
    errors: ["Missing target for a scoped graph", "Unsupported scope or format", "Unavailable index"],
    limitations: [
      "The graph reflects static indexed relationships",
      "THE EDGE SET IS COMPLETE for the returned nodes, not a slice of the relationship table. It used to be neither fast nor right: the query read `LIMIT maxLinks*3` rows in PRIMARY KEY order and found ZERO of the 1,142 relationships that actually connect 400 selected symbols, because the slice is uncorrelated with the node set. Edges are now fetched by joining both endpoints, so the answer states a complete fact and no M-of-N apology is needed",
      "THE NODE SET IS A SELECTION, and says so. Project and feature scope take the index's own gravity, so the graph is the busiest core rather than a sample; file, module and symbol scope take source order, because that is the only order a reader of one file would want. `considered.nodeSelection` names which applied",
      "A MERGED EDGE KEEPS ITS WEIGHT. Several stored relationship rows share one (source, target, type) \u2014 a call made from 15 call sites is one drawn edge but 15 pieces of evidence. MEASURED on cargo: 394 stored rows between 200 returned nodes collapse to 285 links, so 109 rows used to vanish with nothing to say so. The graph shape is right to merge them, since 15 parallel edges would be noise; the weight is what distinguishes a hot edge from a stray reference, so `occurrences` and every `rowId` ride the edge, thickness encodes it, and the readout totals the stored rows behind the drawn edges",
      "PERFORMANCE IS BOUNDED BY THE OUTPUT BUDGET, and the largest budget is the slowest case. Measured on cargo at the documented maximum of maxNodes 2000: the edge query binds two placeholders per symbol, so 4,000 symbols bind 8,000 parameters \u2014 12.5 ms at 200 nodes, 322 ms at 1,000, 1,340 ms at 4,000. A temp-table formulation of the same join was measured and is WORSE (2,574 ms), because SQLite plans `IN (SELECT ...)` as a repeated index seek, so the direct bind is kept and the cost is declared rather than hidden. `brain_symbol(project_id, gravity_score DESC, line_start)` removes a 40,595-row sort from every call and is created on open, not only on fresh databases",
      "NOISE FILTER (declared, and the caller's to change). Build output and VCS metadata are excluded by default, matched on whole path SEGMENTS. This was previously a bare-substring rule that removed real source: measured on cargo, `dist` removed `src/util/edit_distance.rs`, `out` removed `src/compiler/layout.rs` and `src/compiler/output_depinfo.rs`, and `build` removed `crates/cargo-test-support/build.rs`, leaving 225 of 1,787 symbol-bearing files with no exclusion declared anywhere. Test and spec sources are ordinary source and are INCLUDED by default; `excludePatterns` and `includeTests` change all of it, and whatever is removed is counted onto `excluded`",
      "SCOPE TARGETS ARE VALUES, not patterns. `%` and `_` match themselves and a directory prefix matches on a segment boundary, so `src/util` never reaches `src/utilities`. This matches bb_analyze, whose contract states the same rule; the two tools previously disagreed, and this one was the permissive one (measured: a target of `%` selected every file in the corpus)",
      "LANGUAGE FILTERS ARE APPLIED BEFORE THE LIMIT, not after it. They used to be applied in memory to an already-truncated selection ordered by gravity, so a language whose symbols were not in that slice was cut before the filter ran: measured on cargo, `languages: ['javascript']` returned 0 nodes and declared the project had none, while the index held 56 javascript symbols \u2014 and the declared total counted the language in SQL while the returned nodes did not, so one reply contradicted itself. `relationshipTypes` deliberately filters edges rather than nodes, and says so: a caller narrowing edges must not change which nodes exist",
      "`feature` scope matches a symbol NAME or a docstring. The docstring half is thin in practice and the answer does not pretend otherwise: measured on cargo, 70 of 40,595 symbols (0.17%) carry one, so a feature query is usually a name match",
      "Nodes and links beyond configured budgets are omitted and reported",
      "THE DOCUMENT SAVES ITSELF. Reported more than once, and the gap is real: the artifact arrives as a blob of text and a reader who wants to keep it has no way to. Each document re-serialises its own live page through a Blob and an object URL -- not a data: URI, which several browsers reject at the 300KB-7MB these documents routinely reach -- and publishes that as `saveHtml`, because the control for it belongs in the viewer's Download section rather than floating over the drawing"
    ],
    performance: "maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction.",
    safety: "Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.",
    evidence: "Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata."
