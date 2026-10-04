# Markdown analyzer

## Language

- Analyzer: `src/ast/real-markdown-analyzer.ts`
- Parser: vendored `wasm/tree-sitter-markdown.wasm` (block grammar) +
  `wasm/tree-sitter-markdown_inline.wasm` (companion inline grammar),
  loaded as `tree-sitter-markdown`
    <!-- provenance: find-grammar-provenance -->
    Provenance of the shipped bytes: byte-identical to the published
    `@tree-sitter-grammars/tree-sitter-markdown@0.5.1` wasm (sha256 `3e13182f21373634…`).

    Note the SOURCE CLASS: this was found among GitHub RELEASE ASSETS, not in an npm
    tarball — the package's repository publishes a prebuilt wasm per release, and walking
    npm alone reports "no match" for a lane whose bytes are published. Repos are resolved
    through each npm package's own `repository` field, never guessed from the grammar name.

    Established by `script/m60/find-grammar-provenance.ts` (exact sha256 match, no inference
    from size or date); evidence in `validation/m60/results/G-PROVENANCE.json`.
- Detection: `.md`, `.markdown` → `markdown` in `src/ast/language-detection.ts`
- Wiring: `ASTEngine` → `RealMarkdownAnalyzer`

## Two-grammar design

tree-sitter-markdown is split into a block grammar and an inline grammar.
The block grammar models headings, lists, tables, code fences, block quotes,
and front matter as nodes, but leaves **inline content** (`paragraph →
inline`, heading `inline`) as an opaque text node — links/images/autolinks
are NOT nodes in the block grammar. The engine therefore pre-parses every
inline block with the companion inline grammar and hands the parsed trees to
the analyzer via `context.mdInlineTrees`/`mdInlineStarts`/`mdInlineLines` (byte
offsets and the block's 1-based file line), mirroring the vue/svelte SFC
pre-parse. The analyzer matches each `inline` node back to its tree by byte
offset, so every link fact is AST-derived — the old analyzer's regex
heading-stripping and its complete absence of link extraction are both gone.

**A lane with two grammars must be audited with both.** `uri_autolink` and
`email_autolink` were registered for 35 days as DEAD BRANCHES — "unknown node
type, can never match" — when both are live NAMED types of the inline grammar
(ids 37 and 38, measured against the shipped bytes). The F1 oracle loaded one
grammar where the analyzer used two. Fixed by adding
`markdown: ["tree-sitter-markdown_inline.wasm"]` to `EXTRA_GRAMMARS` in
`script/m14/audit-analyzer-grammar.ts`, alongside the vue/svelte/typescript/html
entries that already did this for their own companion grammars. The oracle now
sees 282 node types instead of 196 and the dead-literal record went 2 → 0, with
the repayment written into `validation/m14/grammar-audit-baseline.json`.

The lesson is recorded because it is the more expensive direction of error: a
gate that reports a **live** branch as dead is worse than a gate that reports
nothing, because the natural response to its output is to delete the branch —
which would have silently removed every autolink edge the lane emits, turning a
measurable gap into an unmeasurable one.

## Symbol contract

| Construct | Symbol kind | AST source | Identity |
| --- | --- | --- | --- |
| ATX heading (`#`..`######`) | `type` | `atx_heading` + `atx_hN_marker` | heading text |
| Setext heading (`===`/`---` underline) | `type` | `setext_heading` + `setext_hN_underline` | heading text |
| Pipe table | `class` | `pipe_table` | header cells joined by `/` |
| Fenced code block | `function` | `fenced_code_block` + `info_string` → `language` | `code_block.<lang>` |
| Front matter (`---` block) | `namespace` | `minus_metadata` | `front_matter` |

Heading ownership follows the document hierarchy: an h2 is owned by the
enclosing h1, an h3 by the enclosing h2, and so on (the M11 contract `ATX
headings as type; heading hierarchy via parent chain`). Table columns are
emitted as `contains` children of the table symbol.

### A heading's name is its display text

Three separate ways of getting that wrong were live at once, and all three are
grammar facts rather than style opinions:

- **The ATX closing run is not part of the text.** `## Title ##` published
  `Title ##`, so a document that closed its headings and one that did not
  produced two different symbols for the same section. The inline grammar
  delivers the closing run inside the `inline` child as anonymous `#` tokens,
  so it is removed by character code — the lane's zero-regex property is kept.
  A `#` with no space before it (`## ends in a-hash#`) is kept, per CommonMark.
- **A name never contains a newline.** A multi-line setext heading's text is
  its PARAGRAPH, so the previous "node text minus the last line" fallback
  returned every line but the underline; a two-line setext heading published
  `"Multi Line Title\nsecond line of paragraph"`.
- **An empty heading is absence, not a name.** `#` with no content is
  `atx_heading > atx_h1_marker` with NO inline child, so a guard written as
  "the inline text is empty, stop" never runs for the one case it was written
  for, and the setext fallback rescues the marker. A document of empty headings
  published a `contains` chain of symbols named `#`, `##`, `###` — the M60 R7
  class, a name that is not a name — and two sibling `##` headings named `##`
  collided, so every heading after them was attributed to the empty `#`.

### A heading, table and code fence are SITES, not declarations

`code_block.<lang>` was keyed by `owner + name`, so the second block of one
language under one heading collapsed into the first and took its `contains`
edge with it. Measured on this lane's own pinned corpus: **1,920 of the
grammar's 4,078 `fenced_code_block` nodes were erased — 47% — in 406 of 738
files.** Worst case `docs/_spec/05-classes-and-objects.md`, 79 sites published
as 24 symbols.

Sites are now published per occurrence, on the same rule yaml uses for
duplicate mapping keys (`uniquePath`): the FIRST occurrence keeps its exact
previous spelling and only the Nth repeat is disambiguated, with `id` and
`qualifiedName` carrying the ordinaled path and `isRepeatedSite` flagging the
repeat.

**The published NAME is the disambiguated spelling too, and that was the half
that was wrong.** A repeat's `contains` edge already said `code_block.scala#2`
while the symbol published `code_block.scala`, so 28.7% of this lane's
relationships named a symbol the file did not declare (529 of 1,843, over 120
scala3 markdown files). The store keys a relationship by (source, type,
target, line) and its storeable test is `storeableName(name, line)` — a
denylist, not an existence check — so an unsatisfiable name is not rejected;
it becomes a row whose target id no symbol row has. The differential could
not see it, because the independent oracle derives the same suffixed spelling
and the two therefore agreed on a name neither published.

Two things are deliberately NOT changed, and both were measured first:

- **Numbering stays per OWNER, not per file.** 44% of this lane's symbols share
  a name with another symbol in the same file, and 57% of relationships have a
  target name matching more than one symbol. That is by design: the line is what
  separates two sites, so a per-file renumber would put a `#n` on 44% of symbols
  forever to fix a collision the key already handles. A name that matches
  several symbols is a working row; a name that matches none is a broken one.
- **A table's own name still joins its headers with `/`** (`Name/Meaning`), so a
  single-column table is named after that one column and its column publishes
  the same string. That is a real containment between two distinct sites, and
  the self-edge filter asks about identity — the column's id is qualified by the
  table's — rather than about strings.

A table's header cells publish as `property` sites under the table, addressed by
the table's own disambiguated id, at the header cell's own range. Before this
the loop above them said *"a column is a site too"*, the `table_column` edge was
emitted for every column of every table, and no column symbol was ever declared.

## Relationship ontology

- `contains`: heading → nested heading, table, code fence; table → column.
- `uses`: owning heading/document → every link destination, image source,
  URI autolink, email autolink, and **resolved** reference link (from the inline
  grammar).

Every edge carries a 1-based `line_number` and an `evidenceClass` from the
closed five-tier vocabulary:

- `contains` → `structural`. It is a parent/child relation read off the block
  tree. This mattered more than it sounds: with no stored class, the read-time
  derivation in `graph-core.ts` decides instead, and its `STRUCTURAL_TYPES` set
  does **not** contain `contains` — so the entire heading hierarchy was rendered
  to readers as `inferred`, "a guess, treat as a hint, never as fact".
- `uses` → `reference_qualified`. The destination is a node's own text and, for
  a reference link, the destination the document's own
  `link_reference_definition` declares.

The line for an inline edge is `mdInlineLines[i] + row`, because the engine
sub-parses each `inline` node as a SUBSTRING and a node row inside that tree is
relative to the substring. `context.mdInlineLines` was computed by the engine
and read by nobody before this round.

## Supported constructs

- ATX headings h1–h6 and setext headings (both underline forms), with full
  hierarchy ownership, closing-run removal, and absence for empty headings.
- YAML front matter (`---` at document start), pipe tables with column
  extraction, fenced code blocks with language detection — **each published per
  site**, so two blocks of one language under one heading are two symbols.
- Links in inline and reference form (`[text][ref]`, `[ref][]`, `[ref]`),
  images in both forms, URI autolinks (`<https://...>`), email autolinks
  (`<user@host>`), anchors, relative paths — all from the inline grammar, and
  reference links are resolved against the document's own definitions.
- A link inside a `code_span` or a closed fence is **not** published, and that
  exclusion is structural rather than filtered: the inline grammar gives
  `code_span` only ANONYMOUS children, and the walk descends named children
  only, so a `link_destination` is unreachable beneath one. A link inside
  `strong_emphasis`/`emphasis` **is** published, because those are named nodes
  with named children.

### An undefined reference link is not a link

A reference link with no matching `link_reference_definition` publishes
nothing, and that is the specification rather than a noise heuristic: CommonMark
renders an undefined reference as literal text. Publishing the undefined case
was measured first and rejected on the numbers — it produced **171 edges across
34 of the 738 corpus files**, and sampling them showed them dominated by bare
bracketed citation markers (`NOTICE.md: document -> 1`, six times over). Those
are fabricated endpoints and R10 target-spelling violations.

**Declared limitation:** an undefined reference is therefore *invisible* rather
than flagged, so a reader cannot distinguish "this document has a broken
reference" from "this document never had one". The alternatives were to publish
171 fabrications or to invent a suppression heuristic, and a heuristic with no
evidence behind it is the thing this repository forbids most loudly.

## Unsupported / explicit boundaries

- HTML blocks and `<details>` inside numbered-list items: valid CommonMark
  that the vendored block grammar recovers from with ERROR nodes (named in
  `markdown-corpus-errors.json`).
- `||` inside a pipe-table cell (the literal `|` inside a code span breaks
  the row) and a heading at EOF without trailing newline: two more valid
  edge constructs the block grammar does not model, recorded explicitly.
- Task-list markers and list markers are not symbols (noise).
- **Footnotes** (`[^1]` / `[^1]: body`) and **wiki links** (`[[Page]]`,
  `[[Page|label]]`) publish nothing. Neither node type exists in either pinned
  grammar — measured, not assumed: `footnote_reference` is absent from
  `tree-sitter-markdown_inline`'s 34 named types, and a wiki link is not a
  CommonMark construct at all. Declared here rather than left silent; 54 such
  sites exist on the pinned corpus.
- **Front-matter keys are not relationships.** `title:`, `permalink:`,
  `redirect_from:` and `weight:` produce the one `front_matter` namespace symbol
  and no edges, although in a Jekyll site those keys are the cross-file link
  carriers.

### Indented code blocks (MD-G1, closed)

A four-space indented block is a node the grammar names, and the lane used to
publish nothing for it while the fenced form beside it published a symbol — so a
reader could not tell "this document has no code" from "this document has code the
lane dropped". It now publishes `code_block`, **sharing the fenced path's site
base**, so a fence with no info string and an indented block under one heading are
one site and the second is `code_block#2`.

It publishes **no `language` key**: the construct has nowhere to declare one, and the
fence's `text` default means "a fence that declared none", which is a different fact.
`nodeType: indented_code_block` carries the distinction.

The population is worth stating, because it is not what the gap assumed. The gap
recorded "2 sites in 2 of 738 corpus files" from a text heuristic for indented lines;
measured with the **block grammar** over 1,138 pinned corpus files the figure is
**217**. Most of those 217 are not authored code at all — they are the wrapped
continuation lines of deeply-nested list items, which CommonMark genuinely reads as
indented code. The grammar is right and the author did not mean a code block. They
are published anyway, because the alternative is the asymmetry above and a consumer
that cares can read `nodeType` and the range.

### The worker seam, and why no fixture could have caught it (MD-5)

`pool-worker.ts` carries symbol metadata across the worker boundary through an
**explicit key allowlist**, and until this round that list named only CSS keys. Every
markdown key was dropped: the store held **9 of 9 symbols with `annotations = NULL`**
while every fixture passed against the analyzer's return value.

That combination is the finding. A fixture calls `engine.parseFile`, which never
crosses the worker boundary, so the F3 lane is *structurally* incapable of seeing
this — the review recorded MD-5 as "unpinnable", and the reason was not that no gate
existed but that the one gate that can see the worker
(`script/m14/verify-pipeline-e2e.ts`, real CLI → `brain.db`) was not covering this
language. It now is, and it asserts each key by name.

`headingLevel` is the key that matters most: with it absent the index cannot
reconstruct a document outline, so a heading row and a code-block row are
indistinguishable. `isRepeatedSite` is the one that lets two sites of one construct be
told apart. The full set now stored: `nodeType`, `headingLevel`, `language`,
`isMarkdownHeading`, `isMarkdownTable`, `isMarkdownTableColumn`, `isMarkdownCodeBlock`,
`isMarkdownFrontMatter`, `isRepeatedSite`.

## Regex inventory

Zero regex literals and zero `RegExp` calls. Autolink angle brackets are
stripped by position (`charCodeAt(0) === 60 && last === 62`), ATX closing runs
by character code, and heading levels come from the
`atx_hN_marker`/`setext_hN_underline` node types. The machine-checked census is
`validation/m12/results/regex-census.json` (markdown: 4 → 0), and markdown
contributes no row to it because it has no usage to classify.

## Complexity envelope

One production `parseFile` pass per file. Single iterative DFS over the block
tree; one additional DFS that collects `link_reference_definition` nodes and
**skips `inline` subtrees**, so it never touches the inline grammar's node count;
an O(1) byte-offset map from the engine's inline pre-parse; `Map`-backed site
identity; `Set`-backed relationship identity. O(block nodes + inline facts), the
inline half walked exactly once, no per-symbol O(n) scan.

Corpus `scala3@18df09c` (738 tracked `.md` files, 734 clean).

### Measured A/B, same file set, same load context

The change that recovered 1,920 code blocks and 213 reference links was
measured against its own predecessor in one session, on an identical 200-file
stride sample of 1,005,022 input bytes:

| | before | after |
| --- | --- | --- |
| wall | 19,050 ms | **17,475 ms** (−8.3%) |
| symbols | 1,903 | **2,505** (+31.6%) |
| relationships | 2,846 | **3,607** (+26.7%) |
| µs per symbol | 10,010 | **6,976** (−30.3%) |
| loadavg1 | 41.08 | 39.16 |

It is faster per unit of work while publishing 32% more. The
`markdown-corpus-complexity.json` row must NOT be compared with the
`validation/m12/corpus-manifest.json` figure of 55.13 files/s measured
2026-08-20: this box is running at `loadavg1 ≈ 40` against the F5 baseline's
recorded `loadAvgStart 4.85`, and the M60 complexity gate already refuses to
score a row with no `loadRule` and no `corpusManifest` for exactly this reason
(#871, #909). A throughput number without a load context is not a measurement.

## M60 ontology census — all ten relationship types

Added 2026-10-03. Every number below comes from the production entry point
`parseFile` (`src/ast/pool-worker.ts`) or from the pinned parse trees, and every one is
re-derivable by a script named beside it. Corpus root
`$HOME/fixtures/repositories`: **12,729 admitted `.md`/`.markdown` files across
138 repositories**, admitted by the same `git ls-files` walk the supervisor's gate uses and
filtered by `detectLanguageFromPath`. Sampling is a hash order, not a statistical random
sample, and is not claimed to be one: files are ordered by
`sha256("<seed>|<repo>/<rel>")` and the first N taken, so a published figure can be
reproduced from a clean corpus and re-drawn with `--seed`.

### The supervisor's arbiter does not report for this lane

`npx tsx script/m14/ontology-coverage-gate.ts markdown` prints

```
ontology coverage gate — markdown
corpus: 12729 admitted files
```

and then stops, twice over, for two independent reasons. Both are §8 items and neither is
this lane's to fix:

1. **`src/ast/engine.ts:1412` kills the process.** The per-file self-destruct timer is
   `setTimeout(..., 120000)` followed by `process.exit(1)`, and one corpus file trips it:
   `[BB-HANG] parser stuck 120s on
   $HOME/fixtures/repositories/dart-sdk/pkg/analysis_server/doc/implementation/lsp.md
   — exiting`. The verdict table is never reached. The same run also reports four
   `[BB-PARSE-ERR] … memory access out of bounds` on `dart-sdk`, `element-plus` and
   `flutter-packages` markdown files, which are grammar-level findings and are recorded
   here rather than treated as this lane's failures.
2. **There is no ruling table for markdown.** `RULED_BY_LANG` in that file carries `bash`
   and `json` and nothing else, so the gate's own guard fires:
   *"no RULING TABLE for markdown. Refusing to report: a gate with an empty table would
   call every un-emitted type RULED-UNJUSTIFIED and that is a verdict about the TABLE, not
   about the lane."* That refusal is the gate behaving correctly.

So the four probes below stand in for it, applying the same two instruments under the same
discipline. The first version of this section used the arbiter's own header as its warrant;
it does not, because the arbiter does not run.

### Verdicts

| Type | Verdict | Edges | Files | Instrument / probe |
| --- | --- | --- | --- | --- |
| `contains` | **EMITTED** | 7,603 | 322 | production `parseFile` |
| `uses` | **EMITTED** | 3,335 | 267 | production `parseFile` (389 edges moved to `references`) |
| `imports` | **RULED** | 0 | 0 | B: parse-tree count |
| `references` | **EMITTED** | 389 | 40 | production `parseFile` (relabelled from `uses` — see below) |
| `exports` | **RULED** | 0 | 0 | A + B: shape and population |
| `extends` | **RULED** | 0 | 0 | A: grammar inventory |
| `implements` | **RULED** | 0 | 0 | A: grammar inventory |
| `overrides` | **RULED** | 0 | 0 | B: parse-tree semantic count |
| `instantiates` | **RULED** | 0 | 0 | A + B |

**3 of 10 EMITTED, 7 RULED.** Every ruling names its instrument, its probe, its measured
count and the count that would overturn it.

One row of this table was RULED when this section was first written and is EMITTED now:
`references`. The change and its measurement were made concurrently in this worktree by
another agent holding the same lane, and the reasoning is recorded in full below rather than
adopted silently.

### A CORRECTION to this lane's own instrument A, found by a concurrent probe

`construct-probe.ts` instrument A walks the **BLOCK tree only**, and its header claimed it
enumerated "every node type BOTH pinned grammars actually produce". It did not: the 47
types it recorded are block types, and the companion inline grammar — `inline_link`,
`uri_autolink`, `email_autolink`, `code_span`, the three reference-link forms, `image` and
the rest — was never visited by that walk.

`validation/m14/fixtures/markdown/pass2-labelling-probe.ts` (written concurrently in this
worktree) records the union over a 1,200-file draw, `sha256=3aed69be…`: **82 distinct block
node types, 59 distinct inline, 104 in the union.** So the denominator every
instrument-A ruling below was argued against is 104, not 47.

**The direction of those rulings is unchanged and the reason is stated rather than assumed:**
the constructs they name — a type declaration, a supertype or implementation clause, an
object-creation node, an export node, a reference node — are absent from the union, and the
inline grammar models formatting and links, which is where they would have had to be. But
the claim "0 of 47" was made against a list that was not the list its own header named, and
that is a measurement error worth recording rather than a wording slip. The seven remaining
rulings should be read against **104**.

### The four probes

- **`ontology-census.ts`** — relationship type → count/files/per-repo, symbol kinds against
  the shared `SymbolKind`, empty symbol names, endpoints equal to the literal `unknown`,
  endpoint resolution at two tiers, confidence histogram, sub-0.7 heuristic count,
  `evidenceClass` and `role` histograms. 400-file draw,
  `sha256=7a2d98afd4a0618c`, seed `markdown-ontology-census-v1`.
  Result JSON: `validation/m60/markdown/ontology-census.json`.

Its headline, over the 400-file draw: **400 files parsed, 0 parse failures, 9,033 symbols,
11,327 relationships.** Symbol kinds were `type` 4,635, `function` 3,104, `property` 854,
`class` 328, `namespace` 112 — **0 kinds outside the shared `SymbolKind`**, **0 symbols with
an empty name**, and **0 relationship endpoints equal to the literal `unknown`** (rules R7
and the standing no-empty-name rule, both counted rather than assumed).
- **`construct-probe.ts`** — instrument A (node types plus parent→child shape) and
  instrument B (semantic counts on the tree, in the reserved positions a grammar inventory
  is blind to). 1,200-file draw,
  `sha256=961778500f885236…`, seed `markdown-construct-probe-v1`.
  Result JSON: `validation/m60/markdown/construct-probe.json`.
- **`edge-recall-probe.ts`** — the instrument the differential structurally cannot be: it
  counts **eligible nodes on the tree** against **edges the analyzer emitted**, because
  when a construct is absent from both the analyzer and the oracle there is nothing to
  disagree about. 200-file draw, `sha256=19ed0b27e157c048`, seed `markdown-edge-recall-v1`.
  Result JSON: `validation/m60/markdown/edge-recall-probe.json`.
- **`pipeline-drop-probe.ts`** — `ASTEngine.parseFile` (pre-filter) against
  `pool-worker.parseFile` (post-filter) on the same file, so every difference is
  attributable to `filterNoiseRelationships` and to nothing else. 1,200-file draw,
  `sha256=3dd7a997a828b8c3`, seed `markdown-pipeline-drop-v1`.
  Result JSON: `validation/m60/markdown/pipeline-drop-probe-1200.json`.

### What each type means in this language

- **`contains`** — structural containment inside one document, read off the block tree:
  heading → nested heading, table, code block, front-matter sibling; table → header column.
  In the 400-file draw, by role: `heading_hierarchy` 3,362, `code_block_under_heading`
  3,104, `table_column` 824, `table_under_heading` 313. A markdown document has no
  cross-file containment, so every `contains` edge is intra-file by construction.
- **`uses`** — the document points at a destination STRING: an inline link, an image source,
  a URI or email autolink, or a reference link resolved through the document's own
  `link_reference_definition`. In the 400-file draw, by role: `markdown_link` 3,323,
  `markdown_autolink` 12. The target is not a symbol name, which is the whole of this type's
  resolution profile — **1 of 3,335 edges resolves at both ends** — and is discussed under
  the six questions.
- **`references`** — the document names an entity it DECLARES: a `#fragment` resolved to the
  heading it names, under the renderer's own anchor rule. In the 400-file draw, by role:
  `markdown_internal_anchor` 389, and **389 of 389 resolve at both ends**. A fragment naming
  a heading in ANOTHER file is the same construct and is not published — resolution is per
  file, which is the declared boundary recorded with the ruling below.

### The eight rulings, each with its instrument, probe and overturn condition

**`imports` — RULED.** The construct a file dependency needs is a path to another file that
the analyzer can BIND. Instrument B, three probes on a 1,200-file draw:

- every relative link destination a document writes: **1,797 occurrences in 338 files**;
- of those, destinations that **resolve to a tracked file in the same repository**:
  **968 in 244 files** — `.md` 915, `.png` 26, `.svg` 2, no-extension 10, `.yaml` 9, and 6
  more of one to three each;
- destinations that resolve to **nothing**: **829, 46.1% of the population.**

The role split matters for the label, so it is counted apart: of the 968 resolving
destinations, **915 are hyperlinks and 28 in 11 files are image sources** — an image's
bytes are required for the document to render, so the file is a dependency of it, while a
hyperlink's target is somewhere the reader goes. The image class is the honest `imports`
population and it is 28 edges in 11 files across 1,200; that is the size of what this
ruling costs, stated so a reader can weigh it.

So the relative-path SHAPE is not the construct: **46.1% of it is a broken link**, and the
population is a mix of live dependencies, typos and navigation. That is the arbiter's own
test applied to this lane — *"a probe that matches a SHAPE rather than a ROLE produces a
number, and the number is worth nothing"* — and the TOML lane's ruling is the precedent:
216 path-shaped values, every one a list of files a tool is told about, so `imports` stayed
ruled.

The second reason is structural and is not this lane's to remove. A per-file analyzer has
no view of the repository's file set: `PROJECT_INDEX_EXTENSIONS` in
`src/ast/parallel-indexer.ts` carries exactly one entry, `{ ".sol": "solidity" }`, so
`context.projectIndex` is `undefined` for markdown in production. Existence cannot be
checked from inside `analyze()`, and emitting `imports` for all 1,797 unchecked paths would
publish 829 edges to files that are not there.

The third construct that *would* carry it — a build tool splicing one file into another —
does not exist in the corpus in a tree position. Instrument B counted **34 include
directives in 19 files** in the draw, and a whole-corpus scan of every `{% … %}` in every
tracked markdown file shows the family is dominated by directives that are not file
splices: `{% include type t="…"` 952 and `{% include tag ver="…"` 304 (Bulma template
tags), `{% include embed spec="…"` 28 (Vega-Embed, embedding a *specification*, not a
file). Genuine file-path includes do exist and are counted: `{% include-markdown "…"` 57,
`{% include docs/elements/*.html …"` 28, `{% include properties.md %}` 12,
`{% include "…"` 13, `{% include_relative bar-chart.vg.json %}` 1. Every one of them lives
in **text**, not in a node the grammar gives a role to, and reading them means parsing the
paragraph's characters — the thing this lane's zero-regex, every-fact-AST-derived property
forbids, and the same reasoning MD-G2 records for Pandoc's `+++` title block.

**Overturn:** `PROJECT_INDEX_EXTENSIONS` gaining `.md` **and** `ProjectIndex` carrying a
general file list (it has `damagedFiles: Set<string>` and nothing else), plus a construct in
a TREE position that names a file. Then `imports` becomes derivable and the 968 figure is
the population.

**`references` — RULED here, then EMITTED by a concurrent relabelling.** This row moved
during the round, so both halves are recorded.

*Ruled, on instrument A over shape.* The block grammar models front matter as one
`minus_metadata` node: measured over a 1,200-file draw, **319 occurrences in 319 files and
zero named children on any of them** (probe `A1:minus_metadata-shape`). There is no
front-matter key to reference from, and the union of both grammars carries no reference node
either. The prose ruling this replaced said the same thing without the measurement.

*Then overturned, on the measurement that actually decides a label.* The six questions'
"Labelled" question asks whether an edge carries the right type rather than a neighbouring
one, and the answer for a `#fragment` is that `uses` was wrong. A fragment names **a heading
this document declares**; a URL or a cross-file path is named by nothing at all. Those are
two different relations sharing one label, and the resolution rate separates them exactly:

| type | edges | both ends resolve, file-local |
| --- | --- | --- |
| `uses` (a destination string: URL, relative path, autolink) | 3,335 | **1 (0.0%)** |
| `references` (a `#fragment` naming a declared heading) | 389 | **389 (100.0%)** |

`references` is the CSS shape — `var(--x)` reading a declared custom property — and the
shared enum spells the class twice, `References`/`DependsOn` against `Uses`/`Dependency`.
Before the split, `uses` read 10.5% overall and the reader could not tell which half was
sound. After it, each label's resolution rate is a statement about its own relation.

**This relabelling adds no edge and removes none.** The 389 edges were already there under
`uses`; only the label moved, so the fabrication class the workstream forbids is untouched.
The work was done concurrently in this worktree by another agent holding the same lane, with
its measurement in `validation/m60/markdown/pass2-labelling-probe.json` and its reasoning in
the fixture's own `rationale`; it is recorded here rather than adopted silently, and this
lane's `references`-is-RULED verdict is superseded by it.

**Overturn, for the part that stays ruled:** a construct that makes a document name an
entity OTHER than one it declares. Concretely, a `#fragment` naming a heading in ANOTHER
file — `[x](other.md#section)` — is a real cross-file reference and this lane cannot publish
it: resolution is per file, the anchor map holds one document's headings, and a per-file
analyzer has no view of the repository (`PROJECT_INDEX_EXTENSIONS` carries `.sol` only).

**`exports` — RULED.** Instrument A: no export node among the 47. Instrument B, because a
grammar cannot see a CONVENTION and the arbiter's own json lane removed an `exports` ruling
for that reason: **193 documents in a 1,200-file draw declare a front-matter `title:`** —
a document naming **itself**. An `exports` edge from a document to its own title is a
self-edge: `addRel` refuses `source === target`, and the store cannot represent it as a
graph edge. So the only candidate construct produces a self-reference rather than an export,
and there is no second endpoint.

**Overturn:** a construct by which a document names an entity OTHER than itself that a
consumer can bind — an `exports:`/`provides:`/`main:` manifest key naming another file.

**`extends` and `implements` — RULED.** Instrument A: **0 of 47** node types is a type
declaration, a supertype clause, an inheritance specifier or an implementation clause.
Both types need a type system, and CommonMark has none.

**Overturn:** any of `class_declaration`, `interface_declaration`, `struct_declaration`,
`trait_declaration`, `extends_clause`, `implements_clause`, `superclass`,
`interface_implementation`, `type_inheritance_clause` in the printed vocabulary.

**`overrides` — RULED.** Instrument B, because a repeated heading is perfectly good markdown
and no grammar inventory would find it. A duplicate anchor is NOT an override: GitHub gives
the second holder `-1`, `-2`, so both headings stay addressable and neither takes the
other's name. Measured: **89 fragment links in 6 files point at an anchor held by MORE THAN
ONE heading** — `kubernetes/CHANGELOG/CHANGELOG-1.23.md` has `#source-code` held by 25
headings — and the displacement count is **0**. The second heading never takes the plain
anchor; it takes `source-code-1`.

**Overturn:** a `#fragment` that resolves to the second-or-later holder of its anchor, i.e.
a renderer where the later heading wins the un-suffixed slug.

**`instantiates` — RULED.** Instrument A: **0 of 47** node types is an object-creation or
constructor node. Instrument B, because the MDX/Storybook reading is a CONVENTION rather
than a grammar: **0 capitalised `html_tag` nodes in 1,200 files** (probe
`B4:component-tag`). The population the reading needs is empty, so there is nothing to read.

**Overturn:** a capitalised `html_tag` in the corpus whose construction the document marks
executable rather than illustrative — and a rule for telling the two apart without reading
markup as text.

**`calls` — RULED for markdown-as-a-language, with the embedded-code population measured.**
The grammar has no callable (Instrument A: 0 of 47). The interesting half is the code a
markdown document CARRIES: **6,243 fenced code blocks in a 1,200-file draw**, by declared
language — no info string 941, `bash` 827, `jsx` 807, `yaml` 320, `ts` 311,
`javascript` 244, `tsx` 187, `scala` 180, `js` 170, `json` 168, `text` 121, `nim` 121, and
more below the cut. Those are not small, and the tempting move is to parse them and publish
`calls`. That would attribute another language's edges to markdown: the lane already
publishes each fence as a `function` symbol carrying `metadata.language`, so the handoff is
addressable, and the index has a cross-language edge mechanism for exactly this. A `calls`
edge whose target is a bash function is a fact about bash, and emitting it from the markdown
lane would put a caller in `bb_graph` and `bb_impact` that no bash file declares.

**Overturn:** a construct in a markdown tree position that names a callable in markdown's
own namespace. A fence carrying a declared language is not that, and this ruling says so
rather than leaving the 6,243 to be discovered as a gap later.

### The six questions, per emitted type

They fail independently, so they are reported per type and not as one verdict. All figures
from the 400-file census draw unless stated.

| | `contains` | `uses` | `references` |
| --- | --- | --- | --- |
| **1. Exists** | yes — five `addRel` call sites | yes — three (inline destination, autolink, reference link / reference-form image) | yes — the resolved-anchor arm, relabelled from `uses` |
| **2. Fires** | 7,603 edges / 322 files | 3,335 edges / 267 files | 389 edges / 40 files |
| **3. Correct** | 1,736/1,736 scala3, 11,108/11,108 kubernetes, MISSING=0, unexplained=0 | same rows | same rows; the audited set is now all three |
| **4. Labelled** | correct — no neighbouring type applies to intra-document containment | correct | **was wrong; relabelled.** The argument and its measurement are under `references` above |
| **5. Resolved** | **7,603/7,603** both ends, file-local; 7,572/7,603 corpus-wide | **1/3,335 (0.0%)** both ends, file-local | **389/389 (100.0%)** both ends, file-local; 294/389 (75.6%) corpus-wide |
| **6. Confident** | 7,603/7,603 at 1.0, `structural`, 7,603/7,603 line-numbered, **0 below 0.7** | 3,335/3,335 at 1.0, `reference_qualified`, 3,335/3,335 line-numbered, **0 below 0.7** | 389/389 at 1.0, `reference_qualified`, 389/389 line-numbered, **0 below 0.7** |

**1 Exists** — derived from source. `contains` has five call sites (`heading_hierarchy`,
`table_under_heading`, `table_column`, `code_block_under_heading`, and the front-matter
symbol which carries no edge); `uses` has three after the split (`link_destination`,
`uri_autolink`/`email_autolink`, reference link and reference-form `image`);
`references` has one (the resolved-anchor arm, line 591).

**2 Fires** — measured above. The stronger form of this question is the edge-recall probe,
because "it produced an edge" does not mean "it produced all of them". See the recall
section below: **analyzer shortfall against the parse tree is 4 edges in 7,630.**

**3 Correct** — `npx tsx script/m14/differential.ts --lang markdown --sample 120`:

```
[scala3]     markdown: files=120 tree-truth=1736  covered=1736  (100%) MISSING=0 | analyzer-edges=1736  unexplained=0 (0%) heuristic=0
[kubernetes] markdown: files=120 tree-truth=11108 covered=11108 (100%) MISSING=0 | analyzer-edges=11108 unexplained=0 (0%) heuristic=0
```

12,844 oracle rows, 0 missing, 0 unexplained, 0 heuristic. A scoped run refuses to write
`M14.0.F5.json`, correctly: that artifact belongs to the 43-language sweep and writing it
from a two-corpus run would replace the milestone's claim with a smaller one.

**The limitation of this instrument, stated because it is the one that matters here.** The
oracle is a second walker over the same grammar, so it disagrees when either side is wrong
and agrees when a construct is absent from both. It could not have found the setext-heading
defect below: that construct's three corpus instances live in `docker` and `packer`, and
the differential's two markdown corpora are `scala3` and `kubernetes`. A 100%-covered,
0-unexplained differential read 0 MISSING while a real edge class was being deleted in
full. The workstream's own argument — *measuring the LANGUAGE found it* — is what found it
here, and it is why `edge-recall-probe.ts` exists.

**4 Labelled** — `contains` has no neighbouring type: nothing in CommonMark expresses
containment other than document structure, and every `contains` edge is intra-file.
`uses` is the arguable one, and the argument is worth making because the opposite verdict is
defensible. The largest `uses` population with a real target is the 915 relative `.md`
hyperlinks, and one could argue they are file dependencies and belong under `imports`. Three
measurements say otherwise. (i) **The role is not there.** `@import url("x.css")` is a
syntactic declaration that the stylesheet depends on another; a markdown hyperlink is a
navigation, and the css lane's own note is that its `imports` resolution rate is 0% and
"that is the honest shape, not a defect" — a rule css can follow because `@import` is a
distinct syntax from `url()`. (ii) **The population is a mix.** 829 of 1,797 relative
destinations resolve to nothing, so labelling the shape `imports` would call half of it a
dependency. (iii) **Relabelling would create the defect the workstream warns about.** The
oracle derives `uses` for every link destination; moving the relative subset to `imports`
would leave that class stored and compared against nothing — a DERIVATION finding created
by the fix. So the label stays on that population, the numbers are published, and the 0.0% resolution
rate is stated rather than engineered away.

*The one that lost.* A `#fragment` names a heading the document declares, and `uses` is the
neighbouring label for a destination nothing declares. That argument was made concurrently
in this worktree, with its measurement, and it was right: those 389 edges are now
`references` and resolve at 389/389 where `uses` resolves at 1/3,335. Recorded under
`references` above, and the strongest statement of it is the resolution column rather than
the prose.

**5 Resolved** — this is the most useful table in the section, because the three types split
exactly along the resolution line.

`contains` resolves at both ends on **7,603 of 7,603**: both ends are symbols this file
published, so the file-local tier is the honest reading. `references` resolves at both ends
on **389 of 389 (100.0%)**, because a resolved `#fragment` names a heading the file
publishes. `uses` resolves on **1 of 3,335 (0.0%)**, and the reason is structural rather than
a defect: its target is a destination **string** — `https://example.com/x`, `./install.md` —
which is not a name any symbol declares. **0 of 3,335 sources fail**: a `uses` source is
always a heading this file published or the `document` container (200 marker sources).
CSS `references` at 66.8% of its edges is the workstream's reference point, and markdown
`references` is above it at 100% for the same reason css is high: both name something the
file declares. The corpus-wide tiers are lower (`contains` 99.6%, `references` 75.6%,
`uses` 0.1%) because a 200-file draw cannot see every name.

The rate is reported, not improved. Before the label split, `uses` read 10.5% overall and a
reader could not tell which half was sound; each label's rate is now a statement about its
own relation, which is the whole of what the "Labelled" question is for.

**There is a second resolution question, and it is the one with a defect.** Both ends being
declared by the file is necessary but not sufficient: the edge must also survive the
pipeline. `pipeline-drop-probe.ts` measures that directly, pre-filter against post-filter on
the same file, over a 1,200-file draw: **the analyzer emitted 40,794 relationships and the
worker delivered 39,029 — 1,765 edges deleted, 4.33%.** Symbols are unaffected: 26,378
pre-filter, 26,378 delivered, 0 dropped, 0 added. Every drop is attributed to a named rule,
and the rules are the universal identifier sanitizer's:

| rule | count | example |
| --- | --- | --- |
| `leaf-brace-angle-backtick` | 1,127 | ``Storage Prisma Extension`` → `` `create` & `createMany` operations `` |
| `leaf-starts-with-space` | 480 | `Uploading Files` → `1. Setting up the File scalar` |
| `leaf-too-long` | 133 | heading text over 80 characters, or a URL over 80 |
| `leaf-too-short` | 20 | heading text ending in `.` — `extractLeaf` returns `""` |
| `target-over-200` | 5 | — |
| unattributed | **0** | — |

By role: `heading_hierarchy` 1,212, `markdown_link` 324, `markdown_internal_anchor` 122,
`table_column` 66, `table_under_heading` 40, `markdown_autolink` 1. By type: `contains`
1,318, `uses` 447.

**This is a defect and it is not the analyzer's to fix.** `filterNoiseRelationships`
(`src/ast/pool-worker.ts`) computes `extractLeaf(target)` — the last `.`-separated
segment — and then rejects a leaf that starts with a space, contains a double space, is
over 80 characters, is empty, or contains `{ } < >` or a backtick. Those are rules about
**identifiers**, and a markdown heading's target is **prose**, which the author chose:

- `extractLeaf("1. Setting up the File scalar")` is `" Setting up the File scalar"` — the
  rule reads its leading space as a malformed name and deletes the edge. **Numbered section
  headings are one of the commonest conventions in documentation**, and this deletes the
  document outline for every one of them.
- A heading written with inline code — `` `create` & `createMany` operations `` — carries a
  backtick and is deleted.
- A heading ending in a full stop — `Roundtrip: Separate blocks with same name.` — yields an
  empty last segment and is deleted.
- A heading containing an HTML span — `Default Severity: <span class="severity high">high</span>`
  — carries angle brackets and is deleted.

**The shape of the defect is the reason it survived.** The heading SYMBOL is not filtered
this way, so the node exists in the index and **nothing points at it**. A reader of the
graph sees a section with no parent. Any count taken after the filter — including every
census figure in this document — cannot see the loss, because the loss happens before the
count. The instrument that sees it is a diff of the two entry points, and the two
independent instruments in this lane now converge on the same number from opposite
directions: the pipeline probe measures 1,765 of 40,794 deleted; the edge-recall probe
measures the same edges as the `T − D` residual and attributes them to the same three rules.

The fix is a §8 item for the supervisor: extend `filterNoiseRelationships`' escape hatch —
the one `NOISE_TARGETS` already has, in the form of a `declaredNames` check — to the leaf
rules, so a target the file **declares** is not judged as an identifier. Measured: 1,765
edges in a 1,200-file draw, 89 of them `heading_hierarchy` in a 200-file draw.

**6 Confident** — both types are 100% at confidence 1.0 with **0 edges below 0.7**, so the
heuristic ratio required by honesty contract §4 is zero for this lane and is countable as
zero. The `evidenceClass` mapping is `contains → structural` and
`uses → reference_qualified`, assigned centrally by `classifyEvidenceTier` so an emission
site cannot skip it. Both tiers were chosen against `graph-core.ts`'s read-time
`STRUCTURAL_TYPES` set, which does not contain `contains` — with no stored class the entire
heading hierarchy rendered to readers as `inferred`, *"a guess, treat as a hint, never as
fact"*, for edges that cannot be anything else. One caveat is recorded in the analyzer's own
comment and stands here: the `reference_qualified` arm's `resolved === false` branch is
unreachable in this lane, because every published `uses` edge resolves a destination the
grammar read out of a node, so that branch is deliberately not invented.

### DERIVATION findings: 0

A DERIVATION finding is a type the analyzer emits that the differential never audits. The
audited set is fixed at `script/m14/differential.ts:23392`:

```ts
...(lang === "markdown" ? ["contains", "uses"] : []),
```

The lane emits exactly `contains`, `uses` and `references`, and the audited set is those
three: the concurrent relabelling added `references` to
`script/m14/differential.ts`'s markdown entry in the same commit cycle, so **emitted set =
audited set and this lane's DERIVATION count is 0**, matching the handover figure. It was 0
before this round, it is 0 after the setext fix (which adds `uses` edges, an audited kind),
and it is 0 after the relabel — which is the check that matters here, because relabelling a
type into the audited set without adding oracle truth for it is exactly how a DERIVATION
finding is born.

### Edge recall: nodes on the tree against edges emitted

The instrument the differential cannot be. `edge-recall-probe.ts` counts eligible nodes on
the pinned wasms and compares them to the analyzer's output, over a 200-file draw, and
names the mechanism behind every delta:

| row | tree nodes | expected | emitted | delta |
| --- | --- | --- | --- | --- |
| `uses` / `markdown_link` | 3,483 | 3,600 | 3,591 | 9 |
| `uses` / `markdown_autolink` | 92 | 92 | 92 | 0 |
| `uses` / `markdown_internal_anchor` | 418 | 418 | 409 | 9 |
| `contains` / `heading_hierarchy` | 1,843 | 1,843 | 1,754 | 89 |
| `code_span` carrying a `link_destination` | 0 | 0 | 0 | 0 |

The `expected` column is the tree count plus the construct that adds an edge without adding
a node — 117 reference-link uses whose destination lives in a block-level
`link_reference_definition` — less 674 undefined references MD-D1 declines to publish, which
is a specification rather than a loss. The last row is a STRUCTURAL reachability claim and
0 is the correct answer: the inline grammar gives `code_span` only anonymous children, so no
`link_destination` is reachable beneath one. A non-zero count there would falsify it.

Then the delta is split in two, exactly, by computing the pre-filter result as well:

```
T = eligible nodes on the pinned trees
A = what the analyzer emitted PRE-filter   (ASTEngine.parseFile)
D = what the worker DELIVERED POST-filter  (pool-worker.parseFile)

analyzer shortfall (T - A) = 4 of 7,630 pre-filter edges   (0.05%)
pipeline deletion  (A - D) = 119 of 7,630                 (1.56% of this draw)
    leaf-starts-with-space       52
    leaf-brace-angle-backtick    46
    leaf-too-long                21
    by role: heading_hierarchy 89, markdown_link 20, markdown_internal_anchor 8,
             table_under_heading 1, table_column 1
```

**The analyzer's shortfall against the parse tree is 4 edges in 7,630.** Of those, 3 are the
`addRel` identity collapse — an edge is keyed on `(source, type, target, line)`, so two
identical destinations on one line under one owner produce one edge, which is correct
de-duplication and makes the tree count one too high. **One edge is not decomposed**, and it
is named as such rather than rounded into the total: 0.01% of the draw, cause unknown, and
the artifact records it. An earlier version of this probe printed `0` for the shortfall
because it added only what was left after labelling, and four real shortfalls were absorbed
by the labelling walk; the arithmetic is now `t - a` unconditionally.

## Defect found and closed this round: links inside setext headings

`emitInlineUses` resolved a heading's own `inline` node with `findChildByType`, which walks
**direct** named children. The two heading forms do not hold their text the same way, and
both shapes are dumped from the pinned wasm:

```
atx_heading    > atx_h1_marker , inline
setext_heading > paragraph > inline , setext_h1_underline
```

So `findChildByType` returned null for **every** setext heading, the method returned before
emitting anything, and the block walk's `continue` meant the paragraph was never descended
into either. Every link, image, autolink and reference link inside a setext heading was
silently dropped. The `if (!inline) return` read as a guard against a heading with no text;
it was in fact a guard that matched half the heading forms.

**Population, stated rather than inflated.** 76 setext headings in a 1,200-file draw, across
17 files. A whole-corpus scan of every line whose FOLLOWING line is a setext underline and
which itself contains a link found **3**: the H1 of
`docker/vendor/github.com/hashicorp/go-immutable-radix/README.md`, the H1 of its `v2/`
sibling, and `packer/README.md:4`. All three are badge banners of the shape the new fixture
reproduces exactly.

Three instances is small; the asymmetry inside one construct is the defect, and that is the
argument that closed MD-G1 for indented code blocks at a population the lane's own first
estimate understated by 100×. The fix is one bounded hop in the analyzer
(`headingInline`): direct `inline`, else the `paragraph`'s `inline`. The engine already
supplied the tree — `extractMarkdownInlineBlocks` walks the whole block tree — so **no shared
file changed**.

**The fixture is proven able to fail, and the first version of it was not.**
`validation/m14/fixtures/markdown/setext-heading-inline` reads FAIL with the fix reverted
(8 pass / 1 fail, with 7 expected relationships missing) and PASS with it (9 / 0, 19
relationships of which 8 are `uses`). The first version of that fixture asserted the setext
rows using **ATX** headings whose *text mentioned* a setext destination, so every row matched
an ATX edge and it read 9 pass / 0 fail with the fix reverted — a trivially-true fixture in
the exact sense honesty contract §5 names. Reverting the fix is the only reason it was
caught, and the record of the mistake is in the expectation file's own `forbidRelationships`
half so the next reader sees the correction rather than only its absence.

## Declared limitations

Markdown is not Turing-complete, but this list is not blank because the language is simple.
Each entry is a place where the graph is narrower or different from the document.

1. **A relative link is published as a string, so 3,334 of 3,335 `uses` targets do not
   resolve** (1 of 3,335, 0.0%, in the 400-file draw). Structural: the target is a
   destination, not a symbol name. A reader cannot follow a markdown `uses` edge to a node in
   the index, and cannot reverse it either. The label split makes this legible rather than
   fixing it — `references` at 389/389 says which class of link DOES bind — but the
   `uses` population itself is unchanged, and the relative-path subset (915 `.md` links
   resolving to real repository files in a 1,200-file draw) is the part that would matter
   most and is reported here rather than left implicit.
2. **1,765 edges the analyzer emitted do not reach the index (4.33%, 1,200-file draw).**
   Deleted by `filterNoiseRelationships` applying identifier rules to prose targets. The
   heading symbols survive, so the affected sections exist with no parent. Detailed above
   with the per-rule counts and the fix; it is a shared file and is filed as a §8 item.
3. **4.33% of edges, and the same edges, are invisible to every count taken after the
   filter.** Any census that reads `parseFile` — which is every figure in this document —
   cannot see this class. Only a pre/post diff of the two entry points can.
4. **An undefined reference link is invisible, not flagged** (MD-D1). A reader cannot
   distinguish "this document has a broken reference" from "this document never had one".
   The alternative measured as 171 fabricated endpoints over 34 corpus files.
5. **An unresolved `#fragment` is invisible** (MD-D6): 16 of 10,174 bare fragments in the
   lane's original 420-file draw name a heading that does not exist, and the count is
   disclosed in `metadata.patterns` rather than published as an edge.
6. **A repeated anchor leaves all but one holder unaddressable.** 89 fragment links in 6
   files point at an anchor held by more than one heading; `kubernetes/CHANGELOG/CHANGELOG-1.23.md`
   has `#source-code` held by 25 headings. All 25 publish as symbols, but only the first is
   reachable by a plain `#source-code` link. The `-1`/`-2` aliases the analyzer computes are
   never published, so 24 addressable anchors per duplicate go unnamed.
7. **A setext heading's published NAME is its first line; its links are read from the whole
   paragraph.** A setext heading whose text wraps therefore publishes the first line as its
   name and any link on the continuation line as an edge whose source name does not contain
   the link. The name is the contract spelling (MD-D2) and 59 hand-audited ground-truth
   facts depend on it; the corpus holds 0 multi-line setext headings carrying a link outside
   the fixture, so there is no measurement to justify widening it.
8. **Anchors are ASCII-only** (MD-D6). GitHub's slugger keeps Unicode letters, so `Café` is
   `#café` and this lane's slug is `#caf`. 24 headings in the lane's corpus contain non-ASCII
   characters and all 24 are Unicode punctuation, which the renderer also drops, and 0
   corpus links target a non-ASCII anchor. Documents affected: 0 as measured, unknown in
   general.
9. **A raw HTML block contributes nothing.** 579 sites over 291 of the lane's 738 original
   corpus files (MD-D4). A document that is largely HTML — a generated API reference — gives
   only its markdown skeleton to the graph. 0 capitalised tags in 1,200 files, so the
   MDX-component reading of `instantiates` has no population to read.
10. **Most `indented_code_block` sites are not authored code** (MD-G1). 217 nodes over
    1,138 pinned files, and most are the wrapped continuation lines of deeply-nested list
    items, which CommonMark genuinely reads as indented code. They are published anyway,
    because the alternative is the asymmetry the gap closed; a consumer can read
    `nodeType: indented_code_block` and the range and discount them.
11. **A fenced code block's body is not read.** 6,243 fences in a 1,200-file draw carry
    another language's program, and the lane publishes the fence as a site with
    `metadata.language` and nothing else. Call edges inside a fence belong to the embedded
    language's lane; see the `calls` ruling for why this lane does not publish them.
12. **`contains` is intra-file by construction.** A markdown document has no cross-file
    containment, so there is no way to answer "which document includes this one" from this
    lane's graph, and the `imports` ruling above is why.
13. **The differential cannot see a construct both walkers skip, and did not.**
    12,844 rows, 0 missing, 0 unexplained, and the setext-heading defect was invisible to it
    because its three corpus instances are in `docker` and `packer` and its markdown corpora
    are `scala3` and `kubernetes`.
14. **The lane has no registered mutants in the shared harness.**
    `grep -c 'language: "markdown"' script/m14/mutate-analyzer.ts` returns **0**, while this
    document previously claimed "Mutants (F4) — 10, all caught" and the lane's spec cites
    mutants by name (`markdown/internal-anchor-unresolved`,
    `markdown/indented-code-block-dropped`). Those names were cited as coverage and wired
    to nothing that runs. A lane-owned harness now exists and reads 8/8 caught; registering
    it in the shared registry is a §8 item. **The previous claim of 10 is retracted.**
15. **The arbiter does not report for this lane** and its refusal is not a lane result. Two
    independent causes, both §8 items: `engine.ts:1412` `process.exit(1)` on a 120 s parse
    hang in `dart-sdk/.../lsp.md`, and the absence of a `markdown` entry in the gate's
    `RULED_BY_LANG` table.
16. **Four grammar-level parse errors and one hang** are recorded rather than attributed to
    the analyzer: `[BB-PARSE-ERR] … memory access out of bounds` on
    `dart-sdk/pkg/analysis_server/doc/implementation/{lsp,overview}.md`,
    `element-plus/.github/CONTRIBUTING.zh-CN.md` and
    `flutter-packages/packages/rfw/CHANGELOG.md`, and the `lsp.md` hang.
17. **One edge-recall delta is not decomposed**: 1 of 7,630 pre-filter edges in a 200-file
    draw, cause unknown. Recorded in `validation/m60/markdown/edge-recall-probe.json` rather
    than rounded away.

## Verification

Each row is a gate that can FAIL. The "teeth" line is the part that matters — an instrument
nobody has watched fail is a claim.

- **Fixtures (F3)** — **9 in `validation/m14/fixtures/markdown/`**, each authored from the
  contract rather than transcribed from analyzer output. `npx tsx script/m14/run-fixtures.ts
  --lang markdown` → **9 pass / 0 fail**. **This document previously said 4; there were 8
  before this round and 9 after, and the 4 is corrected here.**
  **Teeth:** with the setext fix reverted the suite reads **8 pass / 1 fail**, so the lane
  can fail.
- **Lane mutants (F4)** — **8 in
  `validation/m14/fixtures/markdown/markdown-mutants.ts`, 8 caught**, each a faithful
  revert of one real decision: the setext loss, MD-D6's raw-fragment publication, MD-D6's
  unresolved suppression, the heading-hierarchy self-edge, the repeat-site ordinal, MD-D1's
  undefined references, the code-span exclusion, and the table-column symbol.
  **Teeth:** `markdown/internal-anchor-unresolved-kept` **SURVIVED its first run**, and that
  is the row that matters — the fixture named ONE broken fragment (`#no-such-heading`) and
  not the second (`#also-missing`), and had no row at all for the forward reference's raw
  fragment. Three `forbidRelationships` rows were added to close it and the mutant now reads
  CAUGHT. The mutant also had an off-by-one that produced `##install-now` and matched nothing;
  that is recorded in its own comment.
  **This document previously said "10, all caught" against the SHARED registry, which holds
  0 markdown mutants. Retracted; see limitation 14.**
- **Differential (F5)** — `npx tsx script/m14/differential.ts --lang markdown --sample 120`
  → 12,844 oracle rows, MISSING=0, unexplained=0, heuristic=0 across both corpora. A scoped
  run refuses to write `M14.0.F5.json`, correctly.
  **Teeth:** the same oracle run against the PRE-FIX analyzer reports `MISSING=127`
  (scala3) and `MISSING=67 + unexplained=5` (kubernetes) with no hint given.
  **And its limit:** it could not see the setext defect — see correctness above.
- **Ontology census** — 4 probes, every figure in this section re-derivable from a named
  script, seed and draw hash.
  **Teeth:** the edge-recall probe's first version reported an analyzer shortfall of `0`
  because of its own arithmetic; that was caught by re-deriving the number by hand, and the
  probe now prints `T - A` unconditionally. The construct probe's first version reported
  **8 wiki links in 3 files** that were ordinary reference links — `[this link][new-issues]`
  gives a `link_label` whose text is `[new-issues]`, and the probe compared raw label text
  against `[`. It also missed every reference-form destination, because
  `link_reference_definition` is a BLOCK node the inline walk never sees, which is why the
  60-file draw read 138 relative file links and the 1,200-file draw reads 968. Both probe
  defects are recorded in the probe's own comments.
- **Pipeline drop** — 1,765 of 40,794 edges deleted post-filter, every one attributed to a
  named rule, unattributed **0**.
  **Teeth:** its first version reported 26,378 of 26,378 symbols dropped, because a
  `Set`-keyed diff cannot survive the worker's symbol re-projection; it is now a multiset
  keyed on `name|kind`, and the correct answer (0 dropped, 0 added) is what it prints.
- **Grammar audit (F1)** — PASS, refs 4, unknown 0, unknownFields 0, **union oracle: block +
  inline** (282 node types, up from 196).
- **Grammar pins** — both wasms sha256-pinned with full surface; the registry copy of each
  is byte-identical. Provenance class is `unnamed-build-sha-only`, not an inherited `0.5.1`
  claim.
- **Completeness (SPEC)** — 8/8 sections over **72 named types** across both grammars. The
  bucket counts read from `script/m14/spec/markdown-completeness.json` at this commit are
  **30 handled / 42 internal_silent / 0 gap / 6 ruled decisions / 2 closed gaps**. **This
  document previously said "29 handled / 41 silent / 2 gap"; the spec now reads 30/42/0
  because MD-G1 and MD-G2 are both closed, and the earlier figures are corrected here.**
- **Probes (F9)** — **7 registered** (`F9-PROBE-MD1`, `MD1b`, `MD2`, `MD3`, `MD6`, `MD9`,
  `MD10`), unchanged this round.
- **M12 contract probe** — 31/31.
- **M12 differential** — 59/59, precision 1.000, recall 1.000.
  **Stated plainly: this is a mirror, not a differential.** `truthSource` is
  `manual_audit`, no commit is recorded, and `verify-differential-freshness.ts`
  files it under `UNPINNED (no inputs block — cannot be checked, NOT covered)`. It
  measures a truth file hand-authored by the same hand as the analyzer, over three
  hand-written files totalling 99 lines — which contained zero reference links,
  zero duplicate code blocks and zero duplicate headings, i.e. precisely where the
  lane was wrong. The F5 oracle above is the instrument that can disagree, and even it
  could not see the setext defect.
- **Honesty gate** — `script/m14/verify-honesty.ts` reports **22 failures at this commit**,
  none of them in a markdown file: 12 banned-term hits in other lanes' expectation files and
  evidence artifacts, `F7` non-passing checks for cpp and elixir, and 8 stale-input
  regenerations (F1–F9). Every one of those artifacts is supervisor-owned and none is in
  this lane's scope. **The markdown files this round adds and edits carry none of the
  §1 banned terms** — checked by hand against the list, term by term.

- **Corpus** — 12,729 admitted `.md`/`.markdown` files across 138 repositories at
  `$HOME/fixtures/repositories` for the census work. The differential's two
  pinned corpora remain `scala3@18df09c0` (738 tracked `.md`) and `kubernetes` (595).
  Four `[BB-PARSE-ERR] … memory access out of bounds` and one 120 s parse hang are named
  above and are grammar-level, not analyzer-level.
- **Review** — `reviews/markdown/master-review.md`: 10 defect classes and 4 gate defects,
  each with the measurement that made it a finding. This round adds one more defect class
  (setext-heading inline loss) and one more gate defect (0 registered mutants against a doc
  claim of 10).

## Known gaps, in the order they should be closed

1. **The pipeline deletion (4.33% of edges).** Shared file, §8. The fix is to extend
   `filterNoiseRelationships`' existing `declaredNames` escape to the leaf rules, so a
   target the file **declares** is not judged as an identifier. 1,765 edges per 1,200
   files; 89 `heading_hierarchy` edges per 200 files.
2. **The lane has 0 mutants in the shared registry.** §8. Two lines —
   `import { MARKDOWN_MUTANTS }` and `...MARKDOWN_MUTANTS,` in
   `script/m14/mutate-analyzer.ts` — following the fsharp / css / nim / protobuf precedent
   already in that file.
3. **The arbiter has no ruling table for markdown.** §8. A `MARKDOWN_RULED` table carrying
   the eight rulings above, each with its instrument and its `nodeTypesThatWouldMeanIt` or
   `countOnTree`, so `ontology-coverage-gate.ts markdown` reports ten rows instead of
   exiting 2.
4. **The arbiter dies on one corpus file.** §8. `src/ast/engine.ts:1412`'s
   `process.exit(1)` on a 120 s parse hang ends the whole gate run, so any lane whose corpus
   contains `dart-sdk/pkg/analysis_server/doc/implementation/lsp.md` can never be gated.
   The comment says the indexer is incremental and re-running resumes; a gate has no such
   property.
5. **The canonical `M14.0.F5.json`** has no markdown row. markdown's F5 rows are
   measured and pinned in `differential-baseline.json`, but a scoped run is refused the
   right to write the milestone artifact — that belongs to the 43-language sweep.
6. **One edge-recall delta of 7,630** is not decomposed.
7. **Repeated anchors publish no `-N` alias**, so 24 of every 25 duplicate headings are
   unreachable by any link. Measured 89 links into duplicated anchors across 6 files.
8. **Footnotes, wiki links and front-matter keys** produce no relationships. Wiki links are
   measured at **0** in a 1,200-file draw with the probe's own false-positive class fixed;
   footnotes have no node type in either pinned grammar.
9. **Not markdown's, recorded because it is adjacent**: `F9-PROBE-CLEAN-HEAD-PATTERN`
   (`instantiates:wrap->Just`) fails on the clean lane, reproduced on a stashed
   tree. It is the clean lane's finding.
