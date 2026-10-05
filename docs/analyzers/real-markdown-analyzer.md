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

Added 2026-10-03; **whole-corpus figures added 2026-10-04**. Every number below comes from
the production entry point `parseFile` (`src/ast/pool-worker.ts`) or from the pinned parse
trees, and every one is re-derivable by a script named beside it. Corpus root
`$HOME/fixtures/repositories`.

**There is no sample any more.** `whole-corpus-census.ts` walks every file the gate's own
admission test admits — `detectLanguageFromPath(abs, text) === "markdown"`, the same test,
over the same `git ls-files` walk — and parses all of them: **17,456 files across 196
repositories, `populationSha256` `1d079c4fff2092ce`, 0 parse failures, 0 shards lost.**
Sampling by `sha256("<seed>|<repo>/<rel>")` order is retained only for the older probes named
below, which say so where their figures appear.

The corpus is a MOVING TARGET under ten concurrent lanes and the growth is visible in this
branch's own history: the arbiter's two runs each admitted 15,234 files, and the census
written afterwards admits 17,456. Every figure below therefore names its population, and the
population hash is in the JSON beside it.

### The supervisor's arbiter now runs for this lane — and what it printed

**Corrected 2026-10-05.** The section this replaces said the arbiter does not report for
markdown. It no longer does not: it gained `resumableWalk` (`script/m14/resumable-walk.ts`)
and the ruling table is wired (`RULED_BY_LANG.markdown`, line 261). Four invocations walked
the whole admitted population and the fifth printed a verdict:

```
walk: 17456/17456 files (100.0%)  newly walked 2440, resumed 15016

type          status            detail
------------------------------------------------------------------------------------------------
calls         RULED-SOUND       NOT EMITTED; the grammar produced 84 distinct node types ...
uses          EMITTED           30,696 edges in 4+ files
contains      EMITTED           32,034 edges in 4+ files
imports       EMITTED           69 edges in 4+ files
references    EMITTED           342 edges in 4+ files
exports       RULED-SOUND       NOT EMITTED; the grammar produced 84 distinct node types ...
extends       RULED-SOUND       NOT EMITTED; the grammar produced 84 distinct node types ...
implements    RULED-SOUND       NOT EMITTED; the grammar produced 84 distinct node types ...
overrides     RULED-SOUND       NOT EMITTED; the grammar produced 84 distinct node types ...
instantiates  RULED-SOUND       NOT EMITTED; the grammar produced 84 distinct node types ...
------------------------------------------------------------------------------------------------
emitted 4/10   ruled-sound 6   FALSIFIED 0   ruled-without-justification 0
```

**Exit 0, `FALSIFIED 0`, `ruled-without-justification 0`** — which is what
`script/m14/markdown-ruled.ts` is for, and the reason the wiring is a supervisor item rather
than one of mine. **Those two zeros are the trustworthy part of that output.** The `emitted`
split is not, and the reason is a defect in shared machinery that this lane must report
rather than edit (§8). Two are recorded in `validation/m60/markdown/arbiter-findings.json`:

**MD-ARB-1 — the tally is not persisted, so a resumed run's counts cover only the files it
re-parsed.** `observed` is populated inside the `run` callback passed to `resumableWalk`, and
`resumableWalk` calls `run` only for paths not already in the checkpoint. So the counts above
describe **the 2,440 files that run newly walked**, while the line above them reads
`17456/17456 files (100.0%)`. Measured against the whole-population census:

| Type | Whole population, 17,456 files | Arbiter's tally, over its 2,440 newly-walked files |
| --- | --- | --- |
| `uses` | 270,779 | 30,696 |
| `contains` | 334,773 | 32,034 |
| `references` | 16,857 | 342 |
| `imports` | 105 | 69 |
| `calls` | 8 | 0 |
| `instantiates` | 3 | 0 |

The subset is not a sample of the population either: files arrive in `readdirSync` order, so
the tail is whichever repositories sort last, which is why `references` is off by 49× and
`imports` by only 1.5×.

The endpoint of that defect is worth stating plainly, because it inverts the lane's verdict
on precisely the types the lane gets right. With the checkpoint complete, one more run printed:

```
walk: 17456/17456 files (100.0%)  newly walked 0, resumed 17456
emitted 0/10   ruled-sound 7   FALSIFIED 0   ruled-without-justification 3
```

exit 1 — with `uses`, `contains`, `imports` and `references` reported **RULED-UNJUSTIFIED**.
A lane that emits 4 types over 622,525 edges is told by the gate that it emits none of ten and
has three unjustified rulings, because a tool cache was complete. The fix is to persist the
tally beside the checkpoint (`<path>\t<type>\t<n>`, appended **before** the next file starts,
for the same reason `resumable-walk` appends before it parses) and rebuild `observed` from it
on startup.

Because leaving a complete checkpoint in `validation/m14/measurements/walk-markdown.txt` arms
that false verdict for the next run, this lane **moved** it to
`validation/m60/markdown/walk-markdown.txt.complete` — 17,456 unique lines, 0 bad markers, the
population genuinely walked — rather than deleting it. Nothing is lost and nothing is armed.

**MD-ARB-2 — instrument A's denominator is 84 node types where the corpus's grammars produce
108.** Instrument A loads one grammar, `LANGS[LANG].wasm` = `tree-sitter-markdown.wasm`, the
BLOCK grammar. The analyzer reads a second: `src/ast/engine.ts:1277` loads the
`tree-sitter-markdown-inline` companion and `real-markdown-analyzer.ts:6,13` consumes it. The
arbiter never loads it, so its grammar inventory is blind to the entire inline vocabulary —
`inline`, `emphasis`, `strong_emphasis`, `code_span`, `link_destination`, `strikethrough`,
`pipe_table_*`, `image`, `uri_autolink`, `entity_reference` and the rest. Measured union over
the whole population: **83 block + 64 inline = 108**, against the arbiter's 84.

No markdown ruling moves — none of `exports`/`extends`/`implements`/`overrides` is expressible
in the inline grammar either, and this lane measured that union rather than the block subset —
but a construct that is **inline-only** would be falsely ruled by any lane whose arbiter
inherits this. The fix already exists elsewhere: `script/m14/audit-analyzer-grammar.ts:176`
declares `EXTRA_GRAMMARS = { markdown: ["tree-sitter-markdown_inline.wasm"] }` for precisely
this reason. Instrument A should union over that map.

**MD-ARB-3 — the spec ruling lookup matches the ruling PROSE, so a decision that merely names
a type while explaining itself is returned as that type's ruling.** `rulingFor(t)`
(`script/m14/ontology-coverage-gate.ts:384-391`) takes the table miss, scans
`script/m14/spec/markdown-completeness.json` for a `status: RULED` decision, and accepts the
first whose `resolution` **prose** matches `/\b<t>\b/i` plus a weak
`/ontology|emits|excluded|type/i` subject heuristic. The spec already carries a
machine-readable subject — `node_type` — and the loop never reads it. Measured against this
lane's 12 decisions, all `RULED`:

| decision | `node_type` | prose matches | consequence |
| --- | --- | --- | --- |
| MD-D7 | `ontology:extends` | `contains`, `extends` | **false positive** — returns the `extends` ruling as `contains`'s |
| MD-D12 | `ontology:calls` | *(nothing)* | **false negative** — `calls` gets no spec ruling despite MD-D12 |
| MD-D8/9/10/11 | `ontology:{implements,exports,overrides,instantiates}` | own type only | correct |
| MD-D1..MD-D6 | bare node types (`atx_heading`, `html_block`, `section`, …) | — | `handled_verified` decisions, not relationship rulings |

The false positive is observable in the committed log:
`logs/arbiter-run4-full-checkpoint.stdout` prints
`contains  RULED-SOUND  … Written ruling: script/m14/spec/markdown-completeness.json#MD-D7`,
an `extends` decision cited as the justification for `contains`. It only became reachable
through MD-ARB-1 — with `contains` tallying 0 on that run the gate fell through to the spec —
which is why the two defects had to be found together.

**This one moves the verdict in the opposite direction to MD-ARB-1**, which is why neither is
visible from the other: MD-ARB-1 under-reports emission, MD-ARB-3 over-reports justification.
The false negative is currently masked by this lane's own table — `calls` is row 6 of
`MARKDOWN_RULED`, and the table is checked first — so it is the lane's table, not the spec,
that keeps `calls` honest.

The fix is to read the declared subject instead of the prose: `dec.node_type ===
\`ontology:${t}\``, keeping the prose scan only as a fallback for specs predating the field
and logging that the fallback fired, so a prose-matched ruling stays distinguishable from a
declared one. All twelve of this lane's decisions already carry `node_type`, so the fallback
would never fire here. Affects every lane: the loop is language-agnostic.

**What made four invocations necessary**, recorded because it is what exposed MD-ARB-1:
**14 distinct corpus files trap the WASM parser with `memory access out of bounds`**, and each
run dies at `[BB-HANG]` ~120s after the first one it meets — naming a file that had *already*
failed fast, because `src/ast/engine.ts:1410` arms the 120s bomb and `:1416 clearTimeout` runs
only when parse RETURNS, so a trap that throws past it leaves the timer armed. The four runs
died naming four different files. **The checkpoint finished 17,456/17,456 with 0 `!` bad
markers, so none of the 14 is permanently unparseable** — the trap is load-dependent (load
average 18.1 on 8 cores, 2 GB RAM available, disk 94% full, ten lanes sharing the machine),
which is the same finding as the heap cliff recorded below.

