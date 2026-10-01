# real-html-analyzer.md

> **Canonical contract doc for the html lane.** The *rulings* — why each decision was
> taken, with the history and the defect each one closed — live in
> [`html.md`](./html.md). This file is the reference: what the analyzer emits, what it
> refuses to emit, and the measurements behind both. Kept distinct on purpose, because
> two overlapping copies of the same contract is how a table ends up claiming
> `calls` is `form action` while the analyzer has said `uses` for two releases.

## Language

| | |
|---|---|
| Grammar | `wasm/tree-sitter-html.wasm`, sha256 `11b3405c1543fb012f5ed7f8…`, 18,468 bytes, vendored under `grammars/tree-sitter-html/` with provenance |
| Node types | 19 distinct named types (the grammar exposes 26 `nodeTypeForId` slots; `start_tag`/`script_start_tag`/`style_start_tag` and `tag_name`/`erroneous_end_tag_name` are aliases onto shared names) |
| Completeness | `script/m14/spec/html-completeness.json` — **21/21 classified, gap list empty**: 19 grammar node types (13 handled, 5 `internal_silent`, 1 design decision) plus the universal `ERROR`/`MISSING` recovery pair the gate injects for every language (ERROR handled, MISSING silent) |
| Analyzer | `src/ast/real-html-analyzer.ts` — **1,999 lines** (1,240 code / 667 comment, 93 KB) |
| Family | `web` (M60.LCM) |

## Symbol contract

**An element is a symbol because it is ADDRESSABLE, not because it has a class.**

| Input | Result |
|---|---|
| `id="x"` | symbol `x` |
| `name="x"` with no `id` | symbol `x` — the legacy anchor form is a real handle |
| `class="a b c"` | **nothing** — a class is a shared styling hook, never an identity. The pre-fix analyzer took the whole multi-token value as the name, so 28.8% of symbols carried whitespace |
| neither | **nothing** — an anonymous element passes its parent's identity through, so a containment chain skips structural noise |
| duplicate `id` | first in document order keeps the plain name; the k-th becomes `<id>#k`, deterministically, so a rebuild is byte-identical |

Measured on 1,200 real files: **0 empty names, 0 names containing whitespace, 0
duplicate names within a file** (from 59.9% non-unique and 28.8% whitespace-bearing
before the ruling).

| Field | Value | Why |
|---|---|---|
| `kind` | `class` for elements, `module` for the document | `class` is this codebase's shared *structural* bucket — `Table`, `Service`, `Resource` and `Object` are all aliases for it in `SymbolKind`. There is no `Element` kind, and inventing one would break the fixtures, the hand-audited M12 truth, PIPE and the differential oracle |
| `ownerName` | nearest addressable **ancestor**, or the document module | the owner is the node a consumer navigates *up* to |
| `scope` | `""` | HTML has one scope: a document |
| `visibility` | `public` | there is no private/package/protected in markup, so this is the only truthful value — and it is pinned by fixture rather than left as an unexamined default |
| `range` | the whole `element` node | an element's span is defined by its `start_tag`…`end_tag` pair, so reading the `end_tag` separately would publish the same line twice |
| `line_number` | 1-based, from the byte-accurate range | never fabricated `0` (M59.O2 / R6) |

**The document is the module.** One `module` symbol per file, named from the file
stem, with `metadata.doctype` recorded on it. Without this a page has no root and
every top-level element is parentless.

**Recovery nodes.** `ERROR` is read and *handled*: the broken region is reported as a
`ParseError` anchored to the **ERROR node's own span**, the node is **bypassed**, and
the elements around it still publish symbols, containment and resource edges. A walk
that stopped at the first error would still publish the module and everything above
it, so `html/error-recovery` places the error in the **middle** of the document
specifically to make the two behaviours distinguishable. `MISSING` is read
defensively but **never occurs** — twelve deliberately malformed documents (unclosed
comment/attribute-quote/doctype/script/style/textarea/select/template, an attribute
with no value at EOF, a stray end tag, `<>>><<></` soup) and tree-sitter-html
recovered from every one without inserting a token. That split — `ERROR` handled,
`MISSING` silent — is what `bash` already records, reached independently.

## Relationship ontology

Every applicable label is emitted. Labels with no HTML construct (`extends`,
`implements`, `instantiates`, `overrides`, `exports`) are correctly **absent** —
measured at 0 exports across 1,200 files, because markup has no module surface.

