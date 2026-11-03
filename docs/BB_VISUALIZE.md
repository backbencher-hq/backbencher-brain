<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the hand-written guide to `bb_visualize`: the five scopes,
every option and refusal, the two graph arrangements, what each output format
declares, and the measured cost of the answer.
WHO IT IS FOR — a caller who wants an auditable architecture map of a project or
module, and the operator who has to check the numbers in it.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_visualize/{descriptor,handler}.ts,
src/intelligence/visualization/visualization-engine.ts, script/tool-docs/curation/bb_visualize.ts,
and the gates in validation/tools/bb_visualize/.
-->

# `bb_visualize` — bounded, auditable dependency maps

`bb_visualize` projects one SCOPE of the indexed project into a single graph and
renders it as text, JSON or a self-contained HTML map. It is not `bb_graph`'s
depth-bounded traversal of one symbol: the answer here is the set of relationships
between the symbols the scope selected, projected once, with every value the caller
needs to tell a page from a total.

## Scopes

| Scope | Target | What is selected |
|---|---|---|
| `project` | omitted | the highest-gravity symbols — the busiest core, not a random sample |
| `file` | a file path | every symbol the index holds for that file (or under that path) |
| `module` | a directory | every symbol under that directory, matched on a whole path segment |
| `symbol` | a symbol name | the symbols with that exact name or qualified name |
| `feature` | a name or a docstring phrase | symbols whose name or docstring matches (name matches dominate in practice) |

`target` is a VALUE, never a pattern: `%`, `_` and `\` match themselves, and
`src/mod` never reaches `src/modular`. Any scope other than `project` without a
non-empty `target` is refused by name.

## Options

| Option | Default | Accepted values | Behaviour |
|---|---|---|---|
| `format` | `text` | `text`, `json`, `html` | output shape; HTML is one self-contained file |
| `layout` | `regions` | `regions`, `force` | the arrangement the HTML OPENS with; the page also switches at runtime |
| `maxNodes` | 200 | whole numbers 1..2000 | refused outside the range, never clamped |
| `maxLinks` | 5000 | whole numbers 1..20000 | refused outside the range; only ever withdraws drawn edges |
| `offset` | 0 | whole numbers >= 0 | page cursor over the same total order; `nextOffset` walks it |
| `relationshipTypes` | every kind | the index's stored spellings | filters EDGES only; unknown value is an error naming the stored set |
| `symbolKinds` | every kind | the index's stored spellings | filters the node selection (and the owner-cascade additions) |
| `languages` | every language | the index's stored spellings | filters the selection BEFORE the limit; unknown value is an error |
| `excludePatterns` | build/VCS segments | path segments | replaces the default noise list; removals are attributed |
| `includeTests` | `true` | boolean | test/spec sources are ordinary source; when false the test rule is named in `excluded.byRule` |
| `view` | `graph` | `graph` | any other value is refused rather than answered as the graph |

Every filter value is matched case-insensitively against the vocabulary the index
actually stores; a value it does not contain is a named error, never an empty
graph that looks like a real project.

## What each format declares

Text, JSON and the HTML payload carry the same three DISTINCT numbers:
`totalNodesAvailable` (what the scope and filters matched), `truncation.originalNodes`
(what reached the projection) and the returned node count. JSON adds the full
`considered`, `provenance`, `truncation` and `freshness` blocks; the HTML artifact
carries them in its machine-readable `declared` payload; text prints them as lines.
An empty answer is `declaredAbsent` with an `absenceNote`, and an `offset` past the
end is an empty PAGE, not an empty project.

The HTML map is genuinely self-contained: no network request, no webfont, no build
step. It carries its own force-directed layout and canvas renderer, publishes its
state on `window.__bbView` (census, region links, layout, panel, `declared`), and
writes its own file through `saveHtml`.

## Freshness

The answer reports `fresh`/`stale`/`missing` counts for the files its nodes live in,
flags each node whose file changed since the index (`stale`) and marks a link stale
when EITHER endpoint is stale. The read path never refreshes the index — it does not
even open it read-write — so the envelope's remediation is the manual one.

## Cost, measured

On the reference index (6,452 files / 310,423 symbols / 820,040 relationships):

| Call | p50 | p95 |
|---|---|---|
| default text (`project`, 200 nodes) | 372 ms | 496 ms |
| JSON, same budget | 380 ms | 392 ms |
| HTML, same budget (about 0.84 MB) | 357 ms | 373 ms |
| largest accepted budget (`maxNodes: 2000`, JSON, 15.9 MB) | 4.4 s | 5.7 s |
| first call in a fresh process | — | 723 ms |

The largest accepted budget is the declared slow case. It is bounded by the output
budget and returns well inside the 30 s client timeout; the default call is far
inside its 5 s budget.

## Refusals (all `isError: true` through the MCP door)

- unknown scope / view / format / layout / option — the accepted set is named;
- a scoped call without a non-empty target;
- `maxNodes` outside 1..2000, `maxLinks` outside 1..20000, a fractional or negative
  `offset`;
- a language, relationship type or symbol kind the index does not store;
- an absent or uninitialised index.

## Examples (run from the repository root)

```bash
# JSON for one module of the current repository's index
npx tsx src/cli/index.ts tool bb_visualize --dir . --args '{"scope":"module","target":"src/intelligence","format":"json"}'

# A self-contained HTML map of a symbol's neighbourhood
npx tsx src/cli/index.ts tool bb_visualize --dir . --args '{"scope":"symbol","target":"graphTraversal","format":"html","layout":"force"}'

# Page 2 of a project map, 50 nodes per page
npx tsx src/cli/index.ts tool bb_visualize --dir . --args '{"format":"json","maxNodes":50,"offset":50}'
```

The HTML is written to stdout; redirect it to a file and open it in any browser
(`... --args '{...}' > map.html`).

## Evidence and gates

Measured evidence lives in `validation/tools/bb_visualize/`: `probe.ts` drives the
real MCP stdio door, `read-path.ts` proves the read path leaves the database and its
WAL byte-identical, `latency.ts` records the three campaign tiers, and
`real-corpus.ts` drives real repositories. The per-tool gates are
`script/m13/verify-visualize-*.ts` and `script/m15/verify-visualize-migrate-deep.ts`;
the HTML artifact is additionally driven in a real chromium by
`script/m13/verify-visualize-browser.ts`.
