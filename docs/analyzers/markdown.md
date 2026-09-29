# Markdown Analyzer

## What it extracts
- **Symbols**: ATX headings h1–h6 (`type`), setext headings (`type`), pipe
  tables (`class`, one per SITE), fenced code blocks (`function`, one per SITE,
  named `code_block.<lang>`), YAML front matter (`namespace`).
- **Relationships**: `contains` (heading → nested heading; heading or document →
  table / code fence; table → header column) and `uses` (owning section or
  document → every link destination, image source, URI autolink, email autolink,
  and *resolved* reference link).
- **Payloads**: a 1-based `line_number` on **every** relationship, an
  `evidenceClass` on every relationship, and per-symbol `nodeType`,
  `headingLevel`, `isMarkdownHeading` / `isMarkdownTable` /
  `isMarkdownCodeBlock` / `isMarkdownFrontMatter`, `language` on a code block, and
  `isRepeatedSite` on a repeat. See the seam note below — the symbol metadata is
  published by the analyzer and **dropped at the worker boundary**, which is a
  known open item, not a claim.

## Two grammars, and why that changes how the lane must be audited
tree-sitter-markdown ships a **block** grammar and a **companion inline**
grammar. The block grammar leaves inline content opaque, so links, images,
autolinks and reference links are not nodes in it; the engine pre-parses every
`inline` node with the companion and hands the trees over on the analyze context
(the vue/svelte SFC seam).

Three instruments had to learn this, and each learned it the expensive way:

- The **F1 grammar audit** read one grammar and reported `uri_autolink` and
  `email_autolink` as dead branches — "can never match" — for 35 days, when both
  are live named types of the companion (ids 37, 38). Fixed with
  `markdown: ["tree-sitter-markdown_inline.wasm"]` in `EXTRA_GRAMMARS`.
- The **completeness inventory** reported 19 classified rows as "no longer
  produced by the wasm (grammar drift?)" — the same one-grammar assumption in a
  second instrument. Fixed with a `companionWasm` union.
- The **F5 differential harness** would have handed the analyzer no context at
  all, and every `uses` edge would have been absent from *both* sides — a green
  row agreeing about nothing. Fixed by putting the lane in the production-parity
  set.

Both grammars are now pinned by sha256 and full surface in
`validation/m14/grammar-pins.json` (12 lanes; markdown is the first with a
`companions` entry). The inline wasm carried **no** hash anywhere in the
repository while supplying every `uses` edge the lane emits.

## Evidence tiers
`contains` → **structural**: a parent/child relation read off the block tree.
`uses` → **reference_qualified**: the destination is a node's own text, and for a
reference link it is the destination the document's own
`link_reference_definition` declares.

This is not bookkeeping. With no stored class the read-time derivation in
`graph-core.ts` decides instead, and its `STRUCTURAL_TYPES` set does **not**
contain `contains` — so the entire heading hierarchy was rendered to readers as
`inferred`, "a guess, treat as a hint, never as fact", for edges that cannot be
anything else. Measured: 11,401/11,401 relationships now carry both a 1-based
`line_number` and an `evidenceClass`; before this round it was 0/9,132.

## Sites, not declarations
A heading, a table and a code fence are **sites**: the same construct can
legitimately appear twice under one owner. Keying them by `owner + name` dropped
every repeat, and dropped the repeat's `contains` edge with it — **1,920 of the
grammar's 4,078 `fenced_code_block` nodes, 47%, across 406 of 738 corpus files**;
worst case `docs/_spec/05-classes-and-objects.md` at 79 sites published as 24
symbols.

Sites are now published per occurrence on the rule yaml uses for duplicate
mapping keys: the **first occurrence keeps its exact previous spelling** and
only the Nth repeat is ordinaled, with `id`/`qualifiedName` carrying the path and
`isRepeatedSite` flagging the repeat. That asymmetry is deliberate — the 59
hand-audited M12 ground-truth facts and 31 contract checks name bare targets, and
a fix is not allowed to break the evidence that could not see the defect.

