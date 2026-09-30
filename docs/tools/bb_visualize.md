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

## Examples

`{"scope":"symbol","target":"handleRequest","format":"json"}`

`{"scope":"module","target":"src/api","format":"html"}`

## Errors

- Missing target for a scoped graph
- Unsupported scope or format
- Unavailable index

## Limitations

- The graph reflects static indexed relationships
- GRAPH SELECTION IS A PRIMARY-KEY SLICE, and says so. The relationship query is `ORDER BY id LIMIT maxLinks*3`, so on a project with 141,445 stored relationships only the first 6,000 by primary key are read at the default budget. `considered` declares the stored count, the read count, and the fact that the slice is arbitrary but stable rather than a ranking — measured: the maxLinks=200 answer is a strict PREFIX of the maxLinks=2000 answer, because a larger budget appends to a primary-key order instead of reconsidering a ranking, so the small picture is the first slice of an arbitrary one and not a summary of the large one. The node ordering is declared too: gravity for project and feature scope, source order for file, module and symbol
- LANGUAGE FILTERS ARE APPLIED BEFORE THE LIMIT, not after it. They used to be applied in memory to an already-truncated selection ordered by gravity, so a language whose symbols were not in that slice was cut before the filter ran: measured on cargo, `languages: ['javascript']` returned 0 nodes and declared the project had none, while the index held 56 javascript symbols — and the declared total counted the language in SQL while the returned nodes did not, so one reply contradicted itself. `relationshipTypes` deliberately filters edges rather than nodes, and says so: a caller narrowing edges must not change which nodes exist
- `feature` scope matches a symbol NAME or a docstring. The docstring half is thin in practice and the answer does not pretend otherwise: measured on cargo, 70 of 40,595 symbols (0.17%) carry one, so a feature query is usually a name match
- The graph reflects static indexed relationships
- NOISE FILTER (declared, and the caller's to change). Build output and VCS metadata are excluded by default, matched on whole path SEGMENTS. This was previously a bare-substring rule that removed real source: measured on cargo, `dist` removed `src/util/edit_distance.rs`, `out` removed `src/compiler/layout.rs` and `src/compiler/output_depinfo.rs`, and `build` removed `crates/cargo-test-support/build.rs`, leaving 225 of 1,787 symbol-bearing files with no exclusion declared anywhere. Test and spec sources are ordinary source and are INCLUDED by default; `excludePatterns` and `includeTests` change all of it, and whatever is removed is counted onto `excluded`
- SCOPE TARGETS ARE VALUES, not patterns. `%` and `_` match themselves and a directory prefix matches on a segment boundary, so `src/util` never reaches `src/utilities`. This matches bb_analyze, whose contract states the same rule; the two tools previously disagreed, and this one was the permissive one (measured: a target of `%` selected every file in the corpus)
- Nodes and links beyond configured budgets are omitted and reported
- Owner-cascade attribution: member-level relationships are attributed to the owner class, same as bb_graph

## Performance

maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction.

## Safety

Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.

## Evidence Semantics

Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.

## Relationship to other tools

For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
