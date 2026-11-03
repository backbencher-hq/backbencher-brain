// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_visualize (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true, modes: project, file, module, symbol, feature).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_visualize.md, docs/BB_VISUALIZE.md, validation/tools/bb_visualize/**.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_visualize/descriptor.ts, src/mcp/tools/bb_visualize/handler.ts,
//   src/intelligence/visualization/visualization-engine.ts, and script/verify-tool-docs.ts (the generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, declared vocabulary, freshness flags,
//   the read-only index boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "Nodes and links projected from the index's stored symbol and relationship rows. Every stored relationship type between a pair is kept as a separate link, each link carries the stored `rowId`, `rowIds` and `occurrences` behind it plus its stored confidence, and each node carries its `line`, `lineEnd`, `qualifiedName` and stored gravity, so every edge can be checked against the row that justifies it",
      "Three DISTINCT declared counts — `totalNodesAvailable` (what the scope and filters match), `truncation.originalNodes` (what reached the projection) and the returned `nodes` — plus the page cursor (`offset`, `nextOffset`, `considered.page`), so a short page is never mistaken for a whole set and an offset past the end is stated as an empty PAGE rather than an empty project",
      "`considered` — what the answer actually READ: the relationship rows connecting the returned nodes (complete for that node set, not a slice of the table), which selection order produced the nodes, the symbol-kind and language census of what was returned, the applied filters, the annotation overlay, and the owner-cascade fold with its caps",
      "`excluded` — what the noise filter removed, how many, and which path segment, build suffix or test rule removed it — always present, including when it is empty",
      "`declaredAbsent` with an `absenceNote` when the answer is empty, distinguishing a query that matched nothing from a page that walked past the end and from symbols that did not survive the projection",
      "A `freshness` envelope (fresh/stale/missing of the graph's files) and per-node `stale` flags, with links inheriting the worst of their endpoints; the read path never refreshes the index and says so",
      "Text, JSON, or a genuinely SELF-CONTAINED HTML artifact: one file with no network request, no webfont and no build step, carrying its own force-directed layout and canvas renderer. Both arrangements — `regions` (named directory pods and one dotted region link per region pair at the overview) and `force` (one force layout, every edge drawn as itself) — are in the page and switchable from its sidebar, and the document declares the one it opens with (`data-bb-layout`)",
      "The HTML payload carries the declared bounds and freshness under `declared`, so the artifact is auditable on its own rather than only next to a JSON call: totalNodesAvailable, originalNodes, returnedNodes, the limits, the page, the owner-cascade counts and the freshness totals",
      "In the HTML the evidence is ENCODED rather than decorated: edge opacity is stored confidence, relationship type sets colour and a structural/behavioural dash, a cross-language edge gets its own wide dash and is drawn beneath the local edges, a stale endpoint is a hollow ring, node size is the index's gravity, and any node or edge can be selected to read its stored facts",
      "The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited",
      "`view` is `graph` and rides the result as `view`: the dependency map. Any other value is refused rather than answered as the graph",
    ],
    errors: [
      "A scoped call without a non-empty `target` — refused by name for file, module, symbol and feature scopes",
      "An unknown scope, view, format, layout or option — refused with the accepted set named, never silently defaulted",
      "A filter value the index does not contain (language, relationship type, symbol kind) — refused with the stored vocabulary named, never answered as zero results",
      "`maxNodes` outside 1..2000, `maxLinks` outside 1..20000, or an `offset` that is not a whole number >= 0 — refused rather than clamped, so a returned page means the page that was asked for",
      "An absent or uninitialised index — a loud error naming the project and the index command",
    ],
    limitations: [
      "The graph is a projection of static indexed relationships; it does not observe runtime calls",
      "THE EDGE SET IS COMPLETE for the returned nodes and declared as such: relationships are fetched by joining the selected identities, not by slicing the relationship table. Several stored rows sharing one (source, target, type) are one drawn edge: `occurrences` and `rowIds` keep the evidence, and the readout totals the rows behind the drawn edges",
      "THE NODE SET IS A SELECTION, and says so in `considered.nodeSelection`: project and feature scope rank by the index's gravity (the busiest core rather than a sample); file, module and symbol scope use source order. `offset` walks that same total order — every ORDER BY ends with `s.id` — so page k+1 starts where page k ended",
      "`symbolKinds` and `languages` scope the whole answer, including the symbols the owner cascade would add. Cascade additions are filtered by the caller's kinds and languages; removed additions are counted on `considered.ownerCascade.nodesFiltered`, and folded rows whose counterpart cannot be drawn are counted on `foldedRowsWithoutDrawableCounterpart` rather than reported as drawn edges",
      "THE OWNER FOLD IS NARROW AND BOUNDED. Only class-like owners are folded, only one level, never for `contains`, and an exact edge always beats an attributed one. The scan caps are declared on `considered.ownerCascade.capped`: at most 500 class-like owners, 3,000 member rows and 20,000 rows on members per answer, which is a bounded sample of the member evidence on a very large hub graph rather than a claim of completeness",
      "NOISE FILTER (declared, and the caller's to change). Build output and VCS metadata are excluded by default, matched on whole path SEGMENTS; `.d.ts`, `.min.js` and `.map` are excluded by build-artifact rule and declared in `excluded.suffixes`; test and spec sources are ordinary source and are INCLUDED by default. `excludePatterns` and `includeTests` change all of it, and whatever is removed is counted onto `excluded` with the rule that removed it",
      "SCOPE TARGETS ARE VALUES, not patterns: `%`, `_` and `\\` match themselves, and a directory prefix matches on a segment boundary, so `src/util` never reaches `src/utilities`",
      "LANGUAGE FILTERS ARE APPLIED BEFORE THE LIMIT. `relationshipTypes` deliberately filters EDGES rather than nodes: a caller narrowing edges must not change which nodes exist, and the applied filter is echoed in `considered.relationshipTypesConsidered`",
      "`feature` scope matches a symbol name or a docstring. The docstring half is thin in practice — 70 of 40,595 symbols carried one on the index measured here — so a feature query is usually a name match",
      "PAGE WINDOW: a page is cut from a fetch of `offset + 2 * maxNodes` symbols, so a deep `offset` reads a wider window than a first page. The returned page and its cursor are exact, but paging deep into a very large scope costs more than the first page",
      "PERFORMANCE on the reference index (6,452 files / 310,423 symbols / 820,040 relationships): the default text answer measured 372 ms p50 / 496 ms p95 warm, with a 723 ms first call in a fresh process; JSON and HTML at the same budget measured 380/392 ms and 357/373 ms p95; the largest accepted budget (`maxNodes: 2000`, JSON) measured 4.4 s p50 / 5.7 s p95 with a 15.9 MB payload. The HTML artifact for the default 200-node graph is about 0.84 MB. All of it is bounded by the output budget, not by a client timeout",
      "The HTML artifact is a single file with no network, no fonts and no build step; the view publishes its own state (`window.__bbView`) so the census, the region links and the layout can be checked rather than inferred from pixels",
      "THE DOCUMENT SAVES ITSELF: each artifact re-serialises its own live page through a Blob and an object URL and publishes that as `saveHtml`, because a reader who wants to keep the page has no other way to",
    ],
    performance: "The default answer on the reference index measured 372 ms p50 / 496 ms p95 warm (723 ms first call in a fresh process); JSON and HTML at the same budget measured 380/392 ms and 357/373 ms p95. `maxNodes` and `maxLinks` bound the output and the edge fetch; the largest accepted budget (2000 nodes / 20000 links) measured 4.4 s p50 / 5.7 s p95 with a 15.9 MB JSON payload on that index, and is the declared slow case.",
    safety: "Read-only, and byte-read-only: the tool opens the index with the driver's read-only mode, runs no migrations or healers, writes neither the database nor its WAL, and never writes the repositories it visualises. The HTML output contains the same bounded graph as JSON and makes no network request.",
    evidence: "Nodes and links resolve to canonical indexed entities; links with an endpoint outside the returned node set are not emitted, and the two reasons an edge is absent (the node cut and the maxLinks budget) are counted apart in `provenance`. Folded edges state the member row they came through (`ownerCascade`, `matchedMembers`), and the stored row itself is never modified.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For one symbol's depth-bounded callers and callees with per-edge evidence tiers, use `bb_graph`; `bb_visualize` projects a whole scope — a project, file, module, symbol or feature — into one bounded graph and renders it as text, JSON or a self-contained HTML map."