| Label | Emitted for | By | Confidence | Tier |
|---|---|---|---|---|
| `contains` | DOM containment, document module → top-level included | html | 1.0 | `structural` |
| `uses` | fetched resources, in-project navigation, form endpoints, resolved in-document references, citations | html | 1.0 fetch / 1.0 reference / 0.9 navigation | `import_based` / `structural` / `usage_contextual` |
| `uses` | a bare identifier read inside an inline `<script>`/`<style>` | **delegate** | **0.60 — unclaimed** | `usage_contextual` |
| `calls` | invocations found inside an inline `<script>`/`<style>` | **delegate** | 0.9 | `usage_contextual` |
| every edge | carries `line_number` — 1-based, the site, never `0` | | | |
| `imports` | mirrors every fetched project-relative module; the `range` is the **attribute's**, not the element's | | | |

`calls` is emitted **only** by the embedded-block seam: 3,016 `calls` on 400 corpus
files, of which **3,016 came from the delegate and 0 from html**. Markup has no
invocation semantics of its own — a `<form action>` is a navigation the *browser*
performs, which is exactly why it is `uses` and **never** `calls`. The pre-rewrite
truth said `calls`, conflating a network dependency with a control-flow edge, so
renaming a submit handler would have looked like a change to a URL.

**Measured invariants** (1,200 files / 45,768 relationships, production
`ASTEngine.parseFile` path):

| Invariant | Result |
|---|---|
| relationships without a `line_number` | **0** (0.000%) |
| relationships with `line_number <= 0` | **0** |
| unresolvable edge targets (neither symbol, scheme, nor path) | **0 of 59,662** |
| symbol lines beyond EOF (fabricated sites) | **0** |
| empty / whitespace / duplicate symbol names | **0 / 0 / 0** |

**The 0.60 tier, disclosed rather than averaged away.** 8.24% of emitted edges are
sub-threshold — a `bareRead` field access inside an inline script, which the JS
analyzer emits as a *guess* and marks as one. All 3,770 are `uses` from the `js`
delegate; **html's own edges are 0.9 or 1.0 without exception.** A sub-threshold edge
is not a defect: the store records it as an unclaimed observation and the M12
differential scores it as `unknown` rather than as a false positive. The reason a
bare read is a guess is that `obj.field` is a declaration in one file and a property
of something else in another. What matters for a consumer is that the number is
*known* and attributable to exactly one origin.

## Noise-elimination contract (what produces NO edges)

| Input | Why no edge |
|---|---|
| `http:` / `https:` / `ftp:` / `mailto:` / `tel:` / `sms:` … | an external URL is not a dependency of this codebase. The pre-fix analyzer emitted one per external link, so a page with 50 external links published 50 graph edges the enrichment pass then scored for architectural criticality — **measured at 237 such edges across 51 documents** |
| protocol-relative `//host/x` | same |
| `href="#"` | the HTML idiom for "no destination" — a valid URL naming the top of *this* document, which the document module already is. An edge to the literal text `#` is a target that is neither a symbol nor a file |
| `href=""` | the same statement with less ceremony |
| `<meta charset>` / `description` / `viewport` | `content` is a URL only under `http-equiv=refresh`; otherwise it is a media type or a sentence, and an edge to a sentence is the defect class this lane exists to avoid |
| `<link rel=preconnect>` / `dns-prefetch` | names a **host** for a connection warm-up, not a subresource. The pre-fix analyzer mirrored these into `imports`, so the index claimed a dependency on a hint nothing serves |
| `class`, `style`, `id`, `name`, `title`, `alt`, `data-*`, `aria-*`, `xmlns`, framework bindings (`:`, `@`, `v-`, `x-`) | presentation, identity, or application state — never a document |

A corpus census (`script/m14/verify-carrier-census.ts`, a **registered gate** in the
`verify` chain) enforces the boundary from the document side: at 4,000 files it finds
**61 distinct `(tag@attr)` pairs carrying 313,582 reference-shaped occurrences, all
61 ruled**. It consults *neither* the analyzer's table nor the differential oracle's,
because a differential cannot contradict a premise it shares.

## Supported constructs

37 rules over 28 tags. The full table is `RESOURCE_RULES` in the analyzer; this is
what it covers.

