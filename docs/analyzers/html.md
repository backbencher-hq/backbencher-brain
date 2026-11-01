# html.md

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
| Analyzer | `src/ast/real-html-analyzer.ts` — **2,078 lines** |
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

## Relationship ontology — all 10 types, each with a number

Measured on the production `ASTEngine.parseFile` path over **1,652 `.html`/`.htm`
files enumerated by readdir** from `$HOME/fixtures/repositories`
(1,652 parsed, 0 failed), by `script/m14/html-origin-census.ts`. Origin is
measured by **differencing the production path against the same path with the
inline-block seam switched off**, so it reads no metadata field and cannot
inherit the `htmlEmbedded` tagging defect the previous three commits documented.

| type | verdict | edges | files | html-own | delegate |
|---|---|---|---|---|---|
| `contains` | **EMITTED** | 12,174 | 1,174 | 10,811 | 1,363 |
| `uses` | **EMITTED** | 74,919 | 1,391 | 70,105 | 4,814 |
| `calls` | **EMITTED (delegate-only)** | 3,147 | 340 | **0** | 3,147 |
| `references` | **EMITTED (delegate-only)** | 78 | 7 | **0** | 78 |
| `instantiates` | **EMITTED (delegate-only)** | 47 | 47 | **0** | 47 |
| `imports` | **EMITTED** — importer channel | 4,682 rows | 707 | 4,675 | 7 |
| `extends` | **RULED** | 0 | 0 | — | — |
| `implements` | **RULED** | 0 | 0 | — | — |
| `overrides` | **RULED** | 0 | 0 | — | — |
| `exports` | **RULED** on the relationship channel; 575 rows on `exports[]` | 0 | 0 | **0** | 575 |

The independent arbiter agrees. `script/m14/html-ruled.ts` + the two-line
registration described in that file's header, run against the gate's own corpus
(1,252 git-tracked admitted files, `pool-worker.parseFile`) by
`validation/m14/fixtures/html/ruled-gate.ts`:

```
calls EMITTED 3,057 · uses EMITTED 73,262 · contains EMITTED 10,561
imports EMITTED 13 · references EMITTED 78 · instantiates EMITTED 46
extends RULED-SOUND · implements RULED-SOUND · exports RULED-SOUND · overrides RULED-SOUND
emitted 6/10   ruled-sound 4   FALSIFIED 0   ruled-without-justification 0   exit 0
```

**html's OWN code constructs two relationship types.** Everything else that fires
arrives through the inline `<script>`/`<style>` seam. So on this corpus three of
the six firing types — `calls`, `references`, `instantiates` — exist **only** on
the delegate side, and `exports[]` is 100% delegate (575 rows, 0 html-own).

### The four rulings, with the measurement that rules each

None of these is prose. Each names the probe that overturns it, and the probes
run in `script/m14/html-ruled.ts` and `script/m14/html-origin-census.ts`.

**Grammar inventory (instrument A) — positive evidence of absence.** Over 1,652
documents tree-sitter-html produces **20 named node types** and the gate, walking
all children including anonymous tokens, counts **28**; the 8 extra are pure
punctuation (`'`, `"`, `<`, `</`, `<!`, `>`, `/>`, `=`). Not one of either list
denotes a declaration, class, interface, member or method.

| type | probe | measurement |
|---|---|---|
| `extends` | A, plus both customized-built-in spellings on the tree | no declaration node type exists; `is="…"` **0**/1,652 and Polymer's pre-standard `extends="paper-item"` **0**/1,652 — probed separately, because probing only the spelling that happens to occur scopes a ruling to an accident |
| `implements` | B: `role="…"` values **outside** the WAI-ARIA enumeration | `role=` **365 occurrences / 350 files / 9 distinct values**, and **365 of 365** are ARIA members. Zero outside. Four of the nine — `button`, `main`, `document`, `dialog` — collide with names this analyzer's own identity ruling publishes, so the edge would bind to a DOM element |
| `overrides` | A, plus the one suppression construct and the duplicate-id case on the tree | no member/method/class-body node type; `role="none"`/`role="presentation"` **6**/2 files, naming an ARIA token and not a declaration; a duplicate `id` resolves **first-wins** (`getElementById`), which is why this analyzer allocates a deterministic `handle#N` rather than letting the later element win |
| `exports` | B: `<slot name>`, `<slot>` in any form, and `part=` | **0 / 0 / 0** over 1,652 files. The whole slot vocabulary, not just the named case — a ruling stated over the narrower population rests on a subset nobody measured. `part=` (Shadow DOM parts, CSS `::part()`) is the strongest `exports` candidate HTML has and occurs zero times |

