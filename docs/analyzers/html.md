# html

> **This file is the RULINGS narrative** — why each decision was taken, and the defect
> each one closed. The **canonical contract reference** is
> [`real-html-analyzer.md`](./real-html-analyzer.md): what the analyzer emits, what it
> refuses to emit, and the measurements behind both. The two are kept distinct on
> purpose — an earlier state of this lane had two overlapping copies of the same
> contract, and the stale one still claimed `calls` was `form action` two releases
> after the analyzer stopped emitting it.
>
> **Status: INVENTORY-DONE** on the M14 #419 ladder (`NOT-STARTED` →
> `INVENTORY-DONE` → `GAPS-CLOSED` → `CONFORMANT`). Section A is complete — **21/21
> rows classified, gap list empty** (19 grammar node types plus the universal
> `ERROR`/`MISSING` recovery pair). B and D are carried by **twelve** fixtures, C and
> G by the registered carrier census, and H by CC1's html block (12 truth rows == 12
> analyzer edges). E and F are measured but **unpinned** — that is the canonical F5
> ceremony, and it is the only thing keeping the M49 ledger row at `known-gap`.
> `script/m14/completeness-inventory.ts --lang html` prints the live per-section
> verdict. **`HTML-G1` is closed** (see the inline-block seam below).

## Language

| | |
|---|---|
| Analyzer | `src/ast/real-html-analyzer.ts` (`RealHtmlAnalyzer`) |
| Grammar | `wasm/tree-sitter-html.wasm` — upstream `tree-sitter/tree-sitter-html`, vendored at `grammars/tree-sitter-html` (Matrix 4 provenance, closes the per-wave `#864` item for this lane) |
| Detection | `.html` / `.htm` → `html` (`src/ast/language-detection.ts`) |
| Wired in | `src/ast/engine.ts` `getAnalyzer` |
| Family | **web** — the last web-family language to enter a gate |
| Tracking | #288 (`Analyzer html: reach L5 SCOPED-VERIFIED`) |

## Why this file exists

html carried an M12 corpus claim, a regex-census row and a passing grammar
audit, and **no fixture, no mutant, no differential oracle and no completeness
spec**. Every M14/M49/M60 cell read `n/a` — the gates could not ask the
question. That is how the defects below survived a green board: they were
measured, written down in prose, and gated by nothing.

## The rulings

### HTML-IDENTITY — an element is a symbol because it is ADDRESSABLE

`real-vue-analyzer.ts:13` and `real-svelte-analyzer.ts:14` both publish
*"Template elements/attributes/directives are NEVER symbols."* html **is** a
template language, so it inherits that rule — and adds the one construct an SFC
template does not have: a document-level address space.

- `id` is the document's unique handle (`getElementById`).
- `name`, when there is no `id`, is the form/anchor handle (`getElementsByName`)
  — and it is the target of `<label for>`.
- **`class` is a shared styling hook, never an identity.** N elements
  legitimately carry it, which is exactly why it cannot name one. It stays
  readable in `metadata.attributes`.
- The **document is the module symbol** (name = file stem, `kind: module`), so
  the containment tree has one root instead of N disconnected ones and a
  document-level resource edge sources from a real, joinable symbol.

**Measured on the pre-ruling analyzer, 139 real corpus documents:**

| | before | after |
|---|---|---|
| symbols | 3,061 | 1,453 |
| symbols with a **unique** name in their own file | 1,228 (40.1%) | **1,453 (100%)** |
| symbol names containing whitespace | 881 (28.8%) | **1** |
| files containing any duplicate name | 25/139 (18.0%) | **0/139** |

The one remaining whitespace name is real: `<a name="Harley Davidsson">` in
`otp/lib/xmerl/doc/assets/result_xs.html`, a legitimate named anchor. It is
attributed to `metadata.identityAttribute: "name"`, so a reader knows why.

### DUPLICATE-IDENTITY — first wins, then a deterministic suffix

A duplicate `id` is invalid HTML. The **first in document order** keeps the plain
name (that is what `getElementById` returns); later ones take a deterministic
`#N` suffix — the rust RSD3 answer to 2,852 same-name ids there — and carry
`metadata.duplicateId`. In-document references resolve to the first and carry
`metadata.ambiguousTarget` when a second exists. No two symbols ever share a
name.

### SCOPE BARRIERS — `<template>` and `<slot>`