| Group | Carriers |
|---|---|
| scripts | `script@src`, `script@href` (SVG2 spelling), `param@value` (for a resource-bearing `name`) |
| stylesheets & links | `link@href` gated on a fetchable `rel` (14 tokens, each with its own `resourceType`) |
| images | `img@src`, `img@srcset` (one row **per candidate**), `img@longdesc`, `source@src`, `source@srcset` |
| media | `video@src`, `video@poster`, `audio@src`, `track@src` |
| embedded objects | `embed@src`, `object@data`, `iframe@src`, `frame@src`, `input@src` |
| SVG | `use@href`/`xlink:href`, `image@href`/`xlink:href`, `feImage@href`/`xlink:href` |
| navigation | `a@href`, `area@href` — fragment refs resolve to the **element**, never to the source text |
| form endpoints | `form@action`, `button@formaction`, `input@formaction` (for `type=submit`/`image`) |
| navigation pragma | `meta@content` under `http-equiv=refresh` — a navigation, same class as a form action |
| fetch lists | `a@ping` — whitespace-separated, one row per URL |
| citations | `cite` on `q`/`blockquote`/`del`/`ins` — a reference out of the document, graded `usage_contextual` because it is not a fetch |
| legacy | `body@background`, `table@background` — deprecated, still fetched by every shipping browser, so the `legacy-` resourceType says so at the edge |
| manifest | `html@manifest` |

**Scope barriers.** `<template>` and `<slot>` are scope boundaries: an addressable
barrier owns its own fragment, a bare one does not, and the flag is
`metadata.inTemplateBarrier`. A barrier's **tag** never becomes a name.

**In-document references** are resolved *after* the walk, so a **forward** reference
(`<label for="x">` above the `<input id="x">`) resolves exactly as a backward one
does — which HTML allows, and which a single-pass resolver silently loses. A
reference to a **duplicated** handle resolves to the **first** declaration, because
that is what `getElementById` returns; the edge is marked `ambiguousTarget` so a
consumer can see that a choice was made.

**The inline-block seam.** `<script>`/`<style>` bodies are handed to the JS, TS and
CSS analyzers as sub-parses and merged with **file-coordinate** lines; the applied
offset is recorded on every row as `metadata.embeddedLineOffset`, so the shift is
auditable rather than merely correct. Delegates are resolved **lazily and
independently**, never as static imports: a static import makes a broken delegate a
*load-time* failure of this module, and while the CSS analyzer was mid-rewrite with 5
build errors every HTML file in the project fell back to `2.0-basic-fallback` — zero
symbols, zero relationships. A template language must not be held hostage by a script
language. A delegate that fails to load now costs exactly the blocks it would have
served, and the skip is **disclosed** as `metadata.unavailableEmbeddedLangs`, because
a silently missing block set reads as *a document with no code in it*.

## Unsupported / explicit-unknown constructs

| Construct | Disposition |
|---|---|
| `class` as an identity | ruled out — a shared styling hook. Was 28.8% of all symbol names |
| external absolute URLs | no edge by the scheme contract, and **counted** in `documentMetrics` rather than dropped silently |
| `<base href>` | not read. A `<base>` rewrites the resolution of every relative URL on the page, so treating its value as a dependency would be a *different* dependency from the one the browser fetches. Not emitting it is the conservative choice; it is listed here so the omission is a decision rather than a gap |
| mis-nested / erroneous end tags | reported as `ERROR`, structure not modelled. A fabricated tree for a mis-nested document is a guess dressed as a fact |
| `MISSING` nodes | never produced by this grammar (measured across 12 malformed inputs); read defensively and retained |
| documents deeper than ~12,000 elements | the engine degrades to `2.0-basic-fallback` rather than crashing. Deepest real nesting across 1,599 files is **32**; none exceeds 100 |

## Regex inventory

**Zero.** Pure-String throughout: `asciiLower`, `unquote`,
`decodeCharacterReferences`, `urlScheme`, `isProtocolRelative`, `fragmentTarget`,
`srcsetCandidates`, `spaceSeparatedUrls`, `refreshContentUrl`, `firstToken`,
`isHtmlSpace` are all index loops. The M12 regex census carries **no html row**,
which *is* the zero.

Two bugs here were worth the rule:

* `isHtmlSpace` takes a **charCode**. Passing a character made it return false at
  every position, so `<a ping="/a /b">` was never split and published **one** edge to
  `"/a /b"` — a path resolving to no file.
