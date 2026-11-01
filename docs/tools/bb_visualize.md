<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_visualize: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_visualize through any MCP host, the CLI (`bb tool bb_visualize`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_visualize/descriptor.ts, src/mcp/tools/bb_visualize/handler.ts, script/tool-docs/curation/bb_visualize.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_visualize --write`.
-->
# `bb_visualize`

Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and genuinely self-contained HTML (no network, no fonts, no build step — it renders offline, in an air-gapped editor, anywhere). The answer is an AUDITABLE projection of the index, not a picture: every link carries the stored relationship row it traces to (rowId) and its stored confidence, and every node carries its line, lineEnd and qualifiedName, so the graph is navigable and every edge can be checked against the row that justifies it. Distinct relationship types between the same pair are SEPARATE links, so a pair that is both contains and exports renders as both. Node size follows the index’s own gravity score. In the HTML, edge opacity encodes stored confidence, relationship type sets colour and a structural/behavioural dash, a CROSS-LANGUAGE edge gets its own wide dash and is drawn beneath the local edges so a polyglot project shows where one language hands off to another, and a stale endpoint (file changed since index) is drawn as a hollow ring; links inherit worst-of-endpoints. Nodes are grouped into the NAMED REGION they live in — a directory of the project, a directory with fewer than three matching symbols folded into its parent — each region placed at its own anchor inside a rounded pod and switchable from the sidebar like any other class, At overview zoom an edge BETWEEN two regions is drawn as one REGION LINK per region pair — dotted, because it is a summary and not a stored row; its width and alpha come from how many stored edges it stands for — while an edge INSIDE one region is always drawn as itself, and the individual cross-region edges return past ~1.15x zoom or when a link is opened (double-click frames both of its regions). Edges drawn individually are capped at a zoom-dependent count with the readout naming the cap, because an uncapped aggregate is a smear rather than a map; the frame's readout reconciles the picture with the census (how many cross-region edges the links stand for, how many pairs exist, how to open them), the sidebar's live line repeats it, and the links — with their regions, counts, stored rows, commonest relationship and screen geometry — are PUBLISHED on the view's API rather than only painted, because a summary that can only be seen cannot be checked. Moving the pointer across the map never changes the view: hover emphasises the node's own edges, and a CLICK is what focuses, so the map cannot dissolve under the reader's hand. The graph has TWO arrangements and the reader picks: `layout: "regions"` (the default) is the region map described above, and `layout: "force"` drops the directories entirely — one force layout, no region pods and no region links, every stored edge drawn as itself under the same zoom-dependent cap — which is the graph as it looked before the regions existed, and which is the honest shape for a project whose parts do not fall along directory lines. The layout is written onto the document itself (data-bb-layout) and both arrangements are offered as a switch in the generated page's sidebar, so `layout` sets the arrangement the page OPENS with and the reader can move between them without regenerating anything. The picked-item panel is deliberately not a modal: it docks to either side of the frame and collapses to its own heading — which always names what is picked — while KEEPING the selection, because hiding a panel to see the picture must not cost the reader the focus and the zoom they just asked for (its X is the control that clears). The layout runs in frame-sized slices with a progress readout, so the artifact stays interactive and visible at the maximum graph size and in a background tab. Every answer declares its bounds as three DISTINCT numbers — totalNodesAvailable (what the scope and filters actually match), truncation.originalNodes (what reached the projection) and nodes (what was returned) — so a short page can never be mistaken for a whole set. `offset` walks that same order rather than re-reading the first page: the ranking carries a final `s.id` tiebreaker so page k+1 begins exactly where page k ended, and `considered.page` declares which page the answer is, of how many, and where the next one starts (null on the last) — a scope larger than one page can be walked, and an offset past the end is stated as an empty PAGE rather than as an empty project. Whatever the noise filter removes is counted onto excluded with the patterns responsible — always present, including when it is empty, so silence and zero are never confused — and an empty answer is declaredAbsent with a reason rather than an empty result that looks like a real project. `considered` declares what the answer actually READ: how many relationships exist, how many the query read, and in what words the selection is an arbitrary primary-key slice rather than a ranking, plus which symbols got a chance to be in the graph and in what order. `considered.overlays` carries the index's OTHER facts about the returned symbols — agent annotations from `bb_annotate`, matched by NAME AND PATH (never by name alone: two symbols can share a name, and a note is about one of them), with the notes themselves, the author class, and a count of notes that name a symbol of this scope at another path and are therefore NOT attached. The layer is declared even when it is empty, so "no agent has annotated these symbols" and "nobody looked" are different replies. Language filters are applied BEFORE the limit, so a rare language receives the same budget as a common one. The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited. Member-level relationships are FOLDED onto the owner class, and every folded edge says so: when a class-like symbol is selected and a relationship is stored on one of its MEMBERS that is not itself in the node set, the row is attributed to the owner and the edge carries ownerCascade with matchedMembers naming the member it came through — so an attributed edge is never presented as one the index stored between the two drawn nodes. The fold is deliberately narrow (one level, class-like owners only, never for contains, an exact edge always preferred to an attributed one) and `considered.ownerCascade` declares whether it ran, how many members it scanned, how many rows it folded and whether a cap truncated it, so "nothing to fold" and "the fold never ran" are distinguishable. This is NOT bb_graph's depth-N traversal: the edge set is the relationships between the selected nodes, plus the folded member rows.

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
      "description": "file, module, symbol, or feature target (`symbol`/`symbolName`/`query` are accepted as aliases)"
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
      "description": "symbol kinds to KEEP (class, interface, struct, enum, function, method, property, constant, variable, ...). Omitted = every kind, and on a real project gravity ranks files’ constants and properties first: the reply states the composition it returned in `considered.kindCensus`, so a graph of string constants is visible as one rather than mistaken for the architecture. Matched case-insensitively against the index’s own spellings, and a kind the index does not contain is REJECTED with the stored set named (never answered as zero nodes). The applied filter is echoed in considered.symbolKindsConsidered."
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

- Canonical nodes and links, with EVERY stored relationship type between a pair kept as a separate link
- An auditable projection rather than a picture: each link carries `rowId` (the stored relationship it traces to), its stored `confidence` and its line, and `crossLanguage` where the edge crosses a language boundary; each node carries `line`, `lineEnd` and `qualifiedName`, so the graph is navigable and every edge can be checked against the row that justifies it
- Three DISTINCT declared counts — `totalNodesAvailable` (what the scope and filters match), `truncation.originalNodes` (what reached the projection) and `nodes` (what was returned) — so a short page is never mistaken for a whole set
- `considered` — what the answer actually READ: how many relationships exist, how many the query read, and in what words the selection is an arbitrary primary-key slice rather than a ranking, plus which symbols got a chance to be in the graph and in what order
- `excluded` — what the noise filter removed, how many, and the patterns responsible — always present, including when it is empty, so silence and zero are never confused
- `declaredAbsent` with an `absenceNote` when the answer is empty, distinguishing what matched nothing from what matched but did not survive the projection
- Text, JSON, or genuinely SELF-CONTAINED HTML: one file with no network, no fonts and no build step, carrying its own force-directed layout and canvas renderer, so it renders offline and in an air-gapped editor
- In the HTML the evidence is ENCODED rather than decorated: edge opacity is stored confidence, relationship type sets colour and a structural/behavioural dash, a cross-language edge gets its own wide dash and is drawn beneath the local edges, a stale endpoint is a hollow ring, node size is the index's own gravity, and any node or edge can be selected to read its stored facts
- The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited
- `view` is `graph` and rides the result as `view`: the force-directed dependency map (nodes are symbols, lines are relationships, sized by stored evidence). Any other value is refused rather than answered as the graph.

## Examples

`{"scope":"symbol","target":"handleRequest","format":"json"}`

`{"scope":"module","target":"src/api","format":"html"}`

## Errors

- Missing target for a scoped graph
- Unsupported scope or format
- Unavailable index

## Limitations

- The graph reflects static indexed relationships
- THE EDGE SET IS COMPLETE for the returned nodes, not a slice of the relationship table. It used to be neither fast nor right: the query read `LIMIT maxLinks*3` rows in PRIMARY KEY order and found ZERO of the 1,142 relationships that actually connect 400 selected symbols, because the slice is uncorrelated with the node set. Edges are now fetched by joining both endpoints, so the answer states a complete fact and no M-of-N apology is needed
- THE NODE SET IS A SELECTION, and says so. Project and feature scope take the index's own gravity, so the graph is the busiest core rather than a sample; file, module and symbol scope take source order, because that is the only order a reader of one file would want. `considered.nodeSelection` names which applied
- A MERGED EDGE KEEPS ITS WEIGHT. Several stored relationship rows share one (source, target, type) — a call made from 15 call sites is one drawn edge but 15 pieces of evidence. MEASURED on cargo: 394 stored rows between 200 returned nodes collapse to 285 links, so 109 rows used to vanish with nothing to say so. The graph shape is right to merge them, since 15 parallel edges would be noise; the weight is what distinguishes a hot edge from a stray reference, so `occurrences` and every `rowId` ride the edge, thickness encodes it, and the readout totals the stored rows behind the drawn edges
- PERFORMANCE IS BOUNDED BY THE OUTPUT BUDGET, and the largest budget is the slowest case. Measured on cargo at the documented maximum of maxNodes 2000: the edge query binds two placeholders per symbol, so 4,000 symbols bind 8,000 parameters — 12.5 ms at 200 nodes, 322 ms at 1,000, 1,340 ms at 4,000. A temp-table formulation of the same join was measured and is WORSE (2,574 ms), because SQLite plans `IN (SELECT ...)` as a repeated index seek, so the direct bind is kept and the cost is declared rather than hidden. `brain_symbol(project_id, gravity_score DESC, line_start)` removes a 40,595-row sort from every call and is created on open, not only on fresh databases
- NOISE FILTER (declared, and the caller's to change). Build output and VCS metadata are excluded by default, matched on whole path SEGMENTS. This was previously a bare-substring rule that removed real source: measured on cargo, `dist` removed `src/util/edit_distance.rs`, `out` removed `src/compiler/layout.rs` and `src/compiler/output_depinfo.rs`, and `build` removed `crates/cargo-test-support/build.rs`, leaving 225 of 1,787 symbol-bearing files with no exclusion declared anywhere. Test and spec sources are ordinary source and are INCLUDED by default; `excludePatterns` and `includeTests` change all of it, and whatever is removed is counted onto `excluded`
- SCOPE TARGETS ARE VALUES, not patterns. `%` and `_` match themselves and a directory prefix matches on a segment boundary, so `src/util` never reaches `src/utilities`. This matches bb_analyze, whose contract states the same rule; the two tools previously disagreed, and this one was the permissive one (measured: a target of `%` selected every file in the corpus)
- LANGUAGE FILTERS ARE APPLIED BEFORE THE LIMIT, not after it. They used to be applied in memory to an already-truncated selection ordered by gravity, so a language whose symbols were not in that slice was cut before the filter ran: measured on cargo, `languages: ['javascript']` returned 0 nodes and declared the project had none, while the index held 56 javascript symbols — and the declared total counted the language in SQL while the returned nodes did not, so one reply contradicted itself. `relationshipTypes` deliberately filters edges rather than nodes, and says so: a caller narrowing edges must not change which nodes exist
- `feature` scope matches a symbol NAME or a docstring. The docstring half is thin in practice and the answer does not pretend otherwise: measured on cargo, 70 of 40,595 symbols (0.17%) carry one, so a feature query is usually a name match
- Nodes and links beyond configured budgets are omitted and reported
- THE DOCUMENT SAVES ITSELF. Reported more than once, and the gap is real: the artifact arrives as a blob of text and a reader who wants to keep it has no way to. Each document re-serialises its own live page through a Blob and an object URL -- not a data: URI, which several browsers reject at the 300KB-7MB these documents routinely reach -- and publishes that as `saveHtml`, because the control for it belongs in the viewer's Download section rather than floating over the drawing

## Performance

maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction.

## Safety

Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.

## Relationship to other tools

For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness. This tool does NOT auto-refresh: the flags and the envelope DESCRIBE the index as it stands, nothing is reindexed to make them stale or fresh, and there is no `refresh` option to opt out with. Project scope → run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only). File scope → run: `bb index "<file>"` for the one file named in the answer. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
