# `bb_visualize`

Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and genuinely self-contained HTML (no network, no fonts, no build step — it renders offline, in an air-gapped editor, anywhere). The answer is an AUDITABLE projection of the index, not a picture: every link carries the stored relationship row it traces to (rowId) and its stored confidence, and every node carries its line, lineEnd and qualifiedName, so the graph is navigable and every edge can be checked against the row that justifies it. Distinct relationship types between the same pair are SEPARATE links, so a pair that is both contains and exports renders as both. Node size follows the index’s own gravity score. In the HTML, edge opacity encodes stored confidence, relationship type sets colour and a structural/behavioural dash, a CROSS-LANGUAGE edge gets its own wide dash and is drawn beneath the local edges so a polyglot project shows where one language hands off to another, and a stale endpoint (file changed since index) is drawn as a hollow ring; links inherit worst-of-endpoints. The layout runs in frame-sized slices with a progress readout, so the artifact stays interactive and visible at the maximum graph size and in a background tab. Every answer declares its bounds as three DISTINCT numbers — totalNodesAvailable (what the scope and filters actually match), truncation.originalNodes (what reached the projection) and nodes (what was returned) — so a short page can never be mistaken for a whole set. Whatever the noise filter removes is counted onto excluded with the patterns responsible — always present, including when it is empty, so silence and zero are never confused — and an empty answer is declaredAbsent with a reason rather than an empty result that looks like a real project. `considered` declares what the answer actually READ: how many relationships exist, how many the query read, and in what words the selection is an arbitrary primary-key slice rather than a ranking, plus which symbols got a chance to be in the graph and in what order. Language filters are applied BEFORE the limit, so a rare language receives the same budget as a common one. The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited. Same owner-cascade semantics as bb_graph: member-level relationships are attributed to the owner class.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `project`, `file`, `module`, `symbol`, `feature`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"scope":"project","maxNodes":200,"maxLinks":5000,"format":"text"}`

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
      "description": "max nodes (default 200)"
    },
    "maxLinks": {
      "type": "number",
      "description": "max links (default 5000)"
    },
    "relationshipTypes": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "relationship type filter"
    },
    "languages": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "language filter"
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
        "graph",
        "codemap",
        "class"
      ],
      "default": "graph",
      "description": "which picture of the project to draw. `graph` (default) is the force-directed dependency map: nodes are symbols, lines are relationships, sized by stored evidence. `codemap` is a CODE MAP in the spirit of the Sourcegraph Chromium map: a squarified treemap where one rectangle is one SYMBOL, sized by the lines it spans, nested inside its file and its top-level directory — so the shape of a codebase, the density of its definitions, and what each file is made of are all visible at once. IMPORTANT AND EXACT: this is a symbol-level map, not a token-level one. The index stores symbols with line spans and kinds, not tokens, so `codemap` draws symbols and says so in its own legend. `class` is a UML-style class diagram: boxes for classes, interfaces, structs and enums, with inheritance, implementation and containment edges. It is only as complete as the index, and it DECLARES what it could not resolve rather than quietly drawing a partial diagram. The view is independent of `format`, so `view` composes with every output format."
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
- `view` — an axis INDEPENDENT of `format`, so every view composes with every delivery form. `graph` is the force-directed dependency map; `codemap` is a Sourcegraph-style rectangular code map; `class` is a UML-style class diagram. The chosen view rides the result as `view`, so a caller can tell which picture an answer describes

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
- THE CODE MAP ZOOMS AND PANS, because at 1,400 symbols across a ~1,000px viewport every symbol band was a fraction of a pixel and a reader could extract no name from the picture. The treemap is laid out into a WORLD sized from the viewport divided by 0.82 and placed with a CSS transform, so a wheel event is one composited write rather than 2,111 layout updates; the wheel zooms about the cursor, drag pans, double-click frames one file, and `fit` returns to the whole map. MEASURED, a fixed 2400x1600 world against a ~974px viewport fitted at 41%, which made the file names it had just added unreadable -- hence the viewport-derived size. File names are drawn in world units so they grow with the zoom, and are collision-tested so two never print over one another
- `view: codemap` is SYMBOL-LEVEL, not token-level, and the artifact says so in its own legend. The index stores symbols with line spans and kinds; it stores no tokens, so a character-level code map would be promising a resolution the data does not have. Directories are named RELATIVE to the scope target, because grouping by the path's top segment gave a scoped call exactly one group — a treemap of a single rectangle
- `view: class` is only as complete as the index, and it SPLITS what it could not draw rather than reporting one number. Relationships to a type this scope did not select (`outside`) and relationships to a selected field, method or enum member (`members`) are different failures: conflating them made the diagram claim a missing class hierarchy where none was missing — MEASURED on cargo's src/compiler, the old single figure read 969 while the index holds 2 `implements` relationships there and 967 of the rest were `contains` links pointing at fields. Members are now DRAWN in each box from those same containment links
- `view: class` ORDERS TYPES BEFORE METHODS, because gravity on a real project belongs to the functions that do the work and the types inheritance connects would otherwise be cut by the query's own LIMIT. MEASURED: with the plain ordering a module scope put 135 types past the limit behind 1,200 methods and drew 1 arrow out of 970; type-like symbols are now ordered first, and where a narrow scope selects types from elsewhere in the project to make an inheritance edge drawable, the count is declared in `considered.nodeSelection`
- A class diagram of many types cannot be legible as an overview. Rows wrap into a grid SHAPED BY THE VIEWPORT rather than running off both edges -- MEASURED, a fixed five columns turned cargo's 600 project-scope types into a 120-line column about 27,000 units tall, which fitted at scale 0.04 and made zooming drift into empty space. The initial fit is clamped to a readable scale and `fit all` overrides the clamp
- THE CLASS VIEW DRAWS THE TYPES THAT ARE IN A HIERARCHY, and declares the ones that are not. MEASURED on cargo's src/compiler: of 1,087 type-like symbols only 217 appear in any type-to-type relationship, so 80% of the boxes were attached to nothing and 176 connectors were stretched between the rest. The diagram draws the connected types, and states how many in-scope types were left out for having no stored relationship at all; they remain in the JSON answer and in the scope. A scope whose types have no relationships between them still draws boxes, so a reader learns the scope matched
- CLASS CONNECTORS ARE ORDERED BY ANCESTRY, not by gravity, so a child sits near its parent. MEASURED with gravity ordering alone: the median connector was 720px and the 90th percentile 1,567px in a 1,296px viewport. Ancestry follows containment as well as inheritance, because 203 of the 304 connectors are containment between types; that moved the median to 553px. The relationships are ALSO listed as text in the panel, drawn from the same edges as the connectors, because a connector is only useful if you can follow it
- `view: class` selection SURVIVES its own budget cut, which it did not. MEASURED: the node set was widened with 952 type-like symbols so inheritance could resolve, and then `slice(0, maxNodes)` took the first maxNodes of the graph's nodes -- the scope's symbols in source order -- and discarded every widened one. The diagram drew ONE connector out of 246 while `considered.nodeSelection` declared 952 types had been added. A declaration describing work whose result was discarded is worse than no declaration; for the class view the node set is now ordered type-like first before the cut
- EVERY VIEW HAS A SAVE-AS CONTROL. Reported more than once, and the gap is real: the artifact arrives as a blob of text and a reader who wants to keep it has no way to. Each page re-serialises its own live document through a Blob and an object URL -- not a data: URI, which several browsers reject at the 300KB-7MB these documents routinely reach

## Performance

maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction. `view` changes the picture, not the budget: codemap and class read the same node and edge sets as graph, and the class view's type-first ordering is a sort on an index-backed column.

## Safety

Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.

## Relationship to other tools

For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