* **Character references are not length-preserving.** Parsing a raw
  `content="0; url=&quot;/next&quot;"` and stripping quotes with the *decoded* form's
  offsets cut `&quot;/next&quot;` down to `quot;/next&quot;` and published that as a
  path. The decode is now owned by exactly one caller, and `emitResource` is told it
  already happened, so `&amp;` collapses once and `&amp;amp;` collapses to `&amp;`
  rather than two levels.

The last regex (`/line/i.test(k)`) was removed in favour of
`asciiLower(k).includes("line")`.

## Complexity envelope

### The metric itself

Per-symbol `complexity` is the depth of the symbol's own subtree in the emitted
graph, and `cyclomaticComplexity` is a real branch count — not a constant, and not
`symbols.length`. Structural depth, not a symbol count, is what the field means.

Single DFS pass over an **explicit stack** — no recursion, no child-array mapping,
O(depth) working set. Attribute extraction is one cursor per element. Identity
resolution is an O(1) map. Deferred in-document references resolve in O(L) *after*
the walk. `srcset` is one index pass. Subtree complexity is one reverse walk over the
emitted symbols, not an O(depth) walk per node.

### The performance envelope

Measured through the production `ASTEngine.parseFile` path with parsers pre-warmed,
Exposed (9.32 MiB over 400 files):

| | value |
|---|---|
| throughput | **4.7–5.3 ms/KiB** |
| per file | 112–182 ms, tracking file size |
| in-family comparison | **javascript 31.9 ms/KiB** on the same method and corpus — html is ~6× cheaper per KiB, so it is **not** an outlier |
| flatness | 4.7 ms/KiB on the 400-file draw, 5.3 on a 120-file draw of larger documents — no super-linear growth with size |
| duplicate-id page | **596 ms** for 4,000 elements sharing one id, vs 396 ms for 4,000 unique ids — 1.5×, where it was **17×** before the fix below |

`ms/KiB` is the portable unit; `ms/file` is not, because the cost is dominated by the
delegate sub-parse rather than the document walk. A page with no inline code is
materially cheaper than these figures and one with a large inline script is
materially more expensive.

These are **published as a measurement, not a budget**. `avgMsPerFile` for html lives
in `differential-baseline.json`, which only the canonical 28-language sweep writes, so
no gate enforces these numbers.

### The one super-linear path, and how it was found

Every published number came from real corpora, which are not adversarial. A page that
reuses one `id` across thousands of elements is — and it made the whole-document cost
**quadratic**: suffix allocation re-probed from 2 for every duplicate, so the k-th
duplicate cost k probes, because the per-handle counter was written once and never
advanced. 4,000 duplicates ⇒ ~8M probes ⇒ **15,516 ms against 912 ms** for 4,000
unique ids on identical input.

Isolated with three controlled shapes rather than a guess: depth was *not* the driver
(40,013 nodes with 1 symbol cost 12 µs/node; 40,012 nodes with 4,001 symbols cost
579 µs/node, so cost tracked **symbols**); `nearestNamed` was already frame-carried
and never the problem; the discriminator was one line of input — same id repeated
versus unique ids.

The fix advances a per-handle watermark, and its only acceptable property is that
naming is **byte-identical**. The watermark is a *lower bound*, not a guarantee,
because a document may declare `id="dup#2"` as a literal: the loop still probes and
skips an occupied slot. `html/identity-addressable` declares such a literal **before**
the duplicate that would claim it — the ordering where correct and naive allocation
necessarily disagree — and the proof is a **negative control**: the naive allocator
(watermark trusted, probe removed) was applied for real, and the fixture failed on the
missing `dupA#3` while the correct one passes. There is deliberately **no mutant**
here, and the fixture says why: a mutation harness transforms analyzer *output*,
where the collision does not exist and cannot be reproduced, and from that output a
literal `dupA#2` and an allocated `dupA#2` are the same string — telling them apart
*is* the defect.

## Differential ground truth

Oracle: `deriveHtmlEdges` in `script/m14/differential.ts`, written from the HTML
spec's carrier list and **deliberately not sharing the analyzer's table**.

| Draw | Files | Truth | Covered | MISSING | Unexplained |
|---|---|---|---|---|---|
| `otp` (primary) | 60 | 341 | **341 (100%)** | 0 | 0 |
| `sqlite` (second corpus) | 21 | 351 | **351 (100%)** | 0 | 0 |
| `Exposed` (depth) | 4,000 | 245,700 | **245,700 (100%)** | 0 | 0 |