Their content is an inert fragment / light-DOM fallback and is **not rendered
where it is written**, so it is not a child of what encloses it in the source. An
**addressable** barrier owns its own fragment; a **bare** one does not — its named
descendants belong to the nearest live ancestor, carrying
`metadata.inTemplateBarrier`. The pre-fix analyzer claimed
`template contains inner` for markup that never enters the document, and a
`<template id="x">` collided with its live-DOM twin as two identically-named
symbols.

### RESOURCE MODEL — a table, not a branch chain

`RESOURCE_RULES` is data, so it can be **enumerated** — by a reader, by the F6
dead-literal check, by the F8 census — and adding a carrier is one row. The
pre-fix analyzer was an `if/else if` chain over ten tag names, and a carrier
nobody thought of in that chain simply did not exist. **Eight produced nothing**,
each verified one document at a time:

| carrier | pre-fix |
|---|---|
| `<object data>` | no `object` branch at all |
| `<embed src>` | no `embed` branch at all |
| `<track src>` | no `track` branch — every video's captions invisible |
| `<input type=image src>` | `input` was read only through its form table |
| `<iframe src>` | the branch counted a missing `loading` and never read `src` |
| `<source srcset>` | only `src` was read |
| SVG `use`/`image` `href` + `xlink:href` | no `use`/`image`/`svg` string in the file |
| `<base href>` | no `base` branch — and it fetches nothing, so it is a **document metric**, not an edge |

`<source>`'s pre-fix gate also required the **immediate** parent to be
picture/audio/video, so one wrapper element lost the resource — and a `<picture>`
inside a grid cell is not a rarity.

### SCHEME CONTRACT — a hyperlink is not a code dependency

External schemes — `http:`/`https:`/`ftp:`/`mailto:`/`tel:`/`sms:` and the rest
of `ORACLE_HTML_SCHEME_SKIP` — produce **no edge** and are counted as
`documentMetrics`. The pre-fix analyzer emitted a `uses` edge for every one it
did not filter, so a page linking to fifty external sites published fifty graph
edges that the enrichment pass then scored for architectural criticality —
measured at **237** such edges across 51 real documents.

**`javascript:` is the one exception, and it is deliberately an edge.** A
`javascript:` URL is a real hazard the document contains, and the analyzer
records it as one (`resourceType: "javascript-url"`, `isScriptUrl`). Filtering
it out was the *other* failure: a lane that refuses to emit a hazard is how the
hazard goes unreported. All five spellings — `javascript:`, `JavaScript:`, a
leading space, `&#106;avascript:` and `&#0000106;avascript:` — collapse to the
single row `uses <owner> -> javascript:`, because the value is **decoded before
the scheme test**. The first cut of this rewrite had it backwards (no edge), and
only the F9 probe battery caught it: `otp` and `sqlite` carry no `javascript:`
URL at all, so `unexplained=0` never had to confront the disagreement between the
analyzer and the oracle.

**A bare `#` names no target.** `href="#"` is the HTML idiom for "no
destination" — a valid URL referring to the top of *this* document, which the
document module already is — so it emits **nothing**. An edge to the literal
text `#` is a target that is neither a symbol nor a file, which is the
unresolvable-identity defect class in its most literal form. Both the analyzer
and the differential oracle had this hole in **two places each** (a
`length > 1` guard excludes `#frag` and lets `#` through), and `sqlite` alone
carried three live rows of it before it was fixed; the differential was
reporting 100% coverage *with the defect in its own truth*.

Its filter was a bare `startsWith("javascript:")`, so it was case-sensitive,
whitespace-sensitive, and present **only in the `<a>` branch**. Decoding now
runs **before** the scheme test, which is what catches `javascript:alert(1)`,
` javascript:alert(2)`, `&#106;avascript:alert(3)` and
`&#0000106;avascript:alert(4)` — the last two being the forms an HTML parser
sees as identical to `javascript:`.

A **form endpoint** is a real dependency and is a `uses` edge with
`isFormEndpoint`, **not** a `calls` edge: `Calls` claims *this symbol invokes
that symbol*, which is false for a URL. Since `uses`/`contains` were the only
other types the pre-fix analyzer emitted, **the html lane's entire call graph was
URLs**.

## Symbol contract

| Field | Supported? | How |
|---|---|---|
| `name` | ✅ | the element's `id`, else its `name`; a duplicate takes a deterministic `#N` suffix |
| `kind` | ✅ | `module` for the document, `class` for an addressable element |
| `ownerName` | ✅ | nearest addressable ancestor, else the document module |
| `range` | ✅ | 1-based, the whole element node (CC1) |
| `complexity` | ✅ | the addressable **subtree size** — the DOM analogue of a declaration's statement count; computed in the same O(n) pass by a single reverse walk |
| `visibility` | ✅ | always `public`: html has one scope, and a private/package value would be a fabrication |
| `parameters` / `returnType` | — | n/a — an element is not a callable. Deliberately **not** claimed in the completeness spec's payload matrix. |
| `docstrings` | — | n/a |