The repeat's ordinal is part of the published **name** as well as the id, because
the store resolves a relationship endpoint by name and checks it against a denylist
rather than for existence: with the bare name published and `code_block.scala#2`
in the edge, **28.7% of the lane's relationships (529 of 1,843 over 120 corpus
files) named a symbol the file did not declare**. A table's header cells publish
as `property` sites for the same reason — the `table_column` edge existed for every
column of every table while no column symbol was ever declared. Both are now 0.

Numbering stays per owner, not per file: a name shared by several sites is
separated by the relationship's line, and 44% of symbols sharing a name is the
store's design rather than a defect to renumber away.

## Internal references: a link names a heading's ANCHOR, and the anchor is not the text

A link whose destination is only a fragment names a heading in the same document,
written as that heading's **GitHub anchor** rather than its text. Those are different
strings: `## Install Now!` is published as `Install Now!` and its anchor is
`#install-now`, and nothing in the file is called `install-now`. This lane had no
notion of an anchor at all, so the two spellings could not meet.

Measured over 420 pinned corpus files: **10,174 bare fragments, of which 10,158 now
resolve** to a published heading and **16 name a heading that does not exist**.
Before, none of the 10,174 could resolve, by construction.

| | rule |
|---|---|
| anchor | lowercase; keep letters, digits and hyphens; spaces and tabs become hyphens; everything else dropped |
| repeated anchor | a second `#duplicate` is `#duplicate-1` — two identical headings are two sites and therefore two anchors |
| fragment | percent-decoded, then lowercased. An invalid escape falls back to the raw text rather than throwing, so a typo in a link cannot fail a parse |
| resolution | **deferred to the end of the walk** — a link may precede the heading it names |
| no match | **not published**, and counted in `metadata.patterns` as `Markdown undefined internal anchors: N` |
| edge line | the **heading's** line, with the link's own line kept as `metadata.linkLine` |

The last two rows carry most of the weight. Deferring is what makes the forward
reference work, and a second implementation of the identity rules — the alternative, a
pre-pass — is the failure this lane has now paid for twice: once when the oracle and
the analyzer agreed on a name neither published, and once at 28.7% of relationships
naming symbols the file did not declare.

The edge carries the **heading's** line because M59 #825 takes `line_number` from the
node that carries the name the edge is about — java's mapped-column edge does the same
for the same reason. The link's own line is not lost: it is `metadata.linkLine`.

**What actually fixed this, stated precisely, because the first version of this
document got it wrong.** The mechanism is the target's NAME, not its line. The store
resolves a `contains` target by name *and* line (`resolveContainsTargetStmt`, because
same-named members need the line to tell them apart) and **every other relationship
type by name alone** (`resolveTargetStmt`: `WHERE project_id = ? AND name = ?`, with a
tiebreak on declaration-first / same-file / same-language). So a `uses` edge never
needed the line to resolve, and the earlier claim here — that the heading's line was
"the only choice under which the store's `fileId:name:line` endpoint key resolves" —
was false.

What was true, and is the whole of the fix: the raw fragment `#install-now` is not the
NAME of any symbol the file publishes, so a name-only resolver found nothing and the
edge bound to nothing. Resolving the fragment to the heading's published **name** is
what made it bind — and that is also why the e2e gate can assert the edge through a
JOIN on `target_symbol_id` rather than through `target_external`. The line choice is
right on M59's terms and harmless, but it is not load-bearing, and a reader deciding
whether to change it should know that before they assume the store depends on it.

The corollary is worth carrying to any lane with same-named non-`contains` targets: name-only
resolution means an edge to one of two same-named symbols binds to whichever the
tiebreak picks. `contains` is the only type with a line to disambiguate, which is
precisely why it is the one type that carries one into resolution.