`M12` re-measures against a **hand-audited** ground truth
(`validation/m12/ground-truth/html.json`, 45 facts, each quoting the source line it
was read from): **precision 1.000, recall 1.000, TP=45, FP=0, FN=0**,
`earliestFailingLayer=none`. The file is hand-authored and says so in its `source`
field, with a warning that regenerating it from analyzer output would destroy its only
function.

**The shared-premise lesson, which is the most important thing on this page.** Every
defect the differential could not catch was a premise the analyzer and the oracle
*agreed* on:

* a **shared rule** — the bare-`#` hole existed in four places (analyzer × 2, oracle
  × 2) and the differential reported 100% coverage *with the defect in its own truth*;
* a **shared table** — the carrier list, where six carriers were missing from **both**
  sides at once and no gate could see it;
* a **shared quote** — an earlier reported 1.4 ms/KiB was measured calling the
  analyzer directly, skipping the seam that dominates a real page.

A differential cannot catch a shared premise. That is what
`verify-carrier-census.ts` exists for: a third party that consults neither table and
can therefore contradict both.

## Corpus validation

Corpora: `otp` (hand-written pages), `sqlite` (full documents), `Exposed` (the only
clean tracked corpus with ≥1,000 HTML files — 4,255 tracked, 4,032 in the pool;
`proxicall` has 1,089 total but 12 tracked and a dirty tree, so it is **rejected**
rather than counted).

| Gate | State |
|---|---|
| F1 grammar audit | PASS — 13 refs, 0 unknown node types, 0 unknown fields |
| F2 evidence harness | PASS |
| F3 fixtures | **12/12** |
| F4 mutation | **59/59 caught** (the lane entered with 0 of 938) |
| F5 differential | 100% / MISSING=0 / unexplained=0 on both corpora |
| F6 fixture coverage | PASS — 14 handled, 26 fixture types, 0 uncovered, 0 dead literals |
| F7 hygiene | PASS — 25/25 analyzers clean |
| F8 corpus census | PASS — 60 files, 16 node types, 0 blind spots |
| F9 probe battery | **42/42**, of which 5 are html's own (IDENTITY, SCHEME, LINE, CARRIERS, BARRIER) |
| M12 differential | precision 1.000, recall 1.000 |
| M14.0.CENSUS | PASS — 61/61 pairs ruled, 38 carriers positively probed, 2 conditional carriers |
| M14.0.PIPE | 7 store-level assertions green through the **real CLI** |
| M60.R8 framework surface | 29/29; negative control drops it to 27/29 |
| SPEC #419 | A–D, G, H pass; **E/F await the canonical baseline pin** |
| CC1 | ranges, identity, document root, lines, schemes, analyzer-vs-oracle parity |
| regex census | **0** |
| typecheck | clean |

PIPE needs `tsx`, not `bun` — `better-sqlite3` cannot load under Bun
(`ERR_DLOPEN_FAILED`, upstream oven-sh/bun#4290). That is an environment limit, not an
html finding.

**Two gate defects were found and fixed while building this**, both recorded because
they are the kind that hide: an F5 allowlist gap that filtered the analyzer's
`contains` while the oracle's rows passed unfiltered (161 MISSING on `otp`, 167 on
`sqlite`), and a probe run that reported counts with no samples.

## Evidence pointers

| Artifact | Path |
|---|---|
| Completeness spec | `script/m14/spec/html-completeness.json` |
| Fixtures | `validation/m14/fixtures/html/` (12) |
| M12 hand-audited truth | `validation/m12/ground-truth/html.json` |
| Carrier census gate | `script/m14/verify-carrier-census.ts` → `validation/m14/results/M14.0.CENSUS.json` |
| Master review | `reviews/html/master-review.md` |
| Rulings narrative | [`html.md`](./html.md) |
| Ledger row | `validation/m49/ledger.json` → `HTML1` |
| Depth record | `validation/m60/results/depth-probes.json` |
| Grammar provenance | `grammars/tree-sitter-html/` |

## Issue

**#288.** Open.

**Not closed, and the only reason the M49 ledger row reads `known-gap`:** the
canonical F5 ceremony has not run at a stable tree, so
`differential-baseline.json` carries no html row and SPEC sections **E and F** are
red — which in turn holds M60's `folder`, `tracker` and `TRULY DONE` cells. Every
other measurement on this page is re-runnable today.
