# `bb_visualize`

Scoped dependency and architecture visualization over the canonical graph engine, with explicit filters, provenance, truncation, machine-readable JSON, and genuinely self-contained HTML (no network, no fonts, no build step — it renders offline, in an air-gapped editor, anywhere). The answer is an AUDITABLE projection of the index, not a picture: every link carries the stored relationship row it traces to (rowId) and its stored confidence, and every node carries its line, lineEnd and qualifiedName, so the graph is navigable and every edge can be checked against the row that justifies it. Distinct relationship types between the same pair are SEPARATE links, so a pair that is both contains and exports renders as both. Node size follows the index’s own gravity score. In the HTML, edge opacity encodes stored confidence, relationship type sets colour and a structural/behavioural dash, a CROSS-LANGUAGE edge gets its own wide dash and is drawn beneath the local edges so a polyglot project shows where one language hands off to another, and a stale endpoint (file changed since index) is drawn as a hollow ring; links inherit worst-of-endpoints. Nodes are grouped into the NAMED REGION they live in — a directory of the project, a directory with fewer than three matching symbols folded into its parent — each region placed at its own anchor inside a rounded pod and switchable from the sidebar like any other class, At overview zoom an edge BETWEEN two regions is drawn as one REGION LINK per region pair — dotted, because it is a summary and not a stored row; its width and alpha come from how many stored edges it stands for — while an edge INSIDE one region is always drawn as itself, and the individual cross-region edges return past ~1.15x zoom or when a link is opened (double-click frames both of its regions). Edges drawn individually are capped at a zoom-dependent count with the readout naming the cap, because an uncapped aggregate is a smear rather than a map; the frame's readout reconciles the picture with the census (how many cross-region edges the links stand for, how many pairs exist, how to open them), the sidebar's live line repeats it, and the links — with their regions, counts, stored rows, commonest relationship and screen geometry — are PUBLISHED on the view's API rather than only painted, because a summary that can only be seen cannot be checked. Moving the pointer across the map never changes the view: hover emphasises the node's own edges, and a CLICK is what focuses, so the map cannot dissolve under the reader's hand. The graph has TWO arrangements and the reader picks: `layout: "regions"` (the default) is the region map described above, and `layout: "force"` drops the directories entirely — one force layout, no region pods and no region links, every stored edge drawn as itself under the same zoom-dependent cap — which is the graph as it looked before the regions existed, and which is the honest shape for a project whose parts do not fall along directory lines. The layout is written onto the document itself (data-bb-layout) and both arrangements are offered as a switch in the generated page's sidebar, so `layout` sets the arrangement the page OPENS with and the reader can move between them without regenerating anything; `codemap` and `class` ignore it, because their shape is not a force layout at all. The picked-item panel is deliberately not a modal: it docks to either side of the frame and collapses to its own heading — which always names what is picked — while KEEPING the selection, because hiding a panel to see the picture must not cost the reader the focus and the zoom they just asked for (its X is the control that clears). The layout runs in frame-sized slices with a progress readout, so the artifact stays interactive and visible at the maximum graph size and in a background tab. Every answer declares its bounds as three DISTINCT numbers — totalNodesAvailable (what the scope and filters actually match), truncation.originalNodes (what reached the projection) and nodes (what was returned) — so a short page can never be mistaken for a whole set. `offset` walks that same order rather than re-reading the first page: the ranking carries a final `s.id` tiebreaker so page k+1 begins exactly where page k ended, and `considered.page` declares which page the answer is, of how many, and where the next one starts (null on the last) — a scope larger than one page can be walked, and an offset past the end is stated as an empty PAGE rather than as an empty project. Whatever the noise filter removes is counted onto excluded with the patterns responsible — always present, including when it is empty, so silence and zero are never confused — and an empty answer is declaredAbsent with a reason rather than an empty result that looks like a real project. `considered` declares what the answer actually READ: how many relationships exist, how many the query read, and in what words the selection is an arbitrary primary-key slice rather than a ranking, plus which symbols got a chance to be in the graph and in what order. `considered.overlays` carries the index's OTHER facts about the returned symbols — agent annotations from `bb_annotate`, matched by NAME AND PATH (never by name alone: two symbols can share a name, and a note is about one of them), with the notes themselves, the author class, and a count of notes that name a symbol of this scope at another path and are therefore NOT attached. The layer is declared even when it is empty, so "no agent has annotated these symbols" and "nobody looked" are different replies. Language filters are applied BEFORE the limit, so a rare language receives the same budget as a common one. The DEFAULT text format carries the same declared coverage, selection and exclusion as the JSON one, so the reply a caller gets without asking is the reply that can be audited. Member-level relationships are FOLDED onto the owner class, and every folded edge says so: when a class-like symbol is selected and a relationship is stored on one of its MEMBERS that is not itself in the node set, the row is attributed to the owner and the edge carries ownerCascade with matchedMembers naming the member it came through — so an attributed edge is never presented as one the index stored between the two drawn nodes. The fold is deliberately narrow (one level, class-like owners only, never for contains, an exact edge always preferred to an attributed one) and `considered.ownerCascade` declares whether it ran, how many members it scanned, how many rows it folded and whether a cap truncated it, so "nothing to fold" and "the fold never ran" are distinguishable. This is NOT bb_graph's depth-N traversal: the edge set is the relationships between the selected nodes, plus the folded member rows.

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
        "graph",
        "codemap",
        "class"
      ],
      "default": "graph",
      "description": "which picture of the project to draw. `graph` (default) is the force-directed dependency map: nodes are symbols, lines are relationships, sized by stored evidence. `codemap` is a SYMBOL MAP, and its published value is `codemap` only because that enum value predates the name: it is a squarified treemap where one rectangle is one SYMBOL, sized by the LINES IT SPANS, nested inside its file and its top-level directory — so the shape of a codebase, the density of its definitions, and what each file is made of are visible at once. IMPORTANT AND EXACT, because the old wording promised something else: this is NOT a token-level code map. It is not Sourcegraph's Chromium map, which draws every TOKEN of every file; the index stores symbols with line spans and kinds, and no tokens, so symbols are what this view can draw honestly, and its own subtitle says so. `class` is a TYPE DIAGRAM in UML's box-and-line idiom, and deliberately not a UML model: boxes for classes, interfaces, structs and enums, with inheritance, implementation and containment edges, and nothing else — no attributes, no method compartments, no cardinalities, no visibility markers, because the index stores none of them and a diagram that invents them is a lie with a legend attached. It is only as complete as the index, and it DECLARES what it could not resolve rather than quietly drawing a partial diagram. The view is independent of `format`, so `view` composes with every output format."
    },
    "layout": {
      "type": "string",
      "enum": [
        "regions",
        "force"
      ],
      "default": "regions",
      "description": "the GRAPH view's arrangement, and the only option here that shapes the picture without changing the data. `regions` (default) groups every node into the DIRECTORY it lives in, anchors and names each region, and summarises the edges between regions as one dotted region link per pair at the overview. `force` ignores directories entirely: one force layout, no pods and no region links, every stored edge drawn as itself under a zoom-dependent cap the readout names. It has no effect on the `codemap` and `class` views, whose shape is not a force layout. The generated page carries BOTH as a switch in its sidebar, so this sets the arrangement the page OPENS with; the layout is declared on the document itself (data-bb-layout), so the file draws what it says it is."
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
- `view` — an axis INDEPENDENT of `format`, so every view composes with every delivery form. `graph` is the force-directed dependency map; `codemap` is a SYMBOL map (one rectangle per symbol, area = the lines it spans) and NOT a token-level one; `class` is a TYPE DIAGRAM in UML's box-and-line idiom — types and inheritance edges only, not a UML model. The chosen view rides the result as `view`, so a caller can tell which picture an answer describes

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
- THE CODE MAP ZOOMS AND PANS, because at 1,400 symbols across a ~1,000px viewport every symbol band was a fraction of a pixel and a reader could extract no name from the picture. The treemap is laid out into a WORLD sized from the viewport divided by 0.82 and placed with a CSS transform, so a wheel event is one composited write rather than 2,111 layout updates; the wheel zooms about the cursor, drag pans, double-click frames one file, and `fit` returns to the whole map. MEASURED, a fixed 2400x1600 world against a ~974px viewport fitted at 41%, which made the file names it had just added unreadable -- hence the viewport-derived size. File names are drawn in world units so they grow with the zoom, and are collision-tested so two never print over one another. The re-layout the zoom needs FOLLOWS the gesture ONCE IT SETTLES and only when the level of detail actually changes -- the zoom is bucketed in powers of two against the fit scale, so a whole zoom range costs a handful of re-layouts rather than one per frame, and the reader’s view is re-applied rather than re-fitted, so nothing jumps under the cursor. The pill that reports where the reader is had its comparison the WRONG WAY ROUND, and the defect was invisible because the broken state and the hidden state coincided: the test was `view.k >= fitScale()`, which is true at the fit AND at every scale above it, while the class that displays the pill is set exactly when the whole map is not on screen -- so a reader at 338%, with three quarters of the map off the frame, was told "whole map · scroll to zoom in" by a pill that was never displayed at any zoom. MEASURED in a real browser on the emitted `src/` document: three wheel notches took the published zoom from 0.8 to 3.377 and the pill’s own text did not move. It is now a comparison against the same `fitScale()` that performed the fit, read in the other direction, and `script/m13/verify-visualize-codemap.ts` delivers a wheel to the artifact’s OWN listener and asserts both states -- `whole map` with the pill hidden at the fit, `338% · drag to pan, scroll to zoom` with it shown afterwards -- with a negative that fails on the old predicate
- THE CODE MAP DRAWS AT A LEVEL OF DETAIL, which it did not. Reported of the map over `src/`: "the only thing I see is cyan throughout, nothing is readable". MEASURED on the emitted document in a real browser (142 files, 1,770 symbols, 3,232 painted stripes): 1,633 stripes were UNDER ONE DEVICE PIXEL tall (median 0.94px), 52.9% of the frame’s pixels were the single colour the function family uses, 59 of 142 file names were drawn and 21 of those 59 were cut off with an ellipsis, and 8 of 92 files drew more content than their cell could hold. A stripe below a pixel is not a small symbol, it is a SMEAR, so a file whose every stripe would fall under `MIN_STRIPE_PX` (2 device pixels, converted to world pixels at the zoom being drawn) is drawn as ONE COMPOSITION STRIP as tall as its cell, whose slices are the lines each kind spans AND the code between them in source order -- a file of 400 one-line getters reads as a barcode of its own composition instead of 400 invisible smears. The fold is judged on a symbol’s HONEST share of its cell, never on the floored height it is drawn at, because the floor is a drawing device rather than a measure. Nothing is dropped or hidden: the area contract survives (a slice is as tall as the lines its kind covers), a filtered symbol is a MUTED SLICE of the strip, every symbol stays counted, searchable, in the data port and clickable -- a click on a strip resolves to the symbol whose slice it landed in -- and what was folded is NAMED in the readout (`stripe detail`: `1,357 of 1,769 folded · 71 file(s) as one composition strip (zoom in)`) and in the encoding key, which describes a mark only when the picture contains it. MEASURED after the pass, on the same document: the one-colour share fell from 62.2% to 41.0%, sub-pixel stripes from 683 to 327, and a three-notch wheel from the fit scale took folded symbols from 1,357 to 1,172 as the map re-laid itself out
- A NAME IS PRINTED WHOLE OR NOT AT ALL, and the largest things get the names. MEASURED before this pass: 59 of `src/`’s 142 files were named, 21 of those names were truncated mid-word (`real-typescript-anal...`, which names a file nobody can look up), and the naming ran in placement order, so two 40px neighbours could take two names while the largest cell in the picture went unnamed. A name is now measured against its room (with a canvas where one exists, and a documented per-character fallback under a test stub), falls back to a SHORTER TRUE form -- a symbol’s qualified name, then its own name; a file’s name, then its name without its extension -- and is dropped rather than clipped. THE BUDGET WAS SET TOO LOW FOR THE VERY REASON IT WAS SET: 32 names at fit, chosen to stop 21 of 59 names being cut off with an ellipsis — clipping that a whole-or-nothing rule now makes impossible. All 32 bought was an emptier picture. MEASURED at fit over `src/`, same document and browser: 39 names drawn and 111 candidates that FIT their own cell and lost a queue, which is the one reason to withhold a name that costs a reader something for nothing. At 96 the same document draws 84 names, 0 clipped and 0 overlapping, and what the queue costs falls from 111 to 66. File cells and STRIPES both compete for the budget by area, each kind capped at half of it, so the 20 symbols holding 57.9% of the drawn area (one `analyze` method alone spans 3,500 of its file’s 6,183 lines) are finally the ones a reader can read; a stripe that begins under its cell’s own header moves its name DOWN rather than losing it, because a collision that hides a name is the same defect as a name never offered. The readout counts what could not be named (`names`: `19 files · 20 symbols · 137 with no room for a name`) instead of leaving the gap to be discovered, and the census names the CONCENTRATION when there is one (`largest 20 symbols` / `58% of the drawn area`), because a reader looking at a one-colour picture is owed the reason: in that scope 93.7% of the spanned lines ARE functions and methods, so the wash is the data and the drawing says so
- WHICH KINDS OWN THE PICTURE IS THE PALETTE’S BUSINESS, and the palette was spending one hue on the three commonest kinds. `function`, `method` and `constructor` were all `#5eead4`, and in a TypeScript scope those three are 78% of the symbols (821 methods, 551 functions, 1,769 symbols), so the fold pass could remove smears but never PROPORTIONS: MEASURED on the emitted `src/` document, in the same browser and at the same viewport as the numbers above, cyan covered 40.9% of the frame’s painted pixels and the method hue covered none of it. The two kinds that dominate a real codebase now have two hues (functions cyan, methods blue), imports moved off the method hue, and `test` off the amber that means stale everywhere else; the rare kinds still share a hue deliberately, because a kind with 11 members costs nothing when it is the colour of one with 19. MEASURED after the change, same document: cyan 9.3%, methods 24.2%, the code between symbols 41.2% — and the viewer’s own fill row was changed in the same commit, because a key that names last week’s colours is worse than no key at all
- THE CODE MAP’S CELLS ARE THE FILES’ OWN LINES, which they were not. The layout divided by the SUM of a file’s symbol spans while positioning bands by ABSOLUTE line numbers, so the two disagreed: MEASURED over `src/`, `ast/real-cpp-analyzer.ts` drew 7,760 units of height into a 3,513 budget (2.2x), `ast/parallel-indexer.ts` 11,268 into 4,242, 8 of 92 files overflowed their cell -- the bottom of each clipped away by the cell’s own overflow -- and every gap band was painted at the wrong offset, under the band that followed it. Both promises the encoding key makes were therefore false: "area = the lines a symbol spans", and "gap = the code between symbols, drawn at its true size". A file is now measured by the line its last symbol ends on, each symbol is drawn at the line it starts on and as tall as the lines it covers, and what is left between and after them IS the gap. MEASURED after the fix on the same document: the gap tone went from 5.0% of the frame’s pixels to 39.8% -- the code between symbols is visible for the first time -- while every file cell gained a hairline edge, so two same-kind neighbours read as two cells rather than as one field
- `view: codemap` is SYMBOL-LEVEL, not token-level, and the viewer says so where a reader is looking: its subtitle names it, and its encoding key states that a band's AREA is the lines a symbol spans. The index stores symbols with line spans and kinds; it stores no tokens, so a character-level code map would be promising a resolution the data does not have. Directories are named RELATIVE to the scope target, because grouping by the path's top segment gave a scoped call exactly one group — a treemap of a single rectangle. Its language, its grouping and its one filter set all read the projection's own `group` field, which is the field the graph's language filter and the language census read, so no two panels can name a symbol differently
- `view: class` is only as complete as the index, and it SPLITS what it could not draw rather than reporting one number. Relationships to a type this scope did not select (`outside`) and relationships to a selected field, method or enum member (`members`) are different failures: conflating them made the diagram claim a missing class hierarchy where none was missing — MEASURED on cargo's src/compiler, the old single figure read 969 while the index holds 2 `implements` relationships there and 967 of the rest were `contains` links pointing at fields. Members are now DRAWN in each box from those same containment links
- `view: class` ORDERS TYPES BEFORE METHODS, because gravity on a real project belongs to the functions that do the work and the types inheritance connects would otherwise be cut by the query's own LIMIT. MEASURED: with the plain ordering a module scope put 135 types past the limit behind 1,200 methods and drew 1 arrow out of 970; type-like symbols are now ordered first, and where a narrow scope selects types from elsewhere in the project to make an inheritance edge drawable, the count is declared in `considered.nodeSelection`
- A class diagram of many types cannot be legible as an overview. Rows wrap into a grid SHAPED BY THE VIEWPORT rather than running off both edges -- MEASURED, a fixed five columns turned cargo's 600 project-scope types into a 120-line column about 27,000 units tall, which fitted at scale 0.04 and made zooming drift into empty space. The initial fit is clamped to a readable scale and `fit all` overrides the clamp
- THE CLASS VIEW DRAWS THE TYPES THAT ARE IN A HIERARCHY, and declares the ones that are not. MEASURED on cargo's src/compiler: of 1,087 type-like symbols only 217 appear in any type-to-type relationship, so 80% of the boxes were attached to nothing and 176 connectors were stretched between the rest. The diagram draws the connected types, and states how many in-scope types were left out for having no stored relationship at all; they remain in the JSON answer and in the scope. A scope whose types have no relationships between them still draws boxes, so a reader learns the scope matched
- CLASS CONNECTORS ARE ORDERED BY ANCESTRY, not by gravity, so a child sits near its parent. MEASURED with gravity ordering alone: the median connector was 720px and the 90th percentile 1,567px in a 1,296px viewport. Ancestry follows containment as well as inheritance, because 203 of the 304 connectors are containment between types; that moved the median to 553px. The relationships are ALSO listed as text in the panel, drawn from the same edges as the connectors, because a connector is only useful if you can follow it
- `view: class` selection SURVIVES its own budget cut, which it did not. MEASURED: the node set was widened with 952 type-like symbols so inheritance could resolve, and then `slice(0, maxNodes)` took the first maxNodes of the graph's nodes -- the scope's symbols in source order -- and discarded every widened one. The diagram drew ONE connector out of 246 while `considered.nodeSelection` declared 952 types had been added. A declaration describing work whose result was discarded is worse than no declaration; for the class view the node set is now ordered type-like first before the cut
- EVERY VIEW SAVES ITSELF. Reported more than once, and the gap is real: the artifact arrives as a blob of text and a reader who wants to keep it has no way to. Each document re-serialises its own live page through a Blob and an object URL -- not a data: URI, which several browsers reject at the 300KB-7MB these documents routinely reach -- and publishes that as `saveHtml`, because the control for it belongs in the viewer's Download section rather than floating over the drawing

## Performance

maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction. `view` changes the picture, not the budget: codemap and class read the same node and edge sets as graph, and the class view's type-first ordering is a sort on an index-backed column.

## Safety

Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.

## Relationship to other tools

For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness. This tool does NOT auto-refresh: the flags and the envelope DESCRIBE the index as it stands, nothing is reindexed to make them stale or fresh, and there is no `refresh` option to opt out with. Project scope → run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only). File scope → run: `bb index "<file>"` for the one file named in the answer. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