**Declared limitation.** GitHub's slugger keeps Unicode letters, so `Café` is
`#café`; this lane's slug is ASCII-only and would produce `#caf`. The rule is
ASCII-only deliberately and by measurement: the corpus has 24 headings with non-ASCII
characters and all 24 are Unicode *punctuation* (`What’s new in…`), which the renderer
also drops, so ASCII-only matches every one of them, and 0 corpus links target a
non-ASCII anchor. Telling a Unicode letter from Unicode punctuation without a pattern is
the whole problem, and the zero-regex property is measured and pinned — so the boundary
is declared (MD-D6) rather than approximated. Documents affected: 0 as measured,
unknown in general.

## Reference links, and the one place the lane deliberately emits nothing
A reference link's destination lives in a block-level definition, so the whole
form produced **no edge at all** before this round: 671 sites (44 uses + 627
definitions) across 66 corpus files, while the doc claimed "Links (inline and
reference destinations)". Now 213 resolve against the document's own
definitions.

A reference link with **no** matching definition publishes nothing, and that is
CommonMark rather than a heuristic: an undefined reference renders as literal
text. The alternative was implemented and **measured first** — 171 edges across 34
corpus files, dominated by bare bracketed citation markers (`NOTICE.md: document
-> 1`, six times in one file), which are fabricated endpoints and an R10
target-spelling violation. Stated plainly: an undefined reference is therefore
*invisible* rather than flagged. That is a decision with a cost, recorded as
MD-D1, and F9-PROBE-MD1b asserts the **oracle refuses it too** so the day the two
sides agree on it wrongly, the probe fails as collusion.

## Complexity envelope
Declared budgets: fixtures < 2 s (met: 0.9 s); the 60-file differential corpus
< 60 s (met: 1.1 ms/file avg, pinned in `differential-baseline.json` under
`scala3:markdown`); the 734-file full-corpus sweep < 120 s.

One production `parseFile` pass per file. A single iterative DFS over the block
tree; one additional DFS that collects `link_reference_definition` nodes and
**skips `inline` subtrees**, so it never touches the inline grammar's node count;
an O(1) byte-offset map from the engine's inline pre-parse; `Map`-backed site
identity; `Set`-backed relationship identity. O(block nodes + inline facts), the
inline half walked exactly once, no per-symbol O(n) scan.