**Why the four probes below still stand in for the arbiter.** Not because it fails, and not
because of MD-ARB-1: because the arbiter's own counts cannot be compared against a
whole-population figure until MD-ARB-1 is fixed, and because MD-ARB-2 means the denominator it
prints beside every A ruling is 24 node types short of this corpus's grammar. The adjudication
below applies the arbiter's two instruments to the whole admitted population and states its
own denominators.

### Verdicts

| Type | Verdict | Edges (whole corpus) | Files | Instrument / probe |
| --- | --- | --- | --- | --- |
| `contains` | **EMITTED** | 334,773 | 14,507 | production `parseFile` |
| `uses` | **EMITTED** | 270,779 | 9,915 | production `parseFile`, per destination class |
| `references` | **EMITTED** | 16,857 | 1,136 | production `parseFile` (relabelled from `uses` — see below) |
| `imports` | **EMITTED** (MD-G3) | 105 | 74 | production `parseFile`; 1 per file-naming include directive |
| `calls` | **RULED** by the analyzer | **0 from the analyzer**; 8 from shared machinery | 2 | A: grammar inventory (108 node types, whole population), plus the fenced-code and `html_block` populations |
| `exports` | **RULED** | 0 | 0 | A + B: shape and population |
| `extends` | **RULED** | 0 | 0 | A: grammar inventory |
| `implements` | **RULED** | 0 | 0 | A: grammar inventory |
| `overrides` | **RULED** | 0 | 0 | A: grammar inventory, plus 570 redeclarations / 0 displacements |
| `instantiates` | **RULED** by the analyzer | **0 from the analyzer**; 3 from shared machinery | 1 | A: grammar inventory, plus the `html_block` capitalised-tag population |

**4 of 10 EMITTED by the analyzer, 6 RULED**, all ten types listed. Population: 17,456 files
across 196 repositories, `populationSha256` `1d079c4fff2092ce`, every file parsed, 0 parse
failures.

**The `calls` and `instantiates` rows carry a second number on purpose.** Production
`parseFile` returns 8 `calls` and 3 `instantiates` edges on this corpus, and **100% of them
are `src/ast/pool-worker.ts extractFallback` output on a degraded parse** — a regex over the
file TEXT reading JavaScript inside fenced code blocks in redwoodJS documentation
(`useMutation`, `hashPassword`, `new NhostClient()`), every source the literal `"this"`,
confidence 0.5/0.6, `evidenceClass` absent. `real-markdown-analyzer.ts` contains no `Calls`
and no `Instantiates`. The attribution is an accounting identity rather than a resemblance:
calling `extractFallback` directly on the files the census names reproduces `calls=8`,
`instantiates=3` and 50 kind-less symbols exactly, and the fallback emits exactly two
relationship types, so `degradedParse.relationships == calls + instantiates` in both census
runs (11 = 8 + 3, and 36 = 33 + 3). See "**The degraded set, and the 11 edges that are not
this lane's**" below and `validation/m60/markdown/fallback-attribution.json`.