### `instantiates` is EMITTED, and the construct that looks like a GAP is not

`instantiates` fires 47 rows, 100% delegate, 0 html-own. The construct that would
let html emit it itself — a hyphenated element tag — occurs **2,010 times**, so
the count was interrogated rather than quoted, by
`script/m14/html-custom-element-join.ts`:

```
1,652 html documents read · 14,193 js/ts files enumerated, 39 parsed
2,010 hyphenated-tag occurrences · 1,005 distinct tag names · 10 of 1,652 documents
0 distinct customElements.define("<name>", …) names exist in the corpus
0 of 2,010 name a registered custom element
```

and where they live, which is the half that supports any ruling:

| occurrences | tags | file |
|---|---|---|
| 2,000 | 1,000 | `roslyn-cs …/legacyTest/TestFiles/nested-1000.html` |
| 2,000 | 1,000 | `roslyn-cs …/test/TestFiles/nested-1000.html` |
| 4 | 1 | `roslyn-cs …RazorSourceGeneratorTagHelperTests/VoidTagName_SelfClosing/…` |
| 4 | 1 | `roslyn-cs …RazorSourceGeneratorTagHelperTests/VoidTagName_Prefixed/…` |
| 1 | 1 | `svelte …/attribute-strip-svg-mathml-ce/_expected.html` (an SSR expected-output fixture) |
| 5 | 3 | 5 `vuejs` example pages — `<demo-grid>`, `<tree-item>`, `<transition-group>` |

Both Razor files are a generated compiler stress fixture (1,000 levels of
`<elem-N>`, testing the recursion limit). The vuejs pages load
`../../dist/vue.global.js` and register those three names through
`Vue.createApp({components:{…}})` — the hyphen is Vue's multi-word-component
convention, and there is no `customElements.define` anywhere. So emitting one
`instantiates` edge per occurrence would manufacture 2,010 edges, 99.7% of them
from a generated fixture, each with an endpoint that resolves to nothing. The
construct occurs; the **instantiation** does not.

## Relationship ontology

Every applicable label is emitted. Labels with no HTML construct (`extends`,
`implements`, `overrides`, `exports`) are **absent, with a measurement each** —
the table above, and `script/m14/html-ruled.ts`. The previous wording here read
"measured at 0 exports across 1,200 files, because markup has no module surface".
The reason was right about html and the framing was wrong: 575 `exports[]` rows
arrive on this corpus, every one of them from the inline-JS delegate.

| Label | Emitted for | By | Confidence | Tier |
|---|---|---|---|---|
| `contains` | DOM containment, document module → top-level included | html | 1.0 | `structural` |
| `uses` | fetched resources, in-project navigation, form endpoints, resolved in-document references, citations | html | 1.0 fetch / 1.0 reference / 0.9 navigation | `import_based` / `structural` / `usage_contextual` |
| `contains` | the delegate symbol → its owner, created by the SEAM | seam | 1.0 | `structural` |
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
| a hyphenated element tag, as a **web-component claim** | the tag is a *potential* custom element under the HTML spec's naming rule, not a *registered* one, and registration is `customElements.define(name, class)` in a JavaScript file — a cross-file fact this analyzer cannot see. Measured: **2,010 occurrences, 1,005 distinct names, 0 registered** (`html-custom-element-join.ts`). The analyzer used to publish `Web Components` into `detectedFrameworks` on the strength of the tag alone, which fired on pages using no web components at all: 2,000 of the 2,010 are two generated Razor stress fixtures, the other 10 are vuejs example pages whose tags are Vue components. The **count** is still published (`documentMetrics.customElementCount`) and still drives an insight, worded now as what it is: `Custom-element-shaped tags present; registration not observable from this document` |
| an ARIA `role` as an `implements` target | a specification token from a closed 81-value enumeration the project does not own. 365 of 365 corpus occurrences are ARIA members, and `button` / `main` / `document` / `dialog` collide with names this analyzer's own identity ruling publishes |

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

**The inline-block seam — MEASURED, per origin.** `<script>`/`<style>` bodies are
handed to the JS, TS and CSS analyzers as sub-parses and merged with
**file-coordinate** lines; the applied offset is recorded on every row as
`metadata.embeddedLineOffset`, so the shift is auditable rather than merely
correct.

Origin is measured by differencing the production path against the same path with
the seam switched off (`html-origin-census.ts`), so it reads no metadata field:

