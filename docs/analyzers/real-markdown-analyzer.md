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

## Verification

Each row below is a gate that can FAIL, and the "teeth" line is the part that
matters: an instrument nobody has watched fail is a claim.

- **Differential (F5)** — an independent CommonMark oracle at **0 MISSING / 0
  unexplained** on BOTH pinned corpora: `scala3@18df09c0` (738 tracked `.md`,
  the M12 corpus of record — one pin, two instruments, one claim) and
  `kubernetes` (595, a different dialect by measurement, not a second copy; the
  deepest draw 9,763 truth rows over 60 files). The oracle is written from
  CommonMark's own construct list, imports nothing from this analyzer, and loads
  its own copy of the companion grammar — an oracle that read the analyzer's
  pre-parse would agree with it by construction, which is the F9 collusion
  blindness the doctrine exists to catch.
  **Teeth:** the same oracle run against the PRE-FIX analyzer reports
  `MISSING=127` (scala3) and `MISSING=67 + unexplained=5` (kubernetes) with no
  hint given. Two of the three defects it found were in the ORACLE, in the
  opposite direction to the analyzer's original bug — two implementations of one
  contract can be wrong in opposite directions, and only a differential that
  derives both independently finds the pair.
- **Probes (F9)** — 7, each encoding a defect class that actually occurred.
  `MD1b`'s forbidden half is asserted on the **oracle** too, and that check is
  what caught the oracle deriving `##`/`###` for empty headings — a construct too
  rare for either corpus to contain, so the differential could not see it.
- **Mutants (F4)** — 10, all caught. The tenth is the only ADDITIVE one: a link
  inside a code span published as a link, the only mutant whose survival would
  mean the analyzer is right and the pin is wrong. It survived the first run
  because it was a **dead** mutant (it cloned an existing edge, and the code-span
  link is correctly absent from the result, so its condition never fired), and
  the fixture was also pinning the forbid by `from` when the defect is that the
  destination is published at all. Both instrument bugs are recorded in the
  mutant's own comment.
- **Fixtures (F3)** — 4, in `validation/m14/fixtures/markdown/`, each authored
  from the contract rather than transcribed from analyzer output — which is the
  only reason they were able to disagree with it.
- **Grammar audit (F1)** — PASS, refs 4, unknown 0, unknownFields 0, **union
  oracle: block + inline** (282 node types, up from 196).
- **Grammar pins** — both wasms sha256-pinned with full surface; the registry copy
  of each is byte-identical. Provenance class is `unnamed-build-sha-only`, not an
  inherited `0.5.1` claim.
- **Completeness (SPEC)** — **8/8 sections** over 72 named types across both
  grammars (29 handled / 41 silent / 2 gap / 6 ruled decisions), in `GATED_LANGS`.
- **M12 contract probe** — 31/31.
- **M12 differential** — 59/59, precision 1.000, recall 1.000.
  **Stated plainly: this is a mirror, not a differential.** `truthSource` is
  `manual_audit`, no commit is recorded, and `verify-differential-freshness.ts`
  files it under `UNPINNED (no inputs block — cannot be checked, NOT covered)`. It
  measures a truth file hand-authored by the same hand as the analyzer, over three
  hand-written files totalling 99 lines — which contained zero reference links,
  zero duplicate code blocks and zero duplicate headings, i.e. precisely where the
  lane was wrong. The F5 oracle above is the instrument that can disagree.
- **Corpus** — 738 tracked, 734 clean, 4 named grammar limits, 0 unexpected, 0
  crashes. 8,633 symbols and 11,401 relationships over those 738 files.
- **Review** — `reviews/markdown/master-review.md`: 10 defect classes and 4 gate
  defects, each with the measurement that made it a finding.

### Pandoc/MyST `+++` title blocks (MD-G2, closed as a grammar boundary)

The `---` spelling of front matter is handled and publishes `front_matter`. The `+++`
spelling publishes nothing — and the reason is not that the analyzer declines to look.

`plus_metadata` is **declared** in the pinned block grammar's node-type list, which is
why the union census counts it among the 72 named types, but the grammar **never
instantiates** it. Measured: the bare Pandoc form parses to a `paragraph`; the MyST
`<!--[metadata]>` + `+++` form parses to an `html_block`; and across all 5,501 markdown
files in every pinned corpus — 18 of which carry real MyST title-block metadata, in
`docker/api/docs` — the grammar produces zero `plus_metadata` nodes.

So the asymmetry is not the analyzer's to close. A front-matter branch keyed to this
node type would be **dead code**, and the only way to read a `+++` title block is to
parse the paragraph's text, which is what the zero-regex rule forbids. The lane
therefore reads a `+++` block as prose, and says so here rather than leaving the
doc's silence to be read as an oversight.

The obligation is forward-looking and has a real detector: if a grammar ever
instantiates the node, `validation/m14/grammar-pins.json` goes red on `typeSetDigest`
(it is drift-gated on all ten surface keys), and this section is where the duty is
written down.

## Known gaps, in the order they should be closed

1. **The worker seam is unclosed and currently unpinnable.** `pool-worker.ts`
   narrows `symbol.metadata` to a 15-key CSS-only allowlist, so `nodeType`,
   `headingLevel`, `language`, `isMarkdownTable`, `isMarkdownCodeBlock`,
   `isMarkdownFrontMatter` and `isRepeatedSite` never reach the index — including
   the `language` this document's symbol-contract table lists. The F3 fixture lane
   calls `engine.parseFile`, not the worker, so **no fixture can see it**; the
   instruments that can are the pipeline e2e gate and P1. Named as owed rather
   than claimed.
2. **`MD-G1`** `indented_code_block`: 2 sites in 2 of 738 files publish nothing
   while a fenced block publishes `code_block.<lang>`. Small, but an asymmetry
   inside one construct.
3. **`MD-G2`** `plus_metadata` (Pandoc/MyST `+++` front matter): **0 corpus
   sites**, so it is owed a real MyST corpus rather than an invented fixture.
4. **The canonical `M14.0.F5.json`** has no markdown row. markdown's F5 rows are
   measured and pinned in `differential-baseline.json`, but a scoped run is
   refused the right to write the milestone artifact — that belongs to the
   34-language sweep. Issue #290 is discharged in substance and open on the
   tracker for that reason.
5. **Issue #290's other half** and the M12 mirror artifact's retirement.
6. **Front-matter keys, footnotes and wiki links** produce no relationships (see
   the boundaries above).
7. **Not markdown's, recorded because it is adjacent**: `F9-PROBE-CLEAN-HEAD-PATTERN`
   (`instantiates:wrap->Just`) fails on the clean lane, reproduced on a stashed
   tree. It is the clean lane's finding.