**A throughput number without a load context is not a measurement.** The change
that recovered 1,920 code blocks and 213 reference links was measured against
its own predecessor in one session, on an identical 200-file / 1,005,022-byte
sample at `loadavg1 ≈ 40`: wall 19,050 ms → **17,475 ms (−8.3%)**, µs per symbol
10,010 → **6,976 (−30.3%)**, while publishing **+32% symbols**. The
`markdown-corpus-complexity.json` row must not be compared with the
`validation/m12/corpus-manifest.json` figure of 55.13 files/s measured
2026-08-20 — that was a quiet box (`loadAvgStart 4.85`) and this is not, which is
why the M60 complexity gate refuses to score a row with no `loadRule` and no
`corpusManifest` (#871, #909).

## Known limitations
- Grammar surface is enumerated in `script/m14/spec/markdown-completeness.json`:
  72 public named types across both grammars, **29 handled_verified / 41
  internal_silent / 2 gap**, plus 6 design decisions. Every silent class carries a
  measured site count over the pinned corpus rather than a shrug.
- `MD-G1` **open**: an *indented* (4-space) code block publishes nothing while a
  fenced one publishes `code_block.<lang>`. 2 sites in 2 of 738 files — a small
  count, but an asymmetry inside one construct.
- `MD-G2` **open**: Pandoc/MyST `+++` front matter publishes nothing. 0 corpus
  sites, so it is owed a real MyST corpus rather than an invented fixture.
- **Footnotes** (`[^1]`) and **wiki links** (`[[Page]]`) publish nothing. Neither
  is a CommonMark construct and `footnote_reference` is absent from both pinned
  grammars — measured, not assumed. 54 such sites on the pinned corpus.
- **Front-matter keys** produce no relationships. `title:`, `permalink:`,
  `redirect_from:` and `weight:` are the cross-file link carriers in a Jekyll
  site, and the block grammar models `minus_metadata` as ONE node with no
  key/value children, so there is no key to reference from.
- **Table bodies are data, not structure**: 224 `pipe_table_row` sites over 14
  files publish nothing. A header cell is a column name; a body cell is a value.
  The same ruling toml's spec records for a value.
- **Raw HTML** is declined: 579 `html_block` sites over 291 files. The corpus
  already names the one construct where the grammar genuinely fails rather than
  declines (an indented `<details>` inside a numbered-list item).
- **Heading names are source text, not rendered text**, with two corrections that
  are grammar facts (the ATX closing run is removed; an empty heading publishes
  absence). Consequence: two headings that render identically but differ in
  markup publish two symbols. `entity_reference` is **0 over 738 files**, so the
  wider question has no corpus evidence and is recorded UNDECIDED rather than
  answered by assertion (MD-D2).
- **Symbol metadata is dropped at the worker boundary.**
  `pool-worker.ts` narrows `symbol.metadata` to a 15-key CSS-only allowlist, so
  `nodeType`, `headingLevel`, `language`, `isMarkdownTable`,
  `isMarkdownCodeBlock`, `isMarkdownFrontMatter` and `isRepeatedSite` never reach
  the index — including the `language` this document's payload list names. The F3
  fixture lane calls `engine.parseFile`, not the worker, so **no fixture can
  currently see it**; the instruments that can are the pipeline e2e gate and P1.
  Named as owed rather than claimed.
- `bb_doc` renders a `.md` file as a degraded doc: headings are narrated as `type`
  declarations, and there is no Dependencies section because markdown links are
  `uses` edges while `brain_import` is empty for `.md`.

## Verification
- **Fixtures**: 4 (`validation/m14/fixtures/markdown/`) — `code-block-site-identity`,
  `reference-links`, `heading-identity`, `payload-lines-evidence`. Each authored
  from the contract rather than transcribed from analyzer output, which is the
  only reason they were able to disagree with it.
- **Differential**: an independent CommonMark oracle at **0 MISSING / 0
  unexplained** on BOTH pinned corpora — `scala3@18df09c0` (738 tracked `.md`)
  and `kubernetes` (595), the second chosen for a different dialect rather than a
  second copy of one. Both rows pinned in `differential-baseline.json`. The
  oracle loads its own copy of the companion grammar, because an oracle that read
  the analyzer's pre-parse would agree with it by construction.
  *The M12 differential is still a mirror and is labelled as one* — `truthSource:
  manual_audit`, no commit, and `verify-differential-freshness.ts` files it under
  `UNPINNED`. The F5 oracle is the instrument that can disagree.
- **Teeth, measured**: the same oracle run against the PRE-FIX analyzer reports
  `MISSING=127` (scala3) and `MISSING=67 + unexplained=5` (kubernetes) without
  being told about any of it. A differential that has never failed is a claim.
- **Probes**: 7 (`F9-PROBE-MD1`, `MD1b`, `MD2`, `MD3`, `MD6`, `MD9`, `MD10`),
  each encoding a defect class that actually occurred. `MD1b`'s forbidden half is
  asserted on the **oracle** too, and that check is what caught the oracle
  deriving `##`/`###` for empty headings on a construct too rare for either
  corpus to contain.
- **Grammar audit**: PASS — refs 4, unknown 0, unknownFields 0, **union oracle:
  block + inline** (282 node types, up from 196). Dead-literal record 2 → 0 with
  the repayment written down.
- **Grammar pins**: both wasms sha256-pinned with full surface; the registry copy
  of each is byte-identical. Provenance class is `unnamed-build-sha-only`, not an
  inherited `0.5.1` claim: the artifact that claim cites has no markdown row, and
  the difference between "a published artifact hashes to these bytes" and "these
  bytes ARE that release" is the whole subject of the record.
- **Corpus**: 738 tracked, 734 clean, 4 named grammar limits, 0 unexpected, 0
  crashes. 8,633 symbols and 11,401 relationships over those 738 files.
- **Completeness**: 7 of 8 sections green. Section G required this file; E is
  satisfied in substance but read by the gate from the canonical `M14.0.F5.json`,
  which belongs to the 34-language sweep.