| channel | total | html-own | delegate | delegate share |
|---|---|---|---|---|
| `contains` | 12,174 | 10,811 | 1,363 | 11.2% |
| `uses` | 74,919 | 70,105 | 4,814 | 6.4% |
| `calls` | 3,147 | **0** | 3,147 | **100%** |
| `references` | 78 | **0** | 78 | **100%** |
| `instantiates` | 47 | **0** | 47 | **100%** |
| `imports[]` | 4,682 | 4,675 | 7 | 0.15% |
| `exports[]` | 575 | **0** | 575 | **100%** |
| symbols | 13,604 | 12,463 | 1,141 | 8.4% |

**Every merged row now carries its origin** (`htmlEmbedded` / `embeddedLang` /
`embeddedLineOffset`), on every channel including the two the seam used to leave
unmarked — its own `contains` rows and the whole `exports[]` channel. Measured
before: 245 of 921 delegate rows on vuejs and 8 over 1,652 documents arrived with
no tag, and the method's own header told auditors to use that tag as the origin
test. Measured after: **0 untagged**, and the tag count (9,463) equals the
path-difference count exactly, so the two independent methods agree.

**Q4 — the labelling of in-document references is the one open question here, and
it is now a number rather than a preference.** html resolves **4,496** in-document
IDREF references on this corpus — 4,271 fragment hrefs (`a@href` 4,268,
`use@xlink:href` 3, in 384 files) and 225 `label@for` (52 files) — and labels
every one of them `uses` with `evidenceClass: "structural"`. html's own
`references` count is **0**; all 78 are the CSS delegate's.

The case for `references`: the CSS analyzer emits it for exactly this shape — a
name in one place naming a declaration elsewhere in the same document, with no
fetch and no control flow (`real-css-analyzer.ts:3491`, `var(--x)` →
`--x`; `:1666`, a namespace prefix → its `@namespace`; `:2180`, a custom-media
name → its declaration). A `<label for="x">` → the element with id `x` is that
same shape, and the edge already declares itself `structural` rather than a
usage, so the label and the evidence class disagree.

The case against, and it is why this was not changed unilaterally: the independent
oracle `deriveHtmlEdges` labels both forms `uses` with a long comment on the
resolution (`differential.ts:21367`), so analyzer and oracle agree — and two
independent derivations agreeing is the strongest evidence available here.
Relabelling 4,496 published edges would also make html's own `references` a
**DERIVATION finding** (emitted, compared against nothing), because
`references` is not in html's audited label set in `differential.ts`. Closing this
needs the oracle and the analyzer changed in step; `script/m14/**` is not this
lane's to edit. Recorded for the owner with the exact line.
 Delegates are resolved **lazily and
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

## The six questions, per already-emitted type

Part 1 of the ontology workstream. Source derivation answers only Q1, so each
question below carries its own measurement. All figures over the 1,652-document
population above unless stated.

**Q1 EXISTS.** Counted from source: this analyzer's own code constructs
`RelationshipType.Contains` and `RelationshipType.Uses` and nothing else. Every
other type it publishes arrives through the seam. That is the limit of
derivation, and it is why the rest of this section exists.

**Q2 FIRES.** The table above. `contains` 12,174 / `uses` 74,919 /
`calls` 3,147 / `references` 78 / `instantiates` 47 / `imports[]` 4,682 /
`exports[]` 575. Nothing here is reachable only from a branch that never
matches; the four silent types are silent for the measured reasons in the
rulings table, not because their code is dead.

**Q3 CORRECT — and the harness's declared limit, stated rather than exceeded.**
`deriveHtmlEdges` is a separate walker over the *same* grammar, so a grammar bug
shared by both paths is invisible to it by construction; 60 files is a sample,
not a sweep. What it does cover: `contains` and `uses` only, at 329/329 (`otp`)
and 349/349 (`sqlite`), 100%, MISSING 0, unexplained 0, heuristic 0.
**It derives no `calls`, no `references`, no `instantiates` and no `exports`, and
it drives the analyzer through `analyzer.analyze(root, content, relPath)`
(`differential.ts:22092`) with no `htmlEmbeddedTrees` — so the seam never runs
inside the differential at all.** That is this lane's DERIVATION finding, and the
measurement of it is stark: production `parseFile` emits **853** relationships on
otp (of which **404 are delegate**, 218 of them `calls`) and **1,202** on sqlite
(**825 delegate**, 338 `calls`, 8 `references`), while the differential compares
only the html-own subset. So 47% of otp's and 69% of sqlite's real graph is
audited by nothing.