## Relationship contract

Every applicable label is emitted, and the labels that have no HTML construct
(`extends`, `implements`, `instantiates`, `overrides`, `exports`) are correctly
**absent** — measured at 0 exports across 1,200 corpus files, because markup has
no module surface to export.

| Label | Emitted | By | Confidence | Tier |
|---|---|---|---|---|
| `contains` | DOM containment between addressable nodes, module → top-level included | html | 1.0 | `structural` |
| `uses` | fetched resources, in-project navigation, form endpoints, resolved in-document references | html | 1.0 fetch / 1.0 reference / 0.9 navigation | `import_based` / `structural` / `usage_contextual` |
| `uses` | a bare identifier read inside an inline `<script>`/`<style>` | **delegate** | **0.60 — unclaimed** | `usage_contextual` |
| `calls` | invocations found inside an inline `<script>`/`<style>` | **delegate** | 0.9 | `usage_contextual` |
| every edge | carries `line_number` — **1-based, the call site, never a fabricated `0`** (M59.O2 / R6). Measured **0 of 45,768** edges without a line and **0** with a line ≤ 0 | | | |

`calls` is emitted **only** by the embedded-block seam: on 400 corpus files,
3,016 `calls` edges, of which **3,016 came from the JS/TS delegate and 0 from
html**. Markup has no invocation semantics of its own — a `<form action>` is a
navigation the *browser* performs, which is exactly why it is `uses` and never
`calls`. An earlier version of this table said `calls` was never emitted; that
was written before the inline-block seam landed and was wrong from the moment
that seam existed.

**The 0.60 tier, disclosed rather than averaged away.** 8.24% of emitted edges
are sub-threshold — a `bareRead` field access inside an inline script, which the
JS analyzer emits as a *guess* and marks as such. All 3,770 are `uses` from the
`js` delegate; **html's own edges are 0.9 or 1.0, without exception**. A
sub-threshold edge is not a defect: the store records it as an unclaimed
observation, the M12 differential scores it as `unknown` rather than as a false
positive, and the reason a bare read is a guess is that `obj.field` is a
declaration in one file and a property of something else in another. What matters
for a consumer is that the number is *known* and attributable, not that it is
zero — and it is attributable to exactly one origin.

`imports` mirrors every fetched project-relative module, and an import's `range`
is the **attribute's**, not the element's — the pre-fix element range made a
multi-line start tag produce a wrong import line.

## Regex inventory

**Zero.** The analyzer is pure-String: `asciiLower`, `unquote`, `decodeCharacterReferences`,
`urlScheme`, `isProtocolRelative`, `fragmentTarget`, `srcsetCandidates`,
`firstToken` and `isHtmlSpace` are all index loops. The M12 regex census carries
no html row and M49.R2 is clean for this lane by measurement, not by exemption —
**and it is now load-bearing**: a `String`-helper bug that made `asciiLower` the
identity function on every string containing a capital survived because every
input the lane had ever been measured against was already lowercase, where
identity and lowercase agree.

## The embedded-block seam is fault-isolated

Inline `<script>` and `<style>` bodies are handed to the JavaScript, TypeScript
and CSS analyzers as sub-parses, and their symbols and relationships are merged
with **file-coordinate** line numbers (the applied offset is recorded on every
row as `metadata.embeddedLineOffset`, so the shift is auditable rather than
merely correct).

The three delegates are resolved **lazily and independently**, and deliberately
not as static imports. A static import makes a broken delegate a *load-time*
failure of this module: while the CSS analyzer was mid-rewrite with 5 build
errors, every HTML file in the project fell back to `2.0-basic-fallback` and
yielded zero symbols, zero relationships and zero imports. A template language
held hostage by a script language, and invisible until a neighbour's work was
half-done.

Now a delegate that fails to load costs exactly the blocks it would have served.
The document's own elements, containment, resources, references and lines are
untouched and the surviving languages still merge — verified against the real
failure, not a simulated one: with CSS broken, the JS symbols, the `imports`
edge and all four `calls` rows still arrived with correct file-coordinate lines.

The skip is **disclosed** as `metadata.unavailableEmbeddedLangs`, because a
silently missing block set reads as *a document with no code in it* — which is
the HTML-G1 defect returning through a different door. A consumer asking "does
this file contain code?" has to be able to tell "no" from "not measured", and
only a published field can say that.