**Why that matters for the coverage number.** The arbiter's `EMITTED` test is "production
`parseFile` produced it", and it checks emission BEFORE it reads a ruling. So on this corpus
the arbiter would print `calls` and `instantiates` as EMITTED and never reach the two
`soundest` rulings in the table. Coverage is therefore reported as **4 EMITTED + 4
RULED-SOUND = 8 adjudicated types, plus 2 types whose EMITTED status is a shared-machinery
artifact** — and the adjudicated run's own line is `emitted 6/10  ruled-sound 4  FALSIFIED 0
ruled-without-justification 0` (`validation/m60/markdown/ruling-table-adjudication.json`).
Neither number is the lane's coverage on its own; the attribution is what separates them.

Three rows moved since this section was first written, and each movement is recorded below
with the measurement that caused it rather than adopted silently:

- **`references`** was RULED and is EMITTED. The relabelling was made concurrently in
  this worktree and is reasoned in full below.
- **`imports`** was RULED and is EMITTED (**MD-G3**). The ruling was measured and it was
  wrong: it reasoned from the cross-file LINK population, where it was right, and never
  measured the construct `imports` names. Section "**`imports` — RULED, then GAP, then
  EMITTED**" carries the measurement, the implementation and the three forms the corpus
  uses.
- **`calls`** was absent from this table entirely — nine rows for ten types — and is added.
  It was ruled and documented in prose further down; a verdict that is not in the table is
  a verdict a reader cannot check.

### The ruling table the arbiter needs, and the one line that wires it

`script/m14/markdown-ruled.ts` exports `MARKDOWN_RULED`: the six un-emitted types, each
with its instrument, the probe's measured count and the condition that would overturn it.
It is a separate module because `ontology-coverage-gate.ts` is shared (§8), and the wiring
is one import and one `RULED_BY_LANG` entry:

```ts
import { MARKDOWN_RULED } from "./markdown-ruled"
const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, markdown: MARKDOWN_RULED as Ruled[] }
```

The wiring **is** in this branch now, as its own commit (`94e7e4101`, "wip(m60): wire
MARKDOWN_RULED into the arbiter's RULED_BY_LANG") so it can be dropped independently if the
supervisor prefers to land it centrally. `ontology-coverage-gate.ts` is shared (§8) and the
brief for this round asks each lane to apply exactly this edit, so it is applied rather than
only described; it is one import and one map entry and nothing else.

**An earlier version of this section claimed the arbiter's verdict table for markdown was
"pasted below". It was not, and could not be.** With the wiring applied the arbiter was run
twice on the wired table and both runs died before printing a row:

| run | admitted files | exit | last thing it said |
| --- | --- | --- | --- |
| 1 | 15,234 | 1 | `[BB-HANG] parser stuck 120s on Grace/sdk/generated/matrix/openapi-generator/rust/docs/DiffDto.md — exiting` |
| 2 | 15,234 | 1 | `[BB-HANG] parser stuck 120s on FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md — exiting` |

Each run also reported three or four `[BB-PARSE-ERR] … memory access out of bounds` on files
that are **disjoint** between the two runs, and every one of the six parses alone in
60–2,678 ms, and eight concurrent `parseFile` calls on them trap 0 times in 16 parses. So
the trap is a function of concurrency and load, not of a file, and no file-level workaround
exists at this lane's level. The arbiter's verdict for markdown on this corpus is
**unavailable**, and the substitute is named below rather than papered over.

Without the wiring the arbiter would instead have parsed the whole corpus and exited 2 with
`no RULING TABLE for markdown`, which is the gate refusing to guess correctly rather than a
verdict about markdown.

Two further §8 items the same run established, both needed before a `references` or an
`imports` edge can be *audited* rather than merely stored:

1. **`script/m14/differential.ts` compares markdown on `["contains", "uses"]`.** The
   harness filters the ANALYZER side by that allowlist and does **not** filter the truth
   side, so a label the oracle derives and the allowlist omits reads as MISSING — the trap
   the comment beside that line describes, and the shape `scss cov=0 (0%) MISSING=45`
   took. Measured with the label omitted: **770 MISSING** on a 60-file kubernetes draw.
   With `references` added: **MISSING=0, covered 8,495/8,495 (100%)**. With `imports`
   added as well the same draw reads MISSING=0. The list needs `["contains", "uses",
   "references", "imports"]`, and the comment on that line — "the lane emits no
   `references`" — is now false and says so.
2. **`script/m14/spec/markdown-completeness.json` had no `resolution` field on any
   decision**, so the arbiter's `rulingFor()` — which reads `dec.resolution` — found no
   written ruling for any type and would have reported all six `RULED-UNJUSTIFIED` even
   with the table wired. Six decisions were added (MD-D7…MD-D12), one per un-emitted type,
   each carrying its instrument and overturn condition. `differential.ts` and the arbiter
   both belong to the supervisor; this lane's own spec file did not, and is fixed here.

### A CORRECTION to this lane's own instrument A, found by a concurrent probe

`construct-probe.ts` instrument A walks the **BLOCK tree only**, and its header claimed it
enumerated "every node type BOTH pinned grammars actually produce". It did not: the 47
types it recorded are block types, and the companion inline grammar — `inline_link`,
`uri_autolink`, `email_autolink`, `code_span`, the three reference-link forms, `image` and
the rest — was never visited by that walk.

`validation/m14/fixtures/markdown/pass2-labelling-probe.ts` (written concurrently in this
worktree) records the union over a 1,200-file draw, `sha256=3aed69be…`: **82 distinct block
node types, 59 distinct inline, 104 in the union.**

**And 104 is itself a draw, not the corpus.** `ruling-table-adjudication.ts` enumerates the
union over the WHOLE admitted population — all 17,456 files, both grammars, 8 shards, 0 parse
failures — and gets **108 distinct node types: 84 block, 65 inline**. The draw misses exactly
four the corpus has: `numeric_character_reference`, `<?`, `<![CDATA[` and `]]>`. Three are
punctuation tokens of raw HTML passthrough; one is a real grammar node. None expresses any
construct an A ruling rules on, so no ruling moved — but the denominator a ruling is argued
against has to be the population's, and the population's is **108**.

**The direction of those rulings is unchanged and the reason is stated rather than assumed:**
the constructs they name — a type declaration, a supertype or implementation clause, an
object-creation node, an export node, a reference node — are absent from the union, and the
inline grammar models formatting and links, which is where they would have had to be. But
the claim "0 of 47" was made against a list that was not the list its own header named, and
that is a measurement error worth recording rather than a wording slip. The remaining rulings
should be read against **108**.

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

### The degraded set, and the 11 edges that are not this lane's

This is the round's substantive finding, and it is not a markdown finding — it is a
`pool-worker.ts` finding that markdown is the first lane to measure at corpus scale.

`whole-corpus-census.ts` now records `degradedParse` from the `fallback` flag itself, because
`extractFallback` returns `errors: []` and a degraded parse is therefore **indistinguishable
from a clean one to any consumer reading `errors`**. That is why the first whole-corpus run
reported `parseFailures: 0` while carrying 36 edges no analyzer emitted.

| | run A | run B |
| --- | --- | --- |
| shards | 24/24, 0 lost | 24/24, 0 lost |
| population | `1d079c4fff2092ce` | `1d079c4fff2092ce` (identical) |
| files parsed | 17,456 / 0 failures | 17,456 / 0 failures |
| symbols / relationships | 394,804 / 622,586 | 394,765 / 622,525 |
| files that took the fallback | not recorded | **11 (0.0630%)** |
| kind-less symbols | 99 | 50 |
| `calls` / `instantiates` | 33 / 3 | 8 / 3 |

**The degraded set is not reproducible.** Same population hash, same admission test, same
production entry point — 11 files in one run, a different set in the other, and `calls`
between 8 and 33. `whole-corpus-census.ts` therefore cannot report a `calls` count for this
corpus that a reader can reproduce, and this document does not quote one as if it could: the
figure is reported as a range with the run it came from.

**The attribution is reproducible even though the set is not.**
`validation/m14/fixtures/markdown/fallback-attribution.ts` takes the census's own list of
degraded files, calls `extractFallback` on each, and compares:

```
calls         census 8   reproduced 8   identical
instantiates  census 3   reproduced 3   identical
kind-less     census 50  reproduced 50  identical
relationshipIdentity: fallbackRelationships 11 == calls 8 + instantiates 3
```

and then runs production `parseFile` on the same files to record what it returns when it is
NOT degraded: no `calls`, no `instantiates`, `fallback` unset. The three facts together —
the analyzer's source contains neither type, the fallback reproduces the counts exactly, and
the clean path emits neither — are what make this an attribution rather than a correlation.

**What a reader of the graph gets if this is not fixed.** A `calls` edge whose source is the
string `"this"` and whose target is a JavaScript function name that no markdown file
declares. `bb_graph` would show a document calling `useMutation`; `bb_impact` would offer to
change that caller. The fabricated-edge failure the brief names, reached here through shared
machinery rather than through a lane's own invention.

**What is NOT this lane's to fix, precisely** (§8):

- `file`: `src/ast/pool-worker.ts`
- `fn`: `extractBasicRelationships` (line 266), reached via `extractFallback` (line 364) from
  `parseFile`'s size early-return (line 751) and its `catch` (lines 1148, 1150)
- `must do`: either (a) skip `calls` / `instantiates` when the detected language is not a
  programming language — the same shape as the existing `keepSymbol` exemption at line 434,
  which already special-cases `markdown` — or (b) return the fallback's own result with
  `errors: [{ message: "degraded: regex fallback" }]` instead of `errors: []`, so a consumer
  can tell. (a) alone leaves the invisibility; (b) alone leaves the fabricated edges.
  Both are one-line changes.
- `why`: `extractBasicRelationships` reads `/(\w+)\s*\(/g` over the file text, and for a
  documentation file that text is fenced code in another language. Every language with fenced
  code in its corpus has this, so the fix is not markdown-specific — which is why it belongs
  to the supervisor and not to a lane.
- `not this lane's alternative`: the markdown analyzer cannot suppress these edges. They are
  added after `analyze()` returns, by `filterNoiseRelationships` on a result the analyzer
  never sees.

### The six rulings, each with its instrument, probe and overturn condition

**`imports` — RULED, then GAP, then EMITTED (MD-G3).** The ruling was measured and it was
wrong, and the way it was wrong is the exact shape the workstream warns about: it reasoned
from the population that was easy to count instead of the population the type names.

The ruling argued three things. All three are recorded below because two of them are true
and the third was load-bearing.

1. *Relative link destinations are not the construct.* **True, and measured**: 1,797
   relative destinations in 338 files on a 1,200-file draw, of which 968 resolve to a
   tracked file in the same repository and **829 (46.1%) do not**. A shape that is 46.1%
   broken links is not a dependency population, and the arbiter's own note is the test
   that caught it — *"a probe that matches a SHAPE rather than a ROLE produces a number,
   and the number is worth nothing."*
2. *A per-file analyzer cannot check existence.* **True**: `PROJECT_INDEX_EXTENSIONS` in
   `src/ast/parallel-indexer.ts` carries one entry, `{ ".sol": "solidity" }`, so
   `context.projectIndex` is `undefined` for markdown in production.
3. *Reading an include directive means parsing a paragraph's characters, which the
   zero-regex property forbids.* **This is what failed, and it is false.** The rule the
   lane actually holds is zero **regex literals**, and a character-code scan is not one —
   `stripAngleBrackets`, `stripAtxClosingSequence`, `anchorSlug` and `decodeFragment` are
   all character-code scans and all four predate this round. MD-G2's `plus_metadata`
   ruling is unaffected: that construct needs the grammar to instantiate a node it never
   instantiates, which no amount of character-code reading can supply. This one does not
   need a node, because Liquid's `{% %}` is an OUTPUT delimiter rather than a block
   construct.

**The measurement that overturned it.** A whole-corpus scan of every `{% … %}` directive
in all 12,729 admitted files, by argument shape:

| form | count | names a file? |
| --- | --- | --- |
| `{% include type t="Number" %}` and 90+ other macro forms | 1,030+ | **no** |
| `{% include-markdown "includes/<file>.md" %}` | 53 | **yes** |
| `{% include properties.md %}` | 12 | **yes** |
| `{% include table-of-contents.yml %}` | 1 | **yes** |
| `{% include docs/elements/primary-colors.html %}` | 1 | **yes** |
| `{% include docs/elements/background-foreground-row.html %}` | 1 | **yes** |

**68 directives name a file.** A Jekyll `include` reads that file from disk at build time
and splices it into the output; Jekyll's own documentation for `{% include_relative %}` is
explicit that the path resolves relative to the including page. That is a file dependency
whatever the grammar calls it — and the grammar calls it nothing, because `{% … %}` at the
start of a line is an ordinary paragraph. It is the same structural fact the JSON lane's
`$ref` probe records: **a grammar cannot see a construct spelled as a string.**

**What is published, and the 15:1 ratio that disciplines it.** One `imports` edge per
file-naming directive, sourced at the heading the directive sits under, at the DIRECTIVE's
line, with `confidence: 1.0` and `evidenceClass: "import_based"`. Nothing else. The
discriminator is a **closed extension list** — `md`, `markdown`, `html`, `htm`, `txt`,
`yml`, `yaml`, `json`, `toml`, `svg`, `png`, `jpg`, `jpeg`, `gif`, `csv`, `ini`, `conf`,
`pdf` — because the corpus carries 1,030+ macro calls that name no file and an
implementation that published every `{% include %}` would add roughly fifteen fabricated
endpoints (`Number`, `5.0`, `page.spec`) for every real one. Those are forbidden by name in
`markdown/template-include-imports`, and the mutant
`markdown/template-include-macro-published` re-introduces them to prove the fixture can
fail.

**Three forms, three call sites.** A quoted argument with a joined directive name
(`include-markdown`, 53 of 68), a bare argument (`include`, 14), and a directive inside a
**heading** (`include_relative`, 1). The third is pinned separately because the main walk
`continue`s on a heading and never reaches its `inline` child — the same structural blind
spot as MD-DEFECT-1, one level up and for the other reason.

**Declared limitation.** 0 of the 68 were checked for existence. The edge publishes the
path the author wrote and asserts nothing about whether the file is there; that is what
`confidence: 1.0` means here (how the edge was derived), not that the path resolves. The
`imports` array in `ParseResult`, which was declared and permanently empty, now carries the
same 68 as `ImportInfo` — the convention the html lane already follows.

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
The measurement is `validation/m60/markdown/pass2-labelling-probe.json` and the reasoning is
in the fixture's own `rationale`; this lane's `references`-is-RULED verdict is superseded by
it.

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

They fail independently, so they are reported per type and not as one verdict.

**The figures below are WHOLE-POPULATION**, not a draw: production `parseFile` over all
17,456 files the gate's admission test admits, across 196 repositories, `populationSha256`
`1d079c4fff2092ce`, 0 parse failures, 0 shards lost
(`validation/m60/markdown/whole-corpus-census.json`). The earlier 400-file and 1,200-file
draw figures are superseded and are not averaged with these. `imports` is a fourth column
because it is emitted too and the three-column table omitted it.

| | `contains` | `uses` | `references` | `imports` |
| --- | --- | --- | --- | --- |
| **1. Exists** | yes — five `addRel` call sites | yes — three (inline destination, autolink, reference link / reference-form image) | yes — the resolved-anchor arm, relabelled from `uses` | yes — the file-naming include directive (MD-G3) |
| **2. Fires** | **334,773** edges / 14,507 files | **270,779** / 9,915 | **16,857** / 1,136 | **105** / 74 |
| **3. Correct** | 1,092/1,092 scala3, 8,499/8,499 kubernetes, MISSING=0, unexplained=0 | same rows | same rows, and MISSING=770 → 0 once the allowlist names it | 0 unexplained; **never in the compared set at all** — and measurably so: **1 edge in 1 file** across the differential's own 1,331-file corpora, **0 in kubernetes** |
| **4. Labelled** | correct — no neighbouring type applies to intra-document containment | correct — 269,245 `markdown_link` + 1,534 `markdown_autolink` | correct — 16,857 `markdown_internal_anchor`, 0 rows under any other role | correct — 105 `markdown_template_include`, `import_based` |
| **5. Resolved** | **334,773/334,773 (100%)** both ends file-local; 333,479 (99.6%) corpus-wide | **1/270,779 (0.0%)** both ends file-local; **258 (0.1%)** corpus-wide — by construction, the target is link text | **16,857/16,857 (100%)** file-local; 6,608 (39.2%) corpus-wide | **82/105 (78.1%)** source; **0/105** target — the target is a PATH |
| **6. Confident** | 334,773 at 1.0, `structural`, 100% line-numbered, **0 below 0.7** | 270,779 at 1.0, `reference_qualified`, 100% line-numbered, **0 below 0.7** | 16,857 at 1.0, `reference_qualified`, 100% line-numbered, **0 below 0.7** | 105 at 1.0, `import_based`, 100% line-numbered, **0 below 0.7** |

**Whole-corpus hygiene, all four types together**: 394,765 symbols, **0** with an empty
name, **0** endpoints equal to the literal `unknown`, **0** kinds outside the shared
`SymbolKind` other than the 50 that arrive on the 11 degraded files (below), and **0** parse
failures. Every one of the 622,525 relationships is line-numbered.

**Every heuristic edge in this lane is shared machinery's.** The whole population carries
**11 edges below confidence 0.7** — 8 `calls` at 0.5 and 3 `instantiates` at 0.6 — and all
11 are `extractFallback` output on 11 degraded files. The analyzer's own four types emit
**0** edges below 0.7 out of 622,514. That is the honest shape of this lane's confidence
distribution: it is not that nothing here is guessed, it is that nothing the ANALYZER emits
is guessed.

**1 Exists** — derived from source. `contains` has five call sites (`heading_hierarchy`,
`table_under_heading`, `table_column`, `code_block_under_heading`, and the front-matter
symbol which carries no edge); `uses` has three after the split (`link_destination`,
`uri_autolink`/`email_autolink`, reference link and reference-form `image`);
`references` has one (the resolved-anchor arm, line 591).

**2 Fires** — measured above. The stronger form of this question is the edge-recall probe,
because "it produced an edge" does not mean "it produced all of them". See the recall
section below: **analyzer shortfall against the parse tree is 4 edges in 7,630.**

**3 Correct** — `npx tsx script/m14/differential.ts --lang markdown`, this round, 2 lanes x
60 files:

```
as shipped     [scala3]     markdown: files=60 tree-truth=1092 covered=1092 (100.0%) MISSING=0    | analyzer-edges=1092 unexplained=0 (0%) heuristic=0
               [kubernetes] markdown: files=60 tree-truth=8499 covered=7729 (90.9%) MISSING=770 | analyzer-edges=7729 unexplained=0 (0%) heuristic=0

allowlist +2   [scala3]     markdown: files=60 tree-truth=1092 covered=1092 (100.0%) MISSING=0    | analyzer-edges=1092 unexplained=0 (0%) heuristic=0
               [kubernetes] markdown: files=60 tree-truth=8499 covered=8499 (100.0%) MISSING=0    | analyzer-edges=8499 unexplained=0 (0%) heuristic=0
```

**The 770 MISSING rows are one allowlist entry, not 770 missing edges.**
`script/m14/differential.ts:23392` compares markdown on `["contains", "uses"]` while
`deriveMarkdownEdges` also derives `references`, so 770 analyzer rows were dropped from the
COMPARED set and read as MISSING. Adding `references` and `imports` to that one array gives
MISSING=0 and 100% coverage on both lanes with `unexplained` and `heuristic` unchanged at 0.
The shared file was patched for that measurement and restored — `git diff` on it is empty —
and the log is `validation/m60/markdown/logs/differential-allowlisted-local.log` beside the
as-shipped `differential.log`.

The samples confirm it by hand: all 770 are `references document -> <link text>` from
kubernetes CHANGELOGs, and `CHANGELOG-1.11.md` line 2 (`- [v1.11.10](#v11110)`) yields
`references document -> v1.11.10 role=markdown_internal_anchor` from the analyzer. The edge
was always there.

9,591 oracle rows, 0 unexplained, 0 heuristic. A scoped run refuses to write `M14.0.F5.json`,
correctly: that artifact belongs to the 43-language sweep and writing it from a two-corpus
run would replace the milestone's claim with a smaller one.

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

### DERIVATION findings: 2 — `references` and `imports`

**Corrected 2026-10-05. This section previously read `DERIVATION findings: 0`, and both
reasons it gave for the 0 were false.** It is kept in the corrected form rather than
quietly overwritten because the error is instructive: it was a number produced by reading
the oracle instead of the allowlist.

A DERIVATION finding is a type the analyzer emits that the differential never audits. What
is in the compared set is fixed at `script/m14/differential.ts:23392` — the allowlist, not
the oracle:

```ts
...(lang === "markdown" ? ["contains", "uses"] : []),
```

`script/m14/markdown-oracle.ts` derives all four the analyzer emits — `contains`
(:375/:462/:471/:503), `references` (:530), `imports` (:635), `uses`
(:702/:708/:729/:741) — and the previous text treated that as sufficient. It is not: the
allowlist is what puts a kind in the COMPARED set, and it names two. The adjacent comment
in the shared file asserts the lane "emits no `imports` (markdown has no module system) and
no `references` (front-matter keys are a declared boundary, not a graph)", which is false
against the census — `imports` is 105 edges over 74 files and `references` is 16,857 over
1,136. `git log -S'lang === "markdown" ? ["contains", "uses", "references"]' --
script/m14/differential.ts` returns **no commit**: no relabelling ever added it.

So emitted = 4, oracle truth = 4, compared = 2, and the gap is **2**:

| type | analyzer edges, whole admitted population | analyzer edges on the differential's OWN corpora | in compared set | consequence, measured |
| --- | --- | --- | --- | --- |
| `references` | 16,857 / 1,136 files | **10,172 / 76 files** (kubernetes 10,055 / 58, scala3 117 / 18) | no | **770 MISSING on kubernetes** — `logs/differential.log` |
| `imports` | 105 / 74 files | **1 / 1 file** (scala3 `docs/_spec/index.md`; kubernetes **0**) | no | **compared against nothing in practice** |

The corpora column is the part that had to be measured and could not be read
(`differential-corpora-tally.ts`, `differential-corpora-tally.json`: 1,331 files,
1,331 parsed, 0 failures, upper bound on any 60-file rotating draw). The two findings are
not the same severity, and the difference is the whole point:

- **`references` is reachable.** 76 of 1,331 files carry one, the pool draws from the same
  population, and it demonstrably does — that is where the 770 come from. Its exclusion is
  therefore **loud**: the truth exists, the analyzer rows exist, the allowlist drops the
  analyzer side, and the shortfall reads as MISSING. A gate that can fail is failing.
- **`imports` is effectively unreachable.** One edge, in one file, in one corpus, and
  **zero in kubernetes**, which is where the differential spends half its draw. An oracle
  can be complete over a kind no sample ever contains, and then the kind is audited in the
  sense that a light exists and nobody is standing under it. This is the strict sense of the
  word: stored and compared against nothing.

Both are fixed by adding `"references"` and `"imports"` to that one array literal — measured
at MISSING=0 and 100% coverage on both lanes with `unexplained` and `heuristic` unchanged at
0 (`logs/differential-allowlisted-local.log`). The file is shared (§8), so it is reported
here and **not edited**; `git diff script/m14/differential.ts` is empty.

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
    hang, and — now fixed on this branch — the absence of a `markdown` entry in the gate's
    `RULED_BY_LANG` table. With the wiring applied the arbiter was run twice and died at the
    first cause both times, before printing a row, on two different files. The gate's verdict
    for markdown is therefore **unavailable**, not favourable: the table it would have read
    is exercised by `validation/m14/fixtures/markdown/ruling-table-adjudication.ts` instead,
    which transcribes the gate's own four-way decision and runs it over the whole admitted
    population against the same `script/m14/markdown-ruled.ts` the gate imports.
16. **Four grammar-level parse errors and one hang** are recorded rather than attributed to
    the analyzer. This round measured the class rather than listing instances: two runs, six
    distinct files, **zero overlap**, every one parsing alone in 60–2,678 ms, and 0 traps in
    16 concurrent `parseFile` calls over those same six. The trap needs concurrency and load,
    so it is not a property of any file and no file-level exclusion can remove it.
17. **One edge-recall delta is not decomposed**: 1 of 7,630 pre-filter edges in a 200-file
    draw, cause unknown. Recorded in `validation/m60/markdown/edge-recall-probe.json` rather
    than rounded away.

## Verification

Each row is a gate that can FAIL. The "teeth" line is the part that matters — an instrument
nobody has watched fail is a claim.

- **Fixtures (F3)** — **10 in `validation/m14/fixtures/markdown/`**, each authored from the
  contract rather than transcribed from analyzer output. `npx tsx script/m14/run-fixtures.ts
  --lang markdown` → **10 pass / 0 fail**. **This document previously said 4; there were 8
  before the first round, 9 after it, and 10 after MD-G3, and the 4 is corrected here.**
  **Teeth:** with the setext fix reverted the suite reads **8 pass / 1 fail**; with MD-G3's
  extension test removed it reads **9 pass / 1 fail** (`markdown/template-include-imports`).
  Two fixtures are honest about not being independently authored and say so in their own
  `_authoringNote`: `template-include-imports`'s expectation rows were written from the
  analyzer's output because the construct has no CommonMark specification to author from,
  and its `forbidRelationships` half — the 1,030+ macro calls that must NOT publish — is the
  part that can catch a fabrication.
- **Lane mutants (F4)** — **15 in `script/m60/markdown-mutants.ts`, 15/15 CAUGHT this
  round**, each a faithful revert of one real decision, written generically off the emitted
  fields rather than off a name list.
  **They do not run in the project gate, and that is now a measured gap rather than an
  assertion.** `script/m14/mutate-analyzer.ts` builds its `MUTANTS` array from six other lane
  modules and does not import this one, so `bun run script/m14/mutate-analyzer.ts` never
  constructs a markdown mutant. Registration is a one-line shared-file change (§8), so
  `validation/m14/fixtures/markdown/mutant-battery.ts` runs them here through `runLang()`
  imported from `script/m14/run-fixtures.ts` — the arbiter's own matcher, not a
  reimplementation. Result: **baseline 10 pass / 0 fail, then 15/15 CAUGHT.** The teeth are
  the fan-out: `markdown/line-number-dropped` takes the suite 0 → 8 failures,
  `markdown/closing-run-retained` and `markdown/empty-heading-published` 0 → 7 each,
  `markdown/repeat-site-name-collapsed` 0 → 5. A mutant set that could only be caught one way
  would be a weaker claim than this.
  **Two mutants change no endpoint and no count.** `internal-anchor-published-as-uses` only
  moves a label, and `template-include-macro-published` only ADDS edges; between them they
  are the only mutants that can catch a mislabel and a fabrication.
  **Teeth:** `markdown/internal-anchor-unresolved-kept` **SURVIVED its first run**, and that
  is the row that matters — the fixture named ONE broken fragment (`#no-such-heading`) and
  not the second (`#also-missing`), and had no row at all for the forward reference's raw
  fragment. Three `forbidRelationships` rows were added to close it and the mutant now reads
  CAUGHT. The mutant also had an off-by-one that produced `##install-now` and matched nothing;
  that is recorded in its own comment.
  **This document previously said "10, all caught" against the SHARED registry, which holds
  0 markdown mutants, and pointed at a file path that does not exist. Both retracted: the set
  lives at `script/m60/markdown-mutants.ts` and holds 15.**
- **Differential (F5)** — RESTATED for 2026-10-03, because the earlier figures did not
  reproduce on this corpus and the reason belongs in the record. 60-file rotating draws:
  `scala3@18df09c0` (738 tracked `.md`) reads **MISSING=0, unexplained=0** over 1,092 truth
  rows; `kubernetes` (**596** tracked `.md, not 595**) reads **MISSING=0, unexplained=2**
  over 8,495 truth rows at 100% covered. The earlier "12,844 rows, 0/0 across both
  corpora" is a different rotation (`--sample 120`) and is not restated as current. The 2
  unexplained are MD-DEFECT-2: the oracle shared the setext defect, so the differential was
  blind to it until the analyzer side was fixed — see the pass-2 section.
  **These figures are CONDITIONAL on the §8 wiring, and this round measured both sides of it
  again.** With `script/m14/differential.ts`'s compared-label allowlist as it stands
  (`["contains", "uses"]`), `--lang markdown` on this round's 60-file rotation reads
  **MISSING=770** on kubernetes (covered 90.9%) and MISSING=0 on scala3 (covered 100%). With
  `references` and `imports` added to that one array: **MISSING=0 and 100% covered on both**,
  `unexplained=0` and `heuristic=0` unchanged, 9,591 oracle rows. The shared file was patched
  only for the measurement and restored; `git diff` on it is empty. Logs:
  `validation/m60/markdown/logs/differential.log` (as shipped) and
  `differential-allowlisted-local.log` (patched).
  **And its limit, which no amount of differential testing removes:** it could not see the
  setext defect while the oracle shared it, and it cannot see a shared misreading of
  Liquid's tag syntax behind MD-G3. The whole-repo oracle census is the instrument that
  does not depend on a 60-file rotation: **unexplained = 0** on both corpora, all four
  labels, every markdown file.
  **Teeth:** the same oracle run against the PRE-FIX analyzer reports `MISSING=127`
  (scala3) and `MISSING=67 + unexplained=5` (kubernetes) with no hint given.
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

## M60 pass 2 — the six questions, asked adversarially

The first round answered the six questions to establish the verdicts. The second asks each
of them for a case where it is WRONG, and the instrument that can answer "correct" over a
whole repository rather than over a rotating 60-file draw is
`validation/m14/fixtures/markdown/oracle-census.ts`, which imports the independent oracle
and the production `parseFile`, matches them with the differential harness's own exported
`normTarget`, and reports per label over **every** markdown file of a repository.

### Correct — 0 unexplained, and 458 missing rows that are not this lane's

| repo | files | oracle rows | analyzer edges | `contains` missing | `uses` missing | `references` missing | `imports` | **unexplained** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `kubernetes` | 596 | 38,255 | 90,938 | 158 / 5,760 | 62 / 28,938 | 74 / 3,557 | 0 | **0** |
| `scala3` | 738 | 9,072 | 11,382 | 153 / 4,335 | 7 / 4,650 | 4 / 86 | 1 / 1 | **0** |

`unexplained = 0` on both corpora across all four labels: every edge the analyzer publishes
has an independent counterpart, and every oracle row is accounted for.

**The 458 missing rows are deleted by shared machinery, and each is attributed to the rule
that deletes it** (`oracle-census.json`, `missingBySharedSanitizerRule`):

| rule | kubernetes | scala3 | example |
| --- | --- | --- | --- |
| `leaf-starts-with-space` | 117 | 70 | `CVE-2021-25735: Validating Admission Webhook …` — a colon in a heading |
| `leaf-longer-than-80` | 86 | 7 | a URL-bearing heading or destination over 80 chars |
| `leaf-carries-brace-angle-or-backtick` | 74 | 87 | `` `given` clause comes last `` |
| `leaf-empty` | 12 | 0 | `RuntimeClass feature graduates to General Availability.` — a trailing stop |
| `target-longer-than-200-or-has-newline` | 5 | 0 | a heading over 200 characters |
| **not attributed** | **11** | **0** | — |

The mechanism is `filterNoiseRelationships` in `src/ast/pool-worker.ts`, which runs on the
production `parseFile` path and applies a UNIVERSAL **identifier** sanitizer to every
relationship target, exempting only json/yaml/hcl/terraform/graphql and two path-shaped
bash labels. Its `extractLeaf(target)` splits a target on `:` and keeps the last segment —
correct for a qualified identifier (`ns::member`, `a.b`) and wrong for a **heading**, which
is the author's prose. A heading containing a colon yields the leaf `" Validating
Admission Webhook"`, and the rule `leaf.startsWith(" ")` then rejects it.

The smallest reproduction is four lines, and it is a differential, not an argument:

```markdown
# A

## B

### Has: a colon in it     <- `contains: B -> "Has: a colon in it"` is DELETED

## D

### E
```

Change one character of that heading and the edge appears. The heading **symbol** survives —
the store keeps 26,378 symbols before and after the filter on this corpus — so the section
exists with no parent, and **any count taken after the filter cannot see the loss**. A second,
independent instrument (`edge-recall-probe.ts`, comparing the analyzer against node counts
on the pinned trees) reached the same total from the opposite direction: 119 deletions in a
200-file draw, bucketed `leaf-starts-with-space` 52, `leaf-brace-angle-backtick` 46,
`leaf-too-long` 21.

This is the same class as the bash exemption already in that file, whose own comment records
the measured cost when a path-shaped target was deleted by the brace rule. **§8 item:** the
fix belongs in `pool-worker.ts`, and the smallest correct form is to extend the existing
`declaredNames` escape — the file already has one, used so that a name the file DECLARES is
never treated as a tree-sitter accessor leak — from `NOISE_TARGETS` down to the leaf rules.
`markdown/CHANGELOG/CHANGELOG-1.18.md` alone loses 263 edges' worth of hierarchy.

### Exists / Fires / Labelled / Resolved / Confident, per role rather than per type

Resolution reported per TYPE is dominated by external URLs and says almost nothing about
whether a link edge is well-formed. Reported per `role` on a 1,200-file draw
(`pass2-labelling-probe.json`, 29,923 relationships):

| role | edges | both ends resolve | `line_number` | confidence | `evidenceClass` |
| --- | --- | --- | --- | --- | --- |
| `heading_hierarchy` | 8,339 | **100.0%** | 100.0% | 1.0 | `structural` |
| `table_column` | 1,891 | **100.0%** | 100.0% | 1.0 | `structural` |
| `markdown_internal_anchor` (`references`) | 1,107 | 44.9% both ends, **100.0% at the target** | 100.0% | 1.0 | `reference_qualified` |
| `table_under_heading` | 701 | 99.4% | 100.0% | 1.0 | `structural` |
| `code_block_under_heading` | 7,107 | 98.6% | 100.0% | 1.0 | `structural` |
| `markdown_link` (`uses`) | 10,709 | 0.0% | 100.0% | 1.0 | `reference_qualified` |
| `markdown_autolink` (`uses`) | 69 | 0.0% | 100.0% | 1.0 | `reference_qualified` |

Three readings a reader would get wrong from the per-type number:

- **`uses` resolving at 0.0% is not a defect and not a claim.** Its targets are URLs,
  autolinks and cross-file paths; nothing in any corpus declares `https://example.com`.
  Classified on the tree by the node's own text, the same draw gives 8,943 scheme
  destinations, 1,406 fragments, 1,325 relative and 131 absolute-path — four different
  relations, and the aggregate was the only number being reported.
- **The 44.9% on `references` is the `document` pseudo-owner, not a broken endpoint.** 610
  of the 1,107 name `document` as their source because the linking paragraph sits above the
  document's first heading. `parallel-indexer.ts` writes `source_symbol_id = NULL` with the
  name kept in `source_external`, which is nullable by design, and html, json, toml and yaml
  all use the same pseudo-owner and publish no `document` symbol either.
- **The 98.6% / 99.4% on the two block roles is the same `document` source**, and those are
  the counts the shared sanitizer's `leaf-*` rules then reduce further.

**Confident:** every edge on all four labels carries `confidence: 1.0`. The heuristic ratio
is therefore **0.0%** and is countable as zero, which satisfies honesty-contract §4 by
measurement rather than by assertion. Every edge carries a 1-based `line_number` above 0.

**Labelled — the strongest argument against each label, and what the corpus said:**

- `uses` → *should be `references`*, because it names an external resource. **Rejected**: the
  html lane publishes in-project navigation as `uses` at 0.9 and reserves `imports` for
  resources the page must FETCH. A markdown hyperlink is navigation.
- `references` → *should be `uses`*, because a `#fragment` is a link like any other.
  **Rejected on the resolution measurement**: it is the only edge class here whose target is
  a symbol the file publishes, 1,107 of 1,107, and css's `references` is the same shape.
- `contains` → *a heading's text is prose, not a declaration*. **Upheld and unchanged**: it
  is the document outline, and it resolves at both ends on 7,603 of 7,603.
- `imports` → *a template directive is not markdown*. **Upheld**: the construct is real and
  the grammar's silence is why it took a text rule; 68 sites is the population and the
  extension test keeps 1,030+ macro calls out.

### The cost of the two DERIVATION findings, and what it was mistaken for

A DERIVATION finding is a label the analyzer emits that the differential never audits. At
handover this lane had 0 and published 0 for several rounds. **It is 2** — `references` and
`imports`, for the reason and with the measurement in the DERIVATION section above. This
paragraph is left because the reason the 0 was believed is the interesting part: it was
believed because `script/m14/markdown-oracle.ts` derives all four independently, and that is
true and not sufficient. The allowlist at `script/m14/differential.ts:23392` is what puts a
kind in the compared set, and it names two of the four.

What the 0 concealed, per finding:

- **`references`** — the exclusion is loud rather than silent, and the lane had been
  reading the loud part as a different thing. 770 rows on kubernetes read as MISSING, which
  was recorded as "one allowlist entry, not 770 missing edges". That reading is correct
  about the *edges* and wrong about the *state*: the edges were never unaudited, they were
  audited and reported as a shortfall. The all-clear was inferred from a diagnostic that
  was in fact an open finding.
- **`imports`** — genuinely silent, and the silence is a property of the corpora rather
  than of the oracle: **1 edge in 1 file across 1,331 files, 0 in kubernetes**. So this one
  would have stayed hidden indefinitely, because there is no draw to expose it. The oracle
  work below is real and worth doing — it is what makes the kind auditable *in principle* —
  and it changed nothing observable, which is precisely the point: an oracle can be correct
  and the kind can still be compared against nothing.

The oracle changes this round were found by measurement rather than by reading, and both
were necessary to the fix above rather than sufficient to it:

- **`references`** had to be added to the oracle when the analyzer relabelled, or the new
  edges would have had no truth to be compared against at all.
- **`imports`** had to be derived from Liquid's tag syntax, independently written (the oracle
  splits the tag into `name`/argument triples; the analyzer sweeps character codes).

Adding both kinds to the oracle without adding them to the allowlist is what left the count
at a false 0 with a true-looking justification behind it.

**MD-DEFECT-2 — the oracle carried MD-DEFECT-1 too.** The oracle's heading lookup was a
direct-named-child scan, so it published nothing for a **setext** heading
(`setext_heading > paragraph > inline`, not a direct `inline` child) — the identical defect
the analyzer had, in the same place. The differential read **0 unexplained** throughout,
because both sides were silent. It became visible only because the analyzer side was fixed
FIRST: the whole-repo census then read **7 unexplained `uses` edges**, every one the link
and image destinations of a setext H1 badge banner
(`kubernetes/vendor/github.com/armon/go-socks5/README.md:1` and two siblings). That is the
workstream's structural claim made concrete inside one lane — two walkers over one grammar
agree when they share a bug — and the argument for fixing an oracle whenever the analyzer
is the side that changed. Both are fixed; `unexplained` is 0 again.

### Exists — one metadata field that could not fail

`metadata.headingCount` was assigned `headingStack.length` in the **return object**, so it
was the depth of the LAST heading's ancestor chain, which CommonMark caps at six. Measured
over the 1,200-file draw it took exactly the values 0, 1, 2, 3 and 4 (94 / 361 / 542 / 186
/ 17 files), maximum 4, against documents carrying hundreds of headings. Nothing in this
repository reads markdown's field — html's field of the same name has its own counter at
`real-html-analyzer.ts:754` — so it is now a count of published headings (**MD-L2**).

### Two measurements that were wrong, and are recorded because they were wrong here first

1. **Instrument A's denominator took two corrections to reach the corpus's, and the second
   one is this round's.** `construct-probe.ts` loads BOTH pinned wasms and its header claims
   instrument A enumerates "every node type BOTH pinned grammars produce", but its walk is
   over the BLOCK tree: the 47 node types it recorded are all block types, and `inline_link`,
   `uri_autolink` and `code_span` are absent. `pass2-labelling-probe.ts` fixed that to the
   **104-type union** over a 1,200-file draw — which was still a draw. This round's
   `ruling-table-adjudication.ts` measures the union over the whole 17,456-file population and
   gets **108** (84 block, 65 inline). The draw's four missing types are
   `numeric_character_reference`, `<?`, `<![CDATA[` and `]]>`; none affects a ruling, and every
   A ruling is now stated against 108 with the draw recorded as the superseded measurement.
2. **The `overrides` probe.** The bash probe — a second declaration of a name already
   declared in the file — returns 570 same-parent, same-level, same-text heading
   redeclarations in 23 files on markdown, and 2,453 repeated heading texts at any scope in
   50. Those are two sections sharing a title, not one replacing the other: both render, and
   the renderer's rule gives each a distinct anchor. Measured: 224 anchors in 61 files are
   held by more than one heading and **0 displace**. A probe that counts repeats would have
   FALSIFIED a correct ruling, which is the failure the arbiter's own header describes.

## Declared limitations

Not a blank list, and not a list of adjectives. Each item is a fact a consumer can check.

1. **Cross-file link targets are published verbatim and never resolved.** 1,325 relative
   destinations in a 1,200-file draw; 822 name a tracked file in the same repository and 503
   do not, and a per-file analyzer cannot tell them apart because production gives a markdown
   analyzer no project index (`PROJECT_INDEX_EXTENSIONS` carries `.sol` only). The same holds
   for the `imports` paths, and at whole-corpus scale that is **0 of 105 targets resolved** —
   because an `imports` target is a PATH (`includes/traefik-for-business-applications.md`,
   `properties.md`, `table-of-contents.yml`, `docs/elements/anchor.html`) and the graph's
   endpoint vocabulary is symbol NAMES. So `imports` needs a path-resolution tier in the
   graph/impact path, not a name-resolution one, and no fix inside this analyzer can supply
   it. A `bb_impact` reading of a markdown document therefore sees its cross-file references
   as external names, which is honest about what is knowable from one file and incomplete
   about the repository.
1b. **`references` resolves 100% file-local and 39.2% corpus-wide, and the gap is
   concentrated.** 16,857 edges, 6,608 binding to a heading name in some other file of the
   corpus. kubernetes alone contributes 10,055 of the 16,857, so the corpus-wide rate is
   mostly a statement about one repository's CHANGELOG TOC convention rather than about the
   type. Both numbers are reported for that reason and neither is presented as the type's
   quality on its own.
2. **`uses` edges to external URLs resolve at 0.0% and always will.** That is not a defect:
   nothing in any corpus declares `https://example.com`. A reader must not read the
   aggregate as a claim about the analyzer's endpoint quality — the per-role table above is
   the claim.
3. **The shared sanitizer deletes 1,765 edges per 1,200 files**, and no instrument inside
   `parseFile` can see it. Counts taken after the filter are lower than counts taken before
   it, and this document's own `parseFile` numbers are post-filter. The pre-filter figures
   are in `edge-recall-probe.json` and `oracle-census.json`.
4. **`imports` reads a construct the grammar does not model**, from the inline block's own
   text, by character code. The zero-regex property is kept — the regex census reads markdown
   at 0 — but this is the one place in the analyzer where a relationship is derived from a
   string rather than from a node, and a shared misreading of Liquid's tag syntax would be
   invisible to the differential in the way a shared misreading of a grammar always is.
   The corpus cannot express the syntax in a node position, so there is no stronger
   instrument available at this grammar version.
5. **An undefined reference link and an unresolved `#fragment` are invisible rather than
   flagged.** A reader cannot distinguish "this document has a broken reference" from "this
   document never had one". The counts are disclosed as measurements
   (`anchorsUndefined`, and 171 fabricated endpoints for the undefined case on the pinned
   corpus) precisely because the edges are suppressed.
6. **Headings inside a multi-line setext paragraph are attributed to the first line's name.**
   Measured: 5 of 118 setext headings in a 1,200-file draw, where the heading's `inline` node
   spans more than one line. The heading is named by its first line (the analyzer's rule) and
   a link on a continuation line is attributed to it.
7. **ASCII-only anchor slugs.** GitHub's slugger keeps Unicode letters, so `Café` is
   `#café` and this is `#caf`. Measured on the pinned corpus: 24 headings contain non-ASCII
   characters and all 24 are Unicode punctuation, which the renderer also drops, and 0 corpus
   links target a non-ASCII anchor. Telling a Unicode letter from Unicode punctuation
   without a pattern is the whole of the problem.
8. **A parser hang is non-deterministic on this corpus**, naming a different file on
   different runs, and 2–4 files per run report `memory access out of bounds`. Any corpus
   figure quoted from this lane carries that uncertainty, and the whole-repo census figures
   moved by 634 edges (0.7%) between two runs for that reason.

## Known gaps, in the order they should be closed

0. **`extractFallback` fabricates `calls` and `instantiates` on documentation files.**
   Shared file, §8, and this round's largest finding. Measured at corpus scale:
   **11 of 17,456 files (0.0630%)** return `fallback: true` from production `parseFile`, and
   every one of the 11 relationships they carry is a `calls` or `instantiates` edge read by
   regex out of fenced code in another language, with the source `"this"`. Both whole-corpus
   runs satisfy `degradedParse.relationships == calls + instantiates` exactly (11 = 8 + 3 and
   36 = 33 + 3), and `fallback-attribution.ts` reproduces the counts by calling the producer
   directly. Two one-line fixes in `src/ast/pool-worker.ts`, both needed: suppress
   `calls`/`instantiates` for non-programming languages the way `keepSymbol` (line 434)
   already exempts `markdown`, AND return a non-empty `errors` from `extractFallback` so a
   degraded parse stops being indistinguishable from a clean one. Every language with fenced
   code in its corpus has this; markdown is the first lane to measure it. Full detail above
   under "The degraded set".
1. **The pipeline deletion (4.33% of edges).** Shared file, §8. The fix is to extend
   `filterNoiseRelationships`' existing `declaredNames` escape to the leaf rules, so a
   target the file **declares** is not judged as an identifier. 1,765 edges per 1,200
   files; 89 `heading_hierarchy` edges per 200 files.
2. **The lane's mutants are written, all caught, and never constructed.** §8. Two lines —
   `import { MARKDOWN_MUTANTS }` and `...MARKDOWN_MUTANTS,` in
   `script/m14/mutate-analyzer.ts` — following the fsharp / css / nim / protobuf precedent
   already in that file. **The registration gap is now measured rather than asserted:**
   `validation/m14/fixtures/markdown/mutant-battery.ts` runs all 15 of them through
   `runLang()` — the arbiter's own matcher, imported from `script/m14/run-fixtures.ts`, not
   reimplemented — and reports **15/15 CAUGHT** from a 10-pass / 0-fail baseline. Several are
   caught by three or more fixtures (`markdown/line-number-dropped` goes 0 → 8 failures).
   So the fixture suite pins these surfaces and the ONLY thing missing is that
   `bun run script/m14/mutate-analyzer.ts` never builds a markdown mutant. A survivor would
   have meant the opposite; there were none.
3. **The arbiter's ruling table is wired; the arbiter still cannot finish.** §8, and now the
   only reason. `script/m14/markdown-ruled.ts` exports `MARKDOWN_RULED` — six types, each
   with its instrument, probe, measured count and overturn condition — and commit
   `94e7e4101` adds the one import and one `RULED_BY_LANG` entry to
   `script/m14/ontology-coverage-gate.ts`. With it applied the gate stops exiting 2 and
   starts dying 120 s into a file (next item), so the wiring is necessary and not
   sufficient. `ruling-table-adjudication.ts` is the substitute verdict and says in its own
   output that it is not the arbiter's.
4. **The differential does not AUDIT markdown's `references` or `imports`.** §8, and it is
   the more expensive of the two because a label the oracle derives and the compared-set
   allowlist omits is not merely unmeasured — it is measured as a defect. Measured with the
   allowlist as it stands (`["contains", "uses"]`): **770 MISSING** on a 60-file kubernetes
   draw, every one of them an oracle `references` row the harness filtered out of the
   ANALYZER side while leaving on the truth side. With `references` and `imports` added:
   MISSING=0, covered 100%. `script/m14/differential.ts`, one line, and the comment beside
   it — which asserts "the lane emits no `references`" — is now false.
5. **The arbiter dies on one corpus file.** **RESOLVED for this lane — see "The arbiter reaches
   exit 0" above.** `src/ast/engine.ts:1411`'s `process.exit(1)` on a 120 s parse hang ends the
   whole gate run, so any lane whose corpus contains a file the parser cannot finish in
   120 s can never be gated, and the gate is the one instrument with no way to resume —
   `whole-corpus-census.ts` gets that property by sharding, because a census is not a gate.
   Two runs of this lane's wired gate named two different files
   (`Grace/sdk/generated/matrix/openapi-generator/rust/docs/DiffDto.md`, then
   `FsToolkit.ErrorHandling/gitbook/validation/ofChoice.md`) and the three-to-four
   `[BB-PARSE-ERR] … memory access out of bounds` files per run are **disjoint** between
   them; all six parse alone in 60–2,678 ms and trap 0 times in 16 concurrent parses. The
   hang is load- and concurrency-dependent, so it moves between runs and a corpus draw is
   not reproducible while it exists. A minimal change that would fix it without touching
   parse semantics: retry the file on a FRESH `Parser` instance once, and only then take the
   process down — `getParser` already knows how to build one (`engine.ts:1034`).

   What was added since: the walk's own `!<path>` marker is UNWRITABLE for this case, because
   it is appended from a `catch` that `process.exit()` never reaches — so the defect above
   cannot be fixed from inside the walk, only routed around. `run-arbiter-to-completion.sh`
   routes around it and reaches `emitted 4/10  ruled-sound 6  FALSIFIED 0
   ruled-without-justification 0`, exit 0. 19 distinct files were named across runs of one
   unchanged corpus, which is the measurement that shows the hang is load-dependent rather
   than a property of a file. Both the marker defect and the fresh-`Parser` fix remain
   §8 items for the supervisor: `script/m14/resumable-walk.ts` and `src/ast/engine.ts`.
6. **The canonical `M14.0.F5.json`** has no markdown row. markdown's F5 rows are
   measured and pinned in `differential-baseline.json`, but a scoped run is refused the
   right to write the milestone artifact — that belongs to the 43-language sweep.
7. **One edge-recall delta of 7,630** is not decomposed.
8. **A repeated heading is reachable only by its ORDINALED anchor.** `#client-binaries`
   reaches the first holder and `#client-binaries-1` the second, which is the renderer's own
   rule and is what `markdown/internal-anchor-links` pins on `Duplicate` / `Duplicate#2` —
   but a link written to the BARE slug cannot address the second holder at all, so 224
   anchors held by more than one heading across 61 files (`overrides-probe.json` C) each have
   exactly one addressable holder out of the number that carry the title. Publishing an
   alias would make `#client-binaries` ambiguous on purpose, which is a renderer decision and
   not this lane's.
9. **Footnotes, wiki links and front-matter keys** produce no relationships. Wiki links are
   measured at **0** in a 1,200-file draw with the probe's own false-positive class fixed;
   footnotes have no node type in either pinned grammar.
10. **Not markdown's, recorded because it is adjacent**: `F9-PROBE-CLEAN-HEAD-PATTERN`
   (`instantiates:wrap->Just`) fails on the clean lane, reproduced on a stashed
   tree. It is the clean lane's finding.

---

## M60 round: resolution causes A/B/C, the external marker, and the DERIVATION payoff

Everything below is production `parseFile` over a named population, with the analyzer's
sha256 recorded before and after each walk (`analyzerStableDuringRun: true` in every
artifact). Instruments: `validation/m14/fixtures/markdown/ambiguity-split.ts`,
`references-imports-derivation.ts`, `toc-truth-probe.mts`,
`run-arbiter-to-completion.sh`.

### Resolution, split three ways — 600 files, admitted population 17,456

`abc-after-600.json`, same window as `abc-before-600.json` (`populationSha256`
`1d079c4fff2092ce`, 600 files, 8,496 symbols, 12,067 edges, 0 degraded, 0 parse failures).

| Cause | Question | Measured | Verdict |
| --- | --- | --- | --- |
| **B** format mismatch | does an edge target spell a symbol differently from the published name? | 4,951 unresolved targets, 4,672 dotted, **13** whose last dot-segment is a published name, and **0** of those 13 published in the edge's OWN file | **0 recoverable.** The 13 are coincidental collisions with a URL tail |
| **A** name is not an identifier | does a published name collapse N declarations into one node? | 4,707 ambiguous targets; **4,705 closed** by `line_number`, 0 by `qualifiedName`, 0 by own-file; **2 still open** | closed by a field the analyzer already publishes (`real-markdown-analyzer.ts:150-157`, `:319/:384/:421/:474`) |
| **C** external | are stdlib/BCL/remote targets counted as failures? | 4,107 external (`https` 3,996, `http` 110, `some` 1), 572 relative-path-in-repo, 272 bare token | now **marked**, not silently unresolved |

The 2 rows A leaves open are both `uses` → `AGENTS.md` from `Deedle/CONTRIBUTING.md` and
`FSharp.Data/CONTRIBUTING.md`: the target names a file that is outside the 600-file window,
which is a statement about the sample rather than about the analyzer.

C is now emitted as an explicit marker rather than inferred by the reader. The scheme rule is
RFC 3986 `alpha *( ALPHA / DIGIT / '+' / '-' / '.' ) ':'`, scan terminated by `/`, `?` or `#`,
**minimum two characters** so a Windows drive letter is not read as a scheme, applied after
stripping one balanced `(...)` or `<...>` wrapper — 3 wrapped destinations in the window.
Pinned by `markdown/link-target-external` and by four mutants
(`external-marker-dropped`, `one-char-scheme-counts-external`,
`destination-classified-from-label`, `angle-destination-delimiters-kept`).

### MD-G4 — the `<...>` destination form emitted nothing at all

`[text](<dest>)` is a legal CommonMark destination form. Before this round the analyzer
emitted **0** edges for it: the angle delimiters were kept on the target, so no destination
matched a published name and the edge was indistinguishable from an unresolved one. Now
stripped, and pinned from both directions — `markdown/angle-destination-delimiters-kept`
catches the regression, and `markdown/balanced-parens-stripped-too` guards the adjacent rule
that one balanced `(...)` wrapper is removed and no more.

### The DERIVATION payoff — `references` compared at last

The DERIVATION section above establishes that `references` and `imports` are emitted and
compared against nothing, because `differential.ts:23392` admits `["contains","uses"]`. That
is shared machinery (§8), so instead of editing it this lane compared both sides itself, over
the differential's OWN two corpora at their whole admitted population —
**1,334 files, 1,334 parsed, 0 parse failures, 1 degraded** — production `parseFile` against
`deriveMarkdownEdges`, strict equality on `(type, source, target)` with no normalisation.
Artifact: `validation/m60/markdown/references-imports-derivation.json`.

| type | analyzer keys | truth keys | matched | missing | unexplained | coverage of truth | precision | in allowlist |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `uses` | 41,890 | 33,588 | 33,506 | 82 | 8,384 | 0.9976 | 0.7999 | yes |
| `contains` | 17,502 | 10,095 | 9,776 | 319 | 7,726 | 0.9684 | 0.5586 | yes |
| `references` | 3,641 | 3,643 | 3,565 | 78 | 76 | **0.9786** | **0.9791** | **no** |
| `imports` | 1 | 1 | 1 | 0 | 0 | **1.0000** | **1.0000** | **no** |

Counts are over DISTINCT keys per file. `matched / analyzerEdges` is not a precision — the
numerator is deduplicated and the denominator counts a triple once per occurrence — and
quoting it would have read 0.3414 for `references` instead of 0.9791.

So `references` agrees with an independently written walker on 97.86% of oracle truth, and
nothing in the programme was measuring that.

**The limitation, stated before the number.** `deriveMarkdownEdges` is a second walker over
the same two grammars. It sub-parses each `inline` node itself rather than reading the
engine's pre-parse (`differential.ts:22201-22204`), which removes collusion over the PARSE;
it does not remove collusion over the GRAMMAR. A node type both walkers misread is invisible
to this comparison. A high match rate is evidence the two walkers agree, not evidence the
grammar is read correctly — instrument A in `markdown-ruled.ts` covers the grammar, by reading
node types rather than edge agreement.

### The 770 MISSING rows are the harness's one-sided filter, not an omission

`differential.ts --lang markdown` prints, on kubernetes,
`tree-truth=8499 covered=7729 (90.9%) MISSING=770`, every sample shaped
`references document -> <heading text>`, all from files carrying a
`<!-- BEGIN MUNGE: GENERATED_TOC -->` block. `8499 - 7729 = 770`.

Those edges are not missing. `toc-truth-probe.mts` runs production `parseFile` on
`kubernetes/CHANGELOG/CHANGELOG-1.11.md` — the file every sample names — and the analyzer
emits, verbatim:

```json
{ "type": "references", "source": "document", "target": "v1.11.10",       "confidence": 1 }
{ "type": "references", "source": "document", "target": "Client Binaries", "confidence": 1 }
```

182 `references` edges in that one file, 2,562 relationships in total. The oracle derives the
same edges; the allowlist drops the analyzer's copy before the comparison, so each one reads
as MISSING. `differential.ts:23408` documents exactly this, in its own words: "This harness
filters the ANALYZER side by the allowlist and does NOT filter the truth side, so a label
that truth derives and the allowlist omits is not merely unmeasured, it is measured as a
DEFECT." Its own precedent for the repair is the csharp C923 asymmetry — exclude a label on
BOTH sides.

### A number that depends on the matching rule

The same run prints `unexplained=0 (0%)` for both corpora. Under strict triple equality,
`uses` precision is 0.7999 and `contains` precision is 0.5586. The gap is the harness's
target normalisation, not an analyzer disagreement — `0%` is a property of the normaliser,
and the unconditional rate is the table above. Both are reported rather than reconciled by
assertion, because "unexplained = 0" and "56% of `contains` edges match exactly" are the same
measurement under two rules and a reader cannot tell which one a gate used.

### The arbiter reaches exit 0 — limitation 5 above, resolved

Limitation 5 recorded that the gate "dies on one corpus file" and called it the only
remaining blocker on this lane's gating. It is driven to a verdict now, by
`run-arbiter-to-completion.sh`, which loops the gate and records each file it had to abandon:

```
walk: 17456/17456 files (100.0%)  newly walked 2650, resumed 14806  SKIPPED-BAD 2  PARTIAL
emitted 4/10   ruled-sound 6   FALSIFIED 0   ruled-without-justification 0
```

Exit 0. Log: `validation/m60/markdown/arbiter-verdict.log`. The two zeros are the lane's
verdict and they are unchanged.

The walk could not do this by itself, and the reason is a defect in shared machinery (§8).
`resumableWalk` writes `!<path>` from the `catch` around `opts.run(i)`, documented as the thing
that stops "one poison file re-destroying every future run" — but a WASM trap inside
`parser.parse()` is answered by `process.exit()`, which ends the process instead of rejecting
the promise. The `catch` never runs, the marker is never written, and the file is offered
again next run. Measured: `walk-markdown.txt` held **0** bad markers after repeated runs, and
`duckdb/data/secrets/README.md` trapped at 14:33:06 with its own watchdog exiting the process
at 14:35:09 — the same file, 123 s later.

**19 distinct files** were named across this lane's runs of one unchanged corpus, and the two
the final successful run named are not among the 17 earlier ones. The hang is load-dependent,
not a property of any file, so marking one bad does not prevent another appearing and the
driver loops rather than assuming one round suffices. Full record, including the fix that
would remove the need (retry once on a fresh `Parser`; `getParser` already builds one at
`engine.ts:1034`): `validation/m14/fixtures/markdown/arbiter-poison-files-markdown.json`.

MD-ARB-1 above is re-measured here from two directions, which is what makes it a rate rather
than an anecdote. Same gate, same 17,456-file population, banner `100.0%` both times:

| run | newly walked | share of corpus | `uses` printed | `contains` printed | `imports` | `references` |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 972 | 5.6% | 16,938 | 9,651 | 12 | 138 |
| 2 | 2,650 | 15.2% | 32,023 | 33,624 | 70 | 354 |

The totals track the walk, not the corpus. Whole-population figures for the same types are in
`validation/m60/markdown/whole-corpus-census.json`: `contains` 334,773, `uses` 270,779,
`references` 16,857, `imports` 105, over all 17,456 admitted files.

A single fresh walk in one process is not available as the alternative: the gate OOMs at this
lane's measured heap cliff (~6,900 parses / 62.4 MB, commit `6af7361fe`), so the walk must
resume — and a resumed walk is exactly where the banner and the tally diverge.

### Mutant coverage is split across two files, and only one is wired

`mutate-analyzer.ts` reaches markdown through `script/m60/markdown-mutants.ts` (line 31).
That file holds **15** mutants and all 15 are caught:

```
BB_MUTANT_ONLY="markdown/" bun run script/m14/mutate-analyzer.ts
→ all 15 mutants caught
```

`validation/m14/fixtures/markdown/markdown-mutants.ts` holds **16** more, including all four
that cover the external marker and MD-G4, and **is imported by nothing**. Run directly, all 16
are caught:

```
npx tsx validation/m14/fixtures/markdown/markdown-mutants.ts
→ 16/16 lane mutants caught
```

So markdown has 31 mutants and 31 are caught, but a gate that runs only the shared registry
sees 15 of them. The four that guard this round's new behaviour — `external-marker-dropped`,
`one-char-scheme-counts-external`, `destination-classified-from-label`,
`angle-destination-delimiters-kept` — are among the 16 that no shared gate runs. Wiring them
means editing `script/m14/mutate-analyzer.ts` (§8).