`script/m60/rel-type-coverage-gate.ts --langs=html` reports CHECK 1 DERIVATION
**clean**, and that is not a contradiction: the check reads the analyzer's SOURCE
(`RelationshipType.X` usages) and evaluates `differential.ts`'s filter
expression, so it sees the two types html constructs and cannot see the four the
seam contributes. **html is DERIVATION-clean by source scan and
DERIVATION-blind by measurement.** The gate cannot tell the difference, and the
workstream's own list of 100 DERIVATION findings was built by the source scan, so
this lane is a member of the *substance* of that list without appearing in it.

The oracle also **misses** 36 `uses` on 32 alamofire documents that the analyzer
withholds: `<link rel="alternate" type="application/dash-feed-xml">` with a
`dash-feed://…` value, which the analyzer drops on the scheme contract and the
oracle does not apply that filter to. The lane's declared corpora (`otp`,
`sqlite`) contain no such document, which is why `MISSING=0` never had to
confront it — the shared-premise lesson in its sharpest form.

**Q4 LABELLED.** `contains` and `uses` carry the right label for every carrier
the census can check, and the carrier table is consulted by a third party
(`verify-carrier-census.ts`) that reads neither the analyzer's table nor the
oracle's. One open question, with a number: html resolves **4,496** in-document
IDREF references and labels every one `uses`, while the CSS delegate emits
`references` for the structurally identical `var(--x)` case. See the Q4 note in
*the inline-block seam* above for why that was reported rather than changed.

**Q5 RESOLVED.** Classified without reading any analyzer field: an endpoint is
`sym` if it names a symbol of the merged file, `file` if it resolves on disk
relative to the document, `neither` otherwise.

| origin | endpoints | sym | file | neither |
|---|---|---|---|---|
| html-own | 161,832 | 96,013 (59.33%) | 56,209 (34.73%) | 9,610 (**5.94%**) |
| delegate | 18,926 | 10,178 (53.78%) | 0 | 8,748 (**46.22%**) |

`neither` on the html-own side is dominated by path dependencies that name a file
outside the sampled directory tree (`href="/assets/…"`), not by unnameable
endpoints. The delegate's 46.22% is the CSS/JS analysers' own resolution rate and
belongs to those lanes. For comparison the workstream cites CSS `references`
resolving at both ends on 66.8%; this lane's html-own `uses` resolves at both
ends on 94.06%.

**Q6 CONFIDENT.** Per origin, over 80,916 html-own and 9,463 delegate rows:

| confidence | html-own | delegate |
|---|---|---|
| 1.0 | 20,060 | 1,337 |
| 0.95 | 0 | 50 |
| 0.9 | 60,856 | 3,147 |
| 0.85 | 0 | 106 |
| 0.6 | 0 | 4,706 |
| **no `confidence` field at all** | **0** | **117** |

**html emits no sub-threshold edge and no edge without a confidence field.**
The 117 are the CSS delegate's, and the attribution is exact: `css/references` 74,
`css/contains` 38, `css/uses` 4 — `src/ast/real-css-analyzer.ts` has **16**
`relationships.push` sites that write no `confidence` (lines 722, 1663, 1825,
1838, 1847, 1856, 1865, 1901, 2177, 3157, 3266, 3355, 3397, 3420, 3451, 3488), of
which 6 also write no `line_number`, matching the **10** delegate rows with no
line measured here. Not this lane's file; reported with line numbers.

evidenceClass per origin: html-own `usage_contextual` 61,144 / `structural`
15,097 / `import_based` 4,675; delegate `usage_contextual` 7,961 / `structural`
1,410 / `import_based` 89 / `reference_qualified` 3.