## Evidence

| Gate | State |
|---|---|
| **F1** grammar audit | ✅ pass — 11/11 node-type literals real, 0 unknown, 0 dead field reads |
| **F3** fixtures | ✅ **12/12** — `identity-addressable`, `attribute-case-and-srcset`, `element-forms`, `resource-carriers`, `scheme-and-navigation`, `scope-barriers-and-references`, `inline-embedded-code`, `undiscovered-carriers`, `error-recovery`, `framework-and-scores`, `error-budget`, `error-budget-broken` |
| **F4** mutation | ✅ **59/59 caught** (the lane entered with 0 mutants out of 938) |
| **F5** differential | ✅ **100% / MISSING=0 / unexplained=0** on **both** corpora — `otp` **341/341** primary, `sqlite` **351/351** second, against `deriveHtmlEdges` (written from the HTML spec's carrier list, deliberately not sharing the analyzer's table) |
| **F9** probe battery | ✅ **42/42**, of which **5 are html's own**: `IDENTITY`, `SCHEME`, `LINE`, `CARRIERS`, `BARRIER`. The battery asserts the analyzer AND the oracle, and that the oracle derives nothing on the forbidden set |
| **M12** differential | ✅ precision **1.000**, recall **1.000**, TP=45 FP=0 FN=0, `earliestFailingLayer=none`, against a ground truth **re-audited by hand** (45 facts, each quoting the source line it was read from) |
| **PIPE** store seam | ✅ 7 store-level assertions through the **real CLI** (`node bin/bb index` → `brain.db`): document-root containment sourced from a `module`-kind symbol, `dup-target#2` persisted as its own node, srcset fan-out as three distinct rows, zero NULL lines, a fragment href persisted as the resolved symbol `content` rather than the text `#content`. Run with `tsx` — `better-sqlite3` cannot load under Bun |
| **M60.R8** framework surface | ✅ **29/29**; negative control re-injecting `Targeted/ID-Styling` drops it to 27/29, which is what proves the cases are load-bearing |
| **M14.0.CENSUS** carrier census | ✅ **registered gate** — 61 distinct `(tag@attr)` pairs over 4,000 files / 313,582 reference-shaped occurrences, all ruled; 38 claimed carriers positively probed; 2 conditional carriers probed. Consults neither the analyzer's table nor the oracle's, because a differential cannot contradict a premise it shares. Negative control: removing `use@href`, `a@ping`, `body@background` or `meta@content` each exits 1 **naming the pair**; restored exits 0 |
| **SPEC** #419 | ⚠️ sections **A–D, G, H pass**; **21/21 rows classified** (19 grammar node types plus the universal `ERROR`/`MISSING` pair), **gap list empty**. **E/F await the canonical baseline pin** and are the only red cells. Section A had been *reported* green at 19/19 and was in fact red — `ERROR` and `MISSING` were in no bucket, and the earlier count predated the grammar's node list growing. Both are now classified on measurement: `ERROR` is live and pinned by `html/error-recovery` (report at the node's own span, bypass it, keep publishing around it), `MISSING` never occurs in this grammar across twelve malformed probes and is silent with the defensive read kept — the same split `bash` already records |

### What the hand audit changed that no gate did

Four defects were found in session 2, and **two of them by hand** — reading the
M12 ground truth against live output rather than running a script. The
differential was reporting 100% coverage with a known-bad node in its own truth,
and a fixture asserting another lane's internal edge set made this file fail on a
redesign it had no stake in. Both are recorded in place with their reasons.

The M12 re-audit also **retracted one assertion the old truth made**: a
`javascript:` URL emits nothing. That was the more dangerous of the two errors,
because suppressing a hazard is worse than over-reporting one.

## `HTML-G1` is closed; the one open gap is the ceremony

**`HTML-G1` — `raw_text` — is FIXED.** The body of an inline `<script>` or
`<style>` is a single opaque leaf, and the polyglot path keyed on
`metadata.embeddedScriptContent`, which no analyzer had ever set, so **5,389 of
6,094 corpus files (88.4%)** carried an inline block producing zero symbols. The
cause was a seam, not a missing branch.

The seam now extends to html with **reused cached parsers** (a fresh `Parser` per
file exhausted the fixed-size wasm heap on the svelte lane at `--sample 400`),
merging the delegate's payload with byte-accurate line and index offsets and
recording the applied offset on every row. Pinned by
`html/inline-embedded-code`, whose expectations are authored in **file** lines
precisely so a regression in the shift cannot hide behind matching block-relative
numbers.

