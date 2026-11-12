<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_visualize: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_visualize through any MCP host, the CLI (`bb tool bb_visualize`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_visualize/descriptor.ts, src/mcp/tools/bb_visualize/handler.ts, script/tool-docs/curation/bb_visualize.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_visualize --write`.
-->
# `bb_visualize`

Scoped dependency and architecture visualization: one bounded projection over the index's stored symbol and relationship rows, with explicit filters, provenance, truncation, machine-readable JSON, and genuinely self-contained HTML (no network, no fonts, no build step — it renders offline, in an air-gapped editor, anywhere). The answer is an AUDITABLE projection of the index, not a picture: every link carries the stored relationship row it traces to (rowId) and its stored confidence, and every node carries its line, lineEnd and qualifiedName, so the graph is navigable and every edge can be checked against the row that justifies it. Distinct relationship types between the same pair are SEPARATE links, so a pair that is both contains and exports renders as both. Node size follows the index’s own gravity score. In the HTML, edge opacity encodes stored confidence, relationship type sets colour and a structural/behavioural dash, a CROSS-LANGUAGE edge gets its own wide dash and is drawn beneath the local edges so a polyglot project shows where one language hands off to another, and a stale endpoint (file changed since index) is drawn as a hollow ring; links inherit worst-of-endpoints. Nodes are grouped into the NAMED REGION they live in — a directory of the project, a directory with fewer than three matching symbols folded into its parent — each region placed at its own anchor inside a rounded pod and switchable from the sidebar like any other class, At overview zoom an edge BETWEEN two regions is drawn as one REGION LINK per region pair — dotted, because it is a summary and not a stored row; its width and alpha come from how many stored edges it stands for — while an edge INSIDE one region is always drawn as itself, and the individual cross-region edges return past ~1.15x zoom or when a link is opened (double-click frames both of its regions). Edges drawn individually are capped at a zoom-dependent count with the readout naming the cap, because an uncapped aggregate is a smear rather than a map; the frame's readout reconciles the picture with the census (how many cross-region edges the links stand for, how many pairs exist, how to open them), the sidebar's live line repeats it, and the links — with their regions, counts, stored rows, commonest relationship and screen geometry — are PUBLISHED on the view's API rather than only painted, because a summary that can only be seen cannot be checked. Moving the pointer across the map never changes the view: hover emphasises the node's own edges, and a CLICK is what focuses, so the map cannot dissolve under the reader's hand. The graph has TWO arrangements and the reader picks: `layout: "regions"` (the default) is the region map described above, and `layout: "force"` drops the directories entirely — one force layout, no region pods and no region links, every stored edge drawn as itself under the same zoom-dependent cap — which is the graph as it looked before the regions existed, and which is the honest shape for a project whose parts do not fall along directory lines. The layout is written onto the document itself (data-bb-layout) and both arrangements are offered as a switch in the generated page's sidebar, so `layout` sets the arrangement the page OPENS with and the reader can move between them without regenerating anything. The picked-item panel is deliberately not a modal: it docks to either side of the frame and collapses to its own heading — which always names what is picked — while KEEPING the selection, because hiding a panel to see the picture must not cost the reader the focus and the zoom they just asked for (its X is the control that clears). The layout runs in frame-sized slices with a progress readout, so the artifact stays interactive and visible at the maximum graph size and in a background tab. Every answer declares its bounds as three DISTINCT numbers — totalNodesAvailable (what the scope and filters actually match), truncation.originalNodes (what reached the projection) and nodes (what was returned) — and the HTML artifact carries the same declaration in its machine-readable payload (`declared`), so a short page can never be mistaken for a whole set in any format. `offset` walks that same order rather than re-reading the first page: the ranking carries a final `s.id` tiebreaker so page k+1 begins exactly where page k ended, and `considered.page` declares which page the answer is, of how many, and where the next one starts (null on the last) — a scope larger than one page can be walked, and an offset past the end is stated as an empty PAGE rather than as an empty project. Whatever the noise filter removes is counted onto excluded with the patterns responsible — always present, including when it is empty, so silence and zero are never confused — and an empty answer is declaredAbsent with a reason rather than an empty result that looks like a real project. `considered` declares what the answer actually READ: the relationship rows connecting the returned nodes (complete for that node set, not a slice of the relationship table), the selection order that chose the nodes, the applied filters, and the symbol-kind and language census of what was returned, plus the annotation overlay and the owner-cascade counts. `considered.overlays` carries the index's OTHER facts about the returned symbols — agent annotations from `bb_annotate`, matched by NAME AND PATH (never by name alone: two symbols can share a name, and a note is about one of them), with the notes themselves, the author class, and a count of notes that name a symbol of this scope at another path and are therefore NOT attached. The layer is declared even when it is empty, so "no agent has annotated these symbols" and "nobody looked" are different replies. Language filters are applied BEFORE the limit, so a rare language receives the same budget as a common one. The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited. Member-level relationships are FOLDED onto the owner class, and every folded edge says so: when a class-like symbol is selected and a relationship is stored on one of its MEMBERS that is not itself in the node set, the row is attributed to the owner and the edge carries ownerCascade with matchedMembers naming the member it came through — so an attributed edge is never presented as one the index stored between the two drawn nodes. The fold is deliberately narrow (one level, class-like owners only, never for contains, an exact edge always preferred to an attributed one) and `considered.ownerCascade` declares whether it ran, how many members it scanned, how many rows it folded and whether a cap truncated it, so "nothing to fold" and "the fold never ran" are distinguishable. This is NOT bb_graph's depth-N traversal: the edge set is the relationships between the selected nodes, plus the folded member rows.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `project`, `file`, `module`, `symbol`, `feature`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"scope":"project","maxNodes":200,"maxLinks":5000,"offset":0,"format":"text"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "project",
        "file",
        "module",
        "symbol",
        "feature"
      ],
      "description": "graph scope (default project)"
    },
    "target": {
      "type": "string",
      "description": "file, module, symbol, or feature target (`symbol` and `query` are accepted as aliases for `target`)"
    },
    "maxNodes": {
      "type": "number",
      "description": "max nodes (default 200, accepted range 1-2000); 0 and anything above the ceiling are REFUSED with the range named rather than clamped, because a returned page must mean the page that was asked for"
    },
    "maxLinks": {
      "type": "number",
      "description": "max links (default 5000, accepted range 1-20000); 0 and anything above the ceiling are REFUSED with the range named rather than clamped, because a returned page must mean the page that was asked for"
    },
    "offset": {
      "type": "number",
      "description": "how many symbols of the ranking to SKIP before this page starts (default 0; a whole number >= 0, refused rather than normalised). The order is the scope's own ranking with a final `s.id` tiebreaker, so page k+1 begins where page k ended and no symbol is repeated or lost. `considered.page` states the page number, the page count, the total matching the scope, and the next offset (null on the last page). Without this, a scope bigger than `maxNodes` had symbols that could not be asked for at all"
    },
    "relationshipTypes": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "relationship type filter. Matched case-insensitively against the index's OWN stored spellings, and a type the index does not contain is REJECTED with the stored set named (never answered as zero links, which would read like a project with no calls). The applied filter is echoed in considered.relationshipTypesConsidered."
    },
    "symbolKinds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "symbol kinds to KEEP (class, interface, struct, enum, function, method, property, constant, variable, ...). Omitted = every kind, and on a real project gravity ranks files’ constants and properties first: the reply states the composition it returned in `considered.kindCensus`, so a graph of string constants is visible as one rather than mistaken for the architecture. Matched case-insensitively against the index’s own spellings, and a kind the index does not contain is REJECTED with the stored set named (never answered as zero nodes). The applied filter is echoed in considered.symbolKindsConsidered. The filter also scopes the symbols the owner cascade would add; removed additions are counted on considered.ownerCascade.nodesFiltered."
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "language filter. Matched case-insensitively against the index's OWN stored spellings, and an unknown language is REJECTED with the stored set named (never answered as zero nodes). Applied BEFORE the node limit, so a rare language receives the same budget as a common one, and the applied filter is echoed in considered.languagesConsidered."
    },
    "excludePatterns": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "path SEGMENTS treated as build noise and excluded. Matched on whole segments, never as substrings — a substring rule removed `src/util/edit_distance.rs` because `dist` is inside `edit_distance`, and `src/compiler/layout.rs` because `out` is inside `layout`. Omit to use the defaults (node_modules, .git, .next, .turbo, .cache, coverage, dist, build, out, target, vendor, __pycache__)"
    },
    "includeTests": {
      "type": "boolean",
      "description": "include test/spec sources. Default true: they are ordinary source. When false, test/spec/testdata directories and *_test.* / *spec.* files are excluded and counted"
    },
    "view": {
      "type": "string",
      "enum": [
        "graph"
      ],
      "default": "graph",
      "description": "The dependency map (nodes are symbols, lines are relationships, sized by stored evidence). Accepts only `graph`; any other value is REFUSED rather than answered as the graph."
    },
    "layout": {
      "type": "string",
      "enum": [
        "regions",
        "force"
      ],
      "default": "regions",
      "description": "the GRAPH view's arrangement, and the only option here that shapes the picture without changing the data. `regions` (default) groups every node into the DIRECTORY it lives in, anchors and names each region, and summarises the edges between regions as one dotted region link per pair at the overview. `force` ignores directories entirely: one force layout, no pods and no region links, every stored edge drawn as itself under a zoom-dependent cap the readout names. The generated page carries BOTH as a switch in its sidebar, so this sets the arrangement the page OPENS with; the layout is declared on the document itself (data-bb-layout), so the file draws what it says it is."
    },
    "format": {
      "type": "string",
      "enum": [
        "text",
        "json",
        "html"
      ],
      "description": "output format (default text)"
    }
  }
}
```

## Returns

- Nodes and links projected from the index's stored symbol and relationship rows. Every stored relationship type between a pair is kept as a separate link, each link carries the stored `rowId`, `rowIds` and `occurrences` behind it plus its stored confidence, and each node carries its `line`, `lineEnd`, `qualifiedName` and stored gravity, so every edge can be checked against the row that justifies it
- Three DISTINCT declared counts — `totalNodesAvailable` (what the scope and filters match), `truncation.originalNodes` (what reached the projection) and the returned `nodes` — plus the page cursor (`offset`, `nextOffset`, `considered.page`), so a short page is never mistaken for a whole set and an offset past the end is stated as an empty PAGE rather than an empty project
- `considered` — what the answer actually READ: the relationship rows connecting the returned nodes (complete for that node set, not a slice of the table), which selection order produced the nodes, the symbol-kind and language census of what was returned, the applied filters, the annotation overlay, and the owner-cascade fold with its caps
- `excluded` — what the noise filter removed, how many, and which path segment, build suffix or test rule removed it — always present, including when it is empty
- `declaredAbsent` with an `absenceNote` when the answer is empty, distinguishing a query that matched nothing from a page that walked past the end and from symbols that did not survive the projection
- A `freshness` envelope (fresh/stale/missing of the graph's files) and per-node `stale` flags, with links inheriting the worst of their endpoints; the read path never refreshes the index and says so
- Text, JSON, or a genuinely SELF-CONTAINED HTML artifact: one file with no network request, no webfont and no build step, carrying its own force-directed layout and canvas renderer. Both arrangements — `regions` (named directory pods and one dotted region link per region pair at the overview) and `force` (one force layout, every edge drawn as itself) — are in the page and switchable from its sidebar, and the document declares the one it opens with (`data-bb-layout`)
- The HTML payload carries the declared bounds and freshness under `declared`, so the artifact is auditable on its own rather than only next to a JSON call: totalNodesAvailable, originalNodes, returnedNodes, the limits, the page, the owner-cascade counts and the freshness totals
- In the HTML the evidence is ENCODED rather than decorated: edge opacity is stored confidence, relationship type sets colour and a structural/behavioural dash, a cross-language edge gets its own wide dash and is drawn beneath the local edges, a stale endpoint is a hollow ring, node size is the index's gravity, and any node or edge can be selected to read its stored facts
- The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited
- `view` is `graph` and rides the result as `view`: the dependency map. Any other value is refused rather than answered as the graph

## Examples

`{"scope":"symbol","target":"handleRequest","format":"json"}`

`{"scope":"module","target":"src/api","format":"html"}`

## Errors

- A scoped call without a non-empty `target` — refused by name for file, module, symbol and feature scopes
- An unknown scope, view, format, layout or option — refused with the accepted set named, never silently defaulted
- A filter value the index does not contain (language, relationship type, symbol kind) — refused with the stored vocabulary named, never answered as zero results
- `maxNodes` outside 1..2000, `maxLinks` outside 1..20000, or an `offset` that is not a whole number >= 0 — refused rather than clamped, so a returned page means the page that was asked for
- An absent or uninitialised index — a loud error naming the project and the index command

## Limitations

- The graph is a projection of static indexed relationships; it does not observe runtime calls
- THE EDGE SET IS COMPLETE for the returned nodes and declared as such: relationships are fetched by joining the selected identities, not by slicing the relationship table. Several stored rows sharing one (source, target, type) are one drawn edge: `occurrences` and `rowIds` keep the evidence, and the readout totals the rows behind the drawn edges
- THE NODE SET IS A SELECTION, and says so in `considered.nodeSelection`: project and feature scope rank by the index's gravity (the busiest core rather than a sample); file, module and symbol scope use source order. `offset` walks that same total order — every ORDER BY ends with `s.id` — so page k+1 starts where page k ended
- `symbolKinds` and `languages` scope the whole answer, including the symbols the owner cascade would add. Cascade additions are filtered by the caller's kinds and languages; removed additions are counted on `considered.ownerCascade.nodesFiltered`, and folded rows whose counterpart cannot be drawn are counted on `foldedRowsWithoutDrawableCounterpart` rather than reported as drawn edges
- THE OWNER FOLD IS NARROW AND BOUNDED. Only class-like owners are folded, only one level, never for `contains`, and an exact edge always beats an attributed one. The scan caps are declared on `considered.ownerCascade.capped`: at most 500 class-like owners, 3,000 member rows and 20,000 rows on members per answer, which is a bounded sample of the member evidence on a very large hub graph rather than a claim of completeness
- NOISE FILTER (declared, and the caller's to change). Build output and VCS metadata are excluded by default, matched on whole path SEGMENTS; `.d.ts`, `.min.js` and `.map` are excluded by build-artifact rule and declared in `excluded.suffixes`; test and spec sources are ordinary source and are INCLUDED by default. `excludePatterns` and `includeTests` change all of it, and whatever is removed is counted onto `excluded` with the rule that removed it
- SCOPE TARGETS ARE VALUES, not patterns: `%`, `_` and `\` match themselves, and a directory prefix matches on a segment boundary, so `src/util` never reaches `src/utilities`
- LANGUAGE FILTERS ARE APPLIED BEFORE THE LIMIT. `relationshipTypes` deliberately filters EDGES rather than nodes: a caller narrowing edges must not change which nodes exist, and the applied filter is echoed in `considered.relationshipTypesConsidered`
- `feature` scope matches a symbol name or a docstring. The docstring half is thin in practice — 70 of 40,595 symbols carried one on the index measured here — so a feature query is usually a name match
- PAGE WINDOW: a page is cut from a fetch of `offset + 2 * maxNodes` symbols, so a deep `offset` reads a wider window than a first page. The returned page and its cursor are exact, but paging deep into a very large scope costs more than the first page
- PERFORMANCE on the reference index (6,452 files / 310,423 symbols / 820,040 relationships): the default text answer measured 372 ms p50 / 496 ms p95 warm, with a 723 ms first call in a fresh process; JSON and HTML at the same budget measured 380/392 ms and 357/373 ms p95; the largest accepted budget (`maxNodes: 2000`, JSON) measured 4.4 s p50 / 5.7 s p95 with a 15.9 MB payload. The HTML artifact for the default 200-node graph is about 0.84 MB. All of it is bounded by the output budget, not by a client timeout
- The HTML artifact is a single file with no network, no fonts and no build step; the view publishes its own state (`window.__bbView`) so the census, the region links and the layout can be checked rather than inferred from pixels
- THE DOCUMENT SAVES ITSELF: each artifact re-serialises its own live page through a Blob and an object URL and publishes that as `saveHtml`, because a reader who wants to keep the page has no other way to

## Performance

The default answer on the reference index measured 372 ms p50 / 496 ms p95 warm (723 ms first call in a fresh process); JSON and HTML at the same budget measured 380/392 ms and 357/373 ms p95. `maxNodes` and `maxLinks` bound the output and the edge fetch; the largest accepted budget (2000 nodes / 20000 links) measured 4.4 s p50 / 5.7 s p95 with a 15.9 MB JSON payload on that index, and is the declared slow case.

## Safety

Read-only, and byte-read-only: the tool opens the index with the driver's read-only mode, runs no migrations or healers, writes neither the database nor its WAL, and never writes the repositories it visualises. The HTML output contains the same bounded graph as JSON and makes no network request.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with an endpoint outside the returned node set are not emitted, and the two reasons an edge is absent (the node cut and the maxLinks budget) are counted apart in `provenance`. Folded edges state the member row they came through (`ownerCascade`, `matchedMembers`), and the stored row itself is never modified.

## Relationship to other tools

For one symbol's depth-bounded callers and callees with per-edge evidence tiers, use `bb_graph`; `bb_visualize` projects a whole scope — a project, file, module, symbol or feature — into one bounded graph and renders it as text, JSON or a self-contained HTML map.

## Deep guides

- [Bounded dependency maps and their declared bounds](../BB_VISUALIZE.md)

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness. This tool does NOT auto-refresh: the flags and the envelope DESCRIBE the index as it stands, nothing is reindexed to make them stale or fresh, and there is no `refresh` option to opt out with. Project scope → run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only). File scope → run: `bb index --file "<file>"` for the one file named in the answer. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