**R7 invariants, html-own.** 0 relationships without a `line_number`, 0 with
`line_number <= 0`, 0 empty symbol names, 0 whitespace-only names, 0 empty or
`unknown` `SymbolKind`, **0 endpoints equal to the placeholder literal `unknown`**.
Delegate side: 0 empty names and 0 placeholder endpoints; 10 rows without a
`line_number` (CSS, above).

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
| F1 grammar audit | PASS — 18 refs, 0 unknown node types, 0 unknown fields (re-run 2026-10-05) |
| F2 evidence harness | PASS |
| F3 fixtures | **13/13** (12 + `embedded-origin-marks`); 3 negative controls, all run, all observed to FAIL |
| F4 mutation | **59/59 caught** (re-run 2026-10-05, `BB_MUTANT_ONLY="html/"` of 1,791) |
| F5 differential | 100% / MISSING=0 / unexplained=0 / heuristic=0 on both corpora — `otp` 329/329, `sqlite` 349 truth rows (re-run 2026-10-05) |
| F6 fixture coverage | PASS — 14 handled, 26 fixture types, 0 uncovered, 0 dead literals |
| F7 hygiene | PASS — html clean; the gate reports 3 findings, all in `cpp`/`haskell`/`elixir` |
| F8 corpus census | PASS — 60 files, 16 node types, 0 blind spots |
| F9 probe battery | 5/5 html probes `ok` (IDENTITY, SCHEME, LINE, CARRIERS, BARRIER); the gate's 2 failures are `F9-PROBE-M3710-PHP` and `F9-PROBE-CLEAN-HEAD-PATTERN`, neither html |
| M12 differential | precision 1.000, recall 1.000 |
| M14.0.CENSUS | **PRE-EXISTING FAILURE, not html's to fix** — see below |
| ontology arbiter | `script/m14/html-ruled.ts` — `emitted 6/10  ruled-sound 4  FALSIFIED 0  ruled-without-justification 0`, exit 0. **Needs 2 registration lines in `ontology-coverage-gate.ts`; until they land the arbiter exits 2 for html** |
| payload / latency | edge count **unchanged** (2,879 / 826 over a fixed 90-file draw, before and after); relationship metadata 337.9 → 353.4 KiB and `exports[]` metadata 0.0 → 10.7 KiB, i.e. **+26.2 KiB (+5.1%) for zero new edges**. Latency **not resolvable**: 4.33–10.68 ms/KiB across 3 runs of identical code |
| regex census | **0** |
| typecheck | clean |

**`M14.0.CENSUS` fails, and did before this work.** `verify-carrier-census.ts`
exits 1 with **89 distinct `(tag@attr)` pairs carrying a reference-shaped value,
63 ruled, 26 unruled** over 1,654 html files across 61 repos. Reproduced
identically in the main checkout, so it is not caused by anything on this branch.
The 26 are template-language and microdata carriers the corpus grew into:
Thymeleaf (`a@th:href` 17, `html@xmlns:th` 12, `input@th:replace` 10,
`html@th:replace` 9, `li@th:replace` 4, `link@th:href` 3, `img@th:src` 3,
`span@th:each` 3, `tr@th:each` 3, `script@th:src` 1, `form@th:action` 1,
`p@th:each` 1), Razor `HtmlEncode[[…]]` (`object@archive` 6, `dl@itemid` 2,
`input@itemid` 2, `menuitem@icon` 2, `applet@archive` 2), Jinja/Django
(`ol@start` 1), JSP EL (`form@%}enctype` 1), EXSLT (`li@xmlns:strings` 1),
schema.org microdata (`div@itemtype` 2, `h1@itemtype` 1), the deprecated Open
Graph `head@prefix` 1, a Go template `a@url` 6, and **`base@href` 13** — which
is the one this lane has a written position on (see *Unsupported constructs*) and
therefore the cheapest row to add. The gate, `RESOURCE_RULES` and the oracle
mirror are all in `script/m14/**`, which is not this lane's to edit.

**The honesty gate reports 21 failures on this branch against 22 in the main
checkout**, all of the form "declared inputs changed since `<sha>` — regenerate".
It is a global artefact-freshness condition, not an html verdict; the lane does
not make it worse. Every `validation/**` artefact the gates wrote while measuring
was reverted, because those files belong to the owner.
| M14.0.PIPE | 7 store-level assertions passing through the **real CLI**, recorded in `validation/m14/results/` |
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
| Fixtures | `validation/m14/fixtures/html/` (13, incl. `embedded-origin-marks` for the origin disclosure and `ruled-gate.ts`, which proves the ruling table against a copy of the shared arbiter) |
| M12 hand-audited truth | `validation/m12/ground-truth/html.json` |
| Carrier census gate | `script/m14/verify-carrier-census.ts` → `validation/m14/results/M14.0.CENSUS.json` |
| Origin census (six questions, per origin) | `script/m14/html-origin-census.ts` |
| Custom-element join (the `instantiates` falsifier) | `script/m14/html-custom-element-join.ts` |
| Payload / latency | `script/m14/html-payload-latency.ts` |
| Ruling table + proof runner | `script/m14/html-ruled.ts`, `validation/m14/fixtures/html/ruled-gate.ts` |
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