**What remains open is the canonical F5 ceremony**, and it is open for one reason
only: `differential-baseline.json` carries **no html row** because the sweep has
not run at a stable tree, so SPEC sections **E and F** stay red. The scoped
`--lang html` run deliberately refuses to write the artifact — it would replace a
28-language, 60-file claim with a smaller one and call it the same thing.

That is the honest state, not a green one.

## Complexity and performance

Single DFS pass over an explicit stack — no child-array mapping, O(depth) working
set. Attribute extraction is one cursor per element. Identity resolution is an
O(1) map. Deferred in-document references resolve in O(L) after the walk, so a
**forward** reference (a label naming a control declared later) resolves exactly
as a backward one does. `srcset` is one index pass. Subtree complexity is one
reverse walk over the emitted symbols, not an O(depth) walk per node.

### Measured

Asymptotic argument is not evidence, and this lane had none published — the only
number it carried was measured on the analyzer called *directly*, which skips the
inline-block seam and so omitted the JavaScript sub-parse that is the single
largest cost on a real page. Both are given, because quoting only the flattering
one is how a 3× figure becomes a documented 3× lie.

Through the production `ASTEngine.parseFile` path, parsers pre-warmed, Exposed
(9.32 MiB over 400 files):

| | value |
|---|---|
| throughput | **4.7–5.3 ms/KiB** (~0.2 MiB/s) |
| per file | 112–182 ms, tracking file size |
| in-family comparison | **javascript 31.9 ms/KiB** on the same method and corpus — html is ~6× cheaper per KiB |
| flatness | 4.7 ms/KiB on the 400-file draw, 5.3 on a 120-file draw of larger documents: no super-linear growth with size, which is the property the O(nodes + attribute bytes) claim predicts |
| **duplicate-id page** | **596 ms** for 4,000 elements sharing one id, against 396 ms for 4,000 unique ids — 1.5×, where it was **17×** (15,516 ms) before the suffix watermark fix below |

### The one super-linear path, found by attacking it

The flatness above is measured on real corpora, which are not adversarial. Probing
the shape the data structure is *least* happy with — a page that reuses one `id`
across thousands of elements — exposed a genuine O(n²): suffix allocation re-probed
from 2 for every duplicate, so the k-th duplicate cost k probes. A generated page
that stamps one id across its elements hits it, and it made the whole-document
figure quadratic rather than linear.

The fix advances a per-handle watermark, and its only acceptable property is that
naming is **byte-identical** — the watermark is a lower bound, not a guarantee,
because a document may declare `id="dup#2"` literally. `html/identity-addressable`
declares such a literal *before* the duplicate that would claim it, which is the
ordering that makes correct and naive allocation necessarily disagree; the naive
version emits `dup#2` twice and the fixture fails. The proof is a negative control
rather than a mutant, and the fixture says why: a mutation harness transforms
output, where the collision does not exist, and from that output a literal `dup#2`
and an allocated `dup#2` are the same string — telling them apart *is* the defect.

### Nesting depth, and where the ceiling is

A 20,000-deep document overflows the stack somewhere above the analyzer — the
analyzer itself handles 20,001 symbols in 2 s, and tree-sitter parses the tree in
67 s — and the engine degrades to `2.0-basic-fallback` rather than crashing. The
measured ceiling is between 12,000 (ok) and 16,000 (degrades).

For context on whether that matters: across **1,599 real HTML files the deepest
nesting is 32**, none exceeds 100, and browsers cap HTML nesting far lower. The
backstop is therefore correct behaviour on input no real corpus produces, not a
launch risk — but it is a property of the engine and tree-sitter rather than of
this analyzer, and it is recorded here rather than left for someone to rediscover
with a fuzzer.

The honest reading: html is not a performance outlier, and the cost is dominated
by the delegate sub-parse rather than by the document walk. A page with no inline
code is materially cheaper than these figures, and one with a large inline script
is materially more expensive — so `ms/KiB` is the portable unit and `ms/file` is
not.

What is still missing is a *scored* per-lane floor. `avgMsPerFile` for html lives
in `differential-baseline.json`, which only the canonical 28-language sweep
writes, so section F of the completeness spec has no number to check. The figures
above are therefore **published as a measurement, not as a budget** — no gate
enforces them, and the doc says so rather than implying otherwise.

## See also

- `docs/analyzers/real-html-analyzer.md` — the per-symbol/per-edge extraction
  contract, the regex inventory and the M12 ground truth
- `script/m14/spec/html-completeness.json` — the 19-type classification,
  `HTML-G1` and ruling `HTML-D1`
- `reviews/html/` — the review record and the ledger row
